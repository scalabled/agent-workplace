// The Handbook (Inc 4): the owner's own description of the business, which the Chief of Staff and every coworker work
// from. Written section by section here, or by the Chief from an interview in Talk; downloadable as company.md.
import { HANDBOOK_SECTION_MAX, HANDBOOK_SECTIONS, type HandbookResponse, type HandbookSection } from '@headcount/protocol/ext/memory';
import { CHIEF_ID } from '@headcount/protocol';
import { useEffect, useState } from 'preact/hooks';
import { api, ApiError } from '../api/client';
import { chiefName } from '../chief';
import { Icon } from '../components/Icon';
import { Link } from '../components/Link';
import { Markdown } from '../components/Markdown';
import { navigate, paths } from '../router';
import { thread } from '../store';
import './pages.css';

const errorOf = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);
const day = (at?: string) => (at ? new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '');
const ASK = Object.fromEntries(HANDBOOK_SECTIONS.map((s) => [s.id, s.ask])) as Record<string, string>;

export function Handbook() {
  const [hb, setHb] = useState<HandbookResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // While the interview runs, each answer in Talk writes a section: look again after each Chief message.
  const chiefSaid = thread.value.filter((m) => m.from === CHIEF_ID && !m.streaming).length;
  useEffect(() => {
    let live = true;
    api
      .getHandbook()
      .then((r) => live && setHb(r))
      .catch((err) => live && setError(errorOf(err, 'Could not load the Handbook.')));
    return () => void (live = false);
  }, [chiefSaid]);

  const interview = async (on: boolean) => {
    setBusy(true);
    setError(null);
    try {
      setHb(on ? await api.startInterview() : await api.stopInterview());
      if (on) navigate(paths.talk);
    } catch (err) {
      setError(errorOf(err, 'That did not go through. Try again.'));
    } finally {
      setBusy(false);
    }
  };
  const download = () => {
    if (!hb) return;
    const url = URL.createObjectURL(new Blob([hb.markdown], { type: 'text/markdown;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'company.md';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const written = hb?.sections.filter((s) => s.content.trim()).length ?? 0;
  const name = chiefName.value;
  return (
    <section class="page handbook-page" aria-labelledby="handbook-title">
      <header class="page-head">
        <h1 id="handbook-title">Handbook</h1>
        <p class="page-lede">
          Your own description of the business. {name} and every coworker work from it, so their work sounds like you and follows your rules. Write it here, or let {name} interview you. The details they pick up along the way are in{' '}
          <Link href={paths.memory}>Memory</Link>.
        </p>
      </header>
      {hb && (
        <div class="panel handbook-bar">
          {hb.interviewing ? (
            <>
              <p class="handbook-status" role="status">
                {name} is interviewing you in Talk. Each answer is written up here.
              </p>
              <span class="handbook-actions">
                <button type="button" class="button-primary" onClick={() => navigate(paths.talk)}>
                  Go to Talk
                </button>
                <button type="button" class="button-quiet" disabled={busy} onClick={() => void interview(false)}>
                  Stop the interview
                </button>
              </span>
            </>
          ) : (
            <>
              <p class="handbook-status">
                {written === hb.sections.length ? 'Every section is written.' : `${written} of ${hb.sections.length} sections written.`}
              </p>
              <span class="handbook-actions">
                <button type="button" class="button-primary" disabled={busy} onClick={() => void interview(true)}>
                  <Icon name="talk" size={16} /> {written ? `Let ${name} ask about the rest` : `Let ${name} interview me`}
                </button>
                <button type="button" class="button-quiet" disabled={!written} onClick={download}>
                  <Icon name="download" size={16} /> company.md
                </button>
              </span>
            </>
          )}
        </div>
      )}
      {error && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}
      {!hb && !error && <p class="page-fine">Loading…</p>}
      {hb && (
        <div class="handbook-sections">
          {hb.sections.map((s) => (
            <SectionCard key={s.id} section={s} onSaved={setHb} />
          ))}
        </div>
      )}
    </section>
  );
}

function SectionCard({ section: s, onSaved }: { section: HandbookSection; onSaved: (hb: HandbookResponse) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(s.content);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!editing) setText(s.content);
  }, [s.content]);
  const save = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSaved(await api.putHandbook(s.id, text.trim()));
      setEditing(false);
    } catch (err) {
      setError(errorOf(err, 'That was not saved. Try again.'));
    } finally {
      setBusy(false);
    }
  };
  const id = `hb-${s.id}`;
  return (
    <article class="panel handbook-section" data-empty={!s.content.trim() || undefined} aria-labelledby={id}>
      <header class="connector-card-head">
        <h2 id={id} class="connector-name">
          {s.title}
        </h2>
        {!editing && (
          <button type="button" class="icon-button icon-button-sm" aria-label={`Edit ${s.title}`} title="Edit" onClick={() => setEditing(true)}>
            <Icon name="edit" size={16} />
          </button>
        )}
      </header>
      {editing ? (
        <form class="handbook-edit" onSubmit={save}>
          <label class="visually-hidden" for={`${id}-text`}>
            {s.title}
          </label>
          <textarea id={`${id}-text`} class="field-input" rows={7} maxLength={HANDBOOK_SECTION_MAX} value={text} placeholder={`Write ${ASK[s.id]}. Short bullets are fine.`} onInput={(e) => setText(e.currentTarget.value)} />
          <span class="memory-add-actions">
            <button
              type="button"
              class="link-button"
              onClick={() => {
                setText(s.content);
                setEditing(false);
              }}
            >
              Cancel
            </button>
            <button type="submit" class="button-primary" disabled={busy}>
              Save
            </button>
          </span>
          {error && (
            <p class="form-error" role="alert">
              {error}
            </p>
          )}
        </form>
      ) : s.content.trim() ? (
        <>
          <Markdown text={s.content} class="handbook-body" />
          <p class="connector-meta">
            {s.updatedBy === 'chief' ? `Written by ${chiefName.value} from your interview` : 'Written by you'}
            {s.updatedAt ? ` · ${day(s.updatedAt)}` : ''}
          </p>
        </>
      ) : (
        <p class="page-fine">Not written yet: {ASK[s.id]}.</p>
      )}
    </article>
  );
}
