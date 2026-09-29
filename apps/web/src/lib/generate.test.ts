import { afterEach, describe, expect, it, vi } from 'vitest';
import { generatePortrait, painting } from './generate';
import { portraitEpoch } from './portraits';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('generatePortrait', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('asks for a portrait, waits for it to appear, then lets faces load it', async () => {
    vi.useFakeTimers();
    let gets = 0;
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit = {}) => {
        calls.push(`${init.method ?? 'GET'} ${url}`);
        if (init.method === 'POST') return json({ personaId: 'lead-x', status: 'queued', provider: 'xai' }, 202);
        return ++gets < 3 ? json({ error: { code: 'not_found', message: 'No portrait yet.' } }, 404) : new Response(new Blob(['png']), { headers: { 'content-type': 'image/png' } });
      }),
    );
    const epoch = portraitEpoch.value;
    const run = generatePortrait('lead-x');
    expect(painting.value['lead-x']).toEqual({ status: 'painting' });
    await vi.advanceTimersByTimeAsync(10_000);
    await run;
    expect(calls[0]).toBe('POST /api/portraits/lead-x/generate?wait=1'); // generates in-request (DEPLOY.md H6)
    expect(gets).toBe(3);
    expect(painting.value['lead-x']).toBeUndefined();
    expect(portraitEpoch.value).toBe(epoch + 1);
  });

  it('names the missing key when no image provider is configured', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ error: { code: 'not_configured', message: 'Portraits need an image provider.', missingKeys: ['XAI_API_KEY', 'OPENAI_API_KEY'] } }, 503)),
    );
    await generatePortrait('lead-y');
    const state = painting.value['lead-y'];
    expect(state?.status).toBe('failed');
    expect(state && 'message' in state ? state.message : '').toMatch(/XAI_API_KEY or OPENAI_API_KEY/);
  });
});
