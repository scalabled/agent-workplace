// Department neighbourhoods and their districts (OFFICE-PLAN §3.2). Unknown groups are appended (district `run`).
import type { District } from '../types';

const DISTRICTS: readonly (readonly [District, readonly string[]])[] = [
  ['lead', ['strategy-leadership', 'core-crew']],
  ['build', ['product', 'design-creative', 'engineering', 'data-analytics', 'research-insights', 'it-security-automation']],
  ['grow', ['content-comms-pr', 'marketing-growth', 'sales-partnerships', 'customer-success-support', 'ecommerce-retail']],
  ['run', ['operations-supply-chain', 'finance-accounting', 'legal-compliance', 'people-culture', 'industry-specialists']],
];

/** Department ids in fill order: the serpentine that starts next to the Chief's office. */
export const DISTRICT_ORDER: readonly string[] = Object.freeze(DISTRICTS.flatMap(([, ids]) => ids));

const DISTRICT_OF = new Map<string, District>(DISTRICTS.flatMap(([d, ids]) => ids.map((id) => [id, d] as const)));

export function districtFor(groupId: string, explicit?: District): District {
  return explicit ?? DISTRICT_OF.get(groupId) ?? 'run';
}

export const DISTRICT_INDEX: Readonly<Record<District, number>> = { lead: 0, build: 1, grow: 2, run: 3 };
