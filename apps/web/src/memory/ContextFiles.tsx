// Files shared with the team (Inc 4 context cards): a drop zone and the list, for one scope (a project, a coworker) or
// for every scope (the Memory page, where a new file is for everyone). Each file is read, summarised, and searched when
// a question bears on it; removing one forgets its text.
import type { CardKind, ContextCard } from '@headcount/protocol/ext/memory';
import { useEffect, useRef, useState } from 'preact/hooks';
import { api, ApiError } from '../api/client';
import { Icon } from '../components/Icon';
import { FILE_ACCEPT, scopeLabel, sizeOf, uploadFiles } from './upload';
import { CopyLink } from '../links/CopyLink';
import { paths } from '../router';

const KIND_WORDS: Record<CardKind, string> = { pdf: 'PDF', docx: 'Word', xlsx: 'Excel', csv: 'CSV', text: 'Text', image: 'Picture' };

/** Where a file lives: its project, its coworker's profile, or the Memory page. */
function pageOfScope(scope: string): string {
  if (scope.startsWith('project:')) return paths.project(scope.slice(8));
  if (scope.startsWith('coworker:')) return `${paths.coworker(scope.slice(9))}?tab=work`;
  return paths.memory;
}
/** The full summary is written in the background: look again once. */
const SUMMARY_RECHECK_MS = 8000;

export function ContextFiles({ scope, all = false, title = 'Files', hint }: { scope: string; all?: boolean; title?: string; hint?: string }) {
  const [cards, setCards] = useState<ContextCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const recheck = useRef<ReturnType<typeof setTimeout>>();

  const load = () =>
    api
      .listCards(all ? undefined : scope)
      .then((r) => setCards(r.cards))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load the files. Reload the page to try again.'));
  useEffect(() => {
    void load();
    return () => clearTimeout(recheck.current);
  }, [scope, all]);

  const share = async (files: File[]) => {
    if (!files.length || busy) return;
    setErrors([]);
    setBusy(files.length === 1 ? `Reading “${files[0]!.name}”…` : `Reading ${files.length} files…`);
    const r = await uploadFiles(files, scope);
    setBusy(null);
    setErrors(r.errors);
    if (r.added.length) {
      setCards((c) => [...r.added, ...(c ?? []).filter((x) => !r.added.some((a) => a.cardId === x.cardId))]);
      clearTimeout(recheck.current);
      recheck.current = setTimeout(() => void load(), SUMMARY_RECHECK_MS);
    }
  };

  return (
    <section class="context-files" aria-labelledby={`files-${scope}`}>
      <h2 id={`files-${scope}`} class="context-files-title">
        {title}
      </h2>
      {hint && <p class="page-fine">{hint}</p>}
      <div
        class="file-drop needs-contributor"
        data-over={over || undefined}
        data-busy={busy ? true : undefined}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void share([...(e.dataTransfer?.files ?? [])]);
        }}
      >
        <Icon name="attach" size={18} />
        <span>{busy ?? 'Drop a PDF, Word, Excel, CSV, text file or picture here, or'}</span>
        {!busy && (
          <button type="button" class="link-button" onClick={() => input.current?.click()}>
            choose one
          </button>
        )}
        <input
          ref={input}
          type="file"
          multiple
          accept={FILE_ACCEPT}
          class="visually-hidden"
          aria-label={`Share a file (${title})`}
          tabIndex={-1}
          onChange={(e) => {
            const el = e.currentTarget;
            void share([...(el.files ?? [])]);
            el.value = '';
          }}
        />
      </div>
      {errors.map((m) => (
        <p key={m} class="form-error" role="alert">
          {m}
        </p>
      ))}
      {error && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}
      {cards && cards.length > 0 && (
        <ul class="card-list">
          {cards.map((c) => (
            <CardRow key={c.cardId} card={c} showScope={all} onRemoved={() => setCards((l) => (l ?? []).filter((x) => x.cardId !== c.cardId))} />
          ))}
        </ul>
      )}
    </section>
  );
}

function CardRow({ card: c, showScope, onRemoved }: { card: ContextCard; showScope: boolean; onRemoved: () => void }) {
  const [text, setText] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remove = async () => {
    try {
      await api.removeCard(c.cardId);
      onRemoved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That file could not be removed.');
    }
  };
  return (
    <li class="card-row" id={c.cardId}>
      <span class="card-row-icon" aria-hidden="true" data-image={c.kind === 'image' || undefined}>
        {c.kind === 'image' ? <img src={api.cardFileUrl(c.cardId)} alt="" loading="lazy" /> : <Icon name="file" size={18} />}
      </span>
      <div class="card-row-main">
        <p class="card-row-name">{c.name}</p>
        <p class="connector-meta">
          {KIND_WORDS[c.kind]} · {sizeOf(c.bytes)}
          {c.chunks > 1 ? ` · ${c.chunks} parts` : ''}
          {showScope ? ` · for ${scopeLabel(c.scope)}` : ''}
        </p>
        {c.summary && <p class="card-row-summary">{c.summary}</p>}
        <details
          class="connector-tools"
          onToggle={(e) => {
            if ((e.currentTarget as HTMLDetailsElement).open && text === null)
              api
                .getCard(c.cardId)
                .then((r) => setText(r.text ?? ''))
                .catch(() => setText(''));
          }}
        >
          <summary>{c.kind === 'image' ? 'What it shows' : 'What was read'}</summary>
          {text === null ? <p class="page-fine">Loading…</p> : <pre class="card-row-text">{text || 'Nothing to show.'}</pre>}
        </details>
        {error && <p class="connector-error">{error}</p>}
      </div>
      <CopyLink page={pageOfScope(c.scope)} at={c.cardId} label={`Copy link to ${c.name}`} what="Link to this file" />
      {confirm ? (
        <span class="card-row-confirm needs-contributor">
          <button type="button" class="button-quiet button-danger" onClick={() => void remove()}>
            Remove
          </button>
          <button type="button" class="link-button" onClick={() => setConfirm(false)}>
            Keep
          </button>
        </span>
      ) : (
        <button type="button" class="icon-button icon-button-sm needs-contributor" aria-label={`Remove ${c.name}`} title="Remove (its text is forgotten too)" onClick={() => setConfirm(true)}>
          <Icon name="trash" size={16} />
        </button>
      )}
    </li>
  );
}
