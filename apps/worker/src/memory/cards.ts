// Context cards (Inc 4): files the owner drops, kept as text (R2), summarised, and cut into searchable excerpts in the
// memory (so a question finds the right page of the menu, the price list or the contract). Where a file is dropped sets
// its scope: the workspace (Talk, the Memory page), a project, or one coworker.
import type { CardKind, ContextCard, MemoryScope } from '@headcount/protocol/ext/memory';

export const CARD_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS cards (
     card_id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, bytes INTEGER NOT NULL, chars INTEGER NOT NULL,
     scope TEXT NOT NULL, summary TEXT, chunks INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`,
];

export const MAX_CARDS = 200;

type Row = { card_id: string; name: string; kind: string; bytes: number; chars: number; scope: string; summary: string | null; chunks: number; created_at: string };

export const newCardId = () => `card_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;

export class Cards {
  constructor(
    private readonly sql: SqlStorage,
    private readonly now: () => number,
  ) {
    for (const stmt of CARD_SCHEMA) sql.exec(stmt);
  }

  count(): number {
    return Number(this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM cards').toArray()[0]?.n ?? 0);
  }

  add(c: { cardId: string; name: string; kind: CardKind; bytes: number; chars: number; scope: MemoryScope; chunks: number; summary?: string }): ContextCard {
    this.sql.exec(
      'INSERT INTO cards (card_id, name, kind, bytes, chars, scope, summary, chunks, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      c.cardId, c.name, c.kind, c.bytes, c.chars, c.scope, c.summary ?? null, c.chunks, new Date(this.now()).toISOString(),
    );
    return this.get(c.cardId)!;
  }

  setSummary(cardId: string, summary: string): void {
    this.sql.exec('UPDATE cards SET summary = ? WHERE card_id = ?', summary, cardId);
  }

  /** An image's description arrived: its text length, searchable pieces and summary. */
  setRead(cardId: string, chars: number, chunks: number, summary: string): void {
    this.sql.exec('UPDATE cards SET chars = ?, chunks = ?, summary = ? WHERE card_id = ?', chars, chunks, summary, cardId);
  }

  list(scope?: MemoryScope): ContextCard[] {
    const rows = scope ? this.sql.exec<Row>('SELECT * FROM cards WHERE scope = ? ORDER BY created_at DESC', scope).toArray() : this.sql.exec<Row>('SELECT * FROM cards ORDER BY created_at DESC').toArray();
    return rows.map(toCard);
  }

  get(cardId: string): ContextCard | null {
    const r = this.sql.exec<Row>('SELECT * FROM cards WHERE card_id = ?', cardId).toArray()[0];
    return r ? toCard(r) : null;
  }

  remove(cardId: string): boolean {
    return this.sql.exec('DELETE FROM cards WHERE card_id = ? RETURNING card_id', cardId).toArray().length > 0;
  }
}

function toCard(r: Row): ContextCard {
  return { cardId: r.card_id, name: r.name, kind: r.kind as CardKind, bytes: Number(r.bytes), chars: Number(r.chars), scope: r.scope, ...(r.summary ? { summary: r.summary } : {}), chunks: Number(r.chunks), createdAt: r.created_at };
}

/** A scope is the workspace, a project, or a coworker. */
export function isScope(s: unknown): s is MemoryScope {
  return typeof s === 'string' && (s === 'workspace' || /^project:prj_[a-z0-9]{8,40}$/.test(s) || /^coworker:[a-z0-9][a-z0-9-]{0,80}$/.test(s));
}
