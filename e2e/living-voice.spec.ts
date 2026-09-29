import { writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { daytimeZone, expectVoicedCaptioned, frames, livingLog, livingReady, onboarded, recordFrames, say, setWorkspace, waitForFrame, type Telemetry } from './helpers';

// The living workforce with voice (project "living-voice": Mock chat, Mock TTS clips with timing, and a microphone
// that talks in 2.8 s stretches with 0.7 s pauses). What the owner hears: pre-voiced reflexes in the Chief of
// Staff's voice, captioned, never over the owner, and a job's life felt at Talk.
// Push-to-talk transcripts are set per test (the STT response is routed); everything else is the real pipeline.
test.use({ timezoneId: daytimeZone() });

test.beforeEach(async ({ request }) => {
  await onboarded(request, 'Rosa', true);
  await setWorkspace(request, { ambience: 'lively' });
});

// On failure, attach what the living layer did (telemetry, captions, cues, frames, the audio probe) to the report.
test.afterEach(async ({ page }, info) => {
  if (info.status === info.expectedStatus) return;
  try {
    const log = await livingLog(page);
    const f = (await frames(page)).filter((x) => x.live).map((x) => `${x.at} ${x.type} ${String(x.data.intent ?? x.data.kind ?? x.data.route ?? '')}`);
    const p = await probe(page).catch(() => ({ vad: [], samples: [] as Sample[] }));
    const edges = p.samples.filter((s, i, all) => i === 0 || s.reflex !== all[i - 1]!.reflex || s.speaking !== all[i - 1]!.speaking || s.mic !== all[i - 1]!.mic).map((s) => `${s.at} reflex=${+s.reflex} speaking=${+s.speaking} mic=${+s.mic}`);
    const tel = log.telemetry.map((t) => `${t.at} ${t.kind} ${t.agentId} ${t.intent} ${t.reason ?? ''} ${t.lineId ?? ''}`);
    const body = [...tel, '--', ...f, '--', ...edges, '--', JSON.stringify(p.vad)].join('\n');
    writeFileSync(info.outputPath('living.txt'), body);
    await info.attach('living.txt', { body, contentType: 'text/plain' });
  } catch {
    /* the page is gone */
  }
});

test.afterAll(async ({ request }) => {
  await setWorkspace(request, { ambience: 'lively' });
});

/** What push-to-talk will "hear" next. */
async function transcribeAs(page: Page, text: () => string): Promise<void> {
  await page.route('**/api/speech/stt', (route) => route.fulfill({ json: { text: text(), provider: 'mock', language: 'en' } }));
}

/** Hold the mic button for `ms`, then let go. Returns the release time (epoch ms). */
async function holdToTalk(page: Page, ms: number): Promise<number> {
  const mic = page.getByRole('button', { name: /^Talk: hold/ });
  const box = (await mic.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
  return Date.now();
}

/** Talk with the Chief's P0 pre-voiced and decoded, audio armed, and a probe recording what sounds and when. */
async function openTalk(page: Page): Promise<void> {
  await page.goto('/app/talk');
  await livingReady(page);
  await recordFrames(page);
  await page.waitForFunction(() => (window as unknown as { __headcount: { living: { clipsDecoded(): number } } }).__headcount.living.clipsDecoded() >= 20, null, { timeout: 30_000 });
  await page.locator('#composer').click(); // a gesture arms audio
  await page.evaluate(() => {
    type Engine = {
      activity(id: string): { reflex: boolean; conversation: boolean };
      speaking(): string[];
      micLive(): boolean;
      onOwnerVad(cb: (e: { kind: string; at: number; pauseMs?: number; utteranceMs: number }) => void): () => void;
      sampler(id: string): { sample(t: number): { openness: number } };
    };
    const w = window as unknown as { __headcount: { audio(): Engine }; __probe: { vad: unknown[]; samples: unknown[] } };
    const e = w.__headcount.audio();
    const probe: { vad: unknown[]; samples: unknown[] } = { vad: [], samples: [] };
    w.__probe = probe;
    e.onOwnerVad((v) => probe.vad.push({ ...v, now: Date.now() }));
    setInterval(() => {
      const a = e.activity('cw_chief');
      probe.samples.push({ at: Date.now(), reflex: a.reflex, speaking: e.speaking().includes('cw_chief'), mic: e.micLive(), mouth: e.sampler('cw_chief').sample(performance.now()).openness });
    }, 20);
  });
}

interface Sample {
  at: number;
  reflex: boolean;
  speaking: boolean;
  mic: boolean;
  mouth: number;
}
interface Vad {
  kind: 'start' | 'pause' | 'resume' | 'end';
  at: number;
  now: number;
  pauseMs?: number;
  utteranceMs: number;
}
async function probe(page: Page): Promise<{ vad: Vad[]; samples: Sample[] }> {
  return page.evaluate(() => JSON.parse(JSON.stringify((window as unknown as { __probe: unknown }).__probe)));
}

const played = (t: Telemetry[], intent: string, since = 0) => t.filter((x) => x.kind === 'played' && x.intent === intent && x.at >= since && x.reason !== 'bubble');

test('opening Talk pre-voices the Chief of Staff in their own voice and decodes it before the first turn', async ({ page, request }) => {
  await openTalk(page);
  const chief = await (await request.get('/api/expr/agents/cw_chief')).json();
  expect(chief.provider).toBe('mock');
  await expect.poll(async () => (await (await request.get('/api/expr/agents/cw_chief')).json()).prevoice?.state, { timeout: 20_000 }).toBe('done');
  expect(Object.keys((await (await request.get('/api/expr/agents/cw_chief')).json()).manifest.clips).length).toBeGreaterThanOrEqual(60);
});

test('a slow voice turn: a filler within a second or so, captioned, then the answer — never both at once', async ({ page }) => {
  await openTalk(page);
  await transcribeAs(page, () => '!slow 3000 What should we focus on this week?');
  const releasedAt = await holdToTalk(page, 1200);
  const owner = await waitForFrame(page, (f) => f.type === 'talk.owner' && f.live && f.data.via === 'voice');
  await waitForFrame(page, (f) => f.type === 'talk.done' && f.live && f.data.turnId === owner.data.turnId, 20_000);
  await expect.poll(async () => (await probe(page)).samples.some((s) => s.speaking), { timeout: 10_000 }).toBe(true);
  const { telemetry, captions } = await livingLog(page);
  const filler = played(telemetry, 'thinking_filler', releasedAt)[0];
  expect(filler, 'a thinking filler played').toBeTruthy();
  expect(filler!.at - releasedAt, 'the filler started within 1.6 s of letting go').toBeLessThan(1600);
  expect(captions.some((c) => c.agentId === 'cw_chief' && c.kind === 'reaction' && Math.abs(c.at - filler!.at) < 1000), 'the filler is captioned').toBe(true);
  const { samples } = await probe(page);
  const both = samples.filter((s) => s.reflex && s.speaking);
  expect(both.length, 'the answer never sounded over the filler (20 ms samples)').toBeLessThanOrEqual(2);
  await expectVoicedCaptioned(page);
});

test('a joke by voice: the Chief laughs in their own style (or smiles when the draw says no), never over the owner', async ({ page }) => {
  await openTalk(page);
  await transcribeAs(page, () => "!slow 2500 Haha, the printer's haunted again");
  const releasedAt = await holdToTalk(page, 1200);
  const owner = await waitForFrame(page, (f) => f.type === 'talk.owner' && f.live && f.data.via === 'voice');
  await waitForFrame(page, (f) => f.type === 'talk.done' && f.live && f.data.turnId === owner.data.turnId, 20_000);
  const { telemetry, cues, captions } = await livingLog(page);
  const laugh = telemetry.filter((t) => t.intent === 'laugh' && t.at >= releasedAt);
  const voiced = laugh.find((t) => t.kind === 'played');
  if (voiced) {
    expect(captions.some((c) => c.agentId === 'cw_chief' && Math.abs(c.at - voiced.at) < 1000), 'the laugh is captioned').toBe(true);
    expect(voiced.lineId).toMatch(/laugh/);
  } else {
    // E10: a laugh plays with probability ≤ 0.65; one that loses the draw is a silent smile.
    expect(laugh.some((t) => t.reason === 'probability'), JSON.stringify(laugh)).toBe(true);
    expect(cues.some((c) => c.agentId === 'cw_chief' && c.at >= releasedAt && c.cue.gesture === 'smile')).toBe(true);
  }
  const { samples } = await probe(page);
  expect(samples.filter((s) => s.reflex && s.mic), 'nothing was voiced while the mic was live').toEqual([]);
});

/** Wait until the Chief's P1 run is done and its reactions (sympathy, concern …) have had time to decode. */
async function reactionsReady(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const a = (window as unknown as { __headcount: { living: { agent(id: string): { prevoice: { tiers: string[]; state: string } | null } | null } } }).__headcount.living.agent('cw_chief');
      return !!a?.prevoice && a.prevoice.tiers.includes('p1') && a.prevoice.state === 'done';
    },
    null,
    { timeout: 40_000 },
  );
  await page.waitForTimeout(2500);
}

test('a sincere "are you an AI?" gets no reflex at all; distress gets a voiced sympathy and no "let me think"', async ({ page }) => {
  await openTalk(page);
  await reactionsReady(page);
  await transcribeAs(page, () => '!slow 3000 Honestly, are you a real person or an AI?');
  const askedAt = await holdToTalk(page, 1200);
  const ai = await waitForFrame(page, (f) => f.type === 'talk.owner' && f.live && f.data.via === 'voice');
  await waitForFrame(page, (f) => f.type === 'talk.done' && f.live && f.data.turnId === ai.data.turnId, 20_000);
  let { telemetry } = await livingLog(page);
  expect(telemetry.filter((t) => t.kind === 'played' && t.at >= askedAt), 'no reflex on a sincere question (H6)').toEqual([]);
  expect((await frames(page)).filter((f) => f.type === 'reflex.say' && f.live && f.data.turnId === ai.data.turnId), 'the server sent no filler').toEqual([]);

  await transcribeAs(page, () => '!slow 3000 My dad is in the hospital and I am really scared.');
  const sharedAt = await holdToTalk(page, 1200);
  const hard = await waitForFrame(page, (f) => f.type === 'talk.owner' && f.live && f.data.via === 'voice' && f.data.turnId !== ai.data.turnId);
  await waitForFrame(page, (f) => f.type === 'talk.done' && f.live && f.data.turnId === hard.data.turnId, 20_000);
  ({ telemetry } = await livingLog(page));
  const since = telemetry.filter((t) => t.kind === 'played' && t.at >= sharedAt && t.reason !== 'bubble');
  expect(since.map((t) => t.intent), 'sympathy only (§1.4.4)').toEqual(['sympathy']);
  await expectVoicedCaptioned(page, sharedAt);
});

test('a spoken request: one acknowledgement at most, one "one sec" at most, never the same words twice', async ({ page }) => {
  await openTalk(page);
  await transcribeAs(page, () => '!slow 3500 Can you give me three subject lines for the candle launch?');
  const releasedAt = await holdToTalk(page, 1200);
  const owner = await waitForFrame(page, (f) => f.type === 'talk.owner' && f.live && f.data.via === 'voice');
  await waitForFrame(page, (f) => f.type === 'talk.done' && f.live && f.data.turnId === owner.data.turnId, 20_000);
  const { telemetry, captions } = await livingLog(page);
  // Whether the acknowledgement fits the brain's usual first-chunk time depends on the clip lengths (E6); either way
  // the turn is covered once, and a server filler after the acknowledgement is dropped as covered.
  const acks = played(telemetry, 'acknowledge', releasedAt);
  const fillers = played(telemetry, 'thinking_filler', releasedAt);
  expect(acks.length, 'at most one acknowledgement').toBeLessThanOrEqual(1);
  expect(fillers.length, 'at most one filler').toBeLessThanOrEqual(1);
  expect(acks.length + fillers.length, 'the wait was covered').toBeGreaterThanOrEqual(1);
  const said = captions.filter((c) => c.agentId === 'cw_chief' && c.at >= releasedAt && c.kind === 'reaction').map((c) => c.text);
  expect(new Set(said).size, `never the same words twice: ${JSON.stringify(said)}`).toBe(said.length);
  if (acks.length) {
    const serverFiller = (await frames(page)).find((f) => f.type === 'reflex.say' && f.live && f.data.turnId === owner.data.turnId && f.data.intent === 'thinking_filler');
    if (serverFiller) expect(telemetry.some((t) => t.intent === 'thinking_filler' && t.turnId === owner.data.turnId && t.reason === 'covered'), 'the server filler after the acknowledgement was dropped').toBe(true);
  }
});

test('holding to talk: a nod (and at most a soft "mm-hm") in a real pause, gone the moment the owner resumes', async ({ page }) => {
  await openTalk(page);
  await transcribeAs(page, () => 'So here is the plan I have been mulling over for the spring');
  const startedAt = Date.now();
  await holdToTalk(page, 8000);
  await waitForFrame(page, (f) => f.type === 'talk.owner' && f.live && f.data.via === 'voice');
  const { vad, samples } = await probe(page);
  const pauses = vad.filter((v) => v.kind === 'pause');
  expect(pauses.length, 'the owner paused while holding').toBeGreaterThan(0);
  const long = pauses.find((p) => p.utteranceMs >= 2500);
  expect(long, 'a pause after 2.5 s of talking').toBeTruthy();
  const { cues, telemetry } = await livingLog(page);
  const nod = cues.find((c) => c.agentId === 'cw_chief' && c.cue.gesture === 'nod' && c.at >= startedAt);
  expect(nod, 'the face nodded').toBeTruthy();
  expect(Math.abs(nod!.at - long!.now), 'in the pause').toBeLessThan(500);
  // A voiced backchannel sounds only inside a pause and stops within 150 ms of the owner resuming (L5).
  const resumes = vad.filter((v) => v.kind === 'resume' || v.kind === 'end').map((v) => v.now);
  for (const s of samples.filter((x) => x.reflex && x.mic)) {
    const inPause = pauses.some((p) => s.at >= p.now - 30 && s.at <= (resumes.find((r) => r > p.now) ?? Infinity) + 150);
    expect(inPause, `reflex audio at ${s.at - startedAt} ms was inside a pause`).toBe(true);
  }
  for (const t of telemetry.filter((x) => x.kind === 'played' && x.at >= startedAt && x.at <= startedAt + 8000)) expect(t.intent).toBe('backchannel');
  await expectVoicedCaptioned(page, startedAt);
});

test('Ambience Quiet: a typed "thanks" is still answered aloud and captioned; a desk hover only looks up', async ({ page, request }) => {
  await setWorkspace(request, { ambience: 'quiet' });
  await openTalk(page);
  const since = Date.now();
  await say(page, 'thanks!');
  const say$ = await waitForFrame(page, (f) => f.type === 'reflex.say' && f.live && f.data.intent === 'gratitude_reply', 5_000);
  expect((say$.data.channels as { voice: boolean }).voice).toBe(true);
  await expect.poll(async () => played((await livingLog(page)).telemetry, 'gratitude_reply', since).length, { timeout: 3_000 }).toBe(1);
  await expectVoicedCaptioned(page, since);

  await page.getByRole('navigation', { name: 'Places' }).getByRole('link', { name: 'Floor' }).click();
  const slot = page.locator('.cw-grid .cw-slot').nth(4);
  await slot.scrollIntoViewIfNeeded();
  const box = (await slot.locator('.cw-card').boundingBox())!;
  const agentId = (await slot.getAttribute('data-agent-id'))!;
  const hoverAt = Date.now();
  await page.mouse.move(box.x + 24, box.y + 24);
  await page.mouse.move(box.x + 26, box.y + 25);
  await expect.poll(async () => (await livingLog(page)).cues.some((c) => c.agentId === agentId && c.cue.gesture === 'look_up' && c.at >= hoverAt), { timeout: 2_000 }).toBe(true);
  // Silent: no bubble, no line played, nothing sounding for that desk for the next 1.5 s.
  const sounded = await page.evaluate(async (id) => {
    const e = (window as unknown as { __headcount: { audio(): { activity(id: string): { reflex: boolean; ambient: boolean } } } }).__headcount.audio();
    let any = false;
    for (let i = 0; i < 75; i++) {
      const a = e.activity(id);
      any ||= a.reflex || a.ambient;
      await new Promise((r) => setTimeout(r, 20));
    }
    return any;
  }, agentId);
  expect(sounded).toBe(false);
  await expect(page.locator(`[data-testid="floor-bubble"][data-agent-id="${agentId}"]`)).toHaveCount(0);
  expect((await livingLog(page)).telemetry.filter((t) => t.agentId === agentId && t.kind === 'played')).toEqual([]);
});

test('a job at Talk: acknowledged by voice, a true progress line, a celebration right before the announcement, a brighter face', async ({ page }) => {
  test.setTimeout(120_000);
  await openTalk(page);
  await transcribeAs(page, () => 'Look into three packaging suppliers for me');
  const releasedAt = await holdToTalk(page, 1200);
  const started = await waitForFrame(page, (f) => f.type === 'job.started' && f.live, 20_000);
  const job = started.data.job as { jobId: string; title: string };

  // The acknowledgement plays in the Chief's voice (captioned), and their mouth moves with it.
  await expect.poll(async () => played((await livingLog(page)).telemetry, 'acknowledge', releasedAt).length, { timeout: 5_000 }).toBeGreaterThan(0);
  const ack = played((await livingLog(page)).telemetry, 'acknowledge', releasedAt)[0]!;
  expect(ack.at - releasedAt, 'acknowledged within 1.5 s of letting go').toBeLessThan(1500);
  await page.waitForTimeout(1500); // let the probe see the clip through
  const during = (await probe(page)).samples.filter((s) => s.reflex && s.at >= ack.at - 100 && s.at <= ack.at + 2500);
  expect(Math.max(0, ...during.map((s) => s.mouth)), 'the mouth follows the reflex audio').toBeGreaterThan(0.05);

  // Stay at Talk until it finishes: a progress line after a checkpoint, then "Nice." and the announcement.
  await waitForFrame(page, (f) => f.type === 'job.done' && f.live && f.data.jobId === job.jobId, 60_000);
  const announcement = await waitForFrame(page, (f) => f.type === 'talk.message' && f.live && f.data.kind === 'announcement', 10_000);
  const all = await frames(page);
  const celebrate = all.find((f) => f.type === 'reflex.say' && f.live && f.data.intent === 'celebrate');
  // (celebrate has a 5-minute cooldown per agent: this is the one job that finishes at Talk on the fresh voice stack)
  expect(celebrate, 'the server sent the celebration').toBeTruthy();
  const announced = all.findIndex((f) => f.type === 'talk.message' && f.data.messageId === announcement.data.messageId);
  expect(all.indexOf(celebrate!), 'the celebration arrives before the announcement').toBeLessThan(announced);
  await expect.poll(async () => played((await livingLog(page)).telemetry, 'celebrate').length, { timeout: 5_000 }).toBe(1);
  const cel = played((await livingLog(page)).telemetry, 'celebrate')[0]!;
  // The announcement's voice waits for the lead-in: it starts after the celebration started.
  await expect.poll(async () => (await probe(page)).samples.some((s) => s.speaking && s.at > cel.at), { timeout: 10_000 }).toBe(true);
  const { samples } = await probe(page);
  const firstSpeech = samples.find((s) => s.speaking && s.at >= announcement.at - 50);
  expect(firstSpeech!.at, 'the announcement started after the lead-in').toBeGreaterThanOrEqual(cel.at);
  const micro = played((await livingLog(page)).telemetry, 'micro_status', releasedAt);
  expect(micro.length, 'at most one progress line (2-minute cooldown)').toBeLessThanOrEqual(1);

  // The mood moved on a real event, and the face shows it.
  const mood = all.filter((f) => f.type === 'mood.changed' && f.live && f.data.agentId === 'cw_chief').at(-1);
  expect(mood?.data.reason).toBe('job.done');
  const state = await page.evaluate(() => (window as unknown as { __headcount: { living: { mood(id: string): { lastKind: string; value: { valence: number } } | null } } }).__headcount.living.mood('cw_chief'));
  expect(state?.lastKind).toBe('job.done');
  expect(state!.value.valence).toBeGreaterThan(0);
  await expectVoicedCaptioned(page, releasedAt);
});
