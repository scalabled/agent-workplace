// First run: choose your Chief of Staff from the 12 catalog leads (D1). One stage for the lead you are
// looking at (face, voice sample, backstory teaser, "best for owners who…", name them, Choose), a
// gallery of all twelve, and an optional match quiz that marks your top three.
import { signal } from '@preact/signals';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { firstName, leadVoiceRef, type Lead, type MatchQuiz, type QuizAnswers } from '@headcount/catalog';
import { catalog, loadCatalog } from '../catalog';
import { Face, leadSubject } from '../components/Face';
import { Icon } from '../components/Icon';
import { useSampleSpeaker, VoiceSample } from '../components/VoiceSample';
import { builtinQuiz, topMatches, type Match } from '../onboarding/quiz';
import { navigate, paths } from '../router';
import { can, localPresence, onboarded, settings } from '../store';
import { PortraitAction } from '../components/PortraitAction';
import { ownerNameProblem, updateSettings } from '../talk/actions';
import { greetOnArrival } from '../talk/draft';
import { armAudio } from '../voice/engine';
import './onboarding.css';
import { accentFor } from '../lib/accent';

const matches = signal<Match[]>([]);

export function Onboarding() {
  useEffect(() => void loadCatalog(), []);
  const c = catalog.value;
  const leads = c?.catalog.leads ?? [];
  const current = settings.value?.leadId ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [quizOpen, setQuizOpen] = useState(false);
  const selected = leads.find((l) => l.id === selectedId) ?? leads.find((l) => l.id === current) ?? leads[0];
  const quiz = useMemo<{ quiz: MatchQuiz; builtin: boolean } | null>(() => (c ? (c.catalog.matchQuiz ? { quiz: c.catalog.matchQuiz, builtin: false } : { quiz: builtinQuiz(c.catalog.leads), builtin: true }) : null), [c]);
  const top = matches.value;
  const stageRef = useRef<HTMLDivElement>(null);
  const [revealMatches, setRevealMatches] = useState(0);

  // After the quiz, bring the result into view once it has rendered. On phones the matches sit above the stage
  // (and the pinned footer carries the name and Choose), so show the list with the top match; elsewhere the
  // stage is what changed.
  useEffect(() => {
    if (!revealMatches || typeof window === 'undefined') return;
    const raf = requestAnimationFrame(() => {
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      const phone = window.matchMedia?.('(max-width: 640px)').matches;
      const target = phone ? document.getElementById('matches-title') : stageRef.current;
      target?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    });
    return () => cancelAnimationFrame(raf);
  }, [revealMatches]);

  const select = (id: string, scroll = false) => {
    setSelectedId(id);
    // Bring the stage into view when it is off screen (stacked layouts); never jump when it is visible.
    const el = stageRef.current;
    if (!scroll || !el || typeof window === 'undefined') return;
    const top = el.getBoundingClientRect().top;
    if (top < 0 || top > window.innerHeight * 0.6) {
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    }
  };

  if (!c || !selected)
    return (
      <section class="welcome" aria-busy="true">
        <h1>Choose your Chief of Staff</h1>
        <p class="page-lede">Gathering everyone…</p>
      </section>
    );

  return (
    <section class="welcome" aria-labelledby="welcome-title">
      <header class="welcome-head">
        {onboarded.value && (
          <a
            class="welcome-back"
            href={paths.talk}
            onClick={(e) => {
              e.preventDefault();
              navigate(paths.talk);
            }}
          >
            <Icon name="chevronLeft" size={18} /> Back to Talk
          </a>
        )}
        <h1 id="welcome-title">Choose your Chief of Staff</h1>
        <p class="page-lede">They run the office with you: take on work, staff it and keep you posted. Everyone here is an AI coworker. You can switch later.</p>
        {quiz && (
          <button type="button" class="button-quiet welcome-quiz" onClick={() => setQuizOpen(true)}>
            <Icon name="sparkle" size={18} />
            {top.length ? 'Retake the match quiz' : `Find your match · ${quiz.quiz.questions.length} questions`}
          </button>
        )}
      </header>

      <div class="welcome-body">
        <div class="stage-wrap" ref={stageRef}>
          <Stage lead={selected} match={top.find((m) => m.lead.id === selected.id)} previewLine={quiz?.quiz.try_before_choosing?.voice_preview_line} />
        </div>
        <div class="gallery-wrap">
          {top.length > 0 && <MatchList matches={top} selectedId={selected.id} onSelect={(id) => select(id, true)} />}
          <h2 class="gallery-title">{top.length ? 'Everyone' : 'All twelve'}</h2>
          <ul class="gallery" aria-label="Chiefs of Staff">
            {leads.map((l) => {
              const rank = top.find((m) => m.lead.id === l.id)?.rank;
              return (
                <li key={l.id}>
                  <button type="button" class="gallery-card" aria-pressed={l.id === selected.id} onClick={() => select(l.id, true)} style={{ '--accent': accentFor(l.avatar.accent_color) }}>
                    <Face subject={leadSubject(l)} tier="token" decorative lazy />
                    <span class="gallery-name">{firstName(l.name)}</span>
                    <span class="gallery-arch">{l.archetype}</span>
                    {rank && <span class="gallery-rank">{rank === 1 ? 'Top match' : `Match ${rank}`}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {quizOpen && quiz && (
        <QuizDialog
          quiz={quiz.quiz}
          canHear={can('tts')}
          onClose={() => setQuizOpen(false)}
          onDone={(answers) => {
            const m = topMatches(quiz.quiz, answers, leads, quiz.builtin);
            matches.value = m;
            setQuizOpen(false);
            if (m[0]) select(m[0].lead.id);
            setRevealMatches((n) => n + 1);
          }}
        />
      )}
    </section>
  );
}

function teaser(backstory: string): string {
  const sentences = backstory.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [backstory];
  let out = '';
  for (const s of sentences) {
    if (out && out.length + s.length > 260) break;
    out += s;
  }
  return out.trim();
}

function Stage({ lead, match, previewLine }: { lead: Lead; match: Match | undefined; previewLine: string | undefined }) {
  const first = firstName(lead.name);
  const [name, setName] = useState(first);
  // What the office calls the owner: optional, skipped by default (OFFICE-PHASE2 §4.6).
  const [ownerName, setOwnerName] = useState(settings.value?.ownerName ?? '');
  const [ownerError, setOwnerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);
  const speaker = useSampleSpeaker(`sample:${lead.id}`, leadVoiceRef(lead));
  const speaking = Boolean(localPresence.value[speaker.speakerId]?.speaking);
  const pronoun = lead.pronouns === 'she/her' ? 'her' : lead.pronouns === 'he/him' ? 'him' : 'them';

  useEffect(() => {
    setName(settings.value?.leadId === lead.id && settings.value.chiefName ? settings.value.chiefName : first);
    setMore(false);
  }, [lead.id]);

  const choose = async (e: Event) => {
    e.preventDefault();
    if (busy) return;
    armAudio(); // the choice is the gesture that lets the greeting play
    speaker.stop();
    // The owner's name rides on the same save; blank sends nothing (a name set before stays).
    const owner = ownerName.replace(/\s+/g, ' ').trim();
    const problem = owner ? ownerNameProblem(owner) : null;
    setOwnerError(problem);
    if (problem) return;
    setBusy(true);
    const trimmed = name.trim().slice(0, 40);
    const ok = await updateSettings({
      leadId: lead.id,
      chiefName: trimmed && trimmed !== first ? trimmed : null,
      ...(owner && owner !== (settings.value?.ownerName ?? '') ? { ownerName: owner } : {}),
    });
    setBusy(false);
    if (ok) {
      greetOnArrival.value = true;
      navigate(paths.talk);
    }
  };

  return (
    <article class="stage" style={{ '--accent': accentFor(lead.avatar.accent_color) }} aria-labelledby="stage-name">
      <div class="stage-face">
        <Face subject={leadSubject(lead)} tier="hero" state={speaking ? 'speaking' : 'idle'} sampler={speaker.mouth} label={`${lead.name}, ${lead.archetype}`} />
        <PortraitAction id={lead.id} name={lead.name} />
      </div>
      <div class="stage-body">
        <p class="stage-arch">{lead.archetype}</p>
        <h2 id="stage-name" class="stage-name">
          {lead.name}
        </h2>
        <p class="stage-tagline">{lead.tagline}</p>
        {match && (
          <p class="stage-why">
            <span class="stage-why-k">{match.rank === 1 ? 'Your top match' : `Match ${match.rank}`}</span>
            {match.why}
          </p>
        )}
        <VoiceSample speaker={speaker} text={previewLine ?? lead.communication.greeting} name={first} />
        <p class="stage-story">{more ? lead.backstory : teaser(lead.backstory)}</p>
        {!more && lead.backstory.length > teaser(lead.backstory).length && (
          <button type="button" class="link-button link-button-hit" onClick={() => setMore(true)}>
            Read {first}'s story
          </button>
        )}
        <div class="stage-fit">
          <h3>Best for owners who</h3>
          <ul>
            {lead.best_for_owners_who.slice(0, 3).map((b) => (
              <li key={b}>{b.replace(/^[A-Z]/, (ch) => ch.toLowerCase())}</li>
            ))}
          </ul>
        </div>
        <p class="stage-honesty">{first} is an AI coworker. The backstory is character lore, not real events.</p>
        {/* Above Choose, so the owner meets it before the primary action; outside the form's box (pinned to the bottom
            on phones), still part of it: Enter here chooses too. */}
        <label class="stage-name-field stage-owner-field">
          <span>What should the office call you?</span>
          <input
            form="stage-choose"
            value={ownerName}
            maxLength={40}
            autoComplete="given-name"
            aria-describedby="stage-owner-hint"
            aria-invalid={ownerError ? 'true' : undefined}
            onInput={(e) => {
              setOwnerName(e.currentTarget.value);
              if (ownerError) setOwnerError(null);
            }}
          />
          <span id="stage-owner-hint" class="stage-owner-hint" role={ownerError ? 'alert' : undefined}>
            {ownerError ?? 'Optional. Used in greetings.'}
          </span>
        </label>
        <form class="stage-choose" id="stage-choose" onSubmit={choose}>
          <label class="stage-name-field">
            <span>Call {pronoun}</span>
            <input value={name} maxLength={40} autoComplete="off" onInput={(e) => setName(e.currentTarget.value)} />
          </label>
          <button type="submit" class="button-primary" disabled={busy}>
            {`Choose ${name.trim().slice(0, 40) || first}`}
          </button>
        </form>
      </div>
    </article>
  );
}

function MatchList({ matches: list, selectedId, onSelect }: { matches: Match[]; selectedId: string; onSelect: (id: string) => void }) {
  return (
    <section class="matches" aria-labelledby="matches-title">
      <h2 id="matches-title" class="gallery-title">
        Your matches
      </h2>
      <ol>
        {list.map((m) => (
          <li key={m.lead.id}>
            <button type="button" class="match" aria-pressed={m.lead.id === selectedId} onClick={() => onSelect(m.lead.id)} style={{ '--accent': accentFor(m.lead.avatar.accent_color) }}>
              <Face subject={leadSubject(m.lead)} tier="token" decorative />
              <span class="match-text">
                <span class="match-name">
                  {firstName(m.lead.name)} <span class="match-arch">· {headlineWithoutName(m.headline, firstName(m.lead.name))}</span>
                </span>
                <span class="match-why">{m.why}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** The catalog headline already starts with the name ("<First>: explains the why…"); the list shows the name once. */
export function headlineWithoutName(headline: string, first: string): string {
  const escaped = first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rest = headline.replace(new RegExp(`^${escaped}\\s*[:·—–-]\\s*`), '');
  return rest || headline;
}

/**
 * Keyless, nobody can be heard: drop the intro's promise to hear the top three (a capability without a key is
 * hidden, never promised). The rest of the sentence ("you can switch any time") is kept.
 */
export function quizIntro(intro: string, canHear: boolean): string {
  if (canHear) return intro;
  const sentences = intro.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [intro];
  let out = '';
  for (const sentence of sentences) {
    if (!/\b(hear|listen)\b/i.test(sentence)) {
      out += sentence;
      continue;
    }
    const keep = /\byou can switch[^.!?]*/i.exec(sentence)?.[0];
    if (keep) out += `${keep[0]!.toUpperCase()}${keep.slice(1)}. `;
  }
  return out.trim() || intro;
}

function QuizDialog({ quiz, canHear, onClose, onDone }: { quiz: MatchQuiz; canHear: boolean; onClose: () => void; onDone: (a: QuizAnswers) => void }) {
  const [i, setI] = useState(0);
  const [answers, setAnswers] = useState<QuizAnswers>({});
  const q = quiz.questions[i]!;
  const last = i === quiz.questions.length - 1;
  const dialog = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null);

  useEffect(() => {
    dialog.current?.querySelector<HTMLElement>('input, button.quiz-option, .quiz-next')?.focus();
  }, [i]);
  useEffect(() => () => returnTo.current?.focus?.(), []);

  const next = (a: QuizAnswers) => {
    setAnswers(a);
    if (last) onDone(a);
    else setI(i + 1);
  };
  const answer = answers[q.id];

  return (
    <div class="sheet-scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        class="sheet quiz"
        role="dialog"
        aria-modal="true"
        aria-labelledby="quiz-q"
        ref={dialog}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          } else if (e.key === 'Tab') trapTab(e, e.currentTarget);
        }}
      >
        <div class="quiz-top">
          <span class="quiz-step tabular">
            {i + 1} of {quiz.questions.length}
          </span>
          <button type="button" class="icon-button" aria-label="Close the quiz" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        {i === 0 && <p class="quiz-intro">{quizIntro(quiz.intro, canHear)}</p>}
        <h2 id="quiz-q" class="quiz-q">
          {q.prompt}
        </h2>
        {q.kind === 'scale' && q.scale ? (
          <ScaleQuestion q={q} value={typeof answer === 'number' ? answer : undefined} onNext={(v) => next({ ...answers, [q.id]: v })} last={last} />
        ) : q.kind === 'multi' ? (
          <MultiQuestion q={q} value={Array.isArray(answer) ? answer : []} onNext={(v) => next({ ...answers, [q.id]: v })} last={last} />
        ) : (
          <div class="quiz-options" role="group" aria-labelledby="quiz-q">
            {(q.options ?? []).map((o) => (
              <button key={o.id} type="button" class="quiz-option" aria-pressed={answer === o.id} onClick={() => next({ ...answers, [q.id]: o.id })}>
                {o.label}
              </button>
            ))}
          </div>
        )}
        {i > 0 && (
          <button type="button" class="link-button quiz-back" onClick={() => setI(i - 1)}>
            Back
          </button>
        )}
      </div>
    </div>
  );
}

/** Keep Tab inside a modal dialog. */
function trapTab(e: KeyboardEvent, root: HTMLElement) {
  const items = [...root.querySelectorAll<HTMLElement>('button, input, [href], [tabindex]:not([tabindex="-1"])')].filter((el) => !el.hasAttribute('disabled'));
  if (!items.length) return;
  const first = items[0]!;
  const last = items[items.length - 1]!;
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

type Question = MatchQuiz['questions'][number];

function MultiQuestion({ q, value, onNext, last }: { q: Question; value: string[]; onNext: (v: string[]) => void; last: boolean }) {
  const [picked, setPicked] = useState<string[]>(value);
  return (
    <>
      <div class="quiz-options" role="group" aria-labelledby="quiz-q">
        {(q.options ?? []).map((o) => (
          <label key={o.id} class="quiz-option quiz-check">
            <input type="checkbox" checked={picked.includes(o.id)} onChange={(e) => setPicked(e.currentTarget.checked ? [...picked, o.id] : picked.filter((x) => x !== o.id))} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
      <button type="button" class="button-primary quiz-next" onClick={() => onNext(picked)}>
        {last ? 'See my matches' : 'Next'}
      </button>
    </>
  );
}

function ScaleQuestion({ q, value, onNext, last }: { q: Question; value: number | undefined; onNext: (v: number) => void; last: boolean }) {
  const s = q.scale!;
  const [v, setV] = useState(value ?? Math.round((s.min + s.max) / 2));
  return (
    <>
      <div class="quiz-scale">
        <input type="range" min={s.min} max={s.max} step={1} value={v} aria-labelledby="quiz-q" aria-valuetext={`${v} of ${s.max}`} onInput={(e) => setV(Number(e.currentTarget.value))} />
        <div class="quiz-scale-labels">
          <span>{s.low_label}</span>
          <span>{s.high_label}</span>
        </div>
      </div>
      <button type="button" class="button-primary quiz-next" onClick={() => onNext(v)}>
        {last ? 'See my matches' : 'Next'}
      </button>
    </>
  );
}
