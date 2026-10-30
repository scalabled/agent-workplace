// The optional ⟦react:…⟧ head token (LIVING-PLAN §4 A10): parsed while streaming, its hint rides on the first delta, and
// the token never reaches a delta, the persisted message, the history or TTS.
import type { ModelEvent } from '@headcount/models';
import { afterEach, describe, expect, it } from 'vitest';
import { exprSetup, isTalk, useProviders } from '../../test/expr-kit';
import { buildChiefSystemPrompt } from './chief-prompt';
import { ReactHintSplitter } from './talk';
import { defaultRuntime, runtime } from './runtime';

afterEach(() => Object.assign(runtime, defaultRuntime));

const text = (deltas: string[]): ModelEvent[] => [...deltas.map((d) => ({ type: 'text', delta: d }) as ModelEvent), { type: 'done', finish: 'stop' } as ModelEvent];

describe('ReactHintSplitter', () => {
  it('strips a token split across deltas and attaches the hint to the first text', () => {
    const h = new ReactHintSplitter();
    expect(h.push('⟦re')).toEqual({ text: '', hint: null });
    expect(h.push('act:la')).toEqual({ text: '', hint: null });
    expect(h.push('ugh⟧ Ha')).toEqual({ text: 'Ha', hint: 'laugh' });
    expect(h.push(', fair.')).toEqual({ text: ', fair.', hint: null });
  });

  it('holds the hint until text arrives, streams plain replies at once, and keeps a lone partial token as text', () => {
    const a = new ReactHintSplitter();
    expect(a.push('⟦react:sympathy⟧ ')).toEqual({ text: '', hint: null });
    expect(a.push('That sounds hard.')).toEqual({ text: 'That sounds hard.', hint: 'sympathy' });
    expect(new ReactHintSplitter().push('Hello there.')).toEqual({ text: 'Hello there.', hint: null });
    const c = new ReactHintSplitter();
    expect(c.push('⟦re')).toEqual({ text: '', hint: null });
    expect(c.flush()).toEqual({ text: '⟦re', hint: null });
    const d = new ReactHintSplitter();
    expect(d.push('[[react:delight]] Great news.')).toEqual({ text: 'Great news.', hint: 'delight' });
    const e = new ReactHintSplitter();
    expect(e.push('⟦react:bogus⟧ Okay.')).toEqual({ text: 'Okay.', hint: null });
  });
});

describe('the reaction hint in a Chief of Staff turn', () => {
  it('sends the hint on the first delta and keeps the token out of deltas, the message and the history', async () => {
    const { requests } = useProviders({
      chat: { events: (req) => (isTalk(req) && requests.filter(isTalk).length === 1 ? text(['⟦react:', 'laugh⟧ ', 'Ha. ', 'The printer again.']) : null) },
    });
    const s = await exprSetup();
    await s.talk("Haha, the printer's haunted again");
    const deltas = s.liveOf('talk.delta');
    // The office already laughed for this joke: the model's own "Ha." is dropped (no double laugh), the hint stays.
    expect(deltas[0]!.data).toMatchObject({ delta: 'The printer again.', hint: 'laugh' });
    expect(deltas.slice(1).every((d) => d.data.hint === undefined)).toBe(true);
    expect(deltas.map((d) => d.data.delta).join('')).toBe('The printer again.');
    expect(deltas.some((d) => d.data.delta.includes('⟦'))).toBe(false);
    const msg = (await s.ofType('talk.message')).at(-1)!;
    expect(msg.data.text).toBe('The printer again.');
    await s.talk('What should I focus on today?');
    expect(JSON.stringify(requests.filter(isTalk).at(-1)!.messages)).not.toContain('⟦');
  });

  it('with email on, the last sentence of one step and the next step stay apart', async () => {
    const talkCalls = () => requests.filter(isTalk).length;
    const { requests } = useProviders({
      chat: {
        events: (req) => {
          if (!isTalk(req)) return null;
          if (talkCalls() === 1) return [{ type: 'text', delta: 'I will compare them shortly.' }, { type: 'tool_call', id: 'call_1', name: 'job_status', arguments: '{}' }, { type: 'done', finish: 'tool_calls' }] as ModelEvent[];
          return text(["That's running now."]);
        },
      },
    });
    const s = await exprSetup({ MAIL_PROVIDER: 'sink' });
    await s.talk('Compare amethyst suppliers');
    const msg = (await s.ofType('talk.message')).at(-1)!;
    expect(msg.data.text).toBe("I will compare them shortly.\n\nThat's running now.");
    expect(s.liveOf('talk.delta').map((d) => d.data.delta).join('')).toBe(msg.data.text);
  });

  it('asks for the token in the role directive, and for no opening laugh or acknowledgement', () => {
    const p = buildChiefSystemPrompt({ lead: undefined, chiefName: null, voiceOn: true, jobs: [], now: new Date(0) });
    expect(p).toContain('⟦react:laugh⟧');
    expect(p).toContain('never at a problem');
    expect(p).toContain('do not open with a laugh ("Ha", "Haha")');
    expect(p).toContain('"On it", "Got it", "Sure", "Okay"');
    expect(p).toContain('Never attribute them to the owner');
    expect(p).toContain('Offer more work at most once every few turns, and never after a joke');
    expect(p).toContain('never as a reason to wait');
  });
});
