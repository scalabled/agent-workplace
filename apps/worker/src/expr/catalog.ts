// The expression catalog inside the worker (docs/dev/INC05-PLAN.md §4 A1): the imported bundle, a lazily compiled
// catalog (once per isolate, ~300 ms, never on a 202 path), agent profiles built from the full persona catalog,
// an AgentIndex cache and the TTS provider each agent's reflexes use.
import bundle from '@headcount/expressions/bundle';
import {
  buildAgentIndex,
  compileCatalog,
  voiceKeyOf,
  type AffectLexicon,
  type AgentExpressionProfile,
  type AgentIndex,
  type CompiledCatalog,
  type TeamRole,
} from '@headcount/expressions';
import { chiefDisplayName, firstName, leadVoiceRef, personaVoiceRef, type Lead, type Persona } from '@headcount/catalog';
import { fullIndex } from '@headcount/catalog/full';
import type { Registry } from '@headcount/models';
import { CHIEF_ID, coworkerAgentId, personaIdFromAgentId, type ProviderId, type VoiceRef, type WorkspaceSettings } from '@headcount/protocol';
import type { ExprAgentProfile, ExprTtsProvider } from '@headcount/protocol/ext/expressions';

export const EXPR_BUNDLE = bundle;
/** The content hash of the bundle (`e1_…`): ETag of /api/expr/catalog and the manifests' catalog version. */
export const EXPR_CATALOG_VERSION: string = bundle.version;

let compiled: CompiledCatalog | null = null;
let serialized: string | null = null;

/** The compiled catalog, compiled on first use in this isolate. */
export function exprCatalog(): CompiledCatalog {
  compiled ??= compileCatalog(bundle.input);
  return compiled;
}

/** True once this isolate compiled the catalog (a pick is then well under a millisecond). */
export function exprCatalogReady(): boolean {
  return compiled !== null;
}

/** The bundle as JSON text, serialised once per isolate (GET /api/expr/catalog). */
export function exprBundleJson(): string {
  serialized ??= JSON.stringify(bundle);
  return serialized;
}

/** The owner-affect lexicon straight from the bundle: the phatic sniff on the 202 path never compiles. */
export function exprLexicon(): AffectLexicon {
  return bundle.input.intents.affect_lexicon;
}

// ── profiles ────────────────────────────────────────────────────────────────────
const TEAM_ROLES = new Set<TeamRole>(['lead', 'co_owner', 'reviewer', 'sceptic', 'facilitator', 'specialist']);

/** The Chief of Staff's expression profile: the chosen lead, in the owner's name for it. Null before a lead is chosen. */
export function chiefProfile(settings: Pick<WorkspaceSettings, 'leadId' | 'chiefName'>): AgentExpressionProfile | null {
  const lead: Lead | undefined = settings.leadId ? fullIndex.lead(settings.leadId) : undefined;
  if (!lead) return null;
  return {
    agentId: CHIEF_ID,
    personaId: lead.id,
    firstName: chiefDisplayName(lead, settings.chiefName),
    personality: { sliders: { ...lead.personality.sliders }, traits: [...lead.personality.traits], leadId: lead.id },
    voice: leadVoiceRef(lead),
    teamRole: 'chief',
  };
}

/** A catalog coworker's expression profile (no team in Inc 0.5, so no `teamRole`). */
export function personaProfile(personaId: string): AgentExpressionProfile | null {
  const p: Persona | undefined = fullIndex.persona(personaId);
  if (!p) return null;
  const roles = (p.team_roles ?? []).filter((r): r is TeamRole => TEAM_ROLES.has(r as TeamRole));
  return {
    agentId: coworkerAgentId(p.id),
    personaId: p.id,
    firstName: firstName(p.name),
    personality: { sliders: { ...p.personality.sliders }, traits: [...p.personality.traits], ...(roles.length ? { roles } : {}), seniority: p.seniority },
    voice: personaVoiceRef(p),
  };
}

/**
 * A lead the owner has not chosen, as their Chief of Staff would be under the lead's own name: `cw_<leadId>`
 * (lead ids start with `lead-`, persona ids never do). Used for speculative pre-voicing (LIVING-WORKFORCE §7.1):
 * its clips are keyed exactly like `cw_chief`'s for that lead, so choosing the lead later finds them in R2.
 */
export function leadPreviewProfile(leadId: string): AgentExpressionProfile | null {
  const lead: Lead | undefined = fullIndex.lead(leadId);
  if (!lead) return null;
  const chief = chiefProfile({ leadId: lead.id, chiefName: null });
  return chief ? { ...chief, agentId: coworkerAgentId(lead.id) } : null;
}

/** `cw_chief` (needs a chosen lead), `cw_<personaId>` or a lead preview `cw_<leadId>` → its profile, else null. */
export function profileFor(agentId: string, settings: Pick<WorkspaceSettings, 'leadId' | 'chiefName'>): AgentExpressionProfile | null {
  if (agentId === CHIEF_ID) return chiefProfile(settings);
  const personaId = personaIdFromAgentId(agentId);
  if (!personaId) return null;
  return personaProfile(personaId) ?? (personaId.startsWith('lead-') ? leadPreviewProfile(personaId) : null);
}

/** The wire form of a profile (ExprAgentProfile mirrors AgentExpressionProfile). */
export function wireProfile(p: AgentExpressionProfile): ExprAgentProfile {
  return {
    agentId: p.agentId,
    personaId: p.personaId,
    firstName: p.firstName,
    personality: { ...p.personality, sliders: { ...p.personality.sliders }, traits: [...p.personality.traits] },
    voice: { ...p.voice },
    ...(p.teamRole ? { teamRole: p.teamRole } : {}),
  };
}

// ── agent indexes (LRU 64, keyed by agent + profile) ────────────────────────────
const INDEX_CACHE_MAX = 64;
const indexes = new Map<string, AgentIndex>();

/** The AgentIndex for a profile. A renamed Chief or a new lead is a new key, so the index is rebuilt. */
export function indexFor(profile: AgentExpressionProfile): AgentIndex {
  const catalog = exprCatalog();
  const key = `${catalog.version}|${JSON.stringify(profile)}`;
  const hit = indexes.get(key);
  if (hit) {
    indexes.delete(key);
    indexes.set(key, hit);
    return hit;
  }
  const index = buildAgentIndex(catalog, profile);
  indexes.set(key, index);
  while (indexes.size > INDEX_CACHE_MAX) indexes.delete(indexes.keys().next().value!);
  return index;
}

// ── provider per agent (§3.5) ───────────────────────────────────────────────────
/**
 * The renderer an agent's reflexes use right now. The registry decides as for speech (`xai` when the voice has an
 * xAI id, then `openai`; Mock only with MOCK_MEDIA): a resolved real provider with a voice id for it → that
 * provider; Mock → `mock`; nothing → `browser` (speechSynthesis on the client, no pre-voicing).
 */
export function exprProviderFor(registry: Registry, voice: VoiceRef, mockMedia: boolean): ExprTtsProvider {
  const prefer: ProviderId[] = [];
  if (voice.xai) prefer.push('xai');
  if (voice.openai) prefer.push('openai');
  const r = registry.tryResolve('tts', { prefer, allowMock: mockMedia });
  if (!r) return 'browser';
  if (r.providerId === 'mock') return 'mock';
  if (r.providerId === 'xai' && voice.xai) return 'xai';
  if (r.providerId === 'openai' && voice.openai) return 'openai';
  return 'browser';
}

/** The manifest identity of a voice under a provider (`ClipManifest.voiceKey`). */
export function exprVoiceKey(voice: VoiceRef, provider: ExprTtsProvider): string {
  return voiceKeyOf(voice, provider);
}

/** True when the owner renamed their Chief of Staff: lines with `self_name` then hold workspace data (H8). */
export function chiefRenamed(settings: Pick<WorkspaceSettings, 'leadId' | 'chiefName'>): boolean {
  const lead = settings.leadId ? fullIndex.lead(settings.leadId) : undefined;
  const chosen = settings.chiefName?.trim();
  return !!lead && !!chosen && chosen !== firstName(lead.name);
}
