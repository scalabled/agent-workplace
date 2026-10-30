// Who is in the office: the Chief of Staff, the coworkers the owner hired (their team), and
// anyone brought into a team project under way (who sit in its pod), from the slim catalog the app already has (no new
// fetch), and their personality for office life from GET /api/office/people. The rest of the directory is for hiring.
import type { CatalogIndex, CatalogSlim, Lead } from '@headcount/catalog';
import type { ArchetypeName, OfficeGroup, OfficeLifePerson, OfficePerson } from '@headcount/office';
import { CHIEF_ID, coworkerAgentId } from '@headcount/protocol';
import type { TeamProjectSnapshot } from '@headcount/protocol/ext/projects';
import type { OfficePersonDto } from '@headcount/protocol/ext/rooms';

export const CHIEF_TITLE = 'Chief of Staff';
/** Where the hired team sits together. */
export const TEAM_GROUP = 'team';

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
 * The scene's people: the Chief first (their corner office), then the team by department, except those on a team
 * project under way, who sit in its pod (first pod wins for anyone on two). `team`: the hired persona ids (null: the
 * whole directory, for callers without a team).
 */
export function officeRoster(c: CatalogIndex<CatalogSlim>, lead: Lead | undefined, chiefName: string, pods: readonly OfficePod[] = [], team: readonly string[] | null = null): OfficeRoster {
  const podOf = new Map<string, string>();
  for (const pod of pods) for (const id of pod.memberIds) if (!podOf.has(id)) podOf.set(id, `pod:${pod.projectId}`);
  const people: OfficePerson[] = [];
  if (lead) people.push({ id: CHIEF_ID, name: chiefName || lead.name, title: CHIEF_TITLE, groupId: 'chief', accent: lead.avatar.accent_color, seniority: 'principal' });
  // A hired team sits together, like a small office (the whole directory sits by department).
  const hired = team ? new Set(team) : null;
  for (const p of c.catalog.personas) {
    if (hired && !hired.has(p.id) && !podOf.has(p.id)) continue;
    const home = hired?.has(p.id) ? TEAM_GROUP : p.department;
    people.push({ id: coworkerAgentId(p.id), name: p.name, title: p.title, groupId: podOf.get(p.id) ?? home, accent: p.avatar.accent_color, seniority: p.seniority });
  }
  const used = new Set(people.map((p) => p.groupId));
  const groups: OfficeGroup[] = [
    ...pods.filter((pod) => [...podOf.values()].includes(`pod:${pod.projectId}`)).map((pod) => ({ id: `pod:${pod.projectId}`, name: pod.title, kind: 'project' as const, district: 'lead' as const })),
    ...(used.has(TEAM_GROUP) ? [{ id: TEAM_GROUP, name: 'Your team', kind: 'department' as const }] : []),
    ...c.catalog.departments.filter((d) => used.has(d.id)).map((d) => ({ id: d.id, name: d.name, kind: 'department' as const })),
  ];
  const podKey = pods.map((pod) => `${pod.projectId}:${pod.memberIds.join(',')}`).join(';');
  return { people, groups, key: `${lead?.id ?? ''}|${chiefName}|${people.length}|${podKey}|${team ? team.join(',') : '*'}` };
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
