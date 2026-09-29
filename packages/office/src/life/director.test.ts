// The director on a fake clock with a fake scene (OFFICE-LIFE §7.2 "Director"): the plan drives people, real state
// overrides it, the owner's attention holds people, huddles talk only in view and within budgets, and nothing runs
// while the office is off-screen.
import { describe, expect, it, vi } from 'vitest';
import { createOfficeLife } from './director';
import type { OfficeLifeOptions } from './director';
import { segmentAt } from './planner';
import { LIFE_CAPS } from './tables';
import { LEAD, fakeClock, fakeScene, lifePeople } from './testing';
import type { HuddleLineRequest, HuddleScript } from './types';

const START = new Date(2026, 8, 29, 10, 30).getTime();

const script = (req: HuddleLineRequest): HuddleScript => {
  const [a, b] = req.participants as [string, string];
  return {
    exchangeId: `t.${req.seed}`,
    topic: 'self_aware',
    lines: [
      { personId: a, kind: 'line', text: "I'd grab an espresso if I had hands.", atMs: 0, estMs: 3700 },
      { personId: b, kind: 'line', text: 'I just like standing near it. Feels decisive.', atMs: 4000, estMs: 4300 },
      { personId: a, kind: 'laugh', text: '(chuckles)', atMs: 9000, estMs: 1400 },
    ],
  };
};

function setup(opts: Partial<OfficeLifeOptions> = {}, at = START) {
  const clock = fakeClock(at);
  const scene = fakeScene(clock);
  // The director's own timers, counted apart from the fake scene's walk timers.
  const live = new Set<unknown>();
  const timers = {
    set(fn: () => void, ms: number) {
      const h: unknown = clock.timers.set(() => {
        live.delete(h);
        fn();
      }, ms);
      live.add(h);
      return h;
    },
    clear(h: unknown) {
      live.delete(h);
      clock.timers.clear(h);
    },
  };
  const lines = vi.fn(script);
  const events: { kind: string; id: string; at: number; data?: unknown }[] = [];
  const life = createOfficeLife(scene, {
    people: lifePeople,
    seed: 'ws_test',
    now: clock.now,
    timers,
    observe: false,
    ambience: 'lively',
    leadId: LEAD.id,
    lines,
    nudge: false,
    onHuddleStart: (h) => events.push({ kind: 'start', id: h.id, at: clock.ms() }),
    onHuddleEnd: (h, info) => events.push({ kind: 'end', id: h.id, at: clock.ms(), data: info.reason }),
    onHuddleLine: (h, e) => events.push({ kind: 'line', id: h.id, at: clock.ms(), data: e }),
    ...opts,
  });
  return { clock, scene, life, lines, events, live };
}

/** The next person whose ambient segment departs within the window. */
function nextDeparture(life: ReturnType<typeof setup>['life'], from: number, within: number) {
  const plan = life.plan()!;
  let best: { id: string; at: number } | null = null;
  for (const [id, list] of Object.entries(plan.segments)) {
    for (const g of list) if (g.departAt > from && g.departAt < from + within && (!best || g.departAt < best.at)) best = { id, at: g.departAt };
  }
  return best!;
}

describe('createOfficeLife', () => {
  it('places people where the plan says, then follows it; every ambient move matches the plan', async () => {
    const { clock, scene, life } = setup();
    const plan = life.plan()!;
    const away = Object.keys(plan.segments).filter((id) => segmentAt(plan, id, START));
    expect(away.length).toBeGreaterThan(8);
    await clock.advance(10 * 60_000);
    const later = scene.moves.filter((m) => m.at > START);
    expect(later.length).toBeGreaterThan(20);
    for (const m of later) {
      if (m.opts.pace === 'brisk') continue;
      const seg = segmentAt(plan, m.id, m.at);
      if (m.to.kind === 'spot') expect(seg?.place.spotId).toBe(m.to.spotId);
      else expect(m.to.kind).toBe('desk');
    }
    life.destroy();
  });

  it('keeps the walker cap at every moment', async () => {
    const { clock, scene, life } = setup({ ambience: 'buzzing' });
    let max = 0;
    for (let i = 0; i < 120; i++) {
      await clock.advance(5000);
      max = Math.max(max, [...scene.pos.values()].filter((p) => p.walking).length);
    }
    expect(max).toBeLessThanOrEqual(LIFE_CAPS.buzzing.walkers);
    expect(max).toBeGreaterThan(0);
    life.destroy();
  });

  it('real work wins: after 1.5 s of hysteresis the person walks back briskly and stays at the desk', async () => {
    const { clock, scene, life } = setup();
    await clock.advance(30_000);
    const id = [...scene.pos.entries()].find(([, p]) => p.place.kind === 'spot' && !p.walking)![0];
    scene.hooks!.onPresence!(id, 'working', [], false);
    await clock.advance(1000);
    expect(scene.moves.filter((m) => m.id === id && m.at > clock.ms() - 1000)).toHaveLength(0);
    await clock.advance(1500);
    const back = scene.moves.filter((m) => m.id === id).pop()!;
    expect(back.to.kind).toBe('desk');
    expect(back.opts.pace).toBe('brisk');
    const n = scene.moves.length;
    await clock.advance(30 * 60_000);
    expect(scene.moves.slice(n).filter((m) => m.id === id)).toHaveLength(0);
    // Work ends: 60–120 s of wrap-up at the desk, then the plan again.
    scene.hooks!.onPresence!(id, 'idle', [], false);
    await clock.advance(50_000);
    expect(scene.moves.slice(n).filter((m) => m.id === id)).toHaveLength(0);
    life.destroy();
  });

  it('research goes to the library reading chair; a raised hand goes to the desk', async () => {
    const { clock, scene, life } = setup();
    const plan = life.plan()!;
    const idle = lifePeople.map((p) => p.id).filter((id) => id !== LEAD.id && !segmentAt(plan, id, START) && !segmentAt(plan, id, START + 60_000));
    const [r, h] = idle as [string, string];
    life.setActivity(r, 'research');
    scene.hooks!.onPresence!(r, 'working', [], false);
    await clock.advance(2000);
    const m = scene.moves.filter((x) => x.id === r).pop()!;
    expect(m.to.kind).toBe('spot');
    expect(m.to.kind === 'spot' && m.to.spotId.startsWith('library:')).toBe(true);
    expect(m.opts.pace).toBe('brisk');
    // A raised hand: someone away walks back to their desk (the hand halo lives there).
    const awayId = [...scene.pos.entries()].find(([id, p]) => p.place.kind === 'spot' && !p.walking && id !== r)![0];
    scene.hooks!.onPresence!(awayId, 'raised_hand', ['hand'], false);
    await clock.advance(100);
    const back = scene.moves.filter((x) => x.id === awayId).pop()!;
    expect(back.to.kind).toBe('desk');
    expect(back.opts.pace).toBe('brisk');
    void h;
    life.destroy();
  });

  it('the owner comes first: a hovered person starts no walk, a walk in progress stops, release rejoins the plan', async () => {
    const { clock, scene, life } = setup();
    const next = nextDeparture(life, clock.ms(), 5 * 60_000);
    scene.hold(next.id, true);
    await clock.advance(next.at - clock.ms() + 20_000);
    expect(scene.moves.filter((m) => m.id === next.id && m.at >= next.at)).toHaveLength(0);
    scene.hold(next.id, false);
    await clock.advance(3500);
    expect(scene.moves.filter((m) => m.id === next.id && m.at >= next.at).length).toBeGreaterThan(0);
    // A walker who gets hovered eases to a stop.
    const walker = [...scene.pos.entries()].find(([, p]) => p.walking)?.[0];
    if (walker) {
      scene.hold(walker, true);
      await clock.advance(10);
      expect(scene.cancels.some((c) => c.id === walker)).toBe(true);
    }
    life.destroy();
  });

  it('huddles gather, talk one turn at a time within the bubble caps, and disperse', async () => {
    const { clock, scene, life, lines, events } = setup();
    await clock.advance(60 * 60_000);
    const starts = events.filter((e) => e.kind === 'start');
    const ends = events.filter((e) => e.kind === 'end');
    expect(starts.length).toBeGreaterThan(3);
    expect(lines).toHaveBeenCalled();
    // Every huddle that ended in the hour ended by dispersal (or an override), never stuck.
    for (const e of ends) expect(['dispersed', 'override']).toContain(e.data);
    expect(ends.length).toBeGreaterThan(starts.length - LIFE_CAPS.lively.huddles - 1);
    // Turns never overlap within a huddle.
    const byHuddle = new Map<string, typeof scene.says>();
    for (const s of scene.says) (byHuddle.get(s.huddleId) ?? byHuddle.set(s.huddleId, []).get(s.huddleId)!).push(s);
    for (const list of byHuddle.values()) for (let i = 1; i < list.length; i++) expect(list[i]!.at).toBeGreaterThanOrEqual(list[i - 1]!.at + list[i - 1]!.ttlMs);
    // At most two huddles show a bubble at once (Lively), and the line budget holds (≤ 10 spoken lines a minute;
    // laughs are caption chips outside it).
    const spoken = scene.says.filter((x) => !x.nonverbal);
    for (const s0 of spoken) {
      const live = new Set(spoken.filter((x) => x.at <= s0.at && s0.at < x.at + x.ttlMs).map((x) => x.huddleId));
      expect(live.size).toBeLessThanOrEqual(LIFE_CAPS.lively.huddleBubbles);
    }
    const shown = spoken.map((s) => s.at).sort((a, b) => a - b);
    for (let i = 0; i < shown.length; i++) expect(shown.filter((t) => t >= shown[i]! && t < shown[i]! + 60_000).length).toBeLessThanOrEqual(LIFE_CAPS.lively.linesPerMin);
    // A huddle in view talks in a rhythm: several exchanges, 20–40 s apart.
    const rhythm = [...byHuddle.values()].filter((l) => new Set(l.map((x) => x.at)).size >= 4);
    expect(rhythm.length).toBeGreaterThan(0);
    life.destroy();
  });

  it('talks only in view: off-screen huddles never ask for lines', async () => {
    const { clock, scene, life, lines, events } = setup();
    scene.vis = () => 0;
    scene.visAt = () => 0;
    await clock.advance(30 * 60_000);
    expect(events.some((e) => e.kind === 'start')).toBe(true);
    expect(lines).not.toHaveBeenCalled();
    scene.vis = () => 2;
    scene.visAt = () => 2;
    await clock.advance(20 * 60_000);
    expect(lines).toHaveBeenCalled();
    life.destroy();
  });

  it('Quiet huddles are silent company: no lines at all', async () => {
    const { clock, scene, life, lines, events } = setup({ ambience: 'quiet' });
    await clock.advance(60 * 60_000);
    expect(lines).not.toHaveBeenCalled();
    expect(scene.says).toHaveLength(0);
    expect(events.some((e) => e.kind === 'start')).toBe(true);
    life.destroy();
  });

  it('listening in marks only that huddle’s lines; joining holds the group and stops ambient lines', async () => {
    const { clock, scene, life, events } = setup();
    let h = life.huddles()[0];
    for (let i = 0; i < 40 && !h; i++) {
      await clock.advance(30_000);
      h = life.huddles()[0];
    }
    expect(h).toBeTruthy();
    life.listenIn(h!.id);
    await clock.advance(20_000);
    const mine = events.filter((e) => e.kind === 'line' && (e.data as { listening: boolean }).listening);
    for (const e of mine) expect(e.id).toBe(h!.id);
    const current = life.huddles().find((x) => x.id === h!.id);
    if (!current) return life.destroy();
    life.join(h!.id);
    expect(life.getState().joined).toBe(h!.id);
    const n = scene.says.length;
    const movesBefore = scene.moves.length;
    await clock.advance(60_000);
    expect(scene.says.slice(n).filter((s) => s.huddleId === h!.id)).toHaveLength(0);
    expect(scene.moves.slice(movesBefore).filter((m) => current.members.includes(m.id))).toHaveLength(0);
    life.leave();
    expect(life.getState().joined).toBeNull();
    life.destroy();
  });

  it('Listen is the owner asking: at Quiet too, the huddle talks within about a second, then ends with "gone quiet"', async () => {
    const listens: { id: string | null; reason?: string }[] = [];
    const { clock, life, events, lines } = setup({ ambience: 'quiet', onListenIn: (h, info) => listens.push({ id: h?.id ?? null, ...(info ? { reason: info.reason } : {}) }) });
    let h = life.huddles()[0];
    for (let i = 0; i < 40 && !h; i++) {
      await clock.advance(30_000);
      h = life.huddles()[0];
    }
    expect(h).toBeTruthy();
    // Quiet: no small talk on its own.
    expect(events.filter((e) => e.kind === 'line')).toHaveLength(0);
    life.listenIn(h!.id);
    const at = clock.ms();
    for (let i = 0; i < 20 && !events.some((e) => e.kind === 'line' && e.id === h!.id); i++) await clock.advance(100);
    const first = events.find((e) => e.kind === 'line' && e.id === h!.id);
    expect(first).toBeTruthy();
    expect(first!.at - at).toBeLessThanOrEqual(1500);
    expect((first!.data as { listening: boolean }).listening).toBe(true);
    // Picked as at Lively (Quiet picks nothing).
    expect(lines.mock.calls.at(-1)![0].ambience).toBe('lively');
    // It keeps talking every few seconds while listened, then says it has gone quiet and Listening ends.
    for (let i = 0; i < 120 && listens.at(-1)?.id !== null; i++) await clock.advance(1000);
    if (life.huddles().some((x) => x.id === h!.id)) expect(listens.at(-1)).toEqual({ id: null, reason: 'quiet' });
    expect(life.getState().listening).toBeNull();
    life.destroy();
  });

  it('runs no timers while the office is off-screen, and resumes by snapping to the plan', async () => {
    const { clock, scene, life, live } = setup();
    await clock.advance(60_000);
    scene.hooks!.onStage!(true);
    expect(life.getState().suspended).toBe(true);
    expect(live.size).toBe(0);
    const n = scene.moves.length;
    await clock.advance(20 * 60_000);
    expect(scene.moves.length).toBe(n);
    scene.hooks!.onStage!(false);
    expect(life.getState().suspended).toBe(false);
    await clock.advance(1000);
    expect(scene.moves.slice(n).some((m) => m.opts.pace === 'instant')).toBe(true);
    life.destroy();
  });

  it('reduced motion: every move is a fade, never a walk', async () => {
    const { clock, scene, life } = setup({ reducedMotion: true });
    await clock.advance(10 * 60_000);
    expect(scene.moves.length).toBeGreaterThan(5);
    expect(scene.moves.every((m) => m.opts.pace === 'instant')).toBe(true);
    life.destroy();
  });

  it('pausing freezes the floor: no new walks, no lines', async () => {
    const { clock, scene, life, lines } = setup();
    await clock.advance(5000);
    life.pause();
    const n = scene.moves.length;
    const calls = lines.mock.calls.length;
    await clock.advance(15 * 60_000);
    expect(scene.moves.length).toBe(n);
    expect(lines.mock.calls.length).toBe(calls);
    expect(scene.summaries.at(-1)?.paused).toBe(true);
    life.resume();
    await clock.advance(5 * 60_000);
    expect(scene.moves.length).toBeGreaterThan(n);
    life.destroy();
  });

  it('is the same floor on every device: the same seed gives the same plan and the same first moves', async () => {
    const a = setup();
    const b = setup();
    expect(a.life.plan()!.hash).toBe(b.life.plan()!.hash);
    await a.clock.advance(5 * 60_000);
    await b.clock.advance(5 * 60_000);
    const key = (s: typeof a.scene) => s.moves.map((m) => `${m.at}|${m.id}|${JSON.stringify(m.to)}`).join('\n');
    expect(key(a.scene)).toBe(key(b.scene));
    a.life.destroy();
    b.life.destroy();
  });

  it('never deadlocks: over three hours every gathered huddle ends and everyone is where the plan says', async () => {
    const { clock, scene, life, events } = setup({}, new Date(2026, 8, 29, 9, 0).getTime());
    await clock.advance(3 * 3600_000);
    const started = new Set(events.filter((e) => e.kind === 'start').map((e) => e.id));
    const ended = new Set(events.filter((e) => e.kind === 'end').map((e) => e.id));
    const open = [...started].filter((id) => !ended.has(id));
    expect(open.length).toBeLessThanOrEqual(LIFE_CAPS.lively.huddles);
    const plan = life.plan()!;
    let misplaced = 0;
    for (const [id, p] of scene.pos) {
      if (p.walking) continue;
      const seg = segmentAt(plan, id, clock.ms());
      const want = seg && clock.ms() < seg.end ? seg.place.spotId : 'desk';
      const have = p.place.kind === 'spot' ? p.place.spotId : p.place.kind;
      if (want !== have) misplaced++;
    }
    // A few may be mid-transition (deferred by the walker cap or occupied slots); nobody is stuck.
    expect(misplaced).toBeLessThanOrEqual(3);
    life.destroy();
  });

  it('replans the rest of the day on a new Ambience (walks in progress finish) and on new people', async () => {
    const { clock, scene, life } = setup();
    await clock.advance(2 * 60_000);
    const before = life.plan()!.hash;
    life.setAmbience('buzzing');
    expect(life.getState().ambience).toBe('buzzing');
    expect(life.getState().caps.walkers).toBe(LIFE_CAPS.buzzing.walkers);
    expect(life.plan()!.hash).not.toBe(before);
    await clock.advance(10 * 60_000);
    // New personality data (the roster itself comes from the scene's plan): the rest of the day is planned again.
    const mid = life.plan()!.hash;
    life.setPeople(lifePeople.map((p) => ({ id: p.id })));
    expect(life.plan()!.hash).not.toBe(mid);
    const n = scene.moves.length;
    await clock.advance(10 * 60_000);
    expect(scene.moves.length).toBeGreaterThan(n);
    life.destroy();
  });

  it('talks in a rhythm while watched: several exchanges per huddle, a bubble on screen most of the time', async () => {
    const { clock, scene, life } = setup({}, new Date(2026, 8, 29, 11, 0).getTime());
    await clock.advance(10 * 60_000);
    const spoken = scene.says.filter((x) => !x.nonverbal && x.at > START + 3600_000 * 0.5 - 1);
    // The union of bubble intervals over the ten minutes.
    const iv = spoken.map((x) => [x.at, x.at + x.ttlMs] as const).sort((a, b) => a[0] - b[0]);
    let covered = 0;
    let end = -Infinity;
    for (const [a, b] of iv) {
      if (a > end) covered += b - a;
      else if (b > end) covered += b - end;
      end = Math.max(end, b);
    }
    expect(covered / (10 * 60_000)).toBeGreaterThan(0.25);
    const perHuddle = new Map<string, Set<string>>();
    for (const x of scene.says) (perHuddle.get(x.huddleId) ?? perHuddle.set(x.huddleId, new Set()).get(x.huddleId)!).add(String(Math.floor(x.at / 15_000)));
    expect([...perHuddle.values()].some((v) => v.size >= 3)).toBe(true);
    life.destroy();
  });

  it('opens talking: a huddle in view when the office opens speaks within two seconds (no settle beat)', async () => {
    const { clock, scene, life } = setup({}, new Date(2026, 8, 29, 11, 0).getTime());
    await clock.advance(2000);
    expect(scene.says.length).toBeGreaterThan(0);
    expect(scene.frames.length).toBe(1); // the liveliest neighbourhood, at L1
    life.destroy();
  });

  it('starts talking within 1.5 s of framing a quiet huddle', async () => {
    const { clock, scene, life } = setup();
    scene.vis = () => 0;
    scene.visAt = () => 0;
    let h = life.huddles().find((x) => x.endsAt - clock.ms() > 90_000);
    for (let i = 0; i < 60 && !h; i++) {
      await clock.advance(10_000);
      h = life.huddles().find((x) => x.endsAt - clock.ms() > 90_000);
    }
    expect(h).toBeTruthy();
    const n = scene.says.length;
    scene.vis = () => 2;
    scene.visAt = () => 2;
    scene.hooks!.onViewChange({ input: true });
    await clock.advance(1500);
    expect(scene.says.slice(n).length).toBeGreaterThan(0);
    life.destroy();
  });

  it('habituates: after ten minutes of passive viewing, about one new exchange every three minutes', async () => {
    const { clock, life, lines } = setup({}, new Date(2026, 8, 29, 10, 0).getTime());
    await clock.advance(11 * 60_000);
    const n0 = lines.mock.calls.length;
    await clock.advance(9 * 60_000);
    const n = lines.mock.calls.length - n0;
    expect(n).toBeGreaterThanOrEqual(2);
    expect(n).toBeLessThanOrEqual(5);
    life.destroy();
  });

  it('at plan zoom one huddle murmurs: its glyph pulses in the speaker’s accent, the words go to the card, no bubbles', async () => {
    const { clock, scene, life, events } = setup({}, new Date(2026, 8, 29, 11, 0).getTime());
    scene.vis = () => 1;
    scene.visAt = () => 1;
    await clock.advance(4 * 60_000);
    expect(scene.says).toHaveLength(0);
    const glyph = events.filter((e) => e.kind === 'line' && (e.data as { glyph?: boolean }).glyph);
    expect(glyph.length).toBeGreaterThan(0);
    expect(scene.speakers.some((x) => !!x)).toBe(true);
    // Never two murmuring at once, and at most one new murmur every 30 s.
    const starts = [...new Set(glyph.filter((e) => (e.data as { index: number }).index === 0).map((e) => e.at))].sort((a, b) => a - b);
    for (let i = 1; i < starts.length; i++) expect(starts[i]! - starts[i - 1]!).toBeGreaterThanOrEqual(30_000);
    life.destroy();
  });

  it('a murmur zoomed into mid-way ends there: no reply bubble without its opener, a fresh exchange starts in view', async () => {
    const { clock, scene, life, events } = setup({}, new Date(2026, 8, 29, 11, 0).getTime());
    scene.vis = () => 1;
    scene.visAt = () => 1;
    type LineEv = { index: number; glyph?: boolean; exchangeId: string };
    let first: (typeof events)[number] | undefined;
    for (let i = 0; i < 240 && !first; i++) {
      await clock.advance(500);
      first = events.find((e) => e.kind === 'line' && (e.data as LineEv).glyph && (e.data as LineEv).index === 0);
    }
    expect(first).toBeTruthy();
    const murmurId = (first!.data as LineEv).exchangeId;
    // The owner zooms in on that huddle right after its opener murmured.
    const hud = life.huddles().find((x) => x.id === first!.id)!;
    const ps = hud.members.map((id) => scene.pos.get(id)!);
    const cx = ps.reduce((a, p) => a + p.x, 0) / ps.length;
    const cy = ps.reduce((a, p) => a + p.y, 0) / ps.length;
    scene.vis = (id) => (hud.members.includes(id) ? 2 : 0);
    scene.visAt = (p) => (Math.hypot(p.x - cx, p.y - cy) < 120 ? 2 : 0);
    await clock.advance(20_000);
    const later = events.filter((e) => e.kind === 'line' && e.id === first!.id && e.at > first!.at);
    // No later turn of the murmur shows as a bubble...
    expect(later.filter((e) => (e.data as LineEv).exchangeId === murmurId && (e.data as { visible: boolean }).visible)).toHaveLength(0);
    // ...and the framed huddle opens a fresh exchange, from its first line.
    const fresh = later.filter((e) => (e.data as LineEv).exchangeId !== murmurId && (e.data as { visible: boolean }).visible);
    expect(fresh.length).toBeGreaterThan(0);
    expect((fresh[0]!.data as LineEv).index).toBe(0);
    expect(fresh[0]!.at - first!.at).toBeLessThan(8000);
    life.destroy();
  });

  it('asks for lines with the huddle’s history, its host and whether the spot is theirs alone', async () => {
    const { clock, life, lines } = setup({}, new Date(2026, 8, 29, 11, 0).getTime());
    await clock.advance(15 * 60_000);
    const reqs = lines.mock.calls.map(([r]) => r);
    expect(reqs.some((r) => r.exchangeIndex > 0 && (r.previous ?? []).length === r.exchangeIndex)).toBe(true);
    expect(reqs.every((r) => r.contexts.includes('same_department') || r.contexts.includes('cross_department'))).toBe(true);
    expect(reqs.some((r) => r.contexts.includes('spot_empty'))).toBe(true);
    life.destroy();
  });

  it('following someone lets them walk on: hover and focus do not hold them, a stopped walk resumes and arrives', async () => {
    const { clock, scene, life } = setup();
    let id: string | undefined;
    for (let i = 0; i < 90 && !id; i++) {
      await clock.advance(2000);
      id = [...scene.pos.entries()].find(([, p]) => p.walking && p.place.kind === 'spot')?.[0];
    }
    expect(id).toBeTruthy();
    const walker = id!;
    scene.hold(walker, true, 'hover');
    scene.hold(walker, true, 'focus');
    await clock.advance(50);
    expect(scene.cancels.some((c) => c.id === walker)).toBe(true);
    const n = scene.moves.length;
    scene.hooks!.onFollow!(walker);
    await clock.advance(50);
    expect(scene.moves.slice(n).some((m) => m.id === walker)).toBe(true);
    scene.hold(walker, true, 'hover');
    await clock.advance(20_000);
    expect(scene.cancels.filter((c) => c.id === walker)).toHaveLength(1);
    expect(scene.pos.get(walker)!.walking).toBe(false);
    expect(life.whereIs(walker).state).not.toBe('held');
    scene.hooks!.onFollow!(null);
    life.destroy();
  });

  it('shows a raised hand to the autopilot once per raise (≤ 10 s), then prefers the floor until it changes', async () => {
    const { clock, scene, life } = setup();
    await clock.advance(10_000);
    const id = lifePeople.map((p) => p.id).find((x) => x !== LEAD.id && life.whereIs(x).kind === 'desk')!;
    scene.hooks!.onPresence!(id, 'raised_hand', ['hand'], false);
    await clock.advance(500);
    const m = life.moments().find((x) => x.kind === 'raised_hand')!;
    expect(m.holdMs).toBeLessThanOrEqual(10_000);
    expect(m.score).toBeGreaterThan(50);
    scene.hooks!.onMomentShown!(m);
    expect(life.moments().find((x) => x.id === m.id)!.score).toBeLessThan(0);
    scene.hooks!.onPresence!(id, 'idle', [], false);
    await clock.advance(1000);
    scene.hooks!.onPresence!(id, 'raised_hand', ['hand'], false);
    const again = life.moments().find((x) => x.kind === 'raised_hand')!;
    expect(again.id).not.toBe(m.id);
    expect(again.score).toBeGreaterThan(50);
    life.destroy();
  });

  it('plans in idle slices when asked: the floor is drawn first, then everyone takes their place; replans land later', async () => {
    const { clock, scene, life } = setup({ planIn: 'idle' });
    expect(life.plan()).toBeNull();
    expect(scene.moves).toHaveLength(0);
    await clock.advance(3000);
    expect(life.plan()).not.toBeNull();
    expect(scene.moves.length).toBeGreaterThan(5);
    const before = life.plan()!.hash;
    life.setAmbience('buzzing');
    expect(life.plan()!.hash).toBe(before);
    await clock.advance(3000);
    expect(life.plan()!.hash).not.toBe(before);
    life.destroy();
  });

  it('a joined huddle’s replies leave with you (≤ 4 s)', async () => {
    const { clock, scene, life } = setup({}, new Date(2026, 8, 29, 11, 0).getTime());
    let h = life.huddles()[0];
    for (let i = 0; i < 40 && !h; i++) {
      await clock.advance(10_000);
      h = life.huddles()[0];
    }
    life.join(h!.id);
    life.leave();
    expect(scene.trims.at(-1)).toEqual({ ids: h!.members, maxMs: 4000 });
    life.destroy();
  });

  it('a reply that grows updates its line in the joined huddle’s chat instead of adding one', async () => {
    const { clock, scene, life } = setup({}, new Date(2026, 8, 29, 11, 0).getTime());
    let h = life.huddles()[0];
    for (let i = 0; i < 40 && !h; i++) {
      await clock.advance(10_000);
      h = life.huddles()[0];
    }
    life.join(h!.id);
    const who = h!.members[0]!;
    const mine = () => (scene.shown.get(h!.id)?.lines ?? []).filter((l) => l.personId === who && /sell-through/.test(l.text));
    life.reply(who, 'I would lead with sell-through.');
    life.reply(who, 'I would lead with sell-through. Brand love comes second.', { update: true });
    expect(mine().map((l) => l.text)).toEqual(['I would lead with sell-through. Brand love comes second.']);
    life.reply(who, 'Also, sell-through is easier to show.');
    expect(mine()).toHaveLength(2);
    // The card is the one transcript: no overhead copy of a joined reply.
    expect(scene.bubbles.filter((b) => b.personId === who && /sell-through/.test(b.text))).toEqual([]);
    life.destroy();
  });

  it('"Open in a room" tells the host first, leaves the huddle, then walks everyone present into the Garden room', async () => {
    const order: string[] = [];
    const onHuddleToRoom = vi.fn((h: { id: string }) => order.push(`toRoom:${h.id}`));
    const onLeaveHuddle = vi.fn(() => order.push('leave'));
    const { clock, scene, life } = setup({ onHuddleToRoom, onLeaveHuddle }, new Date(2026, 8, 29, 11, 0).getTime());
    const entered: { roomId: string; ids: string[] }[] = [];
    (scene as unknown as { enterRoom(r: string, ids?: string[]): void }).enterRoom = (roomId, ids = []) => {
      order.push('enter');
      entered.push({ roomId, ids });
    };
    let h = life.huddles()[0];
    for (let i = 0; i < 40 && !h; i++) {
      await clock.advance(10_000);
      h = life.huddles()[0];
    }
    life.join(h!.id);
    scene.hooks!.onHuddleAction(h!.id, 'room');
    expect(order).toEqual([`toRoom:${h!.id}`, 'leave', 'enter']);
    expect(entered).toEqual([{ roomId: 'garden', ids: h!.members }]);
    expect(life.getState().joined).toBeNull();
    life.destroy();
  });

  it('says once when the opening is placed', async () => {
    const onOpened = vi.fn();
    const { clock, life } = setup({ onOpened });
    expect(onOpened).toHaveBeenCalledTimes(1);
    await clock.advance(5 * 60_000);
    expect(onOpened).toHaveBeenCalledTimes(1);
    life.destroy();
  });

  it('summarises for the pill and offers moments', async () => {
    const { clock, scene, life } = setup();
    await clock.advance(6 * 60_000);
    const s = scene.summaries.filter(Boolean).at(-1)!;
    expect(s.away).toBeGreaterThan(0);
    expect(s.night).toBe(false);
    expect(life.moments().every((m, i, a) => i === 0 || a[i - 1]!.score >= m.score)).toBe(true);
    life.destroy();
    expect(scene.summaries.at(-1)).toBeNull();
  });
});
