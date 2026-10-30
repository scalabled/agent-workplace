// Interaction smoke test for the Office demo (real pointer, wheel and keyboard input in Chromium).
//   node packages/office/demo/check.mjs [--url http://127.0.0.1:5870]
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const i = args.indexOf('--url');
const base = i >= 0 ? args[i + 1] : 'http://127.0.0.1:5870';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const state = () => page.evaluate(() => window.office.getState());
const log = () => page.evaluate(() => document.getElementById('log')?.textContent ?? '');

// frame=0: life runs, but the office opens on its fit view (these checks measure the plan at fit).
await page.goto(`${base}/?panel=0&tod=night&frame=0`);
await page.waitForFunction(() => document.documentElement.dataset.ready === '1');
await page.waitForTimeout(500);

// Structure.
const counts = await page.evaluate(() => ({
  seats: document.querySelectorAll('.hc-o-seat').length,
  svgNodes: document.querySelector('svg.hc-o-plate').querySelectorAll('*').length,
  region: document.querySelector('.hc-office').getAttribute('aria-label'),
  tabbable: document.querySelectorAll('.hc-o-seat[tabindex="0"]').length,
}));
check('165 seat buttons (164 coworkers + the Chief)', counts.seats === 165, `${counts.seats}`);
check('plate SVG stays compact (≤ 3,500 nodes, repeated assets as <use>)', counts.svgNodes <= 3500, `${counts.svgNodes} nodes`);
check('one roving tab stop', counts.tabbable === 1);

// Review fixes: the keyboard map is live at load (keyTarget 'document' in the harness) and after a floor click.
await page.keyboard.press('g');
await page.waitForTimeout(200);
check('G at load opens Walk to', await page.evaluate(() => !document.querySelector('.hc-o-walk').hidden));
await page.keyboard.press('Escape');
await page.keyboard.press('/');
await page.waitForTimeout(150);
check('/ at load focuses Find', await page.evaluate(() => document.activeElement?.classList.contains('hc-o-input')));
await page.keyboard.press('Escape');
{
  const p2 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await p2.goto(`${base}/?panel=0&tod=night&keys=scene&frame=0`);
  await p2.waitForFunction(() => document.documentElement.dataset.ready === '1');
  await p2.waitForTimeout(300);
  await p2.mouse.click(720, 880);
  await p2.keyboard.press('g');
  await p2.waitForTimeout(200);
  const ok = await p2.evaluate(() => document.activeElement === document.querySelector('.hc-office') || !document.querySelector('.hc-o-walk').hidden);
  const open = await p2.evaluate(() => !document.querySelector('.hc-o-walk').hidden);
  check("keyTarget 'scene': a floor click focuses the office and G opens Walk to", ok && open);
  await p2.close();
}
const fit = await page.evaluate(() => {
  const sky = document.querySelector('.hc-o-sky');
  const cutY = parseFloat(getComputedStyle(sky).getPropertyValue('--o-sky-cut'));
  const beacons = [...document.querySelectorAll('.hc-o-beacon')];
  const hit = document.querySelector('.hc-o-seat__hit').getBoundingClientRect();
  const zone = document.querySelector('.hc-o-label--zone .hc-o-label__in');
  const chief = document.querySelector('.hc-o-seat[data-chief]').getAttribute('aria-label');
  return {
    cutY,
    plateTop: document.querySelector('svg.hc-o-plate').getBoundingClientRect().top,
    beacons: beacons.length,
    beaconAnim: beacons[0] ? getComputedStyle(beacons[0]).animationDuration : '',
    hit: Math.min(hit.width, hit.height),
    zoneFont: parseFloat(getComputedStyle(zone).fontSize),
    chiefTwice: (chief.match(/Chief of Staff/g) ?? []).length,
    font: getComputedStyle(document.querySelector('.hc-office')).fontFamily,
  };
});
check('the sky stops at the north floor line (void beside and under the plate)', fit.cutY > fit.plateTop && fit.cutY < fit.plateTop + 60, `cut ${fit.cutY.toFixed(0)} px, plate top ${fit.plateTop.toFixed(0)} px`);
check('at most 3 beacons on a slow 2.4 s fade', fit.beacons <= 3 && fit.beaconAnim === '2.4s', `${fit.beacons} beacons, ${fit.beaconAnim}`);
check('plan-zoom targets are at least 24 px', fit.hit >= 24, `${fit.hit.toFixed(1)} px`);
check('neighbourhood labels are at least 11 px at fit', fit.zoneFont >= 11, `${fit.zoneFont} px`);
check("the Chief's seat label says Chief of Staff once", fit.chiefTwice === 1);
check('the office uses the app font token (--font-sans first)', /Inter/.test(fit.font), fit.font.slice(0, 40));
{
  // L0 hover: the name plate shows the full name.
  const pt = await page.evaluate(() => {
    const r = [...document.querySelectorAll('.hc-o-seat__hit')].map((e) => e.getBoundingClientRect()).find((r) => r.x > 200 && r.x < 480 && r.y > 600);
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.move(pt.x - 40, pt.y - 40);
  await page.mouse.move(pt.x, pt.y, { steps: 4 });
  await page.waitForTimeout(250);
  const plate = await page.evaluate(() => {
    const n = document.querySelector('.hc-o-seat[data-hover] .hc-o-seat__name');
    return n ? { w: n.getBoundingClientRect().width, text: getComputedStyle(n, '::after').content } : null;
  });
  check('hovering a seat at plan zoom shows its full name', !!plate && plate.w > 30 && plate.text.split(' ').length > 1, JSON.stringify(plate));
  await page.mouse.move(700, 150);
  await page.waitForTimeout(700);
}
{
  // Focus is ink, never the speaking amber.
  await page.evaluate(() => document.querySelector('.hc-o-seat[tabindex="0"]').focus());
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(300);
  const ring = await page.evaluate(() => {
    const b = document.activeElement.closest('.hc-o-seat');
    return getComputedStyle(b.querySelector('.hc-o-seat__hit')).boxShadow;
  });
  // The demo's --ink is #eceae4 (236, 234, 228); the speaking lamp is #f2b450 (242, 180, 80).
  check('the focus ring is ink, not the speaking amber', /236, 234, 228/.test(ring) && !/242, 180, 80/.test(ring), ring);
  await page.keyboard.press('Escape');
}
{
  // Amenity plates stay from L1 as door plates.
  await page.evaluate(() => window.office.walkTo('cafe'));
  await page.waitForTimeout(900);
  const place = await page.evaluate(() => [...document.querySelectorAll('.hc-o-label--place .hc-o-label__in')].filter((e) => e.getBoundingClientRect().width > 20 && getComputedStyle(e).opacity === '1').length);
  check('amenity door plates show from L1', place >= 2, `${place} visible`);
  await page.evaluate(() => window.office.zoomTo('fit'));
  await page.waitForTimeout(700);
}

// Drag to pan.
let s0 = await state();
await page.mouse.move(700, 700);
await page.mouse.down();
await page.mouse.move(600, 690, { steps: 5 });
await page.mouse.move(500, 680, { steps: 5 });
await page.mouse.up();
await page.waitForTimeout(900);
let s1 = await state();
check('drag pans the camera', s1.camera.x > s0.camera.x + 20, `x ${s0.camera.x.toFixed(1)} → ${s1.camera.x.toFixed(1)}`);

// Frame times while panning at neighbourhood zoom with faces mounted (the perf probe).
await page.evaluate(() => window.office.zoomTo(3.2, { x: 440, y: 120 }));
await page.waitForTimeout(1200);
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
const frames = await page.evaluate(() => {
  window.__run = false;
  const f = window.__frames.slice(2).sort((a, b) => a - b);
  return { n: f.length, p50: f[Math.floor(f.length * 0.5)], p95: f[Math.floor(f.length * 0.95)], faces: document.querySelectorAll('.hc-o-seat[data-face]').length };
});
check('pan + inertia frame time p95 ≤ 20 ms', frames.p95 <= 20, `p50 ${frames.p50.toFixed(1)} ms, p95 ${frames.p95.toFixed(1)} ms over ${frames.n} frames, ${frames.faces} faces mounted`);
await page.keyboard.press('Escape');
await page.evaluate(() => window.office.zoomTo('fit'));
await page.waitForTimeout(700);
s0 = await state();

// Pinch-zoom (ctrl + wheel) around the pointer.
await page.mouse.move(720, 700);
for (let k = 0; k < 8; k++) await page.mouse.wheel(0, -40).then(() => page.keyboard.down('Control')).catch(() => {});
await page.keyboard.up('Control');
await page.evaluate(() => {
  const el = document.querySelector('.hc-office');
  for (let k = 0; k < 10; k++) el.dispatchEvent(new WheelEvent('wheel', { deltaY: -30, ctrlKey: true, clientX: 720, clientY: 700, bubbles: true, cancelable: true }));
});
await page.waitForTimeout(400);
s1 = await state();
check('ctrl+wheel zooms in', s1.camera.zoom > s0.camera.zoom * 1.5, `zoom ${s0.camera.zoom.toFixed(2)} → ${s1.camera.zoom.toFixed(2)}, lod ${s1.lod}`);

// Keyboard: fit, Home → Chief, arrows move along the bench.
await page.keyboard.press('0');
await page.waitForTimeout(600);
await page.evaluate(() => document.querySelector('.hc-o-seat[tabindex="0"]').focus());
await page.keyboard.press('Home');
await page.waitForTimeout(400);
s1 = await state();
check('Home focuses the Chief of Staff', s1.focusedId === 'lead-steady-operator', `${s1.focusedId}`);
await page.keyboard.press('ArrowDown');
await page.waitForTimeout(350);
const afterDown = (await state()).focusedId;
await page.keyboard.press('ArrowLeft');
await page.waitForTimeout(350);
const afterLeft = (await state()).focusedId;
check('arrow keys move between desks', !!afterDown && afterDown !== 'lead-steady-operator' && afterLeft !== afterDown, `${afterDown} → ${afterLeft}`);
await page.keyboard.press(']');
await page.waitForTimeout(350);
const afterZone = (await state()).focusedId;
check('] jumps to the next neighbourhood', !!afterZone && afterZone !== afterLeft, `${afterZone}`);
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
check('Enter opens the focused desk (onOpen via keyboard)', /\(keyboard, desks\)/.test(await log()), await log());

// Zoom to a neighbourhood and click a face.
await page.evaluate(() => window.office.walkTo('engineering'));
await page.waitForTimeout(1200);
const face = await page.evaluate(() => {
  const inView = (e) => {
    const r = e.querySelector('.hc-o-seat__face').getBoundingClientRect();
    return r.x > 200 && r.x < innerWidth - 300 && r.y > 150 && r.y < innerHeight - 150;
  };
  const b = [...document.querySelectorAll('.hc-o-seat[data-face]')].find(inView);
  const r = b.querySelector('.hc-o-seat__face').getBoundingClientRect();
  return { id: b.dataset.pid, x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
await page.mouse.move(face.x, face.y);
await page.mouse.down();
await page.mouse.up();
await page.waitForTimeout(200);
check('click on a face opens that desk', (await log()).includes('(click, desks)'), await log());

// Hover dwell → passing-by bubble.
await page.mouse.move(face.x + 3, face.y + 2, { steps: 3 });
await page.waitForTimeout(900);
const bubble = await page.evaluate(() => document.querySelectorAll('.hc-o-bubble').length);
check('resting on a desk shows a passing-by bubble', bubble >= 1);

// Presence toggles the monitor light.
const mon = await page.evaluate((id) => {
  window.office.setPresence(id, 'working', { label: 'Testing', badges: ['lamp'] });
  const btn = document.querySelector(`.hc-o-seat[data-pid="${id}"]`);
  const lights = [...document.querySelectorAll('.hc-o-sl[data-mon=on][data-lamp]')].length;
  return { state: btn.dataset.state, lights };
}, face.id);
check('setPresence lights the monitor and the Night Shift lamp', mon.state === 'working' && mon.lights > 0, JSON.stringify(mon));

// Drag a badge into the Skyline room (desk mode invite).
await page.keyboard.press('0');
await page.waitForTimeout(600);
await page.evaluate(() => window.office.zoomTo(2.6, { x: 190, y: 60 }));
await page.waitForTimeout(700);
const drag = await page.evaluate(() => {
  const seats = [...document.querySelectorAll('.hc-o-seat[data-face]')].filter((e) => {
    const r = e.querySelector('.hc-o-seat__face').getBoundingClientRect();
    return !e.dataset.chief && r.x > 250 && r.x < innerWidth - 250 && r.y > 150 && r.y < innerHeight - 150;
  });
  const b = seats[Math.floor(seats.length / 2)];
  const r = b.querySelector('.hc-o-seat__face').getBoundingClientRect();
  return { id: b.dataset.pid, x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
const room = await page.evaluate(() => {
  const o = window.office;
  const cam = o.getState().camera;
  const vw = innerWidth;
  const vh = innerHeight;
  const p = { x: 48, y: 50 * 0.82 };
  return { x: (p.x - cam.x) * cam.zoom + vw / 2, y: (p.y - cam.y) * cam.zoom + vh / 2 };
});
await page.mouse.move(drag.x, drag.y);
await page.mouse.down();
await page.mouse.move(drag.x + 20, drag.y + 5, { steps: 3 });
await page.mouse.move(room.x, room.y, { steps: 12 });
const dropLit = await page.evaluate(() => document.querySelector('.hc-office').dataset.drop);
await page.mouse.up();
await page.waitForTimeout(1900);
const inRoom = await page.evaluate((id) => document.querySelector(`.hc-o-seat[data-pid="${id}"]`).dataset.room, drag.id);
check('dragging a badge onto a room lights it and seats the person there', dropLit === 'skyline' && inRoom === 'skyline', `drop=${dropLit} room=${inRoom}`);

// Conference: enter, picker invite, captions, leave.
await page.evaluate(() => window.office.enterRoom('skyline', window.demo.pickPeople(3, 5)));
await page.waitForTimeout(2600);
s1 = await state();
check('enterRoom switches to the conference stage', s1.mode === 'conference' && s1.roomId === 'skyline' && s1.participants.length === 4, `${s1.mode} ${s1.participants.length}`);
const stageSeats = await page.evaluate(() => document.querySelectorAll('.hc-o-sseat').length);
check('the stage seats everyone at the table', stageSeats === 4, `${stageSeats}`);
await page.keyboard.press('i');
await page.waitForTimeout(300);
const picker = await page.evaluate(() => !!document.querySelector('.hc-o-picker'));
check('I opens the invite picker', picker);
await page.fill('.hc-o-picker input[type=search]', 'engineer');
await page.waitForTimeout(100);
await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.hc-o-picker__row:not([hidden]) input:not(:disabled)')].slice(0, 2);
  for (const r of rows) r.click();
});
await page.click('.hc-o-picker__foot .hc-o-btn--primary');
await page.waitForTimeout(700);
s1 = await state();
check('the picker invites two more', s1.participants.length === 6, `${s1.participants.length}`);
await page.fill('.hc-o-compose input', 'What do you think?');
await page.keyboard.press('Enter');
await page.waitForTimeout(2200);
const cap = await page.evaluate(() => document.querySelector('.hc-o-stage__cap:not([hidden])')?.textContent ?? '');
check('talking to the room shows captions', cap.length > 0, cap.slice(0, 60));
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
s1 = await state();
check('Esc leaves the room', s1.mode === 'desks' && s1.roomId === null, s1.mode);
await page.waitForTimeout(2000);
const back = await page.evaluate(() => document.querySelectorAll('.hc-o-seat[data-room]').length);
check('participants walk back to their desks', back === 0, `${back} still in rooms`);

// Idle: no rAF work when nothing moves.
const rafs = await page.evaluate(async () => {
  let n = 0;
  const orig = window.requestAnimationFrame;
  window.requestAnimationFrame = (cb) => {
    n++;
    return orig(cb);
  };
  await new Promise((r) => setTimeout(r, 1500));
  window.requestAnimationFrame = orig;
  return n;
});
check('zero rAF while idle', rafs === 0, `${rafs} frames requested in 1.5 s`);

// Reduced motion: flights are instant.
await page.evaluate(() => window.office.setReducedMotion(true));
await page.evaluate(() => window.office.zoomTo('desk'));
s1 = await state();
check('reduced motion: zoom is instant', Math.abs(s1.camera.zoom - 5.6) < 0.01, `${s1.camera.zoom}`);

// Destroy leaves nothing behind.
const destroyed = await page.evaluate(() => {
  window.office.destroy();
  return { root: !!document.querySelector('.hc-office'), style: !!document.getElementById('hc-office-style') };
});
check('destroy removes the DOM and the style tag', !destroyed.root && !destroyed.style, JSON.stringify(destroyed));

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
