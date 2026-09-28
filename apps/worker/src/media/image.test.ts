import { describe, expect, it } from 'vitest';
import { ImageError, WARPABLE_PREFIX, decodeImage, fromBase64, promptHash, sniffImageMime, toBase64, warpablePrompt } from './image';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70]);
const WEBP = new Uint8Array([...new TextEncoder().encode('RIFF'), 36, 0, 0, 0, ...new TextEncoder().encode('WEBPVP8 ')]);
const GIF = new TextEncoder().encode('GIF89a......');
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');

describe('decodeImage (ported from PG content.ts)', () => {
  it('types images by magic bytes', () => {
    expect(sniffImageMime(PNG)).toBe('image/png');
    expect(sniffImageMime(JPEG)).toBe('image/jpeg');
    expect(sniffImageMime(WEBP)).toBe('image/webp');
    expect(sniffImageMime(GIF)).toBeNull();
    expect(sniffImageMime(SVG)).toBeNull();
    expect(sniffImageMime(PNG.subarray(0, 4))).toBeNull();
  });

  it('accepts PNG/JPEG/WebP bytes and names the extension', () => {
    expect(decodeImage(PNG)).toMatchObject({ mime: 'image/png', ext: 'png' });
    expect(decodeImage(JPEG.buffer)).toMatchObject({ mime: 'image/jpeg', ext: 'jpg' });
    expect(decodeImage(WEBP)).toMatchObject({ mime: 'image/webp', ext: 'webp' });
  });

  it('rejects other formats, empty and oversized images', () => {
    expect(() => decodeImage(GIF)).toThrow(ImageError);
    expect(() => decodeImage(SVG)).toThrow(/not a valid PNG, JPEG or WebP/);
    expect(() => decodeImage(new Uint8Array())).toThrow(/empty/);
    const big = new Uint8Array(5_000_001);
    big.set(PNG);
    expect(() => decodeImage(big)).toThrow(/under 5 MB/);
    expect(() => decodeImage(PNG, 8)).toThrow(ImageError);
  });

  it('checks a data URL against its declared type (PG semantics)', () => {
    expect(decodeImage(`data:image/png;base64,${toBase64(PNG)}`).mime).toBe('image/png');
    expect(() => decodeImage(`data:image/jpeg;base64,${toBase64(PNG)}`)).toThrow(ImageError);
    expect(() => decodeImage(`data:image/gif;base64,${toBase64(GIF)}`)).toThrow(/PNG, JPEG or WebP/);
    expect(() => decodeImage('not a data url')).toThrow(ImageError);
  });

  it('round-trips base64 for large buffers', () => {
    const bytes = new Uint8Array(100_000).map((_, i) => (i * 31) % 256);
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
  });
});

describe('warpablePrompt', () => {
  it('keeps catalog prompts that already carry the warpable prefix', () => {
    const p = `${WARPABLE_PREFIX} A calm woman in a navy suit.`;
    expect(warpablePrompt(p)).toBe(p);
  });
  it('adds the prefix when missing, collapses whitespace and caps length', () => {
    expect(warpablePrompt('  A man\n in an  olive jacket. ')).toBe(`${WARPABLE_PREFIX} A man in an olive jacket.`);
    expect(warpablePrompt('x'.repeat(10_000)).length).toBe(4000);
  });
  it('hashes prompts stably', async () => {
    expect(await promptHash('a')).toBe(await promptHash('a'));
    expect(await promptHash('a')).toMatch(/^[0-9a-f]{16}$/);
    expect(await promptHash('a')).not.toBe(await promptHash('b'));
  });
});
