// The canvas (personagram-ai parity): apps and documents built from a brief (Mock), served sandboxed with the error
// reporter, downloaded as HTML, printed for PDF; revised, repaired from reported errors, retried, removed; asked for
// by the Chief of Staff in Talk; a build cut off twice is failed.
import { ids, parseFrame, type Frame } from '@headcount/protocol';
import type { CanvasResponse, CanvasSnapshot } from '@headcount/protocol/ext/canvas';
import { describe, expect, it } from 'vitest';
import { cleanApp, cleanDocument, works } from '../src/canvas/builder';
import { titleOf } from '../src/canvas/host';
import { APP_CSP, DOCUMENT_CSP, PRINT_CSP, documentPage, fileName } from '../src/canvas/render';
import type { Env } from '../src/env';
import { handle } from '../src/index';
import type { ProjectDO } from '../src/jobs/project-do';
import type { WorkspaceDO } from '../src/workspace/workspace-do';
import { createTestEnv } from './fake-cloud';

describe('canvas helpers (pure)', () => {
  it('cleans model output into one page or one document', () => {
    expect(cleanApp('Here you go:\n```html\n<html><head></head><body>x</body></html>\n```')).toBe('<!DOCTYPE html>\n<html><head></head><body>x</body></html>');
    expect(cleanApp('<!doctype html><html><body>cut off')).toBe('<!doctype html><html><body>cut off\n</html>');
    expect(cleanDocument('```markdown\n# Plan\n\nText\n```')).toBe('# Plan\n\nText');
    expect(works('<html><body>tiny</body></html>')).toBe(false);
    expect(titleOf('Please build me a tip calculator for our café. It should split bills.')).toBe('Tip calculator for our café');
    expect(fileName('Spring menu: plan!', 'html')).toBe('Spring-menu-plan.html');
  });

  it('renders a document as a page, with raw HTML shown as text and only web links kept', () => {
    const html = documentPage('Plan', '# Plan\n\nHello <script>alert(1)</script> [site](https://example.com) [bad](javascript:alert(1))\n\n| a | b |\n| - | - |\n| 1 | 2 |');
    expect(html).toContain('<h1 id="h-plan">Plan</h1>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('<a href="https://example.com" rel="noreferrer noopener">site</a>');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('<table id="b-2">');
    expect(html).not.toContain('<script'); // a download or print carries no script
    expect(html).toContain('@media print');
  });
});

async function setup(overrides: Partial<Env> = {}) {
  const t = await createTestEnv(overrides);
  const ws = t.namespaces.WORKSPACE.getByName('ws:local') as WorkspaceDO;
  const project = t.namespaces.PROJECT.getByName('p:everyday:local') as ProjectDO;
  t.namespaces.WORKSPACE.state('ws:local').getWebSockets = () => [{ send: (m: string) => void parseFrame(m) } as unknown as WebSocket];
  const raw = (method: string, path: string, body?: unknown) => handle(new Request(`http://localhost${path}`, { method, ...(body !== undefined ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) }), t.env, t.ctx);
  const api = async (method: string, path: string, body?: unknown) => {
    const res = await raw(method, path, body);
    return { status: res.status, body: (await res.json()) as any };
  };
  const build = async () => {
    for (let i = 0; i < 3; i++) {
      await project.alarm();
      await t.ctx.drain();
    }
  };
  const canvas = async (id: string) => ((await api('GET', `/api/canvas/${id}`)).body as CanvasResponse).canvas;
  await api('PUT', '/api/workspace', { leadId: 'lead-steady-operator', chiefName: 'Eddie' });
  return { t, ws, project, raw, api, build, canvas };
}

describe('the canvas', () => {
  it('builds an app: sandboxed on the canvas with the error reporter; downloaded as the page; printed for PDF', async () => {
    const s = await setup();
    const made = await s.api('POST', '/api/canvas', { brief: 'Build a tip calculator that splits the bill between friends', kind: 'app' });
    expect(made.status).toBe(202);
    const c0 = made.body.canvas as CanvasSnapshot;
    expect(c0).toMatchObject({ status: 'queued', kind: 'app', by: 'owner', title: 'Tip calculator that splits the bill between friends' });
    await s.build();
    const c = await s.canvas(c0.canvasId);
    expect(c).toMatchObject({ status: 'ready', kind: 'app' });
    expect(c.lines).toBeGreaterThan(50);
    expect(c.previewLines).toBeUndefined();

    const view = await s.raw('GET', `/api/canvas/${c.canvasId}/view`);
    expect(view.headers.get('content-security-policy')).toBe(APP_CSP);
    const html = await view.text();
    expect(html).toContain('hc-canvas');
    expect(html).toContain('Tip calculator that splits the bill between friends');

    const dl = await s.raw('GET', `/api/canvas/${c.canvasId}/download`);
    expect(dl.headers.get('content-disposition')).toBe('attachment; filename="Tip-calculator-that-splits-the-bill-between-friends.html"');
    expect(await dl.text()).not.toContain('hc-canvas');

    const pr = await s.raw('GET', `/api/canvas/${c.canvasId}/print`);
    expect(pr.headers.get('content-security-policy')).toBe(PRINT_CSP);
    expect(await pr.text()).toContain('print()');

    // Frames told the owner's feed along the way.
    const frames = (await s.ws.frames(0, 5000)).filter((f): f is Extract<Frame, { type: 'canvas.updated' }> => f.type === 'canvas.updated' && f.data.canvas.canvasId === c.canvasId);
    expect(frames.map((f) => f.data.canvas.status)).toEqual(expect.arrayContaining(['queued', 'building', 'ready']));
  });

  it('writes a document: rendered without scripts, downloaded as HTML, its Markdown as source', async () => {
    const s = await setup();
    const c0 = (await s.api('POST', '/api/canvas', { brief: 'Write a one-page opening checklist for our café', kind: 'document', title: 'Opening checklist' })).body.canvas as CanvasSnapshot;
    await s.build();
    const c = await s.canvas(c0.canvasId);
    expect(c).toMatchObject({ status: 'ready', kind: 'document', title: 'Opening checklist' });
    expect(c.words).toBeGreaterThan(20);
    const view = await s.raw('GET', `/api/canvas/${c.canvasId}/view`);
    // On the canvas: anchors on every block, and the one script that hands a selection to the canvas, allowed by its hash.
    const csp = view.headers.get('content-security-policy')!;
    const html = await view.text();
    expect(html).toContain('<h1 id="h-opening-checklist">Opening checklist</h1>');
    const script = /<script>([\s\S]*?)<\/script>/.exec(html)![1]!;
    const hash = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(script)))));
    expect(csp).toBe(`sandbox allow-scripts; default-src 'none'; script-src 'sha256-${hash}'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'; frame-ancestors 'self'`);
    expect(html.match(/<script>/g)).toHaveLength(1);
    const dl = await s.raw('GET', `/api/canvas/${c.canvasId}/download`);
    expect(dl.headers.get('content-security-policy')).toBe(DOCUMENT_CSP);
    expect(await dl.clone().text()).not.toContain('<script');
    expect(dl.headers.get('content-disposition')).toBe('attachment; filename="Opening-checklist.html"');
    const src = await s.raw('GET', `/api/canvas/${c.canvasId}/source?download=1`);
    expect(src.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    expect(src.headers.get('content-disposition')).toBe('attachment; filename="Opening-checklist.md"');
    expect(await src.text()).toMatch(/^# Opening checklist/);
  });

  it('revises, repairs from reported errors, retries a failed build, and removes', async () => {
    const s = await setup();
    const c0 = (await s.api('POST', '/api/canvas', { brief: 'Build a habit tracker for the week', kind: 'app' })).body.canvas as CanvasSnapshot;
    expect((await s.api('POST', `/api/canvas/${c0.canvasId}/revise`, { brief: 'Make it blue' })).status).toBe(409); // not finished yet
    await s.build();
    const rev = (await s.api('POST', `/api/canvas/${c0.canvasId}/revise`, { brief: 'Make it blue' })).body.canvas as CanvasSnapshot;
    expect(rev).toMatchObject({ basedOn: c0.canvasId, title: 'Habit tracker for the week', status: 'queued', brief: 'Make it blue' });
    await s.build();
    expect((await s.canvas(rev.canvasId)).status).toBe('ready');
    expect((await s.api('POST', `/api/canvas/${rev.canvasId}/repair`, { errors: [] })).status).toBe(400);
    const fix = (await s.api('POST', `/api/canvas/${rev.canvasId}/repair`, { errors: ['TypeError: x is undefined (line 42)'] })).body.canvas as CanvasSnapshot;
    expect(fix.brief).toContain('TypeError: x is undefined (line 42)');
    expect(fix.basedOn).toBe(rev.canvasId);

    expect((await s.api('DELETE', `/api/canvas/${c0.canvasId}`)).status).toBe(200);
    expect((await s.api('GET', `/api/canvas/${c0.canvasId}`)).status).toBe(404);
    expect((await s.raw('GET', `/api/canvas/${c0.canvasId}/view`)).status).toBe(404);
  });

  it('a build with no model fails with the reason, and can be tried again', async () => {
    const s = await setup({ ENABLE_MOCK: 'false', DEFAULT_CHAT: 'auto' });
    const c0 = (await s.api('POST', '/api/canvas', { brief: 'Build a tip calculator for the café', kind: 'app' })).body.canvas as CanvasSnapshot;
    await s.build();
    const failed = await s.canvas(c0.canvasId);
    expect(failed.status).toBe('failed');
    expect(failed.error).toMatch(/key|provider|configured/i);
    const again = await s.api('POST', `/api/canvas/${c0.canvasId}/retry`);
    expect(again.body.canvas.status).toBe('queued');
  });

  it('a build an eviction cut off twice is failed rather than retried for ever', async () => {
    const s = await setup();
    const c0 = (await s.api('POST', '/api/canvas', { brief: 'Build a tip calculator for the café', kind: 'app' })).body.canvas as CanvasSnapshot;
    s.t.namespaces.PROJECT.state('p:everyday:local').storage.sql.exec(`UPDATE canvases SET status = 'building', attempts = 2, heartbeat_at = 1 WHERE canvas_id = ?`, c0.canvasId);
    await s.project.alarm();
    await s.t.ctx.drain();
    expect(await s.canvas(c0.canvasId)).toMatchObject({ status: 'failed', error: 'The build was interrupted twice. Try again.' });
  });

  it('the Chief builds on the canvas when asked, and links the reply to it', async () => {
    const s = await setup();
    await s.api('POST', '/api/talk', { text: 'Build me a tip calculator app for the café', opId: ids.op() });
    await s.t.ctx.drain();
    const list = (await s.api('GET', '/api/canvas')).body.canvases as CanvasSnapshot[];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ by: 'chief', kind: 'app' });
    const reply = (await s.ws.frames(0, 5000)).filter((f): f is Extract<Frame, { type: 'talk.message' }> => f.type === 'talk.message').at(-1)!;
    expect(reply.data.canvasId).toBe(list[0]!.canvasId);
    expect(reply.data.text).toContain('on your canvas');
    // "Write me a checklist" is a document.
    await s.api('POST', '/api/talk', { text: 'Write me a closing checklist document', opId: ids.op() });
    await s.t.ctx.drain();
    expect(((await s.api('GET', '/api/canvas')).body.canvases as CanvasSnapshot[])[0]).toMatchObject({ kind: 'document', by: 'chief' });
  });
});
