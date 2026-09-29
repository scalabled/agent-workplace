import { expect, test } from '@playwright/test';
import { onboarded, recordFrames, say, waitForFrame } from './helpers';

// Parity stage 5, MCP connectors, keyless: the demo notebook (served inside the worker in mock mode) is connected from
// the catalog, its tools listed; the Chief of Staff's call waits on a card in Talk until the owner allows it.
test.beforeEach(async ({ request }) => {
  await onboarded(request);
});

test('connect the demo notebook, then allow the Chief to use it from Talk', async ({ page }) => {
  await page.goto('/app/connectors');
  await expect(page.getByRole('heading', { level: 1, name: 'Connectors' })).toBeVisible();
  const card = page.locator('.connector-card', { hasText: 'Demo notebook' });
  if (!(await card.count())) await page.getByRole('button', { name: 'Connect Demo notebook' }).click();
  await expect(card.locator('.connector-status')).toHaveText('Ready');
  await card.getByText('What it can do (3)').click();
  await expect(card.locator('.connector-tool')).toHaveCount(3);
  await expect(card.locator('.connector-tool').first()).toContainText('Reads only');
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/connectors.png`, fullPage: true });

  await page.goto('/app/talk');
  await recordFrames(page);
  await say(page, 'What is in my notebook? (use demo_notebook__list_notes)');
  const ask = page.locator('.talk-asks .decision-card');
  await expect(ask).toContainText('wants to use Demo notebook → list_notes');
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/talk-ask.png` });
  await ask.getByRole('button', { name: 'Allow once' }).click();
  await waitForFrame(page, (f) => f.type === 'talk.done' && f.live);
  await expect(page.locator('.msg-chief .msg-body').last()).toContainText('Done with Demo notebook');
  await expect(ask).toHaveCount(0);
});
