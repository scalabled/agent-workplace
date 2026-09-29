// POST /api/expr/huddle/render (docs/dev/OFFICE-PHASE2.md §4.2.9): one small-talk turn of an office huddle, rendered in
// the speaker's own voice for listen-in. The turn is rebuilt server-side from the compiled huddle packs (the client
// sends only the exchange, the turn index and the fills), so the clip key matches the client's
// `clipKey(toDelivery(huddleUtterance(pick, i), voice, provider))` and the same clip serves every device. Same render,
// store and rate path as POST /api/expr/render; an R2 hit is free.
import { HUDDLE_GROUNDED_SLOTS, clipAlignmentUrl, clipKey as keyOf, clipUrl, renderHuddleUtterance, toDelivery } from '@headcount/expressions';
import { CHIEF_ID, type WorkspaceSettings } from '@headcount/protocol';
import type { ExprClipRef, ExprTtsProvider } from '@headcount/protocol/ext/expressions';
import type { ExprHuddleRenderRequest } from '@headcount/protocol/ext/rooms';
import { HttpError, json, readJson, type RouteHandler } from '../lib/http';
import { workspaceStub } from '../lib/stubs';
import { mockMediaEnabled } from '../media/speech';
import { EXPR_CATALOG_VERSION, chiefRenamed, exprHuddles, exprProviderFor, exprVoiceKey, indexFor, profileFor } from './catalog';
import { findClip, renderClip } from './clips';
import { exprLimit } from './config';

const TTS_PROVIDERS = new Set<ExprTtsProvider>(['xai', 'openai', 'browser', 'mock']);
const AGENT_ID = /^cw_[a-z0-9][a-z0-9_-]{0,80}$/;
const EXCHANGE_ID = /^[A-Za-z0-9_.:-]{1,120}$/;
const SLOT_KEY = /^[a-z_]{1,24}$/;
const MAX_FILLS = 12;
const FILL_MAX_CHARS = 200;

function fillsOf(v: unknown): Record<string, string> {
  if (v === undefined || v === null) return {};
  if (typeof v !== 'object' || Array.isArray(v)) throw new HttpError('bad_request', 'fills must be an object of slot → text.');
  const entries = Object.entries(v as Record<string, unknown>);
  if (entries.length > MAX_FILLS) throw new HttpError('bad_request', `Send at most ${MAX_FILLS} fills.`);
  const out: Record<string, string> = {};
  for (const [k, val] of entries) {
    if (!SLOT_KEY.test(k) || typeof val !== 'string' || val.length > FILL_MAX_CHARS) throw new HttpError('bad_request', 'Each fill is a slot name and a short text.');
    out[k] = val;
  }
  return out;
}

/** Clips with workspace data live under `ws/<ws>/expr/`: grounded slots, or a renamed Chief's name anywhere. */
export function huddleScopeOf(fills: Readonly<Record<string, string>>, settings: WorkspaceSettings, chiefName: string | null): 'shared' | 'workspace' {
  if (Object.keys(fills).some((k) => (HUDDLE_GROUNDED_SLOTS as readonly string[]).includes(k))) return 'workspace';
  if (chiefRenamed(settings) && chiefName && Object.values(fills).some((v) => v === chiefName)) return 'workspace';
  return 'shared';
}

export const handleExprHuddleRender: RouteHandler = async (req, rc) => {
  const body = await readJson<Partial<ExprHuddleRenderRequest>>(req);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError('bad_request', 'Send {exchangeId, index, agentId, fills, provider} as JSON.');
  if (typeof body.exchangeId !== 'string' || !EXCHANGE_ID.test(body.exchangeId)) throw new HttpError('bad_request', 'Include the exchangeId of a huddle exchange.');
  if (!Number.isInteger(body.index) || (body.index as number) < 0 || (body.index as number) > 40) throw new HttpError('bad_request', 'index must be the turn number within the exchange.');
  if (typeof body.agentId !== 'string' || !AGENT_ID.test(body.agentId)) throw new HttpError('bad_request', 'Include the agentId (cw_chief or cw_<personaId>).');
  if (typeof body.provider !== 'string' || !TTS_PROVIDERS.has(body.provider as ExprTtsProvider)) throw new HttpError('bad_request', 'provider must be xai, openai, mock or browser.');
  const fills = fillsOf(body.fills);

  const ws = workspaceStub(rc.env);
  const settings = (await ws.getSettings()) as WorkspaceSettings;
  const profile = profileFor(body.agentId, settings);
  if (!profile) throw new HttpError('not_found', body.agentId === CHIEF_ID ? 'Choose a Chief of Staff first.' : `There is no coworker called ${body.agentId}.`);
  const provider = exprProviderFor(rc.registry(), profile.voice, mockMediaEnabled(rc.env));
  if (provider === 'browser') throw new HttpError('not_configured', 'No voice provider is configured: small talk shows as bubbles only. Add a voice key to hear it.', { missingKeys: ['XAI_API_KEY', 'OPENAI_API_KEY'] });
  if (body.provider !== provider) throw new HttpError('conflict', `This agent's voice is now rendered by ${provider}. Render again with provider "${provider}".`);
  const huddles = exprHuddles();
  if (!huddles) throw new HttpError('not_found', 'There is no small-talk content in this build.');

  const index = indexFor(profile);
  const r = renderHuddleUtterance(huddles, { exchangeId: body.exchangeId, index: body.index as number, speaker: index, fills });
  if (!r.ok) throw new HttpError('bad_request', `That turn cannot be rendered: ${r.problems.slice(0, 3).join('; ')}.`);
  const u = r.utterance;
  const delivery = toDelivery(u, index.voice, provider);
  if (!delivery) throw new HttpError('bad_request', `That turn has no ${provider} voice (it is shown on the face).`);
  const key = await keyOf(delivery);

  const existing = await findClip(rc.env, key);
  if (existing) return json<ExprClipRef>({ clipKey: key, url: clipUrl(key), alignmentUrl: clipAlignmentUrl(key), durationMs: existing.durationMs, scope: existing.scope, cached: true });
  const perMin = exprLimit(rc.env, 'renderPerMin');
  if (!(await ws.exprTakeRate('render', perMin))) {
    throw new HttpError('rate_limited', `Voice renders are paused for a minute: the limit of ${perMin} a minute is used up. An owner can raise it in Admin → Settings (EXPR_RENDER_PER_MIN).`);
  }
  const scope = huddleScopeOf(u.fills as Record<string, string>, settings, profile.agentId === CHIEF_ID ? profile.firstName : (profileFor(CHIEF_ID, settings)?.firstName ?? null));
  const voiceKey = exprVoiceKey(profile.voice, provider);
  const clip = await renderClip(rc.env, rc.registry(), { delivery, clipKey: key, scope, text: u.caption, lineId: u.lineId, fillKey: u.fillKey, voiceKey, catalogVersion: EXPR_CATALOG_VERSION });
  return json<ExprClipRef>({ clipKey: key, url: clipUrl(key), alignmentUrl: clipAlignmentUrl(key), durationMs: clip.durationMs, scope: clip.scope, cached: clip.cached });
};
