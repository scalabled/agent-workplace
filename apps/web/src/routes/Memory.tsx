// Memory (Inc 4): what the Chief of Staff and the team remember about the business — distilled from conversations and
// meetings, told to remember, or read from the files the owner shares. Searchable (words and meaning); anything can be
// changed, pinned (always in mind) or forgotten. The bigger picture lives in the Handbook.
import { MEMORY_KINDS, MEMORY_TEXT_MAX, type MemoryItem, type MemoryKind } from '@headcount/protocol/ext/memory';
import { useEffect, useState } from 'preact/hooks';
import { api, ApiError } from '../api/client';
import { chiefName } from '../chief';
import { Icon } from '../components/Icon';
import { Link } from '../components/Link';
import { ContextFiles } from '../memory/ContextFiles';
import { SecondBrain } from '../memory/SecondBrain';
import { scopeLabel } from '../memory/upload';
import { linkTarget, paths } from '../router';
import { PageTitle } from '../links/CopyLink';
import { CopyLink } from '../links/CopyLink';
import './pages.css';

export const KIND_WORDS: Record<MemoryKind, string> = { fact: 'Fact', preference: 'Preference', decision: 'Decision', person: 'Person', client: 'Client', rule: 'Rule', excerpt: 'From a file' };
const OWN_KINDS = MEMORY_KINDS.filter((k) => k !== 'excerpt');
const SEARCH_DEBOUNCE_MS = 250;

const errorOf = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);
const day = (at: string) => new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export function Memory() {
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<MemoryKind | ''>('');
  const [list, setList] = useState<MemoryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    let live = true;
    const t = setTimeout(
      () =>
        api
          .listMemory({ q: q.trim(), kind: kind || undefined })
          .then((r) => live && (setList(r.memories), setError(null)))
          .catch((err) => live && setError(errorOf(err, 'Could not load the memory. Reload the page to try again.'))),
      q.trim() ? SEARCH_DEBOUNCE_MS : 0,
    );
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, kind]);
  // A link to one memory shows it even when the list would not (a file excerpt, an older item).
  const linked = linkTarget.value;
  useEffect(() => {
    if (!list || !linked?.startsWith('mem_') || list.some((m) => m.memoryId === linked)) return;
    api
      .getMemory(linked)
      .then((r) => setList((l) => (l && !l.some((m) => m.memoryId === linked) ? [r.memory, ...l] : l)))
      .catch(() => undefined);
  }, [linked, !!list]);
  const put = (m: MemoryItem) => setList((l) => (l ? (l.some((x) => x.memoryId === m.memoryId) ? l.map((x) => (x.memoryId === m.memoryId ? m : x)) : [m, ...l]) : [m]));
  const drop = (id: string) => setList((l) => (l ?? []).filter((x) => x.memoryId !== id));
  const searching = q.trim().length > 0;
  return (
    <section class="page memory-page" aria-labelledby="memory-title">
      <header class="page-head">
        <PageTitle id="memory-title">Memory</PageTitle>
        <p class="page-lede">
          What {chiefName.value} and the team remember: from your conversations, meetings and the files you share. It comes back when it bears on the work. Change, pin or forget anything here; the bigger picture is in the{' '}
          <Link href={paths.handbook}>Handbook</Link>.
        </p>
      </header>
      <SecondBrain memoryText={(id) => list?.find((m) => m.memoryId === id)?.text ?? null} onForget={drop} />
      <div class="memory-tools">
        <label class="visually-hidden" for="memory-search">
          Search the memory
        </label>
        <span class="memory-search">
          <Icon name="search" size={16} />
          <input id="memory-search" type="search" class="field-input" placeholder="Search by words or meaning" value={q} onInput={(e) => setQ(e.currentTarget.value)} />
        </span>
        <label class="visually-hidden" for="memory-kind">
          Kind
        </label>
        <select id="memory-kind" class="field-input field-compact" value={kind} onChange={(e) => setKind(e.currentTarget.value as MemoryKind | '')}>
          <option value="">Everything</option>
          {MEMORY_KINDS.map((k) => (
            <option key={k} value={k}>
              {k === 'excerpt' ? 'From files' : `${KIND_WORDS[k]}s`}
            </option>
          ))}
        </select>
        {!adding && (
          <button type="button" class="button-quiet needs-contributor" onClick={() => setAdding(true)}>
            <Icon name="plus" size={16} /> Add
          </button>
        )}
      </div>
      {adding && (
        <AddMemory
          onDone={(m) => {
            if (m) put(m);
            setAdding(false);
          }}
        />
      )}
      {error && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}
      {!list && !error && <p class="page-fine">Loading…</p>}
      {list && list.length === 0 && (
        <p class="panel empty-text memory-empty">{searching ? 'Nothing remembered matches that.' : `Nothing remembered yet. Tell ${chiefName.value} “remember that…”, or keep talking: the team keeps what lasts.`}</p>
      )}
      {list && list.length > 0 && (
        <ul class="memory-list" aria-label={searching ? 'Found' : 'Remembered'}>
          {list.map((m) => (
            <MemoryRow key={m.memoryId} memory={m} onChange={put} onRemoved={drop} />
          ))}
        </ul>
      )}
      <ContextFiles scope="workspace" all title="Files" hint="Shared here, a file is for everyone. Drop one on a project, or on a coworker’s profile, to share it with them alone." />
    </section>
  );
}

function AddMemory({ onDone }: { onDone: (m: MemoryItem | null) => void }) {
  const [text, setText] = useState('');
  const [kind, setKind] = useState<MemoryKind>('fact');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (e: Event) => {
    e.preventDefault();
    if (text.trim().length < 4 || busy) return;
    setBusy(true);
    setError(null);
    try {
      onDone((await api.addMemory({ text: text.trim(), kind })).memory);
    } catch (err) {
      setError(errorOf(err, 'That was not saved. Try again.'));
      setBusy(false);
    }
  };
  return (
    <form class="panel memory-add" onSubmit={save} aria-label="Add a memory">
      <label class="field">
        <span class="field-label">What should everyone remember?</span>
        <textarea class="field-input" rows={2} maxLength={MEMORY_TEXT_MAX} value={text} placeholder="We never discount bread after 3pm." onInput={(e) => setText(e.currentTarget.value)} />
      </label>
      <div class="memory-add-row">
        <label class="field field-inline">
          <span class="field-label">Kind</span>
          <select class="field-input field-compact" value={kind} onChange={(e) => setKind(e.currentTarget.value as MemoryKind)}>
            {OWN_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_WORDS[k]}
              </option>
            ))}
          </select>
        </label>
        <span class="memory-add-actions">
          <button type="button" class="link-button" onClick={() => onDone(null)}>
            Cancel
          </button>
          <button type="submit" class="button-primary" disabled={busy || text.trim().length < 4}>
            Remember
          </button>
        </span>
      </div>
      {error && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

function MemoryRow({ memory: m, onChange, onRemoved }: { memory: MemoryItem; onChange: (m: MemoryItem) => void; onRemoved: (id: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(m.text);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorOf(err, 'That did not go through. Try again.'));
    } finally {
      setBusy(false);
    }
  };
  const save = () =>
    run(async () => {
      onChange((await api.patchMemory(m.memoryId, { text: text.trim() })).memory);
      setEditing(false);
    });
  return (
    <li class="memory-row" id={m.memoryId} data-pinned={m.pinned || undefined} data-kind={m.kind}>
      <div class="memory-main">
        {editing ? (
          <form
            class="memory-edit"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <label class="visually-hidden" for={`mem-${m.memoryId}`}>
              Edit the memory
            </label>
            <textarea id={`mem-${m.memoryId}`} class="field-input" rows={m.kind === 'excerpt' ? 6 : 2} value={text} onInput={(e) => setText(e.currentTarget.value)} />
            <span class="memory-add-actions">
              <button
                type="button"
                class="link-button"
                onClick={() => {
                  setText(m.text);
                  setEditing(false);
                }}
              >
                Cancel
              </button>
              <button type="submit" class="button-primary" disabled={busy || !text.trim()}>
                Save
              </button>
            </span>
          </form>
        ) : (
          <p class="memory-text">{m.text}</p>
        )}
        <p class="connector-meta">
          {KIND_WORDS[m.kind]}
          {m.sourceLabel ? ` · ${m.sourceLabel}` : ''} · {day(m.updatedAt)}
          {m.scope !== 'workspace' ? ` · for ${scopeLabel(m.scope)}` : ''}
          {m.uses > 0 ? ` · recalled ${m.uses === 1 ? 'once' : `${m.uses} times`}` : ''}
          {m.pinned ? ' · always in mind' : ''}
        </p>
        {error && <p class="connector-error">{error}</p>}
      </div>
      {!editing && <CopyLink page={paths.memory} at={m.memoryId} label="Copy link to this memory" what="Link to this memory" />}
      {!editing && (
        <span class="memory-actions needs-contributor">
          {m.kind !== 'excerpt' && (
            <button
              type="button"
              class="icon-button icon-button-sm"
              aria-pressed={m.pinned}
              aria-label={m.pinned ? 'Unpin' : 'Pin: always keep it in mind'}
              title={m.pinned ? 'Unpin' : 'Pin: always keep it in mind'}
              disabled={busy}
              onClick={() => void run(async () => onChange((await api.patchMemory(m.memoryId, { pinned: !m.pinned })).memory))}
            >
              <Icon name="pin" size={16} />
            </button>
          )}
          <button type="button" class="icon-button icon-button-sm" aria-label="Edit" title="Edit" disabled={busy} onClick={() => setEditing(true)}>
            <Icon name="edit" size={16} />
          </button>
          {confirm ? (
            <>
              <button type="button" class="button-quiet button-danger" disabled={busy} onClick={() => void run(async () => (await api.removeMemory(m.memoryId), onRemoved(m.memoryId)))}>
                Forget
              </button>
              <button type="button" class="link-button" onClick={() => setConfirm(false)}>
                Keep
              </button>
            </>
          ) : (
            <button type="button" class="icon-button icon-button-sm" aria-label="Forget" title="Forget" onClick={() => setConfirm(true)}>
              <Icon name="trash" size={16} />
            </button>
          )}
        </span>
      )}
    </li>
  );
}
