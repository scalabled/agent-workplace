import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FaceLandmarks } from '@headcount/protocol';
import { portraitFor, refreshPortrait, saveLandmarks } from './portraits';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const lm = { face: { x: 0.2, y: 0.1, width: 0.6, height: 0.7, centerX: 0.5, centerY: 0.45 } } as unknown as FaceLandmarks;

describe('portraits', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('asks the list once, never probes faces without a portrait, and sends landmarks with the image version', async () => {
    const calls: { method: string; url: string; body?: unknown }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit = {}) => {
        const method = init.method ?? 'GET';
        calls.push({ method, url, ...(init.body ? { body: JSON.parse(String(init.body)) } : {}) });
        if (url === '/api/portraits') return json({ portraits: [{ personaId: 'lead-has', version: 'v7', hasLandmarks: false }] });
        if (url === '/api/portraits/lead-has') return new Response(new Blob(['png']), { headers: { 'content-type': 'image/png', 'x-portrait-version': 'v7' } });
        if (url === '/api/portraits/lead-has/landmarks' && method === 'GET') return json({ personaId: 'lead-has', landmarks: null });
        if (url === '/api/portraits/lead-has/landmarks' && method === 'PUT') return json({ personaId: 'lead-has', landmarks: lm });
        return json({ error: { code: 'not_found', message: 'none' } }, 404);
      }),
    );
    refreshPortrait('lead-none'); // start from a fresh list
    expect(await portraitFor('lead-none')).toBeNull();
    const info = await portraitFor('lead-has');
    expect(info).toMatchObject({ landmarks: null, version: 'v7' });
    expect(calls.filter((c) => c.url === '/api/portraits')).toHaveLength(1);
    expect(calls.some((c) => c.url === '/api/portraits/lead-none')).toBe(false);
    saveLandmarks('lead-has', lm);
    await vi.waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toMatchObject({ landmarks: lm, portraitVersion: 'v7' }));
  });
});

describe('portrait landmarks version', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('drops stored landmarks that belong to another version of the image', async () => {
    const stub = (landmarksVersion: string) =>
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
          if (url === '/api/portraits') return json({ portraits: [{ personaId: 'lead-v', version: 'v2', hasLandmarks: true }] });
          if (url === '/api/portraits/lead-v') return new Response(new Blob(['png']), { headers: { 'content-type': 'image/png', 'x-portrait-version': 'v2' } });
          if (url === '/api/portraits/lead-v/landmarks') return new Response(JSON.stringify({ personaId: 'lead-v', landmarks: lm }), { headers: { 'content-type': 'application/json', 'x-portrait-version': landmarksVersion } });
          return json({ error: { code: 'not_found', message: 'none' } }, 404);
        }),
      );
    stub('v1');
    refreshPortrait('lead-v');
    expect(await portraitFor('lead-v')).toMatchObject({ version: 'v2', landmarks: null });
    stub('v2');
    refreshPortrait('lead-v');
    expect(await portraitFor('lead-v')).toMatchObject({ version: 'v2', landmarks: lm });
  });
});
