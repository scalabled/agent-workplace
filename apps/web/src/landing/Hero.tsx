// The hero: the tagline rises in word by word next to a cluster of the real cast (their portraits, with the
// state rings the app uses: speaking, working, listening), over a darkened generated office and an aurora of the
// brand spectrum. The cluster is labelled as an illustration and its one side-talk bubble as a demo. On phones the
// faces become a strip above the headline. All motion is transform/opacity, runs while the hero is on screen, and
// stops entirely under prefers-reduced-motion.
import { Fragment } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { images } from 'virtual:headcount-landing';
import { nightAccent } from '../lib/accent';
import { TAGLINE } from './content';
import { EnterLink } from './links';
import { LpFace } from './LpFace';
import { LpIcon } from './LpIcon';
import { reducedMotion } from './motion';
import { Picture } from './Picture';
import { heroPeople, usePainted, type WallPerson } from './PortraitWall';
import { nextExchange, rng } from './sidetalk';

/** What each face in the illustration is doing (the app's real states; captions say it in words too). */
const DEMO_STATES: { state: 'speaking' | 'working' | 'listening' | 'idle'; words: string }[] = [
  { state: 'speaking', words: 'Speaking' },
  { state: 'working', words: 'Working · step 2 of 5' },
  { state: 'listening', words: 'Listening' },
  { state: 'idle', words: 'Available' },
  { state: 'working', words: 'Drafting a brief' },
  { state: 'idle', words: 'Available' },
];

function useParallax(ref: { current: HTMLElement | null }) {
  useEffect(() => {
    const el = ref.current;
    if (!el || reducedMotion()) return;
    let frame = 0;
    let visible = true;
    const update = () => {
      frame = 0;
      const h = el.offsetHeight || 1;
      const y = Math.min(Math.max(window.scrollY, 0), h);
      el.style.setProperty('--sy', String(Math.round(y)));
    };
    const onScroll = () => {
      if (visible && !frame) frame = requestAnimationFrame(update);
    };
    // The pointer lights the glass a little (fine pointers only).
    const fine = typeof matchMedia === 'function' && matchMedia('(pointer: fine)').matches;
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty('--mx', `${(((e.clientX - r.left) / r.width) * 100).toFixed(1)}%`);
      el.style.setProperty('--my', `${(((e.clientY - r.top) / r.height) * 100).toFixed(1)}%`);
    };
    // Off screen the hero stops listening; back on screen it catches up (the last scroll may have been missed).
    const io =
      typeof IntersectionObserver === 'function'
        ? new IntersectionObserver(([e]) => {
            visible = !!e?.isIntersecting;
            if (visible && !frame) frame = requestAnimationFrame(update);
          })
        : null;
    io?.observe(el);
    window.addEventListener('scroll', onScroll, { passive: true });
    if (fine) el.addEventListener('pointermove', onMove, { passive: true });
    update();
    return () => {
      cancelAnimationFrame(frame);
      io?.disconnect();
      window.removeEventListener('scroll', onScroll);
      el.removeEventListener('pointermove', onMove);
    };
  }, []);
}

interface HeroBubble {
  index: number;
  text: string;
  reply: boolean;
}

/** One demo side-talk line at a time among the cluster's faces (desktop cluster only; hidden on the strip). */
function useHeroSideTalk(people: WallPerson[], host: { current: HTMLElement | null }): HeroBubble | null {
  const [bubble, setBubble] = useState<HeroBubble | null>(null);
  const names = people.map((p) => p.first).join('|');
  useEffect(() => {
    const el = host.current;
    if (!el || people.length < 2) return;
    const random = rng(0x5eed);
    const recent = { people: [] as number[], lines: [] as number[] };
    const timers: ReturnType<typeof setTimeout>[] = [];
    let onScreen = true;
    const io = typeof IntersectionObserver === 'function' ? new IntersectionObserver(([e]) => (onScreen = !!e?.isIntersecting)) : null;
    io?.observe(el);
    const round = () => {
      timers.push(setTimeout(round, 9000));
      if (!onScreen || document.hidden || getComputedStyle(el).display === 'none') return;
      const ex = nextExchange(people.length, people.map((p) => p.first), random, recent);
      if (!ex) return;
      setBubble({ index: ex.a, text: ex.line, reply: false });
      timers.push(setTimeout(() => setBubble({ index: ex.b, text: ex.reply, reply: true }), 3200));
      timers.push(setTimeout(() => setBubble(null), 6800));
    };
    timers.push(setTimeout(round, reducedMotion() ? 2400 : 2200));
    return () => {
      io?.disconnect();
      timers.forEach(clearTimeout);
    };
  }, [names]);
  return bubble;
}

function HeroCast() {
  const withPortrait = usePainted();
  const people = useMemo(() => heroPeople(withPortrait), [withPortrait]);
  const host = useRef<HTMLDivElement>(null);
  const bubble = useHeroSideTalk(people, host);
  return (
    <div class="lp-cast" ref={host}>
      <p class="lp-cast-tag">
        <span class="lp-illus-tag">Illustration</span>
        <span class="visually-hidden">: a few of the coworkers in the catalog, with the states the app shows.</span>
      </p>
      <ul class="lp-cast-grid" aria-hidden="true">
        {people.map((p, i) => {
          const demo = DEMO_STATES[i % DEMO_STATES.length]!;
          return (
            <li key={p.id} class="lp-cast-tile" data-state={demo.state} data-lead={p.lead || undefined} data-talking={bubble?.index === i || undefined} style={{ '--accent': nightAccent(p.accent), '--i': i }}>
              <span class="lp-cast-ring">
                <LpFace subject={p} tier="tile" class="lp-cast-face" />
                {p.lead && <span class="lp-cast-badge">Chief of Staff</span>}
              </span>
              <span class="lp-cast-cap">
                <span class="lp-cast-name">{p.first}</span>
                <span class="lp-cast-state">
                  <span class="lp-cast-dot" />
                  {demo.words}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
      {/* The side-talk line sits under the faces (never over one), and the speaker's tile lights up. */}
      {bubble && people[bubble.index] && (
        <p class="lp-cast-talk" key={bubble.text} aria-hidden="true" style={{ '--accent': nightAccent(people[bubble.index]!.accent) }}>
          <span class="lp-bubble-tag">Demo</span>
          <span>
            <strong>{people[bubble.index]!.first}</strong> {bubble.text}
          </span>
        </p>
      )}
    </div>
  );
}

export function Hero() {
  const ref = useRef<HTMLElement>(null);
  useParallax(ref);
  const hero = images.hero;
  let word = 0;
  const title = TAGLINE.join(' ');
  return (
    <header class="lp-hero" ref={ref}>
      <div class="lp-hero-media">{hero && <Picture image={hero} priority class="lp-hero-img" sizes="100vw" decorative />}</div>
      <div class="lp-aurora" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </div>
      <div class="lp-hero-shade" aria-hidden="true" />
      <div class="lp-hero-inner">
        <div class="lp-hero-text">
          <p class="lp-kicker">
            <span class="lp-lamp" aria-hidden="true" />
            <span>
              The AI Office<span class="lp-kicker-more"> for owner-led businesses</span>
            </span>
          </p>
          {/* The words animate one by one; the heading's name is the whole sentence (screen readers never read it word by word). */}
          <h1 class="lp-title" aria-label={title}>
            {TAGLINE.map((line, i) => (
              <Fragment key={line}>
                {i > 0 ? ' ' : ''}
                <span class="lp-line" data-line={i} aria-hidden="true">
                  {line.split(' ').map((w, j, all) => (
                    // The space sits between the masks: inside an inline-block it would collapse.
                    <Fragment key={`${w}-${j}`}>
                      <span class="lp-w">
                        <span style={{ '--w': word++ }}>{w}</span>
                      </span>
                      {j < all.length - 1 ? ' ' : ''}
                    </Fragment>
                  ))}
                </span>
              </Fragment>
            ))}
          </h1>
          <p class="lp-lede">
            <strong>Headcount gives you staff:</strong> a Chief of Staff you talk to, and a team with faces and voices that does the work while you watch.
          </p>
          <div class="lp-cta-row">
            <EnterLink class="lp-btn lp-btn-primary lp-btn-lg" hero>
              Enter the office <LpIcon name="arrow" size={18} />
            </EnterLink>
            <a class="lp-btn lp-btn-ghost lp-btn-lg" href="#how">
              See how it works
            </a>
          </div>
          <p class="lp-fineprint">Runs keyless on a built-in demo provider or your local models. Add a key when you want the real thing.</p>
        </div>
        <HeroCast />
      </div>
    </header>
  );
}
