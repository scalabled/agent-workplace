import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { LEAD, pinDirectory, setWorkspace } from './helpers';

// Inc 0.6 screenshots for the owner: the landing page and the app, desktop + phone, dark by default (the OS
// asks for light, to show it no longer decides), plus the app's light option on two screens.
// Writes docs/dev/screens/inc0.6/*.png. Opt-in so normal e2e runs never rewrite docs: `pnpm e2e:screens`.
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'dev', 'screens', 'inc0.6');

interface Variant {
  id: string;
  viewport: { width: number; height: number };
  mobile: boolean;
  light?: boolean;
}

const DESKTOP: Variant = { id: 'desktop', viewport: { width: 1440, height: 900 }, mobile: false };
const MOBILE: Variant = { id: 'mobile', viewport: { width: 375, height: 812 }, mobile: true };
const DESKTOP_LIGHT: Variant = { ...DESKTOP, id: 'desktop-light', light: true };
const DEFAULT = [DESKTOP, MOBILE];

test.skip(!process.env.HEADCOUNT_SCREENS, 'set HEADCOUNT_SCREENS=1 (pnpm e2e:screens) to capture screenshots');
test.setTimeout(300_000);

async function shoot(browser: Browser, screen: string, path: string, ready: (page: Page) => Promise<void>, variants: Variant[] = DEFAULT, fullPage = false): Promise<void> {
  for (const v of variants) {
    const ctx = await browser.newContext({ viewport: v.viewport, colorScheme: 'light', isMobile: v.mobile, hasTouch: v.mobile, deviceScaleFactor: 2, baseURL: test.info().project.use.baseURL });
    if (v.light) await ctx.addInitScript(() => localStorage.setItem('headcount.theme', 'light'));
    // These are the Directory's screens (the Office's: e2e/office-screens.spec.ts).
    await pinDirectory(ctx);
    const page = await ctx.newPage();
    await page.goto(path);
    await ready(page);
    // Let faces draw a few frames and fonts settle.
    await page.waitForTimeout(900);
    await page.screenshot({ path: join(OUT, `${screen}-${v.id}.png`), fullPage });
    await ctx.close();
  }
}

/**
 * Scroll the landing page through once, so scroll reveals have fired and lazy faces and images have loaded. Each
 * stop lasts longer than a portrait's fade-in: faces pause off screen, and a full-page capture shows them as left.
 */
async function revealLanding(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Hire an AI team');
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y <= height; y += 400) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(450);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1200);
}

/** Say something and let the reply finish (a new message while a reply streams would cut it: barge-in). */
async function talk(request: APIRequestContext, text: string): Promise<void> {
  const res = await request.post('/api/talk', { data: { text, opId: `op_screens_${Date.now()}_${Math.random().toString(36).slice(2)}` } });
  expect(res.status()).toBe(202);
  await new Promise((r) => setTimeout(r, 1500));
}

async function jobs(request: APIRequestContext): Promise<{ jobId: string; status: string; step: number; title: string }[]> {
  return (await (await request.get('/api/jobs')).json()).jobs;
}

test('capture Inc 0.6 screens', async ({ browser, request }) => {
  mkdirSync(OUT, { recursive: true });

  // 1. The landing page: the first screen, the full page, and the portrait wall with side-talk.
  await setWorkspace(request, { leadId: null, chiefName: null, voiceOn: false });
  await shoot(browser, 'landing-hero', '/', async (page) => {
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Hire an AI team');
    await page.waitForTimeout(1800); // the kinetic tagline has landed
  });
  await shoot(browser, 'landing-full', '/', revealLanding, DEFAULT, true);
  await shoot(browser, 'landing-wall', '/', async (page) => {
    await revealLanding(page);
    await page.locator('.lp-wall').scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, -140));
    await expect(page.locator('.lp-bubble').first()).toBeVisible({ timeout: 15_000 });
  });

  // 2. Onboarding: pick your Chief of Staff.
  await shoot(browser, 'welcome', '/app/welcome', async (page) => {
    await expect(page.getByRole('list', { name: 'Chiefs of Staff' }).getByRole('button')).toHaveCount(12);
  });

  // 3. Talk with a background job running: delegated, asked about mid-flight, steered.
  await setWorkspace(request, { leadId: LEAD, chiefName: 'Rosa', voiceOn: false });
  await talk(request, 'Hi Rosa, what can you take off my plate this week?');
  await talk(request, 'Look into coffee suppliers in Portland for me');
  await expect.poll(async () => (await jobs(request)).find((j) => j.title === 'Coffee suppliers in Portland' && j.status === 'running' && j.step >= 2), { timeout: 20_000 }).toBeTruthy();
  await talk(request, "How's it going?");
  await talk(request, 'Also check which ones are fair trade certified');
  await shoot(browser, 'talk-working', '/app/talk', async (page) => {
    await expect(page.locator('.activity .job').first()).toBeVisible();
  });

  // 4. The job finished: the announcement and its write-up (and the light option).
  await expect.poll(async () => (await jobs(request)).find((j) => j.title === 'Coffee suppliers in Portland')?.status, { timeout: 45_000 }).toBe('done');
  await shoot(
    browser,
    'talk-done',
    '/app/talk',
    async (page) => {
      const ann = page.locator('.msg-chief[data-kind="announcement"]').last();
      await expect(ann).toBeVisible();
      await ann.locator('.deliverable-head').click();
      await ann.scrollIntoViewIfNeeded();
    },
    [DESKTOP, MOBILE, DESKTOP_LIGHT],
  );

  // 5. Floor, a profile, Projects, Inbox.
  await shoot(browser, 'floor', '/app/floor', async (page) => {
    await expect(page.locator('.cw-card').first()).toBeVisible();
  }, [DESKTOP, MOBILE, DESKTOP_LIGHT]);
  await shoot(browser, 'profile', '/app/floor', async (page) => {
    await page.locator('.cw-card').nth(2).click();
    await expect(page.getByRole('heading', { name: 'Story' })).toBeVisible();
  });
  await shoot(browser, 'projects', '/app/projects', async (page) => {
    await expect(page.locator('.job').first()).toBeVisible();
    await page.locator('.job .job-head').first().click();
  });
  await shoot(browser, 'inbox', '/app/inbox', async (page) => {
    await expect(page.getByText('Nothing needs you')).toBeVisible();
  });
});
