// Hire your team (a new office starts with its Chief of Staff alone). The Chief suggests people for this business
// (from what the owner says it does, else the Handbook); each card says what they will do and their first job, with
// their voice. The owner picks and hires; each new hire is welcomed in Talk. Anyone else in the directory can be found
// and hired too. Reached from onboarding (?first=1, then Talk) and from the Team page and the office.
import { firstName, personaVoiceRef, type PersonaSlim } from '@headcount/catalog';
import { coworkerAgentId } from '@headcount/protocol';
import type { Candidate, SuggestResponse } from '@headcount/protocol/ext/team';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { api, ApiError } from '../api/client';
import { currentOrg, isOwner } from '../auth/session';
import { catalog, loadCatalog } from '../catalog';
import { chiefName } from '../chief';
import { Face, personaSubject } from '../components/Face';
import { Icon } from '../components/Icon';
import { Link } from '../components/Link';
import { useSampleSpeaker, VoiceSample } from '../components/VoiceSample';
import { accentFor } from '../lib/accent';
import { PageTitle } from '../links/CopyLink';
import { navigate, paths, queryParam } from '../router';
import { localPresence, teamIds } from '../store';
import { greetOnArrival } from '../talk/draft';
import './pages.css';
import './hire.css';

const errorOf = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

export function Hire() {
  useEffect(() => void loadCatalog(), []);
  const first = queryParam('first') === '1';
  const [about, setAbout] = useState('');
  const [data, setData] = useState<SuggestResponse | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const c = catalog.value;
  const chief = chiefName.value;
  const org = currentOrg.value?.name ?? 'your business';

  const suggest = async (text = '') => {
    setError(null);
    try {
      const r = await api.suggestHires(text);
      setData(r);
      if (!text && r.about) setAbout(r.about);
      // The recommended few start picked on a first visit with nothing chosen yet.
      setPicked((p) => (p.length ? p : first ? r.candidates.filter((x) => x.recommended).map((x) => x.personaId) : p));
    } catch (err) {
      setError(errorOf(err, 'Could not load suggestions.'));
    }
  };
  useEffect(() => void suggest(), []);

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const describe = async (e: Event) => {
    e.preventDefault();
    const text = about.trim();
    await suggest(text);
    // What the owner says the business is starts the Handbook, if it is empty.
    if (text && isOwner.value) {
      const hb = await api.getHandbook().catch(() => null);
      if (hb && !hb.sections.find((s) => s.id === 'business')?.content) void api.putHandbook('business', text).catch(() => undefined);
    }
  };
  const hire = async () => {
    if (!picked.length || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.hire(picked);
      teamIds.value = r.team.members.map((m) => m.personaId);
      if (first) {
        greetOnArrival.value = true;
        navigate(paths.talk);
      } else navigate(paths.team);
    } catch (err) {
      setError(errorOf(err, 'They could not be hired. Try again.'));
      setBusy(false);
    }
  };

  const onTeam = new Set(teamIds.value ?? []);
  const suggested = new Set((data?.candidates ?? []).map((x) => x.personaId));
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const others = useMemo(() => {
    if (!c || !terms.length) return [];
    return c.catalog.personas.filter((p) => !onTeam.has(p.id) && !suggested.has(p.id) && terms.every((t) => `${p.name} ${p.title} ${p.department} ${p.one_liner}`.toLowerCase().includes(t))).slice(0, 12);
  }, [c, query, data, teamIds.value]);

  if (!isOwner.value)
    return (
      <section class="page hire-page" aria-labelledby="hire-title">
        <PageTitle id="hire-title">Hire your team</PageTitle>
        <p class="page-lede">Only an owner can hire. You can meet everyone on the Floor and ask an owner to bring someone on.</p>
      </section>
    );

  const people = (data?.candidates ?? []).filter((x) => !onTeam.has(x.personaId));
  const pickedNames = picked.map((id) => firstName(c?.persona(id)?.name ?? id));
  return (
    <section class="page hire-page" aria-labelledby="hire-title">
      <header class="page-head">
        <PageTitle id="hire-title">{first ? 'Hire your first coworkers' : 'Hire someone'}</PageTitle>
        <p class="page-lede">
          {chief} suggests people for {org}. Meet them, hear them, and hire the ones you want: each joins with a first job ready. You can hire more any time, or bring specialists into a project for a while.
        </p>
      </header>

      <form class="panel hire-about" onSubmit={describe}>
        <label class="field-label" for="hire-about">
          What does {org} do?
        </label>
        <textarea id="hire-about" class="note-input" rows={3} maxLength={1000} placeholder="e.g. An online crystal shop selling healing crystals and gemstones on Shopify and Etsy" value={about} onInput={(e) => setAbout((e.target as HTMLTextAreaElement).value)} />
        <div class="admin-row">
          <button type="submit" class="button-quiet">
            <Icon name="sparkle" size={16} /> Suggest people for this
          </button>
          <span class="page-fine">{chief} uses it to pick, and it starts your Handbook.</span>
        </div>
      </form>

      {error && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}
      {!data && !error && <p class="page-fine">{chief} is thinking about who you need…</p>}

      {c && people.length > 0 && (
        <ul class="hire-grid" aria-label="Suggested coworkers">
          {people.map((x) => {
            const p = c.persona(x.personaId);
            return p ? <HireCard key={x.personaId} candidate={x} persona={p} chief={chief} picked={picked.includes(x.personaId)} onToggle={() => toggle(x.personaId)} /> : null;
          })}
        </ul>
      )}

      <section class="panel hire-more" aria-labelledby="hire-more-title">
        <h2 id="hire-more-title" class="admin-card-title">
          Someone else?
        </h2>
        <label class="field-search">
          <Icon name="search" size={18} />
          <span class="visually-hidden">Search everyone</span>
          <input type="search" value={query} placeholder="A role, a skill or a name: legal, video, design…" autoComplete="off" onInput={(e) => setQuery(e.currentTarget.value)} />
        </label>
        {terms.length > 0 && (
          <ul class="hire-list">
            {others.length === 0 && <li class="page-fine">No one matches. Try a plainer word, or browse the whole directory on the Floor.</li>}
            {others.map((p) => (
              <li key={p.id} class="hire-row" style={{ '--accent': accentFor(p.avatar.accent_color) }}>
                <Face subject={personaSubject(p)} tier="token" agentId={coworkerAgentId(p.id)} decorative lazy />
                <span class="hire-row-text">
                  <Link href={paths.coworker(p.id)} class="hire-name">
                    {p.name}
                  </Link>
                  <span class="page-fine">
                    {p.title} · {p.one_liner}
                  </span>
                </span>
                <button type="button" class="button-quiet" aria-pressed={picked.includes(p.id)} onClick={() => toggle(p.id)}>
                  <Icon name={picked.includes(p.id) ? 'check' : 'plus'} size={16} /> {picked.includes(p.id) ? 'Hiring' : 'Hire'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div class="hire-bar" role="region" aria-label="Your choice">
        <p class="hire-bar-text">{picked.length ? `Hiring ${pickedNames.slice(0, 4).join(', ')}${picked.length > 4 ? ` and ${picked.length - 4} more` : ''}` : 'Pick who to hire.'}</p>
        <button type="button" class="button-primary" disabled={!picked.length || busy} onClick={() => void hire()}>
          {busy ? 'Hiring…' : picked.length ? `Hire ${picked.length === 1 ? pickedNames[0] : picked.length}` : 'Hire'}
        </button>
        {first ? (
          <button
            type="button"
            class="link-button"
            onClick={() => {
              greetOnArrival.value = true;
              navigate(paths.talk);
            }}
          >
            Not now
          </button>
        ) : (
          <Link href={paths.team} class="link-button">
            Back to your team
          </Link>
        )}
      </div>
    </section>
  );
}

function HireCard({ candidate: x, persona: p, chief, picked, onToggle }: { candidate: Candidate; persona: PersonaSlim; chief: string; picked: boolean; onToggle: () => void }) {
  const agentId = coworkerAgentId(p.id);
  const speaker = useSampleSpeaker(agentId, personaVoiceRef(p));
  const speaking = Boolean(localPresence.value[speaker.speakerId]?.speaking);
  const first = firstName(p.name);
  return (
    <li class="panel hire-card" data-picked={picked || undefined} style={{ '--accent': accentFor(p.avatar.accent_color) }}>
      <div class="hire-card-head">
        <Face subject={personaSubject(p)} tier="tile" state={speaking ? 'speaking' : 'idle'} sampler={speaker.mouth} agentId={agentId} label={`${p.name}, ${p.title}`} />
        <div class="hire-card-who">
          {x.recommended && <span class="connector-tag hire-pick">{chief}’s pick</span>}
          <Link href={paths.coworker(p.id)} class="hire-name">
            {p.name}
          </Link>
          <span class="hire-title">{p.title}</span>
        </div>
      </div>
      <p class="hire-why">{x.why}</p>
      {x.does.length > 0 && (
        <>
          <p class="hire-label">{first} will do things like</p>
          <ul class="hire-does">
            {x.does.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </>
      )}
      <p class="hire-first">
        <span class="hire-label">First job:</span> {x.firstTask.title}
      </p>
      <div class="hire-card-actions">
        <VoiceSample speaker={speaker} text={p.intro_line} name={first} />
        <button type="button" class={picked ? 'button-primary' : 'button-quiet'} aria-pressed={picked} onClick={onToggle}>
          <Icon name={picked ? 'check' : 'plus'} size={16} /> {picked ? `Hiring ${first}` : `Hire ${first}`}
        </button>
      </div>
    </li>
  );
}
