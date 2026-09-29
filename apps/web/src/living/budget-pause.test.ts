import { describe, expect, it } from 'vitest';
import { BUDGET_PAUSE_KEY, createBudgetPause, nextUtcMidnight, pauseEnd } from './budget-pause';
import { createRender } from './ports';

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};
const NOW = Date.UTC(2026, 8, 29, 13, 30);
const refusal = (message: string) => Object.assign(new Error(message), { status: 429 });

describe('voice budget pause', () => {
  it('a daily refusal pauses until the next UTC midnight; a per-minute one for a minute', () => {
    expect(nextUtcMidnight(NOW)).toBe(Date.UTC(2026, 8, 30));
    expect(pauseEnd("Voice clips are paused until tomorrow (UTC): today's limit of 600 renders is used up.", NOW)).toBe(Date.UTC(2026, 8, 30));
    expect(pauseEnd('Voice renders are paused for a minute: the limit of 30 a minute is used up.', NOW)).toBe(NOW + 60_000);
  });

  it('ignores other errors, persists a refusal and reads it back after a reload', () => {
    const s = memory();
    const p = createBudgetPause(s);
    expect(p.note(Object.assign(new Error('x'), { status: 503 }), NOW)).toBe(false);
    expect(p.blocked(NOW)).toBe(false);
    expect(p.note(refusal("Nothing fits today's voice budget."), NOW)).toBe(true);
    expect(p.blocked(NOW + 1)).toBe(true);
    expect(JSON.parse(s.m.get(BUDGET_PAUSE_KEY)!).until).toBe(Date.UTC(2026, 8, 30));
    const reloaded = createBudgetPause(s);
    expect(reloaded.blocked(NOW + 1000)).toBe(true);
    expect(reloaded.blocked(Date.UTC(2026, 8, 30) + 1)).toBe(false);
  });

  it('runtime renders stop calling the worker once the budget is spent', async () => {
    let calls = 0;
    const pause = createBudgetPause(memory());
    const agents = { provider: () => 'xai', addClip: () => undefined } as never;
    const clips = { load: async () => null } as never;
    const render = createRender({
      exprRender: async () => {
        calls++;
        throw refusal("Voice clips are paused until tomorrow (UTC): today's limit of 600 renders is used up.");
      },
      clips,
      agents,
      pause,
      now: () => NOW,
    });
    const req = { agentId: 'cw_chief', lineId: 'l1', fills: {}, provider: 'xai' } as never;
    expect(await render(req)).toBeNull();
    expect(await render(req)).toBeNull();
    expect(await render(req)).toBeNull();
    expect(calls).toBe(1);
  });
});
