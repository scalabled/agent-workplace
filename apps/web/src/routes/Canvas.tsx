// The Canvas: apps and documents made for the owner (personagram-ai's canvas). Ask the Chief of Staff in Talk ("build
// me a tip calculator", "write a one-page plan"), or describe it here. Each one opens on its own page to use, change,
// download as HTML or export to PDF.
import type { CanvasKind, CanvasSnapshot } from '@headcount/protocol/ext/canvas';
import { useEffect, useState } from 'preact/hooks';
import { api, ApiError } from '../api/client';
import { CanvasView, statusLine } from '../canvas/CanvasView';
import { chiefName } from '../chief';
import { Icon } from '../components/Icon';
import { Link } from '../components/Link';
import { navigate, paths } from '../router';
import { canvasList, upsertCanvas } from '../store';
import { PageTitle } from '../links/CopyLink';
import './pages.css';

const when = (at: string) => new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export function Canvas() {
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    api
      .listCanvas()
      .then((r) => {
        for (const c of r.canvases) upsertCanvas(c);
        setLoaded(true);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'The canvas could not be loaded. Reload the page to try again.'));
  }, []);
  // Only the latest version of each piece is listed (its page has the others).
  const all = canvasList.value;
  const replaced = new Set(all.map((c) => c.basedOn).filter(Boolean));
  const latest = all.filter((c) => !replaced.has(c.canvasId));
  return (
    <section class="page canvas-page" aria-labelledby="canvas-page-title">
      <header class="page-head">
        <PageTitle id="canvas-page-title">Canvas</PageTitle>
        <p class="page-lede">
          Apps and documents made for you: a calculator, a tracker, a planner, a proposal, a one-page plan. Ask {chiefName.value} in <Link href={paths.talk}>Talk</Link>, or describe one here. Download any of them as HTML or PDF.
        </p>
      </header>
      <MakeSomething />
      {error && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}
      {loaded && !latest.length && <p class="page-fine">Nothing on the canvas yet. Describe an app or a document above to start.</p>}
      <ul class="canvas-list">
        {latest.map((c) => (
          <CanvasCard key={c.canvasId} canvas={c} />
        ))}
      </ul>
    </section>
  );
}

function CanvasCard({ canvas: c }: { canvas: CanvasSnapshot }) {
  return (
    <li>
      <button type="button" class="panel canvas-card" data-status={c.status} onClick={() => navigate(paths.canvasItem(c.canvasId))}>
        <span class="canvas-card-kind" aria-hidden="true">
          <Icon name={c.kind === 'app' ? 'code' : 'book'} size={18} />
        </span>
        <span class="canvas-card-main">
          <span class="canvas-card-title">{c.title}</span>
          <span class="canvas-card-meta">
            {c.kind === 'app' ? 'App' : 'Document'} · {statusLine(c)} · {when(c.updatedAt)}
          </span>
        </span>
        <Icon name="chevronRight" size={16} />
      </button>
    </li>
  );
}

function MakeSomething() {
  const [brief, setBrief] = useState('');
  const [kind, setKind] = useState<CanvasKind>('app');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const make = async (e: Event) => {
    e.preventDefault();
    if (brief.trim().length < 8 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.createCanvas({ brief: brief.trim(), kind });
      upsertCanvas(r.canvas);
      navigate(paths.canvasItem(r.canvas.canvasId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not start. Try again.');
      setBusy(false);
    }
  };
  return (
    <form class="panel canvas-make needs-contributor" onSubmit={make} aria-label="Make something">
      <label class="visually-hidden" for="canvas-brief">
        What should it make?
      </label>
      <textarea
        id="canvas-brief"
        class="note-input"
        rows={3}
        maxLength={4000}
        value={brief}
        placeholder={kind === 'app' ? 'A tip calculator that splits the bill between friends, with a tip slider…' : 'A one-page opening checklist for the café, grouped by station…'}
        onInput={(e) => setBrief((e.target as HTMLTextAreaElement).value)}
      />
      <div class="canvas-make-row">
        <div class="canvas-kind" role="radiogroup" aria-label="What to make">
          {(['app', 'document'] as const).map((k) => (
            <label key={k} class="canvas-kind-option" data-on={kind === k || undefined}>
              <input type="radio" name="canvas-kind" value={k} checked={kind === k} onChange={() => setKind(k)} />
              {k === 'app' ? 'An app' : 'A document'}
            </label>
          ))}
        </div>
        <button type="submit" class="button-primary" disabled={busy || brief.trim().length < 8}>
          <Icon name="sparkle" size={16} /> {kind === 'app' ? 'Build it' : 'Write it'}
        </button>
      </div>
      {error && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

export function CanvasItem({ canvasId }: { canvasId: string }) {
  // Every version, for the versions menu.
  useEffect(() => {
    api
      .listCanvas()
      .then((r) => r.canvases.forEach(upsertCanvas))
      .catch(() => undefined);
  }, [canvasId]);
  return (
    <section class="page canvas-item-page">
      <p class="page-crumb">
        <Link href={paths.canvas}>Canvas</Link>
      </p>
      <CanvasView canvasId={canvasId} />
    </section>
  );
}
