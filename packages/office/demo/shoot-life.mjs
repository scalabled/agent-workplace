// Office life captures: screens over time and motion frame sequences of the demo with
// life running. Needs the demo server (vite.config.mjs; OFFICE_DEMO_PORT=5871 for example).
//   node packages/office/demo/shoot-life.mjs [--url http://127.0.0.1:5871] [--out docs/dev/screens/office-life]
//     [--only name,name] [--day 2026-09-29]
// Writes JPEG (q88, 2×) screens and contact sheets. The demo clock is pinned (?day, ?at) so every run shows the same
// deterministic floor for the same seed.
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const out = resolve(repo, opt('out', 'docs/dev/screens/office-life'));
const base = opt('url', 'http://127.0.0.1:5871');
const day = opt('day', '2026-09-29');
const only = opt('only', '')?.split(',').filter(Boolean) ?? [];
const tmp = resolve(out, '.frames');
mkdirSync(out, { recursive: true });
mkdirSync(tmp, { recursive: true });

const browser = await chromium.launch();
const log = (...a) => console.log(...a);

async function open(page, query) {
  // recency=0: every capture starts from fresh huddle recency (the demo persists it between reloads).
  await page.goto(`${base}/?panel=0&day=${day}&recency=0&${query}`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.documentElement.dataset.ready === '1' && (!window.life || window.life.plan()), null, { timeout: 30000 });
  await page.waitForFunction(() => !!document.querySelector('.hc-o-sky__v.is-loaded, .hc-o-sky__v[data-fallback]'), null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(500);
}
async function facesLoaded(page) {
  await page.waitForFunction(() => [...document.querySelectorAll('.hc-o-seat[data-face] img')].every((i) => i.complete), null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(300);
}
const shot = (page, name, clip) => page.screenshot({ path: resolve(out, `${name}.jpg`), type: 'jpeg', quality: 88, ...(clip ? { clip } : {}) });

/** Fly the camera to a huddle (or a person) at L1. */
async function frameHuddle(page, pred = 'true', zoom = 3.6) {
  return page.evaluate(
    ({ pred, zoom }) => {
      const hs = window.life.huddles().filter((h) => new Function('h', `return ${pred}`)(h));
      const h = hs[0];
      if (!h) return null;
      const ps = h.members.map((id) => window.office.placeOf(id));
      const x = ps.reduce((a, p) => a + p.x, 0) / ps.length;
      const y = ps.reduce((a, p) => a + p.y, 0) / ps.length;
      window.office.zoomTo(zoom, { x, y: y * 0.82 - 4 });
      return h;
    },
    { pred, zoom },
  );
}
async function waitHuddle(page, pred = 'true', ms = 90_000) {
  await page.waitForFunction((pred) => window.life && window.life.huddles().some((h) => new Function('h', `return ${pred}`)(h)), pred, { timeout: ms }).catch(() => log('  (no huddle matched in time)'));
}
/** The centre of a huddle's ring on screen (that huddle's, else the first one in view). */
async function ringCenter(page, id = null) {
  return page.evaluate((id) => {
    const rings = [...document.querySelectorAll('.hc-o-huddle')].filter((e) => !id || e.dataset.id === id).map((e) => e.querySelector('.hc-o-huddle__ring')?.getBoundingClientRect()).filter((r) => r && r.width && r.x > 0 && r.y > 0 && r.x < innerWidth && r.y < innerHeight);
    const r = rings[0];
    return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
  }, id);
}

/** A contact sheet from frame files: a grid with small captions, rendered by the browser. */
async function contactSheet(name, frames, cols, title, cellW = 480) {
  const page = await browser.newPage({ viewport: { width: cols * (cellW + 8) + 24, height: 400 }, deviceScaleFactor: 1 });
  const cells = frames
    .map((f) => `<figure><img src="data:image/png;base64,${readFileSync(f.path).toString('base64')}"/><figcaption>${f.caption}</figcaption></figure>`)
    .join('');
  await page.setContent(`<!doctype html><html><body style="margin:0;background:#0b0c0e;color:#d9d6cf;font:12px/1.3 Inter,system-ui,sans-serif">
    <div style="padding:12px 12px 4px;font-weight:600;font-size:14px">${title}</div>
    <div style="display:grid;grid-template-columns:repeat(${cols},${cellW}px);gap:8px;padding:8px 12px 12px">${cells}</div>
    <style>figure{margin:0}img{width:${cellW}px;display:block;border-radius:4px}figcaption{padding:3px 2px 0;color:#9ba0a8}</style></body></html>`);
  await page.waitForTimeout(300);
  const h = await page.evaluate(() => document.body.scrollHeight);
  await page.setViewportSize({ width: cols * (cellW + 8) + 24, height: h });
  await page.screenshot({ path: resolve(out, `${name}.jpg`), type: 'jpeg', quality: 86, fullPage: true });
  await page.close();
}

const shots = {
  async 'opening-l1'(page) {
    // What the owner sees on opening the office with life on: L1 on the liveliest neighbourhood, talking at once.
    await open(page, 'at=10:36');
    await facesLoaded(page);
    await page.waitForFunction(() => document.querySelector('.hc-o-bubble--talk:not(.is-leaving)'), null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(500);
  },
  async 'aquarium-fit-lively'(page) {
    // The whole floor (frame=0 keeps the fit view): walkers as accent dots with a short trail, huddle glyphs.
    await open(page, 'at=10:36&frame=0');
    await page.waitForTimeout(6000);
  },
  async 'fit-walkers'(page) {
    // Plan zoom up close: a walker's dot and trail, and a huddle glyph pulsing in the speaker's accent.
    await open(page, 'at=11:20&frame=0&amb=buzzing');
    await page.waitForFunction(() => document.querySelector('.hc-o-huddle[data-speaking]') && document.querySelectorAll('.hc-o-walker').length >= 2, null, { timeout: 60000 }).catch(() => {});
    const r = await page.evaluate(() => {
      const g = document.querySelector('.hc-o-huddle[data-speaking]')?.getBoundingClientRect();
      return g ? { x: g.x, y: g.y } : { x: 720, y: 600 };
    });
    await page.screenshot({ path: resolve(out, 'fit-walkers.jpg'), type: 'jpeg', quality: 88, clip: { x: Math.max(0, Math.min(1440 - 620, r.x - 310)), y: Math.max(0, Math.min(900 - 330, r.y - 150)), width: 620, height: 330 } });
    return 'sheet';
  },
  async 'laugh-chip'(page) {
    // A laugh is a muted caption chip beside the face (no name, no tail), never a speech bubble.
    await open(page, 'at=11:20&amb=buzzing');
    await facesLoaded(page);
    // Laughs are rare by design (≤ 20 % of exchanges end on one): wait for one near the middle of the view.
    await page.waitForFunction(() => [...document.querySelectorAll('.hc-o-chip:not(.is-leaving)')].some((c) => { const r = c.getBoundingClientRect(); return c.style.visibility !== 'hidden' && r.x > 300 && r.x < 1100 && r.y > 200 && r.y < 700; }), null, { timeout: 300000, polling: 50 }).catch(() => log('  (no laugh in time)'));
    const r = await page.evaluate(() => {
      const c = [...document.querySelectorAll('.hc-o-chip')].find((x) => x.style.visibility !== 'hidden')?.getBoundingClientRect();
      return c ? { x: c.x, y: c.y } : { x: 720, y: 450 };
    });
    await page.screenshot({ path: resolve(out, 'laugh-chip.jpg'), type: 'jpeg', quality: 88, clip: { x: Math.max(0, Math.min(1440 - 560, r.x - 280)), y: Math.max(0, Math.min(900 - 320, r.y - 180)), width: 560, height: 320 } });
    return 'sheet';
  },
  async 'dropby'(page) {
    // A desk drop-by: the visitor stands at the end of the host's desk on the aisle side (never on a name plate).
    await open(page, 'at=10:00');
    const hs = await page.evaluate(() => {
      const now = window.demo.demoNow().getTime();
      return window.life.plan().huddles.filter((x) => x.kind === 'desk_dropby' && x.start > now + 60_000 && x.end - x.start > 90_000).slice(0, 4);
    });
    if (!hs.length) return log('  no drop-by planned');
    // Real state wins (a host with a raised hand in the demo stays put, and the drop-by never forms): try the next.
    let h = null;
    for (const c of hs) {
      // ?at= takes minutes: open 15 s before to 45 s after the drop-by starts.
      const at = new Date(c.start + 45_000);
      await open(page, `at=${at.getHours()}:${String(at.getMinutes()).padStart(2, '0')}`);
      const ok = await page.waitForFunction((id) => window.life.huddles().some((x) => x.id === id), c.id, { timeout: 45000 }).then(() => true, () => false);
      if (ok) {
        h = c;
        break;
      }
    }
    if (!h) return log('  (no drop-by gathered)');
    await page.evaluate((id) => {
      const p = window.office.placeOf(id);
      window.office.zoomTo(4.6, { x: p.x, y: p.y * 0.82 - 8 });
    }, h.hostId);
    await facesLoaded(page);
    await page.waitForTimeout(1500);
    const ring = await ringCenter(page, h.id);
    if (ring) {
      await page.mouse.move(ring.x, ring.y + 100, { steps: 3 });
      await page.mouse.move(ring.x, ring.y, { steps: 6 });
      await page.waitForFunction(() => document.querySelector('.hc-o-hcard:not([hidden])'), null, { timeout: 3000 }).catch(() => log('  (no card)'));
      await page.waitForTimeout(400);
    } else log('  (no ring in view)');
  },
  async 'water-cooler-l1'(page) {
    await open(page, 'at=10:35');
    await waitHuddle(page, "h.spot === 'water_cooler'");
    await frameHuddle(page, "h.spot === 'water_cooler'");
    await facesLoaded(page);
    await page.waitForFunction(() => document.querySelector('.hc-o-bubble--talk'), null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(400);
  },
  async 'coffee-bar-morning'(page) {
    await open(page, 'at=09:52');
    await page.evaluate(() => window.office.walkTo('cafe'));
    await page.waitForTimeout(8000);
    await facesLoaded(page);
  },
  async 'huddle-card'(page) {
    await open(page, 'at=10:35');
    await waitHuddle(page, "h.spot === 'water_cooler'");
    await frameHuddle(page, "h.spot === 'water_cooler'");
    await facesLoaded(page);
    await page.waitForTimeout(3500);
    const c = await ringCenter(page);
    if (c) {
      await page.mouse.move(c.x, c.y + 120, { steps: 4 });
      await page.mouse.move(c.x, c.y, { steps: 8 });
    }
    await page.waitForTimeout(900);
  },
  async 'joined-huddle'(page) {
    await open(page, 'at=10:35&owner=Dana');
    await waitHuddle(page, "h.spot === 'water_cooler'");
    await frameHuddle(page, "h.spot === 'water_cooler'");
    await facesLoaded(page);
    const c = await ringCenter(page);
    if (c) {
      await page.mouse.move(c.x, c.y + 120, { steps: 4 });
      await page.mouse.move(c.x, c.y, { steps: 8 });
    }
    await page.waitForTimeout(900);
    await page.evaluate(() => [...document.querySelectorAll('.hc-o-hcard .hc-o-btn')].find((b) => b.textContent === 'Join')?.click());
    await page.waitForTimeout(900);
    await page.focus('.hc-o-hcard__input').catch(() => {});
    await page.keyboard.type('Quick one: what should we try next week?', { delay: 15 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1600);
  },
  async 'whats-happening'(page) {
    await open(page, 'at=10:36');
    await page.waitForTimeout(9000);
    await page.click('.hc-o-life__pill');
    await page.waitForTimeout(400);
    await page.mouse.move(700, 850);
  },
  async 'follow-chip'(page) {
    await open(page, 'at=10:36');
    await page.evaluate(() => window.office.zoomTo(3.2, { x: 440, y: 120 }));
    await page.waitForFunction(() => [...document.querySelectorAll('.hc-o-seat[data-walking]')].some((b) => { const r = b.getBoundingClientRect(); return r.x > 100 && r.x < innerWidth - 100 && r.y > 100 && r.y < innerHeight - 100; }), null, { timeout: 90000 }).catch(() => {});
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('.hc-o-seat[data-walking]')].find((b) => { const r = b.getBoundingClientRect(); return r.x > 100 && r.x < innerWidth - 100 && r.y > 100 && r.y < innerHeight - 100; });
      if (b) window.office.follow(b.dataset.pid);
    });
    await page.waitForTimeout(2500);
    await facesLoaded(page);
  },
  async 'override-working'(page) {
    // Someone on a break starts real work: they walk back briskly and their monitor lights up. Three frames.
    await open(page, 'at=10:35');
    await page.waitForTimeout(2500);
    const pick = await page.evaluate(() => {
      const plan = window.office.getPlan();
      let best = null;
      for (const seat of plan.seats) {
        if (!seat.personId) continue;
        const p = window.office.placeOf(seat.personId);
        if (p.place.kind !== 'spot' || p.walking) continue;
        const d = Math.hypot(p.x - seat.x, p.y - seat.y);
        if (d < 70 || d > 220) continue;
        if (!best || Math.abs(d - 140) < Math.abs(best.d - 140)) best = { id: seat.personId, d, x: (p.x + seat.x) / 2, y: (p.y + seat.y) / 2 };
      }
      if (!best) return null;
      window.office.zoomTo(Math.min(3.4, 1100 / (best.d * 1.3 + 60)), { x: best.x, y: best.y * 0.82 - 4 });
      return best;
    });
    if (!pick) return log('  nobody on a break near their desk');
    await page.waitForTimeout(1200);
    await facesLoaded(page);
    const frames = [];
    const f = async (caption) => {
      const path = resolve(tmp, `override-${frames.length}.png`);
      await page.screenshot({ path, clip: { x: 270, y: 150, width: 900, height: 600 } });
      frames.push({ path, caption });
    };
    const name = await page.evaluate((id) => window.office.nameOf(id).split(' ')[0], pick.id);
    await f(`${name} on a break (available)`);
    await page.evaluate((id) => window.office.setPresence(id, 'working', { label: 'Drafting the launch note' }), pick.id);
    await page.waitForTimeout(2600);
    await f('Real work starts: after 1.5 s of hysteresis, a brisk walk back');
    await page.waitForTimeout(5000);
    await f('At the desk: the monitor glows in their accent; the status says what they do');
    await contactSheet('override-working', frames, 3, 'Real work overrides the ambient plan (O1)', 540);
    return 'sheet';
  },
  async 'night-floor'(page) {
    await open(page, 'at=23:12&frame=0');
    await page.waitForTimeout(7000);
  },
  async 'night-windows'(page) {
    await open(page, 'at=23:12');
    await page.evaluate(() => window.office.zoomTo(3.0, { x: 440, y: 40 }));
    await page.waitForTimeout(6000);
    await facesLoaded(page);
  },
  async 'quiet-vs-buzzing'(page) {
    const frames = [];
    for (const amb of ['quiet', 'lively', 'buzzing']) {
      await open(page, `at=10:40&amb=${amb}&frame=0`);
      await page.evaluate(() => window.office.zoomTo(2.7, { x: 430, y: 140 }));
      await page.waitForTimeout(8000);
      await facesLoaded(page);
      const path = resolve(tmp, `amb-${amb}.png`);
      await page.screenshot({ path, clip: { x: 160, y: 120, width: 1120, height: 700 } });
      const s = await page.evaluate(() => document.querySelector('.hc-o-life__pill')?.textContent ?? '');
      frames.push({ path, caption: `${amb[0].toUpperCase()}${amb.slice(1)} · ${s}` });
    }
    await contactSheet('quiet-vs-buzzing', frames, 3, 'Ambience scales the energy (same floor, same minute): Quiet · Lively · Buzzing', 620);
    return 'sheet';
  },
  async 'reduced-motion-fade'(page) {
    await open(page, 'at=10:35&rm=1');
    await page.evaluate(() => window.office.zoomTo(3.2, { x: 440, y: 130 }));
    await page.waitForTimeout(1500);
    await facesLoaded(page);
    // A move under reduced motion: fade out (160 ms), move, fade in (160 ms). Five frames, 80 ms apart.
    const id = await page.evaluate(() => {
      const seats = [...document.querySelectorAll('.hc-o-seat[data-face]:not([data-away]):not([data-walking])')].filter((b) => { const r = b.getBoundingClientRect(); return r.x > 300 && r.x < 1100 && r.y > 200 && r.y < 700; });
      return seats[0]?.dataset.pid ?? null;
    });
    const frames = [];
    await page.evaluate((id) => window.office.moveTo(id, { kind: 'spot', spotId: 'cafe:high', slot: 0 }, { pace: 'instant' }), id);
    for (let i = 0; i < 5; i++) {
      const path = resolve(tmp, `rm-${i}.png`);
      await page.screenshot({ path, clip: { x: 300, y: 150, width: 840, height: 560 } });
      frames.push({ path, caption: `+${i * 80} ms` });
      await page.waitForTimeout(80);
    }
    await contactSheet('reduced-motion-fade', frames, 5, 'Reduced motion: a 160 ms fade out, an instant move, a 160 ms fade in (no walking)', 380);
    return 'sheet';
  },
  async 'mobile-375-life'(page) {
    await open(page, 'at=10:35');
    await page.waitForTimeout(6000);
    await facesLoaded(page);
  },
  async 'walk-frames'(page) {
    // A walk at ~10 fps under a still camera at L1: easing, rounded corners, keep-right lanes, facing.
    await open(page, 'at=10:36');
    const target = await page.evaluate(() => {
      const plan = window.life.plan();
      const office = window.office;
      const now = window.demo.demoNow().getTime();
      const seats = new Map(office.getPlan().seats.map((s) => [s.personId, s]));
      let best = null;
      for (const [id, list] of Object.entries(plan.segments)) {
        const seat = seats.get(id);
        if (!seat) continue;
        for (const g of list) {
          const spot = office.spots().find((s) => s.id === g.place.spotId);
          const d = Math.abs(spot.center.x - seat.x) + Math.abs(spot.center.y - seat.y);
          // A walk long enough to read as a walk and short enough to frame: the soonest, preferring ~200 units.
          const score = (g.departAt - now) / 1000 + Math.abs(d - 200) / 4;
          if (g.departAt > now + 5000 && g.departAt < now + 150000 && d > 90 && d < 300 && (!best || score < best.score)) best = { id, at: g.departAt, spot: g.place.spotId, a: { x: seat.x, y: seat.y }, b: spot.center, d, score };
        }
      }
      if (!best) return null;
      const zoom = Math.max(2.6, Math.min(3.0, 640 / best.d));
      const x = (best.a.x + best.b.x) / 2;
      const y = ((best.a.y + best.b.y) / 2) * 0.82 - 4;
      office.zoomTo(zoom, { x, y });
      const toS = (p) => ({ x: (p.x - x) * zoom + innerWidth / 2, y: (p.y * 0.82 - 6 - y) * zoom + innerHeight / 2 });
      const A = toS(best.a);
      const B = toS(best.b);
      const x0 = Math.max(0, Math.min(A.x, B.x) - 90);
      const y0 = Math.max(0, Math.min(A.y, B.y) - 90);
      const x1 = Math.min(innerWidth, Math.max(A.x, B.x) + 90);
      const y1 = Math.min(innerHeight, Math.max(A.y, B.y) + 90);
      return { ...best, name: office.nameOf(best.id), wait: best.at - now, clip: { x: Math.round(x0), y: Math.round(y0), width: Math.round(x1 - x0), height: Math.round(y1 - y0) } };
    });
    if (!target) return log('  no walk found');
    await facesLoaded(page);
    await page.waitForTimeout(Math.max(0, target.wait - 600));
    const frames = [];
    for (let i = 0; i < 70; i++) {
      const t = Date.now();
      const path = resolve(tmp, `walk-${i}.png`);
      await page.screenshot({ path, clip: target.clip });
      frames.push({ path, caption: `${(i / 10).toFixed(1)} s` });
      await page.waitForTimeout(Math.max(0, 100 - (Date.now() - t)));
    }
    const cellW = Math.min(360, Math.round((target.clip.width / target.clip.height) * 200));
    await contactSheet('walk-frames', frames.filter((_, i) => i % 2 === 0), 7, `A walk, every other frame at ~10 fps (still camera, L1): ${target.name} → ${target.spot}`, cellW);
    return 'sheet';
  },
  async 'huddle-frames'(page) {
    // One exchange, one frame a second: one bubble at a time, reading-time turns, a laugh beat.
    await open(page, 'at=10:35');
    await waitHuddle(page, "h.spot === 'water_cooler'");
    await frameHuddle(page, "h.spot === 'water_cooler'", 3.8);
    await facesLoaded(page);
    const frames = [];
    for (let i = 0; i < 18; i++) {
      const t = Date.now();
      const path = resolve(tmp, `huddle-${i}.png`);
      await page.screenshot({ path, clip: { x: 420, y: 230, width: 600, height: 420 } });
      frames.push({ path, caption: `${i} s` });
      await page.waitForTimeout(Math.max(0, 1000 - (Date.now() - t)));
    }
    await contactSheet('huddle-frames', frames, 6, 'A water-cooler exchange, one frame a second (turn-taking, reading time, laugh beat)', 300);
    return 'sheet';
  },
  async 'over-time'(page) {
    // The same view every 20 s of demo time (the demo clock at 4×): the floor breathes.
    await open(page, 'at=10:30&speed=4&frame=0');
    await page.evaluate(() => window.office.zoomTo(2.75, { x: 440, y: 132 }));
    await page.waitForTimeout(1500);
    await facesLoaded(page);
    const frames = [];
    for (let i = 0; i < 12; i++) {
      const t = Date.now();
      const path = resolve(tmp, `time-${i}.png`);
      await page.screenshot({ path });
      const clock = await page.evaluate(() => window.demo.demoNow().toTimeString().slice(0, 8));
      const pill = await page.evaluate(() => document.querySelector('.hc-o-life__pill')?.textContent ?? '');
      frames.push({ path, caption: `${clock} · ${pill}` });
      await page.waitForTimeout(Math.max(0, 5000 - (Date.now() - t)));
    }
    await contactSheet('over-time', frames, 4, 'Four minutes on the floor (demo clock 4×, walks at real speed)', 420);
    return 'sheet';
  },
};

const viewports = { 'mobile-375-life': { width: 375, height: 812 } };
const dsf = { 'walk-frames': 1, 'huddle-frames': 1, 'over-time': 1, 'quiet-vs-buzzing': 1, 'override-working': 1, 'reduced-motion-fade': 1 };

for (const [name, fn] of Object.entries(shots)) {
  if (only.length && !only.includes(name)) continue;
  const vp = viewports[name] ?? { width: 1440, height: 900 };
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: dsf[name] ?? 2, colorScheme: 'dark' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !/portraits|Failed to load resource/.test(m.text()) && errors.push(m.text()));
  const t0 = Date.now();
  const r = await fn(page);
  if (r !== 'sheet') await shot(page, name);
  log(`${name}.jpg ${Date.now() - t0} ms${errors.length ? `  errors: ${errors.slice(0, 3).join(' | ')}` : ''}`);
  await ctx.close();
}
await browser.close();
rmSync(tmp, { recursive: true, force: true });
