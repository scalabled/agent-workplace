// The Handbook (Inc 4): the owner's description of the business in eight sections (company.md), written by the Chief
// of Staff from an interview and editable by the owner. It rides in every prompt that does work for the business
// (compact), so the Chief and the teams never ask what they have been told.
import { HANDBOOK_SECTIONS, HANDBOOK_SECTION_MAX, type HandbookResponse, type HandbookSection, type HandbookSectionId } from '@headcount/protocol/ext/memory';

export const HANDBOOK_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS handbook (section_id TEXT PRIMARY KEY, content TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS handbook_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
];

/** What a prompt carries of it at most. */
export const HANDBOOK_PROMPT_CHARS = 2600;

export const isSection = (id: unknown): id is HandbookSectionId => HANDBOOK_SECTIONS.some((s) => s.id === id);

export class Handbook {
  constructor(
    private readonly sql: SqlStorage,
    private readonly now: () => number,
  ) {
    for (const stmt of HANDBOOK_SCHEMA) sql.exec(stmt);
  }

  sections(): HandbookSection[] {
    const rows = new Map(this.sql.exec<{ section_id: string; content: string; updated_at: string; updated_by: string }>('SELECT * FROM handbook').toArray().map((r) => [r.section_id, r]));
    return HANDBOOK_SECTIONS.map((s) => {
      const r = rows.get(s.id);
      return { id: s.id, title: s.title, content: r?.content ?? '', ...(r ? { updatedAt: r.updated_at, updatedBy: r.updated_by as 'owner' | 'chief' } : {}) };
    });
  }

  /** Replace a section (empty text clears it). */
  put(id: HandbookSectionId, content: string, by: 'owner' | 'chief'): HandbookSection {
    const text = content.replace(/\r\n?/g, '\n').trim().slice(0, HANDBOOK_SECTION_MAX);
    if (!text) this.sql.exec('DELETE FROM handbook WHERE section_id = ?', id);
    else
      this.sql.exec(
        `INSERT INTO handbook (section_id, content, updated_at, updated_by) VALUES (?, ?, ?, ?)
         ON CONFLICT(section_id) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
        id, text, new Date(this.now()).toISOString(), by,
      );
    return this.sections().find((s) => s.id === id)!;
  }

  /** Add to a section (a new standing rule, a new client). */
  append(id: HandbookSectionId, content: string, by: 'owner' | 'chief'): HandbookSection {
    const have = this.sections().find((s) => s.id === id)!.content;
    return this.put(id, have ? `${have}\n${content.trim()}` : content, by);
  }

  missing(): (typeof HANDBOOK_SECTIONS)[number][] {
    const have = new Set(this.sections().filter((s) => s.content).map((s) => s.id));
    return HANDBOOK_SECTIONS.filter((s) => !have.has(s.id));
  }

  get interviewing(): boolean {
    return this.sql.exec<{ value: string }>(`SELECT value FROM handbook_state WHERE key = 'interviewing'`).toArray()[0]?.value === '1';
  }

  setInterviewing(on: boolean): void {
    this.sql.exec(`INSERT INTO handbook_state (key, value) VALUES ('interviewing', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, on ? '1' : '0');
  }

  /** The whole Handbook as company.md. */
  markdown(title = 'Company handbook'): string {
    const filled = this.sections().filter((s) => s.content);
    return [`# ${title}`, '', ...filled.flatMap((s) => [`## ${s.title}`, '', s.content, ''])].join('\n').trim() + '\n';
  }

  /** The Handbook as a prompt carries it (sections in order, cut to fit). */
  compact(max = HANDBOOK_PROMPT_CHARS): string {
    const filled = this.sections().filter((s) => s.content);
    if (!filled.length) return '';
    const each = Math.max(240, Math.floor(max / filled.length));
    const text = filled.map((s) => `### ${s.title}\n${s.content.length > each ? `${s.content.slice(0, each)}…` : s.content}`).join('\n');
    return text.length > max ? `${text.slice(0, max)}…` : text;
  }

  view(): HandbookResponse {
    return { sections: this.sections(), interviewing: this.interviewing, markdown: this.markdown() };
  }
}
