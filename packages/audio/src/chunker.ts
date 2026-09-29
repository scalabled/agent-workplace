// Ported from personagram-ai/src/shared/chunker.ts (+ src/shared/tokens.ts estimateTokens).
// Sentence-aligned chunking of streamed reply text for per-sentence TTS. Each chunk is a whole
// sentence (or several short ones); an over-long sentence is split at clause boundaries, never by
// blind character slicing. The first clause is released early so the first words are not held back.

export interface ChunkerOptions {
  /** Upper bound per chunk, in estimated tokens. Default 120. */
  maxTokens?: number;
  /** Sentences shorter than this are held and merged into the next chunk (never the first). Default 24. */
  minChars?: number;
  /**
   * Before anything has been emitted, release text up to the last clause boundary once the buffer
   * holds at least this many characters. 0 disables. Default 60 (ARCHITECTURE §8.2).
   */
  firstClauseChars?: number;
  onChunk: (chunk: string) => void;
}

/** Conservative token estimate (3 chars per token, 1.5 tokens per word): errs high. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.ceil(Math.max(text.length / 3, words * 1.5));
}

const ABBREVIATIONS = /(?:^|[\s(])(?:e\.g|i\.e|vs|etc|mr|mrs|ms|dr|st|jr|sr|no|u\.s|approx|inc|ltd|v)\.$/i;
const INITIAL = /(?:^|\s)[A-Z]\.$/;
/** A terminal mark, optional closing quotes/brackets, then whitespace. */
const BOUNDARY = /[.!?…]+["'”’)\]]*(?=\s)/g;
const CLAUSE = /[,;:—–]\s|\s(?:and|but|or|so|then|while|which|because)\s/g;

/** Index just past the last clause boundary at or before `limit`, or -1. */
export function lastClauseBoundary(text: string, limit: number = text.length): number {
  let last = -1;
  CLAUSE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CLAUSE.exec(text))) {
    const cut = m.index + (m[0].startsWith(' ') ? 0 : 1);
    if (cut > limit) break;
    if (cut >= 12) last = cut;
  }
  return last;
}

/** Index just past the first sentence boundary in `text`, or -1 when none is complete yet. */
export function findSentenceEnd(text: string): number {
  const newline = text.indexOf('\n');
  BOUNDARY.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BOUNDARY.exec(text))) {
    const end = m.index + m[0].length;
    if (newline !== -1 && newline < end) break;
    const head = text.slice(0, end);
    const dotOnly = /\.["'”’)\]]*$/.test(head) && !/\.\.+["'”’)\]]*$/.test(head);
    if (dotOnly && (ABBREVIATIONS.test(head) || INITIAL.test(head))) continue;
    return end;
  }
  if (newline !== -1 && text.slice(0, newline).trim()) return newline + 1;
  return -1;
}

/** Split `text` (one over-long sentence) at clause boundaries so every piece fits. */
export function splitAtClauses(text: string, maxTokens: number): string[] {
  const out: string[] = [];
  let rest = text.trim();
  while (estimateTokens(rest) > maxTokens) {
    let cut = -1;
    CLAUSE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = CLAUSE.exec(rest))) {
      const candidate = m.index + (m[0].startsWith(' ') ? 0 : m[0].length - 1);
      if (candidate <= 0) continue;
      if (estimateTokens(rest.slice(0, candidate)) > maxTokens) break;
      cut = candidate;
    }
    if (cut <= 0) {
      // No clause boundary fits: fall back to the last whitespace inside the budget.
      let lastSpace = -1;
      for (let i = 0; i < rest.length; i++) {
        if (/\s/.test(rest[i]!)) {
          if (estimateTokens(rest.slice(0, i)) > maxTokens) break;
          lastSpace = i;
        }
      }
      cut = lastSpace;
    }
    if (cut <= 0) break; // one unbreakable token: emit as is rather than slicing a word
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

export class SentenceChunker {
  private buffer = '';
  private pending = '';
  private readonly maxTokens: number;
  private readonly minChars: number;
  private readonly firstClauseChars: number;
  private readonly onChunk: (chunk: string) => void;
  private emitted = 0;

  constructor(options: ChunkerOptions) {
    this.maxTokens = options.maxTokens ?? 120;
    this.minChars = options.minChars ?? 24;
    this.firstClauseChars = options.firstClauseChars ?? 60;
    this.onChunk = options.onChunk;
  }

  get chunksEmitted(): number {
    return this.emitted;
  }

  push(delta: string): void {
    if (!delta) return;
    this.buffer += delta;
    for (;;) {
      const end = findSentenceEnd(this.buffer);
      if (end === -1) break;
      const sentence = this.buffer.slice(0, end).trim();
      this.buffer = this.buffer.slice(end);
      if (sentence) this.queue(sentence);
    }
    // Nothing spoken yet and the first sentence is running long: release it up to a clause boundary.
    if (this.emitted === 0 && !this.pending && this.firstClauseChars > 0 && this.buffer.length >= this.firstClauseChars) {
      const cut = lastClauseBoundary(this.buffer);
      if (cut >= 12) {
        const head = this.buffer.slice(0, cut).trim();
        this.buffer = this.buffer.slice(cut);
        // Adaptation: PG emitted `head` whole; when a large delta lands at once it can exceed maxTokens.
        if (head) for (const piece of estimateTokens(head) > this.maxTokens ? splitAtClauses(head, this.maxTokens) : [head]) this.emit(piece);
      }
    }
    // A long run with no sentence end yet: release complete clauses.
    if (estimateTokens(this.buffer) > this.maxTokens) {
      const pieces = splitAtClauses(this.buffer, this.maxTokens);
      const tail = pieces.pop() ?? '';
      for (const p of pieces) this.queue(p);
      this.buffer = tail;
    }
  }

  /** Emit whatever is left. Safe to call more than once. */
  flush(): void {
    const rest = this.buffer.trim();
    this.buffer = '';
    if (rest) this.queue(rest);
    if (this.pending) {
      this.emit(this.pending);
      this.pending = '';
    }
  }

  /**
   * Emit every whole sentence left and drop an unfinished last one (the text stopped mid-sentence and the rest will
   * never come). Safe to call more than once.
   */
  flushComplete(): void {
    const rest = this.buffer.trim();
    this.buffer = '';
    // Only the whitespace after its last mark is missing: that sentence is whole.
    if (rest && findSentenceEnd(`${rest} `) === rest.length) this.queue(rest);
    if (this.pending) {
      this.emit(this.pending);
      this.pending = '';
    }
  }

  /** Drop everything buffered (barge-in). */
  reset(): void {
    this.buffer = '';
    this.pending = '';
  }

  private queue(sentence: string): void {
    const text = this.pending ? `${this.pending} ${sentence}` : sentence;
    this.pending = '';
    // The first chunk is latency-critical: it goes out as soon as any sentence completes.
    if (text.length < this.minChars && this.emitted > 0) {
      this.pending = text;
      return;
    }
    if (estimateTokens(text) > this.maxTokens) {
      for (const piece of splitAtClauses(text, this.maxTokens)) this.emit(piece);
      return;
    }
    this.emit(text);
  }

  private emit(chunk: string): void {
    if (!chunk) return;
    this.emitted++;
    this.onChunk(chunk);
  }
}
