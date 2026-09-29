// The office's clock (OFFICE-PHASE2 §4.5.14): the owner's local time. In dev builds only, `?at=HH:MM` on /app/floor
// shifts it (scene and life), so e2e and demos can open on 10:35 at the water cooler or 23:10 at the north glass.
const AT_RE = /^(\d{1,2}):(\d{2})$/;

/** The shift (ms) `?at=HH:MM` asks for, relative to `now`; 0 when absent or invalid. */
export function clockShift(search: string, now: Date = new Date()): number {
  let at: string | null = null;
  try {
    at = new URLSearchParams(search).get('at');
  } catch {
    at = null;
  }
  const m = at ? AT_RE.exec(at) : null;
  if (!m) return 0;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return 0;
  const target = new Date(now);
  target.setHours(h, min, 0, 0);
  return target.getTime() - now.getTime();
}

/** A clock for one mounted office: real time, shifted by `?at=` in dev builds. */
export function officeClock(search: string = typeof location === 'undefined' ? '' : location.search, dev: boolean = import.meta.env.DEV): () => Date {
  const shift = dev ? clockShift(search) : 0;
  return shift ? () => new Date(Date.now() + shift) : () => new Date();
}
