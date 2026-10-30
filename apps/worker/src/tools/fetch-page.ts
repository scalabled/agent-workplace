// fetch_page: read a public web page as text (ported from biz-bot worker/src/fetch-page.js, hardened). biz-bot checks
// hostnames by string only; here every hop is checked by address family and range, the name is resolved over DNS-over-
// HTTPS and every A/AAAA answer must be public, redirects are followed by hand (≤ 4, each re-checked), and the whole
// read (headers and body) has one deadline. Cloudflare's network also refuses private destinations in production;
// these checks matter most in local development, where the worker runs on the owner's machine.

import { BRAND } from '@headcount/protocol';

export const FETCH_MAX_BYTES = 2_000_000;
export const FETCH_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 4;
const ALLOWED_PORTS = new Set(['', '80', '443', '8080', '8443']);
const USER_AGENT = `${BRAND.name.replace(/\s+/g, '')}Fetch/1.0 (reads public pages for the owner)`;

export class FetchPageError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 413 | 415 | 502 | 504,
  ) {
    super(message);
    this.name = 'FetchPageError';
  }
}

export interface PageText {
  url: string;
  finalUrl: string;
  title: string;
  contentType: string;
  text: string;
  truncated: boolean;
}

/** Resolves a hostname to its IP addresses (A and AAAA); an empty list means it does not resolve. */
export type Resolver = (host: string, signal: AbortSignal) => Promise<string[]>;

// ── addresses ────────────────────────────────────────────────────────────────────

function v4(ip: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((n) => n <= 255) ? parts : null;
}

function privateV4([a, b, c]: number[]): boolean {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b! >= 64 && b! <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b! >= 16 && b! <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a! >= 224
  );
}

/** Expand an IPv6 literal to eight 16-bit groups (null when it is not one). A dotted IPv4 tail becomes two groups. */
function v6(ip: string): number[] | null {
  let s = ip.toLowerCase();
  if (!s.includes(':')) return null;
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (dotted) {
    const f = v4(dotted[1]!);
    if (!f) return null;
    s = `${s.slice(0, -dotted[1]!.length)}${((f[0]! << 8) | f[1]!).toString(16)}:${((f[2]! << 8) | f[3]!).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const parse = (h: string) => (h ? h.split(':').map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN)) : []);
  const head = parse(halves[0]!);
  let groups = head;
  if (halves.length === 2) {
    const rest = parse(halves[1]!);
    const fill = 8 - head.length - rest.length;
    if (fill < 1) return null;
    groups = [...head, ...new Array<number>(fill).fill(0), ...rest];
  }
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

function privateV6(g: number[]): boolean {
  const zeroTo = (n: number) => g.slice(0, n).every((x) => x === 0);
  if (zeroTo(8)) return true; // ::
  if (zeroTo(7) && g[7] === 1) return true; // ::1
  // IPv4-mapped (::ffff:a.b.c.d), IPv4-compatible (::a.b.c.d) and NAT64 (64:ff9b::/96): judge the embedded v4.
  const embedded = [g[6]! >> 8, g[6]! & 0xff, g[7]! >> 8, g[7]! & 0xff];
  if (zeroTo(5) && (g[5] === 0xffff || g[5] === 0)) return privateV4(embedded);
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return privateV4(embedded);
  const first = g[0]!;
  return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00 || (first === 0x2001 && g[1] === 0xdb8);
}

/** Is this IP literal (v4 or v6) a private, loopback, link-local, shared, reserved or multicast address? */
export function isPrivateAddress(ip: string): boolean {
  const bare = ip.replace(/^\[|\]$/g, '');
  const four = v4(bare);
  if (four) return privateV4(four);
  const six = v6(bare);
  return six ? privateV6(six) : false;
}

const BLOCKED_SUFFIX = /(^|\.)(localhost|local|internal|lan|home|intranet|corp|arpa|test|invalid|example)$/i;

/** Validate a URL for fetching; returns the parsed URL or throws FetchPageError (400). */
export function assertPublicUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(String(raw ?? '').trim());
  } catch {
    throw new FetchPageError('That is not a valid URL.', 400);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new FetchPageError('Only http(s) pages can be read.', 400);
  if (u.username || u.password) throw new FetchPageError('URLs with credentials are not allowed.', 400);
  if (!ALLOWED_PORTS.has(u.port)) throw new FetchPageError('Only the standard web ports can be read.', 400);
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host) throw new FetchPageError('That URL has no host.', 400);
  if (v4(host) || v6(host)) {
    if (isPrivateAddress(host)) throw new FetchPageError('Private and local addresses cannot be read.', 400);
  } else if (!host.includes('.') || BLOCKED_SUFFIX.test(host)) {
    throw new FetchPageError('Private and local hosts cannot be read.', 400);
  }
  return u;
}

/** DNS over HTTPS (Cloudflare, JSON API): every A and AAAA answer of a name. */
export const dohResolver =
  (fetchImpl: typeof fetch = fetch): Resolver =>
  async (host, signal) => {
    const out: string[] = [];
    for (const type of ['A', 'AAAA'] as const) {
      const res = await fetchImpl(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`, { headers: { accept: 'application/dns-json' }, signal });
      if (!res.ok) throw new FetchPageError(`Could not resolve ${host}.`, 502);
      const body = (await res.json()) as { Answer?: { type: number; data: string }[] };
      for (const a of body.Answer ?? []) if (a.type === 1 || a.type === 28) out.push(a.data);
    }
    return out;
  };

/** Every address a name resolves to must be public (a DNS rebind to a private range is refused). */
export async function assertPublicHost(u: URL, resolve: Resolver | null, signal: AbortSignal): Promise<void> {
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!resolve || v4(host) || v6(host)) return;
  const ips = await resolve(host, signal);
  if (!ips.length) throw new FetchPageError(`${host} does not resolve.`, 502);
  if (ips.some(isPrivateAddress)) throw new FetchPageError('That name points at a private address and cannot be read.', 400);
}

// ── HTML to text ─────────────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', copy: '©', reg: '®', trade: '™', middot: '·', bull: '•' };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1]!.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** HTML → readable text: drops scripts, styles and navigation chrome; keeps headings, paragraphs, list items, links. */
export function htmlToText(html: string): { title: string; text: string } {
  let h = String(html || '');
  const title = decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(h)?.[1] || '')
    .replace(/\s+/g, ' ')
    .trim();
  h = h.replace(/<!--[\s\S]*?-->/g, '').replace(/<head\b[\s\S]*?<\/head\s*>/i, '');
  for (const tag of ['script', 'style', 'noscript', 'svg', 'template', 'iframe', 'nav', 'footer', 'aside', 'form']) h = h.replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}\\s*>`, 'gi'), '\n');
  h = h.replace(/<header\b[^>]*role=["']banner["'][^>]*>[\s\S]*?<\/header\s*>/gi, '\n');
  h = h.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi, (_m, n: string, inner: string) => `\n\n${'#'.repeat(Number(n))} ${inner.replace(/<[^>]+>/g, ' ')}\n\n`);
  h = h.replace(/<li\b[^>]*>/gi, '\n- ').replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a\s*>/gi, (_m, href: string, inner: string) => {
    const t = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return t && /^https?:/.test(href) && t !== href ? `${t} (${href})` : t || '';
  });
  h = h
    .replace(/<(?:br|hr)\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|section|article|main|tr|blockquote|pre|ul|ol|dl|dd|dt|table|figure|figcaption|details|summary|td|th)\s*>/gi, '\n')
    .replace(/<(?:p|div|section|article|main|tr|blockquote|pre|table|figure)\b[^>]*>/gi, '\n');
  h = decodeEntities(h.replace(/<[^>]+>/g, ' '));
  return { title, text: h.replace(/[ \t\r\f\v]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim() };
}

// ── the fetch ────────────────────────────────────────────────────────────────────

export interface FetchPageOptions {
  maxChars?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  /** DNS check of each hop's name; null skips it (tests). Default: DNS over HTTPS. */
  resolve?: Resolver | null;
}

function charsetOf(contentType: string): string {
  return /charset=["']?([\w-]+)/i.exec(contentType)?.[1]?.toLowerCase() ?? 'utf-8';
}

function decode(bytes: Uint8Array, contentType: string): string {
  try {
    return new TextDecoder(charsetOf(contentType)).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

/** Read a public page as text. Throws FetchPageError with an owner-readable sentence. */
export async function fetchPage(rawUrl: string, opts: FetchPageOptions = {}): Promise<PageText> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const resolve = opts.resolve === undefined ? dohResolver(fetchImpl) : opts.resolve;
  const maxChars = Math.min(Math.max(Math.floor(Number(opts.maxChars) || 20_000), 1_000), 60_000);
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), FETCH_TIMEOUT_MS);
  const onAbort = () => deadline.abort();
  opts.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    let target = assertPublicUrl(rawUrl);
    let res: Response | null = null;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await assertPublicHost(target, resolve, deadline.signal);
      res = await fetchImpl(target.toString(), {
        redirect: 'manual',
        signal: deadline.signal,
        headers: { accept: 'text/html,text/plain,application/json,text/markdown;q=0.9,*/*;q=0.5', 'user-agent': USER_AGENT },
      });
      if (res.status < 300 || res.status >= 400) break;
      const loc = res.headers.get('location');
      if (!loc || hop === MAX_REDIRECTS) throw new FetchPageError(`The page kept redirecting (HTTP ${res.status}).`, 502);
      target = assertPublicUrl(new URL(loc, target).toString());
    }
    if (!res!.ok) throw new FetchPageError(`The site answered HTTP ${res!.status}.`, 502);
    const contentType = res!.headers.get('content-type') ?? '';
    if (!/text\/|json|xml|markdown/i.test(contentType)) throw new FetchPageError(`That is not a readable page (${contentType || 'unknown type'}).`, 415);
    const declared = Number(res!.headers.get('content-length') ?? 0);
    if (declared > FETCH_MAX_BYTES) throw new FetchPageError('That page is too large to read (over 2 MB).', 413);
    const reader = res!.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    let truncated = false;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (size + value.byteLength > FETCH_MAX_BYTES) {
          chunks.push(value.slice(0, FETCH_MAX_BYTES - size));
          size = FETCH_MAX_BYTES;
          truncated = true;
          await reader.cancel().catch(() => undefined);
          break;
        }
        chunks.push(value);
        size += value.byteLength;
      }
    }
    const bytes = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) {
      bytes.set(c, at);
      at += c.byteLength;
    }
    const raw = decode(bytes, contentType);
    let title = '';
    let text = raw;
    if (/html/i.test(contentType)) ({ title, text } = htmlToText(raw));
    else if (/json/i.test(contentType)) {
      try {
        text = JSON.stringify(JSON.parse(raw), null, 2);
      } catch {
        /* keep the raw text */
      }
    }
    if (text.length > maxChars) {
      text = `${text.slice(0, maxChars)}…`;
      truncated = true;
    }
    return { url: String(rawUrl), finalUrl: target.toString(), title, contentType, text, truncated };
  } catch (err) {
    if (err instanceof FetchPageError) throw err;
    if (deadline.signal.aborted && !opts.signal?.aborted) throw new FetchPageError('The page took too long to answer.', 504);
    throw new FetchPageError(`Could not read that page: ${err instanceof Error ? err.message : String(err)}`, 502);
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }
}
