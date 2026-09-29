// Hybrid recall (Inc 4; after oncloudnine's Memory): keyword relevance (BM25) and meaning (cosine over embeddings) are
// ranked separately and fused by reciprocal rank (RRF), so a memory found by either counts, and one found by both wins.
// Pure functions over a small corpus (a workspace's memories and file excerpts), no index needed.

const STOP = new Set(
  'a an and are as at be been but by can could did do does for from had has have he her his how i if in into is it its just me my of on or our ours she so than that the their them then there these they this those to too us was we were what when where which who why will with would you your yours about also any all some more most very not no yes'.split(' '),
);

/** Words for matching: lower-case, accents folded, stop words dropped, a light plural/-ing/-ed stem. */
export function tokens(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length < 2 || STOP.has(raw)) continue;
    let w = raw;
    if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3);
    else if (w.length > 4 && w.endsWith('ed')) w = w.slice(0, -2);
    else if (w.length > 3 && w.endsWith('es') && !w.endsWith('ses')) w = w.slice(0, -2);
    else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
    out.push(w);
  }
  return out;
}

export interface Doc {
  id: string;
  tokens: string[];
}

/** Okapi BM25 (k1 1.2, b 0.75): the documents that match any query word, by score. */
export function bm25(query: readonly string[], docs: readonly Doc[], k1 = 1.2, b = 0.75): Map<string, number> {
  const scores = new Map<string, number>();
  if (!query.length || !docs.length) return scores;
  const n = docs.length;
  const avg = docs.reduce((s, d) => s + d.tokens.length, 0) / n || 1;
  const df = new Map<string, number>();
  const unique = [...new Set(query)];
  for (const d of docs) {
    const seen = new Set(d.tokens);
    for (const q of unique) if (seen.has(q)) df.set(q, (df.get(q) ?? 0) + 1);
  }
  for (const d of docs) {
    const tf = new Map<string, number>();
    for (const t of d.tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    let s = 0;
    for (const q of unique) {
      const f = tf.get(q);
      if (!f) continue;
      const idf = Math.log(1 + (n - (df.get(q) ?? 0) + 0.5) / ((df.get(q) ?? 0) + 0.5));
      s += (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.tokens.length) / avg));
    }
    if (s > 0) scores.set(d.id, s);
  }
  return scores;
}

export function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || !a.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** Reciprocal rank fusion of several rankings (best first), k = 60. */
export function rrf(rankings: readonly (readonly string[])[], k = 60): Map<string, number> {
  const out = new Map<string, number>();
  for (const list of rankings) list.forEach((id, i) => out.set(id, (out.get(id) ?? 0) + 1 / (k + i + 1)));
  return out;
}

/** Near-duplicates: the same words, nearly (Jaccard over word sets). */
export function similar(a: string, b: string, at = 0.8): boolean {
  const x = new Set(tokens(a));
  const y = new Set(tokens(b));
  if (!x.size || !y.size) return a.trim().toLowerCase() === b.trim().toLowerCase();
  let both = 0;
  for (const t of x) if (y.has(t)) both++;
  return both / (x.size + y.size - both) >= at;
}

/** Split text into searchable pieces of about `size` characters at paragraph or line breaks, with a little overlap. */
export function chunk(text: string, size = 900, overlap = 120, max = 400): string[] {
  const clean = text.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!clean) return [];
  if (clean.length <= size) return [clean];
  const out: string[] = [];
  let at = 0;
  while (at < clean.length && out.length < max) {
    let end = Math.min(clean.length, at + size);
    if (end < clean.length) {
      const para = clean.lastIndexOf('\n\n', end);
      const line = clean.lastIndexOf('\n', end);
      const sentence = clean.lastIndexOf('. ', end);
      const cut = [para, line, sentence].find((p) => p > at + size * 0.5);
      if (cut !== undefined && cut > 0) end = cut + 1;
    }
    out.push(clean.slice(at, end).trim());
    if (end >= clean.length) break;
    at = Math.max(end - overlap, at + 1);
  }
  return out.filter(Boolean);
}
