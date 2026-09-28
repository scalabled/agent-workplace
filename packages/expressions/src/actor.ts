// Agents as actors (§2): prioritised mailboxes and merged attention threads. An agent has one voice, so
// the only thing it is ever "busy" with is a real contention for that voice or for a meeting floor (L3).
import type { AttentionThread, AttentionView, Contention, Envelope, Mailboxes } from './types';
import { MAILBOX_PRIORITY } from './vocab';
import type { Mailbox } from './vocab';

const BOXES: readonly Mailbox[] = (Object.keys(MAILBOX_PRIORITY) as Mailbox[]).sort((a, b) => MAILBOX_PRIORITY[a] - MAILBOX_PRIORITY[b]);

/**
 * Five FIFO boxes read highest-priority first (owner > floor > coworker > work > ambient). `coalesceKey`
 * gives "latest wins" in place; `ttlMs` drops stale items on read (they are dropped, never delayed).
 */
export function createMailboxes<T>(opts?: { maxPerBox?: Partial<Record<Mailbox, number>> }): Mailboxes<T> {
  const boxes = new Map<Mailbox, Envelope<T>[]>(BOXES.map((b) => [b, []]));
  const expired = (e: Envelope<T>, now: number) => e.ttlMs !== undefined && now - e.at > e.ttlMs;
  return {
    post(e: Envelope<T>): void {
      const q = boxes.get(e.box);
      if (!q) throw new Error(`unknown mailbox ${String(e.box)}`);
      if (e.coalesceKey !== undefined) {
        const i = q.findIndex((x) => x.coalesceKey === e.coalesceKey);
        if (i >= 0) {
          q[i] = e;
          return;
        }
      }
      q.push(e);
      const max = opts?.maxPerBox?.[e.box];
      if (max !== undefined && max >= 0) while (q.length > max) q.shift(); // oldest goes first
    },
    take(now: number): Envelope<T> | null {
      for (const b of BOXES) {
        const q = boxes.get(b)!;
        while (q.length) {
          const e = q.shift()!;
          if (!expired(e, now)) return e;
        }
      }
      return null;
    },
    preempts(e: Envelope<T>, current: Mailbox): boolean {
      return MAILBOX_PRIORITY[e.box] < MAILBOX_PRIORITY[current];
    },
    drop(pred: (e: Envelope<T>) => boolean): number {
      let n = 0;
      for (const [b, q] of boxes) {
        const keep = q.filter((e) => !pred(e));
        n += q.length - keep.length;
        boxes.set(b, keep);
      }
      return n;
    },
    size(box?: Mailbox): number {
      if (box) return boxes.get(box)?.length ?? 0;
      let n = 0;
      for (const q of boxes.values()) n += q.length;
      return n;
    },
  };
}

const speakingNow = (t: AttentionThread, now: number): boolean => t.voice.speaking && (t.voice.untilMs === null || t.voice.untilMs > now);

function rank(t: AttentionThread, now: number): number[] {
  return [speakingNow(t, now) ? 0 : 1, t.floorHeld ? 0 : 1, MAILBOX_PRIORITY[t.mailbox] ?? 9, -t.since];
}

function compareRank(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return 0;
}

/**
 * Merge an agent's attention claims into one view (§2.2): the focus is the thread holding its voice, else the
 * floor, else the most urgent mailbox, else the newest. A voice whose `untilMs` has passed is no longer busy.
 */
export function mergeAttention(agentId: string, claims: readonly AttentionThread[], now: number): AttentionView {
  const byId = new Map<string, AttentionThread>();
  for (const c of claims) {
    const prev = byId.get(c.id);
    if (!prev || c.since >= prev.since) byId.set(c.id, c);
  }
  const threads = [...byId.values()].map((t) =>
    speakingNow(t, now) || !t.voice.speaking ? t : { ...t, voice: { speaking: false, untilMs: t.voice.untilMs } },
  );
  threads.sort((a, b) => compareRank(rank(a, now), rank(b, now)) || a.id.localeCompare(b.id));
  const speaking = threads.filter((t) => speakingNow(t, now));
  const until = speaking.map((t) => t.voice.untilMs).filter((u): u is number => u !== null);
  return {
    agentId,
    focus: threads[0] ?? null,
    background: threads.slice(1),
    voiceBusyUntil: until.length ? Math.max(...until) : null,
    at: now,
  };
}

/**
 * Is the agent's voice or floor held by another thread than the incoming one (§2.3, H5)? The ETA is the
 * real remaining time (null when unknown; the juggling line then has no ETA). Hosts apply the thresholds
 * (`juggle_min_remaining_ms`, `juggle_preempt_over_ms`).
 */
export function contentionFor(view: AttentionView, incoming: { mailbox: Mailbox; threadId: string }, now: number): Contention {
  const others = [view.focus, ...view.background].filter((t): t is AttentionThread => !!t && t.id !== incoming.threadId);
  const voice = others.find((t) => speakingNow(t, now));
  if (voice) {
    return { kind: 'voice_busy', etaMs: voice.voice.untilMs === null ? null : Math.max(0, voice.voice.untilMs - now), otherThread: voice.label };
  }
  const floor = others.find((t) => t.floorHeld);
  if (floor) {
    return { kind: 'floor_held', etaMs: floor.voice.untilMs === null || floor.voice.untilMs <= now ? null : floor.voice.untilMs - now, otherThread: floor.label };
  }
  return { kind: 'none' };
}
