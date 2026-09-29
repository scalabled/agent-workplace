// @headcount/avatar — faces (owned by the `avatar` builder).
// FaceView (portrait strip warp or illustrated fallback, one shared scheduler) and landmark detection
// (MediaPipe 0.10.35, lazy). Faces draw whatever a MouthSampler reports; lip sync lives in packages/audio.
export * from './types';
export { FaceView, PORTRAIT_MAX_SIDE, resetLandmarkCache } from './face-view';
export { VISEMES, REST_PARAMS, paramsToMouth, sampleToParams } from './visemes';
export {
  detectLandmarks,
  landmarksFromMesh,
  configureLandmarks,
  landmarkerConfig,
  preloadLandmarker,
  isLandmarkerReady,
  DEFAULT_LANDMARKER_CONFIG,
  LandmarkerUnavailableError,
} from './landmarks';
export type { LandmarkerConfig, FaceMeshDetector, DetectorFactory } from './landmarks';
export { FaceScheduler, faceScheduler, configureFaceScheduler, setFaceScheduler } from './scheduler';
export type { FaceHandle, FaceSchedulerOptions, ScheduledFace, SchedulerStats } from './scheduler';
export { EXPRESSION_HOLD_MS, FaceMotion, PALETTE_PRESETS, STATE_POSES, STILL_POSE, gestureDurationMs, sanitizeCue } from './motion';
export type { FacePose } from './motion';
export { PortraitRenderer, DEFAULT_MAX_SIDE } from './portrait-renderer';
export type { PortraitRendererOptions, PortraitSourceImage, ViewTransform } from './portrait-renderer';
export { ProceduralRenderer, DESIGN_W, DESIGN_H } from './procedural-renderer';
export { lookFromAppearance, placeholderLook, parseColors, skinFrom } from './look';
export type { ProceduralStyle, HairShape } from './look';
