// Screenshots of the Office demo for review. Needs the demo server (vite.config.mjs) running.
//   node packages/office/demo/shoot.mjs [--only name,name] [--out docs/dev/screens/office] [--url http://127.0.0.1:5870]
//     [--format jpeg|png]  (JPEG q88 at 2× by default: sharp, and ~0.5 MB per screen)
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const out = resolve(repo, opt('out', 'docs/dev/screens/office'));
const base = opt('url', 'http://127.0.0.1:5870');
const only = opt('only', '')?.split(',').filter(Boolean) ?? [];
const format = opt('format', 'jpeg') === 'png' ? 'png' : 'jpeg';
const ext = format === 'png' ? 'png' : 'jpg';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();

async function open(page, query) {
  await page.goto(`${base}/?panel=0&life=0&${query}`, { waitUntil: "load" });
  await page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 20000 });
  // The sky image (or the vector fallback) is in.
  await page.waitForFunction(() => !!document.querySelector('.hc-o-sky__v.is-loaded, .hc-o-sky__v[data-fallback]'), null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(400);
}

async function facesLoaded(page) {
  await page
    .waitForFunction(
      () => [...document.querySelectorAll('.hc-o-seat[data-face] img, .hc-o-sseat img')].every((i) => i.complete),
      null,
      { timeout: 15000 },
    )
    .catch(() => {});
  await page.waitForTimeout(350);
}

/** The screen point of a visible seat element nearest a fraction of the viewport. */
async function seatPoint(page, cls, fx, fy) {
  return page.evaluate(
    ({ cls, fx, fy }) => {
      const tx = innerWidth * fx;
      const ty = innerHeight * fy;
      let best = null;
      for (const e of document.querySelectorAll(`.hc-o-seat .${cls}`)) {
        const r = e.getBoundingClientRect();
        if (!r.width) continue;
        const x = r.x + r.width / 2;
        const y = r.y + r.height / 2;
        const d = Math.hypot(x - tx, y - ty);
        if (!best || d < best.d) best = { x, y, d };
      }
      return best;
    },
    { cls, fx, fy },
  );
}

const shots = {
  async 'desk-wide-night'(page) {
    await open(page, 'tod=night');
  },
  async 'desk-zoomed'(page) {
    await open(page, 'tod=night');
    await page.evaluate(() => {
      const o = window.office;
      o.walkTo('marketing-growth');
    });
    await page.waitForTimeout(900);
    await facesLoaded(page);
  },
  async 'desk-close'(page) {
    await open(page, 'tod=night');
    await page.evaluate(() => {
      const o = window.office;
      o.focus('chief-strategist', { zoom: 'desk', animate: false });
      o.zoomTo(6.2);
    });
    await page.waitForTimeout(900);
    await facesLoaded(page);
  },
  async 'hover-bubble'(page) {
    await open(page, 'tod=night');
    await page.evaluate(() => window.office.walkTo('design-creative'));
    await page.waitForTimeout(900);
    await facesLoaded(page);
    const box = await page.evaluate(() => {
      const seats = [...document.querySelectorAll('.hc-o-seat[data-face]')];
      const vw = innerWidth / 2;
      const vh = innerHeight / 2;
      seats.sort((a, b) => {
        const ra = a.querySelector('.hc-o-seat__face').getBoundingClientRect();
        const rb = b.querySelector('.hc-o-seat__face').getBoundingClientRect();
        return Math.hypot(ra.x - vw, ra.y - vh) - Math.hypot(rb.x - vw, rb.y - vh);
      });
      const r = seats[0].querySelector('.hc-o-seat__face').getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await page.mouse.move(box.x - 40, box.y - 40);
    await page.mouse.move(box.x, box.y, { steps: 6 });
    await page.waitForTimeout(1100);
  },
  async 'conference-5'(page) {
    await open(page, 'tod=night');
    await page.evaluate(() => window.office.enterRoom('skyline', window.demo.pickPeople(5, 11)));
    await page.waitForTimeout(2600);
    await page.evaluate(() => {
      const o = window.office;
      const ids = o.getState().participants;
      o.setFloorQueue(ids.slice(2, 4));
      o.setSpeaking(ids[1], true);
      o.showCaption(ids[1], 'Then lead with the reorder rate: it went up nine points after the relaunch.', { voiced: true });
    });
    await page.waitForTimeout(700);
    await facesLoaded(page);
  },
  async 'conference-walk'(page) {
    // Desk mode: five coworkers walk along the aisles into the Skyline room and take seats at the table.
    await open(page, 'tod=night');
    await page.evaluate(() => {
      const o = window.office;
      for (const id of window.demo.pickPeople(5, 11)) o.seat(id, 'skyline');
      o.zoomTo(5.2, { x: 60, y: 30 });
    });
    await page.waitForTimeout(2600);
    await facesLoaded(page);
  },
  async 'walking'(page) {
    await open(page, 'tod=night');
    await page.evaluate(() => {
      const o = window.office;
      o.zoomTo(2.6, { x: 190, y: 70 });
    });
    await page.waitForTimeout(700);
    await page.evaluate(() => {
      const o = window.office;
      for (const id of window.demo.pickPeople(5, 11)) o.seat(id, 'skyline');
    });
    await page.waitForTimeout(650);
  },
  async 'conference-garden'(page) {
    await open(page, 'tod=night');
    await page.evaluate(() => window.office.enterRoom('garden', window.demo.pickPeople(4, 23)));
    await page.waitForTimeout(2600);
    await page.evaluate(() => {
      const o = window.office;
      const ids = o.getState().participants;
      o.setSpeaking(ids[2], true);
      o.showCaption(ids[2], 'I can have the one-pager with both numbers by tomorrow noon.', { voiced: false });
    });
    await facesLoaded(page);
  },
  async 'conference-picker'(page) {
    await open(page, 'tod=night');
    await page.evaluate(() => window.office.enterRoom('skyline', window.demo.pickPeople(2, 11)));
    await page.waitForTimeout(2400);
    await page.keyboard.press('i');
    await page.waitForTimeout(300);
    await page.fill('.hc-o-picker input[type=search]', 'design');
    await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.hc-o-picker__row:not([hidden]) input:not(:disabled)')].slice(0, 2);
      for (const r of rows) r.click();
    });
    await page.waitForTimeout(600);
    await facesLoaded(page);
  },
  async 'fallback-skyline'(page) {
    // No art and no keys: the procedural vector city.
    await open(page, 'tod=night&art=0');
  },
  async 'demo-panel'(page) {
    await page.goto(`${base}/?tod=night`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.documentElement.dataset.ready === '1');
    await page.waitForTimeout(900);
  },
  async 'tod-night'(page) {
    await open(page, 'tod=night');
  },
  async 'tod-dusk'(page) {
    await open(page, 'tod=dusk');
  },
  async 'tod-day'(page) {
    await open(page, 'tod=day');
  },
  async 'mobile-375'(page) {
    await open(page, 'tod=night');
    await facesLoaded(page);
  },
  async 'mobile-375-find'(page) {
    // Phones: Find is an icon that expands into the field over the HUD row.
    await open(page, 'tod=night');
    await page.click('.hc-o-find__btn');
    await page.keyboard.type('mar', { delay: 40 });
    await page.waitForTimeout(400);
    await facesLoaded(page);
  },
  async 'mobile-375-conference'(page) {
    await open(page, 'tod=night');
    await page.evaluate(() => window.office.enterRoom('skyline', window.demo.pickPeople(5, 11)));
    await page.waitForTimeout(2600);
    await page.evaluate(() => {
      const o = window.office;
      const ids = o.getState().participants;
      o.setSpeaking(ids[0], true);
      o.showCaption(ids[0], 'Brand love doesn’t move their Q2 number. Show me sell-through.', { voiced: true });
    });
    await facesLoaded(page);
  },
  async 'hover-l0'(page) {
    // Plan zoom: hover a seat and the name plate shows the full name.
    await open(page, 'tod=night');
    const p = await seatPoint(page, 'hc-o-seat__hit', 0.5, 0.45);
    await page.mouse.move(p.x - 30, p.y - 30);
    await page.mouse.move(p.x, p.y, { steps: 5 });
    await page.waitForTimeout(1100);
  },
  async 'a11y-focus-l0'(page) {
    await open(page, 'tod=night');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(400);
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(700);
  },
  async 'a11y-focus-desk'(page) {
    await open(page, 'tod=night');
    await page.evaluate(() => window.office.walkTo('marketing-growth'));
    await page.waitForTimeout(900);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);
    await page.evaluate(() => window.office.focus('chief-strategist', { zoom: 'keep', animate: false }));
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(900);
    await facesLoaded(page);
  },
  async 'walkto-menu'(page) {
    // The keyboard map works after a click on the floor: G opens Walk to.
    await open(page, 'tod=night');
    await page.mouse.click(720, 880);
    await page.waitForTimeout(300);
    await page.keyboard.press('g');
    await page.waitForTimeout(400);
  },
  async 'find-sam'(page) {
    await open(page, 'tod=night');
    await page.mouse.click(720, 880);
    await page.waitForTimeout(300);
    await page.keyboard.press('/');
    await page.keyboard.type('sam', { delay: 40 });
    await page.waitForTimeout(400);
  },
  async 'find-sam-enter'(page) {
    await open(page, 'tod=night');
    await page.mouse.click(720, 880);
    await page.keyboard.press('/');
    await page.keyboard.type('sam', { delay: 40 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1300);
    await facesLoaded(page);
  },
  async 'fit-1280x720'(page) {
    await open(page, 'tod=night');
  },
  async 'fit-1920x1080'(page) {
    await open(page, 'tod=night');
  },
  async 'chief-office'(page) {
    await open(page, 'tod=night');
    await page.evaluate(() => window.office.walkTo('chief'));
    await page.waitForTimeout(900);
    await facesLoaded(page);
  },
  async 'library'(page) {
    await open(page, 'tod=night');
    await page.evaluate(() => window.office.walkTo('library'));
    await page.waitForTimeout(900);
    await facesLoaded(page);
  },
  async 'desk-light'(page) {
    await open(page, 'tod=day&theme=light');
    await page.evaluate(() => window.office.walkTo('cafe'));
    await page.waitForTimeout(900);
    await facesLoaded(page);
  },
};

const viewports = {
  'mobile-375': { width: 375, height: 812 },
  'mobile-375-conference': { width: 375, height: 812 },
  'mobile-375-find': { width: 375, height: 812 },
  'fit-1280x720': { width: 1280, height: 720 },
  'fit-1920x1080': { width: 1920, height: 1080 },
};

for (const [name, fn] of Object.entries(shots)) {
  if (only.length && !only.includes(name)) continue;
  const vp = viewports[name] ?? { width: 1440, height: 900 };
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, colorScheme: 'dark' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const t0 = Date.now();
  await fn(page);
  await page.screenshot({ path: resolve(out, `${name}.${ext}`), type: format, ...(format === 'jpeg' ? { quality: 88 } : {}) });
  console.log(`${name}.${ext} ${Date.now() - t0} ms${errors.length ? `  errors: ${errors.slice(0, 3).join(' | ')}` : ''}`);
  await ctx.close();
}
await browser.close();
