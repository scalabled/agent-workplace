// When the worker refuses a voice render for budget (429), stop asking until the budget can have come back:
// a per-minute refusal pauses one minute; a daily one pauses until the next UTC midnight (when the worker's daily
// counters reset). The pause is shared by pre-voicing and runtime renders and survives reloads (localStorage), so a
// spent budget costs one refused request, not one per Talk visit or reflex. Lines still show as captions and faces.

export const BUDGET_PAUSE_KEY = 'hc-voice-budget-pause-v1';
const MINUTE_MS = 60_000;

export interface BudgetPause {
  /** True while voice renders should not be requested. */
  blocked(now: number): boolean;
  /** Record a refusal; returns true when `err` was a budget refusal (HTTP 429). */
  note(err: unknown, now: number): boolean;
  /** Epoch ms the pause ends (0 when not paused). */
  until(): number;
}

export function nextUtcMidnight(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

/** A 429 that says "a minute" is the per-minute limit; anything else is the daily budget. */
export function pauseEnd(message: string, now: number): number {
  return /\bminute\b/i.test(message) ? now + MINUTE_MS : nextUtcMidnight(now);
}

export function createBudgetPause(storage?: Pick<Storage, 'getItem' | 'setItem'> | null): BudgetPause {
  let until = 0;
  try {
    const raw = storage?.getItem(BUDGET_PAUSE_KEY);
    const n = raw ? Number(JSON.parse(raw)?.until) : 0;
    if (Number.isFinite(n)) until = n;
  } catch {
    /* unreadable: not paused */
  }
  return {
    blocked: (now) => now < until,
    until: () => until,
    note(err, now) {
      const status = (err as { status?: unknown } | null)?.status;
      if (status !== 429) return false;
      const message = String((err as { message?: unknown }).message ?? '');
      until = Math.max(until, pauseEnd(message, now));
      try {
        storage?.setItem(BUDGET_PAUSE_KEY, JSON.stringify({ until }));
      } catch {
        /* storage blocked: this tab still pauses */
      }
      return true;
    },
  };
}
