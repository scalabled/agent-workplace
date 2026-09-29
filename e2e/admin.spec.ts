import { expect, test } from '@playwright/test';
import { onboarded, recordFrames, say, waitForFrame } from './helpers';

// Admin (keyless, local mode: you are the owner). Every section has its own link. Change a daily limit and reset it;
// see what the models did after a message in Talk; preview the office as a reader, then come back.
test.beforeEach(async ({ request }) => {
  await onboarded(request);
});

test('settings: a daily limit changed on the admin page, then reset', async ({ page }) => {
  await page.goto('/app/admin');
  await expect(page.getByRole('heading', { level: 1, name: 'Admin' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Admin sections' }).getByRole('link', { name: 'Daily limits' }).click();
  await expect(page).toHaveURL(/\/app\/admin\/limits$/);
  const row = page.locator('#setting-JOB_DAILY_LIMIT');
  await expect(row.locator('.admin-option-source')).toHaveText('Default');
  await row.getByLabel('New background jobs', { exact: true }).fill('75');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(row.locator('.admin-option-source')).toContainText('Changed here');
  // The link to a section opens it directly.
  await page.goto('/app/admin/limits');
  await expect(page.locator('#setting-JOB_DAILY_LIMIT input')).toHaveValue('75');
  await row.getByRole('button', { name: 'Reset' }).click();
  await expect(row.locator('.admin-option-source')).toHaveText('Default');
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/admin-limits.png`, fullPage: true });
});

test('usage: a message in Talk shows up by surface and coworker', async ({ page }) => {
  await page.goto('/app/talk');
  await recordFrames(page);
  await say(page, 'What should I focus on this week?');
  await waitForFrame(page, (f) => f.type === 'talk.done' && f.live);
  await page.goto('/app/admin/usage');
  const surfaces = page.getByRole('region', { name: 'Where it went' });
  await expect(surfaces.getByRole('rowheader', { name: 'Talk (Chief of Staff)' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Who used it' }).getByRole('rowheader', { name: 'Rosa' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Today’s limits' })).toContainText('Replies');
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/admin-usage.png`, fullPage: true });
});

test('view as a reader: no composer, no edit controls; then back to owner', async ({ page }) => {
  await page.goto('/app/admin');
  await page.getByRole('button', { name: 'View as a reader' }).click();
  await expect(page.locator('.viewas-bar')).toContainText('previewing the office as a reader');
  await page.goto('/app/talk');
  await expect(page.locator('.composer-readonly')).toContainText('You can read along');
  await expect(page.locator('#composer')).toHaveCount(0);
  await page.goto('/app/memory');
  await expect(page.getByRole('heading', { level: 1, name: 'Memory' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add' })).toBeHidden();
  await expect(page.locator('.file-drop')).toBeHidden();
  await page.locator('.viewas-bar').getByRole('button', { name: 'Back to owner' }).click();
  await expect(page.locator('.viewas-bar')).toHaveCount(0);
  await page.goto('/app/talk');
  await expect(page.locator('#composer')).toBeVisible();
});
