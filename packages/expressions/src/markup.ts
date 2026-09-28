// Expressive speech markup: xAI inline tags ([pause] [laugh] …) and balanced wrappers (<soft>…</soft>).
// Ported from personagram-ai/src/worker/groups.ts (speakable, readable); same rules as
// catalog/scripts/validate-expressions.mjs, so the validator and the engine agree byte for byte.

const INLINE_TAG = /^(pause|long-pause|laugh|sigh|breath|sharp-breath|cough|yawn)$/i;
const WRAP_TAG = /^(whisper|soft|loud|slow|fast)$/i;

/** Tags banned in expression packs (§10.1 H12): they read as illness or boredom. */
export const BANNED_TAGS = /\[(cough|yawn)\]/i;

/**
 * What xAI TTS receives: known inline tags survive (lower-cased), unknown bracket or angle markup is
 * dropped, and wrappers are balanced (closed in order, unmatched closers dropped).
 */
export function speakable(raw: string): string {
  const open: string[] = [];
  const out = String(raw)
    .replace(/\[([^\]]*)\]/g, (_m, tag: string) => (INLINE_TAG.test(tag.trim()) ? `[${tag.trim().toLowerCase()}]` : ' '))
    .replace(/<\s*(\/?)\s*([a-z-]*)\s*>/gi, (_m, slash: string, tag: string) => {
      const name = tag.toLowerCase();
      if (!WRAP_TAG.test(name)) return ' ';
      if (!slash) {
        open.push(name);
        return `<${name}>`;
      }
      const at = open.lastIndexOf(name);
      if (at < 0) return ' ';
      return open
        .splice(at)
        .reverse()
        .map((t) => `</${t}>`)
        .join('');
    });
  return (out + open.reverse().map((t) => `</${t}>`).join(''))
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.!?…;:])/g, '$1')
    .trim();
}

/** What people read: the words alone (captions, bubbles, browser speech). */
export function readable(raw: string): string {
  return String(raw)
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.!?…;:])/g, '$1')
    .trim();
}

/** `{slot}` placeholders in order of appearance (duplicates kept). */
export function placeholders(s: string): string[] {
  return [...String(s).matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]!);
}

/** Number of expressive tags (inline tags plus opening wrappers). */
export function tagCount(s: string): number {
  return (String(s).match(/\[[a-z-]+\]|<(?!\/)[a-z]+>/g) ?? []).length;
}

/** Inline tags and wrappers present in an xAI rendering, lower-cased, without brackets. */
export function tagsIn(s: string): Set<string> {
  const out = new Set<string>();
  for (const m of String(s).matchAll(/\[([a-z-]+)\]/gi)) out.add(m[1]!.toLowerCase());
  for (const m of String(s).matchAll(/<([a-z]+)>/gi)) out.add(m[1]!.toLowerCase());
  return out;
}

/**
 * OpenAI gpt-4o-mini-tts has no inline tags: `[pause]` becomes "…", `[long-pause]` "… …", every other
 * tag is dropped (it moves into the free-text instructions instead, see `instructionsFromTags`).
 */
export function openaiInputFromXai(xai: string): string {
  const marked = String(xai)
    .replace(/\[\s*long-pause\s*\]/gi, '\u0001')
    .replace(/\[\s*pause\s*\]/gi, '\u0002');
  return readable(marked)
    .replace(/\s*\u0001\s*/g, ' … … ')
    .replace(/\s*\u0002\s*/g, ' … ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .replace(/^(…\s*)+/, '')
    .trim();
}

const TAG_HINTS: ReadonlyArray<[string, string]> = [
  ['laugh', 'Begins with a light, genuine laugh.'],
  ['sigh', 'With a small sigh.'],
  ['breath', 'Takes a small breath first.'],
  ['sharp-breath', 'With a quick intake of breath.'],
  ['whisper', 'Whispered, close and confidential.'],
  ['soft', 'Softly.'],
  ['loud', 'A little louder, with energy.'],
  ['slow', 'Slower than usual.'],
  ['fast', 'Quicker than usual.'],
];

/** Free-text delivery hints derived from a line's xAI tags, for providers without inline tags. */
export function instructionsFromTags(xai: string): string | null {
  const tags = tagsIn(xai);
  const hints = TAG_HINTS.filter(([t]) => tags.has(t)).map(([, h]) => h);
  return hints.length ? hints.join(' ') : null;
}

/** Strip markup characters so a slot value can never inject tags or placeholders (§5.5). */
export function stripMarkupChars(value: string): string {
  return String(value).replace(/[[\]<>{}]/g, ' ').replace(/\s+/g, ' ').trim();
}
