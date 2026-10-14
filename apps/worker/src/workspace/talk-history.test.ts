import type { Frame } from '@headcount/protocol';
import { describe, expect, it } from 'vitest';
import { HISTORY_BULKY_CHARS, HISTORY_SHORT_CHARS, HISTORY_VERBATIM, historyFromFrames } from './talk';

/** `n` exchanges: owner message i, then the Chief's reply to it. `text(i, role)` gives each message. */
function exchanges(n: number, text: (i: number, role: 'user' | 'assistant') => string): Frame[] {
  const frames: Frame[] = [];
  for (let i = 0; i < n; i++) {
    const turnId = `turn_${i}` as const;
    frames.push({ v: 1, streamId: 'ws:local', seq: frames.length + 1, ts: '', type: 'talk.owner', data: { turnId, messageId: `msg_o${i}`, text: text(i, 'user'), via: 'text' } } as Frame);
    frames.push({ v: 1, streamId: 'ws:local', seq: frames.length + 1, ts: '', type: 'talk.message', data: { turnId, messageId: `msg_r${i}`, agentId: 'cw_chief', text: text(i, 'assistant'), kind: 'reply' } } as Frame);
  }
  return frames;
}

const words = (tag: string, chars: number) => `${tag} ${'word '.repeat(chars)}`.slice(0, chars);
const size = (h: { content: unknown }[]) => h.reduce((n, m) => n + String(m.content).length, 0);
const STUB = /^(.*) … \[older message shortened: (\d+) chars left out\]$/s;

describe('historyFromFrames: staged budget', () => {
  it('keeps everything word for word when it fits', () => {
    const frames = exchanges(5, (i, role) => words(`${role}${i}`, 1500));
    const h = historyFromFrames(frames, 20_000);
    expect(h).toHaveLength(10);
    expect(h.every((m) => !String(m.content).includes('older message shortened'))).toBe(true);
  });

  it('shortens bulky older messages, oldest first, before it drops any message; the newest stay word for word', () => {
    // 10 messages of 2,000 chars (20,000) against 14,000: shortening 3 saves too little, the 4 oldest are enough.
    const frames = exchanges(5, (i, role) => words(`${role}${i}`, 2000));
    const h = historyFromFrames(frames, 14_000);
    expect(h).toHaveLength(10);
    const shortened = h.map((m) => STUB.exec(String(m.content)));
    expect(shortened.map(Boolean)).toEqual([true, true, true, true, false, false, false, false, false, false]);
    for (const m of shortened.filter(Boolean)) {
      expect(m![1]!.length).toBeLessThanOrEqual(HISTORY_SHORT_CHARS);
      expect(m![1]!.length + Number(m![2])).toBeGreaterThanOrEqual(1999); // the start plus what was left out
      expect(m![1]).not.toMatch(/\s$/);
    }
    expect(String(h[0]!.content).startsWith('user0 word')).toBe(true);
    expect(h.slice(-HISTORY_VERBATIM).map((m) => String(m.content).length)).toEqual(Array(HISTORY_VERBATIM).fill(2000));
    expect(size(h)).toBeLessThanOrEqual(14_000);
  });

  it('never shortens a short older message', () => {
    const frames = exchanges(6, (i, role) => words(`${role}${i}`, i === 0 && role === 'user' ? HISTORY_BULKY_CHARS : 1500));
    const h = historyFromFrames(frames, 14_000);
    expect(String(h[0]!.content)).toBe(words('user0', HISTORY_BULKY_CHARS));
    expect(STUB.test(String(h[2]!.content))).toBe(true);
  });

  it('drops the oldest messages when shortening is not enough, and keeps the transcript starting with the owner', () => {
    const frames = exchanges(10, (i, role) => words(`${role}${i}`, 2000));
    const h = historyFromFrames(frames, 13_000);
    expect(h[0]!.role).toBe('user');
    expect(size(h)).toBeLessThanOrEqual(13_000);
    // The last six (2,000 each) stay whole; the room left holds shortened older messages only.
    expect(h.slice(-HISTORY_VERBATIM).map((m) => String(m.content).length)).toEqual(Array(HISTORY_VERBATIM).fill(2000));
    expect(h.slice(0, -HISTORY_VERBATIM).every((m) => STUB.test(String(m.content)))).toBe(true);
    expect(String(h.at(-1)!.content).startsWith('assistant9')).toBe(true);
    expect(h.some((m) => String(m.content).startsWith('user0'))).toBe(false);
  });

  it('keeps the newest message even when it alone is over budget', () => {
    const h = historyFromFrames(exchanges(4, (i, role) => (role === 'user' ? words(`user${i}`, 3000) : 'ok')).slice(0, -1), 1000);
    expect(h).toEqual([{ role: 'user', content: words('user3', 3000) }]);
  });
});
