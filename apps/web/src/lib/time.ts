// A coarse ticking clock for elapsed times and the Activity sweep (15 s is plenty for "3 min").
import { signal } from '@preact/signals';

export const now = signal(Date.now());
let started = false;

export function startClock(): () => void {
  if (started) return () => undefined;
  started = true;
  const t = setInterval(() => (now.value = Date.now()), 15_000);
  return () => {
    clearInterval(t);
    started = false;
  };
}

/** "just now", "4 min", "2 h", "3 days". */
export function elapsed(fromIso: string, to: number = now.value): string {
  const ms = Math.max(0, to - Date.parse(fromIso));
  if (!Number.isFinite(ms) || ms < 45_000) return 'just now';
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  if (h < 36) return `${h} h`;
  return `${Math.round(h / 24)} days`;
}

export function clockTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** "just now", "4 min ago". */
export function ago(fromIso: string, to: number = now.value): string {
  const e = elapsed(fromIso, to);
  return e === 'just now' ? e : `${e} ago`;
}
