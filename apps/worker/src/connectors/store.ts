// The workspace's connectors (WorkspaceDO SQLite): what is connected, its key (sealed; never returned), the tools it
// offers (cached from the last test), who may use it, when a call waits for the owner, the standing grants the owner
// gave from raised hands, and the calls themselves — every call runs here, so keys never leave this Durable Object.
import type { ConnectorApproval, ConnectorAsk, ConnectorCatalogEntry, ConnectorCreate, ConnectorGrantView, ConnectorPatch, ConnectorToolView, ConnectorView } from '@headcount/protocol/ext/connectors';
import { CONNECTOR_APPROVALS, CONNECTOR_NAME_MAX, CONNECTOR_TOKEN_MAX } from '@headcount/protocol/ext/connectors';
import type { ConnectorScope } from '@headcount/protocol/ext/projects';
import type { Env } from '../env';
import { clipText } from '../jobs/job-view';
import { wrapExternal } from '../tools/external';
import type { Resolver } from '../tools/fetch-page';
import { connectorCatalog, mocksOn, slugOf } from './catalog';
import { demoNotebookFetch } from './demo';
import { forgetSession, McpClient, McpError, type McpTool } from './mcp';
import { connectorSecret, openToken, sealToken } from './secret';

export const CONNECTOR_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS connectors (
     connector_id TEXT PRIMARY KEY, catalog_id TEXT, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, url TEXT NOT NULL,
     auth TEXT NOT NULL, token TEXT, approval TEXT NOT NULL, everyone INTEGER NOT NULL, chief INTEGER NOT NULL,
     status TEXT NOT NULL, last_error TEXT, tools TEXT, tools_at TEXT, server TEXT, calls INTEGER NOT NULL DEFAULT 0,
     last_call_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS connector_grants (
     grant_id TEXT PRIMARY KEY, connector_id TEXT NOT NULL, tool TEXT NOT NULL, scope TEXT NOT NULL, project_id TEXT,
     subject TEXT, created_at TEXT NOT NULL, uses INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS connector_grants_by ON connector_grants (connector_id, tool)`,
];

/** Characters of a tool result a model reads (the rest is cut, and it says so). */
export const RESULT_MAX_CHARS = 12_000;
export const MAX_CONNECTORS = 30;

type Row = {
  connector_id: string;
  catalog_id: string | null;
  name: string;
  slug: string;
  url: string;
  auth: string;
  token: string | null;
  approval: string;
  everyone: number;
  chief: number;
  status: string;
  last_error: string | null;
  tools: string | null;
  tools_at: string | null;
  server: string | null;
  calls: number;
  last_call_at: string | null;
  created_at: string;
  updated_at: string;
};
type GrantRow = { grant_id: string; connector_id: string; tool: string; scope: string; project_id: string | null; subject: string | null; created_at: string; uses: number };

/** What an agent is given: the connectors it may use and their tools. */
export interface ConnectorKit {
  connectorId: string;
  name: string;
  slug: string;
  tools: { name: string; title?: string; description: string; inputSchema: Record<string, unknown>; needsApproval: boolean }[];
}

export interface ConnectorCallRequest {
  connectorId: string;
  tool: string;
  args: Record<string, unknown>;
  /** A persona id, or 'chief'. */
  subject: string;
  projectId?: string;
  stepId?: string;
}

export type ConnectorCallResult =
  | { status: 'ok'; content: string; isError: boolean; summary: string }
  | { status: 'needs_approval'; ask: ConnectorAsk }
  | { status: 'error'; message: string };

export interface ConnectorGrantRequest {
  connectorId: string;
  tool: string;
  scope: ConnectorScope;
  subject: string;
  projectId?: string;
}

export class ConnectorError extends Error {
  constructor(
    message: string,
    readonly code: 'bad_request' | 'not_found' | 'conflict' | 'unavailable',
  ) {
    super(message);
  }
}

export interface ConnectorStoreDeps {
  sql: SqlStorage;
  env: Env;
  now: () => number;
  /** Coworkers granted a connector one by one (AgentConfig.connectors). */
  grantedTo(connectorId: string): string[];
  /** The daily cap on calls: false when spent. */
  take(): boolean;
  /** Inc 6: the owner's autonomy level for changes in connected apps (a write waits for the OK at ask or propose). */
  writeLevel?(): Promise<'ask' | 'propose' | 'act_report' | 'act_quiet'>;
  /** Inc 6: record a write in the audit trail. */
  audit?(e: { actor: string; summary: string; target: string }): void;
  fetchImpl?: typeof fetch;
  resolve?: Resolver | null;
}

const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
const json = <T>(s: string | null, fallback: T): T => {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};

export function needsApproval(approval: ConnectorApproval, tool: Pick<McpTool, 'readOnly'>, writeLevel?: string): boolean {
  // The connector's own setting, or the autonomy dial for writes (Admin → Autonomy): the stricter wins.
  return approval === 'ask' || (!tool.readOnly && (approval === 'writes' || writeLevel === 'ask' || writeLevel === 'propose'));
}

export class ConnectorStore {
  private readonly iso: () => string;

  constructor(private readonly d: ConnectorStoreDeps) {
    for (const stmt of CONNECTOR_SCHEMA) d.sql.exec(stmt);
    this.iso = () => new Date(d.now()).toISOString();
  }

  catalog(): ConnectorCatalogEntry[] {
    return connectorCatalog(this.d.env);
  }

  canStoreKeys(): boolean {
    return connectorSecret(this.d.env) !== null;
  }

  list(): ConnectorView[] {
    return this.rows().map((r) => this.view(r));
  }

  get(connectorId: string): ConnectorView | null {
    const r = this.row(connectorId);
    return r ? this.view(r) : null;
  }

  /** Connect a catalog entry or a custom server. The caller tests it next. */
  async add(body: ConnectorCreate): Promise<ConnectorView> {
    if (this.rows().length >= MAX_CONNECTORS) throw new ConnectorError(`At most ${MAX_CONNECTORS} connectors.`, 'conflict');
    const entry = body.catalogId ? this.catalog().find((c) => c.id === body.catalogId) : undefined;
    if (body.catalogId && !entry) throw new ConnectorError('No such connector in the catalog.', 'not_found');
    const name = (body.name ?? entry?.name ?? '').trim().slice(0, CONNECTOR_NAME_MAX);
    const url = (entry?.url ?? body.url ?? '').trim();
    if (!name) throw new ConnectorError('Give the connector a name.', 'bad_request');
    if (!entry) {
      let u: URL;
      try {
        u = new URL(url);
      } catch {
        throw new ConnectorError('That is not a valid URL.', 'bad_request');
      }
      if (u.protocol !== 'https:') throw new ConnectorError('Connectors must use https.', 'bad_request');
      if (u.username || u.password) throw new ConnectorError('Put the key in the key field, not in the URL.', 'bad_request');
    }
    if (entry && this.rows().some((r) => r.catalog_id === entry.id)) throw new ConnectorError(`${entry.name} is already connected.`, 'conflict');
    const approval = body.approval ?? 'ask';
    if (!CONNECTOR_APPROVALS.includes(approval)) throw new ConnectorError('Approval is ask, writes or never.', 'bad_request');
    const id = newId('cn');
    const token = await this.seal(id, body.token);
    const auth = entry?.auth ?? (token ? 'token' : 'none');
    const at = this.iso();
    this.d.sql.exec(
      `INSERT INTO connectors (connector_id, catalog_id, name, slug, url, auth, token, approval, everyone, chief, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, entry?.id ?? null, name, this.freeSlug(name), url, auth, token, approval, body.everyone === false ? 0 : 1, body.chief === false ? 0 : 1,
      auth !== 'none' && !token ? 'needs_key' : 'untested', at, at,
    );
    return this.view(this.row(id)!);
  }

  async patch(connectorId: string, p: ConnectorPatch): Promise<ConnectorView> {
    const r = this.row(connectorId);
    if (!r) throw new ConnectorError('No such connector.', 'not_found');
    const sets: string[] = [];
    const vals: unknown[] = [];
    const set = (col: string, v: unknown) => {
      sets.push(`${col} = ?`);
      vals.push(v);
    };
    if (p.name !== undefined) {
      const name = p.name.trim().slice(0, CONNECTOR_NAME_MAX);
      if (!name) throw new ConnectorError('Give the connector a name.', 'bad_request');
      set('name', name);
    }
    if (p.approval !== undefined) {
      if (!CONNECTOR_APPROVALS.includes(p.approval)) throw new ConnectorError('Approval is ask, writes or never.', 'bad_request');
      set('approval', p.approval);
    }
    if (p.everyone !== undefined) set('everyone', p.everyone ? 1 : 0);
    if (p.chief !== undefined) set('chief', p.chief ? 1 : 0);
    if (p.token !== undefined) {
      const token = p.token === null ? null : await this.seal(connectorId, p.token);
      set('token', token);
      set('status', r.auth !== 'none' && !token ? 'needs_key' : 'untested');
      set('last_error', null);
      forgetSession(connectorId);
    }
    if (!sets.length) return this.view(r);
    set('updated_at', this.iso());
    this.d.sql.exec(`UPDATE connectors SET ${sets.join(', ')} WHERE connector_id = ?`, ...vals, connectorId);
    return this.view(this.row(connectorId)!);
  }

  remove(connectorId: string): boolean {
    if (!this.row(connectorId)) return false;
    this.d.sql.exec('DELETE FROM connectors WHERE connector_id = ?', connectorId);
    this.d.sql.exec('DELETE FROM connector_grants WHERE connector_id = ?', connectorId);
    forgetSession(connectorId);
    return true;
  }

  revokeGrant(connectorId: string, grantId: string): boolean {
    const n = this.d.sql.exec('DELETE FROM connector_grants WHERE connector_id = ? AND grant_id = ? RETURNING grant_id', connectorId, grantId).toArray().length;
    return n > 0;
  }

  /** Connect afresh and list the tools: the owner's Test, and the check right after connecting. */
  async test(connectorId: string): Promise<ConnectorView> {
    const r = this.row(connectorId);
    if (!r) throw new ConnectorError('No such connector.', 'not_found');
    try {
      const { tools, server } = await (await this.client(r)).test();
      this.d.sql.exec(
        `UPDATE connectors SET status = 'ready', last_error = NULL, tools = ?, tools_at = ?, server = ?, updated_at = ? WHERE connector_id = ?`,
        JSON.stringify(tools), this.iso(), JSON.stringify(server), this.iso(), connectorId,
      );
    } catch (err) {
      const message = err instanceof McpError || err instanceof ConnectorError ? err.message : 'The connector could not be reached.';
      const status = err instanceof McpError && err.kind === 'auth' ? 'needs_key' : 'error';
      this.d.sql.exec('UPDATE connectors SET status = ?, last_error = ?, updated_at = ? WHERE connector_id = ?', status, message, this.iso(), connectorId);
    }
    return this.view(this.row(connectorId)!);
  }

  /** The connectors a coworker (or the Chief) may use now, with their tools. */
  kitsFor(subject: string, granted: readonly string[] = []): ConnectorKit[] {
    return this.rows()
      .filter((r) => r.status === 'ready' && this.allowed(r, subject, granted))
      .map((r) => {
        const approval = r.approval as ConnectorApproval;
        return {
          connectorId: r.connector_id,
          name: r.name,
          slug: r.slug,
          tools: this.toolsOf(r).map((t) => ({ name: t.name, ...(t.title ? { title: t.title } : {}), description: t.description, inputSchema: t.inputSchema, needsApproval: needsApproval(approval, t) })),
        };
      })
      .filter((k) => k.tools.length > 0);
  }

  /** A connector's tools, only the read-only ones when its catalog entry is read-only (HubSpot). */
  private toolsOf(r: Row): McpTool[] {
    const tools = json<McpTool[]>(r.tools, []);
    const entry = r.catalog_id ? this.catalog().find((c) => c.id === r.catalog_id) : undefined;
    return entry?.readOnly ? tools.filter((t) => t.readOnly) : tools;
  }

  /** Run one tool call: access, the owner's OK (or a grant that covers it), the daily cap, then the server. */
  async call(req: ConnectorCallRequest, granted: readonly string[] = []): Promise<ConnectorCallResult> {
    const r = this.row(req.connectorId);
    if (!r) return { status: 'error', message: 'That connector is no longer connected.' };
    if (!this.allowed(r, req.subject, granted)) return { status: 'error', message: `You may not use ${r.name}.` };
    if (r.status === 'needs_key') return { status: 'error', message: `${r.name} needs its key before it can be used.` };
    const tool = this.toolsOf(r).find((t) => t.name === req.tool);
    if (!tool) return { status: 'error', message: json<McpTool[]>(r.tools, []).some((t) => t.name === req.tool) ? `${r.name} is read-only here: ${req.tool} changes things.` : `${r.name} has no tool called ${req.tool}.` };
    const args = req.args && typeof req.args === 'object' && !Array.isArray(req.args) ? req.args : {};
    const writeLevel = tool.readOnly ? undefined : await this.d.writeLevel?.().catch(() => 'propose' as const);
    if (needsApproval(r.approval as ConnectorApproval, tool, writeLevel)) {
      const grant = this.grantFor(r.connector_id, tool.name, req.subject, req.projectId);
      if (!grant) return { status: 'needs_approval', ask: { connectorId: r.connector_id, name: r.name, tool: tool.name, args: clipText(JSON.stringify(args, null, 2), 3000), subject: req.subject } };
      if (grant.scope === 'once') this.d.sql.exec('DELETE FROM connector_grants WHERE grant_id = ?', grant.grant_id);
      else this.d.sql.exec('UPDATE connector_grants SET uses = uses + 1 WHERE grant_id = ?', grant.grant_id);
    }
    if (!this.d.take()) return { status: 'error', message: 'The daily limit on connector calls is spent; it resets at midnight UTC.' };
    this.d.sql.exec('UPDATE connectors SET calls = calls + 1, last_call_at = ? WHERE connector_id = ?', this.iso(), r.connector_id);
    try {
      const out = await (await this.client(r)).callTool(tool.name, args);
      const raw = out.text || (out.structured !== undefined ? JSON.stringify(out.structured, null, 2) : '(no content)');
      const text = raw.length > RESULT_MAX_CHARS ? `${raw.slice(0, RESULT_MAX_CHARS)}\n[… cut: ${raw.length - RESULT_MAX_CHARS} more characters]` : raw;
      if (!tool.readOnly && !out.isError) this.d.audit?.({ actor: req.subject, summary: `Used ${r.name} → ${tool.title ?? tool.name} (a change in ${r.name}; undo it there if needed)`, target: r.name });
      return { status: 'ok', content: wrapExternal(`connector ${r.name} → ${tool.name}`, text), isError: out.isError, summary: `${out.isError ? 'Tried' : 'Used'} ${r.name} → ${tool.title ?? tool.name}` };
    } catch (err) {
      const message = err instanceof McpError ? err.message : 'The connector could not be reached.';
      if (err instanceof McpError && err.kind === 'auth') this.d.sql.exec(`UPDATE connectors SET status = 'needs_key', last_error = ? WHERE connector_id = ?`, message, r.connector_id);
      return { status: 'error', message: `${r.name}: ${message}` };
    }
  }

  /** Record the owner's OK from a raised hand. */
  grant(req: ConnectorGrantRequest): void {
    if (!this.row(req.connectorId)) return;
    if (req.scope !== 'once') {
      const dup = this.d.sql
        .exec<{ grant_id: string }>('SELECT grant_id FROM connector_grants WHERE connector_id = ? AND tool = ? AND scope = ? AND COALESCE(project_id, \'\') = ?', req.connectorId, req.tool, req.scope, req.scope === 'project' ? (req.projectId ?? '') : '')
        .toArray()[0];
      if (dup) return;
    }
    this.d.sql.exec(
      'INSERT INTO connector_grants (grant_id, connector_id, tool, scope, project_id, subject, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      newId('cg'), req.connectorId, req.tool, req.scope, req.scope === 'always' ? null : (req.projectId ?? null), req.scope === 'once' ? req.subject : null, this.iso(),
    );
  }

  // ── internals ────────────────────────────────────────────────────────────────────

  private rows(): Row[] {
    return this.d.sql.exec<Row>('SELECT * FROM connectors ORDER BY created_at').toArray();
  }

  private row(connectorId: string): Row | undefined {
    return this.d.sql.exec<Row>('SELECT * FROM connectors WHERE connector_id = ?', connectorId).toArray()[0];
  }

  private allowed(r: Row, subject: string, granted: readonly string[]): boolean {
    if (subject === 'chief') return r.chief === 1;
    return r.everyone === 1 || granted.includes(r.connector_id) || this.d.grantedTo(r.connector_id).includes(subject);
  }

  private grantFor(connectorId: string, tool: string, subject: string, projectId?: string): GrantRow | undefined {
    const grants = this.d.sql.exec<GrantRow>('SELECT * FROM connector_grants WHERE connector_id = ? AND tool = ? ORDER BY created_at', connectorId, tool).toArray();
    return (
      grants.find((g) => g.scope === 'always') ??
      grants.find((g) => g.scope === 'project' && !!projectId && g.project_id === projectId) ??
      grants.find((g) => g.scope === 'once' && g.subject === subject && (g.project_id ?? '') === (projectId ?? ''))
    );
  }

  private freeSlug(name: string): string {
    const base = slugOf(name);
    const taken = new Set(this.rows().map((r) => r.slug));
    if (!taken.has(base)) return base;
    for (let i = 2; ; i++) if (!taken.has(`${base}_${i}`)) return `${base}_${i}`;
  }

  private async seal(connectorId: string, token: string | undefined): Promise<string | null> {
    const t = (token ?? '').trim();
    if (!t) return null;
    if (t.length > CONNECTOR_TOKEN_MAX) throw new ConnectorError('That key is too long.', 'bad_request');
    if (/[\r\n]/.test(t)) throw new ConnectorError('A key is one line.', 'bad_request');
    const secret = connectorSecret(this.d.env);
    if (!secret) throw new ConnectorError('Keys cannot be stored until the CONNECTOR_SECRET secret is set.', 'unavailable');
    return sealToken(secret, connectorId, t);
  }

  private async client(r: Row): Promise<McpClient> {
    const demo = r.catalog_id !== null && this.catalog().some((c) => c.id === r.catalog_id && c.demo) && mocksOn(this.d.env);
    let token: string | null = null;
    if (r.token) {
      const secret = connectorSecret(this.d.env);
      token = secret ? await openToken(secret, r.connector_id, r.token) : null;
      if (!token) throw new ConnectorError('The stored key cannot be opened (the secret changed); paste the key again.', 'unavailable');
    }
    return new McpClient(
      { key: r.connector_id, url: r.url, token },
      demo ? { fetchImpl: demoNotebookFetch(this.d.sql, this.iso), resolve: null, trusted: true } : { ...(this.d.fetchImpl ? { fetchImpl: this.d.fetchImpl } : {}), ...(this.d.resolve !== undefined ? { resolve: this.d.resolve } : {}) },
    );
  }

  private view(r: Row): ConnectorView {
    const approval = r.approval as ConnectorApproval;
    const tools: ConnectorToolView[] = json<McpTool[]>(r.tools, []).map((t) => ({
      name: t.name,
      ...(t.title ? { title: t.title } : {}),
      description: t.description,
      inputSchema: t.inputSchema,
      ...(t.readOnly ? { readOnly: true } : {}),
      ...(t.destructive ? { destructive: true } : {}),
      needsApproval: needsApproval(approval, t),
    }));
    const grants: ConnectorGrantView[] = this.d.sql
      .exec<GrantRow>(`SELECT * FROM connector_grants WHERE connector_id = ? AND scope != 'once' ORDER BY created_at`, r.connector_id)
      .toArray()
      .map((g) => ({ grantId: g.grant_id, tool: g.tool, scope: g.scope as 'project' | 'always', ...(g.project_id ? { projectId: g.project_id } : {}), createdAt: g.created_at, uses: Number(g.uses) }));
    return {
      connectorId: r.connector_id,
      ...(r.catalog_id ? { catalogId: r.catalog_id } : {}),
      name: r.name,
      slug: r.slug,
      url: r.url,
      auth: r.auth as ConnectorView['auth'],
      hasKey: !!r.token,
      approval,
      everyone: r.everyone === 1,
      chief: r.chief === 1,
      grantedTo: r.everyone === 1 ? [] : this.d.grantedTo(r.connector_id),
      status: r.status as ConnectorView['status'],
      ...(r.last_error ? { lastError: r.last_error } : {}),
      tools,
      ...(r.tools_at ? { toolsAt: r.tools_at } : {}),
      ...(r.server ? { server: json(r.server, {}) } : {}),
      grants,
      calls: Number(r.calls),
      ...(r.last_call_at ? { lastCallAt: r.last_call_at } : {}),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }
}
