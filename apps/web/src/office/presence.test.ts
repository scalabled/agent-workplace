// Real state in the office (OFFICE-PHASE2 §4.5.5): presence diffed into the scene, speaking from this tab's audio, the
// Chief's running job as an activity, and pins while the owner talks with someone (and 20 s after).
import { signal } from '@preact/signals';
import { describe, expect, it, vi } from 'vitest';
import type { OfficeLife } from '@headcount/office';
import { CHIEF_ID, type JobSnapshot, type PresenceData } from '@headcount/protocol';
import { bindPresence, shownClaim, UNPIN_AFTER_MS, type TeamWorkClaim } from './presence';

const job = (over: Partial<JobSnapshot>): JobSnapshot =>
  ({ jobId: 'job_1', projectId: 'p_everyday', title: 'Secret plan', brief: 'b', status: 'running', label: 'Researching supplier prices', step: 1, of: 3, agentId: CHIEF_ID, startedAt: '2026-09-29T10:00:00Z', updatedAt: '2026-09-29T10:00:00Z', steers: [], ...over }) as JobSnapshot;

function rig() {
  const calls: { id: string; state: string; label?: string; badges?: string[] }[] = [];
  const speaking: [string, boolean][] = [];
  const scene = {
    setPresence: vi.fn((id: string, state: string, o?: { label?: string; badges?: string[] }) => void calls.push({ id, state, ...o })),
    setSpeaking: vi.fn((id: string, on: boolean) => void speaking.push([id, on])),
  };
  const unpins: string[] = [];
  const pins: string[] = [];
  const activities: [string, string | null][] = [];
  const life = {
    setActivity: vi.fn((id: string, a: string | null) => void activities.push([id, a])),
    pin: vi.fn((id: string) => {
      pins.push(id);
      return () => unpins.push(id);
    }),
  } as unknown as OfficeLife;
  const lifeSig = signal<OfficeLife | null>(null);
  const presence = signal<Record<string, PresenceData>>({});
  const localPresence = signal<Record<string, { speaking?: boolean; listening?: boolean }>>({});
  const jobs = signal<Record<string, JobSnapshot>>({});
  const teamWork = signal<Record<string, TeamWorkClaim>>({});
  const chiefState = signal('idle');
  const replying = signal<string | null>(null);
  let onSpeak: ((id: string, on: boolean) => void) | null = null;
  const timers: { fn: () => void; ms: number; cancelled: boolean }[] = [];
  const stop = bindPresence({
    scene,
    life: lifeSig,
    presence,
    localPresence,
    jobs,
    teamWork,
    chiefState,
    replying,
    ids: () => [CHIEF_ID, 'cw_kate'],
    onSpeakingChange: (cb) => {
      onSpeak = cb;
      return () => (onSpeak = null);
    },
    speakingNow: () => ['cw_kate'],
    schedule: (fn, ms) => {
      const t = { fn, ms, cancelled: false };
      timers.push(t);
      return () => (t.cancelled = true);
    },
  });
  const flush = () => {
    for (const t of timers.splice(0)) if (!t.cancelled) t.fn();
  };
  return { calls, speaking, lifeSig, life, presence, localPresence, jobs, teamWork, chiefState, replying, pins, unpins, activities, stop, flush, timers, speak: (id: string, on: boolean) => onSpeak?.(id, on) };
}

describe('presence in the office', () => {
  it('merges the server claim with local listening, never local speaking', () => {
    expect(shownClaim(undefined, { listening: true })).toMatchObject({ state: 'listening' });
    expect(shownClaim({ agentId: 'cw_kate', state: 'working', label: 'Drafting', causeSeq: 1, badges: ['lamp'] }, undefined)).toEqual({ state: 'working', label: 'Drafting', badges: ['lamp'] });
    expect(shownClaim(undefined, { speaking: true } as { listening?: boolean })).toMatchObject({ state: 'idle' });
  });

  it('sends each change once (diffed), and idle when a claim goes', () => {
    const r = rig();
    expect(r.calls).toHaveLength(0);
    r.presence.value = { cw_kate: { agentId: 'cw_kate', state: 'thinking', label: 'Thinking', causeSeq: null } };
    r.presence.value = { ...r.presence.value };
    expect(r.calls).toEqual([{ id: 'cw_kate', state: 'thinking', label: 'Thinking', badges: [] }]);
    r.localPresence.value = { [CHIEF_ID]: { listening: true } };
    expect(r.calls.at(-1)).toMatchObject({ id: CHIEF_ID, state: 'listening' });
    r.presence.value = {};
    expect(r.calls.at(-1)).toMatchObject({ id: 'cw_kate', state: 'idle', label: 'Available' });
    const n = r.calls.length;
    r.presence.value = {};
    expect(r.calls).toHaveLength(n);
    r.stop();
  });

  it('follows the audio playing in this tab', () => {
    const r = rig();
    expect(r.speaking).toEqual([['cw_kate', true]]);
    r.speak('cw_kate', false);
    expect(r.speaking.at(-1)).toEqual(['cw_kate', false]);
    r.stop();
    r.speak('cw_kate', true);
    expect(r.speaking).toHaveLength(2);
  });

  it('shows team project work: the step owner works at their workplace, the reviewer thinks, and both clear after', () => {
    const r = rig();
    r.lifeSig.value = r.life;
    r.teamWork.value = { cw_kate: { state: 'working', label: 'Researching the competition' }, cw_omar: { state: 'thinking', label: 'Reviewing: Draft the offer' } };
    expect(r.calls).toEqual(
      expect.arrayContaining([
        { id: 'cw_kate', state: 'working', label: 'Researching the competition', badges: [] },
        { id: 'cw_omar', state: 'thinking', label: 'Reviewing: Draft the offer', badges: [] },
      ]),
    );
    expect(r.activities).toContainEqual(['cw_kate', 'research']);
    expect(r.activities.some(([id]) => id === 'cw_omar')).toBe(false);
    // A live conversation still outranks the step (speaking > thinking > working).
    r.presence.value = { cw_kate: { agentId: 'cw_kate', state: 'thinking', label: 'Thinking', causeSeq: 1 } };
    expect(r.calls.at(-1)).toMatchObject({ id: 'cw_kate', state: 'thinking' });
    r.presence.value = {};
    r.teamWork.value = {};
    expect(r.calls.filter((c) => c.state === 'idle').map((c) => c.id).sort()).toEqual(['cw_kate', 'cw_omar']);
    expect(r.activities.at(-1)).toEqual(['cw_kate', null]);
    r.stop();
  });

  it("sets the Chief's activity from the running job (research → the library), once life runs", () => {
    const r = rig();
    r.jobs.value = { job_1: job({}) };
    expect(r.activities).toEqual([]);
    r.lifeSig.value = r.life;
    expect(r.activities).toEqual([[CHIEF_ID, 'research']]);
    r.jobs.value = { job_1: job({ label: 'Researching more suppliers', updatedAt: 'b' }) };
    expect(r.activities).toHaveLength(1);
    r.jobs.value = { job_1: job({ status: 'done' }) };
    expect(r.activities.at(-1)).toEqual([CHIEF_ID, null]);
    r.stop();
  });

  it("shows the Chief's running job as work (monitor lit, the running sentence), under any conversation state", () => {
    const r = rig();
    r.jobs.value = { job_1: job({ label: 'Pinning down what matters for the launch' }) };
    expect(r.calls.at(-1)).toEqual({ id: CHIEF_ID, state: 'working', label: 'Pinning down what matters for the launch', badges: [] });
    // Talking with the owner still shows as thinking; the job shows again after.
    r.presence.value = { [CHIEF_ID]: { agentId: CHIEF_ID, state: 'thinking', label: 'Thinking', causeSeq: 3 } };
    expect(r.calls.at(-1)).toMatchObject({ id: CHIEF_ID, state: 'thinking' });
    r.presence.value = {};
    expect(r.calls.at(-1)).toMatchObject({ id: CHIEF_ID, state: 'working' });
    // A coworker's job (Inc 1) is theirs to claim; a finished job leaves the Chief available.
    r.jobs.value = { job_1: job({ status: 'done', label: 'Done' }), job_2: job({ jobId: 'job_2' as JobSnapshot['jobId'], agentId: 'cw_kate' }) };
    expect(r.calls.at(-1)).toEqual({ id: CHIEF_ID, state: 'idle', label: 'Available', badges: [] });
    expect(r.calls.filter((c) => c.id === 'cw_kate')).toEqual([]);
    r.stop();
  });

  it('pins the Chief while a conversation lasts and 20 s after; a quick chat pins its person', () => {
    const r = rig();
    r.lifeSig.value = r.life;
    r.chiefState.value = 'thinking';
    r.chiefState.value = 'speaking';
    expect(r.pins).toEqual([CHIEF_ID]);
    r.chiefState.value = 'idle';
    expect(r.timers.at(-1)?.ms).toBe(UNPIN_AFTER_MS);
    expect(r.unpins).toEqual([]);
    r.flush();
    expect(r.unpins).toEqual([CHIEF_ID]);
    r.replying.value = 'cw_kate';
    expect(r.pins).toEqual([CHIEF_ID, 'cw_kate']);
    r.replying.value = null;
    r.replying.value = 'cw_kate';
    expect(r.pins).toEqual([CHIEF_ID, 'cw_kate']);
    r.replying.value = null;
    r.flush();
    expect(r.unpins).toEqual([CHIEF_ID, 'cw_kate']);
    r.replying.value = 'cw_kate';
    r.stop();
    expect(r.unpins).toEqual([CHIEF_ID, 'cw_kate', 'cw_kate']);
  });
});
