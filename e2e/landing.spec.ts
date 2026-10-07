import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { expectNoHorizontalScroll, faceDrawn, onboarded, setWorkspace } from './helpers';

// The public landing page ("/", D3): kinetic hero, the real cast from the catalog, honest copy, dark always,
// light on JavaScript (the app is not loaded until you walk in), and "Enter the office" → /app.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The catalog bundle the app is built from: names change, so tests read them instead of hard-coding any. */
async function catalogLeads(): Promise<{ id: string; name: string }[]> {
  const mod = (await import(join(ROOT, 'packages/catalog/generated/slim.js'))) as { default: { leads: { id: string; name: string }[] } };
  return mod.default.leads;
}

function manifest(): { key: string; alt: string; file: string }[] {
  return JSON.parse(readFileSync(join(ROOT, 'apps/web/public/marketing/manifest.json'), 'utf8'));
}

/** Leads with a pre-voiced sample shipped with the page ("Hear …" works for them without a key). */
function voiceSamples(): Record<string, { chunks: { file: string }[] }> {
  try {
    return JSON.parse(readFileSync(join(ROOT, 'apps/web/public/marketing/voices/manifest.json'), 'utf8'));
  } catch {
    return {};
  }
}

/** Scroll the whole page in steps (reveals and lazy faces fire as a visitor would see them). */
async function scrollThrough(page: Page, check?: () => Promise<void>): Promise<void> {
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y <= height; y += 600) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(60);
    await check?.();
  }
}

test('the landing page: kinetic hero, the real cast, honest pricing, and no app until you walk in', async ({ page, request }) => {
  await setWorkspace(request, { leadId: null, chiefName: null, voiceOn: false });
  const sockets: string[] = [];
  page.on('websocket', (ws) => sockets.push(ws.url()));
  await page.goto('/');
  await expect(page).toHaveTitle('Headcount — The AI Office');
  await expect(page.getByRole('heading', { level: 1, name: 'Hire a team in a sentence. Watch it work.' })).toHaveText('Hire a team in a sentence. Watch it work.');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  // The hero shows the real cast (the catalog's faces, labelled as an illustration) over the generated office,
  // which is a decorative backdrop now and still loads first.
  await expect(page.locator('.lp-cast-tile')).toHaveCount(6);
  await expect(page.locator('.lp-cast .lp-illus-tag')).toHaveText('Illustration');
  await expect.poll(() => faceDrawn(page, '.lp-cast-tile canvas'), { timeout: 15_000 }).toBe(true);
  const heroImg = page.locator('.lp-hero-img');
  await expect(heroImg).toHaveAttribute('alt', '');
  await expect(heroImg).toHaveAttribute('fetchpriority', 'high');
  expect(manifest().find((m) => m.key === 'hero')).toBeTruthy();
  // Every other generated image is lazy.
  const lazy = await page.locator('.lp img').evaluateAll((imgs) => imgs.slice(1).map((i) => i.getAttribute('loading')));
  expect(lazy.length).toBeGreaterThanOrEqual(2);
  expect(lazy.every((l) => l === 'lazy')).toBe(true);

  // Chief of Staff carousel: every lead, named as the catalog names them today.
  const leads = await catalogLeads();
  await expect(page.locator('.lp-lead-name')).toHaveText(leads.map((l) => l.name));
  // Keyless: "Hear …" only where a pre-voiced sample ships with the page (a browser voice would not be theirs).
  const voiced = leads.filter((l) => voiceSamples()[l.id]);
  await expect(page.locator('.lp-voice')).toHaveCount(voiced.length);

  // The living portrait wall: faces draw when it comes into view, and side-talk is marked as a demo.
  const wall = page.getByRole('list', { name: 'Some of the coworkers in the catalog' });
  await wall.scrollIntoViewIfNeeded();
  expect(await wall.locator('.lp-tile').count()).toBeGreaterThanOrEqual(9);
  await expect.poll(() => faceDrawn(page, '.lp-tile canvas'), { timeout: 15_000 }).toBe(true);
  const bubble = page.locator('.lp-bubble').first();
  await expect(bubble).toBeVisible({ timeout: 15_000 });
  await expect(bubble.locator('.lp-bubble-tag')).toHaveText('Demo');
  await expect(page.locator('.lp-caption')).toContainText('demonstration');

  // Honest by rule: pricing is labelled planned; nothing claims customers or testimonials.
  await expect(page.locator('#pricing')).toContainText('Planned pricing');
  await expect(page.locator('.lp-tier')).toHaveCount(3);
  const text = await page.locator('.lp').innerText();
  expect(text).not.toMatch(/testimonial|trusted by|customers love|\d+\+ (teams|customers|businesses)/i);
  for (const section of ['How it works', 'Meet your Chief of Staff', 'The living workforce', 'Talk while they work', 'Multimodal', 'Trust by design', 'Industry packs', 'Pricing', 'FAQ']) {
    await expect(page.locator('.lp-eyebrow', { hasText: section }).first()).toBeAttached();
  }
  // What is not built says so (the packs); what works today carries no pill.
  await expect(page.locator('.lp-status', { hasText: 'Works today' })).toHaveCount(0);
  for (const title of ['Approvals', 'Receipts', 'Everyone stop']) await expect(page.locator('.lp-trust li', { hasText: title }).locator('.lp-status')).toHaveCount(0);
  await expect(page.locator('.lp-packs-section .lp-eyebrow .lp-status')).toHaveText('Planned');

  // The app has not loaded: no store, no feed socket.
  expect(await page.evaluate(() => '__headcount' in window)).toBe(false);
  expect(sockets.filter((u) => u.includes('/api/ws'))).toEqual([]);

  // Walk in: first run lands on "Choose your Chief of Staff", and now the app connects.
  await page.getByRole('navigation', { name: 'Headcount' }).getByRole('link', { name: 'Enter the office' }).click();
  await expect(page).toHaveURL(/\/app\/welcome$/);
  await expect(page.getByRole('heading', { name: 'Choose your Chief of Staff' })).toBeVisible();
  await expect.poll(() => sockets.some((u) => u.includes('/api/ws'))).toBe(true);
  // Back goes back to the landing page (/app replaced itself with /app/welcome).
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Hire a team');
});

test('a section link scrolls to its section, and Back from the app returns to where you were', async ({ page, request }) => {
  await setWorkspace(request, { leadId: null, chiefName: null, voiceOn: false });
  await page.goto('/#pricing');
  await expect(page.locator('#pricing')).toBeInViewport();
  const y = await page.evaluate(() => window.scrollY);
  expect(y).toBeGreaterThan(2000);
  await page.locator('#pricing .lp-pricing-cta').getByRole('link', { name: /Enter the office/ }).click();
  await expect(page).toHaveURL(/\/app\/welcome$/);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await page.goBack();
  await expect(page).toHaveURL(/\/#pricing$/);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(y - 400);
});

test('an owner who chose light never sees the landing page flash light', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('headcount.theme', 'light');
    const seen: string[] = ((window as unknown as { __themes: string[] }).__themes = []);
    const record = () => seen.push(document.documentElement.dataset.theme ?? '');
    record();
    new MutationObserver(record).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Hire a team');
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as unknown as { __themes: string[] }).__themes)).not.toContain('light');
});

test('laptop screens keep the call to action above the fold', async ({ page }) => {
  for (const viewport of [{ width: 1366, height: 768 }, { width: 1280, height: 720 }]) {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await expect(page.locator('.lp-hero').getByRole('link', { name: /Enter the office/ })).toBeInViewport({ ratio: 1 });
  }
});

test('a returning owner walks straight into Talk', async ({ page, request }) => {
  await onboarded(request);
  await page.goto('/');
  await page.locator('.lp-hero').getByRole('link', { name: /Enter the office/ }).click();
  await expect(page).toHaveURL(/\/app\/talk$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Rosa' })).toBeVisible();
});

test('pre-landing app paths redirect to /app', async ({ page, request }) => {
  await onboarded(request);
  for (const path of ['/talk', '/floor', '/projects', '/inbox', '/welcome']) {
    await page.goto(path);
    await expect(page, path).toHaveURL(new RegExp(`/app${path}$`));
  }
  const id = (await catalogLeads())[0]!.id;
  await page.goto(`/desk/${id}/profile`);
  await expect(page).toHaveURL(new RegExp(`/app/desk/${id}/profile$`));
});

test.describe('phone width (375 px)', () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

  test('the landing page fits: no horizontal scroll anywhere, faces first, one call to action at a time, a menu', async ({ page }) => {
    await page.goto('/');
    const heroCta = page.locator('.lp-hero').getByRole('link', { name: /Enter the office/ });
    const navCta = page.getByRole('navigation', { name: 'Headcount' }).getByRole('link', { name: 'Enter the office' });
    await expect(heroCta).toBeInViewport();
    // Real faces above the headline, and the nav's copy of the CTA waits until the hero's has scrolled away.
    expect(await page.locator('.lp-cast-tile:visible').count()).toBe(5);
    await expect(navCta).toBeHidden();
    // The menu reaches every section.
    await page.getByRole('button', { name: 'Open the menu' }).click();
    await expect(page.locator('#lp-nav-links').getByRole('link', { name: 'Pricing' })).toBeVisible();
    await page.locator('#lp-nav-links').getByRole('link', { name: 'Pricing' }).click();
    await expect(page.locator('#pricing')).toBeInViewport();
    await expect(navCta).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    await scrollThrough(page, () => expectNoHorizontalScroll(page));
    // Three columns of faces on a phone.
    expect(await page.locator('.lp-tile:visible').count()).toBe(9);
  });
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('nothing moves and nothing waits to be revealed', async ({ page }) => {
    await page.goto('/');
    const word = page.locator('.lp-w > span').first();
    expect(await word.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
    expect(await page.locator('.lp').getAttribute('data-motion')).toBeNull();
    // Far down the page, without scrolling: fully visible.
    const faq = page.locator('.lp-faq-item').first();
    expect(await faq.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    expect(await page.locator('.lp-aurora span').first().evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
  });
});
