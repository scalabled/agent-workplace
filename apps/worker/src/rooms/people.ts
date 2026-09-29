// GET /api/office/people (docs/dev/OFFICE-PHASE2.md §4.2.8): the personality roster office life and the huddle engine
// cast from: every catalog persona and, once a lead is chosen, the Chief. Built once per isolate per version; the
// browser revalidates with the ETag (304 on a match).
import { catalogFull, fullIndex } from '@headcount/catalog/full';
import type { Persona } from '@headcount/catalog';
import { CHIEF_ID, coworkerAgentId, type AgentId, type WorkspaceSettings } from '@headcount/protocol';
import type { OfficePeopleResponse, OfficePersonDto } from '@headcount/protocol/ext/rooms';
import { EXPR_BUNDLE, EXPR_CATALOG_VERSION, chiefProfile, personaProfile, wireProfile } from '../expr/catalog';
import type { RouteHandler } from '../lib/http';
import { workspaceStub } from '../lib/stubs';

type Blend = Record<string, number>;

/** Signature-pack archetype blends by persona id (the bundle's `signatures`), built once per isolate. */
let signatureBlends: Map<string, Blend> | null = null;
function blendOfPersona(personaId: string): Blend | undefined {
  if (!signatureBlends) {
    signatureBlends = new Map();
    for (const file of EXPR_BUNDLE.input.signatures ?? []) {
      for (const pack of file.packs ?? []) if (pack?.persona_id && pack.archetypes) signatureBlends.set(pack.persona_id, { ...(pack.archetypes as Blend) });
    }
  }
  return signatureBlends.get(personaId);
}

function leadBlend(leadId: string): Blend | undefined {
  const b = EXPR_BUNDLE.input.archetypes?.lead_blends?.[leadId];
  return b ? { ...(b as Blend) } : undefined;
}

/** FNV-1a 32-bit in base 36. */
function shortHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** The roster version: catalog content, expressions catalog, the chosen lead and the Chief's name. */
export function officePeopleVersion(settings: Pick<WorkspaceSettings, 'leadId' | 'chiefName'>): string {
  return `op1_${shortHash(JSON.stringify([catalogFull.sourceHash, EXPR_CATALOG_VERSION, EXPR_BUNDLE.huddles?.version ?? null, settings.leadId ?? null, settings.chiefName ?? null]))}`;
}

const extra = (p: Persona, key: string): unknown => (p as unknown as Record<string, unknown>)[key];

function personaDto(p: Persona): OfficePersonDto | null {
  const profile = personaProfile(p.id);
  if (!profile) return null;
  const known = (id: unknown): id is string => typeof id === 'string' && !!fullIndex.persona(id);
  const pairs = Array.isArray(extra(p, 'pairs_well_with')) ? (extra(p, 'pairs_well_with') as unknown[]) : [];
  const tension = Array.isArray(extra(p, 'productive_tension_with')) ? (extra(p, 'productive_tension_with') as unknown[]) : [];
  const blend = blendOfPersona(p.id);
  return {
    agentId: coworkerAgentId(p.id),
    groupId: p.department,
    isChief: false,
    teamRoles: [...(p.team_roles ?? [])],
    pairsWellWith: pairs.filter(known).map((id) => coworkerAgentId(id)),
    tensionWith: tension
      .map((t) => (t && typeof t === 'object' ? (t as { persona_id?: unknown }).persona_id : t))
      .filter(known)
      .map((id) => coworkerAgentId(id)),
    ...(blend ? { blend } : {}),
    profile: wireProfile(profile),
  };
}

let cached: { version: string; body: string } | null = null;

/** The roster for these settings (cached per version: about 165 entries). */
export function officePeople(settings: Pick<WorkspaceSettings, 'leadId' | 'chiefName'>): { version: string; body: string } {
  const version = officePeopleVersion(settings);
  if (cached?.version === version) return cached;
  const people: OfficePersonDto[] = [];
  const chief = chiefProfile(settings);
  if (chief && settings.leadId) {
    const blend = leadBlend(settings.leadId);
    people.push({ agentId: CHIEF_ID as AgentId, groupId: 'chief', isChief: true, teamRoles: [], pairsWellWith: [], tensionWith: [], ...(blend ? { blend } : {}), profile: wireProfile(chief) });
  }
  for (const p of catalogFull.personas) {
    const dto = personaDto(p);
    if (dto) people.push(dto);
  }
  const body: OfficePeopleResponse = { version, people };
  cached = { version, body: JSON.stringify(body) };
  return cached;
}

export const handleOfficePeople: RouteHandler = async (req, rc) => {
  const settings = (await workspaceStub(rc.env).getSettings()) as WorkspaceSettings;
  const { version, body } = officePeople(settings);
  const etag = `"${version}"`;
  const headers = { etag, 'cache-control': 'private, no-cache' };
  const match = req.headers.get('if-none-match');
  if (match && match.split(',').some((t) => t.trim().replace(/^W\//, '') === etag)) return new Response(null, { status: 304, headers });
  return new Response(body, { headers: { ...headers, 'content-type': 'application/json; charset=utf-8' } });
};
