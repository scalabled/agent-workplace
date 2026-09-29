// The worker against the Inc 0.5 feel and correctness review: the safety-net filler never speaks on a sincere "are you
// an AI?", distress or a joke; a repeat hello is voiced; a phatic "thanks" never cuts the answer still being written;
// a pre-voice run with failures or a renamed Chief is planned again; the clip budget fails closed; the quick-chat
// honesty guard reads curly apostrophes; the Chief's reply never laughs or acknowledges a second time.
import type { ModelEvent } from '@headcount/models';
import { CHIEF_ID, type Frame } from '@headcount/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { exprSetup, fakeTts, gate, isTalk, sleep, useProviders, type SpeechCall } from '../../test/expr-kit';
import { claimsWork } from '../desk/desk';
import { CoveredOpenerFilter, turnNoteFor } from '../workspace/talk';
import { defaultRuntime, runtime } from '../workspace/runtime';
import { defaultExprTiming, exprTiming } from './config';

afterEach(() => {
  Object.assign(runtime, defaultRuntime);
  Object.assign(exprTiming, defaultExprTiming);
});

const XAI = { XAI_API_KEY: 'xai-test-key' };
const says = (frames: Frame[], intent?: string) => frames.filter((f): f is Extract<Frame, { type: 'reflex.say' }> => f.type === 'reflex.say' && (!intent || f.data.intent === intent));

describe('the thinking-filler safety net (critical)', () => {
  it('never fires on a sincere "are you an AI?", on distress or on a joke; a slow question still gets one', async () => {
    exprTiming.fillerVoiceMs = 30;
    // Every model turn is slow (held) until the test lets it go, so the safety net has its chance each time.
    let hold = gate();
    useProviders({ chat: { before: async (req) => (isTalk(req) ? hold.opened : undefined) } });
    const s = await exprSetup();
    await s.view();
    const heldTurn = async (text: string, opId: string) => {
      hold = gate();
      const r = await s.ws.talk({ text, opId, via: 'voice' });
      if (!r.accepted) throw new Error(r.message);
      await sleep(80);
      const fillers = says(s.live(), 'thinking_filler').filter((f) => f.data.turnId === r.turnId);
      hold.open();
      await s.drain();
      return fillers;
    };
    expect(await heldTurn('Honestly, are you a real person or an AI?', 'op_ai')).toEqual([]);
    expect(await heldTurn('My dad is in the hospital and I am really scared.', 'op_d')).toEqual([]);
    expect(await heldTurn('Ha ha, the printer is haunted again.', 'op_j')).toEqual([]);
    expect(await heldTurn('What would you cut first from the budget?', 'op_q')).toHaveLength(1);
  });
});

describe('phatic replies are the answer (correctness)', () => {
  it('voices a second "hi" inside the greeting cooldown like any other answer', async () => {
    useProviders();
    const s = await exprSetup();
    await s.view();
    await s.talk('hi');
    await s.talk('hello');
    const again = says(s.live(), 'greeting').at(-1)!;
    expect(again.data.channels.voice).toBe(true);
    expect((await s.ofType('talk.message')).at(-1)!.data).toMatchObject({ kind: 'reflex', intent: 'greeting' });
  });

  it('a "thanks" while the answer is still being written never cuts it', async () => {
    const hold = gate();
    useProviders({
      chat: {
        before: async (req) => (isTalk(req) ? hold.opened : undefined),
        events: (req) => (isTalk(req) ? ([{ type: 'text', delta: 'Three suppliers stand out, and here is why.' }, { type: 'done', finish: 'stop' }] as ModelEvent[]) : null),
      },
    });
    const s = await exprSetup();
    await s.view();
    const a = await s.ws.talk({ text: 'Which packaging suppliers look best?', opId: 'op_a', via: 'text' });
    await sleep(10);
    const b = await s.ws.talk({ text: 'thanks', opId: 'op_b', via: 'text' });
    await sleep(20);
    // The reply to "thanks" is already there; the first answer is still writing.
    expect((await s.ofType('talk.message')).map((m) => m.data.kind)).toEqual(['reflex']);
    hold.open();
    await s.drain();
    if (!a.accepted || !b.accepted) throw new Error('not accepted');
    const done = (await s.ofType('talk.done')).map((f) => [f.data.turnId, f.data.finish]);
    expect(done).toContainEqual([a.turnId, 'stop']);
    expect(done).toContainEqual([b.turnId, 'stop']);
    const first = (await s.ofType('talk.message')).find((m) => m.data.turnId === a.turnId)!;
    expect(first.data.text).toBe('Three suppliers stand out, and here is why.');
    // The face stays on Thinking until the answer behind the "thanks" is written.
    expect(s.liveOf('presence').map((p) => p.data.state).at(-1)).toBe('idle');
  });
});

describe('pre-voicing is never stuck (correctness)', () => {
  it('a finished run with failed items is not reused: the next request plans again and renders what is missing', async () => {
    const calls: SpeechCall[] = [];
    useProviders({ speech: { xai: fakeTts('xai', calls, { fail: () => new Error('401 invalid key') }) } });
    const s = await exprSetup(XAI);
    const req = { agentIds: ['cw_chief'], tiers: ['p0'] };
    const first = await s.api('POST', '/api/expr/prevoice', req);
    await s.runPrevoice();
    const status = (await s.api('GET', `/api/expr/prevoice/${first.body.runId}`)).body;
    expect(status.state).toBe('done');
    expect(status.failed).toBeGreaterThan(0);
    // The key is fixed: the same plan is not "reused" as if everything were stored.
    useProviders({ speech: { xai: fakeTts('xai', calls) } });
    const again = await s.api('POST', '/api/expr/prevoice', req);
    expect(again.body.reused).toBeUndefined();
    expect(again.body.runId).not.toBe(first.body.runId);
    expect(again.body.toRender).toBeGreaterThan(0);
    await s.runPrevoice();
    const clean = (await s.api('GET', `/api/expr/prevoice/${again.body.runId}`)).body;
    expect(clean).toMatchObject({ state: 'done', failed: 0 });
    // A clean run is reused, and says what is really stored.
    const third = await s.api('POST', '/api/expr/prevoice', req);
    expect(third.body).toMatchObject({ reused: true, runId: again.body.runId, toRender: 0 });
    expect(third.body.alreadyCached).toBe(clean.cached + clean.rendered);
  });

  it('a renamed Chief is a new plan: the lines with the new name are rendered', async () => {
    const calls: SpeechCall[] = [];
    useProviders({ speech: { xai: fakeTts('xai', calls) } });
    const s = await exprSetup(XAI);
    const req = { agentIds: ['cw_chief'], tiers: ['p0'] };
    const first = await s.api('POST', '/api/expr/prevoice', req);
    await s.runPrevoice();
    await s.ws.updateSettings({ chiefName: 'Bea' });
    const renamed = await s.api('POST', '/api/expr/prevoice', req);
    expect(renamed.body.reused).toBeUndefined();
    expect(renamed.body.runId).not.toBe(first.body.runId);
    await s.runPrevoice();
    const said = calls.slice(first.body.toRender).map((c) => c.req.text);
    if (renamed.body.toRender > 0) expect(said.some((t) => t.includes('Bea'))).toBe(true);
    else expect(renamed.body.alreadyCached).toBe(renamed.body.planned);
  });

  it('fails closed when the clip budget cannot be read: no uncounted paid renders', async () => {
    const calls: SpeechCall[] = [];
    useProviders({ speech: { xai: fakeTts('xai', calls) } });
    const s = await exprSetup(XAI);
    const db = s.t.env.DB!;
    const prepare = db.prepare.bind(db);
    (db as { prepare: typeof db.prepare }).prepare = (sql: string) => {
      if (/media_usage/.test(sql)) throw new Error('D1_ERROR: no such table: media_usage');
      return prepare(sql);
    };
    const r = await s.api('POST', '/api/expr/prevoice', { agentIds: ['cw_chief'], tiers: ['p0'] });
    expect(r.status).toBe(500);
    expect(r.body.error.message).toMatch(/budget could not be read/);
    const ack = await s.api('POST', '/api/expr/render', { agentId: CHIEF_ID, lineId: 'lead-warm-mentor.acknowledge.01', fills: {}, provider: 'xai' });
    expect(ack.status).toBe(500);
    expect(calls).toHaveLength(0);
  });
});

describe('the job-done celebration leads straight into its announcement (feel)', () => {
  it('waits for an announcement the fast model is still writing, then plays right before it', async () => {
    useProviders();
    const s = await exprSetup();
    await s.view();
    const done = { type: 'job.done', streamId: 'prj:local:everyday', seq: 7, ts: new Date().toISOString(), actor: CHIEF_ID, data: { jobId: 'job_candles', summary: 'Three suppliers compared.' } } as unknown as Frame;
    await s.ws.expr.onMirrored(done, { announcementPending: true });
    expect(says(s.live(), 'celebrate')).toEqual([]);
    expect(s.liveOf('mood.changed').at(-1)!.data.reason).toBe('job.done'); // the face brightens at once
    await s.ws.expr.celebratePending('job_candles');
    expect(says(s.live(), 'celebrate')).toHaveLength(1);
    await s.ws.expr.celebratePending('job_candles'); // once
    expect(says(s.live(), 'celebrate')).toHaveLength(1);
  });
});

describe('the quick-chat honesty guard (correctness)', () => {
  it('reads curly apostrophes and common promise phrasings', () => {
    for (const s of ['I’ll send it over tonight.', 'I’ll draft a plan by Friday.', 'I’ll have it on your desk by noon.', 'I can pull that report together by Friday.', 'We’ll put together a deck.', 'Let me look into it.']) {
      expect(claimsWork(s), s).toBe(true);
    }
    for (const s of ['I’ll have to ask around.', 'I could never do that job.', 'I can’t send anything, I’m not on a project.', 'Pricing is my favourite puzzle.']) {
      expect(claimsWork(s), s).toBe(false);
    }
  });
});

describe('the reply never repeats the reflex (feel)', () => {
  it('drops a leading laugh or acknowledgement when a reflex covered the turn, and keeps it otherwise', () => {
    const run = (covered: boolean, parts: string[]) => {
      const f = new CoveredOpenerFilter(() => covered);
      return parts.map((p) => f.push(p)).join('') + f.flush();
    };
    expect(run(true, ['Ha, ', "she's got the paw-tfolio."])).toBe("She's got the paw-tfolio.");
    expect(run(true, ['On it — ', 'I started a search for three suppliers.'])).toBe('I started a search for three suppliers.');
    expect(run(true, ['Ooh, ', 'subscription box — good idea.'])).toBe('Subscription box — good idea.');
    expect(run(true, ['Ha!'])).toBe('Ha!');
    expect(run(false, ['Ha, ', 'she is funny.'])).toBe('Ha, she is funny.');
    expect(run(true, ['Honestly, the margins are thin.'])).toBe('Honestly, the margins are thin.');
  });

  it('tells the model what the office already said, and about repeated openers and offers', () => {
    const joke = { humor: 0.9, question: false, request: 0, stopOrSteer: 0, badNews: 0, goodNews: 0, distress: false, sincereAi: false } as Parameters<typeof turnNoteFor>[0];
    expect(turnNoteFor(joke, [])).toContain('already laughed or smiled aloud for you');
    const note = turnNoteFor(undefined, ['On it — I started the search. Want me to add a fourth?']);
    expect(note).toContain('do not offer again');
    expect(note).toContain('Your last reply began with "On"');
  });
});
