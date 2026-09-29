// Portraits for the landing page's faces: one GET /api/portraits for the whole page, then each image by its
// versioned URL (/api/portraits/:id?v=<version>, cached immutably by the worker) and its stored landmarks.
// No worker, no portrait or an error → null, and the face stays illustrated (never shown broken).
import { routePath, type FaceLandmarks, type PortraitListResponse } from '@headcount/protocol';
import { PORTRAIT_HEADERS } from '@headcount/protocol/ext/media';

export interface LandingPortrait {
  url: string;
  landmarks: FaceLandmarks | null;
}

type Listed = PortraitListResponse['portraits'][number];

let list: Promise<Map<string, Listed>> | null = null;

export function portraitList(): Promise<Map<string, Listed>> {
  list ??= fetch(routePath('listPortraits'))
    .then((r) => (r.ok ? (r.json() as Promise<PortraitListResponse>) : { portraits: [] }))
    .then((body) => new Map(body.portraits.map((p) => [p.personaId, p])))
    .catch(() => new Map());
  return list;
}

/** Ids that have a portrait (the wall prefers them). */
export async function portraitIds(): Promise<Set<string>> {
  return new Set((await portraitList()).keys());
}

const cache = new Map<string, Promise<LandingPortrait | null>>();

export function landingPortrait(id: string): Promise<LandingPortrait | null> {
  let p = cache.get(id);
  if (!p) {
    p = portraitList().then(async (all) => {
      const entry = all.get(id);
      if (!entry) return null;
      const url = `${routePath('getPortrait', { personaId: id })}?v=${encodeURIComponent(entry.version)}`;
      if (!entry.hasLandmarks) return { url, landmarks: null };
      try {
        const res = await fetch(routePath('getLandmarks', { personaId: id }));
        if (!res.ok) return { url, landmarks: null };
        const version = res.headers.get(PORTRAIT_HEADERS.version);
        const body = (await res.json()) as { landmarks: FaceLandmarks | null };
        // Landmarks are geometry of one image version: a mismatch shows the portrait still, never misaligned.
        return { url, landmarks: version && version !== entry.version ? null : (body.landmarks ?? null) };
      } catch {
        return { url, landmarks: null };
      }
    });
    cache.set(id, p);
  }
  return p;
}
