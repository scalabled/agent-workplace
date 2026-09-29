// Living-workforce routes (docs/dev/INC05-PLAN.md §3.2): the catalog bundle, agent expression profiles, clips and their
// alignment, runtime renders and pre-voice runs. Keys stay server-side; errors are one sentence with their fix.
import { isIntentId, renderUtterance, toDelivery, clipKey as keyOf, clipAlignmentUrl, clipUrl } from '@headcount/expressions';
import { CHIEF_ID, ownerFirstNameOf, personaIdFromAgentId, type WorkspaceSettings } from '@headcount/protocol';
import type {
  ExprAgentResponse,
  ExprClipRef,
  ExprPrevoiceAccepted,
  ExprPrevoiceRequest,
  ExprPrevoiceStatus,
  ExprPrevoiceTier,
  ExprRenderRequest,
  ExprSlotValues,
  ExprTtsProvider,
} from '@headcount/protocol/ext/expressions';
import type { Env } from '../env';
import { HttpError, json, readJson, type RouteHandler } from '../lib/http';
import { workspaceStub } from '../lib/stubs';
import { mockMediaEnabled } from '../media/speech';
import { EXPR_BUNDLE, EXPR_CATALOG_VERSION, chiefRenamed, exprBundleJson, exprProviderFor, exprVoiceKey, indexFor, profileFor, wireProfile } from './catalog';
import { CLIP_KEY_RE, clipCacheControl, clipsRemainingToday, findClip, readAlignment, readClip, renderClip } from './clips';
import { exprLimit } from './config';
import type { ManifestRow } from './host';
import { planPrevoiceRun, prevoiceFingerprint, scopeOf, type PrevoicePlanItem } from './prevoice';

const TTS_PROVIDERS = new Set<ExprTtsProvider>(['xai', 'openai', 'browser', 'mock']);
const TIERS = new Set<ExprPrevoiceTier>(['p0', 'p1', 'p2']);
const LINE_ID = /^[A-Za-z0-9_.:~-]{1,160}$/;
const AGENT_ID = /^cw_[a-z0-9][a-z0-9_-]{0,80}$/;

/** The pre-voice runner of this workspace (one RunDO). */
export function prevoiceRunner(env: Env) {
  return env.RUN.get(env.RUN.idFromName(`run:expr-prevoice:${env.WORKSPACE_ID}`));
}

function missingProviderKeys(): string[] {
  return ['XAI_API_KEY', 'OPENAI_API_KEY'];
}

// ── GET /api/expr/catalog ───────────────────────────────────────────────────────
/** `"<catalog version>.<huddles version>"`: a small-talk content change is fetched while the manifests' version stays. */
export const EXPR_CATALOG_ETAG = `"${EXPR_CATALOG_VERSION}${EXPR_BUNDLE.huddles?.version ? `.${EXPR_BUNDLE.huddles.version}` : ''}"`;

export const handleExprCatalog: RouteHandler = async (req) => {
  const etag = EXPR_CATALOG_ETAG;
  const headers = { etag, 'cache-control': 'private, no-cache' };
  const match = req.headers.get('if-none-match');
  if (match && match.split(',').some((t) => t.trim().replace(/^W\//, '') === etag)) return new Response(null, { status: 304, headers });
  return new Response(exprBundleJson(), { headers: { ...headers, 'content-type': 'application/json; charset=utf-8' } });
};

// ── GET /api/expr/agents/:agentId ───────────────────────────────────────────────
export const handleExprAgent: RouteHandler = async (_req, rc) => {
  const agentId = rc.params.agentId ?? '';
  if (agentId !== CHIEF_ID && !personaIdFromAgentId(agentId)) throw new HttpError('not_found', `There is no agent called ${agentId}.`);
  const ws = workspaceStub(rc.env);
  const settings = (await ws.getSettings()) as WorkspaceSettings;
  const profile = profileFor(agentId, settings);
  if (!profile) throw new HttpError('not_found', agentId === CHIEF_ID ? 'Choose a Chief of Staff first.' : `There is no coworker called ${agentId}.`);
  const index = indexFor(profile);
  const provider = exprProviderFor(rc.registry(), profile.voice, mockMediaEnabled(rc.env));
  const voiceKey = exprVoiceKey(profile.voice, provider);
  const [state, prevoice] = await Promise.all([
    ws.exprAgentState(agentId, voiceKey, EXPR_CATALOG_VERSION, provider),
    prevoiceRunner(rc.env)
      .prevoiceLatestFor(agentId)
      .catch(() => null) as Promise<ExprPrevoiceStatus | null>,
  ]);
  const body: ExprAgentResponse = {
    agentId,
    personaId: profile.personaId,
    catalogVersion: EXPR_CATALOG_VERSION,
    profile: wireProfile(profile),
    staffed: agentId === CHIEF_ID,
    provider,
    voiceKey,
    manifest: { agentId, catalogVersion: EXPR_CATALOG_VERSION, provider, voiceKey, clips: state.clips },
    prevoice,
    baseline: { ...index.baseline },
    reactivity: index.reactivity,
    mood: state.mood,
    attention: state.attention,
  };
  return json(body);
};

// ── GET /api/expr/clips/:clipKey and /align ─────────────────────────────────────
function clipKeyParam(rc: { params: Record<string, string> }): string {
  const key = rc.params.clipKey ?? '';
  if (!CLIP_KEY_RE.test(key)) throw new HttpError('bad_request', 'That is not a clip key (c1_ and 32 base32 characters).');
  return key;
}

export const handleExprClip: RouteHandler = async (_req, rc) => {
  const key = clipKeyParam(rc);
  const found = await readClip(rc.env, key);
  if (!found) throw new HttpError('not_found', 'That clip has not been rendered. Render it with POST /api/expr/render.');
  return new Response(found.body as BodyInit, {
    headers: {
      'content-type': found.clip.mime,
      'content-length': String(found.size),
      'cache-control': clipCacheControl(found.clip.scope),
      'x-clip-duration-ms': String(found.clip.durationMs),
    },
  });
};

export const handleExprAlign: RouteHandler = async (_req, rc) => {
  const key = clipKeyParam(rc);
  const found = await readAlignment(rc.env, key);
  if (!found) throw new HttpError('not_found', 'That clip has not been rendered. Render it with POST /api/expr/render.');
  return new Response(JSON.stringify(found.value), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': clipCacheControl(found.scope) } });
};

// ── POST /api/expr/render ───────────────────────────────────────────────────────
function fillsOf(v: unknown): ExprSlotValues {
  if (v === undefined || v === null) return {};
  if (typeof v !== 'object' || Array.isArray(v)) throw new HttpError('bad_request', 'fills must be an object of slot → text.');
  return v as ExprSlotValues;
}

export const handleExprRender: RouteHandler = async (req, rc) => {
  const body = await readJson<Partial<ExprRenderRequest>>(req);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError('bad_request', 'Send {agentId, lineId, fills, provider} as JSON.');
  if (typeof body.agentId !== 'string' || !AGENT_ID.test(body.agentId)) throw new HttpError('bad_request', 'Include the agentId (cw_chief or cw_<personaId>).');
  if (typeof body.lineId !== 'string' || !LINE_ID.test(body.lineId)) throw new HttpError('bad_request', 'Include the lineId of a catalog line.');
  if (typeof body.provider !== 'string' || !TTS_PROVIDERS.has(body.provider as ExprTtsProvider)) throw new HttpError('bad_request', 'provider must be xai, openai, mock or browser.');
  const fills = fillsOf(body.fills);
  const ws = workspaceStub(rc.env);
  const settings = (await ws.getSettings()) as WorkspaceSettings;
  const profile = profileFor(body.agentId, settings);
  if (!profile) throw new HttpError('not_found', `There is no agent called ${body.agentId}.`);
  const provider = exprProviderFor(rc.registry(), profile.voice, mockMediaEnabled(rc.env));
  if (provider === 'browser') throw new HttpError('not_configured', 'No voice provider is configured: reflexes use the browser voice, so there is nothing to render.', { missingKeys: missingProviderKeys() });
  if (body.provider !== provider) throw new HttpError('conflict', `This agent's voice is now rendered by ${provider}. Render again with provider "${provider}".`);
  const index = indexFor(profile);
  const r = renderUtterance(index, body.lineId, fills);
  if (!r.ok) {
    const unknown = r.problems.some((p) => p.startsWith('unknown line') || / has no (prefix|tail)$/.test(p));
    if (unknown) throw new HttpError('not_found', `${profile.firstName} has no line ${body.lineId}.`);
    throw new HttpError('bad_request', `Those fills do not fit the line: ${r.problems.slice(0, 3).join('; ')}.`);
  }
  const u = r.utterance;
  const delivery = toDelivery(u, index.voice, provider);
  if (!delivery) throw new HttpError('bad_request', `That line has no ${provider} voice (a nonverbal line is shown on the face).`);
  const key = await keyOf(delivery);
  const voiceKey = exprVoiceKey(profile.voice, provider);
  const lineKey = `${u.lineId}|${u.fillKey}`;
  const record = (durationMs: number, scope: 'shared' | 'workspace') =>
    ws.exprRecordClips([{ agentId: profile.agentId, voiceKey, catalogVersion: EXPR_CATALOG_VERSION, lineKey, clipKey: key, durationMs, scope, tier: 'runtime' } satisfies ManifestRow]);

  const existing = await findClip(rc.env, key);
  if (existing) {
    await record(existing.durationMs, existing.scope);
    return json<ExprClipRef>({ clipKey: key, url: clipUrl(key), alignmentUrl: clipAlignmentUrl(key), durationMs: existing.durationMs, scope: existing.scope, cached: true });
  }
  const perMin = exprLimit(rc.env, 'renderPerMin');
  if (!(await ws.exprTakeRate('render', perMin))) {
    throw new HttpError('rate_limited', `Voice renders are paused for a minute: the limit of ${perMin} a minute is used up. Raise EXPR_RENDER_PER_MIN in apps/worker/.dev.vars to allow more.`);
  }
  const scope = scopeOf(u.fills, { chiefRenamed: chiefRenamed(settings), agentId: profile.agentId });
  const clip = await renderClip(rc.env, rc.registry(), { delivery, clipKey: key, scope, text: u.caption, lineId: u.lineId, fillKey: u.fillKey, voiceKey, catalogVersion: EXPR_CATALOG_VERSION });
  await record(clip.durationMs, clip.scope);
  return json<ExprClipRef>({ clipKey: key, url: clipUrl(key), alignmentUrl: clipAlignmentUrl(key), durationMs: clip.durationMs, scope: clip.scope, cached: clip.cached });
};

// ── POST /api/expr/prevoice ─────────────────────────────────────────────────────
function prevoiceRequest(body: unknown, ceiling: number): ExprPrevoiceRequest {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError('bad_request', 'Send {agentIds, tiers?} as JSON.');
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.agentIds) || b.agentIds.length < 1 || b.agentIds.length > 12 || !b.agentIds.every((a) => typeof a === 'string' && AGENT_ID.test(a))) {
    throw new HttpError('bad_request', 'agentIds must list 1 to 12 agents (cw_chief or cw_<personaId>).');
  }
  const out: ExprPrevoiceRequest = { agentIds: [...new Set(b.agentIds as string[])] };
  if (b.tiers !== undefined) {
    if (!Array.isArray(b.tiers) || !b.tiers.length || !b.tiers.every((t) => TIERS.has(t as ExprPrevoiceTier))) throw new HttpError('bad_request', 'tiers must list p0, p1 or p2.');
    out.tiers = [...new Set(b.tiers as ExprPrevoiceTier[])];
  }
  if (b.perIntent !== undefined) {
    if (!Number.isInteger(b.perIntent) || (b.perIntent as number) < 1 || (b.perIntent as number) > 24) throw new HttpError('bad_request', 'perIntent must be a whole number from 1 to 24.');
    out.perIntent = b.perIntent as number;
  }
  if (b.allLinesFor !== undefined) {
    if (!Array.isArray(b.allLinesFor) || !b.allLinesFor.every((i) => typeof i === 'string' && isIntentId(i))) throw new HttpError('bad_request', 'allLinesFor must list intent ids.');
    out.allLinesFor = [...new Set(b.allLinesFor)] as ExprPrevoiceRequest['allLinesFor'];
  }
  if (b.items !== undefined) {
    if (!Array.isArray(b.items) || b.items.length > 400) throw new HttpError('bad_request', 'items must be a list of at most 400 lines.');
    out.items = b.items.map((it) => {
      const i = it as Record<string, unknown>;
      if (!i || typeof i !== 'object' || typeof i.agentId !== 'string' || !out.agentIds.includes(i.agentId) || typeof i.lineId !== 'string' || !LINE_ID.test(i.lineId)) {
        throw new HttpError('bad_request', 'Each item needs an agentId from agentIds and a lineId.');
      }
      return { agentId: i.agentId, lineId: i.lineId, fills: fillsOf(i.fills) };
    });
  }
  if (b.maxClips !== undefined) {
    if (!Number.isInteger(b.maxClips) || (b.maxClips as number) < 1 || (b.maxClips as number) > ceiling) throw new HttpError('bad_request', `maxClips must be a whole number from 1 to ${ceiling}.`);
    out.maxClips = b.maxClips as number;
  }
  if (b.dryRun !== undefined) {
    if (typeof b.dryRun !== 'boolean') throw new HttpError('bad_request', 'dryRun must be true or false.');
    out.dryRun = b.dryRun;
  }
  return out;
}

/** Heads for many clip keys at once (16 in flight). */
async function existingClips(env: Env, keys: string[]): Promise<Map<string, { durationMs: number; scope: 'shared' | 'workspace' }>> {
  const out = new Map<string, { durationMs: number; scope: 'shared' | 'workspace' }>();
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(16, keys.length) }, async () => {
      while (next < keys.length) {
        const key = keys[next++]!;
        const found = await findClip(env, key);
        if (found) out.set(key, { durationMs: found.durationMs, scope: found.scope });
      }
    }),
  );
  return out;
}

export const handleExprPrevoice: RouteHandler = async (req, rc) => {
  const ceiling = exprLimit(rc.env, 'prevoiceMaxClips');
  const body = prevoiceRequest(await readJson<unknown>(req), Math.max(ceiling, 1));
  const maxClips = Math.min(body.maxClips ?? ceiling, Math.max(ceiling, 1));
  const ws = workspaceStub(rc.env);
  const settings = (await ws.getSettings()) as WorkspaceSettings;
  const plan = await planPrevoiceRun(rc.registry(), mockMediaEnabled(rc.env), settings, body, maxClips);
  const remainingToday = await clipsRemainingToday(rc.env, plan.provider);
  const base = { accepted: true as const, provider: plan.provider, remainingToday };

  if (plan.provider === 'browser') return json<ExprPrevoiceAccepted>({ ...base, runId: null, planned: 0, alreadyCached: 0, toRender: 0, estAudioMs: 0, ...(body.dryRun ? { dryRun: true } : {}) });

  const fingerprint = await prevoiceFingerprint(body, plan, maxClips, ownerFirstNameOf(settings));
  const runner = prevoiceRunner(rc.env);
  const prior = body.dryRun ? null : ((await runner.prevoiceFind(fingerprint)) as ExprPrevoiceStatus | null);
  if (prior?.state === 'done') {
    // Only a clean run is reused (RunDO.prevoiceFind): everything it planned is stored.
    return json<ExprPrevoiceAccepted>({ ...base, runId: prior.runId, planned: prior.planned, alreadyCached: prior.cached + prior.rendered, toRender: 0, estAudioMs: 0, reused: true });
  }
  if (prior) {
    const left = Math.max(0, prior.planned - prior.cached - prior.rendered - prior.failed);
    return json<ExprPrevoiceAccepted>({ ...base, runId: prior.runId, planned: prior.planned, alreadyCached: prior.cached, toRender: left, estAudioMs: 0 }, { status: 202 });
  }

  const unique = [...new Set(plan.items.map((i) => i.clipKey))];
  const stored = await existingClips(rc.env, unique);
  const cachedItems = plan.items.filter((i) => stored.has(i.clipKey));
  const toRender = plan.items.filter((i) => !stored.has(i.clipKey));
  const renderEst = new Map<string, number>();
  for (const i of toRender) if (!renderEst.has(i.clipKey)) renderEst.set(i.clipKey, i.estMs);
  const renderKeys = new Set(renderEst.keys());
  const estAudioMs = [...renderEst.values()].reduce((sum, ms) => sum + ms, 0);
  const counts = { planned: unique.length, alreadyCached: stored.size, toRender: renderKeys.size, estAudioMs };
  if (body.dryRun) return json<ExprPrevoiceAccepted>({ ...base, runId: null, ...counts, dryRun: true });
  if (renderKeys.size && plan.provider !== 'mock' && remainingToday <= 0) {
    throw new HttpError('rate_limited', `Nothing fits today's voice budget: the limit of ${exprLimit(rc.env, 'clipDaily')} clip renders is used up. Raise EXPR_CLIP_DAILY_LIMIT in apps/worker/.dev.vars to allow more.`);
  }
  if (cachedItems.length) {
    await ws.exprRecordClips(
      cachedItems.map((i: PrevoicePlanItem): ManifestRow => {
        const s = stored.get(i.clipKey)!;
        return { agentId: i.agentId, voiceKey: i.voiceKey, catalogVersion: i.catalogVersion, lineKey: i.lineKey, clipKey: i.clipKey, durationMs: s.durationMs, scope: s.scope, tier: i.tier };
      }),
    );
  }
  const run = (await runner.prevoiceEnqueue({
    fingerprint,
    request: JSON.stringify({ ...body, items: body.items?.length ?? 0 }),
    provider: plan.provider,
    tiers: body.tiers ?? ['p0'],
    agentIds: body.agentIds,
    planned: unique.length,
    cached: stored.size,
    items: toRender.map((i) => ({ clipKey: i.clipKey, agentId: i.agentId, lineKey: i.lineKey, lineId: i.lineId, fillKey: i.fillKey, tier: i.tier, scope: i.scope, delivery: i.delivery, text: i.text, voiceKey: i.voiceKey, catalogVersion: i.catalogVersion })),
  })) as ExprPrevoiceStatus;
  return json<ExprPrevoiceAccepted>({ ...base, runId: run.runId, ...counts }, { status: 202 });
};

// ── GET /api/expr/prevoice/:runId ───────────────────────────────────────────────
export const handleExprPrevoiceStatus: RouteHandler = async (_req, rc) => {
  const runId = rc.params.runId ?? '';
  if (!/^pv_[0-9a-z]{26}$/.test(runId)) throw new HttpError('not_found', 'There is no pre-voice run with that id.');
  const status = (await prevoiceRunner(rc.env).prevoiceStatus(runId)) as ExprPrevoiceStatus | null;
  if (!status) throw new HttpError('not_found', 'There is no pre-voice run with that id.');
  return json(status);
};
