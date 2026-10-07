// Canned speech, shared by every office: the fixed lines the office itself says (a room's work line, the figure
// lines, a meeting's close) and short everyday acknowledgements ("On it.", "Thank you, everyone."). Their audio is
// rendered once per voice and kept in R2 under `speech/canned/`, outside any office's prefix, so every organization
// reuses it for free. Only text that EXACTLY matches this list is shared: nothing a person wrote, no names, no
// numbers, so nothing personal can land in the shared space. Everything else stays per office (or is not cached).
import { CHIEF_ROOM_WORK_LINE, EXPERIENCE_LINE, FIGURE_LINES } from '../rooms/guard';

/** The office's own fixed lines (spoken through the speech route, not pre-voiced clips). */
const FIXED_LINES: readonly string[] = [CHIEF_ROOM_WORK_LINE, EXPERIENCE_LINE, ...FIGURE_LINES, 'Thank you, everyone.'];

/** Everyday acknowledgements, as a whole sentence (an optional end mark). */
const EVERYDAY: readonly string[] = [
  'ok',
  'okay',
  'sure',
  'sure thing',
  'of course',
  'got it',
  'on it',
  'will do',
  'done',
  'all done',
  'yes',
  'no',
  'right',
  'good question',
  'great question',
  'one moment',
  'one sec',
  'one second',
  'just a moment',
  'thanks',
  'thank you',
  'thank you, everyone',
  'thanks, everyone',
  'you’re welcome',
  "you're welcome",
  'anytime',
  'no problem',
  'happy to help',
  'let me check',
  'let me look',
  'let me think',
  'sounds good',
  'good morning',
  'good afternoon',
  'good evening',
  'hello',
  'hi',
  'hi there',
  'hello there',
  'welcome back',
  'good to see you',
  'talk soon',
  'bye',
  'goodbye',
  'see you soon',
];

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').replace(/[’]/g, "'").toLowerCase();
const CANNED = new Set<string>([...FIXED_LINES.map(norm), ...EVERYDAY.map((e) => norm(e))]);

/** Whether this exact text (one sentence) is canned speech every office shares. */
export function isCannedSpeech(text: string): boolean {
  const t = norm(text);
  if (!t || t.length > 120) return false;
  return CANNED.has(t) || CANNED.has(t.replace(/[.!?…]+$/, ''));
}

/** R2 key of a canned line's audio: shared, content-addressed by the words, the voice and the format asked for. */
export async function cannedSpeechKey(parts: { text: string; voice: unknown; prefer: unknown; format: string | null; json: boolean }): Promise<string> {
  // The exact words (timing is per character), only the spacing evened out.
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ ...parts, text: parts.text.trim().replace(/\s+/g, ' ') })));
  const hex = [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `speech/canned/${hex.slice(0, 40)}.${parts.json ? 'json' : 'bin'}`;
}
