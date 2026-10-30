// Seeded randomness: FNV-1a of ids → mulberry32. Never Math.random or time.

/** 32-bit FNV-1a hash of a string. */
export function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A deterministic PRNG in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A PRNG seeded from a string id. */
export const rngFor = (id: string): (() => number) => mulberry32(fnv1a(id));

/** Pick one item deterministically. */
export function pick<T>(rand: () => number, items: readonly T[]): T {
  return items[Math.floor(rand() * items.length) % items.length]!;
}

/** Hex string of a hash (for plan hashes). */
export const hashHex = (input: string): string => fnv1a(input).toString(16).padStart(8, '0') + fnv1a(`~${input}`).toString(16).padStart(8, '0');
