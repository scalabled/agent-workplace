import { expect, test } from '@playwright/test';
import { onboarded, recordFrames, say, waitForFrame } from './helpers';

// The canvas (personagram-ai parity), keyless: the Mock builder writes a small working app or a short document.
// Build an app from the Canvas page and use it inside its sandbox; download it as HTML; open the PDF print view;
// change it (a new version); ask the Chief of Staff for a document in Talk and open it from the reply.
test.beforeEach(async ({ request }) => {
  await onboarded(request);
});

test('build an app on the canvas, use it, download it, print it, change it', async ({ page }) => {
  await page.goto('/app/canvas');
  await expect(page.getByRole('heading', { level: 1, name: 'Canvas' })).toBeVisible();
  await page.getByLabel('What should it make?').fill('Build a tip calculator that splits the bill between friends');
  await page.getByRole('button', { name: 'Build it' }).click();
  await expect(page).toHaveURL(/\/app\/canvas\/cnv_[a-f0-9]+$/);
  const status = page.locator('.canvas-status');
  await expect(status).toContainText('lines · interactive', { timeout: 30_000 });
  await expect(page.getByRole('heading', { level: 1, name: 'Tip calculator that splits the bill between friends' })).toBeVisible();

  // It runs, sandboxed, and responds.
  const app = page.frameLocator('.canvas-frame');
  await expect(app.locator('h1')).toHaveText('Tip calculator that splits the bill between friends');
  await app.getByRole('button', { name: 'Burst' }).click();
  await expect(app.locator('#clicks')).toHaveText('1 burst');
  const sandbox = await page.locator('.canvas-frame').getAttribute('sandbox');
  expect(sandbox).toBe('allow-scripts allow-pointer-lock');
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/canvas-app.png` });

  // Download HTML; the PDF view opens in a new tab with the print dialog.
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'HTML' }).click()]);
  expect(download.suggestedFilename()).toBe('Tip-calculator-that-splits-the-bill-between-friends.html');
  const [printed] = await Promise.all([page.waitForEvent('popup'), page.getByRole('link', { name: 'PDF' }).click()]);
  await expect(printed.locator('h1')).toHaveText('Tip calculator that splits the bill between friends');
  await printed.close();

  // Change it: a new version, with the first one still in the versions menu.
  const first = page.url();
  await page.getByLabel('What should change?').fill('Add a dark mode toggle');
  await page.getByRole('button', { name: 'Make the change' }).click();
  await expect(page).not.toHaveURL(first);
  await expect(status).toContainText('lines · interactive', { timeout: 30_000 });
  await expect(page.locator('.canvas-versions option')).toHaveCount(2);
});

test('the Chief writes a document on the canvas; the reply links to it', async ({ page }) => {
  await page.goto('/app/talk');
  await recordFrames(page);
  await say(page, 'Write me a closing checklist document for the café');
  const msg = await waitForFrame(page, (f) => f.type === 'talk.message' && f.live && typeof f.data.canvasId === 'string');
  await page.locator('.msg-canvas').last().click();
  await expect(page).toHaveURL(new RegExp(`/app/canvas/${msg.data.canvasId as string}$`));
  await expect(page.locator('.canvas-status')).toContainText(/Document · \d+ words/, { timeout: 30_000 });
  const doc = page.frameLocator('.canvas-frame');
  await expect(doc.locator('h1')).toBeVisible();
  await expect(doc.locator('table')).toBeVisible();
  // A document runs no script but the canvas's own (allowed by its hash), and never with our origin.
  expect(await page.locator('.canvas-frame').getAttribute('sandbox')).toBe('allow-scripts');
  const [md] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Markdown' }).click()]);
  expect(md.suggestedFilename()).toMatch(/\.md$/);
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/canvas-doc.png` });
});
