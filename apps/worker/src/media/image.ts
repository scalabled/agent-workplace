// Image bytes and portrait prompts for the portrait routes.
import { PORTRAIT_MAX_BYTES } from '@headcount/protocol/ext/media';

export type PortraitMime = 'image/png' | 'image/jpeg' | 'image/webp';

export const EXT_BY_MIME: Readonly<Record<PortraitMime, 'png' | 'jpg' | 'webp'>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

export class ImageError extends Error {
  constructor(
    readonly reason: 'invalid' | 'too_large' | 'empty',
    message: string,
  ) {
    super(message);
    this.name = 'ImageError';
  }
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to));

/** The image type from its magic bytes, or null when it is not PNG, JPEG or WebP. */
export function sniffImageMime(bytes: Uint8Array): PortraitMime | null {
  if (bytes.length >= 8 && PNG_SIGNATURE.every((v, i) => bytes[i] === v)) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

export interface DecodedImage {
  bytes: Uint8Array;
  mime: PortraitMime;
  ext: 'png' | 'jpg' | 'webp';
}

// Ported from personagram-ai/src/worker/content.ts (decodeImage): PNG/JPEG/WebP only, ≤5 MB, magic bytes checked.
/**
 * Validate image bytes (or a `data:image/…;base64,` URL, where the declared type must match the bytes).
 * Raw bytes are typed by their magic bytes, so a provider's wrong Content-Type cannot smuggle anything else in.
 */
export function decodeImage(input: ArrayBuffer | Uint8Array | string, maxBytes = PORTRAIT_MAX_BYTES): DecodedImage {
  let bytes: Uint8Array;
  let declared: PortraitMime | null = null;
  if (typeof input === 'string') {
    const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(input);
    if (!match) throw new ImageError('invalid', 'Use a PNG, JPEG or WebP image.');
    declared = match[1] as PortraitMime;
    // base64 → at most 3/4 of its length; refuse before decoding anything huge.
    if (Math.floor((match[2]!.length * 3) / 4) > maxBytes + 2) throw new ImageError('too_large', `Choose an image under ${formatMb(maxBytes)}.`);
    bytes = fromBase64(match[2]!);
  } else bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length === 0) throw new ImageError('empty', 'The image is empty.');
  if (bytes.length > maxBytes) throw new ImageError('too_large', `Choose an image under ${formatMb(maxBytes)}.`);
  const mime = sniffImageMime(bytes);
  if (!mime || (declared && declared !== mime)) throw new ImageError('invalid', 'The file is not a valid PNG, JPEG or WebP image.');
  return { bytes, mime, ext: EXT_BY_MIME[mime] };
}

function formatMb(n: number): string {
  return `${Math.round(n / 100_000) / 10} MB`;
}

// Ported from personagram-ai/src/worker/content.ts (base64): chunked so large buffers do not overflow the call stack.
export function toBase64(input: ArrayBuffer | Uint8Array): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let str = '';
  for (let i = 0; i < bytes.length; i += 8192) str += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(str);
}

export function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ── portrait prompts ────────────────────────────────────────────────────────────

// Ported from personagram-ai/src/worker/content.ts (saveImage): the warpable portrait prefix. The strip-warp
// renderer needs one adult, facing the camera, face unobstructed, lips relaxed and closed (ARCHITECTURE §9.1).
export const WARPABLE_PREFIX =
  'A single adult, front-facing portrait, unobstructed face, relaxed closed lips, head and shoulders, natural facial proportions, no text.';

export const PORTRAIT_PROMPT_MAX_CHARS = 4000;

/** The catalog's portrait_prompt with the warpable prefix guaranteed, whitespace collapsed and length capped. */
export function warpablePrompt(portraitPrompt: string): string {
  const text = portraitPrompt.replace(/\s+/g, ' ').trim();
  const body = text.toLowerCase().startsWith(WARPABLE_PREFIX.toLowerCase()) ? text : `${WARPABLE_PREFIX} ${text}`.trim();
  return body.slice(0, PORTRAIT_PROMPT_MAX_CHARS);
}

/** Short stable hash of a prompt (sha-256, first 16 hex chars). */
export async function promptHash(prompt: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(prompt));
  return [...new Uint8Array(digest)]
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
