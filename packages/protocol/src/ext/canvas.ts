// The canvas (personagram-ai parity: experiences on an avatar's canvas): the Chief of Staff (or the owner directly)
// has an interactive HTML app or a Markdown document built from a brief. An app is written as one self-contained page
// (a quick first version that plays within seconds while the full one is written); a document is Markdown. Both are
// served sandboxed, downloaded as HTML, and exported to PDF through the browser's print. Builds run on their own; the
// page asks how they are going.

export type CanvasKind = 'app' | 'document';
export type CanvasStatus = 'queued' | 'building' | 'ready' | 'failed';

export interface CanvasSnapshot {
  canvasId: string;
  title: string;
  brief: string;
  kind: CanvasKind;
  status: CanvasStatus;
  /** The version this one revises or fixes. */
  basedOn?: string;
  /** Who asked: the owner (from the Canvas page) or the Chief of Staff (in Talk). */
  by: 'owner' | 'chief';
  /** Lines of the page (apps) or of the Markdown (documents). */
  lines: number;
  /** Documents: words. */
  words?: number;
  bytes: number;
  /** While an app builds: the lines of its quick first version, once there is one to play. */
  previewLines?: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CanvasProgress {
  lines: number;
  chars: number;
  /** The last lines written, to watch it being made. */
  tail: string;
  phase: 'sketching' | 'writing' | 'expanding';
}

export interface CanvasListResponse {
  canvases: CanvasSnapshot[];
}

/** GET /api/canvas/:id: the canvas, and how its build is going while it builds. */
export interface CanvasResponse {
  canvas: CanvasSnapshot;
  progress?: CanvasProgress;
}

export const CANVAS_BRIEF_MAX = 4000;

/** POST /api/canvas: something new. */
export interface CanvasCreate {
  brief: string;
  title?: string;
  kind?: CanvasKind;
}

/** POST /api/canvas/:id/revise: a new version of this one, changed as the brief says. */
export interface CanvasRevise {
  brief: string;
}

/** POST /api/canvas/:id/repair: the errors the app threw in the owner's browser (data; a fix is built from them). */
export interface CanvasRepair {
  errors: string[];
}

/** Frame data: a canvas was queued, started, finished or failed. Persisted. */
export interface CanvasFrameData {
  canvas: CanvasSnapshot;
}

/** The message an app on the canvas posts to its page with what went wrong (the error reporter). */
export const CANVAS_REPORT_TYPE = 'hc-canvas';
