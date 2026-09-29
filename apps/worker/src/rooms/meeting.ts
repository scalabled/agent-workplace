// What the ledger knows about one meeting: who spoke and how often (floor rotation), and the one quiet line Talk gets
// when the owner leaves a room or huddle they spoke in (docs/dev/OFFICE-PHASE2.md §4.2.7). Pure.
import type { Frame } from '@headcount/protocol';
import { roomKindOf, type RoomId } from '@headcount/protocol/ext/rooms';
import { listNames, meetingLines } from './prompt';

export interface MeetingStats {
  /** The previous turn's first responder. */
  lastFirst: string | null;
  /** Replies so far, per agent. */
  turnsBy: Record<string, number>;
  /** The owner said something in this meeting. */
  ownerSpoke: boolean;
  /** Agents with a reply, in the order they first spoke. */
  speakers: string[];
  /** Epoch ms of the first and last line, or null. */
  firstAt: number | null;
  lastAt: number | null;
}

export function meetingStats(frames: readonly Frame[], meetingId: string): MeetingStats {
  const lines = meetingLines(frames, meetingId);
  const turnsBy: Record<string, number> = {};
  const speakers: string[] = [];
  let lastOwnerTurn: string | null = null;
  let ownerSpoke = false;
  for (const f of lines) {
    if (f.type === 'talk.owner') {
      ownerSpoke = true;
      lastOwnerTurn = f.data.turnId;
    } else {
      turnsBy[f.data.agentId] = (turnsBy[f.data.agentId] ?? 0) + 1;
      if (!speakers.includes(f.data.agentId)) speakers.push(f.data.agentId);
    }
  }
  const lastFirst = lastOwnerTurn ? (lines.find((f) => f.type === 'talk.message' && f.data.turnId === lastOwnerTurn)?.data as { agentId?: string } | undefined)?.agentId ?? null : null;
  const times = lines.map((f) => Date.parse(f.ts)).filter((n) => Number.isFinite(n));
  return { lastFirst, turnsBy, ownerSpoke, speakers, firstAt: times.length ? Math.min(...times) : null, lastAt: times.length ? Math.max(...times) : null };
}

/** The meeting's note already in the ledger, if any (one per meeting). */
export function existingNote(frames: readonly Frame[], meetingId: string): Extract<Frame, { type: 'talk.message' }> | null {
  for (const f of frames) if (f.type === 'talk.message' && f.data.kind === 'note' && f.data.meetingId === meetingId) return f;
  return null;
}

const capitalise = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/**
 * "Skyline room with Juno, Walt and Lena · 4 min", "Water cooler with Kate and Pax · 2 min", "Huddle with Kate and
 * Pax · 2 min": names are first names (speakers first, then the others present), minutes rounded up from the first
 * to the last line (at least 1).
 */
export function meetingNoteText(roomId: RoomId, label: string | null | undefined, names: readonly string[], firstAt: number | null, lastAt: number | null): string {
  const kind = roomKindOf(roomId);
  const place = kind === 'skyline' ? 'Skyline room' : kind === 'garden' ? 'Garden room' : label ? capitalise(label) : 'Huddle';
  const minutes = firstAt !== null && lastAt !== null ? Math.max(1, Math.ceil((lastAt - firstAt) / 60_000)) : 1;
  const who = names.length ? ` with ${listNames(names)}` : '';
  return `${place}${who} · ${minutes} min`;
}
