import { expect, test } from '@playwright/test';
import { expectNoHorizontalScroll, onboarded, recordFrames, say, waitForFrame } from './helpers';

// Inc 4 · context and memory, keyless (Mock provider and embeddings): tell the Chief of Staff to remember something and
// see it recalled under a later reply; forget it on the Memory page. Let the Chief interview you for the Handbook, edit
// a section, download company.md. Share a file in Talk and find what was read on the Memory page. Show the Chief a
// picture (a file, a camera photo, a screen snapshot) with a message; it is described and kept on the Memory page.
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
  await page.locator('.composer-file-input').setInputFiles({ name: 'prices.csv', mimeType: 'text/csv', buffer: Buffer.from('item,price\nlatte,3.20\noat milk (extra),0.40\nsourdough loaf,4.50\n') });
  await expect(page.locator('.composer-file[data-ready]', { hasText: 'prices.csv' })).toBeVisible({ timeout: 30_000 });

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

/** A real 1×1 PNG. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

test('a picture shown with a message: the Chief looks at it, and it is kept (described) on the Memory page', async ({ page }) => {
  await page.goto('/app/talk');
  await recordFrames(page);
  await page.locator('.composer-file-input').setInputFiles({ name: 'shelf.png', mimeType: 'image/png', buffer: PNG });
  const chip = page.locator('.composer-file', { hasText: 'shelf.png' });
  await expect(chip).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
  await expect(chip.locator('img')).toBeVisible();
  await say(page, 'What do you make of this shelf?');
  await expect(page.locator('.composer-files')).toHaveCount(0);
  const mine = page.locator('.msg-owner', { hasText: 'What do you make of this shelf?' });
  const thumb = mine.locator('.msg-shown img');
  await expect(thumb).toHaveAttribute('alt', 'shelf.png');
  await expect.poll(() => thumb.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
  await waitForFrame(page, (f) => f.type === 'talk.done' && f.live);
  await expect(page.locator('.msg-chief').last()).toContainText('I can see the picture');
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/talk-picture.png` });

  await mine.locator('.msg-shown a').click();
  await expect(page).toHaveURL(/\/app\/memory\?at=card_[a-f0-9]{16}$/);
  const row = page.locator('.card-row', { hasText: 'shelf.png' });
  await expect(row.locator('.connector-meta')).toContainText('Picture');
  await row.getByText('What it shows').click();
  await expect(row.locator('.card-row-text')).toContainText('I can see the picture');
});

test('take a photo with the camera and send it', async ({ page }) => {
  await page.goto('/app/talk');
  await page.getByRole('button', { name: /a file or picture$/ }).click();
  await expect(page.getByRole('menuitem', { name: 'A snapshot of your screen' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Take a photo' }).click();
  const sheet = page.getByRole('dialog', { name: 'Take a photo' });
  await sheet.getByRole('button', { name: 'Take photo' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.locator('.composer-file[data-ready]', { hasText: /^Photo \d{4}-/ })).toBeVisible({ timeout: 30_000 });
  await page.locator('#composer').press('Enter');
  await expect(page.locator('.msg-owner', { hasText: 'Take a look at this.' }).locator('.msg-shown img')).toBeVisible();
  // At phone width the menu and the tray fit.
  await page.setViewportSize({ width: 375, height: 780 });
  await page.locator('.composer-file-input').setInputFiles({ name: 'shelf-with-a-long-name-from-a-phone-camera.png', mimeType: 'image/png', buffer: PNG });
  await page.getByRole('button', { name: /a file or picture$/ }).click();
  await expect(page.getByRole('menuitem', { name: 'Take a photo' })).toBeVisible();
  await expectNoHorizontalScroll(page);
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/talk-attach-phone.png` });
});


test('a snapshot of the screen goes with the next message', async ({ page }) => {
  await page.goto('/app/talk');
  await page.getByRole('button', { name: /a file or picture$/ }).click();
  await page.getByRole('menuitem', { name: 'A snapshot of your screen' }).click();
  await expect(page.locator('.composer-file[data-ready]', { hasText: /^Screen \d{4}-/ })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('menu')).toHaveCount(0);
});
