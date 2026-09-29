// The workspace's memory (Inc 4), in the WorkspaceDO: short durable items (facts, preferences, decisions, people,
// clients, rules) and file excerpts, each with a scope (the workspace, a project, a coworker) and where it came from.
// Search is hybrid (recall.ts): BM25 over the words and cosine over embeddings (when an embedding provider is set up;
// items are embedded lazily), fused by rank. Near-duplicates are merged instead of stored twice.
import { MEMORY_KINDS, MEMORY_TEXT_MAX, type MemoryItem, type MemoryKind, type MemoryScope, type MemorySource, type Recalled } from '@headcount/protocol/ext/memory';
import { bm25, cosine, rrf, similar, tokens, type Doc } from './recall';

export const MEMORY_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS memories (
     memory_id TEXT PRIMARY KEY, text TEXT NOT NULL, kind TEXT NOT NULL, scope TEXT NOT NULL, source TEXT NOT NULL,
     source_label TEXT, source_ref TEXT, pinned INTEGER NOT NULL DEFAULT 0, uses INTEGER NOT NULL DEFAULT 0,
     last_used_at TEXT, embedding TEXT, embed_model TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS memories_scope ON memories (scope, kind)`,
  `CREATE INDEX IF NOT EXISTS memories_ref ON memories (source_ref)`,
];

/** Excerpts from files can be longer than a remembered sentence. */
const EXCERPT_MAX = 1200;
const EMBED_BATCH = 64;
/** Items embedded per search at most (the rest wait for the next). */
const EMBED_PER_SEARCH = 256;
/** A match by meaning alone must be at least this close. */
const MIN_COSINE = 0.35;

type Row = {
  memory_id: string;
  text: string;
  kind: string;
  scope: string;
  source: string;
  source_label: string | null;
  source_ref: string | null;
  pinned: number;
  uses: number;
  last_used_at: string | null;
  embedding: string | null;
  embed_model: string | null;
  created_at: string;
  updated_at: string;
};

export type Embed = (texts: string[]) => Promise<{ vectors: number[][]; model: string } | null>;

export interface NewMemory {
  text: string;
  kind: MemoryKind;
  scope?: MemoryScope;
  source: MemorySource;
  sourceLabel?: string;
  sourceRef?: string;
  pinned?: boolean;
}

export interface SearchOptions {
  /** Scopes searched (default: the workspace only). */
  scopes?: readonly MemoryScope[];
  k?: number;
  kinds?: readonly MemoryKind[];
  /** Count the results as used (recall), not just shown (search). */
  use?: boolean;
}

const newId = () => `mem_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;

export class MemoryStore {
  /** Tokens per memory, kept while the text is unchanged. */
  private readonly tokenCache = new Map<string, { text: string; tokens: string[] }>();

  constructor(
    private readonly sql: SqlStorage,
    private readonly deps: { now(): number; embed: Embed },
  ) {
    for (const stmt of MEMORY_SCHEMA) sql.exec(stmt);
  }

  private iso(): string {
    return new Date(this.deps.now()).toISOString();
  }

  list(opts: { scope?: MemoryScope; kind?: MemoryKind; excerpts?: boolean; limit?: number } = {}): MemoryItem[] {
    const where: string[] = [];
    const args: unknown[] = [];
    if (opts.scope) {
      where.push('scope = ?');
      args.push(opts.scope);
    }
    if (opts.kind) {
      where.push('kind = ?');
      args.push(opts.kind);
    } else if (!opts.excerpts) where.push(`kind != 'excerpt'`);
    return this.sql
      .exec<Row>(`SELECT * FROM memories ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY pinned DESC, updated_at DESC LIMIT ?`, ...args, opts.limit ?? 500)
      .toArray()
      .map(toItem);
  }

  /** Every scope that holds a memory (the Memory page searches them all). */
  scopes(): MemoryScope[] {
    return this.sql.exec<{ scope: string }>('SELECT DISTINCT scope FROM memories').toArray().map((r) => r.scope);
  }

  get(memoryId: string): MemoryItem | null {
    const r = this.row(memoryId);
    return r ? toItem(r) : null;
  }

  /** Remember something; a near-duplicate in the same scope is refreshed instead (and returned). */
  add(m: NewMemory): { item: MemoryItem; merged: boolean } {
    const text = m.text.replace(/\s+/g, ' ').trim().slice(0, m.kind === 'excerpt' ? EXCERPT_MAX : MEMORY_TEXT_MAX);
    const kind = MEMORY_KINDS.includes(m.kind) ? m.kind : 'fact';
    const scope = m.scope ?? 'workspace';
    const at = this.iso();
    if (kind !== 'excerpt') {
      const same = this.sql.exec<Row>(`SELECT * FROM memories WHERE scope = ? AND kind != 'excerpt'`, scope).toArray().find((r) => similar(r.text, text));
      if (same) {
        // A newer wording of the same thing replaces the older one; the owner's own words are never reworded by a
        // distillation.
        if (same.source === 'owner' && m.source !== 'owner') this.sql.exec('UPDATE memories SET updated_at = ? WHERE memory_id = ?', at, same.memory_id);
        else this.sql.exec('UPDATE memories SET text = ?, kind = ?, updated_at = ?, embedding = CASE WHEN text = ? THEN embedding ELSE NULL END WHERE memory_id = ?', text, kind, at, text, same.memory_id);
        return { item: toItem(this.row(same.memory_id)!), merged: true };
      }
    }
    const id = newId();
    this.sql.exec(
      'INSERT INTO memories (memory_id, text, kind, scope, source, source_label, source_ref, pinned, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id, text, kind, scope, m.source, m.sourceLabel ?? null, m.sourceRef ?? null, m.pinned ? 1 : 0, at, at,
    );
    return { item: toItem(this.row(id)!), merged: false };
  }

  patch(memoryId: string, p: { text?: string; kind?: MemoryKind; pinned?: boolean }): MemoryItem | null {
    const r = this.row(memoryId);
    if (!r) return null;
    const text = p.text !== undefined ? p.text.replace(/\s+/g, ' ').trim().slice(0, r.kind === 'excerpt' ? EXCERPT_MAX : MEMORY_TEXT_MAX) : r.text;
    const kind = p.kind && MEMORY_KINDS.includes(p.kind) ? p.kind : r.kind;
    const pinned = p.pinned === undefined ? r.pinned : p.pinned ? 1 : 0;
    this.sql.exec(
      'UPDATE memories SET text = ?, kind = ?, pinned = ?, updated_at = ?, embedding = CASE WHEN ? THEN NULL ELSE embedding END WHERE memory_id = ?',
      text, kind, pinned, this.iso(), text !== r.text ? 1 : 0, memoryId,
    );
    return toItem(this.row(memoryId)!);
  }

  remove(memoryId: string): boolean {
    return this.sql.exec('DELETE FROM memories WHERE memory_id = ? RETURNING memory_id', memoryId).toArray().length > 0;
  }

  /** Forget everything that came from one source (a deleted file's excerpts). */
  removeByRef(sourceRef: string): number {
    return this.sql.exec('DELETE FROM memories WHERE source_ref = ? RETURNING memory_id', sourceRef).toArray().length;
  }

  /** Hybrid search: BM25 and meaning, fused. Results carry their fused score. */
  async search(query: string, opts: SearchOptions = {}): Promise<(MemoryItem & { score: number })[]> {
    const scopes = opts.scopes?.length ? opts.scopes : ['workspace'];
    const rows = this.sql
      .exec<Row>(`SELECT * FROM memories WHERE scope IN (${scopes.map(() => '?').join(',')})`, ...scopes)
      .toArray()
      .filter((r) => !opts.kinds || opts.kinds.includes(r.kind as MemoryKind));
    if (!rows.length || !query.trim()) return [];
    const docs: Doc[] = rows.map((r) => ({ id: r.memory_id, tokens: this.tokensOf(r) }));
    const words = bm25(tokens(query), docs);
    const byWords = [...words.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);

    let byMeaning: string[] = [];
    const close = new Set<string>();
    const q = await this.embedQuery(query, rows);
    if (q) {
      const fresh = new Map(this.sql.exec<Row>(`SELECT memory_id, embedding, embed_model FROM memories WHERE scope IN (${scopes.map(() => '?').join(',')})`, ...scopes).toArray().map((r) => [r.memory_id, r]));
      const scored: [string, number][] = [];
      for (const r of rows) {
        const e = fresh.get(r.memory_id);
        if (!e?.embedding || e.embed_model !== q.model) continue;
        const c = cosine(q.vector, JSON.parse(e.embedding) as number[]);
        if (c >= MIN_COSINE) {
          scored.push([r.memory_id, c]);
          close.add(r.memory_id);
        }
      }
      byMeaning = scored.sort((a, b) => b[1] - a[1]).map(([id]) => id);
    }
    const fused = rrf([byWords, byMeaning]);
    const k = opts.k ?? 6;
    const results = [...fused.entries()]
      .filter(([id]) => words.has(id) || close.has(id))
      .sort((a, b) => b[1] - a[1])
      .slice(0, k)
      .map(([id, score]) => ({ ...toItem(rows.find((r) => r.memory_id === id)!), score }));
    if (opts.use && results.length) {
      const at = this.iso();
      for (const r of results) this.sql.exec('UPDATE memories SET uses = uses + 1, last_used_at = ? WHERE memory_id = ?', at, r.memoryId);
    }
    return results;
  }

  /** What to put in a prompt: the relevant memories, and the pinned ones always. */
  async recall(query: string, opts: SearchOptions = {}): Promise<Recalled[]> {
    const found = await this.search(query, { k: 6, ...opts, use: true });
    const pinned = this.sql
      .exec<Row>(`SELECT * FROM memories WHERE pinned = 1 AND scope IN (${(opts.scopes?.length ? opts.scopes : ['workspace']).map(() => '?').join(',')}) ORDER BY updated_at DESC LIMIT 8`, ...(opts.scopes?.length ? opts.scopes : ['workspace']))
      .toArray()
      .map(toItem);
    const out: Recalled[] = [];
    for (const m of [...pinned, ...found]) {
      if (out.some((x) => x.memoryId === m.memoryId)) continue;
      out.push({ memoryId: m.memoryId, text: m.text, kind: m.kind, ...(m.sourceLabel ? { sourceLabel: m.sourceLabel } : {}) });
    }
    return out.slice(0, 10);
  }

  /** Embed what lacks an embedding (a batch at a time), then the query. Null when no embedding provider answers. */
  private async embedQuery(query: string, rows: readonly Row[]): Promise<{ vector: number[]; model: string } | null> {
    try {
      const missing = rows.filter((r) => !r.embedding).slice(0, EMBED_PER_SEARCH);
      for (let i = 0; i < missing.length; i += EMBED_BATCH) {
        const batch = missing.slice(i, i + EMBED_BATCH);
        const out = await this.deps.embed(batch.map((r) => r.text));
        if (!out) return null;
        batch.forEach((r, j) => this.sql.exec('UPDATE memories SET embedding = ?, embed_model = ? WHERE memory_id = ?', JSON.stringify(out.vectors[j]!.map((x) => Math.round(x * 1e5) / 1e5)), out.model, r.memory_id));
      }
      const q = await this.deps.embed([query]);
      return q ? { vector: q.vectors[0]!, model: q.model } : null;
    } catch {
      return null;
    }
  }

  private tokensOf(r: Row): string[] {
    const have = this.tokenCache.get(r.memory_id);
    if (have && have.text === r.text) return have.tokens;
    const t = tokens(`${r.text} ${r.source_label ?? ''}`);
    this.tokenCache.set(r.memory_id, { text: r.text, tokens: t });
    return t;
  }

  private row(memoryId: string): Row | undefined {
    return this.sql.exec<Row>('SELECT * FROM memories WHERE memory_id = ?', memoryId).toArray()[0];
  }
}

function toItem(r: Row): MemoryItem {
  return {
    memoryId: r.memory_id,
    text: r.text,
    kind: r.kind as MemoryKind,
    scope: r.scope,
    source: r.source as MemorySource,
    ...(r.source_label ? { sourceLabel: r.source_label } : {}),
    ...(r.source_ref ? { sourceRef: r.source_ref } : {}),
    pinned: r.pinned === 1,
    uses: Number(r.uses),
    ...(r.last_used_at ? { lastUsedAt: r.last_used_at } : {}),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
