// Ported from biz-bot/worker/src/providers/xai.js — Responses API chat, Grok Imagine images (with edits),
// TTS (POST /v1/tts) and STT (POST /v1/stt); timestamp alignment normalised as in
// personagram-ai/src/worker/providers.ts timestampAlignment().
import { ProviderError } from '../errors';
import { audioExtension, audioMime, base64ToArrayBuffer, dataUrl, sniffImageMime } from '../lib/bytes';
import { guardStream } from '../lib/stream';
import { ToolNames } from '../lib/tools';
import { BASE_URLS, CHAT_CATALOG, IMAGE_MODELS, XAI_SPEECH } from '../model-catalog';
import { normalizeTier, type Alignment, type ChatProvider, type ChatRequest, type HostedSupport, type ImageProvider, type ModelEvent, type ProviderFactory, type SpeechProvider } from '../types';
import { HttpClient, throwIfAborted } from './common';
import { hostedFor } from '../lib/hosted';
import { parseResponsesStream, toInputItems, toResponsesToolChoice, toResponsesTools } from './responses';

const LABEL = 'xAI';
/** Hosted web and X search (Responses API, biz-bot xai.js:46-47). */
export const XAI_HOSTED: HostedSupport = { web_search: 'with_tools', x_search: 'with_tools' };
const isReasoningModel = (model: string) => !/non-reasoning/.test(model);
const supportsEffort = (model: string) => !/non-reasoning|4\.20-0309-reasoning|4\.20-reasoning|build/.test(model);

async function* xaiChat(http: HttpClient, req: ChatRequest, model: string): AsyncGenerator<ModelEvent> {
  const names = ToolNames.forRequest(req.tools, req.messages);
  const body: Record<string, unknown> = { model, input: toInputItems(req.messages, names), stream: true, store: false };
  if (req.system) body.instructions = req.system;
  const fns = req.toolChoice === 'none' ? [] : toResponsesTools(req.tools, names);
  const hosted = hostedFor(req, XAI_HOSTED, fns.length > 0).map((t) =>
    t.type === 'x_search' ? { type: 'x_search' } : { type: 'web_search', ...(t.allowedDomains?.length ? { filters: { allowed_domains: t.allowedDomains.slice(0, 5) } } : {}) },
  );
  const tools = [...fns, ...hosted];
  if (tools.length) body.tools = tools;
  // Sources as structured items; inline `[[N]](url)` markers would leak into the text (biz-bot xai.js:75-77).
  if (hosted.length) body.include = ['web_search_call.action.sources', 'no_inline_citations'];
  const tc = fns.length ? toResponsesToolChoice(req.toolChoice, names) : undefined;
  if (tc) body.tool_choice = tc;
  if (req.maxTokens) body.max_output_tokens = req.maxTokens;
  if (req.reasoningEffort && req.reasoningEffort !== 'none' && supportsEffort(model)) body.reasoning = { effort: req.reasoningEffort };
  if (!isReasoningModel(model) && req.temperature != null) body.temperature = req.temperature;
  if (req.responseFormat?.type === 'json_schema') {
    body.text = { format: { type: 'json_schema', name: req.responseFormat.name || 'result', schema: req.responseFormat.schema, strict: req.responseFormat.strict !== false } };
  }
  const res = await http.request('/responses', { json: body, signal: req.signal, stream: true });
  yield* parseResponsesStream(http.body(res), 'xai', LABEL, names, req.signal);
}

/**
 * xAI `with_timestamps` → Alignment (ms). Accepts `{graph_chars, graph_times: [[start, end] seconds]}` (the
 * TTS socket shape PG normalises) and the `{characters, character_start_times_seconds, …}` form.
 */
export function xaiAlignment(value: unknown): Alignment | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const chars: string[] = [];
  const startsMs: number[] = [];
  const endsMs: number[] = [];
  const ok = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;
  if (Array.isArray(v.graph_chars) && Array.isArray(v.graph_times)) {
    for (let i = 0; i < Math.min(v.graph_chars.length, 4000); i++) {
      const c = v.graph_chars[i];
      const pair = v.graph_times[i] as unknown;
      if (typeof c !== 'string' || !Array.isArray(pair) || pair.length !== 2 || !ok(pair[0]) || !ok(pair[1]) || pair[1] < pair[0]) return null;
      chars.push(c);
      startsMs.push(Math.round(pair[0] * 1000));
      endsMs.push(Math.round(pair[1] * 1000));
    }
    return chars.length ? { chars, startsMs, endsMs } : null;
  }
  const cs = v.characters ?? v.chars;
  const ss = v.character_start_times_seconds;
  const es = v.character_end_times_seconds;
  if (Array.isArray(cs) && Array.isArray(ss) && Array.isArray(es) && cs.length === ss.length && cs.length === es.length) {
    for (let i = 0; i < Math.min(cs.length, 4000); i++) {
      if (typeof cs[i] !== 'string' || !ok(ss[i]) || !ok(es[i])) return null;
      chars.push(cs[i] as string);
      startsMs.push(Math.round((ss[i] as number) * 1000));
      endsMs.push(Math.round((es[i] as number) * 1000));
    }
    return chars.length ? { chars, startsMs, endsMs } : null;
  }
  return null;
}

interface ImagesResponse {
  data?: { b64_json?: string; url?: string; mime_type?: string; revised_prompt?: string }[];
}

export const createXaiProvider: ProviderFactory = (env, { fetch }) => {
  const key = env.XAI_API_KEY?.trim();
  if (!key) return null;
  const http = new HttpClient({ provider: 'xai', label: LABEL, keyName: 'XAI_API_KEY', baseUrl: env.XAI_BASE_URL?.trim() || BASE_URLS.xai, headers: { authorization: `Bearer ${key}` }, fetch, secrets: [key] });
  const base = { id: 'xai', kind: 'cloud', family: 'grok' } as const;

  const chat: ChatProvider = {
    hosted: XAI_HOSTED,
    ...base,
    defaultModel: (tier) => CHAT_CATALOG.xai.defaults[normalizeTier(tier)],
    chat: (req) => guardStream('xai', LABEL, req.signal, () => xaiChat(http, req, req.model || chat.defaultModel()), [key]),
  };

  const speech: SpeechProvider = {
    ...base,
    async tts(req) {
      const wanted = req.voice.xai?.trim().toLowerCase();
      const voice = wanted && (XAI_SPEECH.voices as readonly string[]).includes(wanted) ? wanted : XAI_SPEECH.defaultVoice;
      const codec = req.format === 'wav' ? 'wav' : req.format === 'pcm16' ? 'pcm' : 'mp3';
      const body: Record<string, unknown> = {
        text: req.text.slice(0, XAI_SPEECH.maxChars),
        voice_id: voice,
        // `language` is required by /v1/tts.
        language: req.language ?? 'en',
        output_format: { codec, sample_rate: XAI_SPEECH.sampleRate, ...(codec === 'mp3' ? { bit_rate: XAI_SPEECH.bitRate } : {}) },
      };
      if (req.voice.speed) body.speed = Math.min(XAI_SPEECH.maxSpeed, Math.max(XAI_SPEECH.minSpeed, req.voice.speed));
      if (req.withAlignment) body.with_timestamps = true;
      const res = await http.request('/tts', { json: body, signal: req.signal });
      const type = res.headers.get('content-type') ?? '';
      if (/json/i.test(type)) {
        const j = (await res.json()) as Record<string, unknown>;
        const b64 = [j.audio, j.audio_base64, j.data].find((x): x is string => typeof x === 'string');
        if (!b64) throw new ProviderError('xai', `${LABEL} returned no audio.`, 502, true, 'bad_response');
        const audio = base64ToArrayBuffer(b64);
        throwIfAborted(req.signal);
        const mime = typeof j.content_type === 'string' ? j.content_type : audioMime(req.format);
        return { audio, mime, provider: 'xai', voice, alignment: xaiAlignment(j.audio_timestamps ?? j.timestamps ?? j.alignment) };
      }
      const audio = await res.arrayBuffer();
      throwIfAborted(req.signal);
      return { audio, mime: type.startsWith('audio/') ? type : audioMime(req.format), provider: 'xai', voice, alignment: null };
    },
    async stt(req) {
      const form = new FormData();
      // `format` (punctuation, casing) requires `language`. The file part must be last.
      form.append('language', req.language ?? 'en');
      form.append('format', 'true');
      form.append('file', new Blob([req.audio], { type: req.mime }), `audio.${audioExtension(req.mime)}`);
      const out = await http.json<{ text?: string; language?: string; duration?: number }>('/stt', { body: form, signal: req.signal });
      return { text: (out.text ?? '').trim(), provider: 'xai', ...(out.language ? { language: out.language } : {}), ...(out.duration ? { durationMs: Math.round(out.duration * 1000) } : {}) };
    },
  };

  const image: ImageProvider = {
    ...base,
    async generate(req) {
      const model = req.model ?? IMAGE_MODELS.xai;
      const data = req.source
        ? await http.json<ImagesResponse>('/images/edits', {
            json: { model, prompt: req.prompt, image: { type: 'image_url', url: dataUrl(req.source.data, req.source.mime) }, response_format: 'b64_json' },
            signal: req.signal,
            timeoutMs: 180_000,
          })
        : await http.json<ImagesResponse>('/images/generations', {
            // Portraits are 3:4 (personagram-ai portrait generation).
            json: { model, prompt: req.prompt, n: 1, response_format: 'b64_json', aspect_ratio: req.aspect ?? '3:4' },
            signal: req.signal,
            timeoutMs: 180_000,
          });
      const first = data.data?.[0];
      let bytes: ArrayBuffer;
      if (first?.b64_json) bytes = base64ToArrayBuffer(first.b64_json);
      else if (first?.url) bytes = (await http.download(first.url, req.signal)).data;
      else throw new ProviderError('xai', `${LABEL} returned no image.`, 502, false, 'bad_response');
      return { image: bytes, mime: sniffImageMime(bytes, first.mime_type || 'image/jpeg'), provider: 'xai', model, ...(first.revised_prompt ? { revisedPrompt: first.revised_prompt } : {}) };
    },
  };

  return { chat, speech, image };
};
