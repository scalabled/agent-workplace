import { describe, expect, it } from 'vitest';
import { clipBlock, clipMiddle, clipText } from './job-view';

describe('clipText', () => {
  it('collapses whitespace to one line', () => {
    expect(clipText('a\n\nb  c', 20)).toBe('a b c');
    expect(clipText('abcdefghij', 5)).toBe('abcd…');
  });
});

describe('clipBlock', () => {
  it('keeps line breaks under the limit', () => {
    const md = '## Result\n\n- one\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |';
    expect(clipBlock(md, 500)).toBe(md);
  });

  it('cuts at the last whole line over the limit', () => {
    const md = ['## Plan', '- first line here', '- second line here', '- third line here'].join('\n');
    const out = clipBlock(md, 40);
    expect(out).toBe('## Plan\n- first line here…');
    expect(out.length).toBeLessThanOrEqual(40);
    expect(out.endsWith('…')).toBe(true);
    expect(out).not.toContain('third');
  });

  it('squeezes runs of blank lines and trailing spaces', () => {
    expect(clipBlock('a  \r\n\n\n\nb', 50)).toBe('a\n\nb');
  });
});

describe('clipMiddle', () => {
  const lines = Array.from({ length: 50 }, (_, i) => `Speaker ${i}: line number ${i}.`);
  const transcript = lines.join('\n');

  it('returns short text unchanged', () => {
    expect(clipMiddle('a\nb', 100)).toBe('a\nb');
  });

  it('keeps the opening and the latest lines and says how many it left out', () => {
    const out = clipMiddle(transcript, 400);
    expect(out.length).toBeLessThanOrEqual(400);
    expect(out.startsWith('Speaker 0:')).toBe(true);
    expect(out.endsWith('Speaker 49: line number 49.')).toBe(true);
    expect(out).toMatch(/\[\d+ earlier lines left out\]/);
  });

  it('keeps both ends of one long line', () => {
    const out = clipMiddle(`start ${'x'.repeat(2000)} end`, 200);
    expect(out.startsWith('start')).toBe(true);
    expect(out.endsWith('end')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(200);
  });
});
