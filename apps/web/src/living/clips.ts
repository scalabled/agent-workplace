// Pre-voiced clips on the client (LIVING-WORKFORCE §7.3): encoded bytes and their lip-sync alignment in Cache
// Storage `hc-expr-v1` (keyed by the clip URL, so a clip downloads once per browser), and a decoded LRU of
// PreparedAudio bounded by decoded bytes. `get` is synchronous (the reflex path never waits on the network, §2.6);
// `load` goes cache → network → decode. Storage that is unavailable (private windows, blocked site data) falls
// back to memory only. P0 clips (the reflexes) are evicted from memory last; Cache Storage keeps at most
// CACHE_MAX_ENTRIES responses, least recently used out first, and older `hc-expr-*` caches are deleted.
import type { PreparedAudio } from '@headcount/audio';
import { clipAlignmentUrl, clipUrl, type ClipManifest, type ClipStore, type PreparedClip, type PrevoiceTier } from '@headcount/expressions';
import type { Alignment } from '@headcount/protocol';
import type { ExprClipAlignment } from '@headcount/protocol/ext/expressions';

export const CLIP_CACHE = 'hc-expr-v1';
/** Decoded audio kept in memory (48 MB of PCM is a few hundred short clips). */
export const DECODED_BUDGET_BYTES = 48 * 1024 * 1024;
export const PREFETCH_PARALLEL = 4;
/** Responses kept in Cache Storage (a clip and its alignment are two): about a thousand clips. */
export const CACHE_MAX_ENTRIES = 2000;
/** URL → last use (epoch ms) of what Cache Storage holds, so it can be trimmed least recently used first. */
export const CACHE_INDEX_KEY = 'hc-expr-cache-index-v1';
const INDEX_SAVE_MS = 2000;

export interface ClipStoreDeps {
  /** Decode once (AudioEngine.prepare). */
  prepare(bytes: ArrayBuffer, opts: { key: string; mime?: string; alignment: Alignment | null; text?: string }): Promise<PreparedAudio>;
  fetch(url: string): Promise<Response>;
  /** Cache Storage, or null/undefined when unavailable. */
  caches?: CacheStorage | null;
  /** Where the Cache Storage index lives (localStorage), or null. */
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  manifest(agentId: string): ClipManifest | null;
  budgetBytes?: number;
  cacheMaxEntries?: number;
  now?(): number;
}

export interface WebClipStore extends ClipStore {
  /** Decoded clips held right now. */
  decodedCount(): number;
  decodedBytes(): number;
  has(key: string): boolean;
}

interface Fetched {
  bytes: ArrayBuffer;
  mime: string | undefined;
}

export function createClipStore(deps: ClipStoreDeps): WebClipStore {
  const budget = deps.budgetBytes ?? DECODED_BUDGET_BYTES;
  const cacheMax = deps.cacheMaxEntries ?? CACHE_MAX_ENTRIES;
  const now = deps.now ?? Date.now;
  const lru = new Map<string, PreparedClip>();
  /** The tier a key was prefetched for: P0 (the reflexes) leaves memory last. */
  const tiers = new Map<string, Exclude<PrevoiceTier, 'runtime'>>();
  let bytes = 0;
  const inflight = new Map<string, Promise<PreparedClip | null>>();
  const waiting: string[] = [];
  let running = 0;
  let cache: Promise<Cache | null> | null = null;

  // ── Cache Storage index (LRU trim) ──
  const index = new Map<string, number>();
  try {
    const raw = deps.storage?.getItem(CACHE_INDEX_KEY);
    if (raw) for (const [url, at] of Object.entries(JSON.parse(raw) as Record<string, number>)) if (typeof at === 'number') index.set(url, at);
  } catch {
    /* unreadable: start a new index */
  }
  let indexTimer: ReturnType<typeof setTimeout> | null = null;
  const saveIndex = () => {
    indexTimer = null;
    try {
      deps.storage?.setItem(CACHE_INDEX_KEY, JSON.stringify(Object.fromEntries(index)));
    } catch {
      /* storage full or blocked */
    }
  };
  const touch = (url: string) => {
    index.set(url, now());
    if (deps.storage) indexTimer ??= setTimeout(saveIndex, INDEX_SAVE_MS);
  };
  /** Over the cap: the least recently used responses leave Cache Storage (down to 90% of the cap). */
  async function trim(c: Cache): Promise<void> {
    if (index.size <= cacheMax) return;
    const oldest = [...index.entries()].sort((a, b) => a[1] - b[1]).slice(0, index.size - Math.floor(cacheMax * 0.9));
    for (const [url] of oldest) {
      index.delete(url);
      try {
        await c.delete(url);
      } catch {
        /* already gone */
      }
    }
    saveIndex();
  }

  const openCache = (): Promise<Cache | null> => {
    cache ??= (async () => {
      try {
        if (!deps.caches) return null;
        // Earlier cache versions (a renamed store) are dead weight: remove them.
        try {
          for (const name of await deps.caches.keys()) if (name.startsWith('hc-expr-') && name !== CLIP_CACHE) await deps.caches.delete(name);
        } catch {
          /* listing blocked: keep going */
        }
        const c = await deps.caches.open(CLIP_CACHE);
        // Responses stored before the index existed count as the oldest.
        if (!index.size) {
          try {
            for (const req of await c.keys()) if (!index.has(req.url)) index.set(req.url, 0);
          } catch {
            /* keys() unavailable */
          }
        }
        void trim(c);
        return c;
      } catch {
        return null; // storage blocked: memory only
      }
    })();
    return cache;
  };

  const sizeOf = (c: PreparedClip) => (c.handle as PreparedAudio | null)?.bytes ?? 0;

  const insert = (clip: PreparedClip) => {
    const prev = lru.get(clip.key);
    if (prev) {
      bytes -= sizeOf(prev);
      lru.delete(clip.key);
    }
    lru.set(clip.key, clip);
    bytes += sizeOf(clip);
    // Evict the least recently used until the decoded budget holds (always keep the newest one): anything but P0
    // first, so a Floor sweep or a runtime line never pushes out the reflexes.
    for (const pass of ['other', 'p0'] as const) {
      for (const [k, c] of lru) {
        if (bytes <= budget || lru.size <= 1) return;
        if (k === clip.key || (pass === 'other' && tiers.get(k) === 'p0')) continue;
        lru.delete(k);
        bytes -= sizeOf(c);
      }
    }
  };

  /** Cache first, then the network (stored in the cache for next time). null on any failure. */
  async function cached(url: string): Promise<Response | null> {
    const c = await openCache();
    if (c) {
      try {
        const hit = await c.match(url);
        if (hit) {
          touch(url);
          return hit;
        }
      } catch {
        /* fall through to the network */
      }
    }
    let res: Response;
    try {
      res = await deps.fetch(url);
    } catch {
      return null;
    }
    if (!res.ok) return null;
    if (c) {
      try {
        await c.put(url, res.clone());
        touch(url);
        if (index.size > cacheMax) void trim(c);
      } catch {
        /* quota or blocked: memory only */
      }
    }
    return res;
  }

  async function fetchClip(key: string): Promise<Fetched | null> {
    const res = await cached(clipUrl(key));
    if (!res) return null;
    try {
      return { bytes: await res.arrayBuffer(), mime: res.headers.get('content-type')?.split(';')[0] || undefined };
    } catch {
      return null;
    }
  }

  async function fetchAlignment(key: string): Promise<ExprClipAlignment | null> {
    const res = await cached(clipAlignmentUrl(key));
    if (!res) return null;
    try {
      return (await res.json()) as ExprClipAlignment;
    } catch {
      return null;
    }
  }

  async function decode(key: string): Promise<PreparedClip | null> {
    const [clip, align] = await Promise.all([fetchClip(key), fetchAlignment(key)]);
    if (!clip) return null;
    try {
      const prepared = await deps.prepare(clip.bytes, {
        key,
        ...(clip.mime ? { mime: clip.mime } : {}),
        alignment: align?.alignment ?? null,
        ...(align?.text ? { text: align.text } : {}),
      });
      const out: PreparedClip = { key, durationMs: prepared.durationMs, alignment: prepared.alignment, handle: prepared };
      insert(out);
      return out;
    } catch {
      return null;
    }
  }

  function load(key: string): Promise<PreparedClip | null> {
    const hit = lru.get(key);
    if (hit) return Promise.resolve(hit);
    let p = inflight.get(key);
    if (!p) {
      p = decode(key).finally(() => inflight.delete(key));
      inflight.set(key, p);
    }
    return p;
  }

  function pump(): void {
    while (running < PREFETCH_PARALLEL && waiting.length) {
      const key = waiting.shift()!;
      if (lru.has(key)) continue;
      running++;
      void load(key).finally(() => {
        running--;
        pump();
      });
    }
  }

  return {
    get(key) {
      const hit = lru.get(key);
      if (!hit) return null;
      lru.delete(key); // most recently used moves to the end
      lru.set(key, hit);
      return hit;
    },
    load,
    prefetch(keys: readonly string[], tier: Exclude<PrevoiceTier, 'runtime'>) {
      for (const k of keys) {
        if (tier === 'p0' || !tiers.has(k)) tiers.set(k, tier);
        if (!lru.has(k) && !inflight.has(k) && !waiting.includes(k)) waiting.push(k);
      }
      pump();
    },
    manifest: (agentId) => deps.manifest(agentId),
    decodedCount: () => lru.size,
    decodedBytes: () => bytes,
    has: (key) => lru.has(key),
  };
}
