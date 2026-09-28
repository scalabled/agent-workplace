// "Generate portrait" (only offered when an image provider is configured): POST generate, wait for the
// image to appear, detect its landmarks once in the browser (avatar.detectLandmarks) and PUT them, so
// every face after that warps the portrait without detecting again.
import { signal } from '@preact/signals';
import { detectLandmarks } from '@headcount/avatar';
import { api } from '../api/client';
import { errorSentence } from '../talk/actions';
import { refreshPortrait } from './portraits';

export type PaintState = { status: 'painting' } | { status: 'failed'; message: string };

/** Per persona/lead id while a portrait is being painted. */
export const painting = signal<Record<string, PaintState>>({});

const POLL_MS = 4000;
const GIVE_UP_MS = 4 * 60_000;

function set(id: string, state: PaintState | null) {
  const next = { ...painting.value };
  if (state) next[id] = state;
  else delete next[id];
  painting.value = next;
}

async function waitForPortrait(id: string): Promise<{ blob: Blob; version: string | null }> {
  const started = Date.now();
  for (;;) {
    const image = await api.portraitImage(id).catch(() => null);
    if (image) return image;
    if (Date.now() - started > GIVE_UP_MS) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

/** Landmarks for a fresh portrait; a failure is fine (the face then detects on first show). */
async function storeLandmarks(id: string, blob: Blob, version: string | null): Promise<void> {
  if (typeof createImageBitmap !== 'function') return;
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(blob);
    const landmarks = await detectLandmarks(bitmap);
    if (landmarks) await api.putLandmarks(id, landmarks, version).catch(() => undefined); // 409: someone was first, or the image changed
  } catch {
    /* landmarker unavailable: FaceView falls back to detecting, or a still portrait */
  } finally {
    bitmap?.close();
  }
}

export async function generatePortrait(id: string): Promise<void> {
  if (painting.value[id]?.status === 'painting') return;
  set(id, { status: 'painting' });
  try {
    await api.generatePortrait(id);
    const image = await waitForPortrait(id);
    await storeLandmarks(id, image.blob, image.version);
    set(id, null);
    refreshPortrait(id);
  } catch (err) {
    set(id, { status: 'failed', message: err instanceof Error && err.message === 'timeout' ? 'The portrait is taking too long. Try again later.' : errorSentence(err) });
  }
}
