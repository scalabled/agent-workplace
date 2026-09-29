// The living portrait wall: real coworker faces from the catalog (portraits when they exist, illustrated faces
// otherwise) with idle blinks and sway, and occasional side-talk bubbles that are clearly marked "Demo". The
// Chiefs of Staff have their own carousel, so the wall is coworkers only, curated to lead with the younger half
// of the cast (cast.ts). Tiles are not controls: they carry no hover affordance.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { coworkers, leads } from 'virtual:headcount-landing';
import { nightAccent } from '../lib/accent';
import { curate, isYoung } from './cast';
import type { LandingFaceSubject } from './face-engine';
import { reducedMotion } from './motion';
import { LpFace } from './LpFace';
import { portraitIds } from './portraits';
import { nextExchange, rng } from './sidetalk';

export interface WallPerson extends LandingFaceSubject {
  first: string;
  role: string;
  pronouns: string;
  age: string;
  lead: boolean;
}

/** Faces on the wall at the widest layout (6 × 3); narrower layouts show the first 12 or 9. */
export const WALL_SIZE = 18;
const WALL_COLUMNS = 6;
/** Faces in the hero cluster (3 × 2 on desktop, a strip on phones). */
export const HERO_SIZE = 6;
/** With at least this many portraits, a surface shows only real portraits (one consistent photo shoot). */
const PORTRAIT_MIN = 9;

const asLead = (l: (typeof leads)[number]): WallPerson => ({ id: l.id, name: l.name, first: l.first, role: 'Chief of Staff', pronouns: l.pronouns, age: l.age, accent: l.accent, appearance: l.appearance, lead: true });
const asCoworker = (c: (typeof coworkers)[number]): WallPerson => ({ id: c.id, name: c.name, first: c.first, role: c.title, pronouns: c.pronouns, age: c.age, accent: c.accent, appearance: c.appearance, lead: false });

function painted<T extends { id: string }>(people: T[], withPortrait: ReadonlySet<string>): T[] {
  const p = people.filter((x) => withPortrait.has(x.id));
  return p.length >= PORTRAIT_MIN ? p : people;
}

/** The hero cluster: one Chief of Staff from the younger half of the cast, then coworkers, rim colours varied. */
export function heroPeople(withPortrait: ReadonlySet<string>): WallPerson[] {
  const ls = leads.map(asLead);
  const lead = ls.filter((l) => withPortrait.size < PORTRAIT_MIN || withPortrait.has(l.id)).find(isYoung) ?? ls[0];
  const rest = curate(painted(coworkers.map(asCoworker), withPortrait), { size: HERO_SIZE - (lead ? 1 : 0), perRow: 3 });
  return lead ? [lead, ...rest] : rest;
}

/** The wall: coworkers only (not the hero's), curated: younger first, at most one 45+ per row, varied rim light. */
export function wallPeople(withPortrait: ReadonlySet<string>, exclude: ReadonlySet<string> = new Set()): WallPerson[] {
  const pool = painted(coworkers.map(asCoworker), withPortrait).filter((p) => !exclude.has(p.id));
  return curate(pool, { size: WALL_SIZE, perRow: WALL_COLUMNS });
}

/** Ids with a portrait, once the list arrives (the wall and the hero prefer them). */
export function usePainted(): ReadonlySet<string> {
  const [ids, setIds] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    let alive = true;
    void portraitIds().then((got) => alive && got.size && setIds(got));
    return () => {
      alive = false;
    };
  }, []);
  return ids;
}

interface Bubble {
  index: number;
  text: string;
  reply: boolean;
  side: 'left' | 'right';
  /** Distance from the tile's bottom to the bubble's bottom: it sits on the speaker's own portrait. */
  lift: number | null;
}

const EVERY_MS = 7000;
const FIRST_MS = 1600;
/** The line shows alone, then gives way to the reply: two bubbles never sit on top of each other. */
const REPLY_AFTER_MS = 3000;
const SHOW_MS = 4200;
/** How far above the portrait's bottom edge a bubble ends: clear of every caption, even a staggered neighbour's. */
const BUBBLE_INSET = 14;

export function PortraitWall() {
  const withPortrait = usePainted();
  const people = useMemo(() => wallPeople(withPortrait, new Set(heroPeople(withPortrait).map((p) => p.id))), [withPortrait]);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const el = list.current;
    if (!el) return;
    const random = rng(Date.now() & 0xffff);
    const recent = { people: [] as number[], lines: [] as number[] };
    const timers = new Set<ReturnType<typeof setTimeout>>();
    let loop: ReturnType<typeof setTimeout> | undefined;
    let onScreen = false;
    const later = (ms: number, fn: () => void) => {
      const t = setTimeout(() => {
        timers.delete(t);
        fn();
      }, ms);
      timers.add(t);
    };
    const sideOf = (tile: Element): 'left' | 'right' => {
      const r = tile.getBoundingClientRect();
      const w = el.getBoundingClientRect();
      return r.left + r.width / 2 > w.left + w.width / 2 ? 'right' : 'left';
    };
    // Anchored to the lower part of the speaker's portrait (measured, so the staggered columns are followed), a
    // bubble never covers the names and roles of the row above.
    const liftOf = (tile: Element): number | null => {
      const face = tile.querySelector('.lp-tile-face');
      if (!face) return null;
      return Math.max(0, Math.round(tile.getBoundingClientRect().bottom - face.getBoundingClientRect().bottom + BUBBLE_INSET));
    };
    const round = () => {
      loop = setTimeout(round, EVERY_MS);
      if (!onScreen || document.hidden) return;
      // Narrow layouts hide the trailing tiles, so visible tiles keep their index.
      const tiles = [...el.querySelectorAll<HTMLElement>('.lp-tile')].filter((t) => t.offsetParent !== null);
      const names = tiles.map((t) => t.dataset.first ?? '');
      const ex = nextExchange(tiles.length, names, random, recent);
      if (!ex) return;
      const a: Bubble = { index: ex.a, text: ex.line, reply: false, side: sideOf(tiles[ex.a]!), lift: liftOf(tiles[ex.a]!) };
      const b: Bubble = { index: ex.b, text: ex.reply, reply: true, side: sideOf(tiles[ex.b]!), lift: liftOf(tiles[ex.b]!) };
      setBubbles([a]);
      later(REPLY_AFTER_MS, () => setBubbles((cur) => [...cur.filter((x) => x !== a), b]));
      later(REPLY_AFTER_MS + SHOW_MS, () => setBubbles((cur) => cur.filter((x) => x !== b)));
    };
    const io =
      typeof IntersectionObserver === 'function'
        ? new IntersectionObserver(([e]) => {
            const was = onScreen;
            onScreen = !!e?.isIntersecting;
            // Scrolled into view: start talking soon rather than at the next round.
            if (onScreen && !was) {
              clearTimeout(loop);
              loop = setTimeout(round, FIRST_MS);
            }
          })
        : null;
    if (io) io.observe(el);
    else onScreen = true;
    loop = setTimeout(round, reducedMotion() ? FIRST_MS * 2 : FIRST_MS);
    return () => {
      io?.disconnect();
      clearTimeout(loop);
      timers.forEach(clearTimeout);
    };
  }, []);

  return (
    <ul class="lp-wall" ref={list} aria-label="Some of the coworkers in the catalog">
      {people.map((p, i) => {
        const bubble = bubbles.find((b) => b.index === i);
        return (
          <li key={p.id} class="lp-tile" data-first={p.first} data-talking={bubble ? '' : undefined} style={{ '--accent': nightAccent(p.accent), '--i': i }}>
            <LpFace subject={p} tier="tile" class="lp-tile-face" />
            <span class="lp-tile-meta">
              <span class="lp-tile-name">{p.first}</span>
              <span class="lp-tile-role">{p.role}</span>
            </span>
            {bubble && (
              <span class="lp-bubble" data-side={bubble.side} data-reply={bubble.reply || undefined} aria-hidden="true" style={bubble.lift === null ? undefined : { '--lift': `${bubble.lift}px` }}>
                <span class="lp-bubble-tag">Demo</span>
                {bubble.text}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
