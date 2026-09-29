// Floor: the Chief of Staff's card, then the Directory of catalog coworkers, grouped by department, with search
// and a department filter. Each card is a face, a name, a title and a one-liner; it opens the profile. The Floor
// breathes (Inc 0.5, LIVING-WORKFORCE §8): rest the pointer on a desk and the face looks up with a short, true
// line; Reply (or R) chats in place. Ambience sets how much of that happens.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { firstName, type PersonaSlim } from '@headcount/catalog';
import { CHIEF_ID, coworkerAgentId } from '@headcount/protocol';
import { catalog, loadCatalog } from '../catalog';
import { chiefName, currentLead } from '../chief';
import { AmbienceControl } from '../components/AmbienceControl';
import { Face, leadSubject, personaSubject } from '../components/Face';
import { closeReply, FloorBubble, openReply, replyingAgent } from '../components/FloorBubble';
import { Icon } from '../components/Icon';
import { Link } from '../components/Link';
import { bubbles, lastSaid } from '../living/captions';
import { activeDesk, useDesk } from '../living/useDesk';
import { navigate, paths } from '../router';
import { activeJobs, chiefPresence, onboarded } from '../store';
import { chiefSpeaker } from '../voice/chief-voice';
import { audio } from '../voice/engine';
import './floor.css';
import { accentFor } from '../lib/accent';

const TEXT_ENTRY = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

/** R replies to the bubble of the desk the owner is at (hovered or focused). */
function useReplyKey() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'r' && e.key !== 'R') return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      if (e.target instanceof Element && e.target.closest(TEXT_ENTRY)) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      const agentId = activeDesk.peek();
      if (!agentId) return;
      e.preventDefault();
      openReply(agentId);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      closeReply();
    };
  }, []);
}

export function Floor() {
  useEffect(() => void loadCatalog(), []);
  useReplyKey();
  const c = catalog.value;
  const [query, setQuery] = useState('');
  const [dept, setDept] = useState('all');

  // One lowercase haystack per coworker: name, handle, title, one-liner, department and skill names.
  const haystack = useMemo(() => {
    if (!c) return new Map<string, string>();
    const skillNames = new Map(c.catalog.skills.map((s) => [s.id, s.name]));
    return new Map(
      c.catalog.personas.map((p) => [
        p.id,
        [p.name, p.handle, p.title, p.one_liner, c.department(p.department)?.name ?? '', ...[...p.skills.primary, ...p.skills.secondary].map((id) => skillNames.get(id) ?? id)].join(' ').toLowerCase(),
      ]),
    );
  }, [c]);

  if (!c)
    return (
      <section class="page" aria-labelledby="floor-title" aria-busy="true">
        <h1 id="floor-title">Floor</h1>
        <p class="page-lede">Loading the directory…</p>
      </section>
    );

  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (p: PersonaSlim) => !terms.length || terms.every((t) => haystack.get(p.id)?.includes(t));
  const groups = c.catalog.departments
    .filter((d) => dept === 'all' || d.id === dept)
    .map((d) => ({ dept: d, people: c.personasIn(d.id).filter(matches) }))
    .filter((g) => g.people.length > 0);
  const shown = groups.reduce((n, g) => n + g.people.length, 0);
  const filtered = terms.length > 0 || dept !== 'all';

  return (
    <section class="page floor" aria-labelledby="floor-title">
      <header class="page-head floor-head">
        <div class="floor-head-text">
          <h1 id="floor-title">Floor</h1>
          <p class="page-lede">
            {c.catalog.personas.length} coworkers across {c.catalog.departments.length} departments. Browse the staff and meet anyone.
          </p>
        </div>
        {onboarded.value && <AmbienceControl />}
      </header>

      <ChiefCard />

      <div class="floor-tools" role="search">
        <label class="field-search">
          <Icon name="search" size={18} />
          <span class="visually-hidden">Search coworkers</span>
          <input type="search" value={query} placeholder="Search by name, role or skill" autoComplete="off" onInput={(e) => setQuery(e.currentTarget.value)} />
        </label>
        <label class="field-select">
          <span class="visually-hidden">Department</span>
          <select value={dept} onChange={(e) => setDept(e.currentTarget.value)}>
            <option value="all">All departments</option>
            {c.catalog.departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <Icon name="chevronDown" size={16} />
        </label>
      </div>

      {filtered && (
        <p class="floor-count" role="status">
          {shown === 0 ? 'No one matches.' : `${shown} ${shown === 1 ? 'coworker' : 'coworkers'}`}
          {shown === 0 && (
            <>
              {' '}
              <button
                type="button"
                class="link-button"
                onClick={() => {
                  setQuery('');
                  setDept('all');
                }}
              >
                Show everyone
              </button>
            </>
          )}
        </p>
      )}

      {groups.map(({ dept: d, people }) => (
        <section class="dept" key={d.id} aria-labelledby={`dept-${d.id}`}>
          <header class="dept-head">
            <h2 id={`dept-${d.id}`}>{d.name}</h2>
            <span class="dept-count tabular">{people.length}</span>
          </header>
          {!filtered && <p class="dept-desc">{d.description}</p>}
          <ul class="cw-grid">
            {people.map((p) => (
              <CoworkerSlot key={p.id} persona={p} />
            ))}
          </ul>
        </section>
      ))}
    </section>
  );
}

/** What a desk last said, for screen readers in the Directory row (never announced live, EXPERIENCE §9.2). */
function Said({ agentId }: { agentId: string }) {
  const text = lastSaid.value[agentId];
  return text ? <span class="visually-hidden"> · said: “{text}”</span> : null;
}

/** The Chief of Staff's desk, pinned above the Directory: their state ring, what they are doing, and a chat in place. */
function ChiefCard() {
  const lead = currentLead.value;
  const desk = useDesk(CHIEF_ID);
  if (!lead || !onboarded.value) return null;
  const name = chiefName.value;
  const shown = chiefPresence.value;
  const running = activeJobs.value.length;
  const words = shown.state === 'idle' ? 'Available' : shown.label;
  return (
    <div class="cw-slot chief-slot" data-agent-id={CHIEF_ID} data-active={desk.hovered || desk.focused || undefined} style={{ '--accent': accentFor(lead.avatar.accent_color) }} {...desk.slot}>
      <Link href={paths.talk} class="cw-card chief-card" {...desk.card}>
        <Face subject={leadSubject(lead, name)} tier="tile" state={shown.state} sampler={chiefSpeaker.mouth} agentId={CHIEF_ID} decorative />
        <span class="cw-text">
          <span class="cw-name">{name}</span>
          <span class="chief-card-state" data-state={shown.state}>
            <span class="state-glyph" data-state={shown.state} aria-hidden="true" />
            <span>Chief of Staff · {words}</span>
          </span>
          {running > 0 && <span class="chief-card-jobs tabular">{running === 1 ? '1 job running' : `${running} jobs running`}</span>}
          <Said agentId={CHIEF_ID} />
        </span>
      </Link>
      <FloorBubble agentId={CHIEF_ID} first={name} hovered={desk.hovered} onOpenDesk={() => navigate(paths.talk)} deskLabel={`Keep talking with ${name} in Talk`} />
    </div>
  );
}

function CoworkerSlot({ persona: p }: { persona: PersonaSlim }) {
  const agentId = coworkerAgentId(p.id);
  const desk = useDesk(agentId);
  // The face wakes while the owner is at this desk (or its bubble is up), so the look-up and the mouth show.
  const awake = desk.hovered || desk.focused || !!bubbles.value[agentId] || replyingAgent.value === agentId;
  return (
    <li class="cw-slot" data-agent-id={agentId} data-active={awake || undefined} style={{ '--accent': accentFor(p.avatar.accent_color) }} {...desk.slot}>
      <Link href={paths.coworker(p.id)} class="cw-card" {...desk.card}>
        <Face subject={personaSubject(p)} tier={awake ? 'tile' : 'token'} sampler={awake ? audio().sampler(agentId) : null} agentId={agentId} decorative lazy />
        <span class="cw-text">
          <span class="cw-name">{p.name}</span>
          <span class="cw-title">{p.title}</span>
          <span class="cw-line">{p.one_liner}</span>
          <Said agentId={agentId} />
        </span>
      </Link>
      <FloorBubble agentId={agentId} first={firstName(p.name)} hovered={desk.hovered} onOpenDesk={() => navigate(paths.coworker(p.id))} />
    </li>
  );
}
