import { expect, test } from '@playwright/test';
import { expectNoHorizontalScroll, onboarded } from './helpers';

// The releases page (public): what's new, the feature guide with how to use each feature, and every release. It
// loads without the app, is dark, fits a phone, and its links lead into the guide and the app.
test('the releases page: the latest release, a guide to every feature, and links into the app', async ({ page, request }) => {
  await onboarded(request);
  await page.goto('/releases');
  await expect(page).toHaveTitle(/^Releases — /);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('What’s new');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  // The app is not loaded on a public page.
  expect(await page.evaluate(() => '__headcount' in window)).toBe(false);
  await expect(page.locator('#latest h2')).not.toBeEmpty();
  await expect(page.locator('.rl-card').first()).toBeVisible();
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/releases.png`, fullPage: true });
  // "How to use it" goes to the feature's card.
  const howto = page.locator('.rl-howto').first();
  const target = (await howto.getAttribute('href'))!;
  await howto.click();
  await expect(page.locator(target)).toBeInViewport();
  // A search narrows the guide.
  await page.getByPlaceholder(/Find a feature/).fill('meeting');
  await expect(page.locator('.rl-card', { hasText: 'Meetings, with your Chief moderating' })).toBeVisible();
  // "Open Meetings" walks into the app.
  await page.locator('.rl-card', { hasText: 'Meetings, with your Chief moderating' }).getByRole('link', { name: /Open Meetings/ }).click();
  await expect(page).toHaveURL(/\/app\/meetings$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Meetings' })).toBeVisible();
});

test.describe('phone width (375 px)', () => {
  test.use({ viewport: { width: 375, height: 812 } });
  test('the releases page fits a phone', async ({ page }) => {
    await page.goto('/releases');
    await expect(page.locator('.rl-card').first()).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});

test('the landing page links to the releases page', async ({ page }) => {
  await page.goto('/');
  await page.locator('.lp-footer').getByRole('link', { name: 'Releases' }).click();
  await expect(page).toHaveURL(/\/releases$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('What’s new');
});
