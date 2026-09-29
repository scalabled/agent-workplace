import { expect, test, type Browser, type BrowserContext, type Page, type WebSocketRoute } from '@playwright/test';
import { daytimeZone, frames, livingLog, livingReady, onboarded, pinDirectory, recordFrames, say, setWorkspace, waitForFrame } from './helpers';

// One voice per workspace (owner report: "I am hearing duplicate responses spoken out loud"). Every open /app tab gets
// every frame, but only the voice owner voices answers, reflexes and clips: the tab of the most recent interaction.
// Project "living-voice" (Mock chat, Mock TTS clips with timing, a fake microphone). Each page counts what its audio
// engine actually played (answers chunk by chunk, clips that started), so a line voiced twice, in one tab or across
// two, fails the test.
test.use({ timezoneId: daytimeZone() });

test.beforeEach(async ({ request, page }) => {
  await onboarded(request, 'Rosa', true);
  await setWorkspace(request, { ambience: 'lively' });
  // The Floor paths below use Directory cards (the Office's one-voice checks: e2e/office-voice.spec.ts).
  await pinDirectory(page);
});

// On failure, attach what the page's living layer did and what its engine played.
test.afterEach(async ({ page }, info) => {
  if (info.status === info.expectedStatus) return;
  try {
    const log = await livingLog(page);
    const tel = log.telemetry.map((t) => `${t.at} ${t.kind} ${t.agentId} ${t.intent} ${t.reason ?? ''} ${t.lineId ?? ''}`);
    const f = (await frames(page)).filter((x) => x.live).map((x) => `${x.at} ${x.type} ${String(x.data.intent ?? x.data.kind ?? x.data.route ?? x.data.clientId ?? '')}`);
    const voice = (await heard(page)).map((l) => `${l.at} ${l.kind} ${l.speaker} ${l.text}`);
    await info.attach('one-voice.txt', { body: [...tel, '--', ...f, '--', ...voice].join('\n'), contentType: 'text/plain' });
  } catch {
    /* the page is gone */
  }
});

/** Send a message in the composer and wait for that turn's end (its own talk.done). Returns the turn id. */
async function turn(page: Page, text: string, timeout = 20_000): Promise<string> {
  const since = Date.now();
  await say(page, text);
  const owner = await waitForFrame(page, (f) => f.type === 'talk.owner' && f.live && f.data.text === text.trim() && f.at >= since - 50, timeout);
  const turnId = String(owner.data.turnId);
  await waitForFrame(page, (f) => f.type === 'talk.done' && f.live && f.data.turnId === turnId, timeout);
  return turnId;
}

interface Heard {
  kind: 'answer' | 'clip';
  speaker: string;
  text: string;
  at: number;
}

/** Runs in every page before the app: counts what each audio engine plays (every engine, reloads included). */
function installVoiceProbe(): void {
  type Chunk = { text?: string };
  type Engine = {
    speak(req: { speakerId: string; chunks: AsyncIterable<Chunk> | string }): { done: Promise<unknown> };
    playPrepared(req: { speakerId: string; audio: { key: string; text?: string | null } }): { started: Promise<boolean> };
    speakReflexText(req: { speakerId: string; text: string }): { started: Promise<boolean> } | null;
    __probed?: boolean;
  };
  type Log = { utterances: { speaker: string; texts: string[]; at: number }[]; clips: { speaker: string; text: string; at: number; started: boolean | null }[]; engines: number };
  const w = window as unknown as { __voice?: Log; __headcount?: { audio?: () => Engine } };
  if (w.__voice) return;
  const log: Log = { utterances: [], clips: [], engines: 0 };
  w.__voice = log;
  const probe = (e: Engine) => {
    if (e.__probed) return;
    e.__probed = true;
    log.engines++;
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
      const c = { speaker: req.speakerId, text: req.audio.text ?? req.audio.key, at: Date.now(), started: null as boolean | null };
      log.clips.push(c);
      void h.started.then((ok) => (c.started = ok));
      return h;
    };
    const text = e.speakReflexText.bind(e);
    e.speakReflexText = (req) => {
      const h = text(req);
      const c = { speaker: req.speakerId, text: req.text, at: Date.now(), started: null as boolean | null };
      log.clips.push(c);
      void h?.started.then((ok) => (c.started = ok));
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

/** What a page has voiced since `since` (epoch ms): answers that reached the engine, clips that started. */
async function heard(page: Page, since = 0): Promise<Heard[]> {
  const log = await page.evaluate(() => JSON.parse(JSON.stringify((window as unknown as { __voice: unknown }).__voice)) as { utterances: { speaker: string; texts: string[]; at: number }[]; clips: { speaker: string; text: string; at: number; started: boolean | null }[] });
  return [
    ...log.utterances.filter((u) => u.at >= since && u.texts.length).map((u): Heard => ({ kind: 'answer', speaker: u.speaker, text: u.texts.join(' '), at: u.at })),
    ...log.clips.filter((c) => c.at >= since && c.started !== false).map((c): Heard => ({ kind: 'clip', speaker: c.speaker, text: c.text, at: c.at })),
  ].sort((a, b) => a.at - b.at);
}

/** No line voiced twice (in one tab or across tabs): the same speaker and words started twice. */
function expectOnce(lines: Heard[], label: string): void {
  const seen = new Map<string, Heard>();
  const twice: string[] = [];
  for (const l of lines) {
    const key = `${l.speaker}|${l.text.trim()}`;
    if (seen.has(key)) twice.push(`${l.kind} "${l.text}" (${l.at - seen.get(key)!.at} ms apart)`);
    else seen.set(key, l);
  }
  expect(twice, `${label}: voiced twice`).toEqual([]);
}

/** A tab on its own browser context (another window or device: no BroadcastChannel with the first). */
async function tab(browser: Browser, baseURL: string, ctx?: BrowserContext): Promise<{ ctx: BrowserContext; page: Page }> {
  const c = ctx ?? (await browser.newContext({ baseURL, permissions: ['microphone'], timezoneId: daytimeZone(), viewport: { width: 1280, height: 800 } }));
  await c.addInitScript(installVoiceProbe);
  const page = await c.newPage();
  return { ctx: c, page };
}

/** Talk with the Chief's P0 decoded and the frame recorder on. `claim`: a click in the composer (a real gesture). */
async function openTalk(page: Page, claim = true): Promise<void> {
  await page.goto('/app/talk');
  await livingReady(page);
  await recordFrames(page);
  await page.waitForFunction(() => (window as unknown as { __headcount: { living: { clipsDecoded(): number } } }).__headcount.living.clipsDecoded() >= 20, null, { timeout: 30_000 });
  if (claim) await page.locator('#composer').click();
}

const hasVoice = (page: Page) => page.evaluate(() => (window as unknown as { __headcount: { voice: { here(): boolean } } }).__headcount.voice.here());
const clientIdOf = (page: Page) => page.evaluate(() => (window as unknown as { __headcount: { voice: { clientId(): string } } }).__headcount.voice.clientId());

async function transcribeAs(page: Page, text: string): Promise<void> {
  await page.unroute('**/api/speech/stt');
  await page.route('**/api/speech/stt', (route) => route.fulfill({ json: { text, provider: 'mock', language: 'en' } }));
}

async function holdToTalk(page: Page, ms: number): Promise<number> {
  const mic = page.getByRole('button', { name: /^Talk: hold/ });
  const box = (await mic.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
  return Date.now();
}

/** Wait until the Chief's audio in a page is quiet (answers and reflexes done). */
async function quiet(page: Page, ms = 15_000): Promise<void> {
  await page.waitForFunction(
    () => {
      const e = (window as unknown as { __headcount: { audio(): { speaking(): string[]; activity(id: string): { conversation: boolean; reflex: boolean } } } }).__headcount.audio();
      const a = e.activity('cw_chief');
      return !e.speaking().length && !a.conversation && !a.reflex;
    },
    null,
    { timeout: ms },
  );
}

test('two tabs on one workspace: only the tab with the voice speaks; interacting in the other takes it', async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const a = await tab(browser, baseURL!);
  const b = await tab(browser, baseURL!);
  try {
    await openTalk(b.page);
    await openTalk(a.page); // the last gesture wins: A has the voice
    await expect.poll(() => hasVoice(a.page)).toBe(true);
    await expect.poll(() => hasVoice(b.page)).toBe(false);
    await expect(b.page.getByTestId('voice-elsewhere')).toBeVisible();
    await expect(a.page.getByTestId('voice-elsewhere')).toHaveCount(0);

    // A reflex reply and an answer: voiced in A, once; B keeps the text.
    const t0 = Date.now();
    await turn(a.page, 'hi');
    await turn(a.page, '!slow 800 What should we focus on this week?');
    await quiet(a.page);
    const heardA = await heard(a.page, t0);
    expect(heardA.filter((l) => l.kind === 'clip').length, 'the "hi" reply').toBeGreaterThanOrEqual(1);
    expect(heardA.filter((l) => l.kind === 'answer').map((l) => l.text).join(' ')).toContain('What should we focus on this week?');
    expect(await heard(b.page, t0), 'the tab without the voice stays silent').toEqual([]);
    await expect(b.page.locator('.thread li.msg').last()).toContainText('What should we focus on this week?');
    expectOnce([...heardA, ...(await heard(b.page, t0))], 'A has the voice');

    // "Play here" in B takes the voice: A goes quiet, B speaks the next answer, A shows the chip. (Pressing it is the
    // gesture that takes the voice, so the chip is gone before the click completes: press it like a person does.)
    const chip = (await b.page.getByTestId('voice-elsewhere').boundingBox())!;
    await b.page.mouse.click(chip.x + chip.width / 2, chip.y + chip.height / 2);
    await expect(b.page.getByTestId('voice-elsewhere')).toHaveCount(0);
    await expect.poll(() => hasVoice(b.page)).toBe(true);
    await expect.poll(() => hasVoice(a.page)).toBe(false);
    await expect(a.page.getByTestId('voice-elsewhere')).toBeVisible();
    const t1 = Date.now();
    await turn(b.page, '!slow 500 And what can wait until next week?');
    await expect.poll(async () => (await heard(b.page, t1)).length, { timeout: 5_000 }).toBeGreaterThan(0);
    await quiet(b.page);
    expect((await heard(b.page, t1)).map((l) => l.text).join(' ')).toContain('what can wait until next week');
    expect(await heard(a.page, t1)).toEqual([]);

    // Any real gesture in A takes it back (a click anywhere, not only the chip).
    await a.page.locator('.talk-id h1').click();
    await expect.poll(() => hasVoice(a.page)).toBe(true);
    await expect.poll(() => hasVoice(b.page)).toBe(false);
  } finally {
    await a.ctx.close();
    await b.ctx.close();
  }
});

test('closing the tab with the voice hands proactive speech to the other: the job-done announcement is voiced there, once', async ({ browser, baseURL }) => {
  test.setTimeout(150_000);
  const a = await tab(browser, baseURL!);
  const b = await tab(browser, baseURL!);
  try {
    await openTalk(b.page);
    await openTalk(a.page);
    await say(a.page, 'Look into three packaging suppliers for me');
    const started = await waitForFrame(a.page, (f) => f.type === 'job.started' && f.live, 20_000);
    const jobId = (started.data.job as { jobId: string }).jobId;
    const bId = await clientIdOf(b.page);
    await a.ctx.close();
    // After the reload grace, the server gives the voice to the remaining tab.
    await waitForFrame(b.page, (f) => f.type === 'voice.owner' && f.data.clientId === bId && f.data.reason === 'fallback', 15_000);
    expect(await hasVoice(b.page)).toBe(true);
    await expect(b.page.getByTestId('voice-elsewhere')).toHaveCount(0);
    const since = Date.now();
    await waitForFrame(b.page, (f) => f.type === 'job.done' && f.live && f.data.jobId === jobId, 90_000);
    await waitForFrame(b.page, (f) => f.type === 'talk.message' && f.live && f.data.kind === 'announcement' && f.data.jobId === jobId, 15_000);
    await quiet(b.page);
    const lines = await heard(b.page, since);
    expect(lines.filter((l) => l.kind === 'answer' && /” is done\./.test(l.text)), 'the announcement, once').toHaveLength(1);
    expectOnce(lines, 'after the hand-off');
  } finally {
    await b.ctx.close().catch(() => undefined);
    await a.ctx.close().catch(() => undefined);
  }
});

test('an announcement that lands while the closed tab still holds the voice is voiced once by the tab that takes over', async ({ browser, baseURL }) => {
  test.setTimeout(150_000);
  const a = await tab(browser, baseURL!);
  const b = await tab(browser, baseURL!);
  try {
    await openTalk(b.page);
    await openTalk(a.page);
    await say(a.page, 'Look into three packaging suppliers for me');
    const started = await waitForFrame(a.page, (f) => f.type === 'job.started' && f.live, 20_000);
    const jobId = (started.data.job as { jobId: string }).jobId;
    const bId = await clientIdOf(b.page);
    // The write-up starts about 2.5 s before the job is done: closing the owner's tab now puts the announcement inside
    // the 5 s grace, when the voice is still with the closed tab and no open tab voices it.
    await waitForFrame(b.page, (f) => f.type === 'job.progress' && f.live && f.data.jobId === jobId && f.data.label === 'Writing up the findings', 90_000);
    const since = Date.now();
    await a.ctx.close();
    const note = await waitForFrame(b.page, (f) => f.type === 'talk.message' && f.live && f.data.kind === 'announcement' && f.data.jobId === jobId, 30_000);
    const fallback = await waitForFrame(b.page, (f) => f.type === 'voice.owner' && f.data.clientId === bId && f.data.reason === 'fallback', 15_000);
    expect(note.at, 'the announcement landed during the grace').toBeLessThan(fallback.at);
    expect(Number(fallback.data.unvoicedAfter), 'the fallback says where the unvoiced lines begin').toBeLessThan(note.seq!);
    await expect.poll(async () => (await heard(b.page, since)).filter((l) => l.kind === 'answer').length, { timeout: 10_000 }).toBeGreaterThan(0);
    await quiet(b.page);
    const lines = await heard(b.page, since);
    expect(lines.filter((l) => l.kind === 'answer' && /” is done\./.test(l.text)), 'the announcement, once, after the grace').toHaveLength(1);
    expectOnce(lines, 'after the hand-off');
  } finally {
    await b.ctx.close().catch(() => undefined);
    await a.ctx.close().catch(() => undefined);
  }
});

test('tabs of one browser hand over at once: the old tab stops mid-answer and nothing is said twice', async ({ browser, baseURL }) => {
  test.setTimeout(90_000);
  const a = await tab(browser, baseURL!);
  const b = await tab(browser, baseURL!, a.ctx); // the same browser context: BroadcastChannel between them
  try {
    await openTalk(b.page);
    await openTalk(a.page);
    expect(await clientIdOf(a.page)).not.toBe(await clientIdOf(b.page));
    const t0 = Date.now();
    await say(a.page, 'Tell me about the plan for the candle launch in a few sentences, with some detail please.');
    await a.page.waitForFunction((t) => (window as unknown as { __voice: { utterances: { at: number; texts: string[] }[] } }).__voice.utterances.some((u) => u.at >= t && u.texts.length > 0), t0, { timeout: 20_000 });
    // B takes the voice while A is still speaking: A stops at once (the channel), before the server answers.
    const clickAt = Date.now();
    await b.page.locator('.talk-id h1').click();
    await a.page.waitForFunction(() => !(window as unknown as { __headcount: { audio(): { activity(id: string): { conversation: boolean } } } }).__headcount.audio().activity('cw_chief').conversation, null, { timeout: 2_000 });
    expect(Date.now() - clickAt, 'A went quiet within a moment').toBeLessThan(1500);
    await expect.poll(() => hasVoice(b.page)).toBe(true);
    await a.page.waitForTimeout(2500);
    // B never picks the interrupted answer up in the middle; nothing was voiced twice across the two tabs.
    expect((await heard(b.page, t0)).filter((l) => l.kind === 'answer')).toEqual([]);
    expectOnce([...(await heard(a.page, t0)), ...(await heard(b.page, t0))], 'hand-off');
  } finally {
    await a.ctx.close();
  }
});

test('one tab: every voice path plays each line exactly once, and a reload never says anything again', async ({ page }) => {
  test.setTimeout(180_000);
  await page.context().addInitScript(installVoiceProbe);
  await openTalk(page);
  await page.evaluate(() => (window as unknown as { __headcount: { living: { setQuietHours(v: boolean | null): void } } }).__headcount.living.setQuietHours(false));
  const played = async (intent: string, since: number) => (await livingLog(page)).telemetry.filter((t) => t.kind === 'played' && t.intent === intent && t.at >= since && t.reason !== 'bubble');
  const t0 = Date.now();

  // Phatic reflex replies (hi, thanks): one clip each, no answer speech.
  await say(page, 'hi');
  await expect.poll(async () => (await played('greeting', t0)).length, { timeout: 5_000 }).toBe(1);
  await quiet(page);
  const t1 = Date.now();
  await say(page, 'thanks!');
  await expect.poll(async () => (await played('gratitude_reply', t1)).length, { timeout: 5_000 }).toBe(1);
  await quiet(page);

  // A question by voice: a filler, then the answer, each once.
  await transcribeAs(page, '!slow 3000 What should we focus on this week?');
  const t2 = await holdToTalk(page, 1200);
  const q = await waitForFrame(page, (f) => f.type === 'talk.owner' && f.live && f.data.via === 'voice' && f.at >= t2 - 2000);
  await waitForFrame(page, (f) => f.type === 'talk.done' && f.live && f.data.turnId === q.data.turnId, 20_000);
  await quiet(page);
  expect((await played('thinking_filler', t2)).length, 'one filler').toBeLessThanOrEqual(1);
  expect((await heard(page, t2)).filter((l) => l.kind === 'answer'), 'one answer').toHaveLength(1);

  // A joke by voice: a laugh (or a smile), never twice.
  await transcribeAs(page, "!slow 2000 Haha, the printer's haunted again");
  const t3 = await holdToTalk(page, 1200);
  const joke = await waitForFrame(page, (f) => f.type === 'talk.owner' && f.live && f.data.via === 'voice' && f.at >= t3 - 2000);
  await waitForFrame(page, (f) => f.type === 'talk.done' && f.live && f.data.turnId === joke.data.turnId, 20_000);
  await quiet(page);
  expect((await played('laugh', t3)).length).toBeLessThanOrEqual(1);

  // A delegation by voice (acknowledged), a steer from the Activity row (acknowledged), then the job's life at Talk.
  await transcribeAs(page, 'Look into three packaging suppliers for me');
  const t4 = await holdToTalk(page, 1200);
  const started = await waitForFrame(page, (f) => f.type === 'job.started' && f.live, 20_000);
  const jobId = (started.data.job as { jobId: string }).jobId;
  await expect.poll(async () => (await played('acknowledge', t4)).length, { timeout: 5_000 }).toBe(1);
  await quiet(page);
  const t5 = Date.now();
  const steer = await page.evaluate(async (id) => {
    const clientId = (window as unknown as { __headcount: { voice: { clientId(): string } } }).__headcount.voice.clientId();
    return (await fetch(`/api/jobs/${id}/steer`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Also check eco-friendly options', opId: `op_steer_${Date.now()}`, clientId }) })).status;
  }, jobId);
  expect(steer).toBe(202);
  await waitForFrame(page, (f) => f.type === 'job.steered' && f.live && f.at >= t5, 10_000);
  await waitForFrame(page, (f) => f.type === 'job.done' && f.live && f.data.jobId === jobId, 90_000);
  await waitForFrame(page, (f) => f.type === 'talk.message' && f.live && f.data.kind === 'announcement' && f.data.jobId === jobId, 15_000);
  await quiet(page);
  expect((await played('acknowledge', t5)).length, 'the steer acknowledged at most once').toBeLessThanOrEqual(1);
  expect((await played('celebrate', t4)).length, 'the celebration once').toBeLessThanOrEqual(1);
  expect((await played('micro_status', t4)).length, 'at most one progress line').toBeLessThanOrEqual(1);
  expect((await heard(page, t4)).filter((l) => l.kind === 'answer' && /” is done\./.test(l.text)), 'the announcement once').toHaveLength(1);

  // A failed job (its frames, as the feed delivers them live): a wince and the announcement, voiced once.
  const t6 = Date.now();
  await page.evaluate(() => {
    const hc = (window as unknown as { __headcount: { store: { lastSeq: { value: number } }; applyFrame(f: unknown): void } }).__headcount;
    const seq = hc.store.lastSeq.value;
    const ts = new Date().toISOString();
    hc.applyFrame({ v: 1, streamId: 'ws:local', seq: seq + 1, ts, type: 'job.failed', data: { jobId: 'job_e2e_fail', code: 'provider_error', message: 'The model kept failing.', retryable: true } });
    hc.applyFrame({ v: 1, streamId: 'ws:local', seq: seq + 2, ts, type: 'talk.message', data: { turnId: null, messageId: 'msg_e2e_fail', agentId: 'cw_chief', text: 'I could not finish the e2e job. The model kept failing.', kind: 'announcement', jobId: 'job_e2e_fail' } });
  });
  await expect.poll(async () => (await heard(page, t6)).filter((l) => l.kind === 'answer').length, { timeout: 10_000 }).toBe(1);
  await quiet(page);

  expectOnce(await heard(page, t0), 'one tab, every Talk path');

  // Talk → Floor → Talk: the stage closes and opens again; a new "hi" is still voiced once.
  await page.getByRole('navigation', { name: 'Places' }).getByRole('link', { name: 'Floor' }).click();
  await page.getByRole('navigation', { name: 'Places' }).getByRole('link', { name: 'Talk' }).click();
  const t7 = Date.now();
  await say(page, 'hello again');
  await expect.poll(async () => (await played('greeting', t7)).length, { timeout: 5_000 }).toBe(1);
  await quiet(page);
  expect((await heard(page, t7)).length).toBe(1);

  // A reload mid-answer: what was said before is never said again (the replay is history, not news).
  const t8 = Date.now();
  await say(page, '!slow 800 Tell me about the plan for the candle launch in a few sentences, with some detail please.');
  await page.waitForFunction((t) => (window as unknown as { __voice: { utterances: { at: number; texts: string[] }[] } }).__voice.utterances.some((u) => u.at >= t && u.texts.length > 0), t8, { timeout: 20_000 });
  const before = (await heard(page, t8)).map((l) => l.text);
  await page.reload();
  await livingReady(page);
  await recordFrames(page);
  expect(await hasVoice(page), 'the reloaded tab keeps the voice without a gesture').toBe(true);
  await page.waitForTimeout(5000);
  const after = await heard(page);
  for (const line of before) expect(after.some((l) => l.text.includes(line.slice(0, 40))), `"${line}" said again after the reload`).toBe(false);
  // The replay carried the whole history: none of it was live.
  expect((await frames(page)).filter((f) => f.live && f.type === 'talk.owner'), 'no owner message replayed as live').toEqual([]);

  // The Floor: a passing-by line and a side-thread reply, each voiced once.
  await page.getByRole('navigation', { name: 'Places' }).getByRole('link', { name: 'Floor' }).click();
  const t9 = Date.now();
  const slot = page.locator('.cw-grid .cw-slot').nth(3);
  await slot.scrollIntoViewIfNeeded();
  const box = (await slot.locator('.cw-card').boundingBox())!;
  await page.mouse.move(box.x + 24, box.y + 24);
  await page.mouse.move(box.x + 26, box.y + 25);
  const agentId = (await slot.getAttribute('data-agent-id'))!;
  const bubble = page.locator(`[data-testid="floor-bubble"][data-agent-id="${agentId}"]`);
  await expect(bubble).toBeVisible({ timeout: 3_000 });
  await page.keyboard.press('r');
  const input = bubble.getByTestId('bubble-input');
  await input.fill('What do you do here, in two sentences?');
  await input.press('Enter');
  await waitForFrame(page, (f) => f.type === 'talk.done' && f.live && f.data.agentId === agentId, 20_000);
  await page.waitForTimeout(3000);
  const floor = await heard(page, t9);
  expect(floor.filter((l) => l.kind === 'answer' && l.speaker === agentId), 'the side-thread reply once').toHaveLength(1);
  expectOnce(floor, 'the Floor');
});

test('a socket that drops mid-answer and comes back after the answer finished: the rest is never said, the job-done announcement is', async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const { ctx, page } = await tab(browser, baseURL!);
  // Every feed socket goes through here. Armed, the socket goes half-open once the answer's first sentence has streamed
  // in (the page hears nothing more) and is dropped after the server finished that answer: the app reconnects and the
  // answer's message and end come back as history (applied `live: false`).
  const feed = { cut: false, holding: false, finished: false };
  const sockets: { page: WebSocketRoute; server: WebSocketRoute }[] = [];
  await page.routeWebSocket(/\/api\/ws/, (ws) => {
    const server = ws.connectToServer();
    sockets.push({ page: ws, server });
    let text = '';
    server.onMessage((m) => {
      const f = typeof m === 'string' ? (JSON.parse(m) as { type?: string; data?: { agentId?: string; delta?: string } }) : null;
      if (feed.holding) {
        if (f?.type === 'talk.done') feed.finished = true;
        return;
      }
      ws.send(m);
      if (feed.cut && f?.type === 'talk.delta' && f.data?.agentId === 'cw_chief') {
        text += f.data.delta ?? '';
        if (/[.!?]["'”’)\]]*\s/.test(text)) feed.holding = true;
      }
    });
  });
  try {
    await openTalk(page);
    // A job runs meanwhile (about 15 s): its announcement is the next thing the Chief says after the drop. (A typed
    // message would not show it: sending while the Chief speaks stops the reply at its sentence first.)
    await turn(page, 'Look into three packaging suppliers for me');
    const started = await waitForFrame(page, (f) => f.type === 'job.started' && f.live, 20_000);
    const jobId = (started.data.job as { jobId: string }).jobId;
    await quiet(page);

    const t0 = Date.now();
    feed.cut = true;
    await say(page, '!slow 500 What is a good name for a candle brand?');
    const owner = await waitForFrame(page, (f) => f.type === 'talk.owner' && f.live && f.at >= t0 - 50, 20_000);
    await expect.poll(() => feed.finished, { timeout: 20_000 }).toBe(true);
    const cutAt = Date.now();
    const cut = sockets.at(-1)!;
    await cut.page.close();
    await cut.server.close();
    feed.cut = false;
    feed.holding = false;
    const done = await waitForFrame(page, (f) => f.type === 'talk.done' && f.data.turnId === owner.data.turnId, 15_000);
    expect(done.live, 'the answer ended while the socket was down: its end is history').toBe(false);
    expect(done.at).toBeGreaterThanOrEqual(cutAt);
    expect(sockets.length, 'the app reconnected').toBeGreaterThanOrEqual(2);
    await page.waitForTimeout(1500);
    const answer = async () => (await heard(page, t0)).filter((l) => l.kind === 'answer' && l.at < cutAt).map((l) => l.text).join(' ');
    expect(await answer(), 'the sentence that streamed in live is voiced').toContain('What is a good name for a candle brand?');
    expect(await answer(), 'nothing of the answer after the drop').not.toContain('placeholder');

    // The job-done announcement is voiced (it used to wait behind the open stream of that answer until a barge-in).
    const t1 = Date.now();
    await waitForFrame(page, (f) => f.type === 'talk.message' && f.live && f.data.kind === 'announcement' && f.data.jobId === jobId, 90_000);
    await expect.poll(async () => (await heard(page, t1)).filter((l) => l.kind === 'answer' && /” is done\./.test(l.text)).length, { timeout: 10_000 }).toBe(1);
    await quiet(page);
    expect(await answer(), 'the rest of that answer was never said later either').not.toContain('placeholder');
    expectOnce(await heard(page, t0), 'across the drop');
  } finally {
    await ctx.close();
  }
});

test('a socket that comes back while the answer still streams: the answer ends where it was, no garbled sentence, the next line is voiced', async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const { ctx, page } = await tab(browser, baseURL!);
  // What the page sees when its socket comes back while the Chief is still answering: a `ready` at its own cursor, then
  // the rest of the answer live, with the deltas sent during the outage lost for good (they are never replayed). Mock
  // answers stream in a few milliseconds, so the proxy plays it out: armed, the socket goes half-open once the
  // answer's first sentence has streamed in and is dropped after the server finished that answer. On the next socket
  // the `ready` names the page's cursor (nothing new yet), the latter half of the withheld deltas follows (the rest was
  // lost), then the answer's message and end, live.
  const feed = { cut: false, holding: false, finished: false, withheld: [] as string[], resumed: false };
  const sockets: { page: WebSocketRoute; server: WebSocketRoute }[] = [];
  await page.routeWebSocket(/\/api\/ws/, (ws) => {
    const server = ws.connectToServer();
    sockets.push({ page: ws, server });
    const since = Number(new URL(ws.url()).searchParams.get('since') ?? 0);
    const resume = feed.withheld.length > 0 && !feed.resumed;
    let text = '';
    server.onMessage((m) => {
      const f = typeof m === 'string' ? (JSON.parse(m) as { type?: string; data?: { agentId?: string; delta?: string; lastSeq?: number } }) : null;
      if (resume && f?.type === 'ready') {
        feed.resumed = true;
        ws.send(JSON.stringify({ ...f, data: { ...f.data, lastSeq: since } }));
        for (const d of feed.withheld.slice(Math.ceil(feed.withheld.length / 2))) ws.send(d);
        return;
      }
      if (feed.holding) {
        if (f?.type === 'talk.delta' && f.data?.agentId === 'cw_chief' && typeof m === 'string') feed.withheld.push(m);
        if (f?.type === 'talk.done') feed.finished = true;
        return;
      }
      ws.send(m);
      if (feed.cut && f?.type === 'talk.delta' && f.data?.agentId === 'cw_chief') {
        text += f.data.delta ?? '';
        if (/[.!?]["'”’)\]]*\s/.test(text)) feed.holding = true;
      }
    });
  });
  try {
    await openTalk(page);
    // A job runs meanwhile (about 15 s): its announcement is the next thing the Chief says after the reconnect.
    await turn(page, 'Look into three packaging suppliers for me');
    const started = await waitForFrame(page, (f) => f.type === 'job.started' && f.live, 20_000);
    const jobId = (started.data.job as { jobId: string }).jobId;
    await quiet(page);

    const t0 = Date.now();
    feed.cut = true;
    await say(page, '!slow 500 What is a good name for a candle brand?');
    const owner = await waitForFrame(page, (f) => f.type === 'talk.owner' && f.live && f.at >= t0 - 50, 20_000);
    await expect.poll(() => feed.finished, { timeout: 20_000 }).toBe(true);
    expect(feed.withheld.length, 'deltas the page never got').toBeGreaterThanOrEqual(2);
    const cut = sockets.at(-1)!;
    await cut.page.close();
    await cut.server.close();
    feed.cut = false;
    feed.holding = false;
    const done = await waitForFrame(page, (f) => f.type === 'talk.done' && f.data.turnId === owner.data.turnId, 15_000);
    expect(feed.resumed, 'the app reconnected').toBe(true);
    expect(done.live, 'the answer ended after the socket came back: its end is live').toBe(true);
    await expect(page.locator('.thread li.msg').last()).toContainText('start Ollama for real ones');
    await page.waitForTimeout(1500);
    const t1 = Date.now();
    const answer = (await heard(page, t0)).filter((l) => l.kind === 'answer' && l.at < t1).map((l) => l.text).join(' ');
    expect(answer, 'the sentence that streamed in before the drop is voiced').toContain('What is a good name for a candle brand?');
    // Before the fix the late deltas were appended to the open answer across the hole ("… I or start Ollama for real ones.").
    expect(answer, 'nothing after the drop, and no sentence joined across the hole').not.toMatch(/Ollama|placeholder/);

    // The job-done announcement is voiced: nothing is left waiting behind that answer.
    await waitForFrame(page, (f) => f.type === 'talk.message' && f.live && f.data.kind === 'announcement' && f.data.jobId === jobId, 90_000);
    await expect.poll(async () => (await heard(page, t1)).filter((l) => l.kind === 'answer' && /” is done\./.test(l.text)).length, { timeout: 10_000 }).toBe(1);
    await quiet(page);
    expect((await heard(page, t0)).map((l) => l.text).join(' '), 'the rest of that answer was never said later either').not.toMatch(/Ollama|placeholder answer/);
    expectOnce(await heard(page, t0), 'across the reconnect');
  } finally {
    await ctx.close();
  }
});
