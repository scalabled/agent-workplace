import { expect, test } from '@playwright/test';
import { faceDrawn, setWorkspace } from './helpers';

// Pick your Chief of Staff (D1): gallery of the 12 catalog leads with faces, match quiz → top 3, naming.
test.beforeEach(async ({ request }) => {
  await setWorkspace(request, { leadId: null, chiefName: null, voiceOn: false });
});

test('the gallery shows all twelve leads with faces, a story teaser and fit', async ({ page }) => {
  // First run: /app sends you to pick your Chief of Staff.
  await page.goto('/app');
  await expect(page).toHaveURL(/\/app\/welcome$/);
  await expect(page.getByRole('heading', { name: 'Choose your Chief of Staff' })).toBeVisible();
  const cards = page.getByRole('list', { name: 'Chiefs of Staff' }).getByRole('button');
  await expect(cards).toHaveCount(12);
  // Every card has a face (the illustrated face from the catalog appearance keyless; a portrait when one exists).
  await expect(page.locator('.gallery canvas')).toHaveCount(12);
  await expect.poll(() => faceDrawn(page, '.gallery-card canvas')).toBe(true);
  await expect.poll(() => faceDrawn(page, '.stage-face canvas')).toBe(true);
  // The stage: archetype, name, tagline, backstory teaser, best-for, honesty line, name field, one primary action.
  const stage = page.locator('article.stage');
  await expect(stage.locator('.stage-arch')).not.toBeEmpty();
  await expect(stage.locator('.stage-name')).not.toBeEmpty();
  await expect(stage.locator('.stage-story')).not.toBeEmpty();
  await expect(stage.locator('.stage-fit li')).not.toHaveCount(0);
  await expect(stage.getByText(/is an AI coworker/)).toBeVisible();
  await expect(stage.getByRole('button', { name: /^Choose / })).toBeVisible();
  // Keyless: no TTS provider, so the voice sample (the lead's catalog voice) is hidden rather than faked.
  await expect(stage.getByRole('button', { name: /hear|voice sample|listen/i })).toHaveCount(0);
  // Picking another card moves it onto the stage.
  const second = cards.nth(1);
  const secondName = (await second.locator('.gallery-name').textContent())!.trim();
  await second.click();
  await expect(second).toHaveAttribute('aria-pressed', 'true');
  await expect(stage.locator('.stage-name')).toContainText(secondName);
});

test('the match quiz suggests a top three and explains why', async ({ page }) => {
  await page.goto('/app/welcome');
  await page.getByRole('button', { name: /Find your match/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  // Answer every question (single choice, multi choice or scale), always taking the first option.
  for (let i = 0; i < 20 && (await dialog.isVisible()); i++) {
    const next = dialog.locator('.quiz-next');
    if (await next.isVisible()) {
      const check = dialog.locator('.quiz-check input').first();
      if ((await check.count()) && !(await check.isChecked())) await check.check();
      await next.click();
    } else {
      await dialog.locator('.quiz-option').first().click();
    }
  }
  await expect(dialog).toBeHidden();
  const matches = page.getByRole('region', { name: 'Your matches' });
  await expect(matches.locator('li')).toHaveCount(3);
  await expect(matches.locator('.match-why').first()).not.toBeEmpty();
  await expect(page.locator('.gallery-rank', { hasText: 'Top match' })).toHaveCount(1);
  // The top match is on the stage with its reason.
  await expect(page.locator('.stage-why')).toContainText('Your top match');
  const top = (await matches.locator('.match-name').first().textContent())!.split('·')[0]!.trim();
  await expect(page.locator('.stage-name')).toContainText(top);
});

test('naming the choice saves it and lands in Talk under that name', async ({ page, request }) => {
  await page.goto('/app/welcome');
  const stage = page.locator('article.stage');
  const field = stage.getByRole('textbox', { name: /^Call / });
  await field.fill('Juniper');
  // The owner's own name is one optional field (Office Phase 2: greetings by name).
  const owner = stage.getByRole('textbox', { name: 'What should the office call you?' });
  await expect(owner).toHaveAttribute('autocomplete', 'given-name');
  await owner.fill('Dana');
  await stage.getByRole('button', { name: /^Choose / }).click();
  await expect(page).toHaveURL(/\/talk$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Juniper' })).toBeVisible();
  const saved = await (await request.get('/api/workspace')).json();
  expect(saved).toMatchObject({ chiefName: 'Juniper', ownerName: 'Dana' });
  expect(saved.leadId).toMatch(/^lead-/);
  // The Talk face and, on every other place, the bubble carry the chosen name too.
  await expect(page.locator('.talk-face-button')).toHaveAttribute('aria-label', /^Juniper,/);
  await page.getByRole('navigation', { name: 'Places' }).getByRole('link', { name: 'Floor' }).click();
  await expect(page.getByRole('button', { name: /^Talk to Juniper/ })).toBeVisible();
});
