import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Browser, type APIRequestContext, type Page } from '@playwright/test';
import { LEAD, setWorkspace } from './helpers';

// Inc 0 screenshots for the owner: desktop + phone, light + dark. Writes docs/dev/screens/inc0/*.png.
// Opt-in so normal e2e runs never rewrite docs: `pnpm e2e:screens` (HEADCOUNT_SCREENS=1).
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'dev', 'screens', 'inc0');

const VARIANTS = [
  { id: 'desktop-light', viewport: { width: 1440, height: 900 }, colorScheme: 'light', mobile: false },
  { id: 'desktop-dark', viewport: { width: 1440, height: 900 }, colorScheme: 'dark', mobile: false },
  { id: 'mobile-light', viewport: { width: 375, height: 812 }, colorScheme: 'light', mobile: true },
  { id: 'mobile-dark', viewport: { width: 375, height: 812 }, colorScheme: 'dark', mobile: true },
] as const;

test.skip(!process.env.HEADCOUNT_SCREENS, 'set HEADCOUNT_SCREENS=1 (pnpm e2e:screens) to capture screenshots');
test.setTimeout(240_000);

async function shoot(browser: Browser, screen: string, path: string, ready: (page: Page) => Promise<void>): Promise<void> {
  for (const v of VARIANTS) {
    const ctx = await browser.newContext({ viewport: v.viewport, colorScheme: v.colorScheme, isMobile: v.mobile, hasTouch: v.mobile, deviceScaleFactor: 2, baseURL: test.info().project.use.baseURL });
    const page = await ctx.newPage();
    await page.goto(path);
    await ready(page);
    // Let faces draw a few frames and fonts settle.
    await page.waitForTimeout(700);
    await page.screenshot({ path: join(OUT, `${screen}-${v.id}.png`) });
    await ctx.close();
  }
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

test('capture Inc 0 screens', async ({ browser, request }) => {
  mkdirSync(OUT, { recursive: true });

  // 1. Onboarding: pick your Chief of Staff.
  await setWorkspace(request, { leadId: null, chiefName: null, voiceOn: false });
  await shoot(browser, 'welcome', '/welcome', async (page) => {
    await expect(page.getByRole('list', { name: 'Chiefs of Staff' }).getByRole('button')).toHaveCount(12);
  });

  // 2. Talk with a background job running: delegated, asked about mid-flight, steered.
  await setWorkspace(request, { leadId: LEAD, chiefName: 'Rosa', voiceOn: false });
  await talk(request, 'Hi Rosa, what can you take off my plate this week?');
  await talk(request, 'Look into coffee suppliers in Portland for me');
  await expect.poll(async () => (await jobs(request)).find((j) => j.title === 'Coffee suppliers in Portland' && j.status === 'running' && j.step >= 2), { timeout: 20_000 }).toBeTruthy();
  await talk(request, "How's it going?");
  await talk(request, 'Also check which ones are fair trade certified');
  await shoot(browser, 'talk-working', '/talk', async (page) => {
    await expect(page.locator('.activity .job').first()).toBeVisible(); // running (the last variants may catch it finishing)
  });

  // 3. The job finished: the announcement and its write-up.
  await expect.poll(async () => (await jobs(request)).find((j) => j.title === 'Coffee suppliers in Portland')?.status, { timeout: 45_000 }).toBe('done');
  await shoot(browser, 'talk-done', '/talk', async (page) => {
    const ann = page.locator('.msg-chief[data-kind="announcement"]').last();
    await expect(ann).toBeVisible();
    await ann.locator('.deliverable-head').click();
    await ann.scrollIntoViewIfNeeded();
  });

  // 4. Floor, a profile, Projects, Inbox.
  await shoot(browser, 'floor', '/floor', async (page) => {
    await expect(page.locator('.cw-card').first()).toBeVisible();
  });
  await shoot(browser, 'profile', '/floor', async (page) => {
    await page.locator('.cw-card').nth(2).click();
    await expect(page.getByRole('heading', { name: 'Story' })).toBeVisible();
  });
  await shoot(browser, 'projects', '/projects', async (page) => {
    await expect(page.locator('.job').first()).toBeVisible();
    await page.locator('.job .job-head').first().click();
  });
  await shoot(browser, 'inbox', '/inbox', async (page) => {
    await expect(page.getByText('Nothing needs you')).toBeVisible();
  });
});
