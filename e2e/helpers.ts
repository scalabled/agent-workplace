import { expect, type APIRequestContext, type Page } from '@playwright/test';

// Shared e2e helpers (keyless Mock worker, one shared state per run: every spec sets the state it needs).

export const LEAD = 'lead-warm-mentor';

export interface Settings {
  leadId?: string | null;
  chiefName?: string | null;
  voiceOn?: boolean;
  ambience?: 'quiet' | 'lively' | 'buzzing';
}

/** Set the owner's settings directly (fast setup; onboarding itself is covered in onboarding.spec). */
export async function setWorkspace(request: APIRequestContext, patch: Settings): Promise<void> {
  const res = await request.put('/api/workspace', { data: patch });
  expect(res.ok(), await res.text()).toBe(true);
}

/** A workspace with a Chief of Staff, voice off (text-only tests stay quiet and deterministic). */
export async function onboarded(request: APIRequestContext, name = 'Rosa', voiceOn = false): Promise<void> {
  await setWorkspace(request, { leadId: LEAD, chiefName: name, voiceOn });
}

export interface SeenFrame {
  type: string;
  seq?: number;
  live: boolean;
  data: Record<string, unknown>;
  at: number;
}

/**
 * Record every owner-feed frame the app applies (dev builds expose the store as window.__headcount), from the
 * first frame of every later load too (reloads included), with its `live` flag.
 */
function installRecorder(): void {
  type Hc = { store: { onFrame(cb: (f: { type: string; seq?: number; data: unknown }, info: { live: boolean }) => void): () => void } };
  const w = window as unknown as { __headcount?: Hc; __frames?: unknown[]; __hcHooked?: boolean };
  if (w.__hcHooked) return;
  w.__hcHooked = true;
  const frames: unknown[] = (w.__frames = []);
  // The hook object is re-assigned as parts of the app load (the living runtime adds itself): record once per store.
  let hooked: unknown = null;
  const hook = (hc: Hc) => {
    if (!hc?.store || hc.store === hooked) return;
    hooked = hc.store;
    hc.store.onFrame((f, info) => frames.push({ type: f.type, seq: f.seq, live: info.live, data: f.data, at: Date.now() }));
  };
  if (w.__headcount) return void hook(w.__headcount);
  let value: Hc | undefined;
  Object.defineProperty(window, '__headcount', {
    configurable: true,
    get: () => value,
    set: (v: Hc) => {
      value = v;
      hook(v);
    },
  });
}

export async function recordFrames(page: Page): Promise<void> {
  await page.addInitScript(installRecorder);
  if (page.url().startsWith('http')) {
    await page.waitForFunction(() => Boolean((window as unknown as { __headcount?: unknown }).__headcount));
    await page.evaluate(installRecorder);
  }
}

export async function frames(page: Page): Promise<SeenFrame[]> {
  return page.evaluate(() => ((window as unknown as { __frames?: SeenFrame[] }).__frames ?? []) as SeenFrame[]);
}

/** Wait until a recorded frame matches (predicate source runs in the page). */
export async function waitForFrame(page: Page, match: (f: SeenFrame) => boolean, timeout = 30_000): Promise<SeenFrame> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const hit = (await frames(page)).find(match);
    if (hit) return hit;
    if (Date.now() > deadline) throw new Error('timed out waiting for a frame');
    await page.waitForTimeout(100);
  }
}

/** Type into the Talk composer and send with Enter. */
export async function say(page: Page, text: string): Promise<void> {
  const box = page.locator('#composer');
  await box.fill(text);
  await box.press('Enter');
}

/** No horizontal page scroll (D3: phone width works). */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(scroll, `page is ${scroll}px wide in a ${client}px viewport`).toBeLessThanOrEqual(client);
}

/** Relative luminance of the body background (0 black … 1 white). */
export async function bodyLuminance(page: Page): Promise<number> {
  return page.evaluate(() => {
    const m = getComputedStyle(document.body).backgroundColor.match(/[\d.]+/g)?.map(Number) ?? [255, 255, 255];
    const [r, g, b] = m.slice(0, 3).map((c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  });
}

/** True when a face canvas has drawn something (not blank). */
export async function faceDrawn(page: Page, selector: string): Promise<boolean> {
  return page.locator(selector).first().evaluate((el) => {
    const canvas = el instanceof HTMLCanvasElement ? el : el.querySelector('canvas');
    if (!canvas || !canvas.width || !canvas.height) return false;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let painted = 0;
    for (let i = 3; i < data.length; i += 4 * 16) if (data[i]! > 0) painted++;
    return painted > 50;
  });
}

// ── the living workforce (Inc 0.5) ───────────────────────────────────────────────

/**
 * A time zone where it is working hours right now: the living layer keeps ambient chatter off in owner-local quiet
 * hours (22:00–07:00), so specs about passing-by run in a daytime zone whatever the clock of the machine says.
 */
export function daytimeZone(at = new Date()): string {
  const zones = ['Europe/London', 'America/New_York', 'America/Los_Angeles', 'Pacific/Honolulu', 'Pacific/Auckland', 'Asia/Tokyo', 'Asia/Kolkata', 'Europe/Berlin', 'America/Sao_Paulo'];
  const hour = (tz: string) => Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: tz }).format(at));
  return zones.find((tz) => hour(tz) >= 10 && hour(tz) <= 16) ?? zones.find((tz) => hour(tz) >= 8 && hour(tz) <= 19)!;
}

export interface Telemetry {
  kind: string;
  agentId: string;
  intent: string;
  turnId?: string;
  lineId?: string;
  reason?: string;
  latencyMs?: number;
  at: number;
}
export interface CaptionEntry {
  at: number;
  agentId: string;
  text: string;
  kind: string;
}
export interface CueEntry {
  agentId: string;
  cue: { gesture: string; expression?: string; holdMs: number };
  at: number;
}

/** The living runtime is loaded (it boots once the app is idle) and knows the Chief of Staff. */
export async function livingReady(page: Page, agentId = 'cw_chief'): Promise<void> {
  await page.waitForFunction(
    (id) => {
      const l = (window as unknown as { __headcount?: { living?: { agent(id: string): unknown } } }).__headcount?.living;
      return !!l && !!l.agent(id);
    },
    agentId,
    { timeout: 30_000 },
  );
}

/** What the living layer did so far: reflex telemetry, captions and bubbles shown, and face cues. */
export async function livingLog(page: Page): Promise<{ telemetry: Telemetry[]; captions: CaptionEntry[]; cues: CueEntry[] }> {
  return page.evaluate(() => {
    const l = (window as unknown as { __headcount: { living: { telemetry: unknown[]; captions: unknown[]; cues: unknown[] } } }).__headcount.living;
    return JSON.parse(JSON.stringify({ telemetry: l.telemetry, captions: l.captions, cues: l.cues }));
  });
}

/** L6: every reflex that was voiced has its words on screen (a caption line or a bubble) by the same agent. */
export async function expectVoicedCaptioned(page: Page, since = 0): Promise<number> {
  const { telemetry, captions } = await livingLog(page);
  const voiced = telemetry.filter((t) => t.kind === 'played' && t.at >= since && t.reason !== 'bubble');
  for (const t of voiced) {
    const shown = captions.some((c) => c.agentId === t.agentId && Math.abs(c.at - t.at) < 3000);
    expect(shown, `${t.agentId} ${t.intent} (${t.lineId}) was voiced with a caption`).toBe(true);
  }
  return voiced.length;
}
