import { expect, test, type Page } from '@playwright/test';
import { daytimeZone, frames, onboarded, recordFrames, setWorkspace, waitForFrame, type SeenFrame } from './helpers';
import { deskLight, officeState, openOffice, OWNER, restOn, screenOf, seatedInView, skipOfficeHint } from './office-helpers';

// The Office on the Floor, keyless (Mock chat, no speech provider): OFFICE-PHASE2 §7.4 and OFFICE-PLAN §6.6. The
// Floor opens as the Office on a desktop; desk mode (passing by, quick chat, presence), the conference roundtable
// (invite, captions in order, a new message cancels the rest, Esc leaves, one note in Talk), the reply guard live,
// the toggle and the Directory, reduced motion and phones. Life at a fixed office clock: e2e/office-life.spec.ts.
// Voice (one voice per workspace, listen-in, barge-in): e2e/office-voice.spec.ts.
test.use({ viewport: { width: 1440, height: 900 }, timezoneId: daytimeZone() });

/** The reply guard: the office demo's canned "went up nine points" is only ever said back when the owner said it.
 * `!invent` makes the Mock state a figure nobody gave ("went up 12 points after the relaunch"): the guard drops it. */
const INVENTED = /12 points|went up 12|twelve/i;
const FIGURE_LINE = "I'd want the real numbers before I put a figure on it.";

test.beforeEach(async ({ request, page }) => {
  await onboarded(request);
  await setWorkspace(request, { ambience: 'lively', ownerName: OWNER });
  await skipOfficeHint(page);
});

const talkThread = (page: Page) =>
  page.evaluate(() => (window as unknown as { __headcount: { store: { thread: { value: { kind: string; text: string }[] } } } }).__headcount.store.thread.value.map((m) => ({ kind: m.kind, text: m.text })));
const sideThreads = (page: Page) =>
  page.evaluate(() => JSON.stringify((window as unknown as { __headcount: { store: { sideThreads: { value: unknown } } } }).__headcount.store.sideThreads.value));

test('the Floor opens as the Office on a desktop; the toggle is remembered; ?view= and the skip link reach the Directory', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  await page.goto('/app/floor');
  await expect(page.getByTestId('office-view')).toBeVisible();
  await expect(page.locator('.hc-o-seat')).toHaveCount(165);
  const toggle = page.getByTestId('floor-view');
  await expect(toggle.getByRole('radio', { name: 'Office' })).toHaveAttribute('aria-checked', 'true');
  // The Directory tools are not rendered in Office view (the office has Find and Walk to).
  await expect(page.getByRole('searchbox', { name: 'Search coworkers' })).toHaveCount(0);

  // The toggle: Directory, remembered across a reload; no office left behind.
  await toggle.getByRole('radio', { name: 'Directory' }).click();
  await expect(page.locator('.cw-grid .cw-card').first()).toBeVisible();
  await expect(page.locator('.hc-office')).toHaveCount(0);
  await expect(page.locator('#hc-office-style')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.cw-grid .cw-card').first()).toBeVisible();
  await expect(page.getByTestId('floor-view').getByRole('radio', { name: 'Directory' })).toHaveAttribute('aria-checked', 'true');

  // Arrow keys move the radio group like any other.
  await page.getByTestId('floor-view').getByRole('radio', { name: 'Directory' }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.hc-o-seat')).toHaveCount(165);

  // ?view= wins and is remembered; a link to the Directory shows the Directory.
  await page.goto('/app/floor?view=directory');
  await expect(page.locator('.cw-grid .cw-card').first()).toBeVisible();
  requests.length = 0;
  await page.reload();
  await expect(page.locator('.cw-grid .cw-card').first()).toBeVisible();
  await page.waitForTimeout(1500);
  // Directory users load nothing of the office: no chunk, no art, no personalities.
  expect(requests.filter((u) => /\/src\/office\/(OfficeView|mount)|\/packages\/office\/|\/api\/office\/people|\/office\/manifest\.json/.test(u))).toEqual([]);

  await page.goto('/app/floor?view=office');
  await expect(page.locator('.hc-o-seat')).toHaveCount(165);
  // The office's first stop: "Use the Directory (list view)" switches and focuses the Directory's heading.
  const skip = page.locator('.hc-o-skip');
  await skip.focus();
  await expect(skip).toHaveText('Use the Directory (list view)');
  await page.keyboard.press('Enter');
  await expect(page.locator('.cw-grid .cw-card').first()).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Floor' })).toBeFocused();
  await page.goto('/app/floor');
  await expect(page.locator('.cw-grid .cw-card').first()).toBeVisible();
});

test('one quiet first-run hint, once', async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem('hc.office.hint.v1'));
  await openOffice(page);
  const hint = page.getByTestId('office-hint');
  await expect(hint).toHaveText(/Rest on anyone to say hi · Click to chat · H for huddles/);
  await page.mouse.click(700, 500);
  await expect(hint).toHaveCount(0);
});

test('keys at load: G walks, / finds, Home is the Chief, arrows move along a bench, Enter opens the reply field', async ({ page }) => {
  await openOffice(page, '15:10');
  await page.keyboard.press('g');
  await expect(page.locator('.hc-o-walk')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.hc-o-walk')).toBeHidden();
  await page.keyboard.press('/');
  await expect.poll(() => page.evaluate(() => document.activeElement?.classList.contains('hc-o-input') ?? false)).toBe(true);
  await page.keyboard.press('Escape');
  await page.mouse.move(5, 5);
  await page.keyboard.press('Home');
  await expect.poll(async () => (await officeState(page)).focusedId).toBe('cw_chief');
  await page.keyboard.press('ArrowDown');
  await expect.poll(async () => (await officeState(page)).focusedId).not.toBe('cw_chief');
  const first = (await officeState(page)).focusedId!;
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await officeState(page)).focusedId).not.toBe(first);
  const id = (await officeState(page)).focusedId!;
  expect(id).toMatch(/^cw_/);
  await page.keyboard.press('Enter');
  const bubble = page.locator(`.hc-o-anchor [data-testid="floor-bubble"][data-agent-id="${id}"]`);
  await expect(bubble.getByTestId('bubble-input')).toBeFocused();
});

test('passing by a desk: the face looks up with a line in a bubble anchored on it; a click chats in place and Talk is untouched', async ({ page }) => {
  await openOffice(page, '15:10');
  await recordFrames(page);
  const talkBefore = (await talkThread(page)).length;
  const who = await seatedInView(page);
  await restOn(page, who, 150);
  // The look-up comes with the dwell (600 ms), the line right after.
  await expect
    .poll(() => page.evaluate((id) => document.querySelector(`.hc-o-seat[data-pid="${id}"] [data-face-cue]`)?.getAttribute('data-face-cue') ?? null, who.id), { timeout: 3_000, intervals: [50] })
    .toBe('look_up');
  const bubble = page.locator(`.hc-o-anchor [data-testid="floor-bubble"][data-agent-id="${who.id}"]`);
  await expect(bubble).toBeVisible({ timeout: 3_000 });
  const line = (await bubble.locator('.floor-bubble-text').textContent())!.trim();
  expect(line.length).toBeGreaterThan(2);
  expect(line).not.toMatch(/[{}]/);

  // A click opens the reply field in place; the answer comes from that coworker, in the bubble.
  await page.mouse.click(who.x, who.y);
  const input = bubble.getByTestId('bubble-input');
  await expect(input).toBeFocused();
  await input.fill('What would you look at first on a pricing page?');
  await input.press('Enter');
  const answer = bubble.getByTestId('bubble-answer');
  await expect(answer).not.toHaveAttribute('data-streaming', /.*/, { timeout: 15_000 });
  await expect(answer).not.toBeEmpty();
  const owner = await waitForFrame(page, (f) => f.type === 'talk.owner' && f.live && f.data.agentId === who.id);
  expect(owner.data.surface).toBe('floor');

  // The reply guard, live. The owner's own figure may be said back (the Mock echoes it): no non-sequitur.
  await input.fill('Our reorder rate went up nine points after the relaunch. Should we lead with it?');
  await input.press('Enter');
  const own = await waitForFrame(page, (f) => f.type === 'talk.message' && f.live && f.data.agentId === who.id && /reorder/i.test(String(f.data.text)), 15_000);
  expect(String(own.data.text)).toContain('nine points');
  expect(String(own.data.text)).not.toContain(FIGURE_LINE);
  // A figure the owner never gave never reaches the app: that sentence is dropped, the rest is said.
  await input.fill('!invent What should we lead with?');
  await input.press('Enter');
  const inv = await waitForFrame(page, (f) => f.type === 'talk.owner' && f.live && f.data.agentId === who.id && String(f.data.text).includes('!invent'));
  const guarded = await waitForFrame(page, (f) => f.type === 'talk.message' && f.live && f.data.turnId === inv.data.turnId, 15_000);
  expect(String(guarded.data.text)).not.toMatch(INVENTED);
  expect(String(guarded.data.text)).toMatch(/before and after|real numbers/);
  await expect(answer).not.toContainText('12 points');

  // One conversation per place: nothing reached the Chief of Staff's Talk thread.
  expect((await talkThread(page)).length).toBe(talkBefore);
});

test("a quick chat's thinking lights that desk and sets the seat's state; the person stays put", async ({ page }) => {
  await openOffice(page, '15:10');
  const who = await seatedInView(page);
  await page.mouse.click(who.x, who.y);
  const bubble = page.locator(`[data-testid="floor-bubble"][data-agent-id="${who.id}"]`);
  const input = bubble.getByTestId('bubble-input');
  await expect(input).toBeFocused();
  await input.fill('!slow 4000 How would you start a brief like this?');
  await input.press('Enter');
  const seat = page.locator(`.hc-o-seat[data-pid="${who.id}"]`);
  await expect(seat).toHaveAttribute('data-state', 'thinking', { timeout: 5_000 });
  expect((await deskLight(page, who.id))?.mon).toBe('dim');
  await expect(seat).not.toHaveAttribute('data-walking', /.*/);
  // The thought ends: the seat is available again and the monitor goes dark.
  await expect(seat).toHaveAttribute('data-state', 'idle', { timeout: 15_000 });
  expect((await deskLight(page, who.id))?.mon ?? null).toBeNull();
});

test('the conference roundtable: invite two, ask, two answers as captions in order; a new message cancels the rest; Esc leaves one note in Talk', async ({ page }) => {
  test.setTimeout(150_000);
  await openOffice(page, '15:10');
  await recordFrames(page);
  // Walk to the Skyline room.
  await page.keyboard.press('g');
  await page.locator('.hc-o-walk .hc-o-menu__item', { hasText: 'Skyline room' }).first().click();
  await expect.poll(async () => (await officeState(page)).mode).toBe('conference');
  await expect(page.getByTestId('room-dock')).toContainText('Invite people');
  // The camera walks in first; the stage takes the keys once it is up.
  await expect(page.locator('.hc-o-stage')).toBeVisible();
  // I → the picker → two strategists. The panel opens inside the view (never off-screen below a list-high row), and
  // typing in it never scrolls the office.
  await page.keyboard.press('i');
  await expect(page.locator('.hc-o-picker')).toBeVisible();
  const panel = await page.locator('.hc-o-picker__panel').boundingBox();
  expect(panel).not.toBeNull();
  expect(panel!.y).toBeGreaterThanOrEqual(0);
  expect(panel!.y + panel!.height).toBeLessThanOrEqual(900);
  const search = await page.locator('.hc-o-picker input[type=search]').boundingBox();
  expect(search!.y).toBeGreaterThan(0);
  expect(search!.y + search!.height).toBeLessThan(900);
  await expect(page.locator('.hc-o-picker input[type=search]')).toBeFocused();
  await page.keyboard.type('strategist');
  const rows = page.locator('.hc-o-picker__row:visible input:not(:disabled)');
  await rows.nth(0).check();
  await rows.nth(1).check();
  // The primary action reads dark on amber (not the inherited light ink).
  expect(await page.locator('.hc-o-picker__foot .hc-o-btn--primary').evaluate((b) => getComputedStyle(b).color)).toBe('rgb(27, 20, 6)');
  await page.locator('.hc-o-picker__foot .hc-o-btn--primary').click();
  await expect(page.locator('.hc-o-sseat')).toHaveCount(2, { timeout: 10_000 });
  expect(await page.evaluate(() => { const o = document.querySelector('.hc-office') as HTMLElement; return [o.scrollTop, o.scrollLeft]; })).toEqual([0, 0]);
  const table = (await officeState(page)).participants;
  expect(table).toHaveLength(2);

  // Ask the room with the owner's own figure in it: both answer, in order, and may say the owner's figure back.
  const field = page.getByTestId('room-dock').locator('input').first();
  await field.fill('Our reorder rate went up nine points after the relaunch. What do you all think?');
  await field.press('Enter');
  const owner = await waitForFrame(page, (f) => f.type === 'talk.owner' && f.live && f.data.surface === 'room');
  expect(owner.data).toMatchObject({ roomId: 'skyline' });
  const turnId = owner.data.turnId;
  await waitForFrame(page, (f) => f.type === 'room.turn' && f.live && f.data.turnId === turnId && f.data.state === 'done', 30_000);
  const replies = (await frames(page)).filter((f) => f.type === 'talk.message' && f.live && f.data.turnId === turnId && f.data.surface === 'room');
  expect(replies.map((f) => f.data.agentId).sort()).toEqual([...table].sort());
  for (const r of replies) {
    expect(String(r.data.text)).not.toMatch(INVENTED);
    expect(String(r.data.text)).not.toContain(FIGURE_LINE);
  }
  // Captions follow the server's order, one speaker lit at a time.
  const order = replies.map((f) => String(f.data.agentId));
  const first = (id: string) => page.evaluate((x) => (window as unknown as { __headcount: { office: { scene: { nameOf(id: string): string } } } }).__headcount.office.scene.nameOf(x).split(' ')[0]!, id);
  const seen: string[] = [];
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline && seen.length < 2) {
    const s = await page.evaluate(() => ({
      who: document.querySelector('.hc-o-stage__cap .hc-o-cap__who')?.textContent?.trim() ?? '',
      speaking: [...document.querySelectorAll<HTMLElement>('.hc-o-sseat[data-speaking]')].map((e) => e.dataset.pid!),
      text: document.querySelector('.hc-o-stage__cap .hc-o-cap__text')?.textContent ?? '',
    }));
    if (s.who && s.speaking.length === 1 && s.who.toLowerCase() !== 'you' && seen[seen.length - 1] !== s.speaking[0]) {
      expect(s.text).not.toMatch(INVENTED);
      seen.push(s.speaking[0]!);
    }
    await page.waitForTimeout(150);
  }
  expect(seen).toEqual(order);
  expect(await first(order[0]!)).toBeTruthy();

  // A figure nobody gave never reaches the room: the Mock invents one (!invent), the guard drops that sentence.
  await field.fill('!invent What do you all think we should lead with?');
  await field.press('Enter');
  const invented = await waitForFrame(page, (f) => f.type === 'talk.owner' && f.live && f.data.surface === 'room' && f.data.turnId !== turnId);
  await waitForFrame(page, (f) => f.type === 'room.turn' && f.live && f.data.turnId === invented.data.turnId && f.data.state === 'done', 30_000);
  const inventedReplies = (await frames(page)).filter((f) => f.type === 'talk.message' && f.live && f.data.turnId === invented.data.turnId && f.data.surface === 'room');
  expect(inventedReplies.length).toBeGreaterThan(0);
  for (const r of inventedReplies) expect(String(r.data.text)).not.toMatch(INVENTED);

  // A second question while the room is still answering: the running turn is cancelled, the new one takes the floor.
  await field.fill('!slow 3000 What would you test first, everyone?');
  await field.press('Enter');
  const slow = await waitForFrame(page, (f) => f.type === 'talk.owner' && f.live && f.data.surface === 'room' && f.data.turnId !== turnId && f.data.turnId !== invented.data.turnId);
  await waitForFrame(page, (f) => f.type === 'room.turn' && f.live && f.data.turnId === slow.data.turnId && f.data.state === 'running');
  await field.fill('Keep it short, please.');
  await field.press('Enter');
  const cancelled = await waitForFrame(page, (f) => f.type === 'room.turn' && f.live && f.data.turnId === slow.data.turnId && f.data.state === 'cancelled');
  expect(cancelled.data.reason).toBe('owner');
  const last = await waitForFrame(page, (f) => f.type === 'talk.owner' && f.live && f.data.surface === 'room' && ![turnId, invented.data.turnId, slow.data.turnId].includes(f.data.turnId));
  await waitForFrame(page, (f) => f.type === 'talk.message' && f.live && f.data.turnId === last.data.turnId, 20_000);

  // Esc leaves: everyone walks back, the dock goes, and Talk gets one quiet line, never the meeting's lines.
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await officeState(page)).mode).toBe('desks');
  await page.waitForTimeout(2000);
  await expect(page.locator('.hc-o-seat[data-room]')).toHaveCount(0);
  const note = await waitForFrame(page, (f) => f.type === 'talk.message' && f.live && f.data.kind === 'note');
  expect(String(note.data.text)).toMatch(/^Skyline room with .+ · \d+ min$/);
  expect(note.data.surface).toBeUndefined();

  await page.getByRole('navigation', { name: 'Places' }).getByRole('link', { name: 'Talk' }).click();
  // One quiet line for this meeting (earlier specs may have left theirs in the shared workspace).
  await expect(page.locator('li.msg[data-kind="note"]').filter({ hasText: String(note.data.text) })).toHaveCount(1);
  await expect(page.locator('li.msg[data-kind="note"]').last()).toContainText('Skyline room with');
  const thread = await talkThread(page);
  const roomLines = /Our reorder rate went up nine points|What would you test first, everyone|Keep it short, please/;
  expect(thread.filter((m) => roomLines.test(m.text))).toEqual([]);
  // The desk side-threads hold no room lines either.
  expect(await sideThreads(page)).not.toMatch(roomLines);
  const roomFrames = (await frames(page)).filter((f: SeenFrame) => f.type.startsWith('talk.') && f.data.surface === 'room');
  expect(roomFrames.every((f) => f.data.meetingId === owner.data.meetingId)).toBe(true);
});

test('drag a badge onto the Garden room: the door plate says who is waiting', async ({ page }) => {
  await openOffice(page, '15:10');
  const garden = await page.evaluate(() => {
    const r = (window as unknown as { __headcount: { office: { scene: { getPlan(): { rooms: { id: string; rect: { x: number; y: number; w: number; h: number } }[] } } } } }).__headcount.office.scene.getPlan().rooms.find((x) => x.id === 'garden')!.rect;
    return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  });
  // Frame the room with desks beside it.
  await page.evaluate((g) => (window as unknown as { __headcount: { office: { scene: { zoomTo(z: number, at: { x: number; y: number }): void } } } }).__headcount.office.scene.zoomTo(2.2, { x: g.x, y: g.y * 0.82 - 20 }), garden);
  await page.waitForTimeout(900);
  const who = await seatedInView(page);
  const room = await screenOf(page, garden);
  await page.mouse.move(who.x, who.y);
  await page.mouse.down();
  await page.mouse.move(who.x + 20, who.y + 5, { steps: 3 });
  await page.mouse.move(room.x, room.y, { steps: 14 });
  await expect.poll(() => page.evaluate(() => (document.querySelector('.hc-office') as HTMLElement).dataset.drop ?? null)).toBe('garden');
  await page.mouse.up();
  await expect(page.locator(`.hc-o-seat[data-pid="${who.id}"]`)).toHaveAttribute('data-room', 'garden', { timeout: 5_000 });
  await expect(page.locator('.hc-o-label--room[data-id="garden"] [data-room-status]')).toHaveText(/ · waiting for you$/);
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('no transitions, and the camera jumps', async ({ page }) => {
    await openOffice(page, '15:10');
    await expect(page.locator('.hc-office')).toHaveAttribute('data-rm', '');
    const durations = await page.evaluate(() => {
      const seat = document.querySelector('.hc-o-seat')!;
      return [getComputedStyle(seat).transitionDuration, getComputedStyle(seat.querySelector('.hc-o-seat__face') ?? seat).transitionDuration];
    });
    for (const d of durations) expect(d.split(',').every((x) => parseFloat(x) === 0), d).toBe(true);
    const zoom = await page.evaluate(() => {
      const s = (window as unknown as { __headcount: { office: { scene: { zoomTo(l: string): void; getState(): { camera: { zoom: number } } } } } }).__headcount.office.scene;
      s.zoomTo('desk');
      return s.getState().camera.zoom;
    });
    expect(zoom).toBeCloseTo(5.6, 1);
    expect((await officeState(page)).lod).toBe(2);
  });
});

test.describe('phone width (375 px)', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('the Floor opens as the Directory; the Office is one toggle away with a one-row HUD and a Find icon', async ({ page }) => {
    await page.goto('/app/floor');
    await expect(page.locator('.cw-grid .cw-card').first()).toBeVisible();
    await expect(page.locator('.hc-office')).toHaveCount(0);
    await page.getByTestId('floor-view').getByRole('radio', { name: 'Office' }).click();
    await expect(page.locator('.hc-o-seat')).toHaveCount(165);
    const findBtn = page.locator('.hc-o-find__btn');
    await expect(findBtn).toBeVisible();
    const rows = await page.evaluate(() => {
      const tops = [...document.querySelectorAll<HTMLElement>('.hc-o-hud .hc-o-tools > *, .hc-o-hud .hc-o-seg')]
        .filter((e) => e.offsetParent !== null && e.getBoundingClientRect().height > 0)
        .map((e) => Math.round(e.getBoundingClientRect().top / 12));
      return new Set(tops).size;
    });
    expect(rows).toBeLessThanOrEqual(2);
    const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    expect(scroll).toBeLessThanOrEqual(client);
  });
});
