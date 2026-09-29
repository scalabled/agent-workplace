// Pre-voice planning (docs/dev/INC05-PLAN.md §3.2 `exprPrevoice`, §4 A3): which lines to render once in each agent's
// own voice. Either the engine plans (agents + tiers) or the caller passes a plan as `items`, each re-validated and
// re-keyed here. The RunDO renders the result; this module never calls TTS.
import { clipKey, lineOf, planPrevoice, renderUtterance, toDelivery, type AgentIndex, type CommonFills, type IntentId, type TtsDelivery } from '@headcount/expressions';
import { chiefDisplayName } from '@headcount/catalog';
import { fullIndex } from '@headcount/catalog/full';
import type { Registry } from '@headcount/models';
import { CHIEF_ID, ownerFirstNameOf, type WorkspaceSettings } from '@headcount/protocol';
import type { ExprPrevoiceRequest, ExprPrevoiceTier, ExprSlotValues, ExprTtsProvider } from '@headcount/protocol/ext/expressions';
import { HttpError } from '../lib/http';
import { EXPR_CATALOG_VERSION, chiefRenamed, exprCatalog, exprProviderFor, exprVoiceKey, indexFor, profileFor } from './catalog';
import type { ClipScope } from './clips';

/** Slots whose values are workspace data (H8): their clips live under `ws/<ws>/expr/`. */
const WORKSPACE_SLOTS = new Set(['owner_name', 'chief_name', 'coworker', 'project', 'client', 'step_label', 'artifact', 'other_thread', 'blocker', 'gist']);

/** Storage scope of a clip from its fills; a renamed Chief's `self_name` is workspace data too. */
export function scopeOf(fills: ExprSlotValues, opts: { chiefRenamed: boolean; agentId: string }): ClipScope {
  const keys = Object.keys(fills ?? {});
  if (keys.some((k) => WORKSPACE_SLOTS.has(k))) return 'workspace';
  if (opts.agentId === CHIEF_ID && opts.chiefRenamed && keys.includes('self_name')) return 'workspace';
  return 'shared';
}

/** One line to render and record in an agent's manifest. */
export interface PrevoicePlanItem {
  agentId: string;
  lineId: string;
  fillKey: string;
  /** `${lineId}|${fillKey}` */
  lineKey: string;
  clipKey: string;
  tier: ExprPrevoiceTier;
  scope: ClipScope;
  delivery: TtsDelivery;
  /** Readable caption (the text-timed mouth when a provider gives no alignment). */
  text: string;
  voiceKey: string;
  catalogVersion: string;
  estMs: number;
}

export interface PrevoicePlan {
  /** The provider of the first agent (all agents resolve through the same registry). */
  provider: ExprTtsProvider;
  items: PrevoicePlanItem[];
  voiceKeys: Record<string, string>;
  providers: Record<string, ExprTtsProvider>;
  /** Caller items that were unknown, invalid or unvoiceable (skipped and counted). */
  skipped: number;
}

export const DEFAULT_TIERS: readonly ExprPrevoiceTier[] = ['p0'];

interface Candidate {
  lineId: string;
  fills: ExprSlotValues;
  tier: ExprPrevoiceTier;
}

/** The intent of a line id for an agent (tiers caller items), or null for a line the agent cannot say. */
function lineIntent(index: AgentIndex, lineId: string): IntentId | null {
  return lineOf(index, lineId)?.intent ?? null;
}

/**
 * Plan a pre-voice run: per agent, the engine's plan (or the caller's items, re-validated), re-keyed with the
 * agent's current provider and voice, deduplicated by clip key and capped at `maxClips` unique clips.
 * Throws 404 for an unknown agent (or `cw_chief` before a lead is chosen).
 */
export async function planPrevoiceRun(registry: Registry, mockMedia: boolean, settings: WorkspaceSettings, req: ExprPrevoiceRequest, maxClips: number): Promise<PrevoicePlan> {
  const catalog = exprCatalog();
  const tiers = req.tiers?.length ? req.tiers : DEFAULT_TIERS;
  const renamed = chiefRenamed(settings);
  const lead = settings.leadId ? fullIndex.lead(settings.leadId) : undefined;
  const chiefName = lead ? chiefDisplayName(lead, settings.chiefName) : undefined;
  // The owner's name (Office Phase 2): `{owner_name}` lines become eligible; their clips are workspace-scoped.
  const ownerName = ownerFirstNameOf(settings);
  const items: PrevoicePlanItem[] = [];
  const voiceKeys: Record<string, string> = {};
  const providers: Record<string, ExprTtsProvider> = {};
  const lineKeys = new Set<string>();
  const clipKeys = new Set<string>();
  let skipped = 0;
  let first: ExprTtsProvider | null = null;

  for (const agentId of req.agentIds) {
    const profile = profileFor(agentId, settings);
    if (!profile) throw new HttpError('not_found', agentId === CHIEF_ID ? 'Choose a Chief of Staff first: there is no voice to pre-voice yet.' : `There is no coworker called ${agentId}.`);
    const index = indexFor(profile);
    const provider = exprProviderFor(registry, profile.voice, mockMedia);
    first ??= provider;
    providers[agentId] = provider;
    const voiceKey = exprVoiceKey(profile.voice, provider);
    voiceKeys[agentId] = voiceKey;
    if (provider === 'browser') continue; // speechSynthesis: nothing to pre-voice

    const candidates: Candidate[] = [];
    if (req.items?.length) {
      for (const it of req.items) {
        if (it.agentId !== agentId) continue;
        const intent = lineIntent(index, it.lineId);
        const def = intent ? catalog.intents.get(intent) : undefined;
        if (!def) {
          skipped++;
          continue;
        }
        candidates.push({ lineId: it.lineId, fills: it.fills ?? {}, tier: def.prevoice === 'runtime' ? 'p1' : def.prevoice });
      }
    } else {
      const fills: CommonFills = { self_name: profile.firstName, ...(chiefName ? { chief_name: chiefName } : {}), ...(ownerName ? { owner_name: ownerName } : {}) };
      const planned = await planPrevoice(index, catalog, provider, fills, {
        tiers,
        maxClips,
        ...(req.perIntent ? { perIntent: req.perIntent } : {}),
        ...(req.allLinesFor?.length ? { allLinesFor: req.allLinesFor as IntentId[] } : {}),
      });
      for (const it of planned) candidates.push({ lineId: it.lineId, fills: it.fills, tier: it.tier });
    }

    for (const c of candidates) {
      const r = renderUtterance(index, c.lineId, c.fills);
      const delivery = r.ok ? toDelivery(r.utterance, index.voice, provider) : null;
      if (!r.ok || !delivery) {
        if (req.items?.length) skipped++;
        continue;
      }
      const u = r.utterance;
      const lineKey = `${u.lineId}|${u.fillKey}`;
      if (lineKeys.has(`${agentId}|${lineKey}`)) continue;
      const key = await clipKey(delivery);
      if (!clipKeys.has(key) && clipKeys.size >= maxClips) break;
      clipKeys.add(key);
      lineKeys.add(`${agentId}|${lineKey}`);
      items.push({
        agentId,
        lineId: u.lineId,
        fillKey: u.fillKey,
        lineKey,
        clipKey: key,
        tier: c.tier,
        scope: scopeOf(u.fills, { chiefRenamed: renamed, agentId }),
        delivery,
        text: u.caption,
        voiceKey,
        catalogVersion: EXPR_CATALOG_VERSION,
        estMs: u.estMs,
      });
    }
  }
  return { provider: first ?? 'browser', items, voiceKeys, providers, skipped };
}

/** A stable fingerprint of what a run renders: agents, tiers, sizes, providers, voices, catalog version, items. */
export async function prevoiceFingerprint(req: ExprPrevoiceRequest, plan: Pick<PrevoicePlan, 'providers' | 'voiceKeys' | 'items'>, maxClips: number, ownerName: string | null = null): Promise<string> {
  const agents = [...req.agentIds].sort();
  const byKey = ([a]: [string, unknown], [b]: [string, unknown]) => (a < b ? -1 : a > b ? 1 : 0);
  // The planned clips themselves: a renamed Chief's `self_name` lines (or any other fill) are new clips, a new run.
  const clipKeys = [...new Set(plan.items.map((i) => i.clipKey))].sort();
  const payload = JSON.stringify([
    2,
    clipKeys,
    agents,
    [...(req.tiers?.length ? req.tiers : DEFAULT_TIERS)].sort(),
    req.perIntent ?? null,
    [...(req.allLinesFor ?? [])].sort(),
    agents.map((a) => [plan.providers[a] ?? null, plan.voiceKeys[a] ?? null]),
    EXPR_CATALOG_VERSION,
    maxClips,
    (req.items ?? []).map((i) => [i.agentId, i.lineId, Object.entries(i.fills ?? {}).sort(byKey)]),
    // A rename of the owner re-plans (only when set, so runs planned before names existed keep their fingerprint).
    ...(ownerName ? [ownerName] : []),
  ]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 40);
}
