import { expect, type BrowserContext, type Page } from '@playwright/test';

// Office Phase 2 e2e helpers: the Office on the Floor (docs/dev/OFFICE-PHASE2.md §7.4). Dev builds expose the office
// as window.__headcount.office = {scene, life, view(), stage(), huddles, ready()}; `?at=HH:MM` fixes the office clock
// (scene and life) so the floor is the same on every run of a day.

export const OWNER = 'Sam';

type Hc = {
  office?: {
    scene: {
      getState(): {
        mode: string;
        roomId: string | null;
        participants: string[];
        rooms: Record<string, string[]>;
        camera: { x: number; y: number; zoom: number };
        lod: number;
        focusedId: string | null;
        followingId: string | null;
        huddleCard: string | null;
        lifePaused: boolean;
      };
      getPlan(): { seats: { id: string; personId: string | null }[]; rooms: { id: string; rect: { x: number; y: number; w: number; h: number } }[] };
      placeOf(id: string): { x: number; y: number; walking: boolean };
      zoomTo(level: number | 'fit' | 'desk' | 'neighbourhood', at?: { x: number; y: number }): void;
      walkTo(target: string): void;
      el: HTMLElement;
    };
    life: null | {
      huddles(): { id: string; members: string[]; label: string; joined: boolean }[];
      whereIs(id: string): { kind: string; state: string };
      getState(): { listening: string | null; joined: string | null; paused: boolean; walkers: number };
      pause(): void;
    };
    ready(): boolean;
  };
};

/** The first-run chip is its own check; the other specs start without it. */
export async function skipOfficeHint(target: Page | BrowserContext): Promise<void> {
  await target.addInitScript(() => {
    try {
      localStorage.setItem('hc.office.hint.v1', '1');
    } catch {
      /* storage blocked */
    }
  });
}

/** Open the Floor as the Office at a fixed office time and wait until it is placed (the veil lifted) and life runs. */
export async function openOffice(page: Page, at = '10:35', extra = ''): Promise<void> {
  await page.goto(`/app/floor?view=office&at=${at}${extra}`);
  await expect(page.getByTestId('office-view')).toBeVisible();
  await page.waitForFunction(() => {
    const o = (window as unknown as { __headcount?: Hc }).__headcount?.office;
    return !!o && o.ready() && !!o.life;
  }, null, { timeout: 30_000 });
}

export function officeState(page: Page) {
  return page.evaluate(() => (window as unknown as { __headcount: Required<Hc> }).__headcount.office.scene.getState());
}

/**
 * Someone at their desk (not away, not walking, not the Chief) whose face is in view, clear of the HUD: their id and
 * the face's centre on screen. `skip` leaves out people already used.
 */
export async function seatedInView(page: Page, skip: readonly string[] = []): Promise<{ id: string; x: number; y: number }> {
  let found: { id: string; x: number; y: number } | null = null;
  await expect
    .poll(
      async () => {
        const r = await page.evaluate((skipIds) => {
          const o = (window as unknown as { __headcount: Required<Hc> }).__headcount.office;
          const host = o.scene.el.getBoundingClientRect();
          const seated = [...document.querySelectorAll<HTMLElement>('.hc-o-seat[data-face]:not([data-away]):not([data-walking]):not([data-chief]):not([data-room])')].filter((b) => {
            const id = b.dataset.pid!;
            if (skipIds.includes(id)) return false;
            const where = o.life?.whereIs(id);
            return !where || where.kind === 'desk';
          });
          for (const b of seated) {
            const r = (b.querySelector('.hc-o-seat__face') ?? b).getBoundingClientRect();
            if (r.width < 18) continue;
            const x = r.x + r.width / 2;
            const y = r.y + r.height / 2;
            if (x > host.left + 160 && x < host.right - 200 && y > host.top + 120 && y < host.bottom - 180) return { found: { id: b.dataset.pid!, x, y } };
          }
          // Nobody seated in view (a small team sits in one corner; the office opens on a lively place): bring the
          // first one at their desk into view, and look again once the camera has settled.
          const first = seated[0];
          const at = first ? o.scene.placeOf(first.dataset.pid!) : null;
          if (at) o.scene.zoomTo(2.2, { x: at.x, y: at.y * 0.82 });
          return { found: null, zoomed: !!at };
        }, skip);
        if (r.zoomed) await page.waitForTimeout(1200);
        found = r.found;
        return found !== null;
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  return found!;
}

/** Point at a face and rest there (the office's dwell is 600 ms below 0.3 px/ms). */
export async function restOn(page: Page, p: { x: number; y: number }, ms = 800): Promise<void> {
  await page.mouse.move(p.x - 50, p.y + 50);
  await page.mouse.move(p.x, p.y, { steps: 6 });
  await page.waitForTimeout(ms);
}

/** Frame a huddle at L2 and return its ring's centre on screen (the card opens on a dwell there). */
export async function frameHuddle(page: Page, prefer: RegExp = /cooler|coffee/i): Promise<{ id: string; members: string[]; label: string; x: number; y: number }> {
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __headcount: Required<Hc> }).__headcount.office.life?.huddles().filter((h) => h.members.length >= 2).length ?? 0), { timeout: 20_000 })
    .toBeGreaterThan(0);
  const h = await page.evaluate((src) => {
    const o = (window as unknown as { __headcount: Required<Hc> }).__headcount.office;
    const re = new RegExp(src, 'i');
    const all = o.life!.huddles().filter((x) => x.members.length >= 2);
    const h = all.find((x) => re.test(x.label)) ?? all[0]!;
    const ps = h.members.map((id) => o.scene.placeOf(id));
    const x = ps.reduce((a, p) => a + p.x, 0) / ps.length;
    const y = ps.reduce((a, p) => a + p.y, 0) / ps.length;
    o.scene.zoomTo(3.6, { x, y: y * 0.82 - 4 });
    return { id: h.id, members: h.members, label: h.label };
  }, prefer.source);
  await page.waitForTimeout(1300);
  const ring = await page.evaluate((id) => {
    const el = document.querySelector(`.hc-o-huddle[data-id="${CSS.escape(id)}"] .hc-o-huddle__ring`) ?? document.querySelector('.hc-o-huddle__ring');
    const r = el!.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, h.id);
  return { ...h, ...ring };
}

/** A person's desk light (the monitor spill at their seat). */
export function deskLight(page: Page, personId: string): Promise<{ mon: string | null } | null> {
  return page.evaluate((id) => {
    const o = (window as unknown as { __headcount: Required<Hc> }).__headcount.office;
    const seat = o.scene.getPlan().seats.find((s) => s.personId === id);
    const g = seat ? document.querySelector(`.hc-o-sl[data-seat="${CSS.escape(seat.id)}"]`) : null;
    return g ? { mon: g.getAttribute('data-mon') } : null;
  }, personId);
}

/** Screen point of a plan point (the office's projection: y foreshortened by 0.82, the camera centred on the host). */
export function screenOf(page: Page, p: { x: number; y: number }): Promise<{ x: number; y: number }> {
  return page.evaluate((pt) => {
    const o = (window as unknown as { __headcount: Required<Hc> }).__headcount.office;
    const cam = o.scene.getState().camera;
    const r = o.scene.el.getBoundingClientRect();
    return { x: r.left + (pt.x - cam.x) * cam.zoom + r.width / 2, y: r.top + (pt.y * 0.82 - cam.y) * cam.zoom + r.height / 2 };
  }, p);
}
