// Office life probes, with real input in Chromium against the demo.
//   node packages/office/demo/check-life.mjs [--url http://127.0.0.1:5871]
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const i = args.indexOf('--url');
const base = i >= 0 ? args[i + 1] : 'http://127.0.0.1:5871';
const day = '2026-09-29';
const browser = await chromium.launch();
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const errors = [];
async function open(query, vp = { width: 1440, height: 900 }) {
  const page = await browser.newPage({ viewport: vp });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !/portraits|Failed to load resource/.test(m.text()) && errors.push(m.text()));
  await page.goto(`${base}/?panel=0&day=${day}&recency=0&${query}`);
  await page.waitForFunction(() => document.documentElement.dataset.ready === '1' && document.documentElement.dataset.life === '1' && window.life.plan(), null, { timeout: 30000 });
  await page.waitForTimeout(800);
  return page;
}
const visibleWalkers = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.hc-o-seat[data-walking]')].filter((b) => {
      const r = b.querySelector('.hc-o-seat__hit').getBoundingClientRect();
      return r.x > -50 && r.x < innerWidth + 50 && r.y > -50 && r.y < innerHeight + 50;
    }).length,
  );
const countRaf = (page, ms) =>
  page.evaluate(async (ms) => {
    let n = 0;
    const orig = window.requestAnimationFrame;
    window.requestAnimationFrame = (cb) => {
      n++;
      return orig(cb);
    };
    await new Promise((r) => setTimeout(r, ms));
    window.requestAnimationFrame = orig;
    return n;
  }, ms);

// 0. Opening: L1 on the liveliest neighbourhood, and the huddles there talk at once.
{
  const page = await open('at=10:36');
  const t0 = Date.now();
  await page.waitForFunction(() => document.querySelector('.hc-o-bubble--talk:not(.is-leaving)'), null, { timeout: 8000 }).catch(() => {});
  const s = await page.evaluate(() => ({ lod: window.office.getState().lod, bubble: !!document.querySelector('.hc-o-bubble--talk') }));
  check('the office opens at L1 on a lively place and talks within seconds', s.lod === 1 && s.bubble, `lod ${s.lod}, first bubble after ${Date.now() - t0} ms`);
  // The café at L1: a bubble on screen at least a quarter of the time.
  await page.evaluate(() => {
    const sp = window.office.spots().find((x) => x.id === 'cafe:counter');
    window.office.zoomTo(3.4, { x: sp.center.x, y: sp.center.y * 0.82 - 6 });
  });
  await page.waitForTimeout(1200);
  let n = 0;
  let hit = 0;
  for (let k = 0; k < 120; k++) {
    n++;
    if (await page.evaluate(() => [...document.querySelectorAll('.hc-o-bubble--talk:not(.is-leaving)')].some((b) => b.style.visibility !== 'hidden'))) hit++;
    await page.waitForTimeout(250);
  }
  check('the water cooler and coffee bar talk: a bubble on screen ≥ 25 % of the time at L1', hit / n >= 0.25, `${Math.round((100 * hit) / n)} % of ${n} samples`);
  const pe = await page.evaluate(() => {
    const talk = document.querySelector('.hc-o-bubble--talk .hc-o-bubble__in');
    return talk ? getComputedStyle(talk).pointerEvents : 'none';
  });
  check('small-talk bubbles never swallow a click', pe === 'none', pe);
  await page.close();
}

// 1. The floor lives: people are away and walking; a huddle forms; the pill says so.
{
  const page = await open('at=10:35');
  await page.waitForTimeout(4000);
  const s = await page.evaluate(() => ({ away: document.querySelectorAll('.hc-o-seat[data-away]').length, pill: document.querySelector('.hc-o-life__pill')?.textContent, huddles: window.life.huddles().length }));
  check('the office runs itself: people are away from their desks, a huddle is on', s.away >= 8 && s.huddles >= 1, JSON.stringify(s));
  check("What's happening pill reports it (on a break, never away)", /huddle/.test(s.pill ?? '') && /on a break/.test(s.pill ?? '') && !/away/.test(s.pill ?? ''), s.pill);

  // 2. Hovering a huddle opens its card within the dwell; Join greets the owner by name; Esc leaves.
  await page.evaluate(() => {
    const h = window.life.huddles()[0];
    const ps = h.members.map((id) => window.office.placeOf(id));
    const x = ps.reduce((a, p) => a + p.x, 0) / ps.length;
    const y = ps.reduce((a, p) => a + p.y, 0) / ps.length;
    window.office.zoomTo(3.6, { x, y: y * 0.82 - 4 });
  });
  await page.waitForTimeout(1200);
  const ring = await page.evaluate(() => {
    const r = document.querySelector('.hc-o-huddle__ring').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.move(ring.x, ring.y + 150, { steps: 3 });
  await page.mouse.move(ring.x, ring.y, { steps: 6 });
  await page.waitForTimeout(650);
  check('hovering a huddle shows its card (Join, Listen)', await page.evaluate(() => !document.querySelector('.hc-o-hcard').hidden && /Join/.test(document.querySelector('.hc-o-hcard').textContent)));
  await page.keyboard.press('l');
  await page.waitForTimeout(200);
  check('L listens in to the hovered huddle (the host key)', await page.evaluate(() => !!window.life.getState().listening));
  const joinBtn = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.hc-o-hcard .hc-o-btn')].find((x) => x.textContent === 'Join').getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
  await page.mouse.click(joinBtn.x, joinBtn.y);
  await page.waitForTimeout(1100);
  const greet = await page.evaluate(() => [...document.querySelectorAll('.hc-o-bubble:not(.hc-o-bubble--talk)')].map((b) => b.textContent).join(' | '));
  check('Join: the group greets the owner by name and the card becomes a chat', /Dana/.test(greet) && !!(await page.$('.hc-o-hcard__input')), greet);
  check('Join puts the owner straight into the chat field', await page.evaluate(() => document.activeElement?.classList.contains('hc-o-hcard__input') ?? false));
  const members = await page.evaluate(() => window.life.huddles().find((h) => h.joined)?.members ?? []);
  await page.waitForTimeout(4000);
  const stayed = await page.evaluate((ids) => ids.every((id) => window.life.whereIs(id).kind !== 'walking'), members);
  check('a joined huddle stays together (held by the owner)', stayed && members.length >= 2, members.join(', '));
  await page.focus('.hc-o-hcard__input');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check('Esc leaves the joined huddle', await page.evaluate(() => window.life.getState().joined === null));
  await page.close();
}

// 3. Clicking a walker opens them at once and they stop (the owner comes first).
{
  const page = await open('at=10:36');
  await page.evaluate(() => window.office.zoomTo(3.0, { x: 440, y: 120 }));
  let target = null;
  for (let k = 0; k < 60 && !target; k++) {
    await page.waitForTimeout(500);
    target = await page.evaluate(() => {
      const b = [...document.querySelectorAll('.hc-o-seat[data-walking]')].find((b) => {
        const r = b.querySelector('.hc-o-seat__face').getBoundingClientRect();
        return r.width > 10 && r.x > 150 && r.x < innerWidth - 150 && r.y > 150 && r.y < innerHeight - 150;
      });
      if (!b) return null;
      const r = b.querySelector('.hc-o-seat__face').getBoundingClientRect();
      return { id: b.dataset.pid, x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
  }
  if (target) {
    const t0 = Date.now();
    await page.mouse.move(target.x, target.y);
    await page.mouse.down();
    await page.mouse.up();
    const opened = await page.evaluate(() => document.getElementById('log').textContent);
    await page.waitForTimeout(600);
    const stopped = await page.evaluate((id) => !document.querySelector(`.hc-o-seat[data-pid="${id}"]`).hasAttribute('data-walking'), target.id);
    check('clicking a walker opens them and the walker stops within 0.5 s', /Open .*click/.test(opened) && stopped, `${opened} · ${Date.now() - t0} ms`);
    await page.keyboard.press('f');
    await page.waitForTimeout(700);
    check('F follows the focused person (Following chip)', await page.evaluate(() => !document.querySelector('.hc-o-follow').hidden && /Following/.test(document.querySelector('.hc-o-follow').textContent)));
    // Followed, they walk on (the quick chat closes, the camera keeps up): never frozen in the aisle.
    await page.mouse.move(40, 860);
    await page.waitForTimeout(6000);
    const w = await page.evaluate((id) => ({ state: window.life.whereIs(id).state, kind: window.life.whereIs(id).kind, following: window.office.getState().followingId }), target.id);
    check('a followed walker is not held: they go on to their spot with the camera', w.state !== 'held' && w.following === target.id, JSON.stringify(w));
    await page.keyboard.press('Escape');
  } else check('clicking a walker opens them and the walker stops within 0.5 s', false, 'no walker in view');
  await page.close();
}

// 4. Caps and budgets at Buzzing: ≤ 3 small-talk bubbles on screen, one per huddle; pan stays smooth.
{
  const page = await open('at=10:36&amb=buzzing');
  await page.evaluate(() => window.office.zoomTo(3.0, { x: 440, y: 150 }));
  let maxTalk = 0;
  let maxPerHuddle = 0;
  for (let k = 0; k < 40; k++) {
    await page.waitForTimeout(500);
    const s = await page.evaluate(() => {
      const talk = [...document.querySelectorAll('.hc-o-bubble--talk:not(.is-leaving)')];
      return { n: talk.length };
    });
    maxTalk = Math.max(maxTalk, s.n);
    const st = await page.evaluate(() => window.life.getState());
    maxPerHuddle = Math.max(maxPerHuddle, st.walkers > st.caps.walkers ? 99 : 0);
  }
  check('never chaotic: ≤ 3 small-talk bubbles on screen, walkers within the cap', maxTalk <= 3 && maxPerHuddle === 0, `max ${maxTalk} bubbles`);
  // Pan with life at Buzzing (L1, faces mounted).
  await page.evaluate(() => {
    window.__frames = [];
    let last = performance.now();
    window.__run = true;
    const loop = (t) => {
      window.__frames.push(t - last);
      last = t;
      if (window.__run) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
  await page.mouse.move(1100, 500);
  await page.mouse.down();
  for (let k = 0; k < 60; k++) await page.mouse.move(1100 - k * 12, 500 + Math.sin(k / 6) * 40);
  await page.mouse.up();
  await page.waitForTimeout(1500);
  const f = await page.evaluate(() => {
    window.__run = false;
    const a = window.__frames.slice(2).sort((x, y) => x - y);
    return { p50: a[Math.floor(a.length / 2)], p95: a[Math.floor(a.length * 0.95)], n: a.length, faces: document.querySelectorAll('.hc-o-seat[data-face]').length };
  });
  check('pan p95 ≤ 20 ms with life at Buzzing', f.p95 <= 20, `p50 ${f.p50.toFixed(1)} ms, p95 ${f.p95.toFixed(1)} ms, ${f.faces} faces`);
  await page.close();
}

// 5. Zero rAF when no walker is in view (off-screen walkers are not animated), and no timers while hidden.
{
  const page = await open('at=10:36&amb=buzzing');
  await page.evaluate(() => window.office.walkTo('chief'));
  // Let the camera's flight (600 ms) finish first: its last frames are not life's.
  await page.waitForTimeout(1000);
  let rafs = -1;
  for (let k = 0; k < 40; k++) {
    await page.waitForTimeout(500);
    if ((await visibleWalkers(page)) > 0) continue;
    const walkers = await page.evaluate(() => window.life.getState().walkers);
    if (walkers === 0) continue;
    const n = await countRaf(page, 2000);
    if ((await visibleWalkers(page)) > 0) continue;
    rafs = n;
    check('zero rAF for 2 s with no walker in view (while others walk off-screen)', n === 0, `${n} frames, ${walkers} walking elsewhere`);
    break;
  }
  if (rafs < 0) check('zero rAF for 2 s with no walker in view (while others walk off-screen)', false, 'a walker was always in view');
  // Hidden page: life suspends (no timers), and resumes on return.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  check('a hidden page suspends office life', await page.evaluate(() => window.life.getState().suspended));
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  check('it resumes when the page is visible again', await page.evaluate(() => !window.life.getState().suspended));
  // Scrolled off-screen (IntersectionObserver).
  await page.evaluate(() => (document.getElementById('office').style.transform = 'translateY(3000px)'));
  await page.waitForTimeout(400);
  check('an office scrolled off-screen suspends office life', await page.evaluate(() => window.life.getState().suspended));
  await page.evaluate(() => (document.getElementById('office').style.transform = ''));
  await page.waitForTimeout(400);
  check('and resumes when it is back in view', await page.evaluate(() => !window.life.getState().suspended));
  await page.close();
}

// 6. Reduced motion: people fade between places, never walk; autopilot refuses.
{
  const page = await open('at=10:36&rm=1');
  await page.evaluate(() => window.office.zoomTo(2.6, { x: 440, y: 150 }));
  let walked = 0;
  let faded = 0;
  for (let k = 0; k < 40; k++) {
    await page.waitForTimeout(250);
    const s = await page.evaluate(() => ({ w: [...document.querySelectorAll('.hc-o-seat[data-walking]:not([data-fade])')].length, f: document.querySelectorAll('.hc-o-seat[data-fade]').length }));
    walked = Math.max(walked, s.w);
    faded = Math.max(faded, s.f);
  }
  await page.evaluate(() => window.office.setAutopilot(true));
  check('reduced motion: moves fade, nobody walks; autopilot stays off', walked === 0 && !(await page.evaluate(() => window.office.getState().autopilot)), `${faded} fading at most, ${walked} walking`);
  await page.close();
}

// 7. Pause office life (the WCAG 2.2.2 control): no new walks.
{
  const page = await open('at=10:36&speed=4');
  await page.click('.hc-o-life__pill');
  await page.waitForTimeout(200);
  await page.evaluate(() => [...document.querySelectorAll('.hc-o-life__switch')].find((l) => /Pause/.test(l.textContent)).querySelector('input').click());
  await page.waitForTimeout(18000);
  const s = await page.evaluate(() => ({ paused: window.life.getState().paused, walkers: window.life.getState().walkers, pill: document.querySelector('.hc-o-life__pill').textContent }));
  check('Pause office life freezes the floor (current walks finish, none start)', s.paused && s.walkers === 0 && /paused/i.test(s.pill), JSON.stringify(s));
  await page.close();
}

// 8. Phones: the pill collapses to a dot; life runs within the phone caps.
{
  const page = await open('at=10:35', { width: 375, height: 812 });
  await page.waitForTimeout(3000);
  const s = await page.evaluate(() => {
    const pill = document.querySelector('.hc-o-life__pill');
    const r = pill.getBoundingClientRect();
    return { dot: getComputedStyle(pill.querySelector('span')).display, cap: window.life.getState().caps.walkers, label: pill.getAttribute('aria-label'), w: Math.round(r.width), h: Math.round(r.height) };
  });
  check('phones: the pill is a named 44 px dot and walkers are capped for phones', s.dot === 'none' && s.cap <= 5 && /^What's happening: /.test(s.label ?? '') && s.w >= 44 && s.h >= 44, JSON.stringify(s));
  // One overlay at a time: the What's happening sheet closes the huddle card.
  const hud = await page.evaluate(() => window.life.huddles()[0]?.id ?? null);
  if (hud) {
    await page.evaluate((id) => document.querySelector(`.hc-o-huddle[data-id="${id}"]`)?.click(), hud);
    await page.waitForTimeout(200);
    await page.click('.hc-o-life__pill');
    await page.waitForTimeout(200);
    const o = await page.evaluate(() => ({ card: !document.querySelector('.hc-o-hcard').hidden, sheet: !document.querySelector('.hc-o-life__pop').hidden }));
    check('phones: the sheet never stacks on the huddle card', o.sheet && !o.card, JSON.stringify(o));
  }
  await page.close();
}

// 9. Slow CPUs (4×): idle frames with walkers in view stay smooth at L1 and at plan zoom.
for (const q of ['at=11:20&amb=buzzing', 'at=11:20&amb=buzzing&frame=0']) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const cdp = await page.context().newCDPSession(page);
  await page.goto(`${base}/?panel=0&day=${day}&recency=0&${q}`);
  await page.waitForFunction(() => document.documentElement.dataset.ready === '1' && window.life?.plan(), null, { timeout: 30000 });
  await page.waitForTimeout(3000);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const f = await page.evaluate(async () => {
    const d = [];
    let last = performance.now();
    await new Promise((res) => {
      const loop = (t) => {
        d.push(t - last);
        last = t;
        if (d.length < 200) requestAnimationFrame(loop);
        else res();
      };
      requestAnimationFrame(loop);
    });
    const a = d.slice(2).sort((x, y) => x - y);
    return { p95: a[Math.floor(a.length * 0.95)], janky: a.filter((x) => x > 25).length, lod: window.office.getState().lod, walkers: window.life.getState().walkers };
  });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  check(`4× CPU idle frames at L${f.lod} with life at Buzzing: p95 ≤ 20 ms`, f.p95 <= 20, `p95 ${f.p95.toFixed(1)} ms, ${f.janky} janky, ${f.walkers} walking`);
  await page.close();
}

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
