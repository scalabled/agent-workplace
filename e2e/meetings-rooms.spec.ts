import { expect, test } from '@playwright/test';
import { onboarded, say, starterTeam } from './helpers';

// Meetings called on their own (keyless, Mock): call one with people from the team, watch it in its room (the Chief moderating, the first
// picked chairing), read what they agreed, and find the Chief's note with the outcome in Talk. The Chief calls one too.
test.beforeEach(async ({ request }) => {
  await starterTeam(request);
  await onboarded(request);
});

test('call a meeting, follow it in its room, and the Chief brings the outcome to Talk', async ({ page }) => {
  await page.goto('/app/meetings');
  await expect(page.getByRole('heading', { level: 1, name: 'Meetings' })).toBeVisible();
  await page.getByLabel('What should they talk through?').fill('Should we launch a monthly crystal subscription box?');
  await page.locator('button.seat-chip', { hasText: 'Mateo' }).click();
  await page.locator('button.seat-chip', { hasText: 'Trisha' }).click();
  await page.getByRole('button', { name: 'Start the meeting' }).click();
  await expect(page).toHaveURL(/\/app\/meetings\/mtg_/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Should we launch a monthly crystal subscription box?');
  await expect(page.locator('.room-seat figcaption').first()).toContainText('moderates');
  // Mock turns are quick: the meeting runs and ends with the chair's summary.
  await expect(page.getByRole('heading', { name: 'What they agreed' })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.room-line[data-phase="synthesis"]')).toHaveCount(1);
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/meeting-room.png`, fullPage: true });
  const meetingUrl = new URL(page.url()).pathname;
  // Talk: the Chief's note with the outcome links back to the meeting.
  await page.goto('/app/talk');
  const note = page.locator('.msg', { hasText: 'is over' }).last();
  await expect(note).toBeVisible({ timeout: 15_000 });
  await expect(note.getByRole('link', { name: 'Read the meeting' })).toHaveAttribute('href', meetingUrl);
  // The Meetings page lists it under Earlier.
  await page.goto('/app/meetings');
  await expect(page.locator('.meeting-row-link', { hasText: 'crystal subscription box' })).toBeVisible();
});

test('ask the Chief in Talk to call a meeting: the reply links to it', async ({ page }) => {
  await page.goto('/app/talk');
  await say(page, 'Call a meeting about our social media posts for the spring');
  const link = page.locator('.msg a[href^="/app/meetings/mtg_"]').last();
  await expect(link).toBeVisible({ timeout: 20_000 });
  await link.click();
  await expect(page).toHaveURL(/\/app\/meetings\/mtg_/);
  await expect(page.locator('.room-seat')).not.toHaveCount(0);
});
