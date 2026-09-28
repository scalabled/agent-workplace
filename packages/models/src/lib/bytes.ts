// Binary helpers that work the same in Workers, browsers and Node (no Buffer).

export function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const clean = b64.replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
  const bin = atob(clean);
  const buffer = new ArrayBuffer(bin.length);
  const out = new Uint8Array(buffer);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return buffer;
}

export function bytesToBase64(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function dataUrl(data: ArrayBuffer, mime: string): string {
  return `data:${mime};base64,${bytesToBase64(data)}`;
}

/** Image type from magic bytes (providers do not always say). */
export function sniffImageMime(data: ArrayBuffer, fallback = 'image/png'): string {
  const b = new Uint8Array(data, 0, Math.min(12, data.byteLength));
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  return fallback;
}

/** File extension for an audio mime (STT uploads need a plausible filename). */
export function audioExtension(mime: string): string {
  const m = mime.toLowerCase().split(';')[0]!.trim();
  const map: Record<string, string> = {
    'audio/webm': 'webm',
    'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/mp4': 'm4a',
    'audio/m4a': 'm4a',
    'audio/x-m4a': 'm4a',
    'audio/aac': 'aac',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/wave': 'wav',
    'audio/flac': 'flac',
    'video/webm': 'webm',
  };
  return map[m] ?? 'webm';
}

/** Mime for a TTS format. */
export function audioMime(format: 'mp3' | 'wav' | 'pcm16' | undefined): string {
  if (format === 'wav') return 'audio/wav';
  if (format === 'pcm16') return 'audio/pcm;rate=24000';
  return 'audio/mpeg';
}
