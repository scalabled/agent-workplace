import { expect, test } from '@playwright/test';
import { expectNoHorizontalScroll, onboarded, recordFrames, say, waitForFrame } from './helpers';

// Inc 2, keyless: a team's kickoff is a real meeting (the Chief opens and closes, the lead chairs); the owner replays it
// from the project page and the now-playing bar keeps it going on another page. Without a provider voice the lines play
// as captions ("reading along"); meeting-voice.spec.ts covers the voiced path.
test.beforeEach(async ({ request }) => {
  await onboarded(request);
});

test('replay the kickoff; the now-playing bar follows the owner around the app', async ({ page }) => {
  await page.goto('/app/talk');
  await recordFrames(page);
  await say(page, 'Put together a team to launch our spring menu with a small campaign');
  const proposed = await waitForFrame(page, (f) => f.type === 'project.proposed' && f.live);
  const project = proposed.data.project as { projectId: string; title: string; team: { name: string }[] };
  expect((await page.request.post(`/api/projects/${project.projectId}/approve`)).status()).toBe(202);

  await page.goto(`/app/projects/${project.projectId}`);
  const kickoff = page.locator('.meeting', { hasText: 'Kickoff' });
  await expect(kickoff.locator('.connector-meta')).toContainText(/Held .* lines/, { timeout: 30_000 });
  // The transcript: the Chief opens, the lead frames, everyone opens, the lead sums up, the Chief closes.
  await expectNoHorizontalScroll(page);
  await kickoff.getByRole('button', { name: 'Read the transcript' }).click();
  await expect(kickoff.locator('.meeting-transcript li').first()).toContainText('Kickoff for');
  await expect(kickoff.locator('.meeting-transcript li')).toHaveCount(project.team.length + 3);

  await kickoff.getByRole('button', { name: 'Replay' }).click();
  const bar = page.getByRole('complementary', { name: 'Now playing' });
  await expect(bar).toBeVisible();
  await expect(bar.locator('.np-caption')).toContainText(/^(Rosa: Kickoff for|\w+: )/);
  const total = project.team.length + 3;
  await expect(bar.locator('.np-pos')).toHaveText(new RegExp(`^\\d+ / ${total}$`));
  await expect(bar.locator('.np-note')).toContainText('Reading along');
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/meetings.png` });

  // It keeps playing on another page.
  await page.getByRole('link', { name: 'Talk' }).first().click();
  await expect(page).toHaveURL(/\/app\/talk$/);
  const at = Number((await bar.locator('.np-pos').textContent())!.split(' / ')[0]);
  if (at < total) {
    await bar.getByRole('button', { name: 'Next line' }).click();
    await expect.poll(async () => Number((await bar.locator('.np-pos').textContent())!.split(' / ')[0])).toBeGreaterThan(at);
  }
  await bar.getByRole('button', { name: 'Stop listening' }).click();
  await expect(bar).toHaveCount(0);
});
