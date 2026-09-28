// Ported from oncloudnine/server/lib/lenientJson.ts — a reader for the JSON a (local) model *meant* to write.
//
// Structured output is a request, not a guarantee. qwen3:32b produced structurally broken JSON in 2 of 8
// measured runs (an object closer where an array closer belongs, an array closed with `}`). Three recovery
// rules cover everything observed:
//   1. A closer closes the innermost open container, whichever character was written.
//   2. A string immediately followed by ':' is a key. If an array is open, the model forgot to close it,
//      so the stack unwinds to the nearest object first.
//   3. End of input closes whatever is still open, so a truncated answer keeps what it did emit.
// It is only a fallback: `readJson` tries JSON.parse first and reports whether it had to repair.

const MAX_LENIENT_CHARS = 200_000;

export interface LenientToken {
  /** One of { } [ ] , : */
  punct?: string;
  /** A completed scalar. */
  value?: unknown;
  /** The input ended inside this string: a fragment, so callers drop it. */
  truncated?: boolean;
}

const ESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', '"': '"', "'": "'", '\\': '\\', '/': '/' };

function readString(text: string, start: number, quote: string): { token: LenientToken; next: number } {
  let value = '';
  let i = start;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '\\') {
      const escape = text[i + 1];
      if (escape === undefined) return { token: { value, truncated: true }, next: text.length };
      if (escape === 'u') {
        const code = text.slice(i + 2, i + 6);
        if (/^[0-9a-fA-F]{4}$/.test(code)) {
          value += String.fromCharCode(Number.parseInt(code, 16));
          i += 6;
          continue;
        }
      }
      value += ESCAPES[escape] ?? escape;
      i += 2;
      continue;
    }
    if (ch === quote) return { token: { value }, next: i + 1 };
    value += ch;
    i++;
  }
  return { token: { value, truncated: true }, next: text.length };
}

/** Everything recognisable in `text`; prose, back-ticks and stray words are skipped. */
export function tokenizeJson(text: string): LenientToken[] {
  const tokens: LenientToken[] = [];
  if (typeof text !== 'string') return tokens;
  const source = text.length > MAX_LENIENT_CHARS ? text.slice(0, MAX_LENIENT_CHARS) : text;
  let i = 0;
  while (i < source.length) {
    const ch = source[i]!;
    if (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t') {
      i++;
      continue;
    }
    if (ch === '{' || ch === '}' || ch === '[' || ch === ']' || ch === ',' || ch === ':') {
      tokens.push({ punct: ch });
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const read = readString(source, i + 1, ch);
      tokens.push(read.token);
      i = read.next;
      continue;
    }
    if (ch === '-' || (ch >= '0' && ch <= '9')) {
      let end = i + 1;
      while (end < source.length && /[0-9eE+\-.]/.test(source[end]!)) end++;
      const value = Number(source.slice(i, end));
      if (Number.isFinite(value)) tokens.push({ value });
      i = end;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let end = i + 1;
      while (end < source.length && /[A-Za-z0-9_]/.test(source[end]!)) end++;
      const word = source.slice(i, end);
      if (word === 'true') tokens.push({ value: true });
      else if (word === 'false') tokens.push({ value: false });
      else if (word === 'null') tokens.push({ value: null });
      i = end;
      continue;
    }
    i++;
  }
  return tokens;
}

interface Frame {
  array: boolean;
  value: unknown[] | Record<string, unknown>;
  key: string | null;
}

/** The widest value the token stream describes, or undefined. Never throws. */
export function parseLenientJson(text: string): unknown {
  const tokens = tokenizeJson(text);
  const stack: Frame[] = [];
  const roots: unknown[] = [];
  const emit = (value: unknown) => {
    const frame = stack[stack.length - 1];
    if (!frame) {
      roots.push(value);
      return;
    }
    if (frame.array) {
      (frame.value as unknown[]).push(value);
      return;
    }
    if (frame.key === null) return; // a value with no key is not addressable
    (frame.value as Record<string, unknown>)[frame.key] = value;
    frame.key = null;
  };
  const close = () => {
    const frame = stack.pop();
    if (frame) emit(frame.value);
  };
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token.punct === '{') {
      stack.push({ array: false, value: {}, key: null });
      continue;
    }
    if (token.punct === '[') {
      stack.push({ array: true, value: [], key: null });
      continue;
    }
    if (token.punct === '}' || token.punct === ']') {
      if (stack.length > 0) close(); // rule 1
      continue;
    }
    if (token.punct) continue;
    if (token.truncated) continue;
    const next = tokens[i + 1];
    if (next?.punct === ':' && typeof token.value === 'string') {
      while (stack.length > 0 && stack[stack.length - 1]!.array) close(); // rule 2
      if (stack.length === 0) stack.push({ array: false, value: {}, key: null });
      stack[stack.length - 1]!.key = token.value;
      continue;
    }
    emit(token.value);
  }
  while (stack.length > 0) close(); // rule 3
  const structure = roots.find((v) => v && typeof v === 'object');
  return structure !== undefined ? structure : roots[0];
}

/**
 * Read the JSON in a model answer: `<think>` stripped, then JSON.parse on the whole text, on a fenced block
 * and on the widest {…}/[…] span; only then the lenient reader. `repaired` says the lenient path was needed.
 */
export function readJson(text: string): { value: unknown; repaired: boolean } | null {
  const clean = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const candidates = [clean];
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(clean);
  if (fence?.[1]) candidates.push(fence[1].trim());
  const o1 = clean.indexOf('{');
  const o2 = clean.lastIndexOf('}');
  if (o1 !== -1 && o2 > o1) candidates.push(clean.slice(o1, o2 + 1));
  const a1 = clean.indexOf('[');
  const a2 = clean.lastIndexOf(']');
  if (a1 !== -1 && a2 > a1) candidates.push(clean.slice(a1, a2 + 1));
  for (const c of candidates) {
    try {
      return { value: JSON.parse(c) as unknown, repaired: false };
    } catch {
      /* next candidate */
    }
  }
  const lenient = parseLenientJson(clean);
  return lenient === undefined ? null : { value: lenient, repaired: true };
}
