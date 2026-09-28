// Ported from biz-bot/worker/src/providers/openai.js — Responses API chat, audio (TTS/STT), images and
// embeddings over raw HTTP, adapted to the ModelEvent vocabulary and typed provider interfaces.
import { ProviderError } from '../errors';
import { guardStream } from '../lib/stream';
import { ToolNames } from '../lib/tools';
import { audioExtension, audioMime, base64ToArrayBuffer, sniffImageMime } from '../lib/bytes';
import { BASE_URLS, CHAT_CATALOG, EMBEDDING_MODELS, IMAGE_MODELS, OPENAI_SPEECH } from '../model-catalog';
import {
  normalizeTier,
  type ChatProvider,
  type ChatRequest,
  type EmbeddingProvider,
  type ImageProvider,
  type ImageRequest,
  type ModelEvent,
  type ProviderFactory,
  type SpeechProvider,
  type SttRequest,
} from '../types';
import { HttpClient, throwIfAborted } from './common';
import { parseResponsesStream, toInputItems, toResponsesToolChoice, toResponsesTools } from './responses';

const LABEL = 'OpenAI';
const isReasoningModel = (model: string) => /^(gpt-5|o\d)/.test(model);

async function* openaiChat(http: HttpClient, req: ChatRequest, model: string): AsyncGenerator<ModelEvent> {
  const names = ToolNames.forRequest(req.tools, req.messages);
  const body: Record<string, unknown> = { model, input: toInputItems(req.messages, names), stream: true, store: false };
  if (req.system) body.instructions = req.system;
  const tools = req.toolChoice === 'none' ? [] : toResponsesTools(req.tools, names);
  if (tools.length) body.tools = tools;
  const tc = tools.length ? toResponsesToolChoice(req.toolChoice, names) : undefined;
  if (tc) body.tool_choice = tc;
  if (req.maxTokens) body.max_output_tokens = req.maxTokens;
  if (isReasoningModel(model)) {
    body.reasoning = { summary: 'auto', ...(req.reasoningEffort ? { effort: req.reasoningEffort } : {}) };
  } else if (req.temperature != null) {
    body.temperature = req.temperature;
  }
  if (req.responseFormat?.type === 'json_schema') {
    body.text = { format: { type: 'json_schema', name: req.responseFormat.name || 'result', schema: req.responseFormat.schema, strict: req.responseFormat.strict ?? false } };
  }
  const res = await http.request('/responses', { json: body, signal: req.signal, stream: true });
  yield* parseResponsesStream(http.body(res), 'openai', LABEL, names, req.signal);
}

function pickVoice(wanted: string | undefined, known: readonly string[], fallback: string): string {
  const v = wanted?.trim().toLowerCase();
  return v && known.includes(v) ? v : fallback;
}

/** Portrait 3:4 → 1024x1536 (EXPERIENCE §10.5); landscape → 1536x1024. */
function openaiSize(aspect: ImageRequest['aspect']): string {
  if (aspect === '1:1') return '1024x1024';
  if (aspect === '4:3' || aspect === '16:9') return '1536x1024';
  return '1024x1536';
}

interface ImagesResponse {
  data?: { b64_json?: string; url?: string; revised_prompt?: string }[];
  output_format?: string;
}

export const createOpenAIProvider: ProviderFactory = (env, { fetch }) => {
  const key = env.OPENAI_API_KEY?.trim();
  if (!key) return null;
  const http = new HttpClient({ provider: 'openai', label: LABEL, keyName: 'OPENAI_API_KEY', baseUrl: env.OPENAI_BASE_URL?.trim() || BASE_URLS.openai, headers: { authorization: `Bearer ${key}` }, fetch, secrets: [key] });
  const base = { id: 'openai', kind: 'cloud', family: 'gpt' } as const;

  const chat: ChatProvider = {
    ...base,
    defaultModel: (tier) => CHAT_CATALOG.openai.defaults[normalizeTier(tier)],
    chat: (req) => guardStream('openai', LABEL, req.signal, () => openaiChat(http, req, req.model || chat.defaultModel()), [key]),
  };

  async function transcribe(req: SttRequest, model: string) {
    const form = new FormData();
    form.append('file', new Blob([req.audio], { type: req.mime }), `audio.${audioExtension(req.mime)}`);
    form.append('model', model);
    form.append('response_format', 'json');
    if (req.language) form.append('language', req.language);
    if (req.prompt) form.append('prompt', req.prompt.slice(-800));
    return http.json<{ text?: string; language?: string; duration?: number }>('/audio/transcriptions', { body: form, signal: req.signal });
  }

  const speech: SpeechProvider = {
    ...base,
    async tts(req) {
      const voice = pickVoice(req.voice.openai, OPENAI_SPEECH.voices, OPENAI_SPEECH.defaultVoice);
      const model = req.model ?? OPENAI_SPEECH.ttsModel;
      const format = req.format === 'wav' ? 'wav' : req.format === 'pcm16' ? 'pcm' : 'mp3';
      const body: Record<string, unknown> = { model, voice, input: req.text.slice(0, OPENAI_SPEECH.maxChars), response_format: format };
      if (req.voice.instructions && !/^tts-1/.test(model)) body.instructions = req.voice.instructions;
      if (req.voice.speed) body.speed = Math.min(4, Math.max(0.25, req.voice.speed));
      const { data, mime } = await http.bytes('/audio/speech', { json: body, signal: req.signal });
      throwIfAborted(req.signal);
      return { audio: data, mime: mime.startsWith('audio/') ? mime : audioMime(req.format), provider: 'openai', voice, alignment: null };
    },
    async stt(req) {
      const model = req.model ?? OPENAI_SPEECH.sttModel;
      let out: { text?: string; language?: string; duration?: number };
      try {
        out = await transcribe(req, model);
      } catch (e) {
        // gpt-4o-transcribe unavailable on this account → whisper-1 (the documented fallback).
        const modelProblem = e instanceof ProviderError && (e.kind === 'model_not_found' || (e.kind === 'bad_request' && /model/i.test(e.message)));
        if (!modelProblem || req.model || model === OPENAI_SPEECH.sttFallbackModel) throw e;
        out = await transcribe(req, OPENAI_SPEECH.sttFallbackModel);
      }
      return { text: (out.text ?? '').trim(), provider: 'openai', ...(out.language ? { language: out.language } : req.language ? { language: req.language } : {}), ...(out.duration ? { durationMs: Math.round(out.duration * 1000) } : {}) };
    },
  };

  const image: ImageProvider = {
    ...base,
    async generate(req) {
      const model = req.model ?? IMAGE_MODELS.openai;
      const size = openaiSize(req.aspect);
      let data: ImagesResponse;
      if (req.source) {
        const form = new FormData();
        form.append('image', new Blob([req.source.data], { type: req.source.mime }), `source.${req.source.mime.split('/')[1] || 'png'}`);
        form.append('prompt', req.prompt);
        form.append('model', model);
        form.append('size', size);
        form.append('n', '1');
        data = await http.json<ImagesResponse>('/images/edits', { body: form, signal: req.signal, timeoutMs: 180_000 });
      } else {
        data = await http.json<ImagesResponse>('/images/generations', { json: { model, prompt: req.prompt, n: 1, size, quality: 'auto', output_format: 'png' }, signal: req.signal, timeoutMs: 180_000 });
      }
      const first = data.data?.[0];
      let bytes: ArrayBuffer;
      if (first?.b64_json) bytes = base64ToArrayBuffer(first.b64_json);
      else if (first?.url) bytes = (await http.download(first.url, req.signal)).data;
      else throw new ProviderError('openai', `${LABEL} returned no image.`, 502, false, 'bad_response');
      return { image: bytes, mime: sniffImageMime(bytes, `image/${data.output_format || 'png'}`), provider: 'openai', model, ...(first.revised_prompt ? { revisedPrompt: first.revised_prompt } : {}) };
    },
  };

  const embeddings: EmbeddingProvider = {
    ...base,
    async embed(req) {
      const model = req.model ?? EMBEDDING_MODELS.openai.model;
      const out = await http.json<{ data?: { index: number; embedding: number[] }[]; model?: string }>('/embeddings', { json: { model, input: req.texts }, signal: req.signal });
      const vectors = [...(out.data ?? [])].sort((a, b) => a.index - b.index).map((d) => d.embedding);
      if (vectors.length !== req.texts.length) throw new ProviderError('openai', `${LABEL} returned ${vectors.length} embeddings for ${req.texts.length} texts.`, 502, true, 'bad_response');
      return { vectors, model: out.model ?? model, dims: vectors[0]?.length ?? 0, provider: 'openai' };
    },
  };

  return { chat, speech, image, embeddings };
};
