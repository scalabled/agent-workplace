// The canvas page: versions, the status line, a build in progress (lines and the code tail), a finished app in its
// sandbox, errors it reports turning into a fix, a change, and a failed build tried again.
import type { CanvasSnapshot } from '@headcount/protocol/ext/canvas';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { slimIndex } from '@headcount/catalog/slim';
import { catalog } from '../catalog';
import { route } from '../router';
import { canvases, settings } from '../store';
import { CanvasView, lineageOf, statusLine } from './CanvasView';

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];
let respond: (c: Call) => Response = () => json({});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
let host: HTMLElement;
const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));
const button = (text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith(text));

const cv = (over: Partial<CanvasSnapshot> = {}): CanvasSnapshot => ({ canvasId: 'cnv_0000000000000001', title: 'Tip calculator', brief: 'Build a tip calculator', kind: 'app', status: 'ready', by: 'owner', lines: 1200, bytes: 40_000, createdAt: '2026-09-29T10:00:00Z', updatedAt: '2026-09-29T10:01:00Z', ...over });

beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const call = { url, method: init.method ?? 'GET', body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body };
      calls.push(call);
      return respond(call);
    }),
  );
  host = document.createElement('div');
  document.body.appendChild(host);
  catalog.value = slimIndex;
  settings.value = { workspaceId: 'local', leadId: slimIndex.catalog.leads[0]!.id, chiefName: 'Eddie', voiceOn: false, updatedAt: '' };
  canvases.value = {};
});
afterEach(() => {
  render(null, host);
  host.remove();
  vi.unstubAllGlobals();
});

describe('canvas (pure)', () => {
  it('finds every version of a piece and says how it is going', () => {
    const a = cv();
    const b = cv({ canvasId: 'cnv_0000000000000002', basedOn: a.canvasId, createdAt: '2026-09-29T10:05:00Z' });
    const c = cv({ canvasId: 'cnv_0000000000000003', basedOn: b.canvasId, createdAt: '2026-09-29T10:09:00Z' });
    const other = cv({ canvasId: 'cnv_0000000000000009', title: 'Other' });
    const all = Object.fromEntries([a, b, c, other].map((x) => [x.canvasId, x]));
    expect(lineageOf(all, c.canvasId).map((x) => x.canvasId)).toEqual([a.canvasId, b.canvasId, c.canvasId]);
    expect(statusLine(a)).toBe('1,200 lines · interactive');
    expect(statusLine(cv({ kind: 'document', words: 840 }))).toBe('840 words');
    expect(statusLine(cv({ status: 'building', previewLines: 180 }), { lines: 420, chars: 1, tail: '', phase: 'writing' })).toBe('First version · the full one is being written (420 lines)');
    expect(statusLine(cv({ status: 'building' }), { lines: 90, chars: 1, tail: '', phase: 'expanding' })).toBe('Adding depth… 90 lines');
  });
});

describe('a canvas', () => {
  it('while it builds: lines written and the tail; then the app runs sandboxed', async () => {
    let state: 'building' | 'ready' = 'building';
    respond = () => json(state === 'building' ? { canvas: cv({ status: 'building' }), progress: { lines: 340, chars: 9000, tail: '<canvas id="stage"></canvas>', phase: 'writing' } } : { canvas: cv() });
    await act(() => render(<CanvasView canvasId="cnv_0000000000000001" />, host));
    await flush();
    expect(host.querySelector('.canvas-building')?.textContent).toContain('Writing… 340 lines · a first version plays in a moment');
    expect(host.querySelector('.canvas-tail')?.textContent).toBe('<canvas id="stage"></canvas>');
    expect(host.querySelector('.canvas-frame')).toBeNull();
    state = 'ready';
    await act(async () => void (await new Promise((r) => setTimeout(r, 1100))));
    await flush();
    const frame = host.querySelector<HTMLIFrameElement>('.canvas-frame')!;
    expect(frame.getAttribute('src')).toBe('/api/canvas/cnv_0000000000000001/view');
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-pointer-lock');
    expect(host.querySelector<HTMLAnchorElement>('a[download]')?.getAttribute('href')).toBe('/api/canvas/cnv_0000000000000001/download');
  });

  it('errors the app reports become a fix; a change becomes a new version', async () => {
    const fix = cv({ canvasId: 'cnv_0000000000000002', basedOn: 'cnv_0000000000000001', status: 'queued' });
    respond = (call) => (call.url.endsWith('/repair') || call.url.endsWith('/revise') ? json({ canvas: fix }, 202) : json({ canvas: cv() }));
    await act(() => render(<CanvasView canvasId="cnv_0000000000000001" />, host));
    await flush();
    const frame = host.querySelector<HTMLIFrameElement>('.canvas-frame')!;
    await act(() => void window.dispatchEvent(new MessageEvent('message', { data: { type: 'hc-canvas', errors: ['TypeError: x is undefined (line 42)'] }, source: frame.contentWindow })));
    expect(host.querySelector('.canvas-report')?.textContent).toContain('It reported a problem when it ran.');
    // A message from anywhere else is ignored.
    await act(() => void window.dispatchEvent(new MessageEvent('message', { data: { type: 'hc-canvas', errors: ['a', 'b'] }, source: window })));
    expect(host.querySelector('.canvas-report')?.textContent).toContain('a problem');
    await act(() => void button('Fix it')!.click());
    await flush();
    expect(calls.find((c) => c.url.endsWith('/repair'))).toMatchObject({ method: 'POST', body: { errors: ['TypeError: x is undefined (line 42)'] } });
    expect(route.value).toMatchObject({ name: 'canvasItem', params: { canvasId: 'cnv_0000000000000002' } });
  });

  it('a failed build says why and can be tried again', async () => {
    respond = (call) => (call.url.endsWith('/retry') ? json({ canvas: cv({ status: 'queued' }) }, 202) : json({ canvas: cv({ status: 'failed', error: 'The build took too long. Try a simpler brief.' }) }));
    await act(() => render(<CanvasView canvasId="cnv_0000000000000001" />, host));
    await flush();
    expect(host.querySelector('.canvas-failed')?.textContent).toContain('The build took too long. Try a simpler brief.');
    await act(() => void button('Build it again')!.click());
    await flush();
    expect(calls.some((c) => c.url === '/api/canvas/cnv_0000000000000001/retry' && c.method === 'POST')).toBe(true);
  });
});
