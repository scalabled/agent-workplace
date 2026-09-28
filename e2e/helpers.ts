import { expect, type APIRequestContext, type Page } from '@playwright/test';

// Shared e2e helpers (keyless Mock worker, one shared state per run: every spec sets the state it needs).

export const LEAD = 'lead-warm-mentor';

export interface Settings {
  leadId?: string | null;
  chiefName?: string | null;
  voiceOn?: boolean;
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
  const hook = (hc: Hc) => hc.store.onFrame((f, info) => frames.push({ type: f.type, seq: f.seq, live: info.live, data: f.data, at: Date.now() }));
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
