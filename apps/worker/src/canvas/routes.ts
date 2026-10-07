// Route handlers for the canvas. The ProjectDO keeps canvases and their builds; this Worker serves what they made under
// its sandbox policy (render.ts): an app runs sandboxed on the canvas (with the error reporter), downloads as the page
// itself, and prints from a sandboxed page that opens the print dialog; a document is rendered from its Markdown the
// same three ways, never with a script of its own.
import { CANVAS_BRIEF_MAX, type CanvasListResponse, type CanvasResponse, type CanvasSnapshot } from '@headcount/protocol/ext/canvas';
import { HttpError, json, readJson, type RouteHandler } from '../lib/http';
import { projectStub } from '../lib/stubs';
import { APP_CSP, DOCUMENT_CSP, PRINT_CSP, PRINTER, REPORTER, documentPage, fileName, injectHead, page, documentViewCsp } from './render';
import { BRAND } from '@headcount/protocol';

const isCanvasId = (id: string | undefined): id is string => !!id && /^cnv_[a-f0-9]{16}$/.test(id);

type Op = { accepted: true; canvas: CanvasSnapshot } | { accepted: false; code: 'bad_request' | 'not_found' | 'conflict' | 'rate_limited'; message: string };
type Content = { canvas: CanvasSnapshot; text: string; from: 'final' | 'preview' } | null;

const answer = (r: Op, status = 202) => {
  if (!r.accepted) throw new HttpError(r.code, r.message);
  return json<CanvasResponse>({ canvas: r.canvas }, { status });
};

async function body(req: Request): Promise<Record<string, unknown>> {
  const b = await readJson<Record<string, unknown>>(req);
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new HttpError('bad_request', 'Send it as a JSON object.');
  return b;
}

function brief(v: unknown): string {
  if (typeof v !== 'string' || !v.trim()) throw new HttpError('bad_request', 'Say in a sentence what to build.');
  if (v.length > CANVAS_BRIEF_MAX) throw new HttpError('bad_request', `Keep it under ${CANVAS_BRIEF_MAX} characters.`);
  return v;
}

export const handleListCanvas: RouteHandler = async (_req, { env }) => json<CanvasListResponse>({ canvases: (await projectStub(env).listCanvas()) as unknown as CanvasSnapshot[] });

export const handleCreateCanvas: RouteHandler = async (req, { env }) => {
  const b = await body(req);
  if (b.kind !== undefined && b.kind !== 'app' && b.kind !== 'document') throw new HttpError('bad_request', 'A canvas is an app or a document.');
  if (b.title !== undefined && typeof b.title !== 'string') throw new HttpError('bad_request', 'The title must be text.');
  const r = (await projectStub(env).createCanvas({ brief: brief(b.brief), ...(typeof b.title === 'string' ? { title: b.title } : {}), ...(b.kind ? { kind: b.kind as 'app' | 'document' } : {}), by: 'owner' })) as unknown as Op;
  return answer(r);
};

export const handleGetCanvas: RouteHandler = async (_req, { env, params }) => {
  if (!isCanvasId(params.id)) throw new HttpError('not_found', 'No such canvas.');
  const r = (await projectStub(env).getCanvas(params.id)) as unknown as CanvasResponse | null;
  if (!r) throw new HttpError('not_found', 'No such canvas.');
  return json<CanvasResponse>(r);
};

export const handleReviseCanvas: RouteHandler = async (req, { env, params }) => {
  if (!isCanvasId(params.id)) throw new HttpError('not_found', 'No such canvas.');
  const b = await body(req);
  return answer((await projectStub(env).reviseCanvas(params.id, brief(b.brief), 'owner')) as unknown as Op);
};

export const handleRepairCanvas: RouteHandler = async (req, { env, params }) => {
  if (!isCanvasId(params.id)) throw new HttpError('not_found', 'No such canvas.');
  const b = await body(req);
  return answer((await projectStub(env).repairCanvas(params.id, b.errors)) as unknown as Op);
};

export const handleRetryCanvas: RouteHandler = async (_req, { env, params }) => {
  if (!isCanvasId(params.id)) throw new HttpError('not_found', 'No such canvas.');
  return answer((await projectStub(env).retryCanvas(params.id)) as unknown as Op);
};

export const handleRemoveCanvas: RouteHandler = async (_req, { env, params }) => {
  if (!isCanvasId(params.id)) throw new HttpError('not_found', 'No such canvas.');
  const r = (await projectStub(env).removeCanvas(params.id)) as { removed: boolean };
  if (!r.removed) throw new HttpError('not_found', 'No such canvas.');
  return json({ removed: true });
};

async function content(env: Parameters<RouteHandler>[1]['env'], id: string | undefined, preview = false): Promise<NonNullable<Content>> {
  if (!isCanvasId(id)) throw new HttpError('not_found', 'No such canvas.');
  const c = (await projectStub(env).canvasContent(id, preview)) as unknown as Content;
  if (!c) throw new HttpError('not_found', 'This canvas has not been built yet.');
  return c;
}

const documentMeta = (c: CanvasSnapshot) => `${c.words ?? 0} words · made with ${BRAND.name} · ${c.updatedAt.slice(0, 10)}`;

/** GET /api/canvas/:id/view[?preview=1] → the app (sandboxed, with the error reporter) or the rendered document. */
export const handleViewCanvas: RouteHandler = async (_req, { env, params, url }) => {
  const c = await content(env, params.id, url.searchParams.get('preview') === '1');
  if (c.canvas.kind === 'document') return page(documentPage(c.canvas.title, c.text, documentMeta(c.canvas), { ask: true }), await documentViewCsp());
  return page(injectHead(c.text, REPORTER), APP_CSP);
};

/** GET /api/canvas/:id/download → one HTML file (the app itself, or the document rendered as a page). */
export const handleDownloadCanvas: RouteHandler = async (_req, { env, params }) => {
  const c = await content(env, params.id);
  const html = c.canvas.kind === 'document' ? documentPage(c.canvas.title, c.text, documentMeta(c.canvas)) : c.text;
  return page(html, c.canvas.kind === 'document' ? DOCUMENT_CSP : APP_CSP, fileName(c.canvas.title, 'html'));
};

/** GET /api/canvas/:id/print → the page with the print dialog opening once it has loaded ("Save as PDF"). */
export const handlePrintCanvas: RouteHandler = async (_req, { env, params }) => {
  const c = await content(env, params.id);
  const html = c.canvas.kind === 'document' ? documentPage(c.canvas.title, c.text, documentMeta(c.canvas)) : c.text;
  return page(injectHead(html, PRINTER), PRINT_CSP);
};

/** GET /api/canvas/:id/source → the Markdown of a document, or the HTML of an app, as text (to read or save). */
export const handleCanvasSource: RouteHandler = async (_req, { env, params, url }) => {
  const c = await content(env, params.id);
  const ext = c.canvas.kind === 'document' ? 'md' : 'html';
  return new Response(c.text, {
    headers: {
      'content-type': `${c.canvas.kind === 'document' ? 'text/markdown' : 'text/plain'}; charset=utf-8`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      ...(url.searchParams.get('download') === '1' ? { 'content-disposition': `attachment; filename="${fileName(c.canvas.title, ext)}"` } : {}),
    },
  });
};
