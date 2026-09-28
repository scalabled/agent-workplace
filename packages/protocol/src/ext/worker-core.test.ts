import { describe, expect, it } from 'vitest';
import { feedCatchUp, jobProgressPercent } from './worker-core';

describe('worker-core protocol helpers', () => {
  it('computes job progress from the 1-based checkpoint in progress', () => {
    expect(jobProgressPercent({ status: 'running', step: 1, of: null })).toBe(0);
    expect(jobProgressPercent({ status: 'running', step: 1, of: 5 })).toBe(0);
    expect(jobProgressPercent({ status: 'running', step: 3, of: 5 })).toBe(40);
    expect(jobProgressPercent({ status: 'running', step: 6, of: 5 })).toBe(99);
    expect(jobProgressPercent({ status: 'done', step: 5, of: 5 })).toBe(100);
  });

  it('tells a client what to do after ready + replay', () => {
    expect(feedCatchUp(10, 10)).toBe('live');
    expect(feedCatchUp(900, 500)).toBe('resume');
    expect(feedCatchUp(3, 40)).toBe('reset');
  });
});
