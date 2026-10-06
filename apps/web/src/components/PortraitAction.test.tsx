// "Generate portrait" is offered for someone with no portrait, only when an image provider is set up; a click asks
// the worker to paint it.
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { capabilities } from '../store';
import { isPlatform } from '../auth/session';
import { PortraitAction } from './PortraitAction';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));
let posts: string[] = [];
let host: HTMLElement;

beforeEach(() => {
  posts = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      if (init.method === 'POST') {
        posts.push(url);
        return json({ error: { code: 'not_configured', message: 'Portraits are paused for today.' } }, 429);
      }
      if (url === '/api/portraits') return json({ portraits: [] });
      return new Response('', { status: 404 });
    }),
  );
  isPlatform.value = true;
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  render(null, host);
  host.remove();
  vi.unstubAllGlobals();
});

const withImage = (available: boolean) => {
  capabilities.value = { modalities: { image: { available } } } as never;
};

describe('PortraitAction', () => {
  it('hidden without an image provider', async () => {
    withImage(false);
    render(<PortraitAction id="marketing-strategist-01" name="Dana Reyes" class="profile-paint" />, host);
    await flush();
    expect(host.textContent).toBe('');
  });

  it('offered for a coworker with no portrait; a click asks for one, and a failure is said plainly', async () => {
    withImage(true);
    render(<PortraitAction id="marketing-strategist-01" name="Dana Reyes" class="profile-paint" />, host);
    await flush();
    const button = host.querySelector<HTMLButtonElement>('.profile-paint button')!;
    expect(button.textContent).toBe('Generate portrait');
    await act(async () => button.click());
    await flush();
    expect(posts).toEqual(['/api/portraits/marketing-strategist-01/generate?wait=1']);
    expect(host.querySelector('.profile-paint-error')?.textContent).toBe('Portraits are paused for today.');
  });
});
