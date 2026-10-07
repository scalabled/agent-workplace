// The public landing page ("/"): bold motion, generated imagery, big type, and the real coworker faces
// (OWNER-DIRECTIVES D3). Always dark. Honest copy only: no testimonials, logos, customer counts or invented
// metrics; every capability carries its status (works today, in the works, planned). The app is not loaded until
// someone walks in.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { BRAND, routePath, type CapabilitiesResponse } from '@headcount/protocol';
import { coworkers, counts, images, leads, voiceSamples } from 'virtual:headcount-landing';
import { nightAccent } from '../lib/accent';
import { forceTheme } from '../lib/theme';
import { paths } from '../router';
import { curate } from './cast';
import { countWord, FAQ, LIVING, MEETINGS, MODALITIES, OFFICE, PACKS, PRICING_PRINCIPLES, PROVIDERS, SPEEDS, STATUS_LABEL, STEPS, TALK_DEMO, TALK_POINTS, TIERS, TRUST, type Feature, type Status } from './content';
import { Hero } from './Hero';
import { LeadCarousel } from './LeadCarousel';
import { AppLink, EnterLink } from './links';
import { LpFace, releaseFaces } from './LpFace';
import { LpIcon } from './LpIcon';
import { reducedMotion, useReveal } from './motion';
import { Picture } from './Picture';
import { PortraitWall, usePainted, WALL_SIZE } from './PortraitWall';
import './landing.css';

const TITLE = `${BRAND.name} — ${BRAND.tagline}`;

/** Is spoken voice (TTS) configured? With pre-voiced samples, "Hear …" works without it. */
function useCanHear(): boolean {
  const [can, setCan] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch(routePath('capabilities'))
      .then((r) => (r.ok ? (r.json() as Promise<CapabilitiesResponse>) : null))
      .then((c) => alive && setCan(c?.modalities?.tts?.available === true))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return can;
}

function useLandingChrome() {
  useLayoutEffect(() => {
    forceTheme('dark');
    const before = document.title;
    document.title = TITLE;
    return () => {
      forceTheme(null);
      document.title = before === TITLE ? BRAND.name : before;
      releaseFaces();
      void import('./voice').then((m) => m.stopSamples()).catch(() => undefined);
    };
  }, []);
}

/** A link to a section (/#pricing) scrolls there once the page exists: the landing loads lazily, after the browser looked. */
function useHashScroll() {
  useLayoutEffect(() => {
    const id = decodeURIComponent(location.hash.slice(1));
    if (!id) return;
    const target = document.getElementById(id);
    if (target) target.scrollIntoView({ block: 'start' });
  }, []);
}

export function StatusChip({ status }: { status: Status }) {
  return (
    <span class="lp-status" data-status={status}>
      {STATUS_LABEL[status]}
    </span>
  );
}

function SectionHead({ eyebrow, title, lede, id, status, center = false }: { eyebrow: string; title: string; lede?: string; id: string; status?: Status; center?: boolean }) {
  return (
    <div class="lp-head" data-center={center || undefined} data-reveal>
      <p class="lp-eyebrow">
        {eyebrow} {status && <StatusChip status={status} />}
      </p>
      <h2 id={id} class="lp-h2">
        {title}
      </h2>
      {lede && <p class="lp-lede-sm">{lede}</p>}
    </div>
  );
}

function FeatureList({ items }: { items: Feature[] }) {
  return (
    <ul class="lp-features">
      {items.map((f) => (
        <li key={f.title} data-reveal>
          <h3>
            {f.title} {f.status && <StatusChip status={f.status} />}
          </h3>
          <p>{f.body}</p>
        </li>
      ))}
    </ul>
  );
}

const NAV_LINKS = [
  { href: '#how', label: 'How it works' },
  { href: '#meetings', label: 'Meetings' },
  { href: '#leads', label: 'Chiefs of Staff' },
  { href: '#trust', label: 'Trust' },
  { href: '#pricing', label: 'Pricing' },
  { href: '#faq', label: 'FAQ' },
] as const;

function TopNav() {
  const [scrolled, setScrolled] = useState(false);
  const [heroCta, setHeroCta] = useState(true);
  const [menu, setMenu] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 24);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  // Phones: the nav's copy of the call to action stays hidden while the hero's own is on screen (never two at once).
  useEffect(() => {
    const cta = document.querySelector('a[data-hero-cta]');
    if (!cta || typeof IntersectionObserver !== 'function') return setHeroCta(false);
    const io = new IntersectionObserver(([e]) => setHeroCta(!!e?.isIntersecting));
    io.observe(cta);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setMenu(false);
      toggle.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu]);
  return (
    <nav class="lp-nav" data-scrolled={scrolled || menu || undefined} data-hero-visible={heroCta || undefined} data-menu={menu || undefined} aria-label={BRAND.name}>
      <a
        class="lp-brand"
        href="/"
        aria-label={`${BRAND.name}, back to top`}
        onClick={(e) => {
          e.preventDefault();
          setMenu(false);
          window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
        }}
      >
        <span class="lp-lamp" aria-hidden="true" />
        {BRAND.name}
      </a>
      <div class="lp-nav-links" id="lp-nav-links">
        {NAV_LINKS.map((l) => (
          <a key={l.href} href={l.href} onClick={() => setMenu(false)}>
            {l.label}
          </a>
        ))}
      </div>
      <EnterLink class="lp-btn lp-btn-primary lp-btn-sm lp-nav-cta">Enter the office</EnterLink>
      <button ref={toggle} type="button" class="lp-round lp-nav-toggle" aria-expanded={menu} aria-controls="lp-nav-links" aria-label={menu ? 'Close the menu' : 'Open the menu'} onClick={() => setMenu(!menu)}>
        <LpIcon name={menu ? 'close' : 'menu'} />
      </button>
    </nav>
  );
}

/** A centred statement between the hero and the cast: the positioning, said once, big. */
function Statement() {
  return (
    <section class="lp-statement" aria-labelledby="statement-title">
      <h2 id="statement-title" class="lp-statement-text" data-reveal>
        <span>Chat gave you an answer.</span> <span>Builders gave you a flowchart.</span> <span>Avatars gave you a face.</span> <strong>{BRAND.name} gives you staff.</strong>
      </h2>
    </section>
  );
}

function HowItWorks() {
  return (
    <section class="lp-section" id="how" aria-labelledby="how-title">
      <SectionHead id="how-title" eyebrow="How it works" title="You say it once. They take it from there." lede="You talk to one agent, your Chief of Staff. They run the work in the background and bring back only what needs you." />
      <ol class="lp-steps">
        {STEPS.map((s, i) => (
          <li class="lp-step" key={s.n} data-reveal style={{ '--d': i }}>
            <span class="lp-step-n">{s.n}</span>
            <span class="lp-step-icon">
              <LpIcon name={s.icon} size={22} />
            </span>
            <div class="lp-step-text">
              <h3>
                {s.title} <StatusChip status={s.status} />
              </h3>
              <p>{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** A full-bleed band: the generated office floor behind the living-workforce promise, every item with its status. */
function Living() {
  const floor = images.floor;
  return (
    <section class="lp-band" aria-labelledby="living-title">
      {floor && (
        <div class="lp-band-media" aria-hidden="true">
          <Picture image={floor} class="lp-band-img" sizes="100vw" decorative />
        </div>
      )}
      <div class="lp-band-inner">
        <SectionHead
          id="living-title"
          center
          eyebrow="The living workforce"
          status="now"
          title="An office that feels alive, and never fakes it."
          lede="Coworkers that multitask like people do: small talk, quick reactions and hallway chat, all grounded in what is really happening."
        />
        <FeatureList items={LIVING} />
        <div class="lp-speeds" aria-label="Three speeds of thought, all at once" data-reveal>
          {SPEEDS.map((s, i) => (
            <div class="lp-speed" key={s.name} style={{ '--d': i }}>
              <span class="lp-speed-name">
                {s.name} <StatusChip status={s.status} />
              </span>
              <span class="lp-speed-body">{s.body}</span>
            </div>
          ))}
        </div>
        <p class="lp-note lp-center-text">Micro-talk will never claim work that was not done, and laughter never mocks you. One Ambience setting keeps it Quiet, Lively or Buzzing.</p>
      </div>
    </section>
  );
}

function TalkWhileTheyWork() {
  const voice = images.voice;
  return (
    <section class="lp-section lp-split lp-split-rev" aria-labelledby="talk-title">
      <div class="lp-split-text">
        <SectionHead id="talk-title" eyebrow="Talk while they work" status="now" title="Never “busy, try later”." lede="Your Chief of Staff runs a conversation and the work at the same time, so you can ask, redirect or add context mid-task." />
        <FeatureList items={TALK_POINTS} />
      </div>
      <div class="lp-split-media lp-talk-media" data-reveal>
        {voice && <Picture image={voice} class="lp-media-img lp-talk-img" sizes="(max-width: 900px) 100vw, 22vw" />}
        <figure class="lp-chat">
          <div class="lp-chat-job" aria-hidden="true">
            <span class="lp-chip-dot" data-kind="work" />
            <span>Coffee suppliers in Portland</span>
            <span class="lp-chat-bar">
              <span />
            </span>
          </div>
          <ol class="lp-chat-thread">
            {TALK_DEMO.map((m, i) => (
              <li key={i} class="lp-msg" data-from={m.from} data-kind={m.kind} style={{ '--d': i }}>
                <span class="visually-hidden">{m.from === 'you' ? 'You: ' : 'Chief of Staff: '}</span>
                {m.text}
              </li>
            ))}
          </ol>
          <figcaption class="lp-note">
            <span class="lp-illus-tag">Illustration</span> The Talk screen. Status answers come from live job state; the job never pauses to answer.
          </figcaption>
        </figure>
      </div>
    </section>
  );
}

/** Multimodal and the models behind it, in one section: what each works with, as a plain compatibility list. */
function Multimodal() {
  return (
    <section class="lp-section" id="models" aria-labelledby="multi-title">
      <SectionHead id="multi-title" eyebrow="Multimodal" title={"Show\u00a0it. Say\u00a0it. Drop\u00a0it\u00a0in."} lede="Your team works with more than text: they see what you show them, and they make images, short videos and documents you can download." />
      <ul class="lp-mods">
        {MODALITIES.map((m, i) => (
          <li key={m.title} data-reveal style={{ '--d': i }}>
            <span class="lp-mod-icon">
              <LpIcon name={m.icon} size={20} />
            </span>
            <span class="lp-mod-title">{m.title}</span>
            <StatusChip status={m.status} />
            <span class="lp-mod-body">{m.body}</span>
          </li>
        ))}
      </ul>
      <div class="lp-keys" data-reveal>
        <div class="lp-keys-text">
          <h3 class="lp-h3">
            <LpIcon name="key" size={20} /> Bring your own keys, or none at all.
          </h3>
          <p class="lp-lede-sm">{BRAND.name} runs keyless on a built-in demo provider or your local models. Add one key and one capability lights up. Keys stay on your server and never reach the browser.</p>
        </div>
        <ul class="lp-providers" aria-label="Works with">
          {PROVIDERS.map((p) => (
            <li key={p.name}>
              <span class="lp-provider">{p.name}</span>
              <span class="lp-provider-caps">
                {p.caps.map((c) => (
                  <span key={c} class="lp-cap">
                    {c}
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
        <p class="lp-note lp-keys-fine">Provider names are trademarks of their owners, shown as plain text; {BRAND.name} is not affiliated with them.</p>
      </div>
    </section>
  );
}

/** Meetings: the team in a room, the Chief of Staff moderating (an illustration with real catalog faces). */
function Meetings() {
  return (
    <section class="lp-section lp-split" id="meetings" aria-labelledby="meetings-title">
      <div class="lp-split-text">
        <SectionHead id="meetings-title" eyebrow="Meetings" status="now" title="Put the team in a room." lede="Ask your Chief of Staff for a meeting and the right people sit down together. They talk it through one by one, your Chief keeps it moving, and the outcome comes back to you." />
        <FeatureList items={MEETINGS} />
      </div>
      <div class="lp-split-media" data-reveal>
        <MeetingIllustration />
      </div>
    </section>
  );
}

function MeetingIllustration() {
  const withPortrait = usePainted();
  const lead = leads[0];
  const people = useMemo(() => {
    const pool = coworkers.filter((c) => withPortrait.size < 9 || withPortrait.has(c.id));
    return curate(pool, { size: WALL_SIZE + 4, perRow: 6 }).slice(-3);
  }, [withPortrait]);
  if (people.length < 2) return null;
  const [chair, second, third] = people;
  const lines: { who: (typeof people)[number] | null; text: string; phase: string }[] = [
    { who: null, phase: 'moderating', text: `We’re meeting about a monthly crystal box. ${chair!.first} chairs.` },
    { who: chair!, phase: 'frames it', text: 'Three stones a month at $39, or a smaller box at $25? I want your numbers first.' },
    { who: second!, phase: 'opens', text: 'At $39 we keep a 42% margin after shipping. At $25 it drops under 30%.' },
    ...(third ? [{ who: third, phase: 'opens', text: 'Customers on Etsy ask for gift boxes. A three-month gift option could lead.' }] : []),
  ];
  return (
    <figure class="lp-meeting" aria-label="An illustration of a meeting">
      <div class="lp-approval-card lp-meeting-card" aria-hidden="true">
        <div class="lp-meeting-table">
          {lead && (
            <span class="lp-meeting-seat" style={{ '--accent': nightAccent(lead.accent) }}>
              <LpFace subject={lead} tier="token" class="lp-meeting-face" />
              <span class="lp-meeting-name">{lead.first}</span>
              <span>moderates</span>
            </span>
          )}
          {people.map((p, i) => (
            <span key={p.id} class="lp-meeting-seat" data-speaking={i === 1 || undefined} style={{ '--accent': nightAccent(p.accent) }}>
              <LpFace subject={p} tier="token" class="lp-meeting-face" />
              <span class="lp-meeting-name">{p.first}</span>
              {i === 0 && <span>chairs</span>}
            </span>
          ))}
        </div>
        <ul class="lp-meeting-lines">
          {lines.map((l) => (
            <li key={l.text}>
              <span>
                <strong>{l.who ? l.who.first : (lead?.first ?? 'Your Chief')}</strong> <span class="lp-meeting-phase">· {l.phase}</span>
              </span>
              <span class="lp-meeting-text">{l.text}</span>
            </li>
          ))}
        </ul>
        <div class="lp-approval-actions">
          <span class="lp-fake-btn" data-kind="primary">
            Listen in
          </span>
          <span class="lp-fake-btn">Take the floor</span>
        </div>
      </div>
      <figcaption class="lp-note lp-meeting-note">
        <span class="lp-demo-tag">Illustration</span> A meeting as it shows in the app, with coworkers from the catalog.
      </figcaption>
    </figure>
  );
}

/** Your own office: Google sign-in, an office of your own, your people. */
function YourOffice() {
  return (
    <section class="lp-section" id="office" aria-labelledby="office-title">
      <SectionHead id="office-title" eyebrow="Your own office" status="now" title="Start yours in a minute." lede="Every business gets its own office, with its own Chief of Staff, team, memory and files." />
      <FeatureList items={OFFICE} />
      <div class="lp-center">
        <EnterLink class="lp-btn lp-btn-primary">
          Start your office <LpIcon name="arrow" size={16} />
        </EnterLink>
      </div>
    </section>
  );
}

/** A planned approval, drawn with a real coworker's face (an illustration, labelled as one). */
function ApprovalIllustration() {
  const withPortrait = usePainted();
  const who = useMemo(() => {
    const pool = coworkers.filter((c) => withPortrait.size < 9 || withPortrait.has(c.id));
    return curate(pool, { size: WALL_SIZE + 1, perRow: 6 }).at(-1) ?? coworkers[0];
  }, [withPortrait]);
  if (!who) return null;
  return (
    <figure class="lp-approval" style={{ '--accent': nightAccent(who.accent) }}>
      <div class="lp-approval-card" aria-hidden="true">
        <div class="lp-approval-who">
          <LpFace subject={who} tier="tile" class="lp-approval-face" />
          <span class="lp-approval-id">
            <span class="lp-approval-name">{who.first}</span>
            <span class="lp-approval-role">{who.title}</span>
          </span>
          <span class="lp-approval-hand">
            <LpIcon name="hand" size={14} /> Needs you
          </span>
        </div>
        <p class="lp-approval-ask">Email the shortlist to three amethyst wholesalers?</p>
        <ul class="lp-approval-evidence">
          <li>
            <LpIcon name="doc" size={14} /> 3 drafts attached
          </li>
          <li>
            <LpIcon name="check" size={14} /> Sources cited
          </li>
        </ul>
        <div class="lp-approval-actions">
          <span class="lp-fake-btn" data-kind="primary">
            Approve once
          </span>
          <span class="lp-fake-btn">Always for this task</span>
          <span class="lp-fake-btn" data-kind="ghost">
            Not now
          </span>
        </div>
      </div>
      <div class="lp-receipt" aria-hidden="true">
        <LpIcon name="receipt" size={16} /> Receipt · 3 of 3 delivered
      </div>
      <figcaption class="lp-note">
        <span class="lp-illus-tag">Illustration</span> <StatusChip status="planned" /> How an approval will look: nothing leaves without your yes, and every send gets a receipt.
      </figcaption>
    </figure>
  );
}

function Trust() {
  return (
    <section class="lp-section lp-split" id="trust" aria-labelledby="trust-title">
      <div class="lp-split-text">
        <SectionHead id="trust-title" eyebrow="Trust by design" title="Only you decide what leaves the building." lede="Autonomy is earned per action, not granted per agent. Here is what holds today and what is planned." />
        <ul class="lp-trust">
          {TRUST.map((t) => (
            <li key={t.title} data-reveal>
              <span class="lp-mod-icon">
                <LpIcon name={t.icon} size={20} />
              </span>
              <span class="lp-mod-text">
                <span class="lp-mod-title">
                  {t.title} <StatusChip status={t.status} />
                </span>
                <span class="lp-mod-body">{t.body}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div class="lp-split-media" data-reveal>
        <ApprovalIllustration />
      </div>
    </section>
  );
}

/** Industry packs, compressed to one row: all planned, in the order they are planned. */
function Packs() {
  return (
    <section class="lp-section lp-packs-section" aria-labelledby="packs-title">
      <SectionHead id="packs-title" eyebrow="Industry packs" status="planned" title="Coming for your industry." lede="A pack will bring the coworkers, connectors and routines a kind of business needs, including one skeptic who argues for the other side." />
      <ol class="lp-packs">
        {PACKS.map((p, i) => (
          <li class="lp-pack" key={p.name} data-reveal style={{ '--d': i }}>
            <span class="lp-pack-order" aria-label={`Planned, number ${i + 1}`}>
              {String(i + 1).padStart(2, '0')}
            </span>
            <h3>{p.name}</h3>
            <p class="lp-pack-roles">{p.roles}</p>
            <p class="lp-pack-skeptic">
              <LpIcon name="eye" size={14} /> Skeptic: {p.skeptic}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Pricing() {
  return (
    <section class="lp-section" id="pricing" aria-labelledby="pricing-title">
      <div class="lp-head" data-reveal>
        <p class="lp-eyebrow">
          Pricing <span class="lp-status" data-status="planned">Planned pricing</span>
        </p>
        <h2 id="pricing-title" class="lp-h2">
          Seats for people, not for coworkers.
        </h2>
        <p class="lp-lede-sm">Illustrative prices from our product plan. They will be calibrated against real usage before public launch; until then {BRAND.name} runs on design-partner plans.</p>
      </div>
      <ul class="lp-tiers">
        {TIERS.map((t) => (
          <li class="lp-tier" key={t.name} data-highlight={t.note ? '' : undefined} data-reveal>
            {t.note && <p class="lp-tier-note">{t.note}</p>}
            <h3>{t.name}</h3>
            <p class="lp-tier-for">{t.for}</p>
            <p class="lp-tier-price">
              <span class="tabular">{t.price}</span>
              <span class="lp-tier-per">/mo · planned</span>
            </p>
            <ul>
              {t.rows.map((r) => (
                <li key={r}>
                  <LpIcon name="check" size={16} />
                  {r}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      <ul class="lp-principles" data-reveal>
        {PRICING_PRINCIPLES.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
      <div class="lp-pricing-cta" data-reveal>
        <EnterLink class="lp-btn lp-btn-primary lp-btn-lg">
          Enter the office <LpIcon name="arrow" size={18} />
        </EnterLink>
        <p class="lp-note">Nothing to pay to try it today: it runs keyless on the built-in demo provider.</p>
      </div>
    </section>
  );
}

function Faq() {
  return (
    <section class="lp-section lp-faq" id="faq" aria-labelledby="faq-title">
      <SectionHead id="faq-title" eyebrow="FAQ" title="Straight answers." />
      <div class="lp-faq-list">
        {FAQ.map((f) => (
          <details key={f.q} class="lp-faq-item" data-reveal>
            <summary>
              {f.q}
              <LpIcon name="plus" size={18} class="lp-faq-icon" />
            </summary>
            <p>{f.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section class="lp-final" aria-labelledby="final-title">
      <div class="lp-aurora lp-aurora-soft" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </div>
      <div class="lp-final-inner" data-reveal>
        <h2 id="final-title" class="lp-final-title">
          Walk in.
        </h2>
        <p class="lp-lede-sm">Start your office, pick a Chief of Staff, hire your first coworkers and hand them something small. Then watch the office get to work.</p>
        <EnterLink class="lp-btn lp-btn-primary lp-btn-lg">
          Enter the office <LpIcon name="arrow" size={18} />
        </EnterLink>
      </div>
    </section>
  );
}

export function Landing() {
  useLandingChrome();
  useHashScroll();
  const root = useRef<HTMLDivElement>(null);
  useReveal(root);
  const tts = useCanHear();
  const n = counts.leads || leads.length;
  return (
    <div class="lp" ref={root}>
      <a class="skip-link" href="#lp-main">
        Skip to content
      </a>
      <TopNav />
      <Hero />
      <main id="lp-main" tabIndex={-1}>
        <Statement />
        <section class="lp-section lp-wall-section" aria-labelledby="wall-title">
          <SectionHead id="wall-title" eyebrow="Meet the office" title="Meet the people you can hire." lede={`${counts.coworkers} coworkers across ${counts.departments} departments, each with a face, a voice and a craft, and ${countWord(n)} Chiefs of Staff to run them. Your Chief of Staff suggests who your business needs; you hire them in a click.`} />
          <PortraitWall />
          <p class="lp-caption">
            <span class="lp-demo-tag">Demo</span> The side-talk on this wall is a demonstration. In your office it will come from real hand-offs, asks and results.
          </p>
        </section>
        <HowItWorks />
        <Meetings />
        <section class="lp-section" id="leads" aria-labelledby="leads-title">
          <SectionHead id="leads-title" eyebrow="Meet your Chief of Staff" title="Who runs the office with you?" lede={`${countWord(n, true)} personalities, each with a name, a voice and a backstory. A short match quiz inside helps you pick, and you can switch any time.`} />
          <LeadCarousel canHear={(id) => tts || !!voiceSamples[id]} />
          <div class="lp-center">
            <AppLink href={paths.onboarding} class="lp-btn lp-btn-ghost">
              Take the match quiz <LpIcon name="arrow" size={16} />
            </AppLink>
          </div>
        </section>
        <Living />
        <TalkWhileTheyWork />
        <Multimodal />
        <Trust />
        <YourOffice />
        <Packs />
        <Pricing />
        <Faq />
        <FinalCta />
      </main>
      <footer class="lp-footer">
        <span class="lp-brand">
          <span class="lp-lamp" aria-hidden="true" />
          {BRAND.name}
        </span>
        <span class="lp-footer-note">The AI Office. Every coworker is an AI, and says so.</span>
        <EnterLink class="lp-footer-link">Enter the office</EnterLink>
      </footer>
    </div>
  );
}
