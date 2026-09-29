// In-process fakes for Worker tests (after biz-bot worker/test/fake-cloud.mjs): DO state with real SQLite
// (node:sqlite), a DO namespace that instantiates classes in-process, D1 over SQLite, and R2 in memory.
// Integrator-owned; builders import it from their *.test.ts files.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import type { Env } from '../src/env';

type SqlValue = string | number | bigint | null | ArrayBuffer | Uint8Array;
type Row = Record<string, SqlValue>;

/** Split SQL into statements, respecting quotes and comments (good enough for migrations and DO schemas). */
export function splitSql(sql: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: string | null = null;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]!;
    if (!quote && ch === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if (ch === ';') {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const toSqlite = (v: unknown): SqlValue => (v instanceof ArrayBuffer ? new Uint8Array(v) : typeof v === 'boolean' ? Number(v) : (v as SqlValue));
const fromSqlite = (row: Record<string, unknown>): Row => {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) out[k] = v instanceof Uint8Array ? (v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) as ArrayBuffer) : (v as SqlValue);
  return out;
};

/** `ctx.storage.sql` over node:sqlite. */
export class FakeSqlStorage {
  constructor(readonly db: DatabaseSync = new DatabaseSync(':memory:')) {}
  exec<T extends Row = Row>(query: string, ...bindings: unknown[]) {
    const statements = splitSql(query);
    const last = statements.pop() ?? '';
    for (const s of statements) this.db.exec(s);
    const stmt: StatementSync = this.db.prepare(last);
    const params = bindings.map(toSqlite) as never[];
    const columns = (stmt.columns?.() ?? []).map((c: { name: string }) => c.name);
    let rows: T[];
    let written = 0;
    if (columns.length) rows = (stmt.all(...params) as Record<string, unknown>[]).map(fromSqlite) as T[];
    else {
      written = Number(stmt.run(...params).changes);
      rows = [];
    }
    return {
      columnNames: columns,
      rowsRead: rows.length,
      rowsWritten: written,
      toArray: () => rows,
      one: () => {
        if (rows.length !== 1) throw new Error(`Expected exactly one row, got ${rows.length}`);
        return rows[0]!;
      },
      raw: () => rows.map((r) => columns.map((c) => r[c])),
      [Symbol.iterator]: () => rows[Symbol.iterator](),
    };
  }
  get databaseSize(): number {
    return 0;
  }
}

export class FakeDurableObjectState {
  readonly storage: FakeStorage;
  readonly waiting: Promise<unknown>[] = [];
  readonly id: { toString(): string; name: string; equals(o: { toString(): string }): boolean };
  constructor(name: string) {
    this.id = { name, toString: () => `fake-id:${name}`, equals: (o) => o.toString() === `fake-id:${name}` };
    this.storage = new FakeStorage();
  }
  waitUntil(p: Promise<unknown>): void {
    this.waiting.push(p.catch(() => undefined));
  }
  async blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }
  acceptWebSocket(): void {
    throw new Error('WebSockets are not available in the fake DO state; test sockets with `pnpm e2e`.');
  }
  getWebSockets(): WebSocket[] {
    return [];
  }
  /** Await everything passed to waitUntil (repeatedly, since work can schedule more work). */
  async drain(): Promise<void> {
    while (this.waiting.length) await Promise.all(this.waiting.splice(0));
  }
}

export class FakeStorage {
  readonly sql = new FakeSqlStorage();
  private kv = new Map<string, unknown>();
  alarmAt: number | null = null;
  async get<T>(key: string | string[]): Promise<T | undefined | Map<string, T>> {
    if (Array.isArray(key)) return new Map(key.filter((k) => this.kv.has(k)).map((k) => [k, structuredClone(this.kv.get(k)) as T]));
    return structuredClone(this.kv.get(key)) as T | undefined;
  }
  async put(key: string | Record<string, unknown>, value?: unknown): Promise<void> {
    if (typeof key === 'string') this.kv.set(key, structuredClone(value));
    else for (const [k, v] of Object.entries(key)) this.kv.set(k, structuredClone(v));
  }
  async delete(key: string | string[]): Promise<boolean | number> {
    if (Array.isArray(key)) return key.filter((k) => this.kv.delete(k)).length;
    return this.kv.delete(key);
  }
  async list<T>(opts: { prefix?: string } = {}): Promise<Map<string, T>> {
    return new Map([...this.kv.entries()].filter(([k]) => !opts.prefix || k.startsWith(opts.prefix)).sort(([a], [b]) => a.localeCompare(b)) as [string, T][]);
  }
  async deleteAll(): Promise<void> {
    this.kv.clear();
  }
  async getAlarm(): Promise<number | null> {
    return this.alarmAt;
  }
  async setAlarm(at: number | Date): Promise<void> {
    this.alarmAt = typeof at === 'number' ? at : at.getTime();
  }
  async deleteAlarm(): Promise<void> {
    this.alarmAt = null;
  }
  transactionSync<T>(fn: () => T): T {
    this.sql.db.exec('SAVEPOINT tx');
    try {
      const r = fn();
      this.sql.db.exec('RELEASE tx');
      return r;
    } catch (err) {
      this.sql.db.exec('ROLLBACK TO tx');
      this.sql.db.exec('RELEASE tx');
      throw err;
    }
  }
  async transaction<T>(fn: (txn: FakeStorage) => Promise<T>): Promise<T> {
    return fn(this);
  }
}

type DOClass<T> = new (ctx: DurableObjectState, env: Env) => T;

/** A DurableObjectNamespace that instantiates the class in-process, one instance per name. */
export class FakeNamespace<T> {
  readonly instances = new Map<string, { instance: T; state: FakeDurableObjectState }>();
  private cls: DOClass<T> | null = null;
  env!: Env;
  bind(cls: DOClass<T>, env: Env): this {
    this.cls = cls;
    this.env = env;
    return this;
  }
  idFromName(name: string) {
    return { name, toString: () => `fake-id:${name}`, equals: (o: { toString(): string }) => o.toString() === `fake-id:${name}` };
  }
  get(id: { name?: string; toString(): string }): T {
    const name = id.name ?? id.toString();
    let entry = this.instances.get(name);
    if (!entry) {
      if (!this.cls) throw new Error('FakeNamespace not bound to a class');
      const state = new FakeDurableObjectState(name);
      entry = { instance: new this.cls(state as unknown as DurableObjectState, this.env), state };
      this.instances.set(name, entry);
    }
    return entry.instance;
  }
  getByName(name: string): T {
    return this.get(this.idFromName(name));
  }
  /** The fake state behind a named instance (drain waitUntil, inspect alarms and SQL). */
  state(name: string): FakeDurableObjectState {
    this.getByName(name);
    return this.instances.get(name)!.state;
  }
}

/** D1Database over node:sqlite (prepare/bind/first/all/run/raw, batch, exec). */
export class FakeD1 {
  readonly db = new DatabaseSync(':memory:');
  prepare(sql: string) {
    const db = this.db;
    const make = (params: unknown[]) => ({
      bind: (...values: unknown[]) => make(values),
      async all<T = Row>() {
        const stmt = db.prepare(sql);
        const results = (stmt.all(...(params.map(toSqlite) as never[])) as Record<string, unknown>[]).map(fromSqlite) as T[];
        return { results, success: true, meta: {} };
      },
      async first<T = Row>(col?: string) {
        const row = (db.prepare(sql).get(...(params.map(toSqlite) as never[])) as Record<string, unknown> | undefined) ?? null;
        if (!row) return null;
        const r = fromSqlite(row);
        return (col ? r[col] : r) as T;
      },
      async run() {
        const res = db.prepare(sql).run(...(params.map(toSqlite) as never[]));
        return { success: true, results: [], meta: { changes: Number(res.changes), last_row_id: Number(res.lastInsertRowid) } };
      },
      async raw<T = unknown[]>() {
        const stmt = db.prepare(sql);
        const cols = (stmt.columns?.() ?? []).map((c: { name: string }) => c.name);
        return (stmt.all(...(params.map(toSqlite) as never[])) as Record<string, unknown>[]).map((r) => cols.map((c) => r[c])) as T[];
      },
    });
    return make([]);
  }
  async batch(statements: { run(): Promise<unknown> }[]) {
    const out = [];
    for (const s of statements) out.push(await s.run());
    return out;
  }
  async exec(sql: string) {
    for (const s of splitSql(sql)) this.db.exec(s);
    return { count: 1, duration: 0 };
  }
}

/** Apply apps/worker/migrations/*.sql in order to a FakeD1. */
export async function applyMigrations(d1: FakeD1, dir = join(import.meta.dirname, '..', 'migrations')): Promise<string[]> {
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) await d1.exec(readFileSync(join(dir, f), 'utf8'));
  return files;
}

interface R2Stored {
  data: ArrayBuffer;
  httpMetadata: { contentType?: string };
  customMetadata: Record<string, string>;
  uploaded: Date;
}

/** R2Bucket in memory (put/get/head/delete/list). */
export class FakeR2 {
  readonly objects = new Map<string, R2Stored>();
  async put(key: string, value: ArrayBuffer | ArrayBufferView | string | Blob | ReadableStream | null, opts: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> } = {}) {
    const data = await new Response(value as BodyInit | null).arrayBuffer();
    const stored: R2Stored = { data, httpMetadata: opts.httpMetadata ?? {}, customMetadata: opts.customMetadata ?? {}, uploaded: new Date() };
    this.objects.set(key, stored);
    return this.meta(key, stored);
  }
  async get(key: string) {
    const o = this.objects.get(key);
    if (!o) return null;
    return {
      ...this.meta(key, o),
      body: new Response(o.data).body,
      arrayBuffer: async () => o.data.slice(0),
      text: async () => new TextDecoder().decode(o.data),
      json: async <T>() => JSON.parse(new TextDecoder().decode(o.data)) as T,
    };
  }
  async head(key: string) {
    const o = this.objects.get(key);
    return o ? this.meta(key, o) : null;
  }
  async delete(keys: string | string[]) {
    for (const k of Array.isArray(keys) ? keys : [keys]) this.objects.delete(k);
  }
  async list(opts: { prefix?: string } = {}) {
    const objects = [...this.objects.entries()].filter(([k]) => !opts.prefix || k.startsWith(opts.prefix)).map(([k, o]) => this.meta(k, o));
    return { objects, truncated: false, delimitedPrefixes: [] };
  }
  private meta(key: string, o: R2Stored) {
    return {
      key,
      size: o.data.byteLength,
      uploaded: o.uploaded,
      httpMetadata: o.httpMetadata,
      customMetadata: o.customMetadata,
      writeHttpMetadata: (h: Headers) => {
        if (o.httpMetadata.contentType) h.set('content-type', o.httpMetadata.contentType);
      },
    };
  }
}

export interface TestEnv {
  env: Env;
  d1: FakeD1;
  r2: FakeR2;
  namespaces: { WORKSPACE: FakeNamespace<unknown>; PROJECT: FakeNamespace<unknown>; ROOM: FakeNamespace<unknown>; RUN: FakeNamespace<unknown> };
  ctx: ExecutionContext & { drain(): Promise<void> };
}

/**
 * A full Env with in-process DOs, D1 (migrated) and R2. Keyless by default (ENABLE_MOCK=true,
 * DEFAULT_CHAT=mock, MOCK_DELAY_MS=0); pass overrides for provider env.
 */
export async function createTestEnv(overrides: Partial<Env> = {}): Promise<TestEnv> {
  const { WorkspaceDO } = await import('../src/workspace/workspace-do');
  const { ProjectDO } = await import('../src/jobs/project-do');
  const { RoomDO } = await import('../src/rooms/room-do');
  const { RunDO } = await import('../src/runs/run-do');
  const d1 = new FakeD1();
  await applyMigrations(d1);
  const r2 = new FakeR2();
  const namespaces = { WORKSPACE: new FakeNamespace(), PROJECT: new FakeNamespace(), ROOM: new FakeNamespace(), RUN: new FakeNamespace() };
  const env = {
    WORKSPACE_ID: 'local',
    APP_VERSION: 'test',
    ENABLE_MOCK: 'true',
    DEFAULT_CHAT: 'mock',
    MOCK_DELAY_MS: '0',
    DB: d1 as unknown as D1Database,
    BLOBS: r2 as unknown as R2Bucket,
    WORKSPACE: namespaces.WORKSPACE,
    PROJECT: namespaces.PROJECT,
    ROOM: namespaces.ROOM,
    RUN: namespaces.RUN,
    ...overrides,
  } as unknown as Env;
  namespaces.WORKSPACE.bind(WorkspaceDO as never, env);
  namespaces.PROJECT.bind(ProjectDO as never, env);
  namespaces.ROOM.bind(RoomDO as never, env);
  namespaces.RUN.bind(RunDO as never, env);
  const waiting: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (p: Promise<unknown>) => void waiting.push(p.catch(() => undefined)),
    passThroughOnException: () => {},
    props: {},
    async drain() {
      while (waiting.length) await Promise.all(waiting.splice(0));
      for (const ns of Object.values(namespaces)) for (const { state } of ns.instances.values()) await state.drain();
    },
  } as unknown as TestEnv['ctx'];
  return { env, d1, r2, namespaces, ctx };
}

/**
 * A hibernatable feed socket (Inc 0.5, additive): records what the server sends and keeps its attachment
 * (`serializeAttachment` / `deserializeAttachment`, structured-cloned like the runtime), so a test can hand the
 * same socket to a revived Durable Object as the hibernation API does.
 */
export class FakeWebSocket {
  readonly sent: string[] = [];
  private attachment: unknown = null;
  closed = false;
  send(message: string): void {
    if (this.closed) throw new Error('socket closed');
    this.sent.push(message);
  }
  serializeAttachment(value: unknown): void {
    this.attachment = structuredClone(value);
  }
  deserializeAttachment(): unknown {
    return structuredClone(this.attachment);
  }
  close(): void {
    this.closed = true;
  }
  /** Parsed JSON messages (frames and pongs), oldest first. */
  messages<T = Record<string, unknown>>(): T[] {
    return this.sent.map((m) => JSON.parse(m) as T);
  }
}
