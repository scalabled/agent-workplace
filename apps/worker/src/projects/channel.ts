// The team channel (biz-bot parity: the shared room transcript that is every member's blackboard). Each project keeps
// one: work handed in, reviews, questions between teammates and their answers, hand-offs, discussions, the owner's
// posts and decisions. Agents read its recent part as reference; the owner reads it live and writes to it.
import type { FrameInput, FrameType } from '@headcount/protocol';
import type { ChannelEntry, TeamMember } from '@headcount/protocol/ext/projects';
import { clipText } from '../jobs/job-view';

export const CHANNEL_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS tchannel (
     seq INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL, kind TEXT NOT NULL, from_id TEXT NOT NULL, to_id TEXT,
     step_id TEXT, text TEXT NOT NULL, reply_to INTEGER, round INTEGER, phase TEXT, at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS tchannel_project ON tchannel (project_id, seq)`,
];

const ENTRY_MAX = 6000;
/** Lines of the channel an agent reads (newest last), and the characters per line. */
export const CONTEXT_LINES = 24;
const CONTEXT_LINE_CHARS = 320;

type Row = { seq: number; project_id: string; kind: string; from_id: string; to_id: string | null; step_id: string | null; text: string; reply_to: number | null; round: number | null; phase: string | null; at: string };

export type NewEntry = Omit<ChannelEntry, 'seq' | 'projectId' | 'at'>;

export class TeamChannel {
  constructor(
    private readonly sql: SqlStorage,
    private readonly append: <T extends FrameType>(input: FrameInput<T>) => void,
    private readonly now: () => string,
  ) {
    for (const stmt of CHANNEL_SCHEMA) sql.exec(stmt);
  }

  add(projectId: string, e: NewEntry): ChannelEntry {
    const at = this.now();
    const text = clipText(e.text.trim(), ENTRY_MAX);
    const seq = Number(
      this.sql
        .exec<{ seq: number }>(
          'INSERT INTO tchannel (project_id, kind, from_id, to_id, step_id, text, reply_to, round, phase, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING seq',
          projectId, e.kind, e.fromId, e.toId ?? null, e.stepId ?? null, text, e.replyTo ?? null, e.round ?? null, e.phase ?? null, at,
        )
        .toArray()[0]!.seq,
    );
    const entry: ChannelEntry = { seq, projectId, kind: e.kind, fromId: e.fromId, text, at, ...(e.toId ? { toId: e.toId } : {}), ...(e.stepId ? { stepId: e.stepId } : {}), ...(e.replyTo ? { replyTo: e.replyTo } : {}), ...(e.round ? { round: e.round } : {}), ...(e.phase ? { phase: e.phase } : {}) };
    this.append({ type: 'project.channel', data: { entry } });
    return entry;
  }

  list(projectId: string, limit = 300): ChannelEntry[] {
    return this.sql
      .exec<Row>('SELECT * FROM (SELECT * FROM tchannel WHERE project_id = ? ORDER BY seq DESC LIMIT ?) ORDER BY seq ASC', projectId, limit)
      .toArray()
      .map(toEntry);
  }

  /** The recent channel as an agent reads it: "Ann → Sam (asks): …", newest last. */
  context(projectId: string, team: readonly TeamMember[], lines = CONTEXT_LINES): string {
    const name = (id?: string) => (!id ? 'the team' : id === 'owner' ? 'the owner' : id === 'chief' ? 'the Chief of Staff' : (team.find((m) => m.personaId === id)?.name.split(' ')[0] ?? id));
    return this.list(projectId, lines)
      .map((e) => `- ${name(e.fromId)}${e.toId ? ` → ${name(e.toId)}` : ''} (${VERB[e.kind]}${e.phase ? `, ${e.phase}` : ''}): ${clipText(e.text.replace(/\s+/g, ' '), CONTEXT_LINE_CHARS)}`)
      .join('\n');
  }
}

const VERB: Record<ChannelEntry['kind'], string> = {
  owner: 'owner says',
  work: 'handed in',
  review: 'review',
  ask: 'asks',
  answer: 'answers',
  handoff: 'hands off',
  discussion: 'in discussion',
  decision: 'decision',
  system: 'note',
};

function toEntry(r: Row): ChannelEntry {
  return {
    seq: Number(r.seq),
    projectId: r.project_id,
    kind: r.kind as ChannelEntry['kind'],
    fromId: r.from_id,
    text: r.text,
    at: r.at,
    ...(r.to_id ? { toId: r.to_id } : {}),
    ...(r.step_id ? { stepId: r.step_id } : {}),
    ...(r.reply_to ? { replyTo: Number(r.reply_to) } : {}),
    ...(r.round ? { round: Number(r.round) } : {}),
    ...(r.phase ? { phase: r.phase as ChannelEntry['phase'] } : {}),
  };
}

/** "@Ann and @Sam, …" → the team members named (first name, or full name without spaces; case-insensitive). */
export function mentionsIn(text: string, team: readonly TeamMember[]): { ids: string[]; everyone: boolean } {
  const everyone = /@(everyone|team|all)\b/i.test(text);
  const ids: string[] = [];
  for (const m of text.matchAll(/@([\p{L}][\p{L}'-]*)/gu)) {
    const said = m[1]!.toLowerCase();
    const hit = team.find((t) => t.name.split(' ')[0]!.toLowerCase() === said || t.name.replace(/\s+/g, '').toLowerCase() === said);
    if (hit && !ids.includes(hit.personaId)) ids.push(hit.personaId);
  }
  return { ids, everyone };
}
