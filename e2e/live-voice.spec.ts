import { expect, test } from '@playwright/test';
import { onboarded, recordFrames, waitForFrame } from './helpers';

// Inc 2, the Chief of Staff's live voice (project "living-voice": Mock chat and TTS, and a
// microphone that talks in 2.8 s stretches with 0.7 s pauses). Hands-free: the owner speaks without holding anything, a
// pause sends it, the Chief answers; ending it closes the mic.
test.beforeEach(async ({ request }) => {
  await onboarded(request, 'Rosa', true);
});

test('talk hands-free: a pause sends it as a spoken turn, the Chief answers, ending it closes the mic', async ({ page }) => {
  let n = 0;
  await page.route('**/api/speech/stt', (route) => route.fulfill({ json: { text: `Can you check on the supplier list, part ${++n}?`, provider: 'mock', language: 'en' } }));
  await page.goto('/app/talk');
  await recordFrames(page);

  await page.getByRole('button', { name: 'Talk hands-free' }).click();
  await expect(page.locator('.composer-live-status')).toBeVisible();
  // The fake mic speaks, pauses: the turn goes to the Chief as a spoken turn.
  const owner = await waitForFrame(page, (f) => f.type === 'talk.owner' && f.live && f.data.via === 'voice', 20_000);
  expect(String(owner.data.text)).toMatch(/^Can you check on the supplier list, part \d+\?$/);
  // The Chief answers (keyless, the pre-voiced acknowledgement covers the wait; the realtime front is a provider path).
  const turnId = owner.data.turnId as string;
  await waitForFrame(page, (f) => f.type === 'talk.done' && f.data.turnId === turnId, 30_000);
  await expect(page.getByRole('button', { name: 'End hands-free talk' })).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'End hands-free talk' }).click();
  await expect(page.locator('.composer-live-status')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Talk hands-free' })).toBeVisible();
});
