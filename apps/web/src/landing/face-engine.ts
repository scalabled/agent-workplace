// The landing page's face engine: its own lazy chunk (the avatar package), loaded only when a face scrolls near
// the viewport. The wall and the carousel animate more tiles than the app does (idle blinks and sway), and never
// run landmark detection (MediaPipe): a portrait without stored landmarks is shown still.
import { configureFaceScheduler, FaceView } from '@headcount/avatar';
import type { Appearance } from '@headcount/catalog';
import type { FaceTier } from '@headcount/protocol';

export type { FaceView };

/** Faces animating at once on the landing (the app's default is 3). */
const LANDING_ANIMATED_TILES = 10;
const APP_ANIMATED_TILES = 3;

let tuned = false;

export interface LandingFaceSubject {
  id: string;
  name: string;
  accent: string;
  appearance: Appearance;
}

export function createLandingFace(host: HTMLElement, subject: LandingFaceSubject, tier: FaceTier, opts: { label?: string; chrome?: boolean } = {}): FaceView {
  if (!tuned) {
    configureFaceScheduler({ maxAnimatedTiles: LANDING_ANIMATED_TILES });
    tuned = true;
  }
  const view = new FaceView({ tier, name: subject.name, detectLandmarks: false, chrome: opts.chrome ?? false, ...(opts.label ? { label: opts.label } : {}) });
  view.setAppearanceFallback({ appearance: subject.appearance, accent: subject.accent, name: subject.name });
  view.setState('idle');
  view.mount(host);
  return view;
}

/** Back to the app's budget when the landing unmounts. */
export function releaseScheduler(): void {
  if (!tuned) return;
  configureFaceScheduler({ maxAnimatedTiles: APP_ANIMATED_TILES });
  tuned = false;
}
