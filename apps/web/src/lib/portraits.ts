// Portrait lookup per persona/lead id: GET /api/portraits/:id once per session (cached, 4 in flight),
// plus stored landmarks. No portrait → null, and the face stays procedural (never shown broken).
import { signal } from '@preact/signals';
import type { FaceLandmarks } from '@headcount/protocol';
import { api } from '../api/client';

export interface PortraitInfo {
  url: string;
  landmarks: FaceLandmarks | null;
  /** X-Portrait-Version of the image, sent with detected landmarks. */
  version: string | null;
}

const cache = new Map<string, Promise<PortraitInfo | null>>();
/** Ids with a stored portrait (GET /api/portraits), fetched once; null when the list is unavailable (probe instead). */
let listed: Promise<Set<string> | null> | null = null;

function portraitIds(): Promise<Set<string> | null> {
  listed ??= api
    .listPortraits()
    .then((r) => new Set(r.portraits.map((p) => p.personaId)))
    .catch(() => {
      listed = null; // the worker may still be starting: ask again next time
      return null;
    });
  return listed;
}
/** Bumped when a portrait appears (generated), so mounted faces probe again. */
export const portraitEpoch = signal(0);

const MAX_IN_FLIGHT = 4;
let inFlight = 0;
const waiting: (() => void)[] = [];

async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (inFlight >= MAX_IN_FLIGHT) await new Promise<void>((r) => waiting.push(r));
  inFlight++;
  try {
    return await fn();
  } finally {
    inFlight--;
    waiting.shift()?.();
  }
}

async function probe(id: string): Promise<PortraitInfo | null> {
  if (typeof fetch !== 'function' || typeof URL.createObjectURL !== 'function') return null;
  try {
    const known = await portraitIds();
    if (known && !known.has(id)) return null; // no portrait: skip the request (no 404 per face)
    const image = await slot(() => api.portraitImage(id));
    if (!image) return null;
    // Landmarks are geometry of one image version: if the portrait was replaced between the two requests, the
    // stored ones belong to another image, so the face detects its own instead (null).
    const landmarks = await api
      .landmarksFor(id)
      .then((r) => (r.version && image.version && r.version !== image.version ? null : r.landmarks))
      .catch(() => null);
    return { url: URL.createObjectURL(image.blob), landmarks, version: image.version };
  } catch {
    return null;
  }
}

export function portraitFor(id: string): Promise<PortraitInfo | null> {
  let p = cache.get(id);
  if (!p) {
    p = probe(id);
    cache.set(id, p);
  }
  return p;
}

/** Forget a cached answer (a portrait was just generated) and let mounted faces look again. */
export function refreshPortrait(id: string): void {
  const prev = cache.get(id);
  cache.delete(id);
  listed = null;
  void prev?.then((info) => info && URL.revokeObjectURL(info.url));
  portraitEpoch.value++;
}

/** Store landmarks the face detected for a portrait that had none. First valid write wins (409 is fine). */
export function saveLandmarks(id: string, landmarks: FaceLandmarks): void {
  const p = cache.get(id);
  void (p ?? Promise.resolve(null)).then((info) => api.putLandmarks(id, landmarks, info?.version).catch(() => undefined));
  if (p) cache.set(id, p.then((info) => (info ? { ...info, landmarks } : info)));
}
