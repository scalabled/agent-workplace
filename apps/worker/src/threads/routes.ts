// Side chats in documents (ext/threads.ts): list a document's threads, ask about a passage, reply, resolve.
import { isDocRef, THREAD_QUOTE_MAX, THREAD_TEXT_MAX, type DocThread, type ThreadResponse, type ThreadsResponse } from '@headcount/protocol/ext/threads';
import { HttpError, json, readJson, type RouteContext, type RouteHandler } from '../lib/http';
import { workspaceStub } from '../lib/stubs';
import { isThreadId } from './threads';

type Said = { thread: DocThread } | { error: string; code: 'not_found' | 'rate_limited' | 'not_configured' };
const by = (rc: RouteContext) => ({ email: rc.identity?.email ?? '', name: rc.identity?.name ?? '' });
const text = (v: unknown) => {
  if (typeof v !== 'string' || !v.trim()) throw new HttpError('bad_request', 'Say what you would like to know or change.');
  if (v.length > THREAD_TEXT_MAX) throw new HttpError('bad_request', `Keep it under ${THREAD_TEXT_MAX} characters.`);
  return v.trim();
};
const said = (r: Said, status = 200) => {
  if ('error' in r) throw new HttpError(r.code, r.error);
  return json<ThreadResponse>({ thread: r.thread }, { status });
};

export const handleListThreads: RouteHandler = async (_req, rc) => {
  const doc = rc.url.searchParams.get('doc');
  if (!isDocRef(doc)) throw new HttpError('bad_request', 'Say which document (?doc=canvas:…, deliverable:…, job:… or handbook).');
  return json<ThreadsResponse>({ threads: (await workspaceStub(rc.env).threadsList(doc)) as unknown as DocThread[] });
};

export const handleStartThread: RouteHandler = async (req, rc) => {
  const b = await readJson<Record<string, unknown>>(req);
  if (!b || !isDocRef(b.doc)) throw new HttpError('bad_request', 'Say which document.');
  const anchor = typeof b.anchor === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(b.anchor) ? b.anchor : '';
  const quote = typeof b.quote === 'string' ? b.quote.replace(/\s+/g, ' ').trim().slice(0, THREAD_QUOTE_MAX) : '';
  if (!quote) throw new HttpError('bad_request', 'Select the passage you are asking about.');
  return said((await workspaceStub(rc.env).threadStart({ doc: b.doc, anchor, quote, text: text(b.text) }, by(rc))) as unknown as Said, 201);
};

export const handleReplyThread: RouteHandler = async (req, rc) => {
  if (!isThreadId(rc.params.id)) throw new HttpError('not_found', 'No such conversation.');
  const b = await readJson<Record<string, unknown>>(req);
  return said((await workspaceStub(rc.env).threadReply(rc.params.id, text(b?.text), by(rc))) as unknown as Said);
};

export const handleResolveThread: RouteHandler = async (req, rc) => {
  if (!isThreadId(rc.params.id)) throw new HttpError('not_found', 'No such conversation.');
  const b = await readJson<{ status?: unknown }>(req);
  if (b?.status !== 'open' && b?.status !== 'resolved') throw new HttpError('bad_request', 'Mark it open or resolved.');
  const t = (await workspaceStub(rc.env).threadResolve(rc.params.id, b.status)) as unknown as DocThread | null;
  if (!t) throw new HttpError('not_found', 'No such conversation.');
  return json<ThreadResponse>({ thread: t });
};
