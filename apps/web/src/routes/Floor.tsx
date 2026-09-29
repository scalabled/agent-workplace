// Floor (Inc 0): the Directory of catalog coworkers, grouped by department, with search and a
// department filter. Each card is a face, a name, a title and a one-liner; it opens the profile.
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { PersonaSlim } from '@headcount/catalog';
import { catalog, loadCatalog } from '../catalog';
import { Face, personaSubject } from '../components/Face';
import { Icon } from '../components/Icon';
import { Link } from '../components/Link';
import { paths } from '../router';
import './floor.css';
import { accentFor } from '../lib/accent';

export function Floor() {
  useEffect(() => void loadCatalog(), []);
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
      <header class="page-head">
        <h1 id="floor-title">Floor</h1>
        <p class="page-lede">
          {c.catalog.personas.length} coworkers across {c.catalog.departments.length} departments. Browse the staff and meet anyone.
        </p>
      </header>

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
              <li key={p.id}>
                <CoworkerCard persona={p} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </section>
  );
}

function CoworkerCard({ persona: p }: { persona: PersonaSlim }) {
  return (
    <Link href={paths.coworker(p.id)} class="cw-card" style={{ '--accent': accentFor(p.avatar.accent_color) }}>
      <Face subject={personaSubject(p)} tier="token" decorative lazy />
      <span class="cw-text">
        <span class="cw-name">{p.name}</span>
        <span class="cw-title">{p.title}</span>
        <span class="cw-line">{p.one_liner}</span>
      </span>
    </Link>
  );
}
