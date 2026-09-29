import type { TimeOfDay } from './types';

/**
 * The skyline variant for a local time (OFFICE-PLAN §1.3): night 19:30–05:30, dusk 05:30–07:30 and 17:30–19:30
 * (also dawn), day 07:30–17:30. Boundaries belong to the variant that starts there.
 */
export function timeOfDayAt(date: Date): TimeOfDay {
  const m = date.getHours() * 60 + date.getMinutes();
  if (m >= 19 * 60 + 30 || m < 5 * 60 + 30) return 'night';
  if (m < 7 * 60 + 30) return 'dusk';
  if (m < 17 * 60 + 30) return 'day';
  return 'dusk';
}

/** Minutes until the variant changes (for preloading the next sky and re-checking). */
export function minutesUntilChange(date: Date): number {
  const m = date.getHours() * 60 + date.getMinutes();
  const bounds = [5 * 60 + 30, 7 * 60 + 30, 17 * 60 + 30, 19 * 60 + 30, 24 * 60 + 5 * 60 + 30];
  for (const b of bounds) if (b > m) return b - m;
  return 24 * 60 - m + 5 * 60 + 30;
}
