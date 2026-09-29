import { encodeWav, silentWav } from '@headcount/models';
import { describe, expect, it } from 'vitest';
import { clipDurationMs, clipExtension, mp3DurationMs, wavDurationMs } from './audio-meta';

/** MPEG-1 Layer III, 128 kbps, 44.1 kHz, stereo, no padding: 417-byte frames of 1152 samples. */
function mp3Frames(n: number, opts: { id3?: boolean; xingFrames?: number; vbriFrames?: number } = {}): ArrayBuffer {
  const frame = 417;
  const header = [0xff, 0xfb, 0x90, 0x00];
  const id3 = opts.id3 ? [0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 20, ...new Array(20).fill(0)] : [];
  const bytes = new Uint8Array(id3.length + n * frame);
  bytes.set(id3, 0);
  for (let i = 0; i < n; i++) bytes.set(header, id3.length + i * frame);
  const first = id3.length;
  const put32 = (at: number, v: number) => new DataView(bytes.buffer).setUint32(at, v);
  if (opts.xingFrames !== undefined) {
    bytes.set([0x58, 0x69, 0x6e, 0x67], first + 4 + 32); // "Xing" after 32 bytes of stereo side info
    put32(first + 4 + 32 + 4, 1); // flags: frames present
    put32(first + 4 + 32 + 8, opts.xingFrames);
  }
  if (opts.vbriFrames !== undefined) {
    bytes.set([0x56, 0x42, 0x52, 0x49], first + 4 + 32); // "VBRI"
    put32(first + 4 + 32 + 14, opts.vbriFrames);
  }
  return bytes.buffer;
}

describe('clip durations (§3.5)', () => {
  it('reads a WAV header', () => {
    expect(wavDurationMs(silentWav(1234))).toBe(1234);
    expect(wavDurationMs(encodeWav(new Float32Array(48_000), 48_000))).toBe(1000);
    expect(wavDurationMs(new ArrayBuffer(8))).toBeNull();
  });

  it('scans MP3 frames, skipping an ID3 tag', () => {
    expect(mp3DurationMs(mp3Frames(10))).toBe(Math.round((10 * 1152 * 1000) / 44100));
    expect(mp3DurationMs(mp3Frames(38, { id3: true }))).toBe(Math.round((38 * 1152 * 1000) / 44100));
    expect(mp3DurationMs(new Uint8Array([1, 2, 3, 4, 5]).buffer)).toBeNull();
  });

  it('prefers the Xing / Info and VBRI frame counts', () => {
    expect(mp3DurationMs(mp3Frames(3, { xingFrames: 100 }))).toBe(Math.round((100 * 1152 * 1000) / 44100));
    expect(mp3DurationMs(mp3Frames(3, { vbriFrames: 50 }))).toBe(Math.round((50 * 1152 * 1000) / 44100));
  });

  it('falls back to the provider, then the alignment, then the text', () => {
    expect(clipDurationMs({ bytes: new ArrayBuffer(4), mime: 'audio/mpeg', providerMs: 777 })).toBe(777);
    expect(clipDurationMs({ bytes: silentWav(500), mime: 'audio/wav' })).toBe(500);
    expect(clipDurationMs({ bytes: new ArrayBuffer(4), mime: 'audio/mpeg', alignment: { chars: ['a', 'b'], startsMs: [0, 100], endsMs: [100, 400] } })).toBe(520);
    expect(clipDurationMs({ bytes: new ArrayBuffer(4), mime: 'audio/mpeg', text: 'Hello there' })).toBe(715);
    expect([clipExtension('audio/wav'), clipExtension('audio/mpeg'), clipExtension('audio/x-wav')]).toEqual(['wav', 'mp3', 'wav']);
  });
});
