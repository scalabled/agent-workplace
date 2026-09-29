// One canvas (personagram-ai CanvasPanel, for Headcount): an app or a document the Chief of Staff (or the owner) had
// built. While it builds: how many lines are written and the last of them; an app's quick first version plays as soon
// as it lands, and a revision keeps the version it changes on screen until the new one is ready. Everything runs in a
// sandboxed frame (an app: scripts only, in an opaque origin; a document: no scripts at all), so model-written code
// never reaches the page around it. An app that throws errors says so, and the owner can have them fixed. Export:
// Download HTML, Export PDF (the print dialog's "Save as PDF"), the source (Markdown for a document).
import { CANVAS_REPORT_TYPE, type CanvasProgress, type CanvasSnapshot } from '@headcount/protocol/ext/canvas';
import { routePath } from '@headcount/protocol';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { api, ApiError } from '../api/client';
import { chiefName } from '../chief';
import { Icon } from '../components/Icon';
import { navigate, paths } from '../router';
import { canvases, dropCanvas, upsertCanvas } from '../store';

/** Roughly how long a finished piece runs (the progress bar fills toward it). */
const EXPECTED_LINES = { app: 1200, document: 120 };
const POLL_MS = 1000;

const errorOf = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);
const viewUrl = (id: string, preview = false) => `${routePath('viewCanvas', { id })}${preview ? '?preview=1' : ''}`;

/** The versions of a canvas: every canvas that shares its first version, oldest first. */
export function lineageOf(all: Record<string, CanvasSnapshot>, canvasId: string): CanvasSnapshot[] {
  const rootOf = (id: string): string => {
    let at = all[id];
    const seen = new Set<string>();
    while (at?.basedOn && all[at.basedOn] && !seen.has(at.canvasId)) {
      seen.add(at.canvasId);
      at = all[at.basedOn];
    }
    return at?.canvasId ?? id;
  };
  const root = rootOf(canvasId);
  return Object.values(all)
    .filter((c) => rootOf(c.canvasId) === root)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function statusLine(c: CanvasSnapshot, p?: CanvasProgress | null): string {
  if (c.status === 'ready') return c.kind === 'app' ? `${c.lines.toLocaleString()} lines · interactive` : `${(c.words ?? 0).toLocaleString()} words`;
  if (c.status === 'failed') return 'The build failed';
  if (c.status === 'queued') return 'Waiting to start…';
  if (c.previewLines) return `First version · the full one is being written${p?.lines ? ` (${p.lines.toLocaleString()} lines)` : ''}`;
  if (p?.phase === 'expanding') return `Adding depth… ${p.lines.toLocaleString()} lines`;
  return `${c.kind === 'app' ? 'Writing' : 'Drafting'}… ${p?.lines ? `${p.lines.toLocaleString()} lines` : ''}`.trim();
}

export function CanvasView({ canvasId }: { canvasId: string }) {
  const c = canvases.value[canvasId];
  const [progress, setProgress] = useState<CanvasProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reported, setReported] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [change, setChange] = useState('');
  const [source, setSource] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const [frameKey, setFrameKey] = useState(0);

  // Load it, and ask how the build is going while it builds.
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const r = await api.getCanvas(canvasId);
        if (stop) return;
        upsertCanvas(r.canvas);
        setProgress(r.progress ?? null);
        if (r.canvas.status === 'queued' || r.canvas.status === 'building') timer = setTimeout(poll, POLL_MS);
      } catch (err) {
        if (!stop) setError(errorOf(err, 'This canvas could not be read.'));
      }
    };
    void poll();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [canvasId, c?.status]);

  // The app's error reporter (only from this frame).
  useEffect(() => {
    setReported([]);
    const on = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      const d = e.data as { type?: unknown; errors?: unknown };
      if (d?.type !== CANVAS_REPORT_TYPE || !Array.isArray(d.errors)) return;
      setReported(d.errors.filter((x): x is string => typeof x === 'string').slice(0, 8));
    };
    window.addEventListener('message', on);
    return () => window.removeEventListener('message', on);
  }, [canvasId, frameKey]);

  const versions = useMemo(() => lineageOf(canvases.value, canvasId), [canvases.value, canvasId]);
  if (!c) return <p class="page-fine">{error ?? 'Loading…'}</p>;

  const ready = c.status === 'ready';
  const building = c.status === 'queued' || c.status === 'building';
  const base = c.basedOn ? canvases.value[c.basedOn] : undefined;
  // What plays meanwhile: an app's first version, or the version a revision changes.
  const standIn = building ? (c.previewLines ? viewUrl(c.canvasId, true) : base?.status === 'ready' ? viewUrl(base.canvasId) : null) : null;
  const src = ready ? viewUrl(c.canvasId) : standIn;
  const sandbox = c.kind === 'app' ? 'allow-scripts allow-pointer-lock' : '';
  const run = async (fn: () => Promise<{ canvas: CanvasSnapshot }>, fallback: string) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      upsertCanvas(r.canvas);
      if (r.canvas.canvasId !== canvasId) navigate(paths.canvasItem(r.canvas.canvasId));
      return true;
    } catch (err) {
      setError(errorOf(err, fallback));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const fill = Math.min(96, ((progress?.lines ?? 0) / EXPECTED_LINES[c.kind]) * 100);

  return (
    <article class="canvas-view" data-kind={c.kind} data-status={c.status} aria-labelledby="canvas-title">
      <header class="canvas-bar">
        <div class="canvas-heading">
          <p class="canvas-status" role="status">
            {c.kind === 'app' ? 'App' : 'Document'} · {statusLine(c, progress)}
            {c.by === 'chief' ? ` · asked of ${chiefName.value}` : ''}
          </p>
          <h1 id="canvas-title" class="canvas-title">
            {c.title}
          </h1>
        </div>
        <div class="canvas-actions">
          {versions.length > 1 && (
            <label class="canvas-versions">
              <span class="visually-hidden">Versions</span>
              <select class="field-input" value={canvasId} onChange={(e) => navigate(paths.canvasItem((e.target as HTMLSelectElement).value))}>
                {versions.map((v, i) => (
                  <option key={v.canvasId} value={v.canvasId}>
                    Version {i + 1}
                    {v.status === 'ready' ? '' : v.status === 'failed' ? ' (failed)' : ' (building)'}
                  </option>
                ))}
              </select>
            </label>
          )}
          {c.kind === 'app' && (
            <button type="button" class="icon-button" aria-label="Restart" title="Restart" disabled={!src} onClick={() => setFrameKey((k) => k + 1)}>
              <Icon name="retry" size={17} />
            </button>
          )}
          <button type="button" class="icon-button" aria-label="Full screen" title="Full screen" disabled={!src} onClick={() => void frame.current?.requestFullscreen?.().catch(() => undefined)}>
            <Icon name="expand" size={17} />
          </button>
          <a class={`button-quiet button-small${ready ? '' : ' is-disabled'}`} aria-disabled={!ready} href={ready ? routePath('downloadCanvas', { id: c.canvasId }) : undefined} download>
            <Icon name="download" size={15} /> HTML
          </a>
          <a class={`button-quiet button-small${ready ? '' : ' is-disabled'}`} aria-disabled={!ready} href={ready ? routePath('printCanvas', { id: c.canvasId }) : undefined} target="_blank" rel="noopener" title="Opens the print dialog: choose “Save as PDF”">
            <Icon name="download" size={15} /> PDF
          </a>
          {c.kind === 'document' && (
            <a class={`button-quiet button-small${ready ? '' : ' is-disabled'}`} aria-disabled={!ready} href={ready ? `${routePath('canvasSource', { id: c.canvasId })}?download=1` : undefined} download>
              <Icon name="download" size={15} /> Markdown
            </a>
          )}
          <button
            type="button"
            class="icon-button"
            aria-pressed={source !== null}
            aria-label={source !== null ? 'Hide the source' : c.kind === 'app' ? 'View the code' : 'View the Markdown'}
            title={c.kind === 'app' ? 'View the code' : 'View the Markdown'}
            disabled={!ready}
            onClick={() => {
              if (source !== null) setSource(null);
              else
                void api
                  .canvasSource(c.canvasId)
                  .then(setSource)
                  .catch((err) => setError(errorOf(err, 'The source could not be read.')));
            }}
          >
            <Icon name="code" size={17} />
          </button>
        </div>
      </header>

      <div class="canvas-body">
        {src && source === null && (
          <iframe key={`${src}#${frameKey}`} ref={frame} class="canvas-frame" src={src} sandbox={sandbox} referrerpolicy="no-referrer" title={c.title} />
        )}
        {source !== null && (
          <pre class="canvas-source" tabIndex={0}>
            {source}
          </pre>
        )}
        {building && !standIn && (
          <div class="canvas-building">
            <div class="canvas-orb" aria-hidden="true" />
            <strong>{c.basedOn ? `Changing “${c.title}”` : c.kind === 'app' ? `Building “${c.title}”` : `Writing “${c.title}”`}</strong>
            <span>
              {statusLine(c, progress)}
              {c.kind === 'app' && !c.basedOn && !c.previewLines ? ' · a first version plays in a moment' : ''}
            </span>
            <div class="canvas-progress" aria-hidden="true">
              <i style={{ width: `${fill}%` }} />
            </div>
            {progress?.tail && (
              <pre class="canvas-tail" aria-hidden="true">
                {progress.tail}
              </pre>
            )}
          </div>
        )}
        {building && standIn && (
          <p class="canvas-chip" role="status">
            {c.previewLines ? 'Playing the first version' : `Showing the current version while ${c.brief.startsWith('Fix the errors') ? 'a fix' : 'the change'} is made`}
            {progress?.lines ? ` · ${progress.lines.toLocaleString()} lines written` : ''}
          </p>
        )}
        {c.status === 'failed' && (
          <div class="canvas-failed">
            <p>{c.error ?? 'The build failed.'}</p>
            <button type="button" class="button-primary button-small" disabled={busy} onClick={() => void run(() => api.retryCanvas(c.canvasId), 'That did not start.')}>
              Build it again
            </button>
          </div>
        )}
      </div>

      {ready && c.kind === 'app' && reported.length > 0 && (
        <div class="canvas-report" role="alert">
          <p>
            It reported {reported.length === 1 ? 'a problem' : `${reported.length} problems`} when it ran.{' '}
            <button type="button" class="button-primary button-small" disabled={busy} onClick={() => void run(() => api.repairCanvas(c.canvasId, reported), 'That did not start.')}>
              Fix {reported.length === 1 ? 'it' : 'them'}
            </button>
          </p>
          <details>
            <summary>What it said</summary>
            <ul>
              {reported.map((r, i) => (
                <li key={i}>
                  <code>{r}</code>
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}

      {ready && (
        <form
          class="canvas-change"
          onSubmit={(e) => {
            e.preventDefault();
            if (change.trim()) void run(() => api.reviseCanvas(c.canvasId, change.trim()), 'That did not start.').then((ok) => ok && setChange(''));
          }}
        >
          <label class="visually-hidden" for="canvas-change">
            What should change?
          </label>
          <input id="canvas-change" class="field-input" maxLength={4000} value={change} placeholder={c.kind === 'app' ? 'Change something: “add a dark mode”, “split by percentage too”…' : 'Change something: “make it shorter”, “add a budget table”…'} onInput={(e) => setChange((e.target as HTMLInputElement).value)} />
          <button type="submit" class="button-primary button-small" disabled={busy || !change.trim()}>
            Make the change
          </button>
        </form>
      )}

      {error && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}
      <footer class="canvas-foot">
        <details class="canvas-brief">
          <summary>The brief</summary>
          <p>{c.brief}</p>
        </details>
        {confirm ? (
          <span>
            <button
              type="button"
              class="button-danger button-small"
              onClick={() =>
                void api
                  .removeCanvas(c.canvasId)
                  .then(() => {
                    dropCanvas(c.canvasId);
                    navigate(paths.canvas);
                  })
                  .catch((err) => setError(errorOf(err, 'That did not go through.')))
              }
            >
              Delete this version
            </button>{' '}
            <button type="button" class="button-quiet button-small" onClick={() => setConfirm(false)}>
              Keep it
            </button>
          </span>
        ) : (
          <button type="button" class="button-quiet button-small" onClick={() => setConfirm(true)}>
            <Icon name="trash" size={14} /> Delete
          </button>
        )}
      </footer>
    </article>
  );
}
