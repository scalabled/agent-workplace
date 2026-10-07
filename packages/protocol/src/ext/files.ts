// Files: what the office makes beyond text (Phase 4). Images and short videos made from a description, by the owner
// on the Files page or by the Chief of Staff and coworkers as part of their work, kept per organization. Documents
// (project deliverables), apps and pages (the canvas) and what the owner shared (Memory) are listed beside them on the
// Files page; any Markdown document downloads as Word, Excel or PowerPoint (POST /api/export).

export type FileKind = 'image' | 'video';
export type FileStatus = 'working' | 'ready' | 'failed';
export const IMAGE_ASPECTS = ['1:1', '16:9', '4:3', '3:4'] as const;
export type ImageAspect = (typeof IMAGE_ASPECTS)[number];
export const VIDEO_ASPECTS = ['16:9', '9:16', '1:1', '4:3', '3:4'] as const;
export type VideoAspect = (typeof VIDEO_ASPECTS)[number];
export const VIDEO_SECONDS_MAX = 15;
export const FILE_PROMPT_MAX = 1500;
/** `fil_` and 20 lowercase hex characters, then the extension (`fil_….png`): the URL says what it is. */
export const FILE_NAME_RE = /^fil_[a-f0-9]{20}\.(png|jpg|webp|svg|mp4)$/;

export interface FileView {
  fileId: string;
  kind: FileKind;
  /** A short title (from the description). */
  title: string;
  prompt: string;
  status: FileStatus;
  /** Ready: where it is served (`/api/files/fil_….png`); images and videos embed it in Markdown as ![title](url). */
  url?: string;
  mime?: string;
  bytes?: number;
  aspect?: string;
  /** Videos: their length in seconds. */
  seconds?: number;
  /** Who made it: 'owner', 'chief', or a coworker's persona id. */
  madeBy: string;
  /** Where it was made for: Talk, a project, or the Files page. */
  source?: { kind: 'talk' | 'project' | 'files' | 'desk'; ref?: string };
  createdAt: string;
  /** Failed: one sentence with its fix. */
  error?: string;
  /** Made by the placeholder (no image or video provider here); fine for trying things out. */
  placeholder?: boolean;
}

export interface FilesResponse {
  files: FileView[];
  /** What can be made here now (a provider is set up, or the placeholder in development). */
  can: { image: boolean; video: boolean };
}

/** POST /api/files/image and /api/files/video. */
export interface MakeImageRequest {
  prompt: string;
  aspect?: ImageAspect;
}
export interface MakeVideoRequest {
  prompt: string;
  aspect?: VideoAspect;
  seconds?: number;
}
export interface MakeFileResponse {
  file: FileView;
}

/** POST /api/export: a Markdown document as Word, Excel (its tables) or PowerPoint (a slide per section). */
export type ExportFormat = 'docx' | 'xlsx' | 'pptx' | 'md';
export const EXPORT_MARKDOWN_MAX = 400_000;
export interface ExportRequest {
  title: string;
  markdown: string;
  format: ExportFormat;
}

export interface FileFrameData {
  file: FileView;
}
