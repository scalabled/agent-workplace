// Spending limits (ARCHITECTURE §12: a runaway client loop or a model that keeps delegating must not spend
// without bound). Each paid path has a per-UTC-day cap set by an env var; running jobs are also capped.
// Stateless routes (TTS, STT) count in D1 media_usage (after personagram-ai security.ts rateLimit); the
// Durable Objects count in their own SQLite, synchronously, so the check is atomic with the command it guards.
import type { Env } from '../env';
import { consumeDaily, refundDaily, utcDay } from '../media/usage';
import { HttpError } from './http';

export const LIMITS = {
  /** Spoken sentences per day (one TTS call each). */
  tts: { env: 'TTS_DAILY_LIMIT', fallback: 3000, what: 'Spoken replies' },
  /** Recordings transcribed per day. */
  stt: { env: 'STT_DAILY_LIMIT', fallback: 600, what: 'Voice input' },
  /** Chief of Staff turns per day. */
  chat: { env: 'CHAT_DAILY_LIMIT', fallback: 1500, what: 'Replies' },
  /** Background jobs started per day. */
  job: { env: 'JOB_DAILY_LIMIT', fallback: 60, what: 'New background jobs' },
  /** Team projects proposed per day (Inc 1: each runs ~3 model calls per step plus the deliverable). */
  project: { env: 'PROJECT_DAILY_LIMIT', fallback: 10, what: 'New team projects' },
  /**
   * The interruption budget (EXPERIENCE §8): unprompted updates the Chief of Staff says aloud per day (a team
   * project's halfway point). Past it, the update is a quiet line in Talk. Answers to the owner never count.
   */
  ping: { env: 'INTERRUPTION_BUDGET', fallback: 6, what: 'Unprompted updates' },
  /** Web searches through the worker's search fallback per day (native searches ride on model calls). */
  search: { env: 'SEARCH_DAILY_LIMIT', fallback: 300, what: 'Web searches' },
  /** Web pages read (fetch_page) per day. */
  fetch: { env: 'FETCH_DAILY_LIMIT', fallback: 600, what: 'Web pages read' },
  /** Connector (MCP) tool calls per day. */
  connector: { env: 'CONNECTOR_DAILY_LIMIT', fallback: 500, what: 'Connector calls' },
  /** Emails sent per day (Inc 6; each also passes the autonomy dial and grants). */
  email: { env: 'EMAIL_DAILY_LIMIT', fallback: 50, what: 'Emails sent' },
  /** Realtime spoken acknowledgements (the voice front) per day. */
  front: { env: 'VOICE_FRONT_DAILY_LIMIT', fallback: 600, what: 'Spoken acknowledgements' },
  /** Canvas builds (apps and documents) per day. */
  canvas: { env: 'CANVAS_DAILY_LIMIT', fallback: 40, what: 'Canvas builds' },
  /** Memory model calls (distilling conversations and meetings, summarising files) per day. */
  memory: { env: 'MEMORY_DAILY_LIMIT', fallback: 400, what: 'Memory updates' },
} as const;

export type LimitKind = keyof typeof LIMITS;
type LimitVar = (typeof LIMITS)[LimitKind]['env'] | 'MAX_ACTIVE_JOBS';

/** Jobs that may run at once in a project (MAX_ACTIVE_JOBS). */
export const MAX_ACTIVE_JOBS_DEFAULT = 3;

function readInt(env: Partial<Record<LimitVar, string | undefined>>, name: LimitVar, fallback: number): number {
  const raw = Number(env[name]);
  return env[name] !== undefined && env[name] !== '' && Number.isInteger(raw) && raw >= 0 ? raw : fallback;
}

export function dailyLimit(env: Env, kind: LimitKind): number {
  return readInt(env, LIMITS[kind].env, LIMITS[kind].fallback);
}

export function maxActiveJobs(env: Env): number {
  return readInt(env, 'MAX_ACTIVE_JOBS', MAX_ACTIVE_JOBS_DEFAULT);
}

/** One sentence naming the var that raises the limit. */
export function limitMessage(kind: LimitKind, limit: number): string {
  const l = LIMITS[kind];
  return `${l.what} are paused until tomorrow (UTC): today's limit of ${limit} is used up. An owner can raise it in Admin → Settings (${l.env}).`;
}

/**
 * Count one paid call in D1 (TTS, STT). Throws rate_limited (429) when today's limit is used up. Returns a
 * refund to call when the work never reached a provider or the provider failed.
 */
export async function takeDaily(env: Env, kind: 'tts' | 'stt'): Promise<() => Promise<void>> {
  const db = env.DB;
  if (!db) return async () => undefined;
  const limit = dailyLimit(env, kind);
  const use = await consumeDaily(db, env.WORKSPACE_ID, kind, limit);
  if (!use.allowed) throw new HttpError('rate_limited', limitMessage(kind, limit));
  return () => refundDaily(db, env.WORKSPACE_ID, kind, use.day).catch(() => undefined);
}

/** The part of DO storage the local counter needs (the SQLite API is synchronous). */
export type SqlCounterHost = Pick<DurableObjectStorage, 'sql'>;

const COUNTER_SCHEMA = `CREATE TABLE IF NOT EXISTS usage_daily (day TEXT NOT NULL, kind TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, kind))`;

/**
 * A per-day counter in a Durable Object's own SQLite. Synchronous, so no other request can interleave between
 * the check and the command. Counts saturate at limit + 1, so refused attempts use nothing up.
 */
export class DailyCounter {
  constructor(private readonly storage: SqlCounterHost) {
    storage.sql.exec(COUNTER_SCHEMA);
  }

  take(kind: LimitKind, limit: number, now: number): { allowed: boolean; used: number } {
    const day = utcDay(new Date(now));
    const row = this.storage.sql
      .exec<{ count: number }>(
        'INSERT INTO usage_daily (day, kind, count) VALUES (?, ?, 1) ON CONFLICT (day, kind) DO UPDATE SET count = MIN(usage_daily.count + 1, ?) RETURNING count',
        day,
        kind,
        limit + 1,
      )
      .toArray()[0];
    const used = Number(row?.count ?? limit + 1);
    this.storage.sql.exec('DELETE FROM usage_daily WHERE day < ?', utcDay(new Date(now - 7 * 86_400_000)));
    return { allowed: used <= limit, used };
  }

  /** Today's counts by kind (the admin page's limits). */
  today(now: number): Record<string, number> {
    const rows = this.storage.sql.exec<{ kind: string; count: number }>('SELECT kind, count FROM usage_daily WHERE day = ?', utcDay(new Date(now))).toArray();
    return Object.fromEntries(rows.map((r) => [r.kind, Number(r.count)]));
  }

  /** Give one back (the command was refused later for another reason). */
  refund(kind: LimitKind, now: number): void {
    this.storage.sql.exec('UPDATE usage_daily SET count = MAX(count - 1, 0) WHERE day = ? AND kind = ?', utcDay(new Date(now)), kind);
  }
}
