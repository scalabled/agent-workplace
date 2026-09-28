// Ported from personagram-ai/src/web/avatar/face-lipsync.js (VISEMES, CHAR_TO_VISEME, pairViseme,
// textToVisemeSequence, alignmentToVisemeSequence), typed and adapted to the protocol's Alignment shape.

import { VISEME_PARAMS, type Alignment, type VisemeId, type VisemeParams } from '@headcount/protocol';
import type { VisemeSegment } from './audio-features';

/** The shared viseme shape table (defined once in @headcount/protocol so the face draws the same shapes). */
export const VISEMES: Readonly<Record<VisemeId, Readonly<VisemeParams>>> = VISEME_PARAMS;

export const CHAR_TO_VISEME: Readonly<Record<string, VisemeId>> = {
  m: 'CLOSED',
  b: 'CLOSED',
  p: 'CLOSED',
  f: 'TEETH',
  v: 'TEETH',
  s: 'TEETH',
  z: 'TEETH',
  w: 'ROUND',
  o: 'ROUND',
  u: 'ROUND',
  l: 'TONGUE',
  n: 'TONGUE',
  d: 'TONGUE',
  t: 'TONGUE',
  k: 'OPEN_SMALL',
  g: 'OPEN_SMALL',
  r: 'OPEN_SMALL',
  c: 'OPEN_SMALL',
  j: 'OPEN_SMALL',
  q: 'OPEN_SMALL',
  x: 'OPEN_SMALL',
  h: 'OPEN_MED',
  a: 'OPEN_WIDE',
  e: 'WIDE',
  i: 'WIDE',
  y: 'WIDE',
  ' ': 'REST',
  ',': 'REST',
  '.': 'REST',
  '!': 'REST',
  '?': 'REST',
  ':': 'REST',
  ';': 'REST',
  '-': 'REST',
  "'": 'REST',
};

/** Digraph refinement shared by the text and alignment sequencers (grapheme-based, not phonemes). */
export function pairViseme(ch: string, nextCh: string | undefined, fallback: VisemeId): VisemeId {
  if (!nextCh) return fallback;
  const pair = ch + nextCh;
  if (pair === 'th') return 'TONGUE';
  if (pair === 'sh') return 'TEETH';
  if (pair === 'oo') return 'ROUND';
  if (pair === 'ee') return 'WIDE';
  return fallback;
}

export function visemeForChar(ch: string, next?: string): VisemeId {
  return pairViseme(ch, next, CHAR_TO_VISEME[ch] ?? 'OPEN_SMALL');
}

/** Lower-cases and drops characters the table cannot voice. */
export function cleanForVisemes(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s.,!?;:\-']/g, '');
}

/** Spread text evenly over a known duration (merging runs of the same viseme). */
export function textToVisemeSequence(text: string, durationMs: number): VisemeSegment[] {
  if (!text || !(durationMs > 0)) return [];
  const chars = cleanForVisemes(text).split('');
  if (!chars.length) return [];
  const msPerChar = durationMs / chars.length;
  const seq: VisemeSegment[] = [];
  let time = 0;
  for (let i = 0; i < chars.length; i++) {
    const viseme = visemeForChar(chars[i]!, chars[i + 1]);
    const last = seq[seq.length - 1];
    if (last && last.viseme === viseme) last.duration += msPerChar;
    else seq.push({ viseme, time, duration: msPerChar });
    time += msPerChar;
  }
  return seq;
}

/** Provider character timestamps → viseme sequence; null when missing or malformed. */
export function alignmentToVisemeSequence(alignment: Alignment | null | undefined): VisemeSegment[] | null {
  if (!alignment?.chars?.length) return null;
  const { chars, startsMs, endsMs } = alignment;
  if (!startsMs?.length || chars.length !== startsMs.length) return null;
  const seq: VisemeSegment[] = [];
  for (let i = 0; i < chars.length; i++) {
    const ch = (chars[i] ?? '').toLowerCase();
    const startMs = startsMs[i]!;
    if (!Number.isFinite(startMs)) return null;
    const endMs = endsMs?.[i] ?? startMs + 50;
    const viseme = visemeForChar(ch, chars[i + 1]?.toLowerCase());
    const last = seq[seq.length - 1];
    if (last && last.viseme === viseme) last.duration = Math.max(1, endMs - last.time);
    else seq.push({ viseme, time: startMs, duration: Math.max(1, endMs - startMs) });
  }
  return seq.length ? seq : null;
}

const OPEN_FULL = VISEMES.OPEN_WIDE.openY + VISEMES.OPEN_WIDE.jawDrop;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Normalised mouth fields (0–1) from PG params: OPEN_WIDE ≈ 1 openness, WIDE = 1 width, ROUND = 1 round. */
export function mouthFromParams(p: VisemeParams): { openness: number; width: number; round: number } {
  return {
    openness: clamp01((p.openY + p.jawDrop) / OPEN_FULL),
    width: clamp01(p.stretchX / VISEMES.WIDE.stretchX),
    round: clamp01(p.round),
  };
}
