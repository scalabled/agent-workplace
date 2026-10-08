import { expect, test } from '@playwright/test';
import { pinDirectory } from './helpers';

// Inc 0 scaffold smoke: both servers up through the Vite proxy, the shell renders the four places.
test('worker health through the proxy', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.ok()).toBe(true);
  expect(await res.json()).toMatchObject({ ok: true, service: 'headcount-worker' });
});

test('capabilities are keyless-safe', async ({ request }) => {
  const caps = await (await request.get('/api/capabilities')).json();
  expect(caps.modalities.chat.available).toBe(true);
  expect(caps.defaultChat).toBe('mock');
  // e2e is keyless even when apps/worker/.dev.vars has keys (dev.mjs --mock blanks them).
  expect(caps.providers.filter((p: { id: string; configured: boolean }) => p.configured && p.id !== 'mock')).toEqual([]);
  // Voice and portraits are hidden keyless (never shown broken); their routes name the keys that enable them.
  for (const m of ['tts', 'stt', 'image']) {
    expect(caps.modalities[m].available).toBe(false);
    expect(caps.modalities[m].missingKeys).toEqual(expect.arrayContaining(['OPENAI_API_KEY', 'XAI_API_KEY']));
  }
  const keyText = /Add OPENAI_API_KEY or XAI_API_KEY to apps\/worker\/\.dev\.vars/;
  const tts = await request.post('/api/speech/tts', { data: { text: 'Hello.', voiceRef: {}, speakerId: 'cw_chief' } });
  expect(tts.status()).toBe(503);
  expect((await tts.json()).error.message).toMatch(keyText);
  const stt = await request.post('/api/speech/stt', { headers: { 'content-type': 'audio/webm' }, data: Buffer.from('fake audio') });
  expect(stt.status()).toBe(503);
  expect((await stt.json()).error.message).toMatch(keyText);
  const portrait = await request.post('/api/portraits/lead-warm-mentor/generate');
  expect(portrait.status()).toBe(503);
  expect((await portrait.json()).error).toMatchObject({ code: 'not_configured', missingKeys: ['OPENAI_API_KEY', 'XAI_API_KEY'] });
  expect((await request.get('/api/portraits/lead-warm-mentor')).status()).toBe(404);
});

test('shell shows the places and the Chief of Staff bubble', async ({ page }) => {
  await pinDirectory(page);
  await page.goto('/app/floor');
  const nav = page.getByRole('navigation', { name: 'Places' });
  for (const place of ['Talk', /^Now/, 'Floor', 'Meetings', 'Projects', 'Files', 'Inbox']) await expect(nav.getByRole('link', { name: place })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Talk to / })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Floor' })).toBeVisible();
  await expect(page.getByText(/coworkers across \d+ departments/)).toBeVisible();
});

test('choosing a Chief of Staff lands in Talk', async ({ page, request }) => {
  await request.put('/api/workspace', { data: { leadId: null, chiefName: null } });
  await page.goto('/app/welcome');
  await page.getByRole('button', { name: /^Choose / }).first().click();
  await expect(page).toHaveURL(/\/talk$/);
});

test('only the app itself may call the worker (cross-site pages are refused)', async ({ request, page }) => {
  const talk = { text: 'hello', opId: `op_origin_${Date.now()}` };
  const foreign = await request.post('/api/talk', { headers: { origin: 'https://evil.example' }, data: talk });
  expect(foreign.status()).toBe(403);
  expect((await foreign.json()).error.code).toBe('forbidden');
  const plain = await request.post('/api/talk', { headers: { 'content-type': 'text/plain;application/json' }, data: JSON.stringify(talk) });
  expect(plain.status()).toBe(415);
  // The app's own page (same origin through the Vite proxy) is allowed, and so is its feed socket.
  await page.goto('/app/floor');
  const ok = await page.evaluate(async () => {
    const res = await fetch('/api/workspace', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ voiceOn: false }) });
    return res.status;
  });
  expect(ok).toBe(200);
  const opened = await page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/ws?since=0`);
        ws.onmessage = () => {
          ws.close();
          resolve(true);
        };
        ws.onerror = () => resolve(false);
      }),
  );
  expect(opened).toBe(true);
});
