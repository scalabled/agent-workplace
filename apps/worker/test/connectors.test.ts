// biz-bot parity, stage 5: MCP connectors. The client against fake servers (versions, event streams, sessions, no
// blind retries, address checks), keys sealed at rest, the catalog, and the whole flow through the in-worker demo
// notebook: connect, test, approval policies, a project step that waits for the owner's OK, the Chief of Staff's
// card in Talk, grants and their withdrawal, and the daily cap.
import { ids, parseFrame, type Frame, type FrameType } from '@headcount/protocol';
import type { ConnectorsResponse, ConnectorView } from '@headcount/protocol/ext/connectors';
import type { Decision, TeamProjectSnapshot } from '@headcount/protocol/ext/projects';
import type { AgentView } from '@headcount/protocol/ext/agents';
import { fullIndex } from '@headcount/catalog/full';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONNECTOR_CATALOG, DEMO_CONNECTOR, slugOf, validateCatalog } from '../src/connectors/catalog';
import { McpClient, McpError, normalizeSchema } from '../src/connectors/mcp';
import { connectorSecret, openToken, sealToken } from '../src/connectors/secret';
import { connectorToolName } from '../src/connectors/tools';
import type { Env } from '../src/env';
import { handle } from '../src/index';
import type { ProjectDO } from '../src/jobs/project-do';
import type { WorkspaceDO } from '../src/workspace/workspace-do';
import { createTestEnv } from './fake-cloud';

// ── a fake MCP server ────────────────────────────────────────────────────────────

type Seen = { method: string; headers: Record<string, string>; body: { id?: number; method: string; params?: Record<string, unknown> } };

function fakeServer(opts: { versions?: string[]; sse?: boolean; failCall?: number; expireOnce?: boolean; pages?: number; unauthorized?: boolean } = {}) {
  const seen: Seen[] = [];
  let expired = false;
  let session = 0;
  const reply = (id: number | undefined, result: unknown, headers: Record<string, string> = {}) =>
    opts.sse
      ? new Response(`: keepalive\n\nevent: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress', params: {} })}\n\ndata: ${JSON.stringify({ jsonrpc: '2.0', id, result })}\n\n`, { headers: { 'content-type': 'text/event-stream', ...headers } })
      : new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), { headers: { 'content-type': 'application/json', ...headers } });
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    const body = JSON.parse(String(init.body)) as Seen['body'];
    seen.push({ method: body.method, headers, body });
    if (opts.unauthorized) return new Response('no', { status: 401 });
    if (body.method === 'initialize') {
      const v = String(body.params?.protocolVersion);
      if (opts.versions && !opts.versions.includes(v)) return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { code: -32602, message: 'Unsupported protocol version' } }), { status: 400, headers: { 'content-type': 'application/json' } });
      session++;
      return reply(body.id, { protocolVersion: v, capabilities: {}, serverInfo: { name: 'fake', version: '9' } }, { 'mcp-session-id': `s${session}` });
    }
    if (body.id === undefined) return new Response(null, { status: 202 });
    if (body.method === 'tools/list') {
      const page = Number(body.params?.cursor ?? 0);
      const last = (opts.pages ?? 1) - 1;
      return reply(body.id, { tools: [{ name: `tool_${page}`, description: 'Does a thing', inputSchema: { $schema: 'x', type: 'object', properties: { q: { type: 'string' } } }, annotations: { readOnlyHint: page === 0 } }], ...(page < last ? { nextCursor: String(page + 1) } : {}) });
    }
    if (body.method === 'tools/call') {
      if (opts.expireOnce && !expired) {
        expired = true;
        return new Response('gone', { status: 404 });
      }
      if (opts.failCall) return new Response('boom', { status: opts.failCall });
      return reply(body.id, { content: [{ type: 'text', text: `called ${String(body.params?.name)}` }], isError: false });
    }
    return new Response('?', { status: 400 });
  }) as unknown as typeof fetch;
  return { fetchImpl, seen };
}

let keyN = 0;
const client = (fetchImpl: typeof fetch, extra: Partial<ConstructorParameters<typeof McpClient>[1]> = {}, url = 'https://mcp.example.com/mcp') => new McpClient({ key: `k${++keyN}`, url, token: 'tok_123' }, { fetchImpl, resolve: null, ...extra });

describe('the MCP client', () => {
  it('negotiates down only when the server rejects the version, then keeps the session and version headers', async () => {
    const s = fakeServer({ versions: ['2025-06-18'] });
    const c = client(s.fetchImpl);
    const { tools, server } = await c.listTools();
    expect(server).toMatchObject({ name: 'fake', version: '9', protocolVersion: '2025-06-18' });
    expect(tools).toEqual([{ name: 'tool_0', description: 'Does a thing', inputSchema: { type: 'object', properties: { q: { type: 'string' } } }, readOnly: true }]);
    expect(s.seen.filter((x) => x.method === 'initialize').map((x) => x.body.params?.protocolVersion)).toEqual(['2025-11-25', '2025-06-18']);
    const list = s.seen.find((x) => x.method === 'tools/list')!;
    expect(list.headers).toMatchObject({ 'mcp-session-id': 's1', 'mcp-protocol-version': '2025-06-18', authorization: 'Bearer tok_123' });
    expect(s.seen.some((x) => x.method === 'notifications/initialized')).toBe(true);
    // The session is reused for the next call.
    expect(await c.callTool('tool_0', { q: 'x' })).toEqual({ text: 'called tool_0', isError: false });
    expect(s.seen.filter((x) => x.method === 'initialize')).toHaveLength(2);
  });

  it('reads answers from an event stream, skipping notifications, and follows pages of tools', async () => {
    const s = fakeServer({ sse: true, pages: 3 });
    const c = client(s.fetchImpl);
    expect((await c.listTools()).tools.map((t) => t.name)).toEqual(['tool_0', 'tool_1', 'tool_2']);
    expect((await c.callTool('tool_1', {})).text).toBe('called tool_1');
  });

  it('retries a call only when the server forgot the session (404), never after a failure', async () => {
    const expired = fakeServer({ expireOnce: true });
    const c = client(expired.fetchImpl);
    expect((await c.callTool('tool_0', {})).text).toBe('called tool_0');
    expect(expired.seen.filter((x) => x.method === 'tools/call')).toHaveLength(2);
    expect(expired.seen.filter((x) => x.method === 'initialize')).toHaveLength(2);

    const broken = fakeServer({ failCall: 500 });
    const e = await client(broken.fetchImpl).callTool('tool_0', {}).catch((err: unknown) => err);
    expect(e).toBeInstanceOf(McpError);
    expect((e as McpError).kind).toBe('http');
    expect(broken.seen.filter((x) => x.method === 'tools/call')).toHaveLength(1);
  });

  it('says when a key is refused, and times out', async () => {
    const e = await client(fakeServer({ unauthorized: true }).fetchImpl).listTools().catch((err: unknown) => err);
    expect((e as McpError).kind).toBe('auth');
    const never = (async (_u: string, init: RequestInit) => new Promise((_r, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted'))))) as unknown as typeof fetch;
    const t = await client(never, { timeouts: { list: 30 } }).listTools().catch((err: unknown) => err);
    expect((t as McpError).kind).toBe('timeout');
  });

  it('refuses private addresses, plain http, names that resolve privately, and redirects to them', async () => {
    const s = fakeServer();
    for (const url of ['https://127.0.0.1/mcp', 'https://10.0.0.8/mcp', 'http://mcp.example.com/mcp', 'https://intranet.local/mcp']) {
      const e = await client(s.fetchImpl, {}, url).listTools().catch((err: unknown) => err);
      expect((e as McpError).kind, url).toBe('blocked');
    }
    const rebind = await client(s.fetchImpl, { resolve: async () => ['192.168.1.5'] }).listTools().catch((err: unknown) => err);
    expect((rebind as McpError).kind).toBe('blocked');
    const redirect = (async () => new Response(null, { status: 307, headers: { location: 'https://169.254.169.254/latest' } })) as unknown as typeof fetch;
    const r = await client(redirect).listTools().catch((err: unknown) => err);
    expect((r as McpError).kind).toBe('blocked');
    expect(s.seen).toHaveLength(0);
  });

  it('normalises schemas and names tools for the model APIs', () => {
    expect(normalizeSchema({ $schema: 'x', type: 'string', required: 'no' })).toEqual({ type: 'object', properties: {} });
    expect(connectorToolName('git_hub', 'create issue!')).toBe('git_hub__create_issue_');
    expect(connectorToolName('a'.repeat(40), 'b'.repeat(40))).toHaveLength(64);
    expect(slugOf('monday.com')).toBe('monday_com');
    expect(slugOf('Cloudflare docs')).toBe('cloudflare_docs');
  });
});

describe('keys and the catalog', () => {
  it('seals keys with AES-GCM bound to the connector; only the right connector and secret open them', async () => {
    const sealed = await sealToken('a-long-enough-secret', 'cn_1', 'ghp_abc');
    expect(sealed.startsWith('v1:')).toBe(true);
    expect(sealed).not.toContain('ghp_abc');
    expect(await openToken('a-long-enough-secret', 'cn_1', sealed)).toBe('ghp_abc');
    expect(await openToken('a-long-enough-secret', 'cn_2', sealed)).toBeNull();
    expect(await openToken('another-long-secret!', 'cn_1', sealed)).toBeNull();
    expect(connectorSecret({ AUTH_MODE: 'google' })).toBeNull();
    expect(connectorSecret({ AUTH_MODE: 'google', CONNECTOR_SECRET: 'x'.repeat(32) })).toBe('x'.repeat(32));
    expect(connectorSecret({})).toBeTruthy();
  });

  it('carries biz-bot’s eleven and Buffer (social posting), all valid', () => {
    expect(CONNECTOR_CATALOG).toHaveLength(12);
    expect(CONNECTOR_CATALOG.find((c) => c.id === 'buffer')).toMatchObject({ url: 'https://mcp.buffer.com/mcp', auth: 'token' });
    expect(validateCatalog([DEMO_CONNECTOR, ...CONNECTOR_CATALOG])).toEqual([]);
  });
});

// ── the whole flow, through the demo notebook ────────────────────────────────────

async function setup(overrides: Partial<Env> = {}) {
  const t = await createTestEnv(overrides);
  const ws = t.namespaces.WORKSPACE.getByName('ws:local') as WorkspaceDO;
  const project = t.namespaces.PROJECT.getByName('p:everyday:local') as ProjectDO;
  t.namespaces.WORKSPACE.state('ws:local').getWebSockets = () => [{ send: (m: string) => void parseFrame(m) } as unknown as WebSocket];
  const api = async (method: string, path: string, body?: unknown) => {
    const res = await handle(new Request(`http://localhost${path}`, { method, ...(body !== undefined ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) }), t.env, t.ctx);
    return { status: res.status, body: (await res.json()) as any };
  };
  const tick = async (n = 1) => {
    for (let i = 0; i < n; i++) {
      await project.alarm();
      await t.ctx.drain();
    }
  };
  const ofType = async <T extends FrameType>(type: T) => (await ws.frames(0, 5000)).filter((f): f is Extract<Frame, { type: T }> => f.type === type);
  const settle = async (projectId: string, max = 30) => {
    for (let i = 0; i < max; i++) {
      const p = (await project.getProject(projectId))!;
      if (p.status !== 'running') return p;
      await tick();
    }
    return (await project.getProject(projectId))!;
  };
  const connectDemo = async (extra: Record<string, unknown> = {}) => (await api('POST', '/api/connectors', { catalogId: 'demo-notebook', ...extra })).body.connector as ConnectorView;
  const notes = () => t.namespaces.WORKSPACE.state('ws:local').storage.sql.exec<{ title: string }>('SELECT title FROM demo_notes').toArray().map((r) => r.title);
  await api('PUT', '/api/workspace', { leadId: 'lead-steady-operator', chiefName: 'Eddie' });
  return { t, ws, project, api, tick, ofType, settle, connectDemo, notes };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('connectors in the workspace', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('connects the demo, tests it, and never returns a key', async () => {
    const s = await setup();
    const list = (await s.api('GET', '/api/connectors')).body as ConnectorsResponse;
    expect(list.canStoreKeys).toBe(true);
    expect(list.catalog.map((c) => c.id)).toEqual(['demo-notebook', ...CONNECTOR_CATALOG.map((c) => c.id)]);
    const demo = await s.connectDemo();
    expect(demo).toMatchObject({ status: 'ready', slug: 'demo_notebook', approval: 'ask', everyone: true, chief: true, hasKey: false, server: { name: 'demo-notebook' } });
    expect(demo.tools.map((t) => [t.name, t.readOnly ?? false, t.needsApproval])).toEqual([
      ['list_notes', true, true],
      ['read_note', true, true],
      ['add_note', false, true],
    ]);
    expect((await s.api('POST', '/api/connectors', { catalogId: 'demo-notebook' })).status).toBe(409);
    // Only calls that change things ask.
    const writes = (await s.api('PUT', `/api/connectors/${demo.connectorId}`, { approval: 'writes' })).body.connector as ConnectorView;
    expect(writes.tools.map((t) => t.needsApproval)).toEqual([false, false, true]);

    // A keyed connector: the key is sealed at rest, and no response carries it.
    vi.stubGlobal('fetch', async (url: string) => (String(url).includes('dns-query') ? Response.json({ Answer: [{ type: 1, data: '140.82.112.1' }] }) : new Response('no', { status: 401 })));
    const gh = await s.api('POST', '/api/connectors', { catalogId: 'github', token: 'ghp_verysecret' });
    expect(gh.status).toBe(201);
    expect(gh.body.connector).toMatchObject({ hasKey: true, status: 'needs_key', lastError: 'The connector refused the key (it may be wrong or expired).' });
    expect(JSON.stringify(gh.body)).not.toContain('verysecret');
    expect(JSON.stringify((await s.api('GET', '/api/connectors')).body)).not.toContain('verysecret');
    const stored = s.t.namespaces.WORKSPACE.state('ws:local').storage.sql.exec<{ token: string }>('SELECT token FROM connectors WHERE catalog_id = ?', 'github').toArray()[0]!.token;
    expect(stored.startsWith('v1:')).toBe(true);
    expect(stored).not.toContain('verysecret');
    // Private and plain-http servers are refused up front.
    expect((await s.api('POST', '/api/connectors', { name: 'Mine', url: 'http://example.com/mcp' })).status).toBe(400);
    expect((await s.api('DELETE', `/api/connectors/${gh.body.connector.connectorId}`)).status).toBe(200);
    expect(((await s.api('GET', '/api/connectors')).body as ConnectorsResponse).connectors).toHaveLength(1);
  });

  it('a deployed worker without CONNECTOR_SECRET refuses to store keys but still connects keyless servers', async () => {
    const s = await setup({ AUTH_MODE: 'off' });
    expect(((await s.api('GET', '/api/connectors')).body as ConnectorsResponse).canStoreKeys).toBe(true);
    const g = await createTestEnv({ AUTH_MODE: 'google' });
    const ws = g.namespaces.WORKSPACE.getByName('ws:local') as WorkspaceDO;
    expect((await ws.connectorsView()).canStoreKeys).toBe(false);
    const r = (await ws.addConnector({ catalogId: 'github', token: 'ghp_x' })) as { error: string; code: string };
    expect(r).toMatchObject({ code: 'unavailable' });
  });

  it('gives coworkers the tools (everyone, or one by one) and shows them in the prompt view', async () => {
    const s = await setup();
    const demo = await s.connectDemo({ everyone: false });
    const persona = fullIndex.catalog.personas[0]!.id;
    const setupOf = async () => s.ws.agentSetup([persona]);
    expect((await setupOf()).connectors).toBeUndefined();
    const put = await s.api('PUT', `/api/agents/${persona}`, { connectors: [demo.connectorId] });
    expect(put.body.error ?? null).toBeNull();
    const on = put.body as AgentView;
    expect(on.connectors).toEqual([{ connectorId: demo.connectorId, name: 'Demo notebook', tools: 3, status: 'ready', everyone: false, granted: true }]);
    expect((await setupOf()).connectors?.[persona]?.[0]?.tools.map((t) => t.name)).toEqual(['list_notes', 'read_note', 'add_note']);
    const work = on.prompts.find((p) => p.surface === 'work')!;
    expect(work.tools.map((t) => t.name)).toContain('demo_notebook__add_note');
    expect(work.text).toContain('Connected services you can use');
    expect(((await s.api('GET', '/api/connectors')).body as ConnectorsResponse).connectors[0]!.grantedTo).toEqual([persona]);
    // The Chief's prompt view lists them too.
    const chief = (await s.api('GET', '/api/chief/prompt')).body as { tools: { name: string }[]; text: string };
    expect(chief.tools.map((t) => t.name)).toContain('demo_notebook__list_notes');
    expect(chief.text).toContain('Connected services you can use');
  });

  it('a project step that needs a connector waits for the owner; “for this project” lets the rest run', async () => {
    const s = await setup();
    const demo = await s.connectDemo();
    await s.api('POST', '/api/talk', { text: 'Put together a team to launch our spring menu with a small campaign', opId: ids.op() });
    await s.t.ctx.drain();
    await s.tick();
    const { project } = (await s.ofType('project.proposed')).at(-1)!.data as { project: TeamProjectSnapshot; decision: Decision };
    const target = project.steps.find((st) => !st.dependsOn.length)!;
    await s.api('PUT', `/api/projects/${project.projectId}/steps/${target.id}`, { brief: `${target.brief} (use demo_notebook__add_note)` });
    await s.api('POST', `/api/projects/${project.projectId}/approve`);
    const waiting = await s.settle(project.projectId);
    const step = waiting.steps.find((st) => st.id === target.id)!;
    expect(step).toMatchObject({ status: 'asking', question: { text: 'May I use Demo notebook → add_note?' } });
    const hand = (await s.ofType('decision.opened')).map((f) => f.data.decision).find((d) => d.kind === 'connector')!;
    expect(hand).toMatchObject({ projectId: project.projectId, stepId: target.id, connector: { connectorId: demo.connectorId, tool: 'add_note', subject: step.ownerId } });
    expect(hand.connector!.args).toContain('Mock note');
    expect(s.notes()).toEqual(['Welcome']);
    // The Chief pings about it in Talk.
    expect((await s.ofType('talk.message')).some((m) => /wants to use Demo notebook → add_note/.test(m.data.text))).toBe(true);

    const answered = await s.api('POST', `/api/decisions/${hand.decisionId}`, { action: 'approve', scope: 'project' });
    expect(answered.status).toBe(202);
    expect(answered.body.decision).toMatchObject({ status: 'approved', scope: 'project' });
    const done = await s.settle(project.projectId);
    expect(done.status).toBe('done');
    expect(s.notes().sort()).toEqual(['Mock note', 'Welcome']);
    const view = ((await s.api('GET', '/api/connectors')).body as ConnectorsResponse).connectors[0]!;
    expect(view.grants).toEqual([expect.objectContaining({ tool: 'add_note', scope: 'project', projectId: project.projectId, uses: 1 })]);
    expect(view.calls).toBe(1);
    // The call is in the run inspector, framed as external data.
    const runs = (await s.api('GET', `/api/projects/${project.projectId}/runs?stepId=${target.id}`)).body as { runs: { calls: { name: string; result: string }[] }[] };
    const calls = runs.runs.flatMap((r) => r.calls).filter((c) => c.name === 'demo_notebook__add_note');
    expect(calls[0]!.result).toContain('The owner has been asked to allow Demo notebook → add_note');
    expect(calls.at(-1)!.result).toContain('<external source="connector Demo notebook → add_note">');
    // Withdrawn, the next project asks again.
    const revoked = await s.api('DELETE', `/api/connectors/${demo.connectorId}/grants/${view.grants[0]!.grantId}`);
    expect(revoked.body.connector.grants).toEqual([]);
  });

  it('the Chief’s call waits on a card in Talk; allowing it runs the call in the same turn', async () => {
    const s = await setup();
    await s.connectDemo();
    await s.api('POST', '/api/talk', { text: 'Can you check my notes (use demo_notebook__list_notes)', opId: ids.op() });
    let hand: Decision | undefined;
    for (let i = 0; i < 200 && !hand; i++) {
      await wait(5);
      hand = (await s.project.openDecisions()).find((d) => d.kind === 'connector');
    }
    expect(hand).toMatchObject({ projectId: '', title: 'Eddie wants to use Demo notebook → list_notes', connector: { subject: 'chief', tool: 'list_notes' } });
    // No ping: the card is in Talk.
    expect((await s.ofType('talk.message')).some((m) => /wants to use/.test(m.data.text))).toBe(false);
    const r = await s.api('POST', `/api/decisions/${hand!.decisionId}`, { action: 'approve', scope: 'once' });
    expect(r.status).toBe(202);
    expect(r.body.project).toBeUndefined();
    await s.t.ctx.drain();
    const said = (await s.ofType('talk.message')).at(-1)!.data.text;
    expect(said).toContain('Done with Demo notebook');
    expect(said).toContain('Welcome');
    // "Once" left no standing grant.
    expect(((await s.api('GET', '/api/connectors')).body as ConnectorsResponse).connectors[0]!.grants).toEqual([]);
  });

  it('declining tells the Chief; “never ask” runs at once; the daily cap stops calls', async () => {
    const s = await setup({ CONNECTOR_DAILY_LIMIT: '1' });
    const demo = await s.connectDemo();
    await s.api('POST', '/api/talk', { text: 'Add a note (use demo_notebook__add_note)', opId: ids.op() });
    let hand: Decision | undefined;
    for (let i = 0; i < 200 && !hand; i++) {
      await wait(5);
      hand = (await s.project.openDecisions()).find((d) => d.kind === 'connector');
    }
    await s.api('POST', `/api/decisions/${hand!.decisionId}`, { action: 'decline' });
    await s.t.ctx.drain();
    expect(s.notes()).toEqual(['Welcome']);

    // "Never ask" on the connector, but the autonomy dial for changes in connected apps is still Propose (Inc 6): the
    // stricter wins, so the write still waits. Once the owner lets them act, it runs at once, and is in the audit log.
    await s.api('PUT', `/api/connectors/${demo.connectorId}`, { approval: 'never' });
    expect((await s.api('GET', '/api/trust')).body.policy.app_write).toBe('propose');
    expect((await s.api('PUT', '/api/trust/autonomy', { actionClass: 'app_write', level: 'act_report' })).status).toBe(200);
    await s.api('POST', '/api/talk', { text: 'Add a note (use demo_notebook__add_note)', opId: ids.op() });
    await s.t.ctx.drain();
    expect(s.notes().sort()).toEqual(['Mock note', 'Welcome']);
    const log = (await s.api('GET', '/api/audit?kind=app')).body.entries as { summary: string; undo?: { can: boolean; label: string } }[];
    expect(log[0]).toMatchObject({ summary: expect.stringContaining('Demo notebook'), undo: { can: false, label: 'Undo it in Demo notebook itself' } });
    expect(await s.ws.connectorCall({ connectorId: demo.connectorId, tool: 'list_notes', args: {}, subject: 'chief' })).toMatchObject({ status: 'error', message: expect.stringContaining('daily limit') });
  });
});
