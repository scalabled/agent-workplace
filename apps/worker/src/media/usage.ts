// Per-day counters for paid media calls (D1 media_usage, 0002_media.sql).

export interface DailyUse {
  allowed: boolean;
  /** Calls counted today (saturates at limit + 1). */
  used: number;
  remaining: number;
  /** UTC day the call was counted on (pass it back to refundDaily). */
  day: string;
}

export const utcDay = (now: Date = new Date()): string => now.toISOString().slice(0, 10);

// After personagram-ai/src/worker/security.ts (rateLimit): one upsert; the count stops one past the limit, so
// refused attempts use nothing up and a raised limit takes effect at once.
export async function consumeDaily(db: D1Database, wsId: string, kind: string, limit: number, now: Date = new Date()): Promise<DailyUse> {
  const day = utcDay(now);
  const row = await db
    .prepare(
      'INSERT INTO media_usage (ws_id, day, kind, count) VALUES (?, ?, ?, 1) ON CONFLICT (ws_id, day, kind) DO UPDATE SET count = MIN(media_usage.count + 1, ?) RETURNING count',
    )
    .bind(wsId, day, kind, limit + 1)
    .first<{ count: number }>();
  const used = Number(row?.count ?? limit + 1);
  return { allowed: used <= limit, used, remaining: Math.max(0, limit - used), day };
}

/** Give one use back when the call it paid for never reached a provider or the provider failed. */
export async function refundDaily(db: D1Database, wsId: string, kind: string, day: string): Promise<void> {
  await db.prepare('UPDATE media_usage SET count = MAX(count - 1, 0) WHERE ws_id = ? AND day = ? AND kind = ?').bind(wsId, day, kind).run();
}
