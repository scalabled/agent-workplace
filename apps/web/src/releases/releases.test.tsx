// The releases page: the data stays consistent as releases are added (newest first, every change and guide entry
// linked, every "Open" link a real app page), and the page shows the latest release, the guide and a search.
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { matchPath } from '../router';
import { AREAS, GUIDE, LATEST, longDate, RELEASES } from './content';
import { Releases } from './Releases';

describe('releases data', () => {
  it('lists releases newest first, each version once', () => {
    const versions = RELEASES.map((r) => r.version);
    expect(new Set(versions).size).toBe(versions.length);
    const num = (v: string) => v.split('.').map(Number);
    for (let i = 1; i < RELEASES.length; i++) {
      const [a, b] = [RELEASES[i - 1]!, RELEASES[i]!];
      expect(a.date >= b.date, `${a.version} is not newer than ${b.version}`).toBe(true);
      const [x, y] = [num(a.version), num(b.version)];
      expect(x[0]! > y[0]! || (x[0] === y[0] && x[1]! > y[1]!), `${a.version} should be above ${b.version}`).toBe(true);
      expect(a.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    expect(LATEST).toBe(RELEASES[0]);
    expect(longDate('2026-10-06')).toBe('October 6, 2026');
  });

  it('links every change to a guide entry that exists, and every entry to a release and an area', () => {
    const ids = GUIDE.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of RELEASES) for (const c of r.changes) if (c.guide) expect(ids, `${r.version}: ${c.text}`).toContain(c.guide);
    for (const g of GUIDE) {
      expect(RELEASES.map((r) => r.version), g.id).toContain(g.since);
      expect(AREAS.map((a) => a.id), g.id).toContain(g.area);
      expect(g.steps.length, g.id).toBeGreaterThan(0);
    }
    for (const a of AREAS) expect(GUIDE.some((g) => g.area === a.id), a.id).toBe(true);
  });

  it('points every "Open" link at a real page of the app', () => {
    for (const g of GUIDE) if (g.open) expect(matchPath(g.open.href.split('?')[0]!).name, g.open.href).not.toBe('notFound');
  });
});

describe('the releases page', () => {
  let host: HTMLElement;
  afterEach(() => {
    render(null, host);
    host.remove();
  });

  it('shows the latest release, the feature guide with New badges, every release, and a search', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    await act(() => render(<Releases />, host));
    expect(host.querySelector('h1')?.textContent).toContain('What’s new');
    expect(host.querySelector('#latest h2')?.textContent).toBe(LATEST.title);
    expect(host.querySelectorAll('.rl-card')).toHaveLength(GUIDE.length);
    const fresh = GUIDE.filter((g) => g.since === LATEST.version);
    expect(host.querySelectorAll('.rl-card .rl-new')).toHaveLength(fresh.length);
    expect(host.querySelectorAll('.rl-release')).toHaveLength(RELEASES.length);
    // Every "How to use it" link lands on a card.
    for (const a of host.querySelectorAll<HTMLAnchorElement>('.rl-howto')) expect(host.querySelector(a.getAttribute('href')!)).not.toBeNull();
    const search = host.querySelector<HTMLInputElement>('.rl-search input')!;
    await act(() => {
      search.value = 'meeting';
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const titles = [...host.querySelectorAll('.rl-card h4')].map((h) => h.textContent ?? '');
    expect(titles.length).toBeGreaterThan(0);
    expect(titles.length).toBeLessThan(GUIDE.length);
    expect(titles.some((t) => t.includes('Meetings'))).toBe(true);
    await act(() => {
      search.value = 'zzzz';
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(host.querySelector('.rl-empty')?.textContent).toContain('Nothing matches');
  });
});
