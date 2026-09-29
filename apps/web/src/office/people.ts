// Who is in the office (OFFICE-PHASE2 §4.5.3): the Chief of Staff and the 164 catalog coworkers from the slim catalog
// the app already has (no new fetch), and their personality for office life from GET /api/office/people.
import type { CatalogIndex, CatalogSlim, Lead } from '@headcount/catalog';
import type { ArchetypeName, OfficeGroup, OfficeLifePerson, OfficePerson } from '@headcount/office';
import { CHIEF_ID, coworkerAgentId } from '@headcount/protocol';
import type { OfficePersonDto } from '@headcount/protocol/ext/rooms';

export const CHIEF_TITLE = 'Chief of Staff';

export interface OfficeRoster {
  people: OfficePerson[];
  groups: OfficeGroup[];
  /** A key that changes when anyone's name, title or accent does (a new lead, a renamed Chief). */
  key: string;
}

/** The scene's people: the Chief first (their corner office), then every coworker by department. */
export function officeRoster(c: CatalogIndex<CatalogSlim>, lead: Lead | undefined, chiefName: string): OfficeRoster {
  const people: OfficePerson[] = [];
  if (lead) people.push({ id: CHIEF_ID, name: chiefName || lead.name, title: CHIEF_TITLE, groupId: 'chief', accent: lead.avatar.accent_color, seniority: 'principal' });
  for (const p of c.catalog.personas) people.push({ id: coworkerAgentId(p.id), name: p.name, title: p.title, groupId: p.department, accent: p.avatar.accent_color, seniority: p.seniority });
  const groups: OfficeGroup[] = c.catalog.departments.map((d) => ({ id: d.id, name: d.name, kind: 'department' as const }));
  return { people, groups, key: `${lead?.id ?? ''}|${chiefName}|${people.length}` };
}

/** Personality for office life from the roster DTOs; anyone missing gets neutral values (`{id}` only). */
export function lifePeopleOf(people: readonly OfficePerson[], dtos: readonly OfficePersonDto[] | null): OfficeLifePerson[] {
  const by = new Map<string, OfficePersonDto>((dtos ?? []).map((d) => [d.agentId, d]));
  return people.map((p) => {
    const d = by.get(p.id);
    if (!d) return { id: p.id };
    const out: OfficeLifePerson = {
      id: p.id,
      sliders: { ...d.profile.personality.sliders },
      traits: d.profile.personality.traits.slice(),
      pairsWellWith: d.pairsWellWith.slice(),
      tensionWith: d.tensionWith.slice(),
      teamRoles: d.teamRoles.slice(),
    };
    if (d.blend) out.blend = d.blend as Readonly<Partial<Record<ArchetypeName, number>>>;
    return out;
  });
}

/** The first word of a display name. */
export const firstOf = (name: string): string => name.trim().split(/\s+/)[0] ?? name;
