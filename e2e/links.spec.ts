import { expect, test } from '@playwright/test';
import { onboarded, recordFrames, say, waitForFrame } from './helpers';

// Link-first (keyless): every message, item and setting has a link; a link opens the page at that item, highlighted.
// Inside documents, a selected passage can be linked to or asked about, in a side chat pinned to it.
test.beforeEach(async ({ request, context }) => {
  await onboarded(request);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
});

const clipboard = (page: import('@playwright/test').Page) => page.evaluate(() => navigator.clipboard.readText());

test('a message’s link opens Talk at that message, highlighted', async ({ page, context }) => {
  await page.goto('/app/talk');
  await recordFrames(page);
  await say(page, 'Remember that our supplier delivers on Tuesdays.');
  const reply = await waitForFrame(page, (f) => f.type === 'talk.message' && f.live);
  const id = reply.data.messageId as string;
  const msg = page.locator(`[id="${id}"]`);
  await msg.hover();
  await msg.getByRole('link', { name: 'Copy link to this message' }).click();
  await expect(page.locator('.toast')).toHaveText('Link to this message copied');
  const url = await clipboard(page);
  expect(url).toMatch(new RegExp(`/app/talk\\?at=${id}$`));

  const other = await context.newPage();
  await other.goto(url);
  await expect(other.locator(`[id="${id}"]`)).toHaveAttribute('data-linked', '');
  await expect(other.locator(`[id="${id}"]`)).toBeInViewport();
});

test('links to a memory and to a setting', async ({ page, request }) => {
  const mem = (await (await request.post('/api/memory', { data: { text: 'The walk-in fridge is serviced every March.', kind: 'fact' } })).json()) as { memory: { memoryId: string } };
  await page.goto(`/app/memory?at=${mem.memory.memoryId}`);
  await expect(page.locator(`[id="${mem.memory.memoryId}"]`)).toHaveAttribute('data-linked', '');
  await page.goto('/app/admin/limits?at=setting-CANVAS_DAILY_LIMIT');
  await expect(page.locator('#setting-CANVAS_DAILY_LIMIT')).toHaveAttribute('data-linked', '');
  await expect(page.locator('#setting-CANVAS_DAILY_LIMIT')).toBeInViewport();
  // Every page's title carries its own link.
  await page.getByRole('link', { name: 'Copy link to this page' }).click();
  expect(await clipboard(page)).toMatch(/\/app\/admin\/limits$/);
});

test('a canvas document: ask about a selected passage; the conversation has its own link', async ({ page, request, context }) => {
  const made = (await (await request.post('/api/canvas', { data: { brief: 'Write a one-page opening checklist for our café', kind: 'document', title: 'Opening checklist' } })).json()) as { canvas: { canvasId: string } };
  const id = made.canvas.canvasId;
  await page.goto(`/app/canvas/${id}`);
  await expect(page.locator('.canvas-status')).toContainText(/Document · \d+ words/, { timeout: 30_000 });
  const doc = page.frameLocator('.canvas-frame');
  const para = doc.locator('main p').first();
  await para.click({ clickCount: 3 });
  const bar = page.getByRole('toolbar', { name: 'The selected passage' });
  await expect(bar).toBeVisible();
  await bar.getByRole('button', { name: 'Ask Rosa' }).click();
  await page.getByPlaceholder('Ask Rosa about this, or say what to change…').fill('Why does this come first?');
  await page.getByRole('button', { name: 'Ask Rosa' }).last().click();
  const thread = page.locator('.doc-thread');
  await expect(thread.locator('.doc-thread-messages li')).toHaveCount(2, { timeout: 30_000 });
  await expect(thread.locator('.doc-thread-messages li').last()).toContainText('Rosa');
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/canvas-side-chat.png`, fullPage: true });

  await thread.getByRole('link', { name: 'Copy link to this conversation' }).click();
  const url = await clipboard(page);
  expect(url).toMatch(new RegExp(`/app/canvas/${id}\\?thread=thr_[a-f0-9]+&at=b-\\d+$`));
  const other = await context.newPage();
  await other.goto(url);
  await expect(other.locator('.doc-thread-passage').first()).toBeVisible();
  await expect(other.locator('.doc-thread-messages li')).toHaveCount(2);
});

test('the Handbook: a passage asked about, and the section rewritten from the side chat', async ({ page, request }) => {
  await request.put('/api/handbook/rules', { data: { content: 'Never discount bread after 3pm.' } });
  await page.goto('/app/handbook');
  const passage = page.locator('[id^="hb-rules-b-"]').first();
  await passage.click({ clickCount: 3 });
  await page.getByRole('toolbar', { name: 'The selected passage' }).getByRole('button', { name: 'Ask Rosa' }).click();
  await page.getByPlaceholder('Ask Rosa about this, or say what to change…').fill('Add that refunds over £50 need my OK');
  await page.getByRole('button', { name: 'Ask Rosa' }).last().click();
  await expect(page.locator('.doc-thread .connector-tag', { hasText: 'Handbook updated' })).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await expect(page.getByRole('article', { name: 'Standing rules' })).toContainText('refunds over £50 need my OK');
});
