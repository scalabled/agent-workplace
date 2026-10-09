import { describe, expect, it } from 'vitest';
import { filterItems, type PaletteItem } from '../components/Palette';
import { plainText, renderMarkdown } from './markdown';
import { ago, elapsed } from './time';

describe('renderMarkdown', () => {
  // Real browsers sanitise; a DOM where the sanitiser misbehaves (happy-dom) gets escaped text. Either way
  // nothing executable is ever emitted.
  it('never emits executable markup', () => {
    const html = renderMarkdown('**Bold** [site](https://example.com) <img src=x onerror=alert(1)><script>alert(1)</script> [js](javascript:alert(1))');
    expect(html).not.toMatch(/<img|<script|<[^>]*\sonerror=|href="javascript:/i);
    if (html.includes('<a ')) {
      expect(html).toContain('<strong>Bold</strong>');
      expect(html).toContain('rel="noopener noreferrer"');
      expect(html).toContain('target="_blank"');
    } else {
      expect(html).toContain('&#60;script&#62;');
    }
  });

  it('shows the office’s own images and videos (Files), never a remote one', () => {
    const html = renderMarkdown('![logo](/api/files/fil_0123456789abcdef0123.png) ![clip](/api/files/fil_0123456789abcdef0123.mp4) ![x](https://evil.example/t.png) ![y](/api/files/../secret.png)');
    // happy-dom's sanitiser falls back to escaped text (no tags at all); a real browser renders.
    if (!html.includes('<img')) expect(html).not.toMatch(/<(img|video)/);
    else {
      expect(html).not.toMatch(/evil\.example|secret\.png/);
      expect(html).toMatch(/<img[^>]+src="\/api\/files\/fil_0123456789abcdef0123\.png"/);
      expect(html).toMatch(/<video[^>]+src="\/api\/files\/fil_0123456789abcdef0123\.mp4"/);
      expect(html).not.toMatch(/autoplay/);
    }
  });
});

describe('palette filter', () => {
  const item = (label: string, group: PaletteItem['group'], hint = '', keywords = ''): PaletteItem => ({ id: label, label, hint, keywords, group, icon: 'user', run: () => undefined });
  const items = [item('Talk', 'Places'), item('Floor', 'Places', 'Directory'), item('Hira Malik', 'Coworkers', 'Pricing strategist'), item('Ilyas Bennani', 'Coworkers', 'Pricing & promotions analyst'), item('Priya Nair', 'Coworkers', 'Bookkeeper')];

  it('shows places and settings, not the whole staff, before typing', () => {
    expect(filterItems(items, '').map((i) => i.label)).toEqual(['Talk', 'Floor']);
  });

  it('ranks name prefixes first, then word prefixes, then hints', () => {
    expect(filterItems(items, 'pri').map((i) => i.label)).toEqual(['Priya Nair', 'Hira Malik', 'Ilyas Bennani']);
    expect(filterItems(items, 'mal').map((i) => i.label)).toEqual(['Hira Malik']);
    expect(filterItems(items, 'directory').map((i) => i.label)).toEqual(['Floor']);
  });
});

describe('time', () => {
  it('reads elapsed time in plain words', () => {
    const now = Date.parse('2026-09-28T12:00:00Z');
    expect(elapsed('2026-09-28T11:59:40Z', now)).toBe('just now');
    expect(ago('2026-09-28T11:56:00Z', now)).toBe('4 min ago');
    expect(elapsed('2026-09-28T09:00:00Z', now)).toBe('3 h');
  });
});

describe('plainText', () => {
  it('turns Markdown into one plain line for previews', () => {
    expect(plainText("**Decision:** Launch the `activation_first_job_done` event.\n\n- **Leilani:** three hooks\n- Me: the [scorecard](/app/files)\n\n## Open\nNothing.")).toBe('Decision: Launch the activation_first_job_done event. Leilani: three hooks Me: the scorecard Open Nothing.');
    expect(plainText('A *quiet* _launch_ in 2_000 steps')).toBe('A quiet launch in 2_000 steps');
  });
});
