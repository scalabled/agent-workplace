// The skills library (biz-bot parity: Admin → Skills): every skill in the catalog by category, which coworkers have
// it, and whether this workspace edited it. A skill's page has its full method, a new version per edit, and rollback.
import type { SkillDetail, SkillsResponse } from '@headcount/protocol/ext/agents';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { api, ApiError } from '../api/client';
import { catalog, loadCatalog } from '../catalog';
import { Link } from '../components/Link';
import { Markdown } from '../components/Markdown';
import { navigate, paths } from '../router';
import { PageTitle } from '../links/CopyLink';
import './pages.css';

export function Skills() {
  const [data, setData] = useState<SkillsResponse | null>(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api
      .listSkills()
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load the skills.'));
  }, []);
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = (data?.skills ?? []).filter((s) => !needle || `${s.name} ${s.one_liner} ${s.category}`.toLowerCase().includes(needle));
    const by = new Map<string, typeof list>();
    for (const s of list) by.set(s.category, [...(by.get(s.category) ?? []), s]);
    return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [data, q]);
  return (
    <section class="page skills-page" aria-labelledby="skills-title">
      <header class="page-head">
        <PageTitle id="skills-title">Skills</PageTitle>
        <p class="page-lede">The methods your coworkers work by. Each coworker’s prompt lists their skills; the full method loads when a piece of work calls for it. Edit one and every coworker who has it uses your version.</p>
      </header>
      <label class="visually-hidden" for="skill-search">
        Search skills
      </label>
      <input id="skill-search" class="field-input skill-search" type="search" placeholder="Search skills" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
      {error && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}
      {!data && !error && <p class="page-fine">Loading…</p>}
      {groups.map(([category, list]) => (
        <section key={category} class="panel skill-group" aria-label={category}>
          <h2 class="panel-title">{category.replace(/-/g, ' ')}</h2>
          <ul class="skill-cards">
            {list.map((s) => (
              <li key={s.id}>
                <button type="button" class="skill-card" onClick={() => navigate(paths.skill(s.id))}>
                  <span class="skill-card-name">
                    {s.icon} {s.name}
                  </span>
                  <span class="skill-card-line">{s.one_liner}</span>
                  <span class="skill-card-meta tabular">
                    v{s.version}
                    {s.edited ? ' · edited here' : ''} · {s.usedBy} coworker{s.usedBy === 1 ? '' : 's'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </section>
  );
}

export function SkillPage({ skillId }: { skillId: string }) {
  const [skill, setSkill] = useState<SkillDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void loadCatalog();
    setSkill(null);
    api
      .getSkill(skillId)
      .then(setSkill)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load the skill.'));
  }, [skillId]);
  const run = async (call: () => Promise<SkillDetail>) => {
    setBusy(true);
    setError(null);
    try {
      setSkill(await call());
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  };
  const holders = (catalog.value?.catalog.personas ?? []).filter((p) => p.skills.primary.includes(skillId) || p.skills.secondary.includes(skillId));
  return (
    <section class="page skill-page" aria-labelledby="skill-title">
      <p class="page-crumb">
        <Link href={paths.skills}>Skills</Link>
      </p>
      {error && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}
      {!skill && !error && <p class="page-fine">Loading…</p>}
      {skill && (
        <>
          <header class="page-head">
            <PageTitle id="skill-title">
              {skill.icon} {skill.name}
            </PageTitle>
            <p class="page-lede">{skill.one_liner}</p>
            <p class="page-fine tabular">
              v{skill.version}
              {skill.edited ? ' · edited in this workspace' : ' · from the catalog'} · use when {skill.when}
            </p>
          </header>
          <section class="panel skill-method" aria-labelledby="method-title">
            <header class="plan-head">
              <h2 id="method-title" class="panel-title">
                The method
              </h2>
              {!editing && (
                <button
                  type="button"
                  class="button-quiet button-small needs-owner"
                  onClick={() => {
                    setText(skill.instructions);
                    setNote('');
                    setEditing(true);
                  }}
                >
                  Edit
                </button>
              )}
            </header>
            {editing ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(() => api.putSkill(skill.id, text, note.trim() || undefined));
                }}
              >
                <label class="visually-hidden" for="skill-text">
                  Instructions
                </label>
                <textarea id="skill-text" class="field-input instructions-input" rows={14} maxLength={12000} value={text} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} />
                <label class="field">
                  <span class="field-label">What changed (optional)</span>
                  <input class="field-input" maxLength={200} value={note} onInput={(e) => setNote((e.target as HTMLInputElement).value)} />
                </label>
                <div class="settings-actions">
                  <button type="submit" class="button-primary" disabled={busy || !text.trim() || text.trim() === skill.instructions.trim()}>
                    Save as v{skill.version + 1}
                  </button>
                  <button type="button" class="button-quiet" onClick={() => setEditing(false)}>
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <Markdown text={skill.instructions} />
            )}
            {skill.quality_checks.length > 0 && (
              <>
                <h3 class="profile-sub">Quality checks</h3>
                <ul class="skill-checks">
                  {skill.quality_checks.map((q, i) => (
                    <li key={i}>{q}</li>
                  ))}
                </ul>
              </>
            )}
            {skill.outputs.length > 0 && (
              <>
                <h3 class="profile-sub">Typical outputs</h3>
                <ul class="skill-checks">
                  {skill.outputs.map((o) => (
                    <li key={o.name}>
                      <strong>{o.name}</strong>
                      {o.format ? ` (${o.format})` : ''}
                      {o.description ? `: ${o.description}` : ''}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {skill.tools.length > 0 && <p class="page-fine">Tools it calls for: {skill.tools.join(', ')}. Steps that need tools a coworker does not have become drafts or a question for you.</p>}
          </section>
          {skill.history.length > 0 && (
            <section class="panel" aria-labelledby="history-title">
              <h2 id="history-title" class="panel-title">
                Earlier versions
              </h2>
              <ul class="skill-history">
                {skill.history.map((h) => (
                  <li key={h.version}>
                    <details>
                      <summary>
                        v{h.version} · {new Date(h.at).toLocaleString()}
                        {h.note ? ` · ${h.note}` : ''}
                      </summary>
                      <Markdown text={h.instructions} />
                      <button type="button" class="button-quiet button-small" disabled={busy} onClick={() => void run(() => api.rollbackSkill(skill.id, h.version))}>
                        Bring back v{h.version}
                      </button>
                    </details>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {holders.length > 0 && (
            <section class="panel" aria-labelledby="holders-title">
              <h2 id="holders-title" class="panel-title">
                Who has it
              </h2>
              <ul class="chips">
                {holders.map((p) => (
                  <li key={p.id}>
                    <Link href={paths.coworker(p.id)} class="chip">
                      {p.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </section>
  );
}
