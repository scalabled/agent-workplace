import { expect, test } from '@playwright/test';
import { bodyLuminance, expectNoHorizontalScroll, onboarded } from './helpers';

// The shell (D3): four places only, the Chief of Staff bubble on every screen, phone width, light + dark.
const PLACES = [
  { path: '/app/talk', heading: 'Rosa' },
  { path: '/app/floor', heading: 'Floor' },
  { path: '/app/projects', heading: 'Projects' },
  { path: '/app/inbox', heading: 'Inbox' },
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
    if (place.path === '/app/talk') {
      // On Talk the header face is the bubble (same gestures); a floating copy would show the face twice.
      await expect(page.locator('.chief-bubble')).toBeHidden();
      await expect(page.locator('.talk-face-button')).toBeVisible();
    } else await expect(page.getByRole('button', { name: /^Talk to Rosa/ }), `bubble on ${place.path}`).toBeVisible();
  }
  // The bubble takes you to Talk from anywhere.
  await page.goto('/app/floor');
  await page.getByRole('button', { name: /^Talk to Rosa/ }).click();
  await expect(page).toHaveURL(/\/talk$/);
});

test('Inbox and Projects are calm when empty-ish, with one clear action', async ({ page }) => {
  await page.goto('/app/inbox');
  await expect(page.getByText('Nothing needs you')).toBeVisible();
  await page.goto('/app/projects');
  await expect(page.getByRole('heading', { name: 'Everyday' })).toBeVisible();
});

test('⌘K opens the palette and goes to a place', async ({ page }) => {
  await page.goto('/app/talk');
  // The app loads lazily after the entry: wait for it before using its shortcuts.
  await expect(page.getByRole('heading', { level: 1, name: 'Rosa' })).toBeVisible();
  await page.keyboard.press('ControlOrMeta+k');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('combobox')).toBeFocused();
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
      if (place.path === '/app/talk') await expect(page.locator('.activity .job').first()).toBeVisible();
      await expectNoHorizontalScroll(page);
      // The bottom tabs are fixed to the viewport: a page wider than the phone would push them out of view.
      const nav = await page.getByRole('navigation', { name: 'Places' }).boundingBox();
      expect(nav, 'bottom tabs').not.toBeNull();
      expect(nav!.y + nav!.height).toBeLessThanOrEqual(812 + 1);
      expect(nav!.x + nav!.width).toBeLessThanOrEqual(375 + 1);
    }
    // The pages added with parity, Inc 2, Inc 4 and Admin fit too.
    for (const [path, heading] of [
      ['/app/connectors', 'Connectors'],
      ['/app/automations', 'Automations'],
      ['/app/canvas', 'Canvas'],
      ['/app/skills', 'Skills'],
      ['/app/memory', 'Memory'],
      ['/app/handbook', 'Handbook'],
      ['/app/team', 'Your team'],
      ['/app/admin', 'Admin'],
      ['/app/admin/usage', 'Admin'],
      ['/app/admin/limits', 'Admin'],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      await expectNoHorizontalScroll(page);
    }
    // Talk opens at the latest message, with the composer in view.
    await page.goto('/app/talk');
    await expect(page.locator('#composer')).toBeInViewport();
    // A coworker profile and onboarding fit too.
    await page.goto('/app/floor');
    await page.locator('.cw-card').first().click();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await request.put('/api/workspace', { data: { leadId: null } });
    await page.goto('/app/welcome');
    await expect(page.getByRole('heading', { name: 'Choose your Chief of Staff' })).toBeVisible();
    await expectNoHorizontalScroll(page);
    // The obvious next action stays in reach on a phone: Choose is pinned in view.
    await expect(page.getByRole('button', { name: /^Choose / })).toBeInViewport();
    await onboarded(request);
  });

  test('More opens the palette: switch Chief of Staff and theme are reachable on a phone', async ({ page }) => {
    await page.goto('/app/floor');
    await page.getByRole('navigation', { name: 'Places' }).getByRole('button', { name: /^More/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('option', { name: /Switch Chief of Staff/ })).toBeVisible();
    await expect(dialog.getByRole('option', { name: /theme/ }).first()).toBeVisible();
  });
});

test.describe('theme: dark by default everywhere', () => {
  // The OS asks for light; Headcount is dark anyway (OWNER-DIRECTIVES D3). Light is a choice in ⌘K.
  test.use({ colorScheme: 'light' });

  test('every place is dark by default, whatever the OS prefers', async ({ page }) => {
    for (const place of PLACES) {
      await page.goto(place.path);
      await expect(page.getByRole('heading', { level: 1, name: place.heading })).toBeVisible();
      expect(await bodyLuminance(page), `${place.path} background`).toBeLessThan(0.05);
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    }
  });

  test('light is a choice in ⌘K that sticks, and the landing page stays dark', async ({ page }) => {
    await page.goto('/app/floor');
    await expect(page.getByRole('heading', { level: 1, name: 'Floor' })).toBeVisible();
    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.getByRole('dialog').getByRole('combobox')).toBeFocused();
    await page.keyboard.type('light theme');
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    expect(await bodyLuminance(page)).toBeGreaterThan(0.8);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Floor' })).toBeVisible();
    expect(await bodyLuminance(page)).toBeGreaterThan(0.8);
    // The public landing page is always dark, and the app keeps the owner's choice after it.
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Hire a team in a sentence.');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await bodyLuminance(page)).toBeLessThan(0.05);
    await page.goto('/app/floor');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    // And back to dark from the palette.
    await expect(page.getByRole('heading', { level: 1, name: 'Floor' })).toBeVisible();
    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.getByRole('dialog').getByRole('combobox')).toBeFocused();
    await page.keyboard.type('dark theme');
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });
});
