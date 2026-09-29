// Who is in the office (OFFICE-PHASE2 §4.5.3): the Chief of Staff and the 164 catalog coworkers from the slim catalog
// the app already has (no new fetch), and their personality for office life from GET /api/office/people.
import type { CatalogIndex, CatalogSlim, Lead } from '@headcount/catalog';
import type { ArchetypeName, OfficeGroup, OfficeLifePerson, OfficePerson } from '@headcount/office';
import { CHIEF_ID, coworkerAgentId } from '@headcount/protocol';
import type { TeamProjectSnapshot } from '@headcount/protocol/ext/projects';
import type { OfficePersonDto } from '@headcount/protocol/ext/rooms';

export const CHIEF_TITLE = 'Chief of Staff';

export interface OfficeRoster {
  people: OfficePerson[];
  groups: OfficeGroup[];
  /** A key that changes when anyone's name, title or accent does (a new lead, a renamed Chief). */
  key: string;
}

/** A team project under way: its people sit together in a pod by the Chief's office (Inc 1). */
export interface OfficePod {
  projectId: string;
  title: string;
  /** Persona ids. */
  memberIds: readonly string[];
}

/** Pods for the office from team projects: running or paused ones (a proposed plan has not started; done ones disband). */
export function podsOf(projects: readonly TeamProjectSnapshot[]): OfficePod[] {
  return projects
    .filter((p) => p.status === 'running' || p.status === 'paused')
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
    .map((p) => ({ projectId: p.projectId, title: p.title, memberIds: p.team.map((m) => m.personaId) }));
}

/**
 * The scene's people: the Chief first (their corner office), then every coworker by department, except those on a
 * team project under way, who sit in its pod (first pod wins for anyone on two).
 */
export function officeRoster(c: CatalogIndex<CatalogSlim>, lead: Lead | undefined, chiefName: string, pods: readonly OfficePod[] = []): OfficeRoster {
  const podOf = new Map<string, string>();
  for (const pod of pods) for (const id of pod.memberIds) if (!podOf.has(id)) podOf.set(id, `pod:${pod.projectId}`);
  const people: OfficePerson[] = [];
  if (lead) people.push({ id: CHIEF_ID, name: chiefName || lead.name, title: CHIEF_TITLE, groupId: 'chief', accent: lead.avatar.accent_color, seniority: 'principal' });
  for (const p of c.catalog.personas) people.push({ id: coworkerAgentId(p.id), name: p.name, title: p.title, groupId: podOf.get(p.id) ?? p.department, accent: p.avatar.accent_color, seniority: p.seniority });
  const groups: OfficeGroup[] = [
    ...pods.filter((pod) => [...podOf.values()].includes(`pod:${pod.projectId}`)).map((pod) => ({ id: `pod:${pod.projectId}`, name: pod.title, kind: 'project' as const, district: 'lead' as const })),
    ...c.catalog.departments.map((d) => ({ id: d.id, name: d.name, kind: 'department' as const })),
  ];
  const podKey = pods.map((pod) => `${pod.projectId}:${pod.memberIds.join(',')}`).join(';');
  return { people, groups, key: `${lead?.id ?? ''}|${chiefName}|${people.length}|${podKey}` };
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
