// Floor: the Chief of Staff's card, then the Directory of catalog coworkers, grouped by department, with search
// and a department filter. Each card is a face, a name, a title and a one-liner; it opens the profile. The Floor
// breathes (Inc 0.5, LIVING-WORKFORCE §8): rest the pointer on a desk and the face looks up with a short, true
// line; Reply (or R) chats in place. Ambience sets how much of that happens.
// Office Phase 2 (OFFICE-PHASE2 §4.5.1): an Office | Directory toggle. The Office (a lazy chunk the Directory never
// loads) is the default on a fine pointer at least 900 px wide; the Directory stays the accessible alternative.
import { Component, type ComponentChildren, type ComponentType } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { firstName, type PersonaSlim } from '@headcount/catalog';
import { CHIEF_ID, coworkerAgentId } from '@headcount/protocol';
import { catalog, loadCatalog } from '../catalog';
import { chiefName, currentLead } from '../chief';
import { AmbienceControl } from '../components/AmbienceControl';
import { VoiceElsewhere } from '../components/VoiceElsewhere';
import { Face, leadSubject, personaSubject } from '../components/Face';
import { closeReply, FloorBubble, openReply, replyingAgent } from '../components/FloorBubble';
import { Icon } from '../components/Icon';
import { Link } from '../components/Link';
import { prefetchOffice } from '../lazy';
import { bubbles, lastSaid } from '../living/captions';
import { activeDesk, useDesk } from '../living/useDesk';
import { officePeople } from '../office/fetch';
import { floorView, resolveFloorView, setFloorView, type FloorView } from '../office/view';
import type { OfficeViewProps } from '../office/OfficeView';
import { navigate, paths } from '../router';
import { activeJobs, chiefPresence, onboarded, settings } from '../store';
import { chiefSpeaker } from '../voice/chief-voice';
import { audio } from '../voice/engine';
import { PageTitle } from '../links/CopyLink';
import './floor.css';
import { accentFor } from '../lib/accent';

const TEXT_ENTRY = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

/** R replies to the bubble of the desk the owner is at (hovered or focused); in a joined huddle, R focuses its chat. */
function useReplyKey() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'r' && e.key !== 'R') return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      if (e.target instanceof Element && e.target.closest(TEXT_ENTRY)) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      const huddleField = document.querySelector<HTMLInputElement>('.hc-o-hcard__input');
      if (huddleField) {
        e.preventDefault();
        huddleField.focus();
        return;
      }
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
  // A link may carry ?view=office|directory: resolved on every visit (then remembered).
  useLayoutEffect(() => void resolveFloorView(), []);
  const c = catalog.value;
  const [query, setQuery] = useState('');
  const [dept, setDept] = useState('all');
  /** The office failed to load or crashed: the Directory for this visit, with one notice. */
  const [officeFailed, setOfficeFailed] = useState(false);
  const view: FloorView = onboarded.value && !officeFailed ? floorView.value : 'directory';
  const title = useRef<HTMLHeadingElement>(null);
  // The Office's personalities and chunk start loading together (Directory users load neither).
  const leadId = settings.value?.leadId ?? '';
  const chief = chiefName.value;
  useEffect(() => {
    if (view !== 'office') return;
    void prefetchOffice().catch(() => undefined);
    void officePeople(`${leadId}|${chief}`);
  }, [view, leadId, chief]);
  const toDirectory = (opts: { remember: boolean }) => {
    if (opts.remember) setFloorView('directory');
    else setOfficeFailed(true);
    // The skip link lands on the Directory's heading.
    setTimeout(() => title.current?.focus(), 0);
  };

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
        <PageTitle id="floor-title">Floor</PageTitle>
        <p class="page-lede">{view === 'office' ? 'Opening the office…' : 'Loading the directory…'}</p>
      </section>
    );

  const controls = onboarded.value && (
    <div class="floor-head-controls">
      <FloorViewToggle
        value={view}
        onChange={(v) => {
          setOfficeFailed(false);
          setFloorView(v);
        }}
      />
      <VoiceElsewhere />
      <AmbienceControl office={view === 'office'} />
    </div>
  );

  if (view === 'office')
    return (
      <section class="page floor" data-view="office" aria-labelledby="floor-title">
        <header class="page-head floor-head">
          <div class="floor-head-text">
            <h1 id="floor-title" ref={title} tabIndex={-1}>
              Floor
            </h1>
          </div>
          {controls}
        </header>
        <div class="floor-office">
          <OfficeBoundary onError={() => toDirectory({ remember: false })}>
            <LazyOffice catalog={c} onRequestDirectory={() => toDirectory({ remember: true })} onFail={() => toDirectory({ remember: false })} />
          </OfficeBoundary>
        </div>
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
    <section class="page floor" data-view="directory" aria-labelledby="floor-title">
      <header class="page-head floor-head">
        <div class="floor-head-text">
          <h1 id="floor-title" ref={title} tabIndex={-1}>
            Floor
          </h1>
          <p class="page-lede">
            {c.catalog.personas.length} coworkers across {c.catalog.departments.length} departments. Browse the staff and meet anyone.
          </p>
        </div>
        {controls}
      </header>

      {officeFailed && (
        <p class="floor-notice" role="status">
          The office view could not load. Showing the Directory.
        </p>
      )}

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

/** Office | Directory: a two-option segmented control (arrow keys move and choose, like any radio group). */
function FloorViewToggle({ value, onChange }: { value: FloorView; onChange(v: FloorView): void }) {
  const options: { v: FloorView; label: string }[] = [
    { v: 'office', label: 'Office' },
    { v: 'directory', label: 'Directory' },
  ];
  const group = useRef<HTMLDivElement>(null);
  const move = (dir: 1 | -1) => {
    const i = options.findIndex((o) => o.v === value);
    const next = options[(i + dir + options.length) % options.length]!;
    onChange(next.v);
    setTimeout(() => group.current?.querySelector<HTMLButtonElement>(`[data-view="${next.v}"]`)?.focus(), 0);
  };
  return (
    <div
      class="floor-view"
      role="radiogroup"
      aria-label="Floor view"
      data-testid="floor-view"
      ref={group}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          e.preventDefault();
          move(1);
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          e.preventDefault();
          move(-1);
        }
      }}
    >
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          role="radio"
          class="floor-view-option"
          data-view={o.v}
          aria-checked={value === o.v}
          tabIndex={value === o.v ? 0 : -1}
          onClick={() => value !== o.v && onChange(o.v)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** The office chunk, loaded on demand; a failed load falls back to the Directory. */
function LazyOffice(props: OfficeViewProps & { onFail(): void }) {
  const [View, setView] = useState<ComponentType<OfficeViewProps> | null>(null);
  const fail = useRef(props.onFail);
  fail.current = props.onFail;
  useEffect(() => {
    let alive = true;
    prefetchOffice()
      .then((C) => {
        if (alive) setView(() => C as ComponentType<OfficeViewProps>);
      })
      .catch((err: unknown) => {
        console.warn('office view unavailable:', err);
        if (alive) fail.current();
      });
    return () => {
      alive = false;
    };
  }, []);
  if (!View) return <div class="floor-office-loading" aria-busy="true" />;
  return <View catalog={props.catalog} onRequestDirectory={props.onRequestDirectory} />;
}

/** Anything that throws inside the office shows the Directory instead (with one notice), never a broken Floor. */
class OfficeBoundary extends Component<{ onError(): void; children?: ComponentChildren }, { failed: boolean }> {
  override state = { failed: false };
  override componentDidCatch(err: unknown) {
    console.warn('office view failed:', err);
    this.setState({ failed: true });
    this.props.onError();
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}
