import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { onboarded, recordFrames, say, setWorkspace, waitForFrame } from './helpers';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Pre-voiced landing samples shipped with the page (apps/web/public/marketing/voices). */
function voiceSamples(): Record<string, { text: string; chunks: { file: string }[] }> {
  try {
    return JSON.parse(readFileSync(join(ROOT, 'apps/web/public/marketing/voices/manifest.json'), 'utf8'));
  } catch {
    return {};
  }
}

/**
 * The line a lead's ▶ says, built as the landing builds it (`sampleText`). A pre-voiced file plays only if it says
 * exactly this line: after a cast rename the old recordings are skipped and the TTS route speaks.
 */
function sampleLine(first: string): string {
  const quiz = JSON.parse(readFileSync(join(ROOT, 'catalog/leads/match-quiz.json'), 'utf8')) as { try_before_choosing?: { voice_preview_line?: string } };
  const preview = quiz.try_before_choosing?.voice_preview_line;
  const intro = `Hi, I'm ${first}.`;
  return preview ? `${intro} ${preview.replace(/^Hi,\s*/i, '').replace(/^./, (c) => c.toUpperCase())}` : intro;
}

// The voice path in a real browser (project "voice": worker with --mock-media, Chromium's fake mic).
// Mock TTS returns silent audio with character timing, so the whole pipeline runs: TTS per sentence → the one
// AudioContext → the "speaking" state from audio actually playing → the mouth following it → barge-in.
// Push-to-talk records the fake microphone and Mock STT transcribes it.

/** The Chief of Staff's mouth right now (0–1), read from the same sampler the faces draw from. */
async function mouthOpenness(page: Page): Promise<number> {
  return page.evaluate(() => {
    const hc = (window as unknown as { __headcount: { chiefSpeaker: { mouth: { sample(now: number): { openness: number } } } } }).__headcount;
    return hc.chiefSpeaker.mouth.sample(performance.now()).openness;
  });
}

/** Record the talk face's state changes with timestamps. */
async function watchFaceState(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __faceStates: { state: string; at: number }[] };
    w.__faceStates = [];
    const el = document.querySelector('.talk-face')!;
    const push = () => w.__faceStates.push({ state: el.getAttribute('data-state') ?? '', at: performance.now() });
    push();
    new MutationObserver(push).observe(el, { attributes: true, attributeFilter: ['data-state'] });
  });
}

test.beforeEach(async ({ request }) => {
  await onboarded(request, 'Rosa', true);
});

test('with a speech provider, voice controls show and the lead voice sample plays', async ({ page, request }) => {
  const caps = await (await request.get('/api/capabilities')).json();
  expect(caps.modalities.tts.available).toBe(true);
  expect(caps.modalities.stt.available).toBe(true);
  await setWorkspace(request, { leadId: null });
  await page.goto('/app/welcome');
  const sample = page.getByRole('button', { name: /^Hear .+'s voice$/ });
  await expect(sample).toBeVisible();
  const tts = page.waitForRequest((r) => r.url().includes('/api/speech/tts') && r.method() === 'POST');
  await sample.click();
  const body = (await tts).postDataJSON() as { voiceRef: { openai?: string; xai?: string } };
  // The lead's catalog voice travels with the request.
  expect(body.voiceRef.openai ?? body.voiceRef.xai).toBeTruthy();
  await expect(page.getByRole('button', { name: /^Stop .+'s voice sample$/ })).toBeVisible();
});

test('the landing page plays each lead in their own voice when a speech provider exists', async ({ page }) => {
  await page.goto('/');
  const cards = page.locator('.lp-lead');
  await expect(cards.first()).toBeAttached(); // the landing page loads lazily after the entry
  const count = await cards.count();
  expect(count).toBeGreaterThan(0);
  // One ▶ per lead, named by the catalog first name shown on the card.
  await expect(page.locator('.lp-voice')).toHaveCount(count);
  const first = cards.first();
  const name = ((await first.locator('.lp-lead-name').textContent()) ?? '').trim().split(/\s+/)[0]!;
  // A pre-voiced sample (static audio with its timing) plays without the TTS route; otherwise the route speaks.
  const leadId = await first.evaluate((el) => el.getAttribute('data-lead') ?? '');
  const recorded = voiceSamples()[leadId];
  const sample = recorded?.text === sampleLine(name) ? recorded : null;
  const fetched = sample
    ? page.waitForRequest((r) => r.url().includes('/marketing/voices/') && r.method() === 'GET')
    : page.waitForRequest((r) => r.url().includes('/api/speech/tts') && r.method() === 'POST');
  await first.getByRole('button', { name: `Hear ${name}'s voice` }).click();
  const req = await fetched;
  if (!sample) {
    const body = req.postDataJSON() as { voiceRef: { openai?: string; xai?: string }; speakerId: string };
    expect(body.voiceRef.openai ?? body.voiceRef.xai).toBeTruthy();
  } else expect(req.url()).toContain(sample.chunks[0]!.file);
  await expect(first.getByRole('button', { name: `Stop ${name}'s voice sample` })).toBeVisible();
  // The sample ends by itself and the control resets.
  await expect(first.getByRole('button', { name: `Hear ${name}'s voice` })).toBeVisible({ timeout: 30_000 });
});

test('a spoken reply moves the mouth with the audio; a stop cue ends it at the sentence, Esc at once', async ({ page }) => {
  await page.goto('/app/talk');
  await expect(page.getByRole('button', { name: /Voice on/ })).toBeVisible();
  await recordFrames(page);
  await page.locator('#composer').click(); // a gesture arms audio, as for a real owner
  await watchFaceState(page);
  const ttsCalls: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/speech/tts')) ttsCalls.push((r.postDataJSON() as { text: string }).text);
  });

  expect(await mouthOpenness(page), 'the mouth rests while nothing plays').toBeLessThan(0.02);
  await say(page, 'Tell me a little about how you like to work with people');
  await expect(page.locator('.talk-face')).toHaveAttribute('data-state', 'speaking', { timeout: 15_000 });
  expect(ttsCalls.length).toBeGreaterThan(0);
  // The mouth follows the playing audio (character timing from TTS), not a timer: it opens while speaking.
  await expect.poll(() => mouthOpenness(page), { timeout: 5_000, intervals: [50] }).toBeGreaterThan(0.05);

  // Sending while they speak (X5 amended, LIVING-WORKFORCE §2.3): typing does not stop them; a stop cue ends the
  // reply at the end of the sentence now playing (the rest stays on screen), and the new answer follows.
  // Mock TTS speaks 60 ms a character: the whole three-sentence reply is about 11 s, its first sentence about 5 s.
  await page.locator('#composer').fill('Hold on');
  await page.waitForTimeout(300);
  await expect(page.locator('.talk-face')).toHaveAttribute('data-state', 'speaking');
  const sentAt = await page.evaluate(() => performance.now());
  await page.locator('#composer').fill('Hold on, one quick thing');
  await page.locator('#composer').press('Enter');
  const stoppedAfter = async () =>
    page.evaluate((t) => {
      const s = (window as unknown as { __faceStates: { state: string; at: number }[] }).__faceStates.find((x) => x.at > t && x.state !== 'speaking');
      return s ? s.at - t : null;
    }, sentAt);
  await expect.poll(stoppedAfter, { timeout: 8_000 }).not.toBeNull();
  expect(await stoppedAfter(), 'the reply ended at its sentence boundary, not after the whole reply').toBeLessThan(6500);
  // The new reply is spoken in turn.
  const second = await waitForFrame(page, (f) => f.type === 'talk.owner' && f.live && f.data.text === 'Hold on, one quick thing');
  await waitForFrame(page, (f) => f.type === 'talk.done' && f.live && f.data.turnId === second.data.turnId && !!f.data.messageId, 15_000);
  await expect(page.locator('.talk-face')).toHaveAttribute('data-state', 'speaking', { timeout: 15_000 });

  // Esc is still a barge-in: playback stops at once.
  const escAt = await page.evaluate(() => performance.now());
  await page.keyboard.press('Escape');
  await expect
    .poll(async () => page.evaluate((t) => (window as unknown as { __faceStates: { state: string; at: number }[] }).__faceStates.find((x) => x.at > t && x.state !== 'speaking')?.at ?? null, escAt), { timeout: 3_000 })
    .not.toBeNull();
  const escStopped = await page.evaluate((t) => (window as unknown as { __faceStates: { state: string; at: number }[] }).__faceStates.find((x) => x.at > t && x.state !== 'speaking')!.at - t, escAt);
  expect(escStopped, 'Esc stopped speech within 1 s').toBeLessThan(1000);
});

test('push-to-talk records the microphone and sends what was said', async ({ page }) => {
  await page.goto('/app/talk');
  await recordFrames(page);
  const mic = page.getByRole('button', { name: /^Talk: hold/ });
  await expect(mic).toBeVisible();
  const box = (await mic.boundingBox())!;
  const stt = page.waitForResponse((r) => r.url().includes('/api/speech/stt'));
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(page.getByRole('button', { name: /^Listening/ })).toBeVisible();
  await page.waitForTimeout(1500);
  await page.mouse.up();
  const res = await stt;
  expect(res.status()).toBe(200);
  const owner = await waitForFrame(page, (f) => f.type === 'talk.owner' && f.live && f.data.via === 'voice', 15_000);
  expect(String(owner.data.text)).toMatch(/mock transcript of \d+ bytes of audio/);
  await expect(page.locator('.msg-owner').last()).toContainText('mock transcript');
});
