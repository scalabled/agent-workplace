// Clip durations from the audio bytes (docs/dev/INC05-PLAN.md §3.5): the WAV header, or an MP3 frame scan that
// reads a Xing/Info or VBRI header when present. Pure; no decoding.
import type { Alignment } from '@headcount/protocol';

/** Duration of a PCM WAV from its `fmt ` and `data` chunks, or null when the header is not a WAV. */
export function wavDurationMs(bytes: ArrayBuffer): number | null {
  const v = new DataView(bytes);
  if (bytes.byteLength < 12 || tag(v, 0) !== 'RIFF' || tag(v, 8) !== 'WAVE') return null;
  let byteRate = 0;
  let dataSize: number | null = null;
  let off = 12;
  while (off + 8 <= bytes.byteLength) {
    const id = tag(v, off);
    const size = v.getUint32(off + 4, true);
    if (id === 'fmt ' && off + 16 <= bytes.byteLength) byteRate = v.getUint32(off + 16, true);
    if (id === 'data') {
      // Streaming encoders write 0 or 0xFFFFFFFF: then the data runs to the end of the file.
      dataSize = size === 0 || size === 0xffffffff ? bytes.byteLength - off - 8 : Math.min(size, bytes.byteLength - off - 8);
      break;
    }
    off += 8 + size + (size % 2);
  }
  if (!byteRate || dataSize === null) return null;
  return Math.round((dataSize / byteRate) * 1000);
}

const BITRATES: Record<string, readonly number[]> = {
  // [version][layer]: kbps by index 0–14 (index 0 = free format, unsupported).
  '1-1': [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  '1-2': [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  '1-3': [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  '2-1': [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  '2-2': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  '2-3': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const SAMPLE_RATES: Record<string, readonly number[]> = { '1': [44100, 48000, 32000], '2': [22050, 24000, 16000], '2.5': [11025, 12000, 8000] };

interface Mp3Frame {
  version: '1' | '2' | '2.5';
  layer: 1 | 2 | 3;
  sampleRate: number;
  samples: number;
  length: number;
  mono: boolean;
}

function frameAt(v: DataView, off: number): Mp3Frame | null {
  if (off + 4 > v.byteLength) return null;
  const h = v.getUint32(off);
  if ((h & 0xffe00000) >>> 0 !== 0xffe00000) return null;
  const versionBits = (h >>> 19) & 3;
  const layerBits = (h >>> 17) & 3;
  const bitrateIndex = (h >>> 12) & 15;
  const rateIndex = (h >>> 10) & 3;
  if (versionBits === 1 || layerBits === 0 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) return null;
  const version = versionBits === 3 ? '1' : versionBits === 2 ? '2' : '2.5';
  const layer = (4 - layerBits) as 1 | 2 | 3;
  const padding = (h >>> 9) & 1;
  const mono = ((h >>> 6) & 3) === 3;
  const kbps = BITRATES[`${version === '1' ? '1' : '2'}-${layer}`]![bitrateIndex]!;
  const sampleRate = SAMPLE_RATES[version]![rateIndex]!;
  const bitrate = kbps * 1000;
  let samples: number;
  let length: number;
  if (layer === 1) {
    samples = 384;
    length = (Math.floor((12 * bitrate) / sampleRate) + padding) * 4;
  } else if (layer === 2 || version === '1') {
    samples = 1152;
    length = Math.floor((144 * bitrate) / sampleRate) + padding;
  } else {
    samples = 576;
    length = Math.floor((72 * bitrate) / sampleRate) + padding;
  }
  return length > 4 ? { version, layer, sampleRate, samples, length, mono } : null;
}

/** Skip an ID3v2 tag (syncsafe size) at the start of the file. */
function id3Skip(v: DataView): number {
  if (v.byteLength < 10 || tag(v, 0, 3) !== 'ID3') return 0;
  const size = ((v.getUint8(6) & 0x7f) << 21) | ((v.getUint8(7) & 0x7f) << 14) | ((v.getUint8(8) & 0x7f) << 7) | (v.getUint8(9) & 0x7f);
  const footer = v.getUint8(5) & 0x10 ? 10 : 0;
  return 10 + size + footer;
}

/**
 * Duration of an MP3: frame count from a Xing/Info or VBRI header when present, else a walk over every frame.
 * Null when no frame sync is found.
 */
export function mp3DurationMs(bytes: ArrayBuffer): number | null {
  const v = new DataView(bytes);
  let off = id3Skip(v);
  // Find the first frame whose successor (if any) also syncs: skips junk before the audio.
  let first: Mp3Frame | null = null;
  for (; off + 4 <= bytes.byteLength; off++) {
    const f = frameAt(v, off);
    if (!f) continue;
    const next = off + f.length;
    if (next + 4 <= bytes.byteLength && !frameAt(v, next)) continue;
    first = f;
    break;
  }
  if (!first) return null;
  // Xing / Info: after the side information of the first frame.
  const side = first.version === '1' ? (first.mono ? 17 : 32) : first.mono ? 9 : 17;
  const xing = off + 4 + side;
  if (xing + 12 <= bytes.byteLength) {
    const t = tag(v, xing);
    if (t === 'Xing' || t === 'Info') {
      const flags = v.getUint32(xing + 4);
      if (flags & 1) {
        const frames = v.getUint32(xing + 8);
        if (frames > 0) return Math.round((frames * first.samples * 1000) / first.sampleRate);
      }
    }
  }
  // VBRI (Fraunhofer): 32 bytes after the header; frames at +14.
  const vbri = off + 4 + 32;
  if (vbri + 18 <= bytes.byteLength && tag(v, vbri) === 'VBRI') {
    const frames = v.getUint32(vbri + 14);
    if (frames > 0) return Math.round((frames * first.samples * 1000) / first.sampleRate);
  }
  let samplesMs = 0;
  let count = 0;
  while (off + 4 <= bytes.byteLength) {
    const f = frameAt(v, off);
    if (!f) break;
    samplesMs += (f.samples * 1000) / f.sampleRate;
    count++;
    off += f.length;
  }
  return count ? Math.round(samplesMs) : null;
}

/**
 * A clip's duration: the provider's own number, else the WAV header or an MP3 frame scan, else the alignment's last
 * character end + 120 ms, else a text estimate (65 ms a character, at least 400 ms).
 */
export function clipDurationMs(opts: { bytes: ArrayBuffer; mime: string; providerMs?: number | undefined; alignment?: Alignment | null; text?: string }): number {
  if (typeof opts.providerMs === 'number' && Number.isFinite(opts.providerMs) && opts.providerMs > 0) return Math.round(opts.providerMs);
  const mime = opts.mime.toLowerCase();
  const fromBytes = mime.includes('wav') ? wavDurationMs(opts.bytes) : mime.includes('mpeg') || mime.includes('mp3') ? mp3DurationMs(opts.bytes) : (wavDurationMs(opts.bytes) ?? mp3DurationMs(opts.bytes));
  if (fromBytes && fromBytes > 0) return fromBytes;
  const ends = opts.alignment?.endsMs;
  if (ends?.length) return Math.round(ends[ends.length - 1]! + 120);
  return Math.max(400, Math.round((opts.text?.length ?? 0) * 65));
}

/** `mp3` or `wav` for a TTS mime type (other types are stored as `mp3` only when they are MPEG audio). */
export function clipExtension(mime: string): 'mp3' | 'wav' {
  return /wav|wave/i.test(mime) ? 'wav' : 'mp3';
}

function tag(v: DataView, off: number, len = 4): string {
  let s = '';
  for (let i = 0; i < len && off + i < v.byteLength; i++) s += String.fromCharCode(v.getUint8(off + i));
  return s;
}
