// Pictures for Talk (Inc 4 vision): a snapshot of a screen, window or tab the owner picks, a photo from the camera,
// and big photos made small enough to share. Each becomes a JPEG file, shared like any other file.

/** Longest side of a shared picture: plenty for reading a receipt or a screen. */
const MAX_SIDE = 2048;
/** Photos over this are re-encoded (the server takes up to 5 MB). */
const SHRINK_OVER = 3 * 1024 * 1024;

export const canSnapScreen = (): boolean => typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getDisplayMedia === 'function';
export const canUseCamera = (): boolean => typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function';

/** "2026-09-29 14.05", for a snapshot's name. */
export function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}`;
}

/** Ask for a screen, window or tab, take one frame, and let go of it at once. Null when they cancel. */
export async function snapScreen(): Promise<File | null> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  } catch {
    return null;
  }
  try {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play();
    // The first frame can be blank while the capture warms up.
    await new Promise((r) => setTimeout(r, 300));
    return await frameToFile(video, `Screen ${stamp()}.jpg`);
  } finally {
    for (const t of stream.getTracks()) t.stop();
  }
}

/** The frame a video shows now, as a JPEG file. */
export function frameToFile(video: HTMLVideoElement, name: string): Promise<File> {
  return drawToFile(video, video.videoWidth, video.videoHeight, name);
}

/** A big photo (a phone camera's) re-encoded as a smaller JPEG; anything else is returned as it is. */
export async function shrinkImage(file: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size <= SHRINK_OVER || typeof createImageBitmap !== 'function') return file;
  try {
    const bmp = await createImageBitmap(file);
    const out = await drawToFile(bmp, bmp.width, bmp.height, file.name.replace(/\.\w+$/, '') + '.jpg');
    bmp.close();
    return out.size < file.size ? out : file;
  } catch {
    return file;
  }
}

async function drawToFile(src: CanvasImageSource, w: number, h: number, name: string): Promise<File> {
  if (!w || !h) throw new Error('Nothing to capture yet.');
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext('2d')!.drawImage(src, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
  if (!blob) throw new Error('The picture could not be made.');
  return new File([blob], name, { type: 'image/jpeg' });
}
