// Join a huddle: they turn toward you, the warmest greets you by name, and
// you are in a group chat on the rooms endpoint (≤ 4 members, ≤ 2 answer each time, the same reply guard as rooms).
// Replies appear over the speaker as their voice starts; errors are one notice, never a line in someone's mouth.
// Leaving signs off (one passive bubble) and closes the meeting, which leaves one quiet line in Talk if you spoke.
// "Open in a room" moves the same people to the stage without a sign-off or a note (the stage writes its own).
import type { HuddleInfo, OfficeLife } from '@headcount/office';
import { huddleRoomId, ROOM_LABEL_RE, ROOM_LIMITS, type RoomId } from '@headcount/protocol/ext/rooms';
import type { LivingRuntime } from '../living/types';
import type { PttTarget } from '../voice/ptt';

/** The C session events this module reacts to (a structural slice of room/session.ts's RoomEvent). */
export type JoinRoomEvent =
  | { type: 'start'; agentId: string; messageId: string; text: string; voiced: boolean; notVoicedTag: boolean }
  | { type: 'line'; agentId: string; messageId: string; text: string; final: boolean }
  | { type: 'error'; message: string }
  | { type: string };

export interface JoinSession {
  say(text: string, via: 'text' | 'voice'): Promise<void>;
  hush(): void;
  close(opts?: { leave?: boolean; participants?: readonly string[] }): Promise<void>;
}

export interface JoinDeps {
  life(): OfficeLife | null;
  living(): LivingRuntime | null;
  openSession(o: { roomId: RoomId; participants: () => readonly string[]; label?: string; onEvent(e: JoinRoomEvent): void }): JoinSession;
  setPttTarget(t: PttTarget): () => void;
  firstName(agentId: string): string;
  ownerFirstName(): string | null;
  /** The warmth slider (0–100) of each person, when known. */
  warmth(agentId: string): number | null;
  showBubble(agentId: string, text: string, opts: { ttlMs: number; passive: boolean }): void;
  notice(text: string): void;
  /** A seed for tie-breaks (the workspace id). */
  seed: string;
}

export interface Join {
  onJoin(h: HuddleInfo): void;
  onTalk(h: HuddleInfo, text: string): void;
  onLeave(h: HuddleInfo): void;
  /** Life ended the huddle on its own (it dispersed, the day replanned): a joined one closes as if you left. */
  onEnd(h: HuddleInfo): void;
  onToRoom(h: HuddleInfo): void;
  /** The joined huddle's id, if any. */
  current(): string | null;
  destroy(): void;
}

/**
 * The place as the rooms endpoint takes it (prompts, the leave note): the huddle's label with its first letter in
 * lower case, so names keep their capitals ("Water cooler" → "water cooler", "At Liban's desk" → "at Liban's desk",
 * "By the window" → "by the window"), or nothing when it does not fit.
 */
export function huddleLabel(label: string): string | undefined {
  const t = label.trim();
  const l = t ? t[0]!.toLowerCase() + t.slice(1) : '';
  return l && ROOM_LABEL_RE.test(l) ? l : undefined;
}

/** "Kate", "Kate and Pax", "Kate, Pax and Lena". */
export function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

/** The member with the highest warmth greets (a seeded tie-break, so every device agrees). */
export function greeterOf(members: readonly string[], warmth: (id: string) => number | null, seed: string): string | null {
  let best: string | null = null;
  let bestKey = -Infinity;
  for (const id of members) {
    const key = (warmth(id) ?? 50) + (hash(`${seed}|${id}`) % 1e6) / 1e6;
    if (key > bestKey) {
      best = id;
      bestKey = key;
    }
  }
  return best;
}

export function createJoin(d: JoinDeps): Join {
  let joined: { id: string; session: JoinSession; restorePtt: () => void; members: string[]; toRoom: boolean } | null = null;
  let nextVia: 'text' | 'voice' | null = null;
  let destroyed = false;

  const membersOf = (h: HuddleInfo): string[] => {
    const live = d.life()?.huddles().find((x) => x.id === h.id)?.members ?? h.members;
    return live.slice(0, ROOM_LIMITS.huddle.participants);
  };

  const close = (leave: boolean) => {
    const j = joined;
    if (!j) return;
    joined = null;
    nextVia = null;
    j.restorePtt();
    void j.session.close({ leave, participants: j.members }).catch(() => undefined);
  };

  return {
    onJoin(h) {
      if (destroyed) return;
      if (joined) close(true);
      const members = membersOf(h);
      const label = huddleLabel(h.label);
      const names = listNames(members.map((id) => d.firstName(id)));
      /** Replies on screen (by message): a reply that starts with its first sentence grows in place as the rest arrives. */
      const shown = new Map<string, string>();
      const session = d.openSession({
        roomId: huddleRoomId(h.id),
        participants: () => (joined?.id === h.id ? (joined.members = membersOf(h)) : members),
        ...(label ? { label } : {}),
        onEvent(e) {
          if (joined?.id !== h.id) return;
          if (e.type === 'start' && 'agentId' in e && 'text' in e && 'messageId' in e) {
            shown.set(e.messageId, e.text);
            d.life()?.reply(e.agentId, e.text);
          } else if (e.type === 'line' && 'agentId' in e && 'text' in e && 'messageId' in e) {
            const was = shown.get(e.messageId);
            if (was === undefined || was === e.text || !e.text.trim()) return;
            shown.set(e.messageId, e.text);
            d.life()?.reply(e.agentId, e.text, { update: true });
          } else if (e.type === 'error' && 'message' in e) d.notice(e.message);
        },
      });
      const restorePtt = d.setPttTarget({
        kind: 'room',
        roomId: huddleRoomId(h.id),
        label: names,
        onStart: () => session.hush(),
        send: async (text) => {
          const life = d.life();
          // Through the huddle's chat (it shows your line), or straight to the meeting if life has let the huddle go.
          if (life && life.getState().joined === h.id) {
            nextVia = 'voice';
            life.talk(text);
          } else if (joined?.id === h.id) await joined.session.say(text, 'voice');
        },
      });
      joined = { id: h.id, session, restorePtt, members, toRoom: false };

      // The greeting: catalog selection with the owner's name, voiced only where this tab may voice.
      const greeter = greeterOf(members, d.warmth, `${d.seed}|${h.id}`);
      if (!greeter) return;
      const fallback = () => {
        const owner = d.ownerFirstName();
        if (joined?.id === h.id) d.life()?.reply(greeter, owner ? `Oh, hi ${owner}.` : 'Oh, hi.');
      };
      const rt = d.living();
      if (!rt) return fallback();
      void rt
        .sayIntent(greeter, 'greeting')
        .then((r) => {
          if (joined?.id !== h.id) return;
          if (r?.text) d.life()?.reply(greeter, r.text);
          else fallback();
        })
        .catch(fallback);
    },
    onTalk(h, text) {
      if (!joined || joined.id !== h.id) return;
      const via = nextVia ?? 'text';
      nextVia = null;
      void joined.session.say(text, via).catch(() => d.notice('Could not reach them. Try again.'));
    },
    onLeave(h) {
      if (!joined || joined.id !== h.id) return;
      if (joined.toRoom) return close(false);
      const members = joined.members;
      close(true);
      // The sign-off: the last of them says goodbye in a passive bubble (never over someone you click next).
      const who = members[members.length - 1];
      const rt = d.living();
      if (!who) return;
      const show = (text: string) => d.showBubble(who, text, { ttlMs: 2400, passive: true });
      if (!rt) return show('Catch you later.');
      void rt
        .sayIntent(who, 'sign_off')
        .then((r) => show(r?.text || 'Catch you later.'))
        .catch(() => show('Catch you later.'));
    },
    onEnd(h) {
      if (joined?.id === h.id) this.onLeave(h);
    },
    onToRoom(h) {
      if (joined?.id === h.id) joined.toRoom = true;
    },
    current: () => joined?.id ?? null,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      close(true);
    },
  };
}
