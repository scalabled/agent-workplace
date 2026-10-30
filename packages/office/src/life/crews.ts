// Crews: stable groups of 2–4 people who are often seen together. Formed once per people set,
// seeded by the sorted ids, greedy by descending sociability within a district. Pure.
import { rngFor } from '../rng';
import type { LifeKnobs } from './knobs';
import type { PlannerPerson } from './types';

export interface CrewInput {
  person: PlannerPerson;
  knobs: LifeKnobs;
  district: string;
  signature: string | null;
}

export interface Crew {
  id: string;
  members: string[];
}

/** Affinity between two people (also used for huddle partners and casting). */
export function affinity(a: CrewInput, b: CrewInput): number {
  const pa = a.person;
  const pb = b.person;
  let v = 0;
  if (pa.pairsWellWith?.includes(pb.id) || pb.pairsWellWith?.includes(pa.id)) v += 1.0;
  if (pa.groupId === pb.groupId) v += 0.6;
  if (pa.tensionWith?.includes(pb.id) || pb.tensionWith?.includes(pa.id)) v += 0.4;
  if (a.district === b.district) v += 0.3;
  if (a.signature && a.signature === b.signature) v += 0.2;
  const senior = (p: PlannerPerson) => p.seniority === 'principal' || p.seniority === 'lead';
  if ((senior(pa) && pb.seniority === 'specialist') || (senior(pb) && pa.seniority === 'specialist')) v += 0.1;
  return v;
}

export function formCrews(inputs: readonly CrewInput[], leadId: string, share = 0.5): Crew[] {
  const pool = inputs.filter((i) => i.person.id !== leadId).slice().sort((a, b) => (a.person.id < b.person.id ? -1 : 1));
  const rand = rngFor(`crews|${pool.map((p) => p.person.id).join(',')}`);
  const target = Math.floor(pool.length * share);
  const order = pool.slice().sort((a, b) => b.knobs.s - a.knobs.s || (a.person.id < b.person.id ? -1 : 1));
  const taken = new Set<string>();
  const crews: Crew[] = [];
  let inCrews = 0;
  for (const lead of order) {
    if (inCrews >= target) break;
    if (taken.has(lead.person.id)) continue;
    const r = rand();
    const size = r < 0.5 ? 2 : r < 0.85 ? 3 : 4;
    const cands = pool
      .filter((c) => c !== lead && !taken.has(c.person.id) && c.district === lead.district)
      .map((c) => ({ c, a: affinity(lead, c) }))
      .filter((x) => x.a >= 0.6)
      .sort((x, y) => y.a - x.a || (x.c.person.id < y.c.person.id ? -1 : 1));
    if (!cands.length) continue;
    const members = [lead.person.id, ...cands.slice(0, size - 1).map((x) => x.c.person.id)];
    for (const m of members) taken.add(m);
    inCrews += members.length;
    crews.push({ id: `crew:${members.slice().sort().join('+')}`.slice(0, 120), members });
  }
  return crews;
}
