import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { daytimeZone, livingReady, onboarded, setWorkspace, waitForFrame, recordFrames } from './helpers';
import { frameHuddle, officeState, openOffice, OWNER, restOn, seatedInView, skipOfficeHint } from './office-helpers';

// Office Phase 2 screens for the owner (docs/dev/screens/office-app/, JPEG at 2×), on the voice stack (Mock chat, Mock
// TTS: room lines are voiced, so the stage shows its speaker lit with no NOT VOICED tag; the keyless look has its
// own shot). Opt-in so normal e2e runs never rewrite docs: `HEADCOUNT_SCREENS=1 pnpm e2e e2e/office-screens.spec.ts`.
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'dev', 'screens', 'office-app');

test.skip(!process.env.HEADCOUNT_SCREENS, 'set HEADCOUNT_SCREENS=1 to capture the office screens');
test.use({ timezoneId: daytimeZone(), viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
test.setTimeout(240_000);

test.beforeAll(() => mkdirSync(OUT, { recursive: true }));
test.beforeEach(async ({ request, page }) => {
  await onboarded(request, 'Rosa', true);
  await setWorkspace(request, { ambience: 'lively', ownerName: OWNER });
  await skipOfficeHint(page);
});

const shot = (page: Page, name: string) => page.screenshot({ path: join(OUT, `${name}.jpg`), type: 'jpeg', quality: 86 });
const scene = (page: Page, fn: string) => page.evaluate((src) => new Function('s', `return (${src})(s)`)((window as unknown as { __headcount: { office: { scene: unknown } } }).__headcount.office.scene), fn);

test('desk mode: night, a huddle, passing by, a quick chat, joining, following', async ({ page }) => {
  // 1. The opening view at night (L1 where life is: the north glass), then the whole plate under the city (fit).
  await openOffice(page, '23:10');
  await page.waitForTimeout(2500);
  await shot(page, 'office-night-l1');
  await scene(page, "(s) => s.zoomTo('fit')");
  await page.waitForTimeout(1800);
  await shot(page, 'office-night-wide');

  // 2. Mid-morning: the coffee round, a huddle talking at desk zoom.
  await openOffice(page, '10:35');
  await livingReady(page);
  const h = await frameHuddle(page);
  await page.mouse.move(40, 880);
  await expect
    .poll(() => page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.hc-o-bubble--talk:not(.is-leaving)')].some((b) => b.style.visibility !== 'hidden')), { timeout: 20_000 })
    .toBe(true);
  await page.waitForTimeout(400);
  await shot(page, 'office-desk-huddle');

  // 3. The huddle's card, then joined: greeted by name, one reply.
  await page.mouse.move(h.x, h.y + 160, { steps: 3 });
  await page.mouse.move(h.x, h.y, { steps: 6 });
  await expect(page.locator('.hc-o-hcard')).toBeVisible();
  await page.waitForTimeout(500);
  await shot(page, 'office-huddle-card');
  await recordFrames(page);
  await page.locator('.hc-o-hcard').getByRole('button', { name: 'Join' }).click();
  await expect.poll(() => page.locator('.hc-o-hcard__line').allTextContents().then((t) => t.join(' ')), { timeout: 8_000 }).toContain(OWNER);
  await page.locator('.hc-o-hcard__input').fill('What are you two debating?');
  await page.locator('.hc-o-hcard__input').press('Enter');
  const owner = await waitForFrame(page, (f) => f.type === 'talk.owner' && f.live && f.data.surface === 'room');
  await waitForFrame(page, (f) => f.type === 'talk.message' && f.live && f.data.turnId === owner.data.turnId, 20_000);
  await page.waitForTimeout(1500);
  await shot(page, 'office-huddle-joined');
  await page.locator('.hc-o-hcard__input').focus();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1500);

  // 4. Passing by a desk, then a quick chat in place.
  await openOffice(page, '15:10');
  await livingReady(page);
  const who = await seatedInView(page);
  await restOn(page, who, 1400);
  await shot(page, 'office-hover-bubble');
  await page.mouse.click(who.x, who.y);
  const input = page.locator(`[data-testid="floor-bubble"][data-agent-id="${who.id}"]`).getByTestId('bubble-input');
  await input.fill('What would you look at first on a pricing page?');
  await input.press('Enter');
  await expect(page.locator(`[data-testid="floor-bubble"][data-agent-id="${who.id}"]`).getByTestId('bubble-answer')).not.toBeEmpty({ timeout: 15_000 });
  await page.waitForTimeout(800);
  await shot(page, 'office-quick-chat');
  await page.keyboard.press('Escape');

  // 5. Follow a walker: the chip, the camera keeping them in view.
  await openOffice(page, '10:36');
  let walker: string | null = null;
  for (let k = 0; k < 40 && !walker; k++) {
    walker = await page.evaluate(() => {
      const host = document.querySelector('.hc-office')!.getBoundingClientRect();
      for (const b of document.querySelectorAll<HTMLElement>('.hc-o-seat[data-walking]:not([data-chief])')) {
        const r = b.getBoundingClientRect();
        if (r.x > host.left + 200 && r.x < host.right - 200 && r.y > host.top + 150 && r.y < host.bottom - 150) return b.dataset.pid!;
      }
      return null;
    });
    if (!walker) await page.waitForTimeout(500);
  }
  if (walker) {
    await page.locator(`.hc-o-seat[data-pid="${walker}"]`).focus();
    await page.keyboard.press('f');
    await page.mouse.move(40, 880);
    await page.waitForTimeout(3000);
    await shot(page, 'office-follow');
    await page.keyboard.press('Escape');
  }

  // 6. What's happening.
  await openOffice(page, '10:35');
  await page.locator('.hc-o-life__pill').click();
  await page.waitForTimeout(500);
  await shot(page, 'office-whats-happening');
});

test('the conference stage: three at the table, mid-answer; the keyless look; the note in Talk', async ({ page, request }) => {
  await openOffice(page, '15:10');
  await livingReady(page);
  await page.keyboard.press('g');
  await page.locator('.hc-o-walk .hc-o-menu__item', { hasText: 'Skyline room' }).first().click();
  await expect(page.locator('.hc-o-stage')).toBeVisible();
  await page.keyboard.press('i');
  for (const q of ['copywriter', 'brand strategist', 'pricing']) {
    await page.fill('.hc-o-picker input[type=search]', q);
    await page.locator('.hc-o-picker__row:visible input:not(:disabled)').first().check();
  }
  await page.locator('.hc-o-picker__foot .hc-o-btn--primary').click();
  await expect(page.locator('.hc-o-sseat')).toHaveCount(3, { timeout: 10_000 });
  await page.waitForTimeout(1500);
  await shot(page, 'office-stage-seated');
  const field = page.getByTestId('room-dock').locator('input').first();
  await field.click();
  await field.fill('What do you all think about bundling the starter plan?');
  await field.press('Enter');
  await page.waitForSelector('.hc-o-sseat[data-speaking]', { state: 'attached', timeout: 20_000 });
  await page.waitForTimeout(1200);
  await shot(page, 'office-stage-speaking');
  // The keyless look: voice off (or no key) shows every line as a caption with NOT VOICED.
  await setWorkspace(request, { voiceOn: false });
  await expect.poll(() => page.evaluate(() => (window as unknown as { __headcount: { store: { settings: { value: { voiceOn: boolean } } } } }).__headcount.store.settings.value.voiceOn)).toBe(false);
  await field.fill('And what would you test first?');
  await field.press('Enter');
  await page.waitForSelector('.hc-o-stage__cap .hc-o-cap__tag:not([hidden])', { state: 'attached', timeout: 20_000 });
  await page.waitForTimeout(600);
  await shot(page, 'office-stage-not-voiced');
  await page.locator('.room-dock__transcript summary').click();
  await page.waitForTimeout(300);
  await shot(page, 'office-stage-transcript');
  await field.focus();
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await officeState(page)).mode).toBe('desks');
  await setWorkspace(request, { voiceOn: true });
  await page.getByRole('navigation', { name: 'Places' }).getByRole('link', { name: 'Talk' }).click();
  await expect(page.locator('li.msg[data-kind="note"]').last()).toBeVisible({ timeout: 10_000 });
  await page.locator('li.msg[data-kind="note"]').last().scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await shot(page, 'talk-room-note');
});

test('the Directory toggle and a phone', async ({ page, browser, baseURL }) => {
  await page.goto('/app/floor?view=directory');
  await expect(page.locator('.cw-grid .cw-card').first()).toBeVisible();
  // A gesture here takes the voice (the earlier tabs of this run had it), so no "Play here" chip.
  await page.locator('.page-lede').click();
  await expect(page.getByTestId('voice-elsewhere')).toHaveCount(0);
  await page.waitForTimeout(1200);
  await shot(page, 'directory-toggle');
  const ctx = await browser.newContext({ baseURL, viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, timezoneId: daytimeZone() });
  await skipOfficeHint(ctx);
  const phone = await ctx.newPage();
  await phone.goto('/app/floor?view=office&at=10:35');
  await phone.waitForFunction(() => (window as unknown as { __headcount?: { office?: { ready(): boolean } } }).__headcount?.office?.ready(), null, { timeout: 30_000 });
  await phone.waitForTimeout(2500);
  await phone.screenshot({ path: join(OUT, 'office-mobile-375.jpg'), type: 'jpeg', quality: 86 });
  await phone.goto('/app/floor?view=directory');
  await expect(phone.locator('.cw-grid .cw-card').first()).toBeVisible();
  await phone.waitForTimeout(800);
  await phone.screenshot({ path: join(OUT, 'directory-mobile-375.jpg'), type: 'jpeg', quality: 86 });
  await ctx.close();
});
