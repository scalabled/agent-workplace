// The releases page ("/releases", public): what is new in the latest release, a guide to every feature with how to use
// it (searchable, grouped by area, linked into the app), and every release so far. The content is data
// (./content.ts); a release adds an entry there. Dark like the landing page; loaded on its own, without the app.
import { BRAND } from '@headcount/protocol';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { AppLink, EnterLink } from '../landing/links';
import { AREAS, GUIDE, LATEST, longDate, RELEASES, type GuideEntry } from './content';
import './releases.css';

const TITLE = `Releases — ${BRAND.name}`;

export function Releases() {
  const [query, setQuery] = useState('');
  useEffect(() => {
    const before = document.title;
    document.title = TITLE;
    // A link to a feature (#guide-…) or a release (#release-…) scrolls there once the page is drawn.
    const hash = location.hash.slice(1);
    if (hash) requestAnimationFrame(() => document.getElementById(hash)?.scrollIntoView());
    return () => void (document.title = before === TITLE ? BRAND.name : before);
  }, []);
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = useMemo(() => (terms.length ? GUIDE.filter((g) => terms.every((t) => `${g.title} ${g.what} ${g.steps.join(' ')}`.toLowerCase().includes(t))) : GUIDE), [query]);
  return (
    <div class="rl">
      <a class="skip-link" href="#rl-main">
        Skip to content
      </a>
      <header class="rl-top">
        <a class="rl-brand" href="/">
          <span class="rl-lamp" aria-hidden="true" />
          {BRAND.name}
        </a>
        <nav class="rl-links" aria-label="On this page">
          <a href="#latest">What’s new</a>
          <a href="#guide">Feature guide</a>
          <a href="#history">All releases</a>
        </nav>
        <EnterLink class="rl-btn rl-btn-primary">Enter the office</EnterLink>
      </header>

      <main id="rl-main" tabIndex={-1}>
        <section class="rl-hero" aria-labelledby="rl-title">
          <p class="rl-eyebrow">Releases</p>
          <h1 id="rl-title">What’s new in {BRAND.name}</h1>
          <p class="rl-lede">Every feature, and how to use it. This page grows with every release.</p>
        </section>

        <section id="latest" class="rl-latest" aria-labelledby="rl-latest-title">
          <p class="rl-meta">
            <span class="rl-new">Latest</span> Version {LATEST.version} · {longDate(LATEST.date)}
          </p>
          <h2 id="rl-latest-title">{LATEST.title}</h2>
          <p class="rl-summary">{LATEST.summary}</p>
          <ul class="rl-highlights">
            {LATEST.changes.map((c) => (
              <li key={c.text}>
                <span>{c.text}</span>
                {c.guide && (
                  <a href={`#guide-${c.guide}`} class="rl-howto">
                    How to use it
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section id="guide" class="rl-guide" aria-labelledby="rl-guide-title">
          <div class="rl-guide-head">
            <h2 id="rl-guide-title">Feature guide</h2>
            <label class="rl-search">
              <span class="visually-hidden">Find a feature</span>
              <input type="search" placeholder="Find a feature: meetings, images, email…" value={query} onInput={(e) => setQuery((e.target as HTMLInputElement).value)} />
            </label>
          </div>
          {!terms.length && (
            <nav class="rl-areas" aria-label="Areas">
              {AREAS.map((a) => (
                <a key={a.id} href={`#area-${a.id}`}>
                  {a.title}
                </a>
              ))}
            </nav>
          )}
          {terms.length > 0 && shown.length === 0 && <p class="rl-empty">Nothing matches “{query.trim()}”. Try a plainer word, or ask your Chief of Staff in Talk.</p>}
          {AREAS.map((a) => {
            const entries = shown.filter((g) => g.area === a.id);
            if (!entries.length) return null;
            return (
              <section key={a.id} id={`area-${a.id}`} class="rl-area" aria-labelledby={`area-${a.id}-title`}>
                <h3 id={`area-${a.id}-title`}>{a.title}</h3>
                <p class="rl-area-lede">{a.lede}</p>
                <div class="rl-cards">
                  {entries.map((g) => (
                    <GuideCard key={g.id} entry={g} />
                  ))}
                </div>
              </section>
            );
          })}
        </section>

        <section id="history" class="rl-history" aria-labelledby="rl-history-title">
          <h2 id="rl-history-title">All releases</h2>
          <ol class="rl-releases">
            {RELEASES.map((r) => (
              <li key={r.version} id={`release-${r.version}`} class="rl-release">
                <p class="rl-meta">
                  Version {r.version} · {longDate(r.date)}
                </p>
                <h3>{r.title}</h3>
                <p class="rl-summary">{r.summary}</p>
                <ul>
                  {r.changes.map((c) => (
                    <li key={c.text}>{c.guide ? <a href={`#guide-${c.guide}`}>{c.text}</a> : c.text}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </section>
      </main>

      <footer class="rl-footer">
        <span class="rl-brand">
          <span class="rl-lamp" aria-hidden="true" />
          {BRAND.name}
        </span>
        <span>Every coworker is an AI, and says so.</span>
        <a href="/">Home</a>
      </footer>
    </div>
  );
}

function GuideCard({ entry: g }: { entry: GuideEntry }) {
  return (
    <article id={`guide-${g.id}`} class="rl-card" aria-labelledby={`guide-${g.id}-title`}>
      <h4 id={`guide-${g.id}-title`}>
        {g.title} {g.since === LATEST.version && <span class="rl-new">New</span>}
      </h4>
      <p class="rl-what">{g.what}</p>
      <p class="rl-how">How to use it</p>
      <ol class="rl-steps">
        {g.steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      {g.open && (
        <AppLink href={g.open.href} class="rl-open">
          {g.open.label} →
        </AppLink>
      )}
    </article>
  );
}
