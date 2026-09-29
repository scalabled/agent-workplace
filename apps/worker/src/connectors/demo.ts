// The demo notebook: a small MCP server answered inside the worker (mock mode only), so connecting, listing tools,
// approvals and calls can be tried without keys or the network. Notes live in the WorkspaceDO's SQLite. It speaks the
// same Streamable HTTP shapes as a real server: a session id on initialize, JSON for most answers, and an event stream
// for tools/call.

const SCHEMA = 'CREATE TABLE IF NOT EXISTS demo_notes (title TEXT PRIMARY KEY, text TEXT NOT NULL, at TEXT NOT NULL)';

const TOOLS = [
  { name: 'list_notes', description: 'List the titles of every note in the notebook.', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
  {
    name: 'read_note',
    description: 'Read one note by its title.',
    inputSchema: { type: 'object', properties: { title: { type: 'string', description: 'The note title' } }, required: ['title'] },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'add_note',
    description: 'Add a note (or replace the note with the same title).',
    inputSchema: { type: 'object', properties: { title: { type: 'string' }, text: { type: 'string' } }, required: ['title', 'text'] },
    annotations: { readOnlyHint: false },
  },
];

type Rpc = { jsonrpc: '2.0'; id?: number; method: string; params?: { name?: string; arguments?: Record<string, unknown>; protocolVersion?: string } };

export function demoNotebookFetch(sql: SqlStorage, now: () => string): typeof fetch {
  sql.exec(SCHEMA);
  if (!sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM demo_notes').toArray()[0]!.n) {
    sql.exec('INSERT INTO demo_notes (title, text, at) VALUES (?, ?, ?)', 'Welcome', 'This is the demo notebook. Coworkers can list, read and add notes here.', now());
  }
  const json = (body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', ...headers } });
  const call = (name: string, args: Record<string, unknown>) => {
    const text = (t: string, isError = false) => ({ content: [{ type: 'text', text: t }], isError });
    if (name === 'list_notes') return text(sql.exec<{ title: string }>('SELECT title FROM demo_notes ORDER BY at').toArray().map((r) => `- ${r.title}`).join('\n') || '(no notes yet)');
    if (name === 'read_note') {
      const r = sql.exec<{ text: string }>('SELECT text FROM demo_notes WHERE title = ?', String(args.title ?? '')).toArray()[0];
      return r ? text(r.text) : text(`No note called “${String(args.title ?? '')}”.`, true);
    }
    if (name === 'add_note') {
      const title = String(args.title ?? '').trim().slice(0, 120);
      if (!title) return text('A note needs a title.', true);
      sql.exec('INSERT OR REPLACE INTO demo_notes (title, text, at) VALUES (?, ?, ?)', title, String(args.text ?? '').slice(0, 4000), now());
      return text(`Saved “${title}”.`);
    }
    return null;
  };
  return async (_input, init) => {
    const msg = JSON.parse(String(init?.body ?? '{}')) as Rpc;
    if (msg.id === undefined) return new Response(null, { status: 202 });
    if (msg.method === 'initialize') {
      return json({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: msg.params?.protocolVersion ?? '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'demo-notebook', version: '1.0.0' } } }, { 'mcp-session-id': `demo-${crypto.randomUUID()}` });
    }
    if (msg.method === 'tools/list') return json({ jsonrpc: '2.0', id: msg.id, result: { tools: TOOLS } });
    if (msg.method === 'tools/call') {
      const result = call(msg.params?.name ?? '', msg.params?.arguments ?? {});
      const reply = result ? { jsonrpc: '2.0', id: msg.id, result } : { jsonrpc: '2.0', id: msg.id, error: { code: -32602, message: `Unknown tool ${msg.params?.name}` } };
      return new Response(`event: message\ndata: ${JSON.stringify(reply)}\n\n`, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }
    return json({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } });
  };
}
