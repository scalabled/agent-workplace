import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { daytimeZone, frames, livingReady, onboarded, recordFrames, setWorkspace, waitForFrame, OFFICE_SEATS, staffOffice } from './helpers';
import { frameHuddle, officeState, openOffice, OWNER, skipOfficeHint } from './office-helpers';

// The Office with voice (project "living-voice": Mock chat, Mock TTS with timing, a fake microphone)
// §7.4 office-voice: room lines play in their speakers' voices, one after another, each speaker lit on the stage;
// holding Space barges in within 300 ms and talks to the room, not the Chief of Staff; one voice per workspace: a
// second tab never voices room lines or listen-in, and Listen voices a huddle's small talk once, on the ambient bus.
test.use({ timezoneId: daytimeZone(), viewport: { width: 1440, height: 900 } });

test.beforeEach(async ({ request }) => {
  await staffOffice(request);
  await onboarded(request, 'Rosa', true);
  await setWorkspace(request, { ambience: 'lively', ownerName: OWNER });
});

interface Heard {
  kind: 'answer' | 'clip';
  speaker: string;
  text: string;
  bus: string;
  at: number;
}

/** Runs in every page before the app: records what its audio engine is asked to play (answers and clips, with the bus). */
function installVoiceProbe(): void {
  type Chunk = { text?: string };
  type Engine = {
    speak(req: { speakerId: string; chunks: AsyncIterable<Chunk> | string }): { done: Promise<unknown> };
    playPrepared(req: { speakerId: string; bus?: string; audio: { key: string; text?: string | null } }): { started: Promise<boolean> };
    __probed?: boolean;
  };
  type Log = { utterances: { speaker: string; texts: string[]; at: number }[]; clips: { speaker: string; text: string; bus: string; at: number; started: boolean | null }[] };
  const w = window as unknown as { __voice?: Log; __headcount?: { audio?: () => Engine } };
  if (w.__voice) return;
  const log: Log = { utterances: [], clips: [] };
  w.__voice = log;
  const probe = (e: Engine) => {
    if (e.__probed) return;
    e.__probed = true;
    const speak = e.speak.bind(e);
    e.speak = (req) => {
      const u = { speaker: req.speakerId, texts: [] as string[], at: Date.now() };
      log.utterances.push(u);
      if (typeof req.chunks === 'string') {
        u.texts.push(req.chunks);
        return speak(req);
      }
      const src = req.chunks;
      return speak({
        ...req,
        chunks: (async function* () {
          for await (const c of src) {
            if (c && typeof c === 'object' && c.text) u.texts.push(c.text);
            yield c;
          }
        })(),
      });
    };
    const play = e.playPrepared.bind(e);
    e.playPrepared = (req) => {
      const h = play(req);
      const c = { speaker: req.speakerId, text: req.audio.text ?? req.audio.key, bus: req.bus ?? 'reflex', at: Date.now(), started: null as boolean | null };
      log.clips.push(c);
      void h.started.then((ok) => (c.started = ok));
      return h;
    };
  };
  setInterval(() => {
    try {
      const a = w.__headcount?.audio;
      if (typeof a === 'function') probe(a());
    } catch {
      /* not yet */
    }
  }, 20);
}

async function heard(page: Page, since = 0): Promise<Heard[]> {
  const log = await page.evaluate(() => JSON.parse(JSON.stringify((window as unknown as { __voice: unknown }).__voice)) as { utterances: { speaker: string; texts: string[]; at: number }[]; clips: { speaker: string; text: string; bus: string; at: number; started: boolean | null }[] });
  return [
    ...log.utterances.filter((u) => u.at >= since && u.texts.length).map((u): Heard => ({ kind: 'answer', speaker: u.speaker, text: u.texts.join(' '), bus: 'conversation', at: u.at })),
    ...log.clips.filter((c) => c.at >= since && c.started !== false).map((c): Heard => ({ kind: 'clip', speaker: c.speaker, text: c.text, bus: c.bus, at: c.at })),
  ].sort((a, b) => a.at - b.at);
}

async function tab(browser: Browser, baseURL: string): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ baseURL, permissions: ['microphone'], timezoneId: daytimeZone(), viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(installVoiceProbe);
  await skipOfficeHint(ctx);
  return { ctx, page: await ctx.newPage() };
}

const hasVoice = (page: Page) => page.evaluate(() => (window as unknown as { __headcount: { voice: { here(): boolean } } }).__headcount.voice.here());

/** Walk into the Skyline room and invite two strategists; returns who sits at the table. */
async function meeting(page: Page): Promise<string[]> {
  await page.keyboard.press('g');
  await page.locator('.hc-o-walk .hc-o-menu__item', { hasText: 'Skyline room' }).first().click();
  await expect(page.locator('.hc-o-stage')).toBeVisible();
  await page.keyboard.press('i');
  await expect(page.locator('.hc-o-picker')).toBeVisible();
  await page.fill('.hc-o-picker input[type=search]', 'strategist');
  const rows = page.locator('.hc-o-picker__row:visible input:not(:disabled)');
  await rows.nth(0).check();
  await rows.nth(1).check();
  await page.locator('.hc-o-picker__foot .hc-o-btn--primary').click();
  await expect(page.locator('.hc-o-sseat')).toHaveCount(2, { timeout: 10_000 });
  return (await officeState(page)).participants;
}

test('the roundtable in voices: each answer in its speaker’s voice, in order, speaker lit; holding Space stops the room within 300 ms and talks to the room', async ({ browser, baseURL }) => {
  test.setTimeout(150_000);
  const { ctx, page } = await tab(browser, baseURL!);
  await openOffice(page, '15:10');
  await livingReady(page);
  await recordFrames(page);
  const table = await meeting(page);
  const field = page.getByTestId('room-dock').locator('input').first();
  await field.click(); // a real gesture: this tab has the voice, and audio is armed
  await expect.poll(() => hasVoice(page)).toBe(true);
  const since = Date.now();
  await field.fill('What do you all think about a starter bundle?');
  await field.press('Enter');
  const owner = await waitForFrame(page, (f) => f.type === 'talk.owner' && f.live && f.data.surface === 'room');
  await waitForFrame(page, (f) => f.type === 'room.turn' && f.live && f.data.turnId === owner.data.turnId && f.data.state === 'done', 30_000);
  const order = (await frames(page)).filter((f) => f.type === 'talk.message' && f.live && f.data.turnId === owner.data.turnId).map((f) => String(f.data.agentId));
  expect([...order].sort()).toEqual([...table].sort());

  // Voiced in server order, one at a time, each speaker lit while they speak; no NOT VOICED tag (keyed voice).
  const lit: string[] = [];
  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline && lit.length < 2) {
    const s = await page.evaluate(() => ({
      speaking: [...document.querySelectorAll<HTMLElement>('.hc-o-sseat[data-speaking]')].map((e) => e.dataset.pid!),
      tag: !!document.querySelector('.hc-o-stage__cap .hc-o-cap__tag:not([hidden])'),
    }));
    expect(s.speaking.length).toBeLessThanOrEqual(1);
    if (s.speaking.length === 1 && lit[lit.length - 1] !== s.speaking[0]) {
      expect(s.tag, 'a voiced line has no NOT VOICED tag').toBe(false);
      lit.push(s.speaking[0]!);
    }
    await page.waitForTimeout(100);
  }
  expect(lit).toEqual(order);
  // Only the people at the table: an announcement of earlier work may also be voiced in this window.
  const voiced = (await heard(page, since)).filter((h) => h.kind === 'answer' && table.includes(h.speaker));
  expect(voiced.map((h) => h.speaker)).toEqual(order);

  // A second question with a slow room: while the first answer sounds, hold Space (focus outside the field).
  await field.fill('!slow 500 And what would you test first, everyone?');
  await field.press('Enter');
  const second = await waitForFrame(page, (f) => f.type === 'talk.owner' && f.live && f.data.surface === 'room' && f.data.turnId !== owner.data.turnId);
  await page.waitForFunction((ids) => (window as unknown as { __headcount: { audio(): { speaking(): string[] } } }).__headcount.audio().speaking().some((id) => ids.includes(id)), table, { timeout: 20_000 });
  await page.route('**/api/speech/stt', (route) => route.fulfill({ json: { text: 'Hold on, one question for the room.', provider: 'mock', language: 'en' } }));
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  // Measure in the page: from the Space keydown to the room's audio stopping.
  await page.evaluate((ids) => {
    const w = window as unknown as { __bargeMs?: number; __headcount: { audio(): { speaking(): string[] } } };
    delete w.__bargeMs;
    addEventListener(
      'keydown',
      (e) => {
        if (e.key !== ' ') return;
        const t0 = performance.now();
        const tick = () => {
          if (!w.__headcount.audio().speaking().some((id) => ids.includes(id))) w.__bargeMs = performance.now() - t0;
          else if (performance.now() - t0 < 3000) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      },
      { capture: true, once: true },
    );
  }, table);
  await page.keyboard.down('Space');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __bargeMs?: number }).__bargeMs ?? null), { timeout: 3_000 }).not.toBeNull();
  const bargeMs = await page.evaluate(() => (window as unknown as { __bargeMs: number }).__bargeMs);
  test.info().annotations.push({ type: 'barge-in', description: `room audio stopped ${Math.round(bargeMs)} ms after the Space press` });
  console.log(`barge-in: room audio stopped ${Math.round(bargeMs)} ms after the Space press`);
  expect(bargeMs, 'the room goes quiet within 300 ms of the press').toBeLessThanOrEqual(300);
  await page.waitForTimeout(1200);
  await page.keyboard.up('Space');
  // The words go to the room (via voice), never to the Chief of Staff's Talk.
  const spoken = await waitForFrame(page, (f) => f.type === 'talk.owner' && f.live && f.data.text === 'Hold on, one question for the room.', 20_000);
  expect(spoken.data).toMatchObject({ surface: 'room', roomId: 'skyline', via: 'voice' });
  expect((await frames(page)).filter((f) => f.type === 'talk.owner' && f.live && f.data.surface !== 'room' && f.data.surface !== 'floor')).toEqual([]);
  // The interrupted turn was cancelled for the owner.
  const cancelled = (await frames(page)).find((f) => f.type === 'room.turn' && f.live && f.data.turnId === second.data.turnId && f.data.state === 'cancelled');
  expect(cancelled?.data.reason).toBe('owner');
  await page.keyboard.press('Escape');
  await ctx.close();
});

test('one voice per workspace: a second tab never voices room lines or listen-in; Listen voices small talk once, on the ambient bus', async ({ browser, baseURL }) => {
  test.setTimeout(150_000);
  const a = await tab(browser, baseURL!);
  const b = await tab(browser, baseURL!);
  await openOffice(a.page, '10:35');
  await livingReady(a.page);
  await openOffice(b.page, '10:35');
  await livingReady(b.page);
  // A click in A (a real gesture on a page with focus) takes the voice; B only opened.
  await a.page.bringToFront();
  await a.page.mouse.click(700, 160);
  await expect.poll(() => hasVoice(a.page)).toBe(true);
  await expect.poll(() => hasVoice(b.page)).toBe(false);
  await expect(b.page.getByTestId('voice-elsewhere')).toBeVisible();

  // Listen in A: the huddle's lines play in their speakers' voices, once each, on the ambient bus.
  const since = Date.now();
  const h = await frameHuddle(a.page);
  await a.page.mouse.move(h.x, h.y + 160, { steps: 3 });
  await a.page.mouse.move(h.x, h.y, { steps: 6 });
  await expect(a.page.locator('.hc-o-hcard')).toBeVisible({ timeout: 3_000 });
  await a.page.locator('.hc-o-hcard').getByRole('button', { name: /Listen/ }).click();
  await expect
    .poll(async () => (await heard(a.page, since)).filter((x) => x.kind === 'clip' && x.bus === 'ambient').length, { timeout: 30_000 })
    .toBeGreaterThan(0);
  const small = (await heard(a.page, since)).filter((x) => x.kind === 'clip' && x.bus === 'ambient');
  for (const x of small) expect(h.members).toContain(x.speaker);
  const keys = small.map((x) => `${x.speaker}|${x.text}`);
  expect(new Set(keys).size, 'each small-talk line voiced once').toBe(keys.length);

  // B listens to a huddle too: it shows the lines but plays nothing (the voice is A's).
  const hb = await frameHuddle(b.page);
  await b.page.evaluate((id) => (window as unknown as { __headcount: { office: { life: { listenIn(id: string | null): void } } } }).__headcount.office.life.listenIn(id), hb.id);
  await b.page.waitForTimeout(6_000);
  expect((await heard(b.page, since)).filter((x) => x.kind === 'clip' || x.kind === 'answer'), 'the tab without the voice plays nothing').toEqual([]);

  // A meeting in A: A voices its lines; B receives every frame and voices none of them.
  await a.page.evaluate(() => (window as unknown as { __headcount: { office: { life: { listenIn(id: string | null): void } } } }).__headcount.office.life.listenIn(null));
  await recordFrames(a.page);
  const table = await meeting(a.page);
  const field = a.page.getByTestId('room-dock').locator('input').first();
  await field.click();
  const t1 = Date.now();
  await field.fill('What do you all think about a starter bundle?');
  await field.press('Enter');
  const owner = await waitForFrame(a.page, (f) => f.type === 'talk.owner' && f.live && f.data.surface === 'room');
  await waitForFrame(a.page, (f) => f.type === 'room.turn' && f.live && f.data.turnId === owner.data.turnId && f.data.state === 'done', 30_000);
  await expect.poll(async () => (await heard(a.page, t1)).filter((x) => x.kind === 'answer' && table.includes(x.speaker)).length, { timeout: 40_000 }).toBe(2);
  await b.page.waitForTimeout(2_000);
  expect((await heard(b.page, t1)).filter((x) => table.includes(x.speaker)), 'B voices no room line').toEqual([]);
  await a.page.keyboard.press('Escape');
  await a.ctx.close();
  await b.ctx.close();
});
