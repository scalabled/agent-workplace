// The skyline art manifest. Only scripts/office-art.mjs writes it; the office only reads it.
// Paths are relative to `assetsBase` (default '/office/'). A missing manifest or image falls back to the vector city.
import type { TimeOfDay } from '../types';

export interface SkyLight {
  /** 0–1 of the image width / height. */
  x: number;
  y: number;
  /** Dot radius in CSS px. */
  r: number;
  warm: boolean;
}

export interface ArtEntry {
  key: string;
  kind?: string;
  timeOfDay?: string;
  alt?: string;
  file: string;
  fallback?: string;
  srcset?: { width: number; file: string }[];
  lqip?: string;
  width: number;
  height: number;
  horizon?: number;
  glow?: string;
  lights?: SkyLight[];
  beacons?: { x: number; y: number }[];
}

export interface OfficeManifest {
  version: number;
  variants: Partial<Record<TimeOfDay, ArtEntry>>;
  /** The Skyline room's stage backdrop by time of day, and the Garden room's living wall under `garden`. */
  conference?: Partial<Record<'night' | 'dusk' | 'day' | 'garden', ArtEntry>>;
  art?: ArtEntry[];
}

const cache = new Map<string, Promise<OfficeManifest | null>>();

export function normalizeBase(base: string): string {
  return base.endsWith('/') ? base : `${base}/`;
}

/** Fetch and cache the manifest for a base URL; null when it is missing or malformed (never throws). */
export function loadManifest(base: string): Promise<OfficeManifest | null> {
  const b = normalizeBase(base);
  let p = cache.get(b);
  if (!p) {
    p = (async () => {
      try {
        if (typeof fetch !== 'function') return null;
        const res = await fetch(`${b}manifest.json`, { credentials: 'same-origin' });
        if (!res.ok) return null;
        const m = (await res.json()) as OfficeManifest;
        return m && typeof m === 'object' && m.variants ? m : null;
      } catch {
        return null;
      }
    })();
    cache.set(b, p);
  }
  return p;
}

/** Forget cached manifests (tests). */
export function clearManifestCache(): void {
  cache.clear();
}

export function srcsetOf(entry: ArtEntry, base: string): string {
  const b = normalizeBase(base);
  return (entry.srcset ?? []).map((s) => `${b}${s.file} ${s.width}w`).join(', ');
}

/** The Garden room's stage backdrop (its living wall), if generated. */
export function gardenEntry(m: OfficeManifest | null): ArtEntry | null {
  return m?.conference?.garden ?? null;
}

/** The conference backdrop for a time of day: night, else dusk (also for day, which has no stage art). */
export function conferenceEntry(m: OfficeManifest | null, tod: TimeOfDay): ArtEntry | null {
  const c = m?.conference;
  if (!c) return null;
  return (tod === 'night' ? c.night : c.dusk) ?? c.night ?? c.dusk ?? null;
}
