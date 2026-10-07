// Files: everything the office makes, in one place. What was made comes first: images and videos, the documents the
// projects delivered (each downloadable as Word, PowerPoint or Excel), the apps and pages built on the canvas. Making a
// new image or short video (or asking the Chief in Talk) comes last, so a phone opens on the files themselves.
import { IMAGE_ASPECTS, VIDEO_ASPECTS, VIDEO_SECONDS_MAX, type FileView, type ImageAspect, type VideoAspect } from '@headcount/protocol/ext/files';
import type { TeamProjectSnapshot } from '@headcount/protocol/ext/projects';
import { useEffect, useState } from 'preact/hooks';
import { api, ApiError } from '../api/client';
import { isOwner, mayContribute } from '../auth/session';
import { catalog, loadCatalog } from '../catalog';
import { chiefName } from '../chief';
import { ExportMenu } from '../components/ExportMenu';
import { Icon } from '../components/Icon';
import { Link } from '../components/Link';
import { PageTitle } from '../links/CopyLink';
import { paths } from '../router';
import { canvasList, fileList, projectList, upsertCanvas, upsertFiles } from '../store';
import './pages.css';
import './files.css';

const errorOf = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);
const day = (at: string) => new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const ASPECT_WORDS: Record<string, string> = { '1:1': 'Square', '16:9': 'Wide', '4:3': 'Landscape', '3:4': 'Portrait', '9:16': 'Tall (reels, stories)' };
const DELIVERED = ['done', 'partial', 'needs_review'];

export function Files() {
  useEffect(() => void loadCatalog(), []);
  const [can, setCan] = useState<{ image: boolean; video: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api
      .listFiles()
      .then((r) => {
        upsertFiles(r.files);
        setCan(r.can);
      })
      .catch((err) => setError(errorOf(err, 'Files could not be loaded.')));
    api
      .listCanvas()
      .then((r) => r.canvases.forEach(upsertCanvas))
      .catch(() => undefined);
  }, []);
  const media = fileList.value;
  // While something is being made, check now and then too (an update can land before the live feed connects).
  const working = media.some((f) => f.status === 'working');
  useEffect(() => {
    if (!working) return;
    const t = setInterval(() => {
      api
        .listFiles()
        .then((r) => upsertFiles(r.files))
        .catch(() => undefined);
    }, 2500);
    return () => clearInterval(t);
  }, [working]);
  const documents = projectList.value.filter((p) => DELIVERED.includes(p.status) && p.deliverable);
  const apps = canvasList.value.filter((c) => c.status === 'ready');
  return (
    <section class="page files-page" aria-labelledby="files-title">
      <header class="page-head">
        <PageTitle id="files-title">Files</PageTitle>
        <p class="page-lede">Everything your office makes: images and videos, the documents your projects deliver, and the apps and pages built for you. Download any document as Word, PowerPoint or Excel.</p>
      </header>
      {error && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}

      <section class="files-section" aria-labelledby="media-title">
        <div class="files-section-head">
          <h2 id="media-title" class="admin-card-title">
            Images and videos
          </h2>
          {mayContribute.value && can && (can.image || can.video) && (
            <a href="#make" class="button-quiet button-small">
              <Icon name="sparkle" size={14} /> Make an image or video
            </a>
          )}
        </div>
        {media.length ? (
          <ul class="media-grid">
            {media.map((f) => (
              <MediaTile key={f.fileId} file={f} />
            ))}
          </ul>
        ) : (
          <p class="page-fine">Nothing made yet. Describe one at the bottom of this page, or ask {chiefName.value} in Talk: “Make an image for our spring sale”.</p>
        )}
      </section>

      <section class="files-section" aria-labelledby="docs-title">
        <h2 id="docs-title" class="admin-card-title">
          Documents
        </h2>
        {documents.length ? (
          <ul class="file-rows">
            {documents.map((p) => (
              <DocumentRow key={p.projectId} project={p} />
            ))}
          </ul>
        ) : (
          <p class="page-fine">
            Each project ends with a document (or a page, or a file). <Link href={paths.projects}>Projects</Link> lists what is under way.
          </p>
        )}
      </section>

      <section class="files-section" aria-labelledby="apps-title">
        <h2 id="apps-title" class="admin-card-title">
          Apps and pages
        </h2>
        {apps.length ? (
          <ul class="file-rows">
            {apps.map((c) => (
              <li key={c.canvasId} class="file-row">
                <Icon name={c.kind === 'app' ? 'code' : 'file'} size={18} />
                <span class="file-row-main">
                  <Link href={paths.canvasItem(c.canvasId)} class="file-row-title">
                    {c.title}
                  </Link>
                  <span class="page-fine">
                    {c.kind === 'app' ? 'App' : 'Page'} · {day(c.updatedAt)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p class="page-fine">
            Ask {chiefName.value} for a calculator, a booking page or a price list, or start one on the <Link href={paths.canvas}>Canvas</Link>.
          </p>
        )}
      </section>

      {mayContribute.value && can && <MakePanel can={can} />}

      <p class="page-fine files-shared">
        <Icon name="attach" size={16} />
        <span>
          What you showed the team (files, photos, documents) is kept in <Link href={paths.memory}>Memory</Link>.
        </span>
      </p>
    </section>
  );
}

function MakePanel({ can }: { can: { image: boolean; video: boolean } }) {
  const [kind, setKind] = useState<'image' | 'video'>(can.image ? 'image' : 'video');
  const [prompt, setPrompt] = useState('');
  const [aspect, setAspect] = useState<string>('1:1');
  const [seconds, setSeconds] = useState(6);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!can.image && !can.video)
    return (
      <p id="make" class="panel files-make files-make-off">
        Images need an OpenAI or xAI key, and videos an xAI key. {isOwner.value ? <Link href={paths.admin('keys')}>Add one in Admin → Provider keys</Link> : 'An owner adds them in Admin → Provider keys.'}
      </p>
    );
  const aspects: readonly string[] = kind === 'image' ? IMAGE_ASPECTS : VIDEO_ASPECTS;
  const pick = (k: 'image' | 'video') => {
    setKind(k);
    setAspect(k === 'image' ? '1:1' : '16:9');
  };
  const make = async (e: Event) => {
    e.preventDefault();
    if (prompt.trim().length < 3 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = kind === 'image' ? await api.makeImage({ prompt: prompt.trim(), aspect: aspect as ImageAspect }) : await api.makeVideo({ prompt: prompt.trim(), aspect: aspect as VideoAspect, seconds });
      upsertFiles([r.file]);
      setPrompt('');
    } catch (err) {
      setError(errorOf(err, 'That could not be started. Try again.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form id="make" class="panel files-make" onSubmit={make} aria-labelledby="make-title">
      <h2 id="make-title" class="admin-card-title">
        Make an image or a video
      </h2>
      <div class="files-make-kinds" role="radiogroup" aria-label="What to make">
        {(['image', 'video'] as const).map((k) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} class="files-kind" disabled={!can[k]} title={can[k] ? undefined : k === 'video' ? 'Videos need an xAI key' : 'Images need an OpenAI or xAI key'} onClick={() => pick(k)}>
            <Icon name={k === 'image' ? 'camera' : 'play'} size={16} /> {k === 'image' ? 'Image' : 'Video'}
          </button>
        ))}
      </div>
      <label class="field">
        <span class="field-label">Describe it</span>
        <textarea
          class="note-input"
          rows={2}
          maxLength={1500}
          value={prompt}
          placeholder={kind === 'image' ? 'e.g. A flat-lay of amethyst and rose quartz on white linen, soft morning light, room for text on the left' : 'e.g. A slow pan across a shelf of glowing crystals at dusk, warm light, dust in the air'}
          onInput={(e) => setPrompt((e.target as HTMLTextAreaElement).value)}
        />
      </label>
      <div class="admin-row">
        <label class="field field-inline">
          <span class="field-label">Shape</span>
          <select class="field-input" value={aspect} onChange={(e) => setAspect((e.target as HTMLSelectElement).value)}>
            {aspects.map((a) => (
              <option key={a} value={a}>
                {ASPECT_WORDS[a] ?? a} ({a})
              </option>
            ))}
          </select>
        </label>
        {kind === 'video' && (
          <label class="field field-inline">
            <span class="field-label">Seconds</span>
            <select class="field-input" value={seconds} onChange={(e) => setSeconds(Number((e.target as HTMLSelectElement).value))}>
              {[4, 6, 8, 10, VIDEO_SECONDS_MAX].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        )}
        <button type="submit" class="button-primary" disabled={busy || prompt.trim().length < 3}>
          <Icon name="sparkle" size={16} /> {busy ? 'Starting…' : kind === 'image' ? 'Make the image' : 'Make the video'}
        </button>
      </div>
      <p class="page-fine">{kind === 'image' ? 'An image takes a moment.' : 'A video takes a minute or two; it appears below when it is ready.'}</p>
      {error && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

function madeByWords(by: string): string {
  if (by === 'owner') return 'you';
  if (by === 'chief') return chiefName.value;
  return catalog.value?.persona(by)?.name.split(' ')[0] ?? 'a coworker';
}

function MediaTile({ file: f }: { file: FileView }) {
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    setBusy(true);
    try {
      await api.removeFile(`${f.fileId}`);
      upsertFiles([f], true);
    } catch {
      setBusy(false);
    }
  };
  const name = f.url?.split('/').pop() ?? f.fileId;
  return (
    <li class="media-tile" data-status={f.status} data-kind={f.kind}>
      <div class="media-frame" style={{ aspectRatio: (f.aspect ?? '1:1').replace(':', ' / ') }}>
        {f.status === 'ready' && f.url ? (
          f.kind === 'video' ? (
            <video src={f.url} controls playsInline preload="metadata" aria-label={f.title} />
          ) : (
            <img src={f.url} alt={f.title} loading="lazy" />
          )
        ) : f.status === 'working' ? (
          <span class="media-working" role="status">
            <Icon name="sparkle" size={20} /> {f.kind === 'video' ? 'Making the video…' : 'Making…'}
          </span>
        ) : (
          <span class="media-failed" role="alert">
            {f.error ?? 'It could not be made.'}
          </span>
        )}
      </div>
      <div class="media-meta">
        <p class="media-title" title={f.prompt}>
          {f.title}
        </p>
        <p class="page-fine">
          {f.kind === 'video' ? `Video${f.seconds ? ` · ${f.seconds}s` : ''}` : 'Image'} · by {madeByWords(f.madeBy)} · {day(f.createdAt)}
          {f.placeholder ? ' · placeholder' : ''}
        </p>
        <div class="media-actions">
          {f.status === 'ready' && f.url && (
            <a class="button-quiet button-small" href={f.url} download={name}>
              <Icon name="download" size={14} /> Download
            </a>
          )}
          {mayContribute.value && f.status !== 'working' && (
            <button type="button" class="icon-button" aria-label={`Remove “${f.title}”`} disabled={busy} onClick={() => void remove()}>
              <Icon name="trash" size={16} />
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

function DocumentRow({ project: p }: { project: TeamProjectSnapshot }) {
  const kind = p.deliverableKind ?? 'document';
  return (
    <li class="file-row">
      <Icon name={kind === 'document' ? 'book' : kind === 'web' ? 'screen' : 'code'} size={18} />
      <span class="file-row-main">
        <Link href={paths.project(p.projectId)} class="file-row-title">
          {p.title}
        </Link>
        <span class="page-fine">
          {kind === 'document' ? 'Document' : kind === 'web' ? 'Web page' : (p.deliverableFilename ?? 'File')} · {p.status === 'needs_review' ? 'waiting for your review' : `delivered ${day(p.finishedAt ?? p.updatedAt)}`}
        </span>
      </span>
      {kind === 'document' ? (
        <ExportMenu title={p.title} markdown={async () => (await api.getProject(p.projectId)).deliverable ?? p.deliverable ?? ''} />
      ) : (
        <Link href={paths.project(p.projectId)} class="button-quiet button-small">
          Open
        </Link>
      )}
    </li>
  );
}
