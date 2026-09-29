// Join a huddle (OFFICE-PHASE2 §4.5.11): a huddle room session with ≤ 4 members, the warmest greets you (by name when
// set), replies appear as their voice starts, errors are a notice, Leave signs off and closes with {leave: true}, and
// "Open in a room" closes without a sign-off or a note.
import type { HuddleInfo, OfficeLife } from '@headcount/office';
import { huddleRoomId } from '@headcount/protocol/ext/rooms';
import { describe, expect, it, vi } from 'vitest';
import type { LivingRuntime } from '../living/types';
import type { PttTarget } from '../voice/ptt';
import { createJoin, greeterOf, huddleLabel, listNames, type JoinDeps, type JoinRoomEvent } from './join';

const H: HuddleInfo = { id: 'hd:2026-09-29:cooler:cafe:635', spotId: 'cooler:cafe', spot: 'water_cooler', label: 'Water cooler', members: ['cw_kate', 'cw_pax', 'cw_lena', 'cw_omar', 'cw_extra'], startedAt: 0, endsAt: 1, joined: true, listening: false, crew: false };
const flush = () => new Promise((r) => setTimeout(r, 0));

function rig(over: Partial<JoinDeps> = {}) {
  const replies: ([string, string] | [string, string, unknown])[] = [];
  const talks: string[] = [];
  const bubbles: [string, string, unknown][] = [];
  const notices: string[] = [];
  const sessions: { opts: Parameters<JoinDeps['openSession']>[0]; says: [string, string][]; closes: unknown[]; hushes: number }[] = [];
  const targets: PttTarget[] = [];
  const restores: number[] = [];
  const state = { joined: H.id as string | null };
  const life = {
    huddles: () => [H],
    getState: () => ({ joined: state.joined }),
    reply: (id: string, text: string, opts?: unknown) => replies.push(opts === undefined ? [id, text] : [id, text, opts]),
    talk: (text: string) => talks.push(text),
  } as unknown as OfficeLife;
  const sayIntent = vi.fn(async (id: string, intent: string) => ({ text: intent === 'greeting' ? `Hi Dana, ${id} here.` : 'Back to it.', voiced: false }));
  const join = createJoin({
    life: () => life,
    living: () => ({ sayIntent }) as unknown as LivingRuntime,
    openSession: (opts) => {
      const s = { opts, says: [] as [string, string][], closes: [] as unknown[], hushes: 0 };
      sessions.push(s);
      return {
        say: async (text, via) => void s.says.push([text, via]),
        hush: () => void s.hushes++,
        close: async (o) => void s.closes.push(o),
      };
    },
    setPttTarget: (t) => {
      targets.push(t);
      return () => restores.push(1);
    },
    firstName: (id) => id.slice(3, 4).toUpperCase() + id.slice(4),
    ownerFirstName: () => 'Dana',
    warmth: (id) => ({ cw_kate: 40, cw_pax: 90, cw_lena: 60 })[id] ?? null,
    showBubble: (id, text, opts) => bubbles.push([id, text, opts]),
    notice: (t) => notices.push(t),
    seed: 'local',
    ...over,
  });
  return { join, replies, talks, bubbles, notices, sessions, targets, restores, sayIntent, state };
}

describe('joining a huddle', () => {
  it('opens a huddle room session with at most 4 members and the place, and the warmest greets', async () => {
    const r = rig();
    r.join.onJoin(H);
    expect(r.sessions).toHaveLength(1);
    const o = r.sessions[0]!.opts;
    expect(o.roomId).toBe(huddleRoomId(H.id));
    expect(o.participants()).toEqual(['cw_kate', 'cw_pax', 'cw_lena', 'cw_omar']);
    expect(o.label).toBe('water cooler');
    await flush();
    expect(r.sayIntent).toHaveBeenCalledWith('cw_pax', 'greeting');
    expect(r.replies).toEqual([['cw_pax', 'Hi Dana, cw_pax here.']]);
    expect(r.join.current()).toBe(H.id);
  });

  it('greets by name without the runtime', () => {
    const r = rig({ living: () => null });
    r.join.onJoin(H);
    expect(r.replies).toEqual([['cw_pax', 'Oh, hi Dana.']]);
    const anon = rig({ living: () => null, ownerFirstName: () => null });
    anon.join.onJoin(H);
    expect(anon.replies).toEqual([['cw_pax', 'Oh, hi.']]);
  });

  it('sends what you type, and push-to-talk goes to the huddle (hushing it) marked as voice', async () => {
    const r = rig();
    r.join.onJoin(H);
    r.join.onTalk(H, 'What are you two debating?');
    expect(r.sessions[0]!.says).toEqual([['What are you two debating?', 'text']]);
    const t = r.targets[0]!;
    expect(t.kind).toBe('room');
    if (t.kind !== 'room') return;
    expect(t.label).toBe('Kate, Pax, Lena and Omar');
    t.onStart();
    expect(r.sessions[0]!.hushes).toBe(1);
    await t.send('Tell me more', Date.now());
    expect(r.talks).toEqual(['Tell me more']);
    r.join.onTalk(H, 'Tell me more');
    expect(r.sessions[0]!.says.at(-1)).toEqual(['Tell me more', 'voice']);
  });

  it('shows replies as their voice starts, errors as a notice (never in someone’s mouth)', () => {
    const r = rig();
    r.join.onJoin(H);
    r.replies.length = 0;
    const emit = (e: JoinRoomEvent) => r.sessions[0]!.opts.onEvent(e);
    emit({ type: 'line', agentId: 'cw_kate', messageId: 'm1', text: 'Partial', final: false } as JoinRoomEvent);
    emit({ type: 'start', agentId: 'cw_kate', messageId: 'm1', text: 'I’d start with the returns data.', voiced: true, notVoicedTag: false });
    emit({ type: 'error', message: 'That is a lot of room talk right now. Wait a minute and ask again.' });
    expect(r.replies).toEqual([['cw_kate', 'I’d start with the returns data.']]);
    expect(r.notices).toEqual(['That is a lot of room talk right now. Wait a minute and ask again.']);
    // The rest of that reply arrives after it started: the same line grows in place (no second line).
    emit({ type: 'line', agentId: 'cw_kate', messageId: 'm1', text: 'I’d start with the returns data. Then the reviews.', final: true } as JoinRoomEvent);
    emit({ type: 'line', agentId: 'cw_kate', messageId: 'm1', text: 'I’d start with the returns data. Then the reviews.', final: true } as JoinRoomEvent);
    expect(r.replies).toEqual([
      ['cw_kate', 'I’d start with the returns data.'],
      ['cw_kate', 'I’d start with the returns data. Then the reviews.', { update: true }],
    ]);
  });

  it('Leave signs off in a passive bubble and closes with {leave: true}; "Open in a room" closes quietly', async () => {
    const r = rig();
    r.join.onJoin(H);
    r.join.onLeave(H);
    expect(r.sessions[0]!.closes).toEqual([{ leave: true, participants: ['cw_kate', 'cw_pax', 'cw_lena', 'cw_omar'] }]);
    expect(r.restores).toHaveLength(1);
    await flush();
    expect(r.sayIntent).toHaveBeenCalledWith('cw_omar', 'sign_off');
    expect(r.bubbles).toEqual([['cw_omar', 'Back to it.', { ttlMs: 2400, passive: true }]]);
    expect(r.join.current()).toBeNull();

    const m = rig();
    m.join.onJoin(H);
    m.join.onToRoom(H);
    m.join.onLeave(H);
    expect(m.sessions[0]!.closes).toEqual([{ leave: false, participants: ['cw_kate', 'cw_pax', 'cw_lena', 'cw_omar'] }]);
    await flush();
    expect(m.sayIntent).not.toHaveBeenCalledWith(expect.anything(), 'sign_off');
    expect(m.bubbles).toHaveLength(0);
  });

  it('a huddle life ends by itself closes like a leave; push-to-talk never goes to a huddle that is gone', async () => {
    const r = rig();
    r.join.onJoin(H);
    const t = r.targets[0]!;
    if (t.kind !== 'room') throw new Error('room target');
    // The director let the huddle go (it dispersed) before the owner's words came back from speech to text.
    r.state.joined = null;
    await t.send('Are you still there?', Date.now());
    expect(r.talks).toEqual([]);
    expect(r.sessions[0]!.says).toEqual([['Are you still there?', 'voice']]);
    r.join.onEnd(H);
    expect(r.sessions[0]!.closes).toEqual([{ leave: true, participants: ['cw_kate', 'cw_pax', 'cw_lena', 'cw_omar'] }]);
    expect(r.restores).toHaveLength(1);
    expect(r.join.current()).toBeNull();
    // Another huddle ending does nothing.
    const o = rig();
    o.join.onJoin(H);
    o.join.onEnd({ ...H, id: 'hd:other' });
    expect(o.join.current()).toBe(H.id);
  });

  it('helpers: the place label, names and a stable greeter', () => {
    expect(huddleLabel('Water cooler')).toBe('water cooler');
    expect(huddleLabel('At Liban’s desk')).toBe('at Liban’s desk');
    expect(huddleLabel('By the window')).toBe('by the window');
    expect(huddleLabel('At Nina’s desk · Akeem visiting')).toBeUndefined();
    expect(listNames(['Kate'])).toBe('Kate');
    expect(listNames(['Kate', 'Pax'])).toBe('Kate and Pax');
    expect(listNames(['Kate', 'Pax', 'Lena'])).toBe('Kate, Pax and Lena');
    const tie = greeterOf(['cw_a', 'cw_b'], () => 50, 'seed');
    expect(greeterOf(['cw_a', 'cw_b'], () => 50, 'seed')).toBe(tie);
  });
});
