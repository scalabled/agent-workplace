// Inc 1 project pods: a team project under way seats its people together, first in the fill order (by the Chief's
// office); a proposed plan has not started and a finished project disbands.
import { slimIndex } from '@headcount/catalog/slim';
import { planOffice } from '@headcount/office';
import { CHIEF_ID } from '@headcount/protocol';
import type { TeamProjectSnapshot } from '@headcount/protocol/ext/projects';
import { describe, expect, it } from 'vitest';
import { officeRoster, podsOf } from './people';

const lead = slimIndex.catalog.leads[0]!;
const personas = slimIndex.catalog.personas;
const project = (over: Partial<TeamProjectSnapshot>): TeamProjectSnapshot => ({
  projectId: 'prj_abcdefgh',
  title: 'Spring menu launch',
  goal: 'g',
  recipeId: null,
  recipeName: null,
  staffingNote: '',
  team: [0, 5, 40].map((i) => ({ personaId: personas[i]!.id, name: personas[i]!.name, title: personas[i]!.title, role: 'specialist' as const, why: '' })),
  steps: [],
  status: 'running',
  decisionId: null,
  createdAt: '2026-09-29T10:00:00Z',
  updatedAt: '2026-09-29T10:00:00Z',
  ...over,
});

describe('office pods', () => {
  it('only running and paused projects make pods, oldest first', () => {
    const pods = podsOf([project({ projectId: 'prj_b', createdAt: '2026-09-29T11:00:00Z', status: 'paused' }), project({ projectId: 'prj_a' }), project({ projectId: 'prj_p', status: 'proposed' }), project({ projectId: 'prj_d', status: 'done' })]);
    expect(pods.map((p) => p.projectId)).toEqual(['prj_a', 'prj_b']);
  });

  it('seats a team together in a pod zone that fills first, and changes the roster key', () => {
    const plain = officeRoster(slimIndex, lead, 'Eddie');
    const pods = podsOf([project({})]);
    const withPod = officeRoster(slimIndex, lead, 'Eddie', pods);
    expect(withPod.key).not.toBe(plain.key);
    expect(withPod.groups[0]).toEqual({ id: 'pod:prj_abcdefgh', name: 'Spring menu launch', kind: 'project', district: 'lead' });
    const members = pods[0]!.memberIds.map((id) => `cw_${id}`);
    expect(withPod.people.filter((p) => p.groupId === 'pod:prj_abcdefgh').map((p) => p.id).sort()).toEqual([...members].sort());

    const plan = planOffice({ people: withPod.people, groups: withPod.groups, leadId: CHIEF_ID });
    const zone = plan.zones.find((z) => z.groupId === 'pod:prj_abcdefgh')!;
    expect(zone.name).toBe('Spring menu launch');
    expect(zone.order).toBe(Math.min(...plan.zones.map((z) => z.order)));
    const seatZone = new Map(plan.seats.map((s) => [s.id, s.zoneId]));
    for (const id of members) expect(seatZone.get(plan.seatOf[id]!)).toBe(zone.id);
    // Everyone is still seated.
    expect(Object.keys(plan.seatOf)).toHaveLength(withPod.people.length);
  });
});
