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
  return `${l.what} are paused until tomorrow (UTC): today's limit of ${limit} is used up. Raise ${l.env} in apps/worker/.dev.vars to allow more.`;
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

  /** Give one back (the command was refused later for another reason). */
  refund(kind: LimitKind, now: number): void {
    this.storage.sql.exec('UPDATE usage_daily SET count = MAX(count - 1, 0) WHERE day = ? AND kind = ?', utcDay(new Date(now)), kind);
  }
}
