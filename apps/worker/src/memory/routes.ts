// Route handlers for what the workspace knows (Inc 4): memories, the Handbook, and context cards (files). Everything
// lives in the WorkspaceDO; a file arrives as raw bytes with its name in X-File-Name and its scope in ?scope=.
import {
  CARD_UPLOAD_MAX,
  HANDBOOK_SECTION_MAX,
  MEMORY_KINDS,
  MEMORY_TEXT_MAX,
  type CardResponse,
  type CardsResponse,
  type ContextCard,
  type HandbookResponse,
  type MemoryItem,
  type MemoryKind,
  type MemoryListResponse,
} from '@headcount/protocol/ext/memory';
import { HttpError, json, readJson, type RouteHandler } from '../lib/http';
import { workspaceStub } from '../lib/stubs';
import { isScope } from './cards';
import { isSection } from './handbook';

const isMemoryId = (id: string | undefined): id is string => !!id && /^mem_[a-f0-9]{16}$/.test(id);
const isCardId = (id: string | undefined): id is string => !!id && /^card_[a-f0-9]{16}$/.test(id);

function scopeOf(v: string | null | undefined): string | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  if (!isScope(v)) throw new HttpError('bad_request', 'The scope is the workspace, a project (project:prj_…) or a coworker (coworker:…).');
  return v;
}

function kindOf(v: unknown): MemoryKind | undefined {
  if (v === undefined) return undefined;
  if (!MEMORY_KINDS.includes(v as MemoryKind) || v === 'excerpt') throw new HttpError('bad_request', 'Unknown kind of memory.');
  return v as MemoryKind;
}

/** GET /api/memory?q=&scope=&kind= → memories (searched when q is given). */
export const handleListMemory: RouteHandler = async (_req, { env, url }) => {
  const q = url.searchParams.get('q') ?? '';
  const scope = scopeOf(url.searchParams.get('scope'));
  const kind = kindOf(url.searchParams.get('kind') ?? undefined);
  const memories = (await workspaceStub(env).memoryList({ ...(q ? { q: q.slice(0, 500) } : {}), ...(scope ? { scope } : {}), ...(kind ? { kind } : {}) })) as unknown as MemoryItem[];
  return json<MemoryListResponse>({ memories });
};

export const handleAddMemory: RouteHandler = async (req, { env }) => {
  const b = await readJson<Record<string, unknown>>(req);
  if (!b || typeof b.text !== 'string' || b.text.trim().length < 4) throw new HttpError('bad_request', 'Say what to remember.');
  if (b.text.length > MEMORY_TEXT_MAX) throw new HttpError('bad_request', `Keep it under ${MEMORY_TEXT_MAX} characters.`);
  const item = (await workspaceStub(env).memoryAdd({ text: b.text, kind: kindOf(b.kind) ?? 'fact', scope: scopeOf(b.scope as string | undefined) ?? 'workspace' })) as unknown as MemoryItem;
  return json({ memory: item }, { status: 201 });
};

export const handlePatchMemory: RouteHandler = async (req, { env, params }) => {
  if (!isMemoryId(params.id)) throw new HttpError('not_found', 'No such memory.');
  const b = await readJson<Record<string, unknown>>(req);
  if (!b || typeof b !== 'object') throw new HttpError('bad_request', 'Send the change as JSON.');
  if (b.text !== undefined && (typeof b.text !== 'string' || !b.text.trim() || b.text.length > 1200)) throw new HttpError('bad_request', 'The memory needs text.');
  if (b.pinned !== undefined && typeof b.pinned !== 'boolean') throw new HttpError('bad_request', 'pinned is true or false.');
  const item = (await workspaceStub(env).memoryPatch(params.id, { ...(typeof b.text === 'string' ? { text: b.text } : {}), ...(b.kind !== undefined ? { kind: kindOf(b.kind)! } : {}), ...(typeof b.pinned === 'boolean' ? { pinned: b.pinned } : {}) })) as unknown as MemoryItem | null;
  if (!item) throw new HttpError('not_found', 'No such memory.');
  return json({ memory: item });
};

export const handleRemoveMemory: RouteHandler = async (_req, { env, params }) => {
  if (!isMemoryId(params.id) || !(await workspaceStub(env).memoryRemove(params.id))) throw new HttpError('not_found', 'No such memory.');
  return json({ removed: true });
};

export const handleGetHandbook: RouteHandler = async (_req, { env }) => json<HandbookResponse>((await workspaceStub(env).handbookView()) as unknown as HandbookResponse);

export const handlePutHandbook: RouteHandler = async (req, { env, params }) => {
  if (!isSection(params.section)) throw new HttpError('not_found', 'No such Handbook section.');
  const b = await readJson<Record<string, unknown>>(req);
  if (!b || typeof b.content !== 'string') throw new HttpError('bad_request', 'Send {content}.');
  if (b.content.length > HANDBOOK_SECTION_MAX) throw new HttpError('bad_request', `Keep a section under ${HANDBOOK_SECTION_MAX} characters.`);
  return json<HandbookResponse>((await workspaceStub(env).handbookPut(params.section, b.content)) as unknown as HandbookResponse);
};

export const handleStartInterview: RouteHandler = async (_req, { env }) => json<HandbookResponse>((await workspaceStub(env).handbookInterview(true)) as unknown as HandbookResponse, { status: 202 });
export const handleStopInterview: RouteHandler = async (_req, { env }) => json<HandbookResponse>((await workspaceStub(env).handbookInterview(false)) as unknown as HandbookResponse);

export const handleListCards: RouteHandler = async (_req, { env, url }) => {
  const scope = scopeOf(url.searchParams.get('scope'));
  return json<CardsResponse>({ cards: (await workspaceStub(env).cardsList(scope)) as unknown as ContextCard[] });
};

/** POST /api/cards?scope= (raw bytes; X-File-Name) → the file read, summarised and searchable. */
export const handleAddCard: RouteHandler = async (req, { env, url }) => {
  const scope = scopeOf(url.searchParams.get('scope')) ?? 'workspace';
  let name = req.headers.get('x-file-name') ?? '';
  try {
    name = decodeURIComponent(name);
  } catch {
    /* as sent */
  }
  if (!name.trim()) throw new HttpError('bad_request', 'Send the file name in X-File-Name.');
  const bytes = await req.arrayBuffer();
  if (!bytes.byteLength) throw new HttpError('bad_request', 'The file is empty.');
  if (bytes.byteLength > CARD_UPLOAD_MAX) throw new HttpError('payload_too_large', 'Files must be under 10 MB.');
  const r = (await workspaceStub(env).cardAdd({ name, mime: (req.headers.get('content-type') ?? '').split(';')[0]!.trim(), bytes, scope })) as unknown as { card: ContextCard } | { error: string; code: 'bad_request' | 'conflict' | 'not_found' };
  if ('error' in r) throw new HttpError(r.code, r.error);
  return json<CardResponse>({ card: r.card }, { status: 201 });
};

export const handleGetCard: RouteHandler = async (_req, { env, params }) => {
  if (!isCardId(params.id)) throw new HttpError('not_found', 'No such file.');
  const r = (await workspaceStub(env).cardGet(params.id)) as unknown as CardResponse | null;
  if (!r) throw new HttpError('not_found', 'No such file.');
  return json<CardResponse>(r);
};

export const handleRemoveCard: RouteHandler = async (_req, { env, params }) => {
  if (!isCardId(params.id) || !(await workspaceStub(env).cardRemove(params.id))) throw new HttpError('not_found', 'No such file.');
  return json({ removed: true });
};
