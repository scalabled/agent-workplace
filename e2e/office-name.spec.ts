import { expect, test } from '@playwright/test';
import { expectNoHorizontalScroll, onboarded, recordFrames, say, starterTeam, waitForFrame } from './helpers';

// The office's own name: an owner renames it on Admin → General, and it shows at the top of the app and in the tab
// (in place of the product's name). Phones: Meetings and Files fit the screen with work under way, and on Files what
// was made comes before making something new.
test.beforeEach(async ({ request }) => {
  await onboarded(request);
});

test('rename the office: its name is at the top of the app and in the tab', async ({ page, request }) => {
  await page.goto('/app/admin?at=organization');
  // Rename opens a dialog with the one field; nothing else on the page competes with it.
  await page.locator('#organization').getByRole('button', { name: 'Rename' }).click();
  const dialog = page.getByRole('dialog', { name: 'Rename this office' });
  const field = dialog.getByRole('textbox', { name: 'Office name' });
  await expect(field).toBeFocused();
  await field.fill('Amethyst & Co');
  await dialog.getByRole('button', { name: 'Rename' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Renamed' })).toBeVisible();
  await expect(page.locator('.nav .nav-brand-name')).toHaveText('Amethyst & Co');
  await expect(page).toHaveTitle('Amethyst & Co');
  await page.goto('/app/talk');
  await expect(page.locator('.nav .nav-brand-name')).toHaveText('Amethyst & Co');
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/office-name.png` });
  // Back to the product's name for the other specs.
  expect((await request.put('/api/org', { data: { name: 'Agent Workplace' } })).ok()).toBe(true);
});

test.describe('phone width (390 px)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('Meetings fits the screen with a project under way; Files shows what was made before the maker', async ({ page, request }) => {
    await starterTeam(request);
    await page.goto('/app/talk');
    await recordFrames(page);
    await say(page, 'Put together a team to launch our spring menu with a small campaign');
    await waitForFrame(page, (f) => f.type === 'project.proposed' && f.live);
    await page.goto('/app/meetings');
    await expect(page.locator('.call-meeting select').first()).toBeVisible();
    await expectNoHorizontalScroll(page);
    const nav = await page.locator('nav.nav').boundingBox();
    expect(Math.round(nav!.y + nav!.height)).toBe(844);
    if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/m-meetings.png` });
    await page.goto('/app/files');
    const made = await page.locator('#media-title').boundingBox();
    const maker = await page.locator('#make').boundingBox();
    expect(made!.y).toBeLessThan(maker!.y);
    await expectNoHorizontalScroll(page);
    if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/m-files.png` });
  });
});
