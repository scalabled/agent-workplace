import { fillSchema } from './schema-fill';
import { silentWav } from './wav';
import type {
  ChatMessage,
  ChatProvider,
  ChatRequest,
  EmbeddingProvider,
  ImageProvider,
  ModelEvent,
  ProviderInstance,
  SpeechProvider,
  ToolSpec,
} from './types';

// Keyless, deterministic, schema-aware provider (after biz-bot worker/src/providers/mock.js).
// Same input → same output, so tests and the keyless demo are reproducible.
//
// How Mock decides to call a tool, in order:
//   1. `!tool <name> {json}` in the latest owner message (biz-bot directive) → that call, once.
//   2. A tool's `mock.triggers` (regex sources) match the latest owner message.
//   3. Built-in job intents, for tools named like the Chief of Staff's job tools (no hints needed):
//      "look into X" → start_job/delegate, "how's it going?" → job_status/list_jobs,
//      "also check Y" → steer_job (jobId = the latest job_… id in the transcript), "cancel that" → cancel_job.
//   4. `toolChoice` required or named.
// `!slow <ms>` delays the reply (tests that act while a turn is in flight).

export interface MockOptions {
  /** Delay between streamed chunks in ms (demo realism; 0 in tests). */
  delayMs?: number;
}

export const MOCK_MODEL = 'mock-1';

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (ms <= 0 || signal?.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });

const estimateTokens = (s: string) => Math.ceil(s.length / 4);

function lastUserIndex(messages: ChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i]!.role === 'user') return i;
  return -1;
}

function matches(tool: ToolSpec, text: string): boolean {
  return (tool.mock?.triggers ?? []).some((src) => {
    try {
      return new RegExp(src, 'i').test(text);
    } catch {
      return false;
    }
  });
}

/** Split into small chunks that look like streamed tokens. */
export function chunkText(text: string, wordsPerChunk = 3): string[] {
  const words = text.split(/(\s+)/);
  const out: string[] = [];
  let buf = '';
  let count = 0;
  for (const w of words) {
    buf += w;
    if (w.trim()) count++;
    if (count >= wordsPerChunk) {
      out.push(buf);
      buf = '';
      count = 0;
    }
  }
  if (buf) out.push(buf);
  return out;
}

/** The default mock reply to a plain message. */
export function mockReply(userText: string): string {
  const clean = stripDirectives(userText).trim().replace(/\s+/g, ' ');
  if (!clean) return 'I am here. What would you like to work on?';
  const quoted = clean.length > 120 ? `${clean.slice(0, 117)}…` : clean;
  return `You said: "${quoted}". I am running on the mock model, so this is a placeholder answer. Add a provider key or start Ollama for real ones.`;
}

function stripDirectives(text: string): string {
  return text.replace(/!tool\s+[\w.-]+[ \t]*(\{[^\n]*\})?/g, '').replace(/!slow\s+\d+/g, '');
}

// ── job intents ────────────────────────────────────────────────────────────────

export type MockIntent = 'start' | 'status' | 'steer' | 'cancel';

const INTENT_TOOLS: Record<MockIntent, RegExp> = {
  start: /^(start_job|delegate|delegate_job|create_job|run_job|start_task|background_job|start_background_job)$/i,
  status: /^(job_status|jobs_status|get_job_status|get_job|list_jobs|check_jobs|check_job|job_state|jobs)$/i,
  steer: /^(steer_job|steer|update_job|add_to_job|redirect_job)$/i,
  cancel: /^(cancel_job|stop_job|cancel)$/i,
};

const POLITE = String.raw`^(?:ok(?:ay)?[,.]?\s+|hey[,.]?\s+|so[,.]?\s+)?(?:please\s+|can you\s+|could you\s+|would you\s+|will you\s+|i need you to\s+|i'd like you to\s+|go\s+(?:and\s+)?)?`;
const START_VERBS = String.raw`(?:look into|research|find out(?: about)?|investigate|dig into|look up|check out|scout|survey|compare|put together|pull together|draft|prepare|analy[sz]e|summari[sz]e|explore|find me|find)`;
const START_LEADING = new RegExp(`${POLITE}${START_VERBS}\\b`, 'i');
const START_ANYWHERE = new RegExp(`\\b${START_VERBS}\\b`, 'i');
const STATUS = /\b(how(?:'?s| is| are)\b[^.?!]*\b(?:going|coming(?: along)?|looking|getting on|doing)|status|progress|any (?:news|update)|update on|where (?:are|is) (?:we|it|that)|how far|done yet|finished yet)\b/i;
const STEER = /^(?:ok(?:ay)?[,.]?\s+)?(?:also|and also|plus|oh,? and|additionally|actually,? also)\b|\b(?:also (?:check|look|include|cover|compare|add|find|consider|get)|focus (?:on|more on)|make sure (?:it|you|to) (?:also )?(?:check|include|cover)|don'?t forget)\b/i;
const CANCEL = /\b(?:cancel|stop|abort|kill|drop)\b[^.?!]*\b(?:job|it|that|research|work|task|this)\b|^(?:never ?mind|forget (?:it|that))\b/i;

const JOB_ID = /\bjob_[0-9a-z]{6,}\b/g;

/** The latest job id mentioned anywhere in the transcript (tool outputs, replies), else in the system prompt. */
export function latestJobId(req: Pick<ChatRequest, 'messages' | 'system'>): string | null {
  for (let i = req.messages.length - 1; i >= 0; i--) {
    const m = req.messages[i]!;
    const texts = [m.content, ...(m.role === 'assistant' ? (m.toolCalls ?? []).map((c) => c.arguments) : [])];
    for (let j = texts.length - 1; j >= 0; j--) {
      const found = texts[j]!.match(JOB_ID);
      if (found?.length) return found[found.length - 1]!;
    }
  }
  const sys = req.system?.match(JOB_ID);
  return sys?.length ? sys[sys.length - 1]! : null;
}

/** Which job intent the owner's words express, among the tools on offer. Exported for tests. */
export function detectIntent(text: string, tools: ToolSpec[], hasJob: boolean): { intent: MockIntent; tool: ToolSpec } | null {
  const clean = stripDirectives(text).trim();
  const toolFor = (intent: MockIntent) => tools.find((t) => !t.mock?.triggers?.length && INTENT_TOOLS[intent].test(t.name));
  const order: [MockIntent, (s: string) => boolean][] = [
    ['cancel', (s) => hasJob && CANCEL.test(s)],
    ['steer', (s) => hasJob && STEER.test(s)],
    ['start', (s) => START_LEADING.test(s)],
    ['status', (s) => STATUS.test(s)],
    ['start', (s) => START_ANYWHERE.test(s) || (STEER.test(s) && !hasJob)],
  ];
  for (const [intent, test] of order) {
    if (!test(clean)) continue;
    const tool = toolFor(intent);
    if (tool) return { intent, tool };
  }
  return null;
}

function sentenceCase(s: string): string {
  const t = s.trim().replace(/[.?!]+$/, '');
  return t ? t[0]!.toUpperCase() + t.slice(1) : t;
}

/** "Could you look into local coffee suppliers?" → "local coffee suppliers". */
export function jobSubject(text: string): string {
  const clean = stripDirectives(text).trim().replace(/\s+/g, ' ');
  const m = new RegExp(`${POLITE}${START_VERBS}\\s+`, 'i').exec(clean);
  return (m ? clean.slice(m[0].length) : clean).replace(/[.?!]+$/, '').trim() || clean;
}

function jobTitle(text: string): string {
  const s = sentenceCase(jobSubject(text));
  if (s.length <= 60) return s;
  const cut = s.slice(0, 60);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 30 ? cut.lastIndexOf(' ') : 60)}…`;
}

function steerText(text: string): string {
  return sentenceCase(stripDirectives(text).replace(/^(?:ok(?:ay)?[,.]?\s+)?(?:and also|also|plus|oh,? and|additionally|actually,? also)[,\s]+/i, ''));
}

function intentArgs(tool: ToolSpec, intent: MockIntent, userText: string, jobId: string | null): Record<string, unknown> {
  const filled = fillSchema(tool.parameters, stripDirectives(userText).trim(), 0);
  const args: Record<string, unknown> = filled && typeof filled === 'object' && !Array.isArray(filled) ? (filled as Record<string, unknown>) : {};
  for (const [key, sub] of Object.entries(tool.parameters.properties ?? {})) {
    const isString = sub.type === 'string' || (Array.isArray(sub.type) && sub.type.includes('string')) || (!sub.type && !sub.enum);
    if (!isString || sub.enum) continue;
    if (/^(job_?id|jobid|id|job)$/i.test(key)) {
      if (jobId) args[key] = jobId;
    } else if (intent === 'start') {
      if (/title|name|label|subject|topic|headline/i.test(key)) args[key] = jobTitle(userText);
      else if (/brief|task|goal|description|instructions?|request|query|prompt|what|details|ask/i.test(key)) args[key] = sentenceCase(jobSubject(userText));
    } else if (intent === 'steer') {
      if (/text|instruction|steer|message|note|change|update|details|direction|ask/i.test(key)) args[key] = steerText(userText);
    } else if (intent === 'cancel') {
      if (/reason|why|note/i.test(key)) args[key] = 'The owner asked to stop.';
    }
  }
  return args;
}

function parseOutput(content: string): Record<string, unknown> | unknown[] | null {
  try {
    const v = JSON.parse(content) as unknown;
    return v && typeof v === 'object' ? (v as Record<string, unknown> | unknown[]) : null;
  } catch {
    return null;
  }
}

function said(o: Record<string, unknown> | unknown[] | null): string | null {
  if (!o || Array.isArray(o)) return null;
  const s = o.say ?? o.summary ?? o.message;
  return typeof s === 'string' && s.trim() ? s.trim() : null;
}

/** "Local coffee suppliers: step 2 of 4, comparing prices." from a job list / snapshot tool output. */
export function summarizeJobs(content: string): string | null {
  const o = parseOutput(content);
  if (!o) return null;
  const rec = o as Record<string, unknown>;
  const list = (Array.isArray(o) ? o : Array.isArray(rec.jobs) ? rec.jobs : rec.job ? [rec.job] : rec.jobId || rec.title ? [rec] : null) as Record<string, unknown>[] | null;
  if (!list) return null;
  if (!list.length) return 'Nothing is running right now.';
  return list
    .slice(0, 3)
    .map((j) => {
      const title = String(j.title ?? j.brief ?? 'The job');
      const status = String(j.status ?? '');
      const label = typeof j.label === 'string' && j.label ? j.label.replace(/[.]+$/, '') : '';
      let state: string;
      if (/done|complete|finished|succeeded/i.test(status)) state = 'done';
      else if (/fail/i.test(status)) state = 'it failed';
      else if (/cancel/i.test(status)) state = 'cancelled';
      else if (/queue|pending/i.test(status)) state = 'queued';
      else if (typeof j.step === 'number' && typeof j.of === 'number') state = `step ${j.step} of ${j.of}`;
      else state = 'in progress';
      return `${title}: ${state}${label && state !== 'done' ? `, ${label[0]!.toLowerCase()}${label.slice(1)}` : ''}.`;
    })
    .join(' ');
}

function intentOf(name: string): MockIntent | null {
  for (const intent of Object.keys(INTENT_TOOLS) as MockIntent[]) if (INTENT_TOOLS[intent].test(name)) return intent;
  return null;
}

function afterTool(spec: ToolSpec | undefined, m: Extract<ChatMessage, { role: 'tool' }>, call: { arguments: string } | undefined): string {
  if (spec?.mock?.reply) return spec.mock.reply(m.content);
  if (m.isError) return `That did not work: ${firstSentence(m.content)}`;
  const intent = spec?.mock?.triggers?.length ? null : intentOf(m.name);
  const out = parseOutput(m.content);
  if (intent === 'start') {
    const args = call ? parseOutput(call.arguments) : null;
    const argTitle = args && !Array.isArray(args) ? args.title : undefined;
    const outTitle = out && !Array.isArray(out) ? ((out.job as Record<string, unknown> | undefined)?.title ?? out.title) : undefined;
    const title = outTitle ?? argTitle;
    return said(out) ?? `On it. I started ${typeof title === 'string' && title ? `"${title}"` : 'that'} and will tell you when it is done.`;
  }
  if (intent === 'status') return said(out) ?? summarizeJobs(m.content) ?? firstSentence(m.content);
  if (intent === 'steer') return said(out) ?? 'Noted. I will fold that in at the next checkpoint.';
  if (intent === 'cancel') return said(out) ?? 'Stopped.';
  return `Done. ${firstSentence(m.content)}`;
}

/** Decide what the mock says next. Pure, exported for tests. */
export function planMockTurn(req: ChatRequest): { kind: 'text'; text: string } | { kind: 'tool'; tool: ToolSpec; args: Record<string, unknown> } {
  const i = lastUserIndex(req.messages);
  const userText = i >= 0 ? (req.messages[i] as { content: string }).content : '';
  const since = i >= 0 ? req.messages.slice(i + 1) : [];

  if (req.responseFormat?.type === 'json_schema') {
    return { kind: 'text', text: JSON.stringify(fillSchema(req.responseFormat.schema, stripDirectives(userText).trim().slice(0, 200))) };
  }

  const tools = req.toolChoice === 'none' ? [] : (req.tools ?? []);
  const last = req.messages[req.messages.length - 1];
  if (last?.role === 'tool') {
    // After tool results: speak about them.
    const calls = new Map(since.flatMap((m) => (m.role === 'assistant' ? (m.toolCalls ?? []).map((c) => [c.id, c] as const) : [])));
    const replies = since
      .filter((m): m is Extract<ChatMessage, { role: 'tool' }> => m.role === 'tool')
      .map((m) => afterTool(tools.find((t) => t.name === m.name), m, calls.get(m.toolCallId)));
    return { kind: 'text', text: replies.join(' ') || 'Done.' };
  }

  if (tools.length) {
    const called = new Set(since.flatMap((m) => (m.role === 'assistant' ? (m.toolCalls ?? []).map((c) => c.name) : [])));
    const open = tools.filter((t) => !called.has(t.name));
    const choice = req.toolChoice;
    if (choice && typeof choice === 'object') {
      const pick = tools.find((t) => t.name === choice.name);
      if (pick) return { kind: 'tool', tool: pick, args: pick.mock?.args?.(userText) ?? ((fillSchema(pick.parameters, userText) as Record<string, unknown>) ?? {}) };
    }
    // 1. `!tool <name> {json}` (biz-bot directive).
    const directives = [...userText.matchAll(/!tool\s+([\w.-]+)[ \t]*(\{[^\n]*\})?/g)];
    const directive = directives[directives.length - 1];
    if (directive && open.length) {
      const pick = open.find((t) => t.name === directive[1]) ?? open[0]!;
      let args: Record<string, unknown> = {};
      try {
        args = directive[2] ? (JSON.parse(directive[2]) as Record<string, unknown>) : {};
      } catch {
        /* malformed JSON → no args */
      }
      return { kind: 'tool', tool: pick, args };
    }
    // 2. Explicit trigger hints.
    const hinted = open.find((t) => matches(t, userText));
    if (hinted) return { kind: 'tool', tool: hinted, args: hinted.mock?.args?.(userText) ?? ((fillSchema(hinted.parameters, userText) as Record<string, unknown>) ?? {}) };
    // 3. Built-in job intents.
    const jobId = latestJobId(req);
    const intent = detectIntent(userText, open, jobId !== null);
    if (intent) return { kind: 'tool', tool: intent.tool, args: intent.tool.mock?.args?.(userText) ?? intentArgs(intent.tool, intent.intent, userText, jobId) };
    // 4. Forced tool use.
    if (choice === 'required' && open.length) {
      const pick = open[0]!;
      return { kind: 'tool', tool: pick, args: pick.mock?.args?.(userText) ?? ((fillSchema(pick.parameters, userText) as Record<string, unknown>) ?? {}) };
    }
  }

  return { kind: 'text', text: mockReply(userText) };
}

function firstSentence(s: string): string {
  let text = s;
  try {
    const parsed = JSON.parse(s) as unknown;
    if (parsed && typeof parsed === 'object') {
      const o = parsed as Record<string, unknown>;
      text = String(o.say ?? o.summary ?? o.message ?? o.status ?? s);
    }
  } catch {
    /* plain text */
  }
  const m = /^(.{1,200}?[.!?])(\s|$)/.exec(text.trim());
  return (m ? m[1]! : text.trim().slice(0, 200)) || 'Done.';
}

function createMockChat(opts: MockOptions): ChatProvider {
  let callCounter = 0;
  return {
    id: 'mock',
    kind: 'mock',
    family: 'mock',
    defaultModel: () => MOCK_MODEL,
    async *chat(req: ChatRequest): AsyncGenerator<ModelEvent> {
      const input = estimateTokens((req.system ?? '') + req.messages.map((m) => m.content).join('\n'));
      const i = lastUserIndex(req.messages);
      const lastIsUser = i === req.messages.length - 1 && i >= 0;
      const slow = lastIsUser ? /!slow\s+(\d+)/.exec((req.messages[i] as { content: string }).content) : null;
      if (slow) {
        yield { type: 'reasoning', delta: 'Thinking slowly… ' };
        await sleep(Math.min(Number(slow[1]), 20_000), req.signal);
      }
      const plan = planMockTurn(req);
      if (plan.kind === 'tool') {
        await sleep(opts.delayMs ?? 0, req.signal);
        if (req.signal?.aborted) return yield { type: 'done', finish: 'cancelled' };
        yield { type: 'tool_call', id: `call_mock_${++callCounter}`, name: plan.tool.name, arguments: JSON.stringify(plan.args) };
        yield { type: 'usage', input, output: 12, usd: 0, costStatus: 'free' };
        yield { type: 'done', finish: 'tool_calls' };
        return;
      }
      for (const chunk of chunkText(plan.text)) {
        await sleep(opts.delayMs ?? 0, req.signal);
        if (req.signal?.aborted) {
          yield { type: 'done', finish: 'cancelled' };
          return;
        }
        yield { type: 'text', delta: chunk };
      }
      yield { type: 'usage', input, output: estimateTokens(plan.text), usd: 0, costStatus: 'free' };
      yield { type: 'done', finish: 'stop' };
    },
  };
}

function createMockSpeech(): SpeechProvider {
  return {
    id: 'mock',
    kind: 'mock',
    family: 'mock',
    async tts(req) {
      // Silent audio with synthetic, evenly spaced character alignment (ARCHITECTURE §12.2).
      const chars = Array.from(req.text);
      const perChar = 60 / (req.voice.speed ?? 1);
      const durationMs = Math.min(20_000, Math.max(400, Math.round(chars.length * perChar)));
      const step = durationMs / Math.max(1, chars.length);
      return {
        audio: silentWav(durationMs),
        mime: 'audio/wav',
        provider: 'mock',
        voice: req.voice.openai ?? req.voice.xai ?? 'mock',
        durationMs,
        alignment: {
          chars,
          startsMs: chars.map((_, i) => Math.round(i * step)),
          endsMs: chars.map((_, i) => Math.round((i + 1) * step)),
        },
      };
    },
    async stt(req) {
      return { text: `This is a mock transcript of ${req.audio.byteLength} bytes of audio.`, provider: 'mock', language: 'en' };
    },
  };
}

function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function createMockImage(): ImageProvider {
  return {
    id: 'mock',
    kind: 'mock',
    family: 'mock',
    async generate(req) {
      const h = hash32(req.prompt);
      const hue = h % 360;
      const [w, hgt] = req.aspect === '1:1' ? [768, 768] : req.aspect === '16:9' ? [1024, 576] : req.aspect === '4:3' ? [1024, 768] : [768, 1024];
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${hgt}" viewBox="0 0 ${w} ${hgt}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hue} 30% 82%)"/><stop offset="1" stop-color="hsl(${hue} 30% 62%)"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><ellipse cx="${w / 2}" cy="${hgt * 0.42}" rx="${w * 0.2}" ry="${hgt * 0.19}" fill="hsl(${(hue + 30) % 360} 25% 70%)"/><rect x="${w * 0.22}" y="${hgt * 0.66}" width="${w * 0.56}" height="${hgt * 0.4}" rx="${w * 0.2}" fill="hsl(${hue} 20% 40%)"/></svg>`;
      return { image: new TextEncoder().encode(svg).buffer as ArrayBuffer, mime: 'image/svg+xml', provider: 'mock', model: 'mock-image' };
    },
  };
}

function createMockEmbeddings(): EmbeddingProvider {
  const dims = 64;
  return {
    id: 'mock',
    kind: 'mock',
    family: 'mock',
    async embed(req) {
      const vectors = req.texts.map((t) => {
        const v = new Array<number>(dims).fill(0);
        for (const word of t.toLowerCase().split(/\W+/).filter(Boolean)) v[hash32(word) % dims]! += 1;
        const norm = Math.hypot(...v) || 1;
        return v.map((x) => x / norm);
      });
      return { vectors, model: 'mock-embed', dims, provider: 'mock' };
    },
  };
}

export function createMockProvider(opts: MockOptions = {}): Required<Omit<ProviderInstance, 'health'>> {
  return { chat: createMockChat(opts), speech: createMockSpeech(), image: createMockImage(), embeddings: createMockEmbeddings() };
}
