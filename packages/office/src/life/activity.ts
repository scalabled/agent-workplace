// Real work maps to places: a conservative verb classifier for Inc 0 job labels, and where each
// activity is done. Anything unclear stays at the desk.
import type { SpotKind, WorkActivity } from './types';

/** Where an activity is done when it is not the desk. */
export const ACTIVITY_PLACES: Readonly<Partial<Record<WorkActivity, SpotKind>>> = Object.freeze({ research: 'library' });

const RESEARCH = /^(researching|reading|looking into|comparing)\b/;
const DOCUMENT = /^(drafting|writing|editing)\b/;

/** "Researching…", "Reading…", "Looking into…", "Comparing…" → research; "Drafting…", "Writing…", "Editing…" → document. */
export function activityOf(label: string | null | undefined): WorkActivity | null {
  const l = (label ?? '').trim().toLowerCase();
  if (!l) return null;
  if (RESEARCH.test(l)) return 'research';
  if (DOCUMENT.test(l)) return 'document';
  return null;
}
