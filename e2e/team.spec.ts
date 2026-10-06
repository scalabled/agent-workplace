import { expect, test } from '@playwright/test';
import { onboarded, starterTeam } from './helpers';

// Your team (keyless): meet the Chief and the everyday team, start a first job and follow its link, tidy the second
// brain and read the report on the Memory page, and add someone from the directory to the team.
test.beforeEach(async ({ request }) => {
  await starterTeam(request);
  await onboarded(request);
});

test('meet the team, start a first job, follow it', async ({ page }) => {
  await page.goto('/app/team');
  await expect(page.getByRole('heading', { level: 1, name: 'Your team' })).toBeVisible();
  await expect(page.locator('#team-chief-name')).toHaveText('Rosa');
  await expect(page.locator('.team-card')).toHaveCount(8);
  const bookkeeper = page.locator('[id="bookkeeper"]');
  await expect(bookkeeper.locator('.team-task strong')).toHaveText('A simple monthly money check-in');
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/team.png`, fullPage: true });
  await bookkeeper.getByRole('button', { name: 'Start' }).click();
  await expect(page.locator('.toast')).toContainText('has started “A simple monthly money check-in”');
  await bookkeeper.getByRole('link', { name: /Started · see it/ }).click();
  await expect(page).toHaveURL(/\/app\/projects\?at=job_/);
  const jobId = new URL(page.url()).searchParams.get('at')!;
  await expect(page.locator(`[id="${jobId}"]`)).toHaveAttribute('data-linked', '');
});

test('the second brain: tidy now, then read the report on the Memory page', async ({ page, request }) => {
  await request.post('/api/memory', { data: { text: 'Our delivery van is serviced every March.', kind: 'fact' } });
  await page.goto('/app/team');
  await page.locator('[id="knowledge-librarian"]').getByRole('button', { name: 'Tidy now' }).click();
  await expect(page.locator('.toast')).toContainText('tidied the second brain');
  await page.locator('[id="knowledge-librarian"]').getByRole('link', { name: 'See the report' }).click();
  await expect(page).toHaveURL(/\/app\/memory\?at=second-brain$/);
  await expect(page.locator('#second-brain')).toHaveAttribute('data-linked', '');
  await expect(page.locator('#second-brain')).toContainText('Last tidied');
});

test('add someone from the directory to the team', async ({ page }) => {
  await page.goto('/app/desk/tech-lead/profile');
  await page.getByRole('button', { name: /^Hire / }).click();
  await expect(page.getByRole('button', { name: /is on your team/ })).toBeVisible();
  await page.goto('/app/team');
  await expect(page.locator('[id="tech-lead"]')).toBeVisible();
  await page.locator('[id="tech-lead"]').getByRole('button', { name: /^Let .* go$/ }).click();
  await expect(page.locator('[id="tech-lead"]')).toHaveCount(0);
});
