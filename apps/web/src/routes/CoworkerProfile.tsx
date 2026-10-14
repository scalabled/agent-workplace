// Coworker profile (from the Floor): hero face, intro line, story, signature methods, voice sample — and, for the
// owner, how they work (instructions, tools, model, skills) and the exact prompts they run on.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { AgentView } from '@headcount/protocol/ext/agents';
import { api, ApiError } from '../api/client';
import { AgentSettings } from '../agents/AgentSettings';
import { PromptViewer } from '../agents/PromptViewer';
import { coworkerAgentId } from '@headcount/protocol';
import { firstName, personaVoiceRef, type PersonaSlim, type SkillIndexEntry } from '@headcount/catalog';
import { catalog, loadCatalog } from '../catalog';
import { chiefName } from '../chief';
import { Face, personaSubject } from '../components/Face';
import { Icon } from '../components/Icon';
import { PortraitAction } from '../components/PortraitAction';
import { Link } from '../components/Link';
import { SideThread } from '../components/SideThread';
import { isOwner } from '../auth/session';
import { ContextFiles } from '../memory/ContextFiles';
import { PageTitle } from '../links/CopyLink';
import { showToast } from '../links/links';
import { useSampleSpeaker, VoiceSample } from '../components/VoiceSample';
import { navigate, paths, linkTarget, queryParam, setQuery, linkTo } from '../router';
import { localPresence, onboarded, teamIds } from '../store';
import { prefillComposer } from '../talk/draft';
import './floor.css';
import { accentFor } from '../lib/accent';

const SENIORITY: Record<PersonaSlim['seniority'], string> = { specialist: 'Specialist', senior: 'Senior', lead: 'Lead', principal: 'Principal' };

export function CoworkerProfile({ personaId }: { personaId: string }) {
  useEffect(() => void loadCatalog(), []);
  // A new profile starts at the top, unless a link points somewhere on it.
  useEffect(() => void (linkTarget.value ? undefined : window.scrollTo?.(0, 0)), [personaId]);
  const c = catalog.value;
  const p = c?.persona(personaId);
  if (!c)
    return (
      <section class="page" aria-busy="true">
        <p class="page-lede">Loading…</p>
      </section>
    );
  if (!p)
    return (
      <section class="page" aria-labelledby="profile-missing">
        <BackToFloor />
        <h1 id="profile-missing">Not in the directory</h1>
        <p class="page-lede">That coworker is not in the directory. Find someone on the Floor.</p>
      </section>
    );
  return <Profile persona={p} />;
}

function BackToFloor() {
  return (
    <Link href={paths.floor} class="back-link">
      <Icon name="chevronLeft" size={18} /> Floor
    </Link>
  );
}

function Profile({ persona: p }: { persona: PersonaSlim }) {
  const c = catalog.value!;
  const first = firstName(p.name);
  const speaker = useSampleSpeaker(coworkerAgentId(p.id), personaVoiceRef(p));
  const speaking = Boolean(localPresence.value[speaker.speakerId]?.speaking);
  const dept = c.department(p.department);
  const skills = new Map(c.catalog.skills.map((s) => [s.id, s]));
  const known = (ids: string[]) => ids.map((id) => skills.get(id)).filter((s): s is SkillIndexEntry => !!s);
  const primary = known(p.skills.primary);
  const secondary = known(p.skills.secondary);
  // The tab is part of the address (`?tab=work`), so "how they work" and their prompt can be linked to.
  const asked = queryParam('tab');
  const tab: 'about' | 'work' | 'prompt' = asked === 'work' || asked === 'prompt' ? asked : 'about';
  const setTab = (t: 'about' | 'work' | 'prompt') => setQuery({ tab: t === 'about' ? null : t });

  return (
    <article class="page profile" aria-labelledby="profile-title" style={{ '--accent': accentFor(p.avatar.accent_color) }}>
      <BackToFloor />
      <header class="profile-hero">
        <div class="profile-face-col">
          <Face subject={personaSubject(p)} tier="hero" state={speaking ? 'speaking' : 'idle'} sampler={speaker.mouth} label={`${p.name}, ${p.title}`} class="profile-face" agentId={coworkerAgentId(p.id)} />
          {isOwner.value && <PortraitAction id={p.id} name={p.name} class="profile-paint" />}
        </div>
        <div class="profile-id">
          <p class="profile-dept">
            {dept?.name ?? p.department} · {SENIORITY[p.seniority]}
          </p>
          <PageTitle id="profile-title">{p.name}</PageTitle>
          <p class="profile-title">{p.title}</p>
          <p class="profile-line">{p.one_liner}</p>
          <div class="profile-actions">
            {onboarded.value && (
              <button
                type="button"
                class="button-primary"
                onClick={() => {
                  // The one obvious next action (D3): bring them up with the Chief of Staff, who staffs the work.
                  prefillComposer(`What could ${p.name} do for us?`);
                  navigate(paths.talk);
                }}
              >
                Ask {chiefName.value} about {first}
              </button>
            )}
            <VoiceSample speaker={speaker} text={p.intro_line} name={first} />
            {onboarded.value && <TeamToggle personaId={p.id} first={first} />}
          </div>
        </div>
      </header>

      {/* Their desk: the same quick chat as the Floor bubble (LIVING-WORKFORCE §8.2). */}
      {onboarded.value && <SideThread agentId={coworkerAgentId(p.id)} first={first} />}

      <blockquote class="profile-intro">
        <p>{p.intro_line}</p>
      </blockquote>

      <div class="segmented profile-tabs" role="tablist" aria-label={`About ${first}`}>
        {(['about', 'work', 'prompt'] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} class="segmented-item" onClick={() => setTab(t)}>
            {t === 'about' ? 'About' : t === 'work' ? 'How they work' : 'Prompt'}
          </button>
        ))}
      </div>
      {tab !== 'about' && <AgentPanel personaId={p.id} tab={tab} first={first} />}
      {tab === 'about' && <About persona={p} primary={primary} secondary={secondary} first={first} />}
    </article>
  );
}

/** On your team or not: owners add the coworkers they work with most (they stay in the directory either way). */
function TeamToggle({ personaId, first }: { personaId: string; first: string }) {
  const [members, setMembers] = useState<string[] | null>(null);
  const [asking, setAsking] = useState(false);
  const keep = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (asking) keep.current?.focus();
  }, [asking]);
  useEffect(() => {
    api
      .getTeam()
      .then((t) => setMembers(t.members.map((m) => m.personaId)))
      .catch(() => undefined);
  }, [personaId]);
  if (!members) return null;
  const on = members.includes(personaId);
  if (!isOwner.value) return on ? <Link href={linkTo(paths.team, personaId)} class="connector-tag">On your team</Link> : null;
  const change = async (hire: boolean) => {
    try {
      const t = hire ? (await api.hire([personaId])).team : await api.letGo(personaId);
      const ids = t.members.map((m) => m.personaId);
      setMembers(ids);
      teamIds.value = ids;
      setAsking(false);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'That did not go through. Try again.', 5000);
    }
  };
  // Letting someone go asks first: the button reads as a status, so one tap must not undo the hire.
  if (on && asking)
    return (
      <span class="profile-confirm" role="group" aria-label={`Let ${first} go?`}>
        <button type="button" class="button-quiet button-danger" onClick={() => void change(false)}>
          Let {first} go
        </button>
        <button type="button" class="button-quiet" ref={keep} onClick={() => setAsking(false)}>
          Keep {first}
        </button>
      </span>
    );
  return (
    <button
      type="button"
      class={on ? 'button-quiet' : 'button-primary'}
      aria-pressed={on}
      title={on ? `Let ${first} go (you can hire them again)` : `Hire ${first} onto your team`}
      onClick={() => (on ? setAsking(true) : void change(true))}
    >
      <Icon name={on ? 'check' : 'plus'} size={16} /> {on ? `${first} is on your team` : `Hire ${first}`}
    </button>
  );
}

/** The owner's view of how they work (lazy: loaded when the tab opens). */
function AgentPanel({ personaId, tab, first }: { personaId: string; tab: 'work' | 'prompt'; first: string }) {
  const [view, setView] = useState<AgentView | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api
      .getAgent(personaId)
      .then((v) => live && setView(v))
      .catch((err) => live && setError(err instanceof ApiError ? err.message : 'Could not load how they work. Reload the page to try again.'));
    return () => void (live = false);
  }, [personaId]);
  if (error)
    return (
      <p class="form-error" role="alert">
        {error}
      </p>
    );
  if (!view) return <p class="page-fine">Loading…</p>;
  return tab === 'work' ? (
    <>
      <AgentSettings view={view} onChange={setView} />
      <div class="panel context-files-panel">
        <ContextFiles scope={`coworker:${personaId}`} title={`Files for ${first}`} hint={`${first} reads them when their work calls for it: a style guide, a template, past examples.`} />
      </div>
    </>
  ) : (
    <PromptViewer views={view.prompts} />
  );
}

function About({ persona: p, primary, secondary, first }: { persona: PersonaSlim; primary: SkillIndexEntry[]; secondary: SkillIndexEntry[]; first: string }) {
  return (
    <>
      <section class="profile-block" aria-labelledby="story-title">
        <h2 id="story-title">Story</h2>
        <p class="profile-story">{p.backstory}</p>
        <p class="profile-note">
          {first} is an AI coworker. This story is fiction.
        </p>
      </section>

      {primary.length > 0 && (
        <section class="profile-block" aria-labelledby="methods-title">
          <h2 id="methods-title">Signature methods</h2>
          <ul class="methods">
            {primary.map((s) => (
              <li key={s.id}>
                <span class="method-name">{s.name}</span>
                <span class="method-line">{s.one_liner}</span>
              </li>
            ))}
          </ul>
          {secondary.length > 0 && (
            <>
              <h3 class="profile-sub">Also works with</h3>
              <ul class="chips">
                {secondary.map((s) => (
                  <li key={s.id} class="chip" title={s.one_liner}>
                    {s.name}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </>
  );
}
