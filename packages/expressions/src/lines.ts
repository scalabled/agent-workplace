// Per-line derived facts: opener word, text hash, duration estimate and intensity (§4.2, §5.3).
import { fnv1a32 } from './hash';
import { readable, tagsIn } from './markup';
import type { CompiledLine, LaughStyle } from './types';
import type { IntentId, SlotId } from './vocab';

/** First word of a line, lower-cased: "(chuckles)" → "chuckles", "{coworker}, it's yours" → "{coworker}". */
export function openerOf(text: string): string {
  const t = String(text).trim().replace(/^[("'“‘¡¿\s]+/, '');
  const m = t.match(/^(\{[a-z_]+\}|[^\s,.!?;:—–…)]+)/i);
  return (m?.[1] ?? '').toLowerCase().replace(/[’‘]/g, "'");
}

/** Text normalised for repetition checks: case, curly quotes and punctuation do not matter. */
export function normalizeForHash(text: string): string {
  return String(text)
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[.,!?;:—–…"“”()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function textHashOf(text: string): number {
  return fnv1a32(normalizeForHash(text));
}

/** Rough syllables for placeholders before they are filled. */
const SLOT_SYLLABLES: Partial<Record<SlotId, number>> = {
  step_label: 8, gist: 10, blocker: 6, other_thread: 5, artifact: 4, client: 3, project: 3,
  coworker: 2, owner_name: 2, chief_name: 2, self_name: 2, eta: 3, done: 1, total: 1, finding_count: 1, weekday: 2, part_of_day: 3,
};

function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!w) return 0;
  if (/^\d+$/.test(w)) return Math.min(8, w.length * 2);
  const groups = w.match(/[aeiouy]+/g)?.length ?? 0;
  let n = groups;
  if (n > 1 && /[^aeiouyl]e$/.test(w)) n -= 1; // silent final e ("give", "sure")
  return Math.max(1, n);
}

const TAG_MS: Readonly<Record<string, number>> = { pause: 300, 'long-pause': 700, laugh: 600, sigh: 500, breath: 250, 'sharp-breath': 200 };

/**
 * Spoken duration estimate in ms for a line (xAI rendering preferred, so tag time counts). Deliberately a
 * little optimistic (≈ 170 ms per syllable); a pre-voiced clip's real duration always wins.
 */
export function estimateMs(xaiOrText: string, nonverbal: boolean, laughIntensity = 0.5): number {
  if (nonverbal) return Math.round(500 + 700 * laughIntensity);
  const src = String(xaiOrText);
  let ms = 120;
  for (const m of src.matchAll(/\[([a-z-]+)\]/gi)) ms += TAG_MS[m[1]!.toLowerCase()] ?? 0;
  const words = readable(src.replace(/\{([a-z_]+)\}/g, (_m, s: string) => ` ${'la '.repeat(SLOT_SYLLABLES[s as SlotId] ?? 3)}`));
  for (const w of words.split(/\s+/)) ms += syllables(w) * 170;
  ms += (words.match(/[,;:]/g)?.length ?? 0) * 60;
  ms += (words.match(/[—–]/g)?.length ?? 0) * 100;
  ms += (words.replace(/[.!?…]+$/, '').match(/[.!?…]+\s/g)?.length ?? 0) * 110;
  if (/<slow>/i.test(src)) ms *= 1.15;
  if (/<fast>/i.test(src)) ms *= 0.88;
  return Math.round(ms);
}

export const INTENSITY_VALUE: Readonly<Record<CompiledLine['intensity'], number>> = { low: 0.3, mid: 0.6, high: 0.9 };

export function intensityFromNumber(x: number): CompiledLine['intensity'] {
  return x <= 0.4 ? 'low' : x <= 0.8 ? 'mid' : 'high';
}

/** How big a line is: laughs by their markup, other lines by loud/soft wrappers. */
export function intensityOf(xai: string, intent: IntentId, nonverbal: boolean): CompiledLine['intensity'] {
  const tags = tagsIn(xai);
  const laughs = (String(xai).match(/\[laugh\]/gi) ?? []).length;
  if (intent === 'laugh' || laughs > 0) {
    if (tags.has('loud') || laughs >= 2) return 'high';
    if (tags.has('soft') || tags.has('whisper')) return 'low';
    if (laughs === 1) return 'mid';
    return nonverbal ? 'mid' : 'low';
  }
  if (tags.has('loud')) return 'high';
  if (tags.has('soft') || tags.has('whisper')) return 'low';
  return 'mid';
}

/** Parenthesised caption for a laugh style ("(chuckles)"). */
export function laughCaption(style: LaughStyle): string {
  const c = String(style.caption ?? '').trim() || '(laughs)';
  return /^\(.+\)$/.test(c) ? c : `(${c.replace(/^\(|\)$/g, '')})`;
}
