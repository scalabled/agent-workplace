import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { buildAgentIndex, compileCatalog, lineOf, type AgentExpressionProfile, type ExpressionCatalogInput } from '../packages/expressions/src/index';
import { daytimeZone, expectVoicedCaptioned, frames, livingLog, livingReady, onboarded, recordFrames, say, setWorkspace, waitForFrame } from './helpers';

// The living workforce, keyless (Mock chat, no speech provider: reflexes use the browser voice when voice is on,
// else faces, captions and bubbles). LIVING-WORKFORCE §8 (passing-by, side-threads), §9 (Ambience), §1.3 (fillers).
// The office keeps ambient chatter off in owner-local quiet hours, so these run in a daytime time zone.
test.use({ timezoneId: daytimeZone() });

/** Work claims and promises a coworker who is on no project must never make (H2, the desk honesty guard). */
const WORK_CLAIM = /\b(I|I'm|I've|I'll|we|we're|we've|we'll)\b[^.?!]{0,40}\b(working on|started|starting|finished|finishing|sent|emailed|booked|paid|published|deployed|shipped|drafted|drafting|researched|researching|looking into|will (do|send|draft|research|look))\b/i;

function compiledCatalog() {
  const bundle = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'packages/expressions/generated/expressions.json'), 'utf8')) as { input: ExpressionCatalogInput };
  return compileCatalog(bundle.input);
}

test.beforeEach(async ({ request }) => {
  await onboarded(request);
  await setWorkspace(request, { ambience: 'lively' });
});

test.afterAll(async ({ request }) => {
  await setWorkspace(request, { ambience: 'lively' });
});

/** Rest the pointer on a Directory desk (a real pause, not a pass-through). Returns its agent id. */
async function restOn(page: Page, nth: number): Promise<string> {
  const slot = page.locator('.cw-grid .cw-slot').nth(nth);
  await slot.scrollIntoViewIfNeeded();
  const box = (await slot.locator('.cw-card').boundingBox())!;
  await page.mouse.move(box.x + 24, box.y + 24);
  await page.mouse.move(box.x + 26, box.y + 25);
  return (await slot.getAttribute('data-agent-id'))!;
}

/** The face gesture on an agent's card face right now (data-face-cue, set only while a gesture plays). */
function cueOn(page: Page, agentId: string): Promise<string | null> {
  return page.evaluate((id) => document.querySelector(`.cw-slot[data-agent-id="${id}"] [data-face-cue]`)?.getAttribute('data-face-cue') ?? null, agentId);
}

test('passing by a desk: the face looks up with a short true line; Reply chats in place, in character, and Talk is untouched', async ({ page, request }) => {
  await page.goto('/app/floor');
  await livingReady(page);
  await recordFrames(page);
  const talkBefore = await page.evaluate(() => (window as unknown as { __headcount: { store: { thread: { value: unknown[] } } } }).__headcount.store.thread.value.length);

  const agentId = await restOn(page, 2);
  // The look-up comes with the dwell (600 ms), the line right after.
  await expect.poll(() => cueOn(page, agentId), { timeout: 2_000, intervals: [50] }).toBe('look_up');
  const bubble = page.locator(`[data-testid="floor-bubble"][data-agent-id="${agentId}"]`);
  await expect(bubble).toBeVisible({ timeout: 1_500 });
  const line = (await bubble.locator('.floor-bubble-text').textContent())!.trim();
  expect(line.length).toBeGreaterThan(2);
  expect(line, 'grounded: every slot filled').not.toMatch(/[{}]/);
  expect(line, 'an unstaffed coworker claims no work').not.toMatch(WORK_CLAIM);
  // The Directory row carries the line for screen readers (never announced live).
  await expect(page.locator(`.cw-slot[data-agent-id="${agentId}"] .visually-hidden`)).toContainText(line);

  // R replies in place: a one-line field in the bubble; the answer streams into it, from that coworker.
  await page.keyboard.press('r');
  const input = bubble.getByTestId('bubble-input');
  await expect(input).toBeFocused();
  await input.fill('What do you do here?');
  await input.press('Enter');
  const answer = bubble.getByTestId('bubble-answer');
  await expect(answer).not.toHaveAttribute('data-streaming', /.*/, { timeout: 15_000 });
  await expect(answer).not.toBeEmpty();
  expect(await answer.textContent()).not.toMatch(WORK_CLAIM);
  const owner = await waitForFrame(page, (f) => f.type === 'talk.owner' && f.live && f.data.agentId === agentId);
  expect(owner.data.surface).toBe('floor');
  const reply = await waitForFrame(page, (f) => f.type === 'talk.message' && f.live && f.data.turnId === owner.data.turnId);
  expect(reply.data).toMatchObject({ agentId, surface: 'floor', kind: 'reply' });

  // "thanks" gets that coworker's own reply at once, from their personality's lines (no model call).
  await input.fill('thanks!');
  await input.press('Enter');
  const thanks = await waitForFrame(page, (f) => f.type === 'talk.message' && f.live && f.data.agentId === agentId && f.data.kind === 'reflex', 5_000);
  expect(thanks.data.intent).toBe('gratitude_reply');
  await expect(answer).toHaveText(String(thanks.data.text).trim());
  const profile = (await (await request.get(`/api/expr/agents/${agentId}`)).json()).profile as AgentExpressionProfile;
  const index = buildAgentIndex(compiledCatalog(), profile);
  expect(lineOf(index, String(thanks.data.lineId))?.intent, `${thanks.data.lineId} is one of ${profile.firstName}'s own lines`).toBe('gratitude_reply');

  // One conversation per place: nothing of this reached the Chief of Staff's Talk thread.
  const talkAfter = await page.evaluate(() => (window as unknown as { __headcount: { store: { thread: { value: unknown[] } } } }).__headcount.store.thread.value.length);
  expect(talkAfter).toBe(talkBefore);
  expect((await frames(page)).filter((f) => f.type.startsWith('talk.') && f.live && f.data.agentId === agentId).every((f) => f.data.surface === 'floor')).toBe(true);
});

test('Ambience: Quiet from ⌘K turns passing-by into a look-up only; owner-directed replies still come', async ({ page, request }) => {
  await page.goto('/app/floor');
  await livingReady(page);
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('dialog').getByRole('combobox').fill('Ambience: Quiet');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await (await request.get('/api/workspace')).json()).ambience).toBe('quiet');
  await expect(page.getByTestId('ambience-control')).toHaveAttribute('aria-label', 'Ambience: Quiet');

  const agentId = await restOn(page, 5);
  await expect.poll(() => cueOn(page, agentId), { timeout: 2_000, intervals: [50] }).toBe('look_up');
  await page.waitForTimeout(1_500);
  await expect(page.locator(`[data-testid="floor-bubble"][data-agent-id="${agentId}"]`)).toHaveCount(0);
  const { telemetry } = await livingLog(page);
  expect(telemetry.filter((t) => t.agentId === agentId && t.kind === 'played')).toEqual([]);

  // A reply the owner asked for is never silenced by Ambience.
  await page.getByRole('navigation', { name: 'Places' }).getByRole('link', { name: 'Talk' }).click();
  await recordFrames(page);
  const before = await page.locator('li.msg[data-kind="reflex"]').count();
  await say(page, 'thanks!');
  await expect(page.locator('li.msg[data-kind="reflex"]')).toHaveCount(before + 1, { timeout: 1_000 });
  const done = await waitForFrame(page, (f) => f.type === 'talk.done' && f.live && f.data.route === 'reflex');
  expect(done.data.finish).toBe('stop');
});

test('"thanks" is answered at once from the catalog, marked as a reply, with no model call', async ({ page }) => {
  await page.goto('/app/talk');
  await livingReady(page);
  await recordFrames(page);
  const before = await page.locator('li.msg[data-kind="reflex"]').count();
  const sentAt = Date.now();
  await say(page, 'Thanks!');
  await expect(page.locator('li.msg[data-kind="reflex"]')).toHaveCount(before + 1, { timeout: 1_000 });
  const done = await waitForFrame(page, (f) => f.type === 'talk.done' && f.live && f.data.route === 'reflex');
  expect(done.at - sentAt).toBeLessThan(1_000);
  const msg = (await frames(page)).find((f) => f.type === 'talk.message' && f.data.turnId === done.data.turnId)!;
  expect(msg.data).toMatchObject({ kind: 'reflex', intent: 'gratitude_reply' });
  // Its words are the reply in the transcript (no second copy in a bubble).
  await expect(page.locator('li.msg[data-kind="reflex"]').last()).toContainText(String(msg.data.text).trim());
  await expect(page.getByTestId('face-bubble')).toHaveCount(0);
});

test('a slow answer gets a "one sec" that yields to the answer; a fast one gets none', async ({ page }) => {
  await page.goto('/app/talk');
  await livingReady(page);
  await recordFrames(page);
  const faceBubble = page.getByTestId('face-bubble');

  const sentAt = Date.now();
  await say(page, '!slow 4000 What should we focus on this week?');
  await expect(faceBubble).toBeVisible({ timeout: 3_500 });
  const fillerAt = Date.now();
  expect(fillerAt - sentAt, 'a text filler waits 2.5 s for the answer first').toBeGreaterThanOrEqual(2_300);
  const filler = (await faceBubble.textContent())!.trim();
  expect(filler.length).toBeGreaterThan(1);
  // The answer starts: the filler gives way to it.
  const first = await waitForFrame(page, (f) => f.type === 'talk.delta' && f.live, 10_000);
  await expect(faceBubble).toHaveCount(0, { timeout: 1_000 });
  await waitForFrame(page, (f) => f.type === 'talk.done' && f.live && f.data.turnId === first.data.turnId);
  const { telemetry } = await livingLog(page);
  expect(telemetry.filter((t) => t.intent === 'thinking_filler' && t.kind === 'played')).toHaveLength(1);

  // A fast answer needs no filler.
  await say(page, 'And what about next week?');
  const owner = await waitForFrame(page, (f) => f.type === 'talk.owner' && f.live && f.data.text === 'And what about next week?');
  await waitForFrame(page, (f) => f.type === 'talk.done' && f.live && f.data.turnId === owner.data.turnId);
  await page.waitForTimeout(3_000);
  await expect(faceBubble).toHaveCount(0);
  const after = await livingLog(page);
  expect(after.telemetry.filter((t) => t.intent === 'thinking_filler' && t.turnId === owner.data.turnId && t.kind === 'played')).toEqual([]);
  await expectVoicedCaptioned(page);
});

test('a joke typed to the Chief of Staff gets a smile, never a voiced laugh', async ({ page }) => {
  await page.goto('/app/talk');
  await livingReady(page);
  await recordFrames(page);
  const since = Date.now();
  await say(page, "Haha, the printer's haunted again");
  const owner = await waitForFrame(page, (f) => f.type === 'talk.owner' && f.live && String(f.data.text).startsWith('Haha'));
  await waitForFrame(page, (f) => f.type === 'talk.done' && f.live && f.data.turnId === owner.data.turnId);
  const { telemetry, cues } = await livingLog(page);
  expect(cues.some((c) => c.agentId === 'cw_chief' && c.at >= since && c.cue.gesture === 'smile')).toBe(true);
  expect(telemetry.filter((t) => t.intent === 'laugh' && t.kind === 'played' && t.reason !== 'bubble')).toEqual([]);
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('a desk still answers with its bubble, without any gesture', async ({ page }) => {
    await page.goto('/app/floor');
    await livingReady(page);
    const agentId = await restOn(page, 8);
    const bubble = page.locator(`[data-testid="floor-bubble"][data-agent-id="${agentId}"]`);
    const seen: (string | null)[] = [];
    const deadline = Date.now() + 2_500;
    while (Date.now() < deadline && !(await bubble.count())) {
      seen.push(await cueOn(page, agentId));
      await page.waitForTimeout(50);
    }
    await expect(bubble).toBeVisible();
    for (let i = 0; i < 10; i++) {
      seen.push(await cueOn(page, agentId));
      await page.waitForTimeout(50);
    }
    expect(seen.filter(Boolean), 'no gesture plays under reduced motion').toEqual([]);
  });
});
