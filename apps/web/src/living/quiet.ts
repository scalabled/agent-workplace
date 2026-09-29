// Quiet hours (INC05-PLAN §9, LIVING-WORKFORCE §9.2): owner-local 22:00–07:00, when ambient chatter keeps to faces and
// bubbles. The owner's own exchanges (a reply, a hover) keep their reflexes. The Ambience control says so and offers
// "Lively anyway" for the rest of the night. Light on purpose (signals and storage only): the Floor header reads it
// without loading the runtime.
import { signal } from '@preact/signals';

export const QUIET_FROM_HOUR = 22;
export const QUIET_UNTIL_HOUR = 7;
const LIVELY_KEY = 'hc-lively-anyway';

export function isQuietHours(at: Date): boolean {
  const h = at.getHours();
  return h >= QUIET_FROM_HOUR || h < QUIET_UNTIL_HOUR;
}

/** When the quiet hours that contain `at` end (the next 07:00, owner-local). */
export function quietHoursEnd(at: Date): Date {
  const end = new Date(at);
  end.setHours(QUIET_UNTIL_HOUR, 0, 0, 0);
  if (at.getHours() >= QUIET_UNTIL_HOUR) end.setDate(end.getDate() + 1);
  return end;
}

function readLively(now: number): boolean {
  try {
    const until = Number(globalThis.localStorage?.getItem(LIVELY_KEY));
    return Number.isFinite(until) && until > now;
  } catch {
    return false;
  }
}

/** Inside quiet hours right now (the runtime refreshes it on the clock). */
export const quietHoursNow = signal(isQuietHours(new Date()));
/** The owner chose "Lively anyway" for tonight: quiet hours do not apply until they end. */
export const livelyAnyway = signal(readLively(Date.now()));

/** Quiet hours apply now: inside them, and the owner did not choose "Lively anyway". */
export function quietHoursApply(at: Date): boolean {
  if (!isQuietHours(at)) return false;
  if (livelyAnyway.peek() && !readLively(at.getTime())) livelyAnyway.value = false; // last night's choice ran out
  return !livelyAnyway.peek();
}

/** "Lively anyway" until the current quiet hours end (on), or back to quiet hours (off). */
export function setLivelyAnyway(on: boolean, now = new Date()): void {
  try {
    if (on) globalThis.localStorage?.setItem(LIVELY_KEY, String(quietHoursEnd(now).getTime()));
    else globalThis.localStorage?.removeItem(LIVELY_KEY);
  } catch {
    /* storage blocked: this tab only */
  }
  livelyAnyway.value = on;
}

/** "7:00" in the owner's locale (the chip and the menu say when quiet hours end). */
export function quietUntilLabel(now = new Date()): string {
  return quietHoursEnd(now).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
