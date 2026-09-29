// A Model Context Protocol client over Streamable HTTP (ported from biz-bot worker/src/mcp.js, typed and hardened):
// initialize (newest protocol version first, older ones only when the server rejects the version) →
// notifications/initialized → tools/list (paged) → tools/call; answers arrive as JSON or as an event stream.
// Unlike biz-bot: every hop is checked against private addresses (DNS included) and redirects are re-checked; each
// call has a deadline and a size cap; and tools/call is never retried blindly — only when the server said the session
// is unknown (404), which means the call never ran.
import { parseSSE } from '@headcount/models';
import { assertPublicHost, assertPublicUrl, dohResolver, FetchPageError, type Resolver } from '../tools/fetch-page';

export const MCP_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'] as const;
const CLIENT_INFO = { name: 'headcount', version: '1.0.0' };
const SESSION_TTL_MS = 10 * 60_000;
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const MAX_REDIRECTS = 2;
const MAX_TOOLS = 500;
export const MCP_TIMEOUT_MS = { list: 20_000, call: 60_000 };

export interface McpTool {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  readOnly?: boolean;
  destructive?: boolean;
}

export interface McpServerInfo {
  name?: string;
  version?: string;
  protocolVersion: string;
}

export interface McpCallResult {
  text: string;
  isError: boolean;
  structured?: unknown;
}

export type McpErrorKind = 'blocked' | 'http' | 'auth' | 'rpc' | 'timeout' | 'network' | 'protocol' | 'session';

export class McpError extends Error {
  constructor(
    message: string,
    readonly kind: McpErrorKind,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = 'McpError';
  }
}

export interface McpTarget {
  /** Session cache key (the connector id). */
  key: string;
  url: string;
  token?: string | null;
}

export interface McpOptions {
  fetchImpl?: typeof fetch;
  /** DNS check of each hop; null skips it (tests, the in-worker demo). Default: DNS over HTTPS. */
  resolve?: Resolver | null;
  signal?: AbortSignal;
  now?: () => number;
  /** The in-worker demo server: its reserved address skips the public-address checks (it never touches the network). */
  trusted?: boolean;
  /** Deadlines per operation (tests shorten them). */
  timeouts?: Partial<typeof MCP_TIMEOUT_MS>;
}

interface Session {
  id?: string;
  protocolVersion: string;
  server: McpServerInfo;
  expires: number;
}

type RpcMessage = { jsonrpc: '2.0'; id?: number; method: string; params?: Record<string, unknown> };
type RpcReply = { jsonrpc?: string; id?: number | string; result?: Record<string, unknown>; error?: { code: number; message: string; data?: unknown } };

// Per isolate (the WorkspaceDO): sessions are cheap to recreate, so a miss is fine.
const sessions = new Map<string, Session>();

/** Drop a cached session (the key or URL changed, or the connector was removed). */
export function forgetSession(key: string): void {
  sessions.delete(key);
}

const clip = (s: string, n = 300) => (s.length > n ? `${s.slice(0, n)}…` : s);

export class McpClient {
  private readonly fetchImpl: typeof fetch;
  private readonly resolve: Resolver | null;
  private readonly now: () => number;
  private nextId = 1;

  constructor(
    private readonly target: McpTarget,
    private readonly opts: McpOptions = {},
  ) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.resolve = opts.resolve === undefined ? dohResolver(this.fetchImpl) : opts.resolve;
    this.now = opts.now ?? Date.now;
  }

  /** Connect afresh (no cached session) and list every tool: the connector's test. */
  async test(): Promise<{ tools: McpTool[]; server: McpServerInfo }> {
    forgetSession(this.target.key);
    return this.listTools();
  }

  async listTools(): Promise<{ tools: McpTool[]; server: McpServerInfo }> {
    return this.withSession(this.opts.timeouts?.list ?? MCP_TIMEOUT_MS.list, async (session, signal) => {
      const tools: McpTool[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 20; page++) {
        const result = await this.rpc({ jsonrpc: '2.0', id: this.nextId++, method: 'tools/list', params: cursor ? { cursor } : {} }, session, signal);
        for (const t of (result?.tools as unknown[]) ?? []) {
          const tool = toolOf(t);
          if (tool) tools.push(tool);
        }
        cursor = typeof result?.nextCursor === 'string' && result.nextCursor ? result.nextCursor : undefined;
        if (!cursor || tools.length >= MAX_TOOLS) break;
      }
      return { tools: tools.slice(0, MAX_TOOLS), server: session.server };
    });
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult> {
    return this.withSession(this.opts.timeouts?.call ?? MCP_TIMEOUT_MS.call, async (session, signal) => {
      const result = await this.rpc({ jsonrpc: '2.0', id: this.nextId++, method: 'tools/call', params: { name, arguments: args ?? {} } }, session, signal);
      const text = contentToText(result?.content);
      return { text, isError: result?.isError === true, ...(result?.structuredContent !== undefined ? { structured: result.structuredContent } : {}) };
    });
  }

  // ── sessions ───────────────────────────────────────────────────────────────────

  private async withSession<T>(timeoutMs: number, fn: (session: Session, signal: AbortSignal) => Promise<T>): Promise<T> {
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(new McpError('The connector did not answer in time.', 'timeout')), timeoutMs);
    const onAbort = () => deadline.abort(this.opts.signal?.reason);
    this.opts.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      let session = await this.connect(deadline.signal);
      try {
        return await fn(session, deadline.signal);
      } catch (err) {
        // The server no longer knows the session (404): the request never ran, so reconnect and send it once more.
        if (!(err instanceof McpError && err.kind === 'session')) throw err;
        forgetSession(this.target.key);
        session = await this.connect(deadline.signal);
        return await fn(session, deadline.signal);
      }
    } catch (err) {
      if (err instanceof McpError) throw err;
      if (deadline.signal.aborted) throw deadline.signal.reason instanceof McpError ? deadline.signal.reason : new McpError('The call was stopped.', 'timeout');
      throw err;
    } finally {
      clearTimeout(timer);
      this.opts.signal?.removeEventListener('abort', onAbort);
    }
  }

  private async connect(signal: AbortSignal): Promise<Session> {
    const cached = sessions.get(this.target.key);
    if (cached && cached.expires > this.now()) return cached;
    let lastError: unknown;
    for (const version of MCP_PROTOCOL_VERSIONS) {
      const session: Session = { protocolVersion: version, server: { protocolVersion: version }, expires: this.now() + SESSION_TTL_MS };
      try {
        const init = await this.rpc(
          { jsonrpc: '2.0', id: this.nextId++, method: 'initialize', params: { protocolVersion: version, capabilities: {}, clientInfo: CLIENT_INFO } },
          session,
          signal,
          true,
        );
        const agreed = typeof init?.protocolVersion === 'string' ? init.protocolVersion : version;
        const info = (init?.serverInfo ?? {}) as { name?: unknown; version?: unknown };
        session.protocolVersion = agreed;
        session.server = { protocolVersion: agreed, ...(typeof info.name === 'string' ? { name: clip(info.name, 80) } : {}), ...(typeof info.version === 'string' ? { version: clip(info.version, 40) } : {}) };
        // Some servers reject or ignore the notification; that is not fatal.
        await this.rpc({ jsonrpc: '2.0', method: 'notifications/initialized' }, session, signal).catch(() => undefined);
        sessions.set(this.target.key, session);
        return session;
      } catch (err) {
        lastError = err;
        // Only an explicit rejection of the protocol version moves to an older one.
        if (!(err instanceof McpError && (err.status === 400 || err.kind === 'rpc') && /version/i.test(err.message))) throw err;
      }
    }
    throw lastError instanceof Error ? lastError : new McpError('The connector would not start a session.', 'protocol');
  }

  // ── one JSON-RPC exchange ────────────────────────────────────────────────────────

  private async rpc(message: RpcMessage, session: Session, signal: AbortSignal, initializing = false): Promise<Record<string, unknown> | null> {
    const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
    if (this.target.token) headers.authorization = /^(bearer|basic|token)\s/i.test(this.target.token) ? this.target.token : `Bearer ${this.target.token}`;
    if (session.id) headers['mcp-session-id'] = session.id;
    if (!initializing) headers['mcp-protocol-version'] = session.protocolVersion;
    const res = await this.post(JSON.stringify(message), headers, signal);
    const sid = res.headers.get('mcp-session-id');
    if (sid && initializing) session.id = sid.slice(0, 200);

    if (message.id === undefined) {
      await res.body?.cancel().catch(() => undefined);
      if (!res.ok && res.status !== 202 && res.status !== 204) throw new McpError(`The connector refused a notification (HTTP ${res.status}).`, 'http', res.status);
      return null;
    }
    if (res.status === 404 && session.id && !initializing) {
      await res.body?.cancel().catch(() => undefined);
      throw new McpError('The connector session expired.', 'session', 404);
    }
    if (res.status === 401 || res.status === 403) {
      await res.body?.cancel().catch(() => undefined);
      throw new McpError(this.target.token ? 'The connector refused the key (it may be wrong or expired).' : 'The connector needs a key or sign-in.', 'auth', res.status);
    }
    if (!res.ok) {
      const text = await readCapped(res, 8 * 1024).catch(() => '');
      throw new McpError(`The connector answered HTTP ${res.status}${text ? `: ${clip(text.replace(/\s+/g, ' '), 200)}` : ''}.`, 'http', res.status);
    }
    const type = (res.headers.get('content-type') ?? '').toLowerCase();
    if (type.includes('text/event-stream')) {
      if (!res.body) throw new McpError('The connector sent an empty stream.', 'protocol');
      for await (const { data } of parseSSE(capStream(res.body, MAX_BODY_BYTES), signal)) {
        const reply = matchReply(parse(data), message.id);
        if (reply) return unwrap(reply);
      }
      throw new McpError('The connector’s stream ended without an answer.', 'protocol');
    }
    const body = parse(await readCapped(res, MAX_BODY_BYTES));
    const reply = matchReply(body, message.id);
    if (!reply) throw new McpError('The connector sent no answer.', 'protocol');
    return unwrap(reply);
  }

  /** POST with the address checks on every hop; 307/308 redirects are followed (re-checked) at most twice. */
  private async post(body: string, headers: Record<string, string>, signal: AbortSignal): Promise<Response> {
    let url = this.opts.trusted ? new URL(this.target.url) : this.check(this.target.url);
    for (let hop = 0; ; hop++) {
      try {
        if (!this.opts.trusted) await assertPublicHost(url, this.resolve, signal);
      } catch (err) {
        throw err instanceof FetchPageError ? new McpError(err.message.replace('cannot be read', 'cannot be reached'), 'blocked', err.status) : err;
      }
      let res: Response;
      try {
        res = await this.fetchImpl(url.toString(), { method: 'POST', headers, body, redirect: 'manual', signal });
      } catch (err) {
        if (signal.aborted) throw signal.reason instanceof McpError ? signal.reason : new McpError('The call was stopped.', 'timeout');
        throw new McpError(`Could not reach the connector (${err instanceof Error ? clip(err.message, 120) : 'network error'}).`, 'network');
      }
      if (res.status < 300 || res.status >= 400) return res;
      const loc = res.headers.get('location');
      await res.body?.cancel().catch(() => undefined);
      if (!loc || (res.status !== 307 && res.status !== 308) || hop >= MAX_REDIRECTS) throw new McpError(`The connector redirected (HTTP ${res.status}); check its URL.`, 'http', res.status);
      url = this.check(new URL(loc, url).toString());
    }
  }

  private check(raw: string): URL {
    let u: URL;
    try {
      u = assertPublicUrl(raw);
    } catch (err) {
      throw new McpError(err instanceof Error ? err.message.replace('cannot be read', 'cannot be reached').replace('pages can be read', 'addresses can be reached') : 'That URL cannot be reached.', 'blocked', 400);
    }
    if (u.protocol !== 'https:') throw new McpError('Connectors must use https.', 'blocked', 400);
    return u;
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────────

function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function matchReply(body: unknown, id: number | undefined): RpcReply | null {
  const list = Array.isArray(body) ? body : [body];
  for (const m of list) if (m && typeof m === 'object' && (m as RpcReply).id === id && ('result' in m || 'error' in m)) return m as RpcReply;
  return null;
}

function unwrap(reply: RpcReply): Record<string, unknown> {
  if (reply.error) throw new McpError(`The connector reported an error: ${clip(String(reply.error.message ?? 'unknown'), 200)} (${reply.error.code}).`, 'rpc');
  return reply.result ?? {};
}

async function readCapped(res: Response, max: number): Promise<string> {
  if (!res.body) return '';
  const reader = capStream(res.body, max).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/** Errors once more than `max` bytes arrive (a runaway stream cannot fill memory). */
function capStream(body: ReadableStream<Uint8Array>, max: number): ReadableStream<Uint8Array> {
  let seen = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        seen += chunk.byteLength;
        if (seen > max) controller.error(new McpError('The connector’s answer is too large.', 'protocol'));
        else controller.enqueue(chunk);
      },
    }),
  );
}

function toolOf(raw: unknown): McpTool | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as { name?: unknown; title?: unknown; description?: unknown; inputSchema?: unknown; annotations?: { readOnlyHint?: unknown; destructiveHint?: unknown; title?: unknown } };
  if (typeof t.name !== 'string' || !t.name.trim()) return null;
  const title = typeof t.title === 'string' ? t.title : typeof t.annotations?.title === 'string' ? t.annotations.title : undefined;
  return {
    name: t.name.slice(0, 128),
    ...(title ? { title: clip(title, 120) } : {}),
    description: typeof t.description === 'string' ? clip(t.description, 2000) : '',
    inputSchema: normalizeSchema(t.inputSchema),
    ...(t.annotations?.readOnlyHint === true ? { readOnly: true } : {}),
    ...(t.annotations?.destructiveHint === true ? { destructive: true } : {}),
  };
}

/** An object schema the model APIs accept (biz-bot normalizeSchema, plus dropping meta keys some providers reject). */
export function normalizeSchema(schema: unknown): Record<string, unknown> {
  const s: Record<string, unknown> = schema && typeof schema === 'object' && !Array.isArray(schema) ? { ...(schema as Record<string, unknown>) } : {};
  delete s.$schema;
  delete s.$id;
  s.type = 'object';
  if (!s.properties || typeof s.properties !== 'object') s.properties = {};
  if (s.required !== undefined && !Array.isArray(s.required)) delete s.required;
  return s;
}

/** MCP content blocks → text for a model (biz-bot contentToText). */
export function contentToText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .map((c: { type?: string; text?: string; mimeType?: string; data?: string; uri?: string; name?: string; resource?: { text?: string; uri?: string } }) => {
      if (c?.type === 'text') return String(c.text ?? '');
      if (c?.type === 'image') return `[image ${c.mimeType ?? ''}]`;
      if (c?.type === 'audio') return `[audio ${c.mimeType ?? ''}]`;
      if (c?.type === 'resource_link') return `[resource ${c.uri ?? ''}${c.name ? ` — ${c.name}` : ''}]`;
      if (c?.type === 'resource') return c.resource?.text ?? `[resource ${c.resource?.uri ?? ''}]`;
      return JSON.stringify(c);
    })
    .join('\n');
}
