import { describe, expect, it } from 'vitest';
import { attentionChangedData, clipUrl, isExpressionFrame, moodChangedData, reflexSayData, sideTalkLineData } from './frames';
import { mergeAttention } from './actor';
import { applyMoodEvent, createMoodState } from './mood';
import { createRecencyMemory } from './recency';
import { selectLine } from './select';
import { proposeSideTalk, sideTalkText } from './sidetalk';
import { fixtureCatalog, fixtureIndex, makeState, T0 } from './testing';
import type { AgentIndex, SideTalkContext, SideTalkEvent } from './types';
import type { Ambience } from './vocab';

const catalog = fixtureCatalog();
const indexes: Record<string, AgentIndex> = { 'cw_red-team-sceptic': fixtureIndex('ruth'), 'cw_data-analyst': fixtureIndex('camila'), cw_chief: fixtureIndex('chief') };
const names: Record<string, string> = { 'cw_red-team-sceptic': 'Ruth', 'cw_data-analyst': 'Camila', cw_chief: 'Samuel' };

function ctx(over: Partial<SideTalkContext> & { ambience?: Ambience } = {}): SideTalkContext {
  return {
    catalog,
    index: (id) => indexes[id] ?? null,
    state: (id) => (names[id] ? makeState(id, names[id]!, { self: { presence: 'working' }, project: { id: 'prj_nw01', shortName: 'Northwind', client: null } }) : null),
    mood: () => ({ valence: 0.2, energy: 0.1 }),
    ambience: 'lively',
    recency: createRecencyMemory(),
    provider: 'xai',
    now: T0,
    lastPodLineAt: () => null,
    lastAgentLineAt: () => null,
    ...over,
  };
}
const handoff: SideTalkEvent = {
  kind: 'handoff', from: 'cw_data-analyst', to: 'cw_red-team-sceptic', projectId: 'prj_nw01', cause: { streamId: 'p:prj_nw01', seq: 1839 },
  gist: 'Competitor grid, 14 sources in the folder. See https://drive.example/x for more.', visibility: 'team',
};

describe('proposeSideTalk (§8.3)', () => {
  it('turns a real hand-off into an opener and a reply, with the event’s own gist', () => {
    const p = proposeSideTalk(handoff, ctx())!;
    expect(p.threadId).toBe('st_p:prj_nw01:1839');
    expect(p.lines.map((l) => [l.agentId, l.intent])).toEqual([['cw_data-analyst', 'handoff_give'], ['cw_red-team-sceptic', 'handoff_take']]);
    const [opener, reply] = p.lines;
    expect(opener!.gist).toBe('Competitor grid, 14 sources in the folder.');
    expect(opener!.utterance.caption).toMatch(/Ruth/);
    expect(sideTalkText(opener!).text).toMatch(/— competitor grid, 14 sources in the folder\.$/);
    expect(reply!.gist).toBeNull();
    expect(reply!.atMs).toBeGreaterThan(opener!.atMs + opener!.utterance.estMs);
    expect(opener!.atMs).toBeGreaterThanOrEqual(300);
    expect(p.expiresAt).toBeGreaterThan(T0 + reply!.atMs);
    expect(proposeSideTalk(handoff, ctx())).toEqual(p); // deterministic: replay regenerates it
  });
  it('never surfaces whispers, owner-only events, or anything in Quiet', () => {
    expect(proposeSideTalk({ ...handoff, visibility: 'owner_only' }, ctx())).toBeNull();
    expect(proposeSideTalk({ ...handoff, visibility: 'private' }, ctx())).toBeNull();
    expect(proposeSideTalk(handoff, ctx({ ambience: 'quiet' }))).toBeNull();
  });
  it('respects the pod gap and the per-agent gaps', () => {
    expect(proposeSideTalk(handoff, ctx({ lastPodLineAt: () => T0 - 10_000 }))).toBeNull();
    expect(proposeSideTalk(handoff, ctx({ ambience: 'buzzing', lastPodLineAt: () => T0 - 20_000 }))).toBeNull(); // Buzzing pod gap 30 s (E9)
    expect(proposeSideTalk(handoff, ctx({ ambience: 'buzzing', lastPodLineAt: () => T0 - 31_000 }))).not.toBeNull();
    expect(proposeSideTalk(handoff, ctx({ lastAgentLineAt: (id) => (id === 'cw_data-analyst' ? T0 - 60_000 : null) }))).toBeNull();
    const oneLine = proposeSideTalk(handoff, ctx({ lastAgentLineAt: (id) => (id === 'cw_red-team-sceptic' ? T0 - 60_000 : null) }))!;
    expect(oneLine.lines).toHaveLength(1);
  });
  it('needs evidence: no artifact, no share_result; no verdict, no review line; no counterpart, no opener', () => {
    expect(proposeSideTalk({ ...handoff, kind: 'job.done', gist: 'Grid done.' }, ctx())).toBeNull();
    const shared = proposeSideTalk({ ...handoff, kind: 'job.done', artifact: 'the competitor grid', gist: 'Fourteen competitors, three surprises.' }, ctx())!;
    expect(shared.lines[0]!.intent).toBe('share_result');
    expect(proposeSideTalk({ ...handoff, kind: 'verdict' }, ctx())).toBeNull();
    expect(proposeSideTalk({ ...handoff, to: 'cw_unknown' }, ctx())).toBeNull();
  });
  it('reviews: counts come from the verdict, and the author answers in kind', () => {
    const ev: SideTalkEvent = { kind: 'verdict', from: 'cw_red-team-sceptic', to: 'cw_data-analyst', projectId: 'prj_nw01', cause: { streamId: 'p:prj_nw01', seq: 1900 }, verdict: 'changes', findingCount: 2, visibility: 'team' };
    const seen = new Set<string>();
    for (let seq = 1900; seq < 1940; seq++) {
      const p = proposeSideTalk({ ...ev, cause: { ...ev.cause, seq } }, ctx())!;
      expect(p.lines[0]!.intent).toBe('review_changes');
      seen.add(p.lines[0]!.utterance.caption);
      if (p.lines[1]) expect(p.lines[1].utterance.caption).toBe('On it, thanks.');
    }
    expect([...seen].some((c) => c.includes('two'))).toBe(true);
    const approve = proposeSideTalk({ ...ev, verdict: 'approve' }, ctx())!;
    expect(approve.lines[0]!.intent).toBe('review_approve');
  });
  it('chains up to max_chain: two lines in Lively, three in Buzzing', () => {
    const done: SideTalkEvent = { kind: 'project.done', from: 'cw_data-analyst', to: 'cw_red-team-sceptic', projectId: 'prj_nw01', cause: { streamId: 'p:prj_nw01', seq: 2000 }, visibility: 'team' };
    expect(proposeSideTalk(done, ctx())!.lines).toHaveLength(2);
    expect(proposeSideTalk(done, ctx({ ambience: 'buzzing' }))!.lines).toHaveLength(3);
  });
  it('never names the owner', () => {
    for (let seq = 0; seq < 60; seq++) {
      for (const kind of ['handoff', 'ask', 'ask.answered', 'project.done'] as const) {
        const p = proposeSideTalk({ ...handoff, kind, cause: { streamId: 'p:prj_nw01', seq } }, ctx({ ambience: 'buzzing' }));
        for (const l of p?.lines ?? []) expect(sideTalkText(l).text).not.toMatch(/Dana/);
      }
    }
  });
});

describe('frame builders (§10.4)', () => {
  it('reflex.say, sidetalk.line, mood.changed and attention.changed', () => {
    const chief = indexes.cw_chief!;
    const r = selectLine(chief, { intent: 'gratitude_reply', state: makeState('cw_chief', 'Samuel'), mood: { valence: 0.3, energy: 0 }, ambience: 'lively', provider: 'xai', seed: 's', now: T0, channel: 'voice' }, createRecencyMemory());
    if (!r.ok) throw new Error(r.reason);
    const say = reflexSayData(r.utterance, { voice: true, bubble: true, caption: 'line', face: null, gainDb: 0, priority: 1, ttlMs: 1500, delayMs: 300 }, {
      audience: 'owner', clip: { key: 'c1_abc', durationMs: 820 }, turnId: 'turn_1', cause: { streamId: 'ws:local', seq: 811 },
    });
    expect(say).toMatchObject({ agentId: 'cw_chief', intent: 'gratitude_reply', caption: r.utterance.caption, render: null, audience: 'owner', turnId: 'turn_1' });
    expect(say.clip).toEqual({ key: 'c1_abc', url: clipUrl('c1_abc'), durationMs: 820, alignmentUrl: '/api/expr/clips/c1_abc/align' });
    expect(say.face).toEqual(r.utterance.face);
    const noClip = reflexSayData(r.utterance, { voice: true, bubble: false, caption: 'line', face: null, gainDb: 0, priority: 1, ttlMs: 1500, delayMs: 0 }, { audience: 'owner' });
    expect(noClip.render).toEqual({ lineId: r.utterance.lineId, fills: r.utterance.fills });
    expect(isExpressionFrame({ type: 'reflex.say', data: say })).toBe(true);
    expect(isExpressionFrame({ type: 'talk.delta', data: {} })).toBe(false);

    const p = proposeSideTalk(handoff, ctx())!;
    const line = sideTalkLineData(p, p.lines[0]!, { voice: 'listen_in', clip: { key: 'c1_x', durationMs: 900 } });
    expect(line).toMatchObject({ threadId: p.threadId, index: 0, projectId: 'prj_nw01', agentId: 'cw_data-analyst', toAgentId: 'cw_red-team-sceptic', voice: 'listen_in', replyable: true, gist: 'Competitor grid, 14 sources in the folder.' });
    expect(line.text.startsWith(line.opener)).toBe(true);
    expect(new Date(line.expiresAt).getTime()).toBe(p.expiresAt);

    const s = applyMoodEvent(createMoodState('cw_chief', { valence: 0.1, energy: 0.1 }, 0.8, T0), { kind: 'verdict.approve', at: T0, cause: { streamId: 'p:prj_nw01', seq: 1840 } });
    const mood = moodChangedData(s, T0, 'idle')!;
    expect(mood).toMatchObject({ agentId: 'cw_chief', reason: 'verdict.approve', cause: { streamId: 'p:prj_nw01', seq: 1840 }, baseline: { valence: 0.1, energy: 0.1 } });
    expect(mood.valence).toBeGreaterThan(0.1);
    expect(moodChangedData(createMoodState('x', { valence: 0, energy: 0 }, 1, T0), T0, 'idle')).toBeNull();

    const view = mergeAttention('cw_lena', [
      { id: 'rm_nw01', kind: 'meeting', mailbox: 'floor', host: 'rm:rm_nw01', label: 'the Northwind review', voice: { speaking: true, untilMs: T0 + 5000 }, floorHeld: true, interruptible: 'sentence', since: T0 },
      { id: 'job_7c', kind: 'work', mailbox: 'work', host: 'p:prj_nw01', label: 'Drafting the tier pricing page', voice: { speaking: false, untilMs: null }, floorHeld: false, interruptible: 'checkpoint', since: T0 },
    ], T0);
    expect(attentionChangedData(view)).toEqual({
      agentId: 'cw_lena',
      focus: { threadId: 'rm_nw01', kind: 'meeting', label: 'the Northwind review' },
      background: [{ threadId: 'job_7c', kind: 'work', label: 'Drafting the tier pricing page' }],
      voiceBusyUntil: new Date(T0 + 5000).toISOString(),
      floorHeld: true,
    });
  });
});
