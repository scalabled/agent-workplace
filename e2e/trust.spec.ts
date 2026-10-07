import { expect, test } from '@playwright/test';
import { expectNoHorizontalScroll, onboarded, recordFrames, say, waitForFrame } from './helpers';

// Inc 6 · trust and real actions, keyless (Mock provider, email in test-mailbox mode). Ask the Chief to email someone:
// the email waits on a card; approve it for 24 hours; it goes out once, with a receipt that opens in the audit log. The
// permission shows in Admin → Autonomy and can be taken back. Everyone stop holds an email until an owner resumes. A
// coworker proposes a change to how they work; approving it is in the audit log with Undo.
test.beforeEach(async ({ request }) => {
  await onboarded(request);
});

test('an email waits for your OK, goes out once with a receipt, and the receipt opens in the audit log', async ({ page }) => {
  await page.goto('/app/talk');
  await recordFrames(page);
  await say(page, 'Email jo@example.com about the spring menu');
  const card = page.locator('.talk-asks .decision-card[data-kind=effect]');
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card).toContainText('To jo@example.com');
  await expect(card).toContainText('The spring menu');
  const done = await waitForFrame(page, (f) => f.type === 'talk.done' && f.live);
  // This turn's reply (announcements of other work may land in the thread meanwhile).
  await expect(page.locator(`[id="${String(done.data.messageId)}"]`)).toContainText('nothing has been sent yet');
  await card.getByRole('combobox').selectOption('day');
  await card.getByRole('button', { name: 'Send it' }).click();
  const sent = page.locator('.msg-note[data-email]', { hasText: 'Sent “The spring menu” to jo@example.com' });
  await expect(sent).toBeVisible();
  await expect(sent).toContainText('test mailbox');
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/trust-talk-sent.png` });

  await sent.getByRole('link', { name: 'Receipt' }).click();
  await expect(page).toHaveURL(/\/app\/admin\/audit\?at=rcp_[a-f0-9]+$/);
  const entry = page.locator('.audit-entry[id^=rcp_]').first();
  await expect(entry).toHaveAttribute('data-linked', '');
  await expect(entry).toContainText('No undo: an email cannot be recalled.');
  await expect(entry.locator('.audit-receipt')).toContainText('the test mailbox');
  await expect(page.locator('.audit-entry', { hasText: 'Allowed' })).toContainText('for 24 hours');

  // The 24-hour permission: listed, then taken back.
  await page.goto('/app/admin/autonomy');
  const grant = page.locator('.trust-grant', { hasText: 'may send email until' });
  await expect(grant).toBeVisible();
  await grant.getByRole('button', { name: 'Take back' }).click();
  await expect(page.locator('.trust-grant', { hasText: 'may send email until' })).toHaveCount(0);

  // The test mailbox has it, with the disclosure line; a test email to yourself works.
  await page.goto('/app/admin/email');
  const mail = page.getByRole('list', { name: 'Test mailbox' }).locator('li', { hasText: 'The spring menu' });
  await mail.locator('summary').click();
  await expect(mail).toContainText('an AI coworker');
  await page.getByLabel('Send a test email to').fill('owner@example.com');
  await page.getByRole('button', { name: 'Send a test email' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Receipt rcp_' })).toBeVisible();
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/trust-email.png`, fullPage: true });
});

test('the dial: only the levels allowed; a change is in the audit log and Undo puts it back', async ({ page }) => {
  await page.goto('/app/admin/autonomy');
  const send = page.locator('#autonomy-external_send');
  await expect(send.getByRole('radio')).toHaveText(['Ask first', 'Propose']);
  await expect(page.locator('#autonomy-spend')).toContainText('No coworker can spend money.');
  await send.getByRole('radio', { name: 'Propose' }).click();
  await expect(send.getByRole('radio', { name: 'Propose' })).toHaveAttribute('aria-checked', 'true');
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/trust-autonomy.png`, fullPage: true });
  await page.goto('/app/admin/audit?kind=autonomy');
  const entry = page.locator('.audit-entry', { hasText: 'Sending email: ask → propose' }).first();
  await entry.getByRole('button', { name: 'Undo' }).click();
  await entry.getByRole('button', { name: 'Back to ask' }).click();
  await expect(entry).toContainText('Undone');
  await page.goto('/app/admin/autonomy');
  await expect(page.locator('#autonomy-external_send').getByRole('radio', { name: 'Ask first' })).toHaveAttribute('aria-checked', 'true');
  await page.setViewportSize({ width: 375, height: 780 });
  await expectNoHorizontalScroll(page);
});

test('Everyone stop holds an email until an owner resumes it', async ({ page, request }) => {
  expect((await request.post('/api/stop-all')).ok()).toBe(true);
  await page.goto('/app/talk');
  await expect(page.locator('.talk-asks .everyone-stop-on')).toContainText('emails are held');
  await say(page, 'Email sam@example.com about opening hours');
  await expect(page.locator('.msg-chief').last()).toContainText('held', { timeout: 30_000 });
  await page.locator('.talk-asks .everyone-stop-on').getByRole('link', { name: 'Resume' }).click();
  await expect(page).toHaveURL(/\/app\/admin\/autonomy$/);
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.getByRole('button', { name: 'Yes, resume' }).click();
  await expect(page.locator('#everyone-stop')).toHaveCount(0);
  // Held without an OK: it asks again.
  await page.goto('/app/inbox');
  await expect(page.locator('.decision-card[data-kind=effect]', { hasText: 'sam@example.com' })).toBeVisible();
});

test('a coworker proposes a change to how they work; approved, it is in the audit log with Undo', async ({ page }) => {
  await page.goto('/app/desk/bookkeeper/profile');
  const box = page.getByRole('region', { name: /Quick chat with/ }).getByRole('textbox');
  await box.fill('From now on, always give me prices with VAT included in your summaries.');
  await box.press('Enter');
  await page.goto('/app/inbox');
  const card = page.locator('.decision-card[data-kind=change]');
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card.locator('.decision-args')).toContainText('VAT included');
  await card.getByRole('button', { name: 'Approve the change' }).click();
  await expect(card).toHaveCount(0);
  await page.goto('/app/admin/audit?kind=change');
  const entry = page.locator('.audit-entry', { hasText: 'instructions changed' }).first();
  await expect(entry.getByRole('button', { name: 'Undo' })).toBeVisible();
});
