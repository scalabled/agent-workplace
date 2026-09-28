import { expect, test } from '@playwright/test';
import { bodyLuminance, expectNoHorizontalScroll, onboarded } from './helpers';

// The shell (D3): four places only, the Chief of Staff bubble on every screen, phone width, light + dark.
const PLACES = [
  { path: '/talk', heading: 'Rosa' },
  { path: '/floor', heading: 'Floor' },
  { path: '/projects', heading: 'Projects' },
  { path: '/inbox', heading: 'Inbox' },
];

test.beforeEach(async ({ request }) => {
  await onboarded(request);
});

test('four places, and the Chief of Staff bubble on every one', async ({ page }) => {
  for (const place of PLACES) {
    await page.goto(place.path);
    await expect(page.getByRole('heading', { level: 1, name: place.heading })).toBeVisible();
    const nav = page.getByRole('navigation', { name: 'Places' });
    await expect(nav.getByRole('link')).toHaveCount(4);
    for (const name of ['Talk', 'Floor', 'Projects', 'Inbox']) await expect(nav.getByRole('link', { name })).toBeVisible();
    if (place.path === '/talk') {
      // On Talk the header face is the bubble (same gestures); a floating copy would show the face twice.
      await expect(page.locator('.chief-bubble')).toBeHidden();
      await expect(page.locator('.talk-face-button')).toBeVisible();
    } else await expect(page.getByRole('button', { name: /^Talk to Rosa/ }), `bubble on ${place.path}`).toBeVisible();
  }
  // The bubble takes you to Talk from anywhere.
  await page.goto('/floor');
  await page.getByRole('button', { name: /^Talk to Rosa/ }).click();
  await expect(page).toHaveURL(/\/talk$/);
});

test('Inbox and Projects are calm when empty-ish, with one clear action', async ({ page }) => {
  await page.goto('/inbox');
  await expect(page.getByText('Nothing needs you')).toBeVisible();
  await page.goto('/projects');
  await expect(page.getByRole('heading', { name: 'Everyday' })).toBeVisible();
});

test('⌘K opens the palette and goes to a place', async ({ page }) => {
  await page.goto('/talk');
  await page.keyboard.press('ControlOrMeta+k');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await page.keyboard.type('Inbox');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/inbox$/);
});

test.describe('phone width (375 px)', () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

  test('no horizontal scroll anywhere, bottom tabs in view, even with a long running sentence', async ({ page, request }) => {
    // A running job puts its (long) running sentence in the Talk header and an Activity row in the dock.
    await request.post('/api/talk', { data: { text: 'Look into refrigerated delivery vans for a small bakery in the city centre', opId: `op_mobile_${Date.now()}` } });
    await expect.poll(async () => ((await (await request.get('/api/jobs')).json()).jobs as { status: string }[]).some((j) => j.status === 'running')).toBe(true);
    for (const place of PLACES) {
      await page.goto(place.path);
      await expect(page.getByRole('heading', { level: 1, name: place.heading })).toBeVisible();
      if (place.path === '/talk') await expect(page.locator('.activity .job').first()).toBeVisible();
      await expectNoHorizontalScroll(page);
      // The bottom tabs are fixed to the viewport: a page wider than the phone would push them out of view.
      const nav = await page.getByRole('navigation', { name: 'Places' }).boundingBox();
      expect(nav, 'bottom tabs').not.toBeNull();
      expect(nav!.y + nav!.height).toBeLessThanOrEqual(812 + 1);
      expect(nav!.x + nav!.width).toBeLessThanOrEqual(375 + 1);
    }
    // Talk opens at the latest message, with the composer in view.
    await page.goto('/talk');
    await expect(page.locator('#composer')).toBeInViewport();
    // A coworker profile and onboarding fit too.
    await page.goto('/floor');
    await page.locator('.cw-card').first().click();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await request.put('/api/workspace', { data: { leadId: null } });
    await page.goto('/welcome');
    await expect(page.getByRole('heading', { name: 'Choose your Chief of Staff' })).toBeVisible();
    await expectNoHorizontalScroll(page);
    // The obvious next action stays in reach on a phone: Choose is pinned in view.
    await expect(page.getByRole('button', { name: /^Choose / })).toBeInViewport();
    await onboarded(request);
  });

  test('More opens the palette: switch Chief of Staff and theme are reachable on a phone', async ({ page }) => {
    await page.goto('/floor');
    await page.getByRole('navigation', { name: 'Places' }).getByRole('button', { name: /^More/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('option', { name: /Switch Chief of Staff/ })).toBeVisible();
    await expect(dialog.getByRole('option', { name: /theme/ }).first()).toBeVisible();
  });
});

test.describe('dark mode', () => {
  test.use({ colorScheme: 'dark' });

  test('follows the OS: dark surfaces on every place', async ({ page }) => {
    for (const place of PLACES) {
      await page.goto(place.path);
      await expect(page.getByRole('heading', { level: 1, name: place.heading })).toBeVisible();
      expect(await bodyLuminance(page), `${place.path} background`).toBeLessThan(0.05);
    }
  });

  test('light mode is light', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/floor');
    await expect(page.getByRole('heading', { level: 1, name: 'Floor' })).toBeVisible();
    expect(await bodyLuminance(page)).toBeGreaterThan(0.8);
  });
});
