import { expect, test } from '@playwright/test';
import { onboarded, recordFrames, say, waitForFrame } from './helpers';

// Inc 4 · context and memory, keyless (Mock provider and embeddings): tell the Chief of Staff to remember something and
// see it recalled under a later reply; forget it on the Memory page. Let the Chief interview you for the Handbook, edit
// a section, download company.md. Share a file in Talk and find what was read on the Memory page.
test.beforeEach(async ({ request }) => {
  await onboarded(request);
});

test('remembered in Talk, recalled with a chip, forgotten on the Memory page', async ({ page }) => {
  await page.goto('/app/talk');
  await recordFrames(page);
  await say(page, 'Remember that we always close early on Sundays, at 2pm.');
  await waitForFrame(page, (f) => f.type === 'talk.message' && f.live && String(f.data.text).includes('remember that'));
  await say(page, 'What time do we close on Sundays?');
  const chip = page.locator('.recall-chip', { hasText: 'close early on Sundays' });
  await expect(chip).toBeVisible({ timeout: 30_000 });
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/memory-chip.png` });

  await chip.click();
  await expect(page).toHaveURL(/\/app\/memory$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Memory' })).toBeVisible();
  await page.getByLabel('Search the memory').fill('sundays');
  const row = page.locator('.memory-row', { hasText: 'we always close early on Sundays, at 2pm.' });
  await expect(row).toBeVisible();
  await expect(row.locator('.connector-meta')).toContainText('Rule · Told to remember');
  await row.getByRole('button', { name: 'Pin: always keep it in mind' }).click();
  await expect(row).toHaveAttribute('data-pinned', 'true');
  await row.getByRole('button', { name: 'Forget' }).click();
  await row.getByRole('button', { name: 'Forget', exact: true }).click();
  await expect(page.locator('.memory-row', { hasText: 'close early on Sundays' })).toHaveCount(0);
});

test('the Handbook: an interview in Talk writes it; edit a section; download company.md', async ({ page }) => {
  await page.goto('/app/handbook');
  await expect(page.getByRole('heading', { level: 1, name: 'Handbook' })).toBeVisible();
  await recordFrames(page);
  await page.getByRole('button', { name: /interview me|ask about the rest/ }).click();
  await expect(page).toHaveURL(/\/app\/talk$/);
  await expect(page.locator('.msg-chief').last()).toContainText("Let's write your Handbook");
  await say(page, 'We are a small café in Leeds, open since 2019 and known for our sourdough.');
  await expect(page.locator('.msg-chief').last()).toContainText('Next,', { timeout: 30_000 });
  await say(page, 'Please finish the interview for now');
  await expect(page.locator('.msg-chief').last()).toContainText('pick the Handbook up any time', { timeout: 30_000 });

  await page.goto('/app/handbook');
  const business = page.getByRole('article', { name: 'The business' });
  await expect(business).toContainText('We are a small café in Leeds');
  await expect(business).toContainText('Written by Rosa from your interview');
  const rules = page.getByRole('article', { name: 'Standing rules' });
  await rules.getByRole('button', { name: 'Edit Standing rules' }).click();
  await rules.getByRole('textbox').fill('- Never discount bread after 3pm.\n- Refunds over £50 need my OK.');
  await rules.getByRole('button', { name: 'Save' }).click();
  await expect(rules.locator('li')).toHaveCount(2);
  await expect(rules).toContainText('Written by you');
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/handbook.png`, fullPage: true });
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'company.md' }).click()]);
  expect(download.suggestedFilename()).toBe('company.md');
});

test('a file shared in Talk is read, and searchable on the Memory page', async ({ page }) => {
  await page.goto('/app/talk');
  await page.locator('.composer input[type=file]').setInputFiles({ name: 'prices.csv', mimeType: 'text/csv', buffer: Buffer.from('item,price\nlatte,3.20\noat milk (extra),0.40\nsourdough loaf,4.50\n') });
  await expect(page.locator('.composer-notice')).toContainText('Read “prices.csv”', { timeout: 30_000 });

  await page.goto('/app/memory');
  const file = page.locator('.card-row', { hasText: 'prices.csv' });
  await expect(file).toBeVisible();
  await expect(file.locator('.connector-meta')).toContainText('CSV');
  await file.getByText('What was read').click();
  await expect(file.locator('.card-row-text')).toContainText('sourdough loaf,4.50');
  await page.getByLabel('Search the memory').fill('how much is a sourdough loaf');
  await expect(page.locator('.memory-row[data-kind=excerpt]', { hasText: 'sourdough loaf' })).toBeVisible();
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/memory-files.png`, fullPage: true });

  await file.getByRole('button', { name: 'Remove prices.csv' }).click();
  await file.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.locator('.card-row', { hasText: 'prices.csv' })).toHaveCount(0);
});
