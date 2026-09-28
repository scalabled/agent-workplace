import { expect, test } from '@playwright/test';
import { faceDrawn, onboarded } from './helpers';

// Floor (browse): the Directory of catalog coworkers, search + department filter, profile.
test.beforeEach(async ({ request }) => {
  await onboarded(request);
});

test('the Directory lists every coworker by department, with faces', async ({ page }) => {
  await page.goto('/floor');
  const lede = page.getByText(/(\d+) coworkers across (\d+) departments/);
  await expect(lede).toBeVisible();
  const [, total] = (await lede.textContent())!.match(/(\d+) coworkers/)!;
  expect(Number(total)).toBeGreaterThanOrEqual(140);
  expect(await page.locator('.cw-card').count()).toBe(Number(total));
  expect(await page.locator('section.dept').count()).toBeGreaterThanOrEqual(10);
  // Faces load lazily as cards scroll into view; the first ones are drawn.
  await expect(page.locator('.cw-card').first().locator('canvas')).toHaveCount(1);
  await expect.poll(() => faceDrawn(page, '.cw-card canvas')).toBe(true);
});

test('search and the department filter narrow the Directory', async ({ page }) => {
  await page.goto('/floor');
  await expect(page.getByText(/coworkers across \d+ departments/)).toBeVisible();
  const all = await page.locator('.cw-card').count();
  expect(all).toBeGreaterThan(100);
  const search = page.getByRole('searchbox', { name: 'Search coworkers' });
  await search.fill('contract');
  await expect(page.locator('.floor-count')).toHaveText(/\d+ coworkers?/);
  const found = await page.locator('.cw-card').count();
  expect(found).toBeGreaterThan(0);
  expect(found).toBeLessThan(all);
  await search.fill('zzzz-nobody');
  await expect(page.locator('.floor-count')).toContainText('No one matches.');
  await page.getByRole('button', { name: 'Show everyone' }).click();
  await expect(page.locator('.cw-card')).toHaveCount(all);
  // Department filter: one section only.
  const select = page.getByRole('combobox', { name: 'Department' });
  const firstDept = await select.locator('option').nth(1).getAttribute('value');
  await select.selectOption(firstDept!);
  await expect(page.locator('section.dept')).toHaveCount(1);
});

test('a coworker profile shows the face, story and methods', async ({ page }) => {
  await page.goto('/floor');
  await expect(page.locator('.cw-card').first()).toBeVisible();
  const card = page.locator('.cw-card').first();
  const name = (await card.locator('.cw-name').textContent())!.trim();
  await card.click();
  await expect(page).toHaveURL(/\/desk\/[^/]+\/profile$/);
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  await expect(page.locator('.profile-title')).not.toBeEmpty();
  await expect(page.getByRole('heading', { name: 'Story' })).toBeVisible();
  await expect(page.locator('.profile-story')).not.toBeEmpty();
  await expect(page.getByRole('heading', { name: 'Signature methods' })).toBeVisible();
  await expect.poll(() => faceDrawn(page, '.profile-face canvas')).toBe(true);
  // The accessible label names the person once.
  const title = (await page.locator('.profile-title').textContent())!.trim();
  await expect(page.locator('.profile-face canvas')).toHaveAttribute('aria-label', `${name}, ${title}`);
  // Back to the Floor.
  await page.locator('.back-link').click();
  await expect(page).toHaveURL(/\/floor$/);
});
