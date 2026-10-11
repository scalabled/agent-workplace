// Files (Phase 4): images and videos made here and kept per organization, the Chief making one from Talk (posted to the
// thread when ready), xAI videos started and polled until they are copied in, and Markdown exported as Office files.
import { ids, parseFrame } from '@headcount/protocol';
import type { FilesResponse, FileView } from '@headcount/protocol/ext/files';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/env';
import { handle } from '../src/index';
import type { WorkspaceDO } from '../src/workspace/workspace-do';
import { createTestEnv } from './fake-cloud';

async function setup(overrides: Partial<Env> = {}) {
  const t = await createTestEnv(overrides);
  const ws = t.namespaces.WORKSPACE.getByName('ws:local') as WorkspaceDO;
  t.namespaces.WORKSPACE.state('ws:local').getWebSockets = () => [{ send: (m: string) => void parseFrame(m) } as unknown as WebSocket];
  const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
    handle(new Request(`http://localhost${path}`, { method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }), t.env, t.ctx);
  const api = async (method: string, path: string, body?: unknown) => {
    const res = await call(method, path, body);
    return { status: res.status, body: (await res.json()) as any };
  };
  await api('PUT', '/api/workspace', { leadId: 'lead-steady-operator', chiefName: 'Eddie' });
  const files = async () => ((await api('GET', '/api/files')).body as FilesResponse).files;
  return { t, ws, call, api, files };
}

afterEach(() => vi.unstubAllGlobals());

describe('files', () => {
  it('an image from a description: working at once, then ready (the placeholder without a provider), served privately', async () => {
    const s = await setup();
    expect(((await s.api('GET', '/api/files')).body as FilesResponse).can).toEqual({ image: true, video: true });
    const r = await s.api('POST', '/api/files/image', { prompt: 'A banner for an online crystal shop, amethyst on linen', aspect: '16:9' });
    expect(r.status).toBe(202);
    expect(r.body.file).toMatchObject({ kind: 'image', status: 'working', aspect: '16:9', madeBy: 'owner', title: 'Banner for an online crystal shop, amethyst on linen' });
    await s.t.ctx.drain();
    const [f] = await s.files();
    expect(f).toMatchObject({ status: 'ready', placeholder: true, mime: 'image/svg+xml' });
    expect(f!.url).toMatch(/^\/api\/files\/fil_[a-f0-9]{20}\.svg$/);
    const got = await s.call('GET', f!.url!);
    expect(got.status).toBe(200);
    expect(got.headers.get('content-type')).toBe('image/svg+xml');
    expect(got.headers.get('content-security-policy')).toContain('sandbox');
    expect(await got.text()).toContain('<svg');
    // Kept under the organization's own prefix.
    expect([...s.t.r2.objects.keys()]).toContain(`ws/local/files/${f!.fileId}.svg`);
    expect((await s.call('GET', '/api/files/fil_00000000000000000000.png')).status).toBe(404);
    expect((await s.api('DELETE', f!.url!)).status).toBe(200);
    expect(await s.files()).toEqual([]);
    expect(s.t.r2.objects.has(`ws/local/files/${f!.fileId}.svg`)).toBe(false);
  });

  it('no provider and no Mock: says which keys, and nothing is made', async () => {
    const s = await setup({ ENABLE_MOCK: 'false', DEFAULT_CHAT: undefined } as Partial<Env>);
    expect(((await s.api('GET', '/api/files')).body as FilesResponse).can).toEqual({ image: false, video: false });
    const r = await s.api('POST', '/api/files/video', { prompt: 'A slow pan across a crystal display' });
    expect(r.status).toBe(503);
    expect(r.body.error.missingKeys).toEqual(['XAI_API_KEY']);
  });

  it('a placeholder video is ready at once and seeks with ranges', async () => {
    const s = await setup();
    const r = await s.api('POST', '/api/files/video', { prompt: 'Crystals catching the morning light', aspect: '9:16', seconds: 4 });
    expect(r.body.file).toMatchObject({ kind: 'video', status: 'working', aspect: '9:16', seconds: 4 });
    await s.t.ctx.drain();
    const [f] = await s.files();
    expect(f).toMatchObject({ status: 'ready', mime: 'video/mp4', placeholder: true });
    const part = await s.call('GET', f!.url!, undefined, { range: 'bytes=0-99' });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe(`bytes 0-99/${f!.bytes}`);
    expect((await part.arrayBuffer()).byteLength).toBe(100);
  });

  it('an xAI video: started, checked until done, then copied in (its link is temporary)', async () => {
    const s = await setup({ XAI_API_KEY: 'xai-test' } as Partial<Env>);
    let checks = 0;
    const real = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url === 'https://api.x.ai/v1/videos/generations') {
        expect(JSON.parse(String(init?.body))).toMatchObject({ model: 'grok-imagine-video-1.5', duration: 6, aspect_ratio: '16:9', resolution: '720p' });
        return Response.json({ request_id: 'req-1' });
      }
      if (url === 'https://api.x.ai/v1/videos/req-1') return Response.json(++checks < 2 ? { status: 'pending' } : { status: 'done', video: { url: 'https://vidgen.x.ai/v/1.mp4', duration: 6, respect_moderation: true }, model: 'grok-imagine-video-1.5' });
      if (url === 'https://vidgen.x.ai/v/1.mp4') return new Response(new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]), { headers: { 'content-type': 'video/mp4' } });
      return real(input, init);
    });
    const r = await s.api('POST', '/api/files/video', { prompt: 'A slow pan across a crystal display' });
    expect(r.body.file).toMatchObject({ status: 'working' });
    await s.t.ctx.drain();
    await s.ws.alarm(); // pending
    expect((await s.files())[0]).toMatchObject({ status: 'working' });
    await s.ws.alarm(); // done → copied in
    const [f] = await s.files();
    expect(f).toMatchObject({ status: 'ready', seconds: 6, bytes: 8 });
    expect(f!.placeholder).toBeUndefined();
    expect(s.t.r2.objects.has(`ws/local/files/${f!.fileId}.mp4`)).toBe(true);
  });

  it('Edit makes a new version from the image itself, keeps the original, and refuses what it cannot edit', async () => {
    const s = await setup({ XAI_API_KEY: 'xai-test' } as Partial<Env>);
    const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const edits: { prompt: string; image: string }[] = [];
    const real = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url === 'https://api.x.ai/v1/images/generations') return Response.json({ data: [{ b64_json: PNG }] });
      if (url === 'https://api.x.ai/v1/images/edits') {
        const body = JSON.parse(String(init?.body)) as { prompt: string; image: { url: string } };
        edits.push({ prompt: body.prompt, image: body.image.url });
        return Response.json({ data: [{ b64_json: PNG }] });
      }
      return real(input, init);
    });
    await s.api('POST', '/api/files/image', { prompt: "A flyer for Oscar's Coffee Shop: open mic night on Friday", aspect: '3:4' });
    await s.t.ctx.drain();
    const [original] = await s.files();
    expect(original).toMatchObject({ status: 'ready', mime: 'image/png' });

    const r = await s.api('POST', `${original!.url}/edit`, { change: 'Change the day to Saturday' });
    expect(r.status).toBe(202);
    expect(r.body.file).toMatchObject({ kind: 'image', status: 'working', title: original!.title, editOf: original!.fileId, aspect: '3:4', madeBy: 'owner', source: { kind: 'files', ref: original!.fileId } });
    await s.t.ctx.drain();
    // The provider edited the picture itself: the original's bytes went with the change.
    expect(edits).toHaveLength(1);
    expect(edits[0]!.prompt).toContain('Change: Change the day to Saturday.');
    expect(edits[0]!.prompt).toContain('Keep everything else as it is');
    expect(edits[0]!.image).toBe(`data:image/png;base64,${PNG}`);
    const all = await s.files();
    expect(all).toHaveLength(2);
    expect(all.find((f) => f.fileId === r.body.file.fileId)).toMatchObject({ status: 'ready', editOf: original!.fileId });
    expect(all.find((f) => f.fileId === original!.fileId)).toMatchObject({ status: 'ready' });

    expect((await s.api('POST', `${original!.url}/edit`, { change: 'x' })).status).toBe(400);
    expect((await s.api('POST', '/api/files/fil_00000000000000000000.png/edit', { change: 'Make it blue' })).status).toBe(404);
  });

  it('the Chief makes an image from Talk and posts it to the thread when it is ready', async () => {
    const s = await setup();
    await s.api('POST', '/api/talk', { text: 'Make an image of our crystal shop logo on a dark background', opId: ids.op() });
    await s.t.ctx.drain();
    const frames = await s.ws.frames(0, 5000);
    const texts = frames.filter((f) => f.type === 'talk.message').map((f) => (f.data as { text: string }).text);
    expect(texts.some((t) => t.startsWith("I'm making it now"))).toBe(true);
    const posted = texts.find((t) => t.startsWith("Here's the image"));
    expect(posted).toMatch(/!\[[^\]]+\]\(\/api\/files\/fil_[a-f0-9]{20}\.svg\)/);
    // One tap from Talk to edit it.
    expect(posted).toMatch(/\[Edit it\]\(\/app\/files\?edit=fil_[a-f0-9]{20}\)/);
    const [f] = await s.files();
    expect(f).toMatchObject({ madeBy: 'chief', source: { kind: 'talk' }, status: 'ready' });
    expect(frames.some((x) => x.type === 'file.updated' && (x.data as { file: FileView }).file.status === 'ready')).toBe(true);
  });

  it('exports Markdown as Word, Excel and PowerPoint downloads', async () => {
    const s = await setup();
    for (const [format, type] of [
      ['docx', 'wordprocessingml'],
      ['xlsx', 'spreadsheetml'],
      ['pptx', 'presentationml'],
    ] as const) {
      const res = await s.call('POST', '/api/export', { title: 'Crystal box plan', markdown: '# Plan\n\n| A | B |\n|---|---|\n| 1 | 2 |', format });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain(type);
      expect(res.headers.get('content-disposition')).toContain(`Crystal box plan.${format}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      expect([bytes[0], bytes[1]]).toEqual([0x50, 0x4b]); // a zip
    }
    expect((await s.call('POST', '/api/export', { title: 'x', markdown: 'y', format: 'exe' })).status).toBe(400);
  });
});
