import { CHIEF_ID, makeFrame, type Frame, type FrameInput, type FrameType } from '@headcount/protocol';
import type { Decision, TeamProjectSnapshot } from '@headcount/protocol/ext/projects';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addPendingOwner,
  addPendingSide,
  applyFrame,
  chiefPresence,
  feedEpoch,
  markSideAccepted,
  sideThreads,
  jobs,
  lastSeq,
  localPresence,
  markOwnerAccepted,
  markOwnerFailed,
  mergeJobs,
  mergeProjects,
  onFrame,
  openDecisions,
  presenceFor,
  raisedHands,
  teamProjects,
  upsertProject,
  settings,
  presence,
  replayThrough,
  setLocalPresence,
  thread,
} from './index';

const at = (seq?: number) => (seq === undefined ? { after: 0 } : { seq });
const f = <T extends FrameType>(input: FrameInput<T>, seq?: number) => makeFrame('ws:local', input, at(seq)) as unknown as Frame;
const ready = (last: number) => f({ type: 'ready', data: { workspaceId: 'local', streamId: 'ws:local', lastSeq: last, replayFrom: 0, serverTime: '' } });

describe('store.applyFrame', () => {
  beforeEach(() => {
    lastSeq.value = 0;
    replayThrough.value = 0;
    thread.value = [];
    jobs.value = {};
    presence.value = {};
    localPresence.value = {};
  });

  it('assembles streamed replies and ignores replayed seqs', () => {
    applyFrame(f({ type: 'talk.owner', data: { turnId: 'turn_1', messageId: 'msg_o', text: 'hi', via: 'text' } }, 1));
    applyFrame(f({ type: 'talk.delta', data: { turnId: 'turn_1', messageId: 'msg_c', agentId: CHIEF_ID, delta: 'Hel' } }));
    applyFrame(f({ type: 'talk.delta', data: { turnId: 'turn_1', messageId: 'msg_c', agentId: CHIEF_ID, delta: 'lo' } }));
    expect(thread.value.map((m) => m.text)).toEqual(['hi', 'Hello']);
    applyFrame(f({ type: 'talk.message', data: { turnId: 'turn_1', messageId: 'msg_c', agentId: CHIEF_ID, text: 'Hello.', kind: 'reply' } }, 2));
    expect(applyFrame(f({ type: 'talk.owner', data: { turnId: 'turn_1', messageId: 'msg_o', text: 'dup', via: 'text' } }, 1))).toBe('ignored');
    // A straggling delta after the complete message changes nothing.
    applyFrame(f({ type: 'talk.delta', data: { turnId: 'turn_1', messageId: 'msg_c', agentId: CHIEF_ID, delta: '!!' } }));
    expect(thread.value.map((m) => [m.text, m.streaming])).toEqual([
      ['hi', false],
      ['Hello.', false],
    ]);
    expect(lastSeq.value).toBe(2);
  });

  it('a reply that finished writing after the next owner message stays with its own turn (live and replayed)', () => {
    applyFrame(f({ type: 'talk.owner', data: { turnId: 'turn_a', messageId: 'msg_oa', text: 'tell me about suppliers', via: 'text' } }, 1));
    applyFrame(f({ type: 'talk.owner', data: { turnId: 'turn_b', messageId: 'msg_ob', text: 'thanks', via: 'text' } }, 2));
    applyFrame(f({ type: 'talk.message', data: { turnId: 'turn_b', messageId: 'msg_cb', agentId: CHIEF_ID, text: 'Anytime.', kind: 'reflex' } }, 3));
    applyFrame(f({ type: 'talk.message', data: { turnId: 'turn_a', messageId: 'msg_ca', agentId: CHIEF_ID, text: 'Three stand out.', kind: 'reply' } }, 4));
    expect(thread.value.map((m) => m.text)).toEqual(['tell me about suppliers', 'Three stand out.', 'thanks', 'Anytime.']);
  });

  it('reconciles an optimistic owner message by opId (echo first or 202 first)', () => {
    addPendingOwner('op_a', 'look into suppliers', 'text');
    expect(thread.value[0]).toMatchObject({ messageId: 'local:op_a', status: 'pending' });
    // Echo arrives before the 202.
    applyFrame(makeFrame('ws:local', { type: 'talk.owner', opId: 'op_a', data: { turnId: 'turn_a', messageId: 'msg_a', text: 'look into suppliers', via: 'text' } }, { seq: 1 }) as Frame);
    expect(thread.value).toHaveLength(1);
    expect(thread.value[0]).toMatchObject({ messageId: 'msg_a', status: undefined });
    markOwnerAccepted({ accepted: true, opId: 'op_a', turnId: 'turn_a', messageId: 'msg_a' });
    expect(thread.value).toHaveLength(1);

    // 202 first, then the echo.
    addPendingOwner('op_b', 'and packaging', 'voice');
    markOwnerAccepted({ accepted: true, opId: 'op_b', turnId: 'turn_b', messageId: 'msg_b' });
    expect(thread.value[1]).toMatchObject({ messageId: 'msg_b', status: undefined, via: 'voice' });
    applyFrame(makeFrame('ws:local', { type: 'talk.owner', opId: 'op_b', data: { turnId: 'turn_b', messageId: 'msg_b', text: 'and packaging', via: 'voice' } }, { seq: 2 }) as Frame);
    expect(thread.value).toHaveLength(2);
  });

  it('keeps a failed message with its reason (text is never lost)', () => {
    addPendingOwner('op_c', 'hello', 'text');
    markOwnerFailed('op_c', 'Could not reach Headcount.');
    expect(thread.value[0]).toMatchObject({ text: 'hello', status: 'failed', error: 'Could not reach Headcount.' });
    // An error frame naming a command's opId marks that message too.
    addPendingOwner('op_d', 'again', 'text');
    applyFrame(f({ type: 'error', opId: 'op_d', data: { code: 'not_configured', message: 'Chat needs a key.', opId: 'op_d' } }));
    expect(thread.value[1]).toMatchObject({ status: 'failed', error: 'Chat needs a key.' });
    // Other errors become one quiet system line with the missing keys.
    applyFrame(f({ type: 'error', data: { code: 'provider_error', message: 'The model did not answer.', turnId: 'turn_x', missingKeys: ['OPENAI_API_KEY'] } }));
    expect(thread.value[2]).toMatchObject({ from: 'system', kind: 'error', missingKeys: ['OPENAI_API_KEY'] });
  });

  it('marks replayed frames as not live, and live ones as live', () => {
    const seen: [string, boolean][] = [];
    const off = onFrame((fr, { live }) => seen.push([fr.type, live]));
    applyFrame(ready(2));
    applyFrame(f({ type: 'talk.owner', data: { turnId: 'turn_1', messageId: 'msg_o', text: 'old', via: 'text' } }, 1));
    applyFrame(f({ type: 'talk.message', data: { turnId: 'turn_1', messageId: 'msg_c', agentId: CHIEF_ID, text: 'old reply', kind: 'reply' } }, 2));
    applyFrame(f({ type: 'talk.message', data: { turnId: null, messageId: 'msg_d', agentId: CHIEF_ID, text: 'new', kind: 'announcement' } }, 3));
    off();
    expect(seen).toEqual([
      ['talk.owner', false],
      ['talk.message', false],
      ['talk.message', true],
    ]);
  });

  it('asks for a resync when the server ledger is behind the cursor', () => {
    applyFrame(f({ type: 'talk.owner', data: { turnId: 'turn_1', messageId: 'msg_o', text: 'hi', via: 'text' } }, 7));
    addPendingOwner('op_keep', 'unsent', 'text');
    expect(applyFrame(ready(0))).toBe('resync');
    expect(lastSeq.value).toBe(0);
    expect(thread.value.map((m) => m.text)).toEqual(['unsent']);
  });

  it('tracks the job lifecycle with steers', () => {
    const job = { jobId: 'job_1', projectId: 'everyday', title: 'Suppliers', brief: 'look into suppliers', status: 'running', label: 'Starting', step: 0, of: 3, agentId: CHIEF_ID, startedAt: 't0', updatedAt: 't0', steers: [] } as const;
    applyFrame(f({ type: 'job.started', data: { job: { ...job, steers: [] } } }, 1));
    applyFrame(f({ type: 'job.progress', data: { jobId: 'job_1', label: 'Reading reviews', step: 1, of: 3 } }, 2));
    applyFrame(f({ type: 'job.steered', data: { jobId: 'job_1', steerId: 'steer_1', text: 'also mailers', status: 'queued' } }, 3));
    applyFrame(f({ type: 'job.steered', data: { jobId: 'job_1', steerId: 'steer_1', text: 'also mailers', status: 'applied' } }, 4));
    expect(jobs.value.job_1!.steers).toHaveLength(1);
    expect(jobs.value.job_1!.steers[0]).toMatchObject({ status: 'applied' });
    applyFrame(f({ type: 'job.done', data: { jobId: 'job_1', summary: 's', result: '# r', finishedText: 'Finished' } }, 5));
    expect(jobs.value.job_1).toMatchObject({ status: 'done', label: 'Finished', step: 1, result: '# r' });
  });

  it('never lets replayed or older settings roll the workspace back', () => {
    const at = (iso: string, leadId: string | null) => ({ workspaceId: 'local', leadId, chiefName: null, voiceOn: true, updatedAt: iso });
    settings.value = at('2026-01-01T00:00:05.000Z', 'lead-a');
    applyFrame(ready(3));
    applyFrame(f({ type: 'workspace.updated', data: { settings: at('2026-01-01T00:00:01.000Z', null) } }, 1));
    expect(settings.value?.leadId).toBe('lead-a');
    applyFrame(f({ type: 'workspace.updated', data: { settings: at('2026-01-01T00:00:09.000Z', 'lead-b') } }, 4));
    expect(settings.value?.leadId).toBe('lead-b');
    applyFrame(f({ type: 'workspace.updated', data: { settings: at('2026-01-01T00:00:07.000Z', 'lead-c') } }, 5));
    expect(settings.value?.leadId).toBe('lead-b');
    settings.value = null;
  });

  it('merges job snapshots from GET /api/jobs without rolling back newer frames', () => {
    const snap = (id: string, updatedAt: string, label: string) => ({ jobId: id, projectId: 'everyday', title: id, brief: id, status: 'running', label, step: 2, of: 4, agentId: CHIEF_ID, startedAt: '2026-01-01T00:00:00.000Z', updatedAt, steers: [] }) as never;
    mergeJobs([snap('job_a', '2026-01-01T00:00:05.000Z', 'Reading')]);
    expect(jobs.value.job_a?.label).toBe('Reading');
    mergeJobs([snap('job_a', '2026-01-01T00:00:01.000Z', 'Older'), snap('job_b', '2026-01-01T00:00:02.000Z', 'Planning')]);
    expect(jobs.value.job_a?.label).toBe('Reading');
    expect(jobs.value.job_b?.label).toBe('Planning');
    mergeJobs([snap('job_a', '2026-01-01T00:00:09.000Z', 'Comparing')]);
    expect(jobs.value.job_a?.label).toBe('Comparing');
  });

  it('merges local speaking over server claims, and a finished turn ends thinking', () => {
    applyFrame(f({ type: 'presence', data: { agentId: CHIEF_ID, state: 'thinking', label: 'Thinking about suppliers', causeSeq: 1 } }));
    expect(chiefPresence.value).toEqual({ state: 'thinking', label: 'Thinking about suppliers' });
    setLocalPresence(CHIEF_ID, 'speaking', true);
    expect(chiefPresence.value.state).toBe('speaking');
    setLocalPresence(CHIEF_ID, 'speaking', false);
    applyFrame(f({ type: 'talk.done', data: { turnId: 'turn_1', messageId: null, finish: 'stop' } }, 1));
    expect(chiefPresence.value.state).toBe('idle');
  });
});

describe('Floor quick-chats (Inc 0.5)', () => {
  beforeEach(() => {
    lastSeq.value = 0;
    replayThrough.value = 0;
    thread.value = [];
    sideThreads.value = {};
    presence.value = {};
    localPresence.value = {};
  });

  it('routes floor frames to the coworker’s side-thread, never to the Talk transcript', () => {
    const cw = 'cw_tech-lead';
    addPendingSide(cw, 'op_1', 'what do you do?');
    markSideAccepted(cw, { accepted: true, opId: 'op_1', agentId: cw, turnId: 'turn_s', messageId: 'msg_o' });
    applyFrame(f({ type: 'talk.owner', data: { turnId: 'turn_s', messageId: 'msg_o', text: 'what do you do?', via: 'text', agentId: cw, surface: 'floor' }, opId: 'op_1' }, 1));
    applyFrame(f({ type: 'talk.delta', data: { turnId: 'turn_s', messageId: 'msg_r', agentId: cw, delta: 'I design systems', surface: 'floor' } }));
    applyFrame(f({ type: 'talk.message', data: { turnId: 'turn_s', messageId: 'msg_r', agentId: cw, text: 'I design systems that last.', kind: 'reply', surface: 'floor' } }, 2));
    applyFrame(f({ type: 'talk.done', data: { turnId: 'turn_s', messageId: 'msg_r', agentId: cw, surface: 'floor', finish: 'stop', route: 'answer' } }, 3));
    expect(thread.value).toEqual([]);
    expect(sideThreads.value[cw]!.map((m) => [m.from, m.text, m.streaming, m.status])).toEqual([
      ['owner', 'what do you do?', false, undefined],
      [cw, 'I design systems that last.', false, undefined],
    ]);
  });

  it('a coworker’s finished turn never resets the Chief’s face; the Chief’s own does', () => {
    applyFrame(f({ type: 'presence', data: { agentId: CHIEF_ID, state: 'thinking', label: 'Thinking', causeSeq: 1 } }));
    applyFrame(f({ type: 'talk.done', data: { turnId: 'turn_s', messageId: null, agentId: 'cw_tech-lead', surface: 'floor', finish: 'stop' } }, 1));
    expect(chiefPresence.value.state).toBe('thinking');
    applyFrame(f({ type: 'talk.done', data: { turnId: 'turn_c', messageId: null, finish: 'stop' } }, 2));
    expect(chiefPresence.value.state).toBe('idle');
  });

  it('a reflex reply is a normal message in the transcript, marked as a reflex', () => {
    applyFrame(f({ type: 'talk.message', data: { turnId: 'turn_t', messageId: 'msg_t', agentId: CHIEF_ID, text: 'Anytime.', kind: 'reflex', intent: 'gratitude_reply', lineId: 'warm.gratitude_reply.01' } }, 1));
    expect(thread.value.map((m) => [m.text, m.kind])).toEqual([['Anytime.', 'reflex']]);
  });

  it('counts every ready frame (the living layer re-sends its state then)', () => {
    const before = feedEpoch.value;
    applyFrame(ready(0));
    applyFrame(ready(0));
    expect(feedEpoch.value).toBe(before + 2);
  });
});

describe('team projects (Inc 1)', () => {
  const step = (id: string, over: Partial<TeamProjectSnapshot['steps'][number]> = {}): TeamProjectSnapshot['steps'][number] => ({
    id,
    title: `Step ${id}`,
    brief: 'b',
    acceptance: 'a',
    ownerId: 'maya',
    reviewerIds: ['omar'],
    dependsOn: [],
    status: 'waiting',
    ...over,
  });
  const proj = (over: Partial<TeamProjectSnapshot> = {}): TeamProjectSnapshot => ({
    projectId: 'prj_abcdefgh',
    title: 'Spring menu launch',
    goal: 'Launch our spring menu',
    recipeId: 'r',
    recipeName: 'Launch',
    staffingNote: 'Maya leads.',
    team: [],
    steps: [step('s1'), step('s2', { ownerId: 'lee' })],
    status: 'proposed',
    decisionId: 'dec_1',
    createdAt: '2026-09-29T10:00:00Z',
    updatedAt: '2026-09-29T10:00:00Z',
    ...over,
  });
  const decision = (over: Partial<Decision> = {}): Decision => ({ decisionId: 'dec_1', kind: 'plan_approval', projectId: 'prj_abcdefgh', title: 'Start?', body: 'b', status: 'open', createdAt: '2026-09-29T10:00:00Z', ...over });

  beforeEach(() => {
    lastSeq.value = 0;
    replayThrough.value = 0;
    teamProjects.value = {};
    openDecisions.value = {};
    presence.value = {};
    localPresence.value = {};
  });

  it('a proposal raises a hand in the Inbox; resolving it lowers the hand', () => {
    applyFrame(f({ type: 'project.proposed', data: { project: proj(), decision: decision() } }, 1));
    expect(raisedHands.value).toBe(1);
    expect(teamProjects.value.prj_abcdefgh?.status).toBe('proposed');
    applyFrame(f({ type: 'project.updated', data: { project: proj({ status: 'running', updatedAt: '2026-09-29T10:01:00Z' }) } }, 2));
    applyFrame(f({ type: 'decision.resolved', data: { decision: decision({ status: 'approved' }) } }, 3));
    expect(raisedHands.value).toBe(0);
    expect(teamProjects.value.prj_abcdefgh?.status).toBe('running');
  });

  it('never reopens a hand for a project that has moved on, nor rolls a project back', () => {
    mergeProjects({ projects: [proj({ status: 'running', updatedAt: '2026-09-29T10:05:00Z' })], decisions: [] });
    applyFrame(f({ type: 'project.proposed', data: { project: proj(), decision: decision() } }, 1));
    expect(raisedHands.value).toBe(0);
    expect(teamProjects.value.prj_abcdefgh?.status).toBe('running');
  });

  it('keeps the full output it already holds when a clipped frame arrives', () => {
    const full = 'A'.repeat(3000);
    upsertProject(proj({ status: 'done', updatedAt: '2026-09-29T11:00:00Z', steps: [step('s1', { status: 'done', output: full })], deliverable: full }));
    upsertProject(proj({ status: 'done', updatedAt: '2026-09-29T11:00:00Z', steps: [step('s1', { status: 'done', output: `${'A'.repeat(1200)}…` })], deliverable: `${'A'.repeat(1200)}…` }));
    expect(teamProjects.value.prj_abcdefgh?.steps[0]?.output).toBe(full);
    expect(teamProjects.value.prj_abcdefgh?.deliverable).toBe(full);
  });

  it('raises a hand on the lead’s face while the plan waits for the owner', () => {
    upsertProject(proj({ team: [{ personaId: 'lee', name: 'Lee Park', title: 'PM', role: 'specialist', why: '' }, { personaId: 'maya', name: 'Maya Cruz', title: 'Growth', role: 'lead', why: '' }] }));
    expect(presenceFor('cw_maya')).toEqual({ state: 'raised_hand', label: 'Waiting on you: Spring menu launch' });
    expect(presenceFor('cw_lee').state).toBe('idle');
    upsertProject(proj({ status: 'running', updatedAt: '2026-09-29T10:01:00Z' }));
    expect(presenceFor('cw_maya').state).toBe('idle');
  });

  it('shows staffed coworkers as working on their step, and reviewers as thinking', () => {
    upsertProject(proj({ status: 'running', steps: [step('s1', { status: 'working', title: 'Draft the offer' }), step('s2', { ownerId: 'lee', status: 'reviewing', title: 'Price it', reviewerIds: ['omar'] })] }));
    expect(presenceFor('cw_maya')).toEqual({ state: 'working', label: 'Draft the offer' });
    expect(presenceFor('cw_omar')).toEqual({ state: 'thinking', label: 'Reviewing: Price it' });
    expect(presenceFor('cw_lee').state).toBe('idle');
    upsertProject(proj({ status: 'cancelled', updatedAt: '2026-09-29T10:09:00Z' }));
    expect(presenceFor('cw_maya').state).toBe('idle');
  });
});
