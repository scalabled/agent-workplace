import { expect, test } from '@playwright/test';
import { onboarded, recordFrames, say, waitForFrame } from './helpers';

// Files (keyless, Mock placeholders): make an image and a video on the Files page, ask the Chief for an image in Talk
// (it lands in the thread), and download a project's deliverable as Word and PowerPoint.
test.beforeEach(async ({ request }) => {
  await onboarded(request);
});

test('make an image and a video; both show in Files and play or display', async ({ page }) => {
  await page.goto('/app/files');
  await expect(page.getByRole('heading', { level: 1, name: 'Files' })).toBeVisible();
  await page.getByLabel('Describe it').fill('A flat-lay of amethyst and rose quartz on white linen');
  await page.getByRole('button', { name: 'Make the image' }).click();
  const image = page.locator('.media-tile[data-kind="image"]').first();
  await expect(image.locator('img')).toBeVisible({ timeout: 15_000 });
  expect(await image.locator('img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  // Edit it: a new version is made from it, and the original stays.
  await image.getByRole('button', { name: 'Edit' }).click();
  const dialog = page.getByRole('dialog', { name: /^Edit “/ });
  await dialog.getByLabel('What should change?').fill('Add a sprig of lavender in the corner');
  await dialog.getByRole('button', { name: 'Make the change' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.media-tile[data-kind="image"]')).toHaveCount(2);
  await expect(page.locator('.media-tile[data-kind="image"]').first()).toContainText('edited version', { timeout: 15_000 });
  await expect(page.locator('.media-tile[data-kind="image"]').first().locator('img')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('radio', { name: 'Video' }).click();
  await page.getByLabel('Describe it').fill('A slow pan across a shelf of glowing crystals');
  await page.getByRole('button', { name: 'Make the video' }).click();
  await expect(page.locator('.media-tile[data-kind="video"] video').first()).toBeVisible({ timeout: 15_000 });
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/files.png`, fullPage: true });
});

test('ask the Chief for an image: it lands in the thread', async ({ page }) => {
  await page.goto('/app/talk');
  await say(page, 'Make an image of our crystal shop logo on a dark background');
  const img = page.locator('.msg-chief .msg-body img.md-media').last();
  // The Chief brings it as their own message, with the picture.
  await expect(img).toBeVisible({ timeout: 20_000 });
  await expect(img).toHaveAttribute('src', /^\/api\/files\/fil_[a-f0-9]{20}\.svg$/);
  // "Edit it" opens that image's Edit in Files.
  await page.locator('.msg-chief .msg-body').last().getByRole('link', { name: 'Edit it' }).click();
  await expect(page).toHaveURL(/\/app\/files\?edit=fil_[a-f0-9]{20}$/);
  await expect(page.getByRole('dialog', { name: /^Edit “/ })).toBeVisible();
});

test('a delivered document downloads as Word and PowerPoint', async ({ page, request }) => {
  await page.goto('/app/talk');
  await recordFrames(page);
  await say(page, 'Put together a team to launch our spring menu with a small campaign');
  const proposed = await waitForFrame(page, (f) => f.type === 'project.proposed' && f.live);
  const project = proposed.data.project as { projectId: string; title: string };
  expect((await request.post(`/api/projects/${project.projectId}/approve`)).status()).toBe(202);
  await waitForFrame(page, (f) => f.type === 'project.updated' && (f.data.project as { projectId: string; status: string }).projectId === project.projectId && (f.data.project as { status: string }).status === 'done', 75_000);
  await page.goto('/app/files');
  const row = page.locator('.file-row', { hasText: project.title });
  await row.locator('summary', { hasText: 'Download' }).click();
  const word = page.waitForEvent('download');
  await row.getByRole('menuitem', { name: /Word/ }).click();
  expect((await word).suggestedFilename()).toMatch(/\.docx$/);
  await row.locator('summary', { hasText: 'Download' }).click();
  const slides = page.waitForEvent('download');
  await row.getByRole('menuitem', { name: /PowerPoint/ }).click();
  expect((await slides).suggestedFilename()).toMatch(/\.pptx$/);
});
