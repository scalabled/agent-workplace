import { expect, test } from '@playwright/test';
import { onboarded } from './helpers';

// Parity stage 3b, automations, keyless: the owner sets one up on the Automations page; it starts a background job at
// once (an interval runs at its first look), and — told after every run — the Chief of Staff says so in Talk.
test.beforeEach(async ({ request }) => {
  await onboarded(request);
});

test('set up an automation; its run is announced in Talk', async ({ page }) => {
  const name = `Price check ${Date.now().toString(36)}`;
  await page.goto('/app/automations');
  await expect(page.getByRole('heading', { level: 1, name: 'Automations' })).toBeVisible();
  await page.getByRole('button', { name: 'Add an automation' }).click();
  const form = page.getByRole('form', { name: 'New automation' });
  await form.getByLabel('Name').fill(name);
  const field = (label: string) => form.locator(`label:has(> .field-label:text-is("${label}")) select`);
  await field('Every').selectOption('60');
  await form.getByLabel('What each run should do').fill('Check the three competitors’ coffee prices and say what changed.');
  await field('Tell me').selectOption('on');
  await form.getByRole('button', { name: 'Add it' }).click();
  const card = page.locator('.automation-card', { hasText: name });
  await expect(card.locator('.connector-desc')).toHaveText('Every hour → a background job');
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/automations.png`, fullPage: true });

  await page.goto('/app/talk');
  await expect(page.locator('.msg-chief .msg-body', { hasText: `“${name}” ran:` })).toBeVisible({ timeout: 60_000 });
});
