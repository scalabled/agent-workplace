import { expect, test, type Page } from '@playwright/test';
import { daytimeZone, frames, onboarded, recordFrames, setWorkspace, waitForFrame, OFFICE_SEATS, staffOffice } from './helpers';
import { deskLight, frameHuddle, openOffice, OWNER, restOn, seatedInView, skipOfficeHint } from './office-helpers';

// The office runs itself (OWNER-DIRECTIVES D3, D5; OFFICE-PHASE2 §7.4 office-life): a fixed office clock (`?at=10:35`,
// the mid-morning coffee round) so the floor is the same on every run of a day. Keyless (Mock chat): huddles talk in
// bubbles, a hover opens the huddle's card, Join greets the owner by name and becomes a group chat on the rooms
// endpoint, leaving writes one quiet line in Talk; walkers stop when clicked; Follow keeps someone in view; the pill
// counts the floor; reduced motion fades; Pause freezes; real work brings the Chief of Staff back to their desk.
test.use({ viewport: { width: 1440, height: 900 }, timezoneId: daytimeZone() });

test.beforeEach(async ({ request, page }) => {
  await staffOffice(request);
  await onboarded(request);
  await setWorkspace(request, { ambience: 'lively', ownerName: OWNER });
  await skipOfficeHint(page);
});

type Life = {
  huddles(): { id: string; members: string[]; label: string; joined: boolean }[];
  whereIs(id: string): { kind: string; state: string };
  getState(): { listening: string | null; joined: string | null; paused: boolean; walkers: number };
};
const life = <T,>(page: Page, fn: (l: Life) => T) =>
  page.evaluate(
    (src) => {
      const l = (window as unknown as { __headcount: { office: { life: Life } } }).__headcount.office.life;
      return (new Function('l', `return (${src})(l)`) as (l: Life) => unknown)(l);
    },
    fn.toString(),
  ) as Promise<T>;

/** A walker in view (well inside the office, clear of the HUD), with their face's centre. */
async function walkerInView(page: Page): Promise<{ id: string; x: number; y: number } | null> {
  return page.evaluate(() => {
    const host = document.querySelector('.hc-office')!.getBoundingClientRect();
    for (const b of document.querySelectorAll<HTMLElement>('.hc-o-seat[data-walking]:not([data-chief])')) {
      const r = (b.querySelector('.hc-o-seat__face') ?? b).getBoundingClientRect();
      const x = r.x + r.width / 2;
      const y = r.y + r.height / 2;
      if (r.width > 12 && x > host.left + 200 && x < host.right - 220 && y > host.top + 160 && y < host.bottom - 200) return { id: b.dataset.pid!, x, y };
    }
    return null;
  });
}

/** `release`: let go of a walk we started at once (they walk on their own day, never held); else they keep walking to the cooler. */
async function findWalker(page: Page, release = false): Promise<{ id: string; x: number; y: number }> {
  let w: { id: string; x: number; y: number } | null = null;
  await expect
    .poll(
      async () => {
        w = await walkerInView(page);
        // None in view: follow the camera to someone walking (a small team walks in fewer places), else look around.
        if (!w)
          await page.evaluate((release) => {
            const o = (window as unknown as { __headcount: { office: { life: unknown; scene: { zoomTo(z: number, at: { x: number; y: number }): void; placeOf(id: string): { x: number; y: number; walking: boolean } } } } }).__headcount.office;
            let walking = document.querySelector<HTMLElement>('.hc-o-seat[data-walking]:not([data-chief])');
            if (!walking) {
              // A small team rarely strolls: send one coworker to another's desk (a real visit), then follow them.
              const seated = [...document.querySelectorAll<HTMLElement>('.hc-o-seat:not([data-chief]):not([data-away]):not([data-room])')].map((b) => b.dataset.pid!);
              const life = o.life as unknown as { pin(id: string, where: { kind: 'spot'; spotId: string; slot: number }, reason: 'host'): () => void } | null;
              // A short pin starts the walk; letting go at once leaves them walking on their own day (never held).
              const un = seated.length ? life?.pin(seated[0]!, { kind: 'spot', spotId: 'cooler:cafe', slot: 2 }, 'host') : undefined;
              if (un && release) setTimeout(un, 300);
              walking = document.querySelector<HTMLElement>('.hc-o-seat[data-walking]:not([data-chief])');
            }
            const at = walking ? o.scene.placeOf(walking.dataset.pid!) : null;
            o.scene.zoomTo(2.6, at ? { x: at.x, y: at.y } : { x: 120 + Math.random() * 180, y: 60 + Math.random() * 90 });
          }, release);
        return !!w;
      },
      { timeout: 45_000, intervals: [700] },
    )
    .toBe(true);
  return w!;
}

test('the office opens on a lively place at L1: a huddle talks within seconds and the pill counts the floor honestly', async ({ page }) => {
  await openOffice(page, '10:35');
  const t0 = Date.now();
  expect((await page.evaluate(() => (window as unknown as { __headcount: { office: { scene: { getState(): { lod: number } } } } }).__headcount.office.scene.getState().lod))).toBe(1);
  await expect(page.locator('.hc-o-huddle').first()).toBeAttached();
  expect(await life(page, (l) => l.huddles().length)).toBeGreaterThan(0);
  // A small-talk bubble on screen (bubbles of people out of view stay hidden).
  await expect
    .poll(() => page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.hc-o-bubble--talk:not(.is-leaving)')].some((b) => b.style.visibility !== 'hidden')), { timeout: 5_000, intervals: [100] })
    .toBe(true);
  expect(Date.now() - t0).toBeLessThan(5_000);
  // Small talk is pre-authored and honest: no figures, no work claims, every slot filled.
  const talk = await page.locator('.hc-o-bubble--talk').allTextContents();
  for (const t of talk) {
    expect(t).not.toMatch(/[{}]/);
    expect(t).not.toMatch(/\b\d+(\.\d+)?\s?(%|percent|points)\b/i);
  }
  // Small-talk bubbles never swallow a click.
  const pe = await page.evaluate(() => {
    const b = document.querySelector('.hc-o-bubble--talk .hc-o-bubble__in');
    return b ? getComputedStyle(b).pointerEvents : 'none';
  });
  expect(pe).toBe('none');
  const pill = page.locator('.hc-o-life__pill');
  await expect(pill).toHaveText(/huddle/);
  await expect(pill).toHaveText(/on a break/);
  await expect(pill).not.toHaveText(/away/);
});

test('a huddle: hover shows its card, L listens in, Join greets the owner by name, a message gets at most two replies, Esc leaves one note in Talk', async ({ page }) => {
  test.setTimeout(120_000);
  await openOffice(page, '10:35');
  await recordFrames(page);
  const h = await frameHuddle(page);
  await page.mouse.move(h.x, h.y + 160, { steps: 3 });
  await page.mouse.move(h.x, h.y, { steps: 6 });
  const card = page.locator('.hc-o-hcard');
  await expect(card).toBeVisible({ timeout: 3_000 });
  await expect(card.getByRole('button', { name: 'Join' })).toBeVisible();
  await expect(card.getByRole('button', { name: /Listen/ })).toBeVisible();
  // L (the host's key) listens in to the open card, and again stops.
  await page.keyboard.press('l');
  await expect.poll(() => life(page, (l) => l.getState().listening)).not.toBeNull();

  await card.getByRole('button', { name: 'Join' }).click();
  const input = page.locator('.hc-o-hcard__input');
  await expect(input).toBeFocused({ timeout: 3_000 });
  // The warmest of them greets the owner by name (a catalog greeting that says it, or "Oh, hi Sam.").
  await expect.poll(() => page.locator('.hc-o-hcard__line').allTextContents().then((t) => t.join(' | ')), { timeout: 8_000 }).toContain(OWNER);
  const joined = await life(page, (l) => l.huddles().find((x) => x.joined) ?? null);
  expect(joined?.members.length).toBeGreaterThanOrEqual(2);
  expect(joined!.members.length).toBeLessThanOrEqual(4);

  await input.fill('What are you two talking about?');
  await input.press('Enter');
  const owner = await waitForFrame(page, (f) => f.type === 'talk.owner' && f.live && f.data.surface === 'room');
  expect(String(owner.data.roomId)).toMatch(/^huddle:[a-z0-9]+$/);
  await waitForFrame(page, (f) => f.type === 'room.turn' && f.live && f.data.turnId === owner.data.turnId && f.data.state !== 'running', 20_000);
  const replies = (await frames(page)).filter((f) => f.type === 'talk.message' && f.live && f.data.turnId === owner.data.turnId);
  expect(replies.length).toBeGreaterThanOrEqual(1);
  expect(replies.length).toBeLessThanOrEqual(2);
  for (const r of replies) expect(joined!.members).toContain(r.data.agentId);
  // Each reply shows over its speaker (as the voice would start) and in the card's chat.
  const first = replies[0]!;
  await expect(page.locator('.hc-o-hcard__line').filter({ hasText: String(first.data.text).slice(0, 24) })).toHaveCount(1, { timeout: 10_000 });

  // Esc leaves: the huddle lets them go, a sign-off, and Talk gets one quiet line (the owner spoke).
  await input.focus();
  await page.keyboard.press('Escape');
  await expect.poll(() => life(page, (l) => l.getState().joined)).toBeNull();
  const note = await waitForFrame(page, (f) => f.type === 'talk.message' && f.live && f.data.kind === 'note' && f.data.meetingId === owner.data.meetingId);
  expect(String(note.data.text)).toMatch(/^[A-Z].* with .+ · \d+ min$/);
  // Names keep their capitals in the note ("At Liban's desk", never "At liban's desk").
  for (const name of await Promise.all(joined!.members.map((id) => page.evaluate((x) => (window as unknown as { __headcount: { office: { scene: { nameOf(id: string): string } } } }).__headcount.office.scene.nameOf(x).split(' ')[0]!, id)))) {
    if (String(note.data.text).toLowerCase().includes(name.toLowerCase())) expect(String(note.data.text)).toContain(name);
  }
  await page.getByRole('navigation', { name: 'Places' }).getByRole('link', { name: 'Talk' }).click();
  await expect(page.locator('li.msg[data-kind="note"]').last()).toContainText(' min');
  await expect(page.locator('li.msg').filter({ hasText: 'What are you two talking about?' })).toHaveCount(0);
});

test('clicking a walker opens a chat in place and they stop; Follow keeps someone in view while they walk on', async ({ page }) => {
  test.setTimeout(120_000);
  await openOffice(page, '10:36');
  const w = await findWalker(page);
  await page.mouse.click(w.x, w.y);
  const seat = page.locator(`.hc-o-seat[data-pid="${w.id}"]`);
  await expect(seat).not.toHaveAttribute('data-walking', /.*/, { timeout: 1_500 });
  await expect(page.locator(`[data-testid="floor-bubble"][data-agent-id="${w.id}"]`).getByTestId('bubble-input')).toBeFocused();
  await page.keyboard.press('Escape');

  // F follows the focused person: they walk on (never held by the owner's focus) and the camera keeps them in view.
  await page.mouse.move(260, 860);
  const v = await findWalker(page, true);
  await page.locator(`.hc-o-seat[data-pid="${v.id}"]`).focus();
  await page.keyboard.press('f');
  await expect(page.locator('.hc-o-follow')).toBeVisible();
  await expect(page.locator('.hc-o-follow')).toContainText('Following');
  await page.waitForTimeout(6_000);
  const st = await page.evaluate((id) => {
    const o = (window as unknown as { __headcount: { office: { scene: { getState(): { followingId: string | null } }; life: Life } } }).__headcount.office;
    return { following: o.scene.getState().followingId, state: o.life.whereIs(id).state };
  }, v.id);
  expect(st.following).toBe(v.id);
  expect(st.state).not.toBe('held');
  await page.keyboard.press('Escape');
  await expect(page.locator('.hc-o-follow')).toBeHidden();

  // Follow is also one click in anyone's bubble.
  const who = await seatedInView(page);
  await restOn(page, who);
  const follow = page.locator(`[data-testid="floor-bubble"][data-agent-id="${who.id}"]`).getByTestId('bubble-follow');
  await expect(follow).toBeVisible({ timeout: 4_000 });
  await follow.click();
  await expect(page.locator('.hc-o-follow')).toContainText('Following');
  expect(await page.evaluate(() => (window as unknown as { __headcount: { office: { scene: { getState(): { followingId: string | null } } } } }).__headcount.office.scene.getState().followingId)).toBe(who.id);
});

test('real work wins: with a job running, the Chief of Staff works at their desk, monitor on', async ({ page, request }) => {
  test.setTimeout(120_000);
  const res = await request.post('/api/talk', { data: { text: 'Please draft a one-page launch plan for the candle line.', opId: `op_office_job_${Date.now()}` } });
  expect(res.status()).toBe(202);
  await expect.poll(async () => ((await (await request.get('/api/jobs')).json()) as { jobs: { status: string }[] }).jobs.some((j) => j.status === 'running'), { timeout: 20_000 }).toBe(true);
  await openOffice(page, '10:35');
  const chief = page.locator('.hc-o-seat[data-chief]');
  await expect(chief).toHaveAttribute('data-state', 'working', { timeout: 10_000 });
  await expect.poll(() => life(page, (l) => l.whereIs('cw_chief')), { timeout: 20_000 }).toMatchObject({ kind: 'desk' });
  await expect.poll(async () => (await deskLight(page, 'cw_chief'))?.mon ?? null).toBe('on');
  // They stay there while the job runs: no break, no huddle.
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(500);
    const where = await life(page, (l) => l.whereIs('cw_chief'));
    if ((await chief.getAttribute('data-state')) !== 'working') break;
    expect(where.kind).toBe('desk');
    expect(['break', 'huddle', 'walking', 'visit']).not.toContain(where.state);
  }
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('people fade between places and never walk', async ({ page }) => {
    await openOffice(page, '10:36');
    await page.evaluate(() => (window as unknown as { __headcount: { office: { scene: { zoomTo(z: number, at: { x: number; y: number }): void } } } }).__headcount.office.scene.zoomTo(2.6, { x: 200, y: 120 }));
    let walked = 0;
    for (let k = 0; k < 30; k++) {
      await page.waitForTimeout(250);
      walked = Math.max(walked, await page.locator('.hc-o-seat[data-walking]:not([data-fade])').count());
    }
    expect(walked).toBe(0);
    expect(await page.evaluate(() => (window as unknown as { __headcount: { office: { scene: { setAutopilot(v: boolean): void; getState(): { autopilot: boolean } } } } }).__headcount.office.scene.getState().autopilot)).toBe(false);
  });
});

test('Pause office life (in What’s happening): walks in progress finish, no new ones start', async ({ page }) => {
  test.setTimeout(120_000);
  await openOffice(page, '10:36');
  await page.locator('.hc-o-life__pill').click();
  const pause = page.locator('.hc-o-life__switch', { hasText: 'Pause' }).locator('input');
  await pause.check();
  await expect.poll(() => life(page, (l) => l.getState().paused)).toBe(true);
  await expect.poll(() => life(page, (l) => l.getState().walkers), { timeout: 60_000, intervals: [1000] }).toBe(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('.hc-o-life__pill')).toHaveText(/paused/i);
  await page.waitForTimeout(4_000);
  expect(await life(page, (l) => l.getState().walkers)).toBe(0);
});
