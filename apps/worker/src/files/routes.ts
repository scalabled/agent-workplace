// Files routes (ext/files.ts): the organization's images and videos (list, make, serve, remove) and Markdown documents
// exported as Word, Excel or PowerPoint. Bytes come from R2 under the organization's own prefix, found through its
// WorkspaceDO, so one organization can never read another's file by guessing a name.
import { EXPORT_MARKDOWN_MAX, FILE_CHANGE_MAX, FILE_NAME_RE, FILE_PROMPT_MAX, type EditImageRequest, type ExportRequest, type FilesResponse, type MakeFileResponse, type MakeImageRequest, type MakeVideoRequest } from '@headcount/protocol/ext/files';
import { HttpError, json, readJson, type RouteHandler } from '../lib/http';
import { workspaceStub } from '../lib/stubs';
import { whoOf } from '../trust/routes';
import type { Made } from './store';
import { EXPORT_MIME, fileNameOf, toDocx, toPptx, toXlsx } from './export';

export const handleListFiles: RouteHandler = async (_req, { env }) => json<FilesResponse>((await workspaceStub(env).filesList()) as unknown as FilesResponse);

/** GET /api/files/:fileName → the bytes (private, immutable: a file never changes under its name). */
export const handleGetFile: RouteHandler = async (req, { env, params }) => {
  const name = params.fileName ?? '';
  if (!FILE_NAME_RE.test(name)) throw new HttpError('not_found', 'No such file.');
  const stored = (await workspaceStub(env).fileStored(name)) as unknown as { key: string; mime: string; bytes: number } | null;
  if (!stored) throw new HttpError('not_found', 'No such file, or it is still being made.');
  const etag = `"${name}"`;
  const headers = new Headers({
    etag,
    'cache-control': 'private, max-age=31536000, immutable',
    'content-type': stored.mime,
    'x-content-type-options': 'nosniff',
    // An SVG placeholder opened on its own must not run anything.
    'content-security-policy': "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox",
  });
  if (req.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
  const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.get('range') ?? '');
  if (range) {
    // Videos seek with ranges (Safari asks for them before it will play).
    const start = Number(range[1]);
    const end = range[2] ? Math.min(Number(range[2]), stored.bytes - 1) : stored.bytes - 1;
    if (start >= stored.bytes || start > end) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${stored.bytes}` } });
    const part = await env.BLOBS.get(stored.key, { range: { offset: start, length: end - start + 1 } });
    if (!part) throw new HttpError('not_found', 'No such file.');
    headers.set('content-range', `bytes ${start}-${end}/${stored.bytes}`);
    headers.set('accept-ranges', 'bytes');
    headers.set('content-length', String(end - start + 1));
    return new Response(part.body, { status: 206, headers });
  }
  const obj = await env.BLOBS.get(stored.key);
  if (!obj) throw new HttpError('not_found', 'No such file.');
  headers.set('accept-ranges', 'bytes');
  headers.set('content-length', String(stored.bytes));
  return new Response(obj.body, { headers });
};

function made(r: Made): Response {
  if (!r.ok) throw new HttpError(r.code, r.message, r.missingKeys ? { missingKeys: r.missingKeys } : undefined);
  return json<MakeFileResponse>({ file: r.file }, { status: 202 });
}

const promptOf = (b: { prompt?: unknown } | null) => {
  if (!b || typeof b.prompt !== 'string' || b.prompt.trim().length < 3) throw new HttpError('bad_request', 'Describe what to make in a few words.');
  if (b.prompt.length > FILE_PROMPT_MAX) throw new HttpError('bad_request', `Keep the description under ${FILE_PROMPT_MAX} characters.`);
  return b.prompt.trim();
};

/** POST /api/files/image {prompt, aspect?} → 202 {file} (working; ready in a moment as file.updated). */
export const handleMakeImage: RouteHandler = async (req, rc) => {
  const b = await readJson<Partial<MakeImageRequest>>(req);
  const prompt = promptOf(b);
  return made((await workspaceStub(rc.env).makeImage({ prompt, ...(typeof b?.aspect === 'string' ? { aspect: b.aspect } : {}), madeBy: 'owner', source: { kind: 'files' } })) as unknown as Made);
};

/** POST /api/files/video {prompt, aspect?, seconds?} → 202 {file} (working; usually ready in a minute or two). */
export const handleMakeVideo: RouteHandler = async (req, rc) => {
  const b = await readJson<Partial<MakeVideoRequest>>(req);
  const prompt = promptOf(b);
  return made(
    (await workspaceStub(rc.env).makeVideo({ prompt, ...(typeof b?.aspect === 'string' ? { aspect: b.aspect } : {}), ...(typeof b?.seconds === 'number' ? { seconds: b.seconds } : {}), madeBy: 'owner', source: { kind: 'files' } })) as unknown as Made,
  );
};

/** POST /api/files/:fileName/edit {change} → 202 {file}: a new version of the image with the change (the original is kept). */
export const handleEditFile: RouteHandler = async (req, rc) => {
  const fileId = /^fil_[a-f0-9]{20}/.exec(rc.params.fileName ?? '')?.[0];
  if (!fileId) throw new HttpError('not_found', 'No such file.');
  const b = await readJson<Partial<EditImageRequest>>(req);
  if (!b || typeof b.change !== 'string' || b.change.trim().length < 3) throw new HttpError('bad_request', 'Say what should change, in a few words.');
  if (b.change.length > FILE_CHANGE_MAX) throw new HttpError('bad_request', `Keep the change under ${FILE_CHANGE_MAX} characters.`);
  return made((await workspaceStub(rc.env).editImage({ fileId, change: b.change.trim(), madeBy: 'owner' })) as unknown as Made);
};

export const handleRemoveFile: RouteHandler = async (_req, rc) => {
  const name = rc.params.fileName ?? '';
  const fileId = /^fil_[a-f0-9]{20}/.exec(name)?.[0];
  if (!fileId) throw new HttpError('not_found', 'No such file.');
  if (!(await workspaceStub(rc.env).removeFile(fileId, whoOf(rc)))) throw new HttpError('not_found', 'No such file.');
  return json({ removed: true });
};

/** POST /api/export {title, markdown, format} → the document as a download. */
export const handleExport: RouteHandler = async (req) => {
  const b = await readJson<Partial<ExportRequest>>(req);
  if (!b || typeof b.markdown !== 'string' || typeof b.title !== 'string') throw new HttpError('bad_request', 'Send {title, markdown, format}.');
  if (b.markdown.length > EXPORT_MARKDOWN_MAX) throw new HttpError('payload_too_large', 'That document is too long to export.');
  const title = b.title.replace(/\s+/g, ' ').trim().slice(0, 120) || 'Document';
  const format = b.format;
  if (format !== 'docx' && format !== 'xlsx' && format !== 'pptx' && format !== 'md') throw new HttpError('bad_request', 'Choose docx, xlsx, pptx or md.');
  const bytes = format === 'docx' ? toDocx(title, b.markdown) : format === 'xlsx' ? toXlsx(title, b.markdown) : format === 'pptx' ? toPptx(title, b.markdown) : new TextEncoder().encode(b.markdown);
  const name = fileNameOf(title, format);
  return new Response(bytes, {
    headers: {
      'content-type': EXPORT_MIME[format],
      'content-disposition': `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
};
