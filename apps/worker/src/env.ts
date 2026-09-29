import type { ProviderEnv } from '@headcount/models';
import type { ProjectDO } from './jobs/project-do';
import type { RoomDO } from './rooms/room-do';
import type { RunDO } from './runs/run-do';
import type { WorkspaceDO } from './workspace/workspace-do';

/** Worker bindings and vars (wrangler.jsonc) plus provider keys from .dev.vars. Integrator-owned. */
export interface Env extends ProviderEnv {
  WORKSPACE: DurableObjectNamespace<WorkspaceDO>;
  PROJECT: DurableObjectNamespace<ProjectDO>;
  ROOM: DurableObjectNamespace<RoomDO>;
  RUN: DurableObjectNamespace<RunDO>;
  DB: D1Database;
  BLOBS: R2Bucket;
  /** Single-owner local mode: "local". */
  WORKSPACE_ID: string;
  APP_VERSION?: string;
  /** "true": Mock TTS/STT answer (and count as available) instead of 503 naming the keys. Tests and demos only. */
  MOCK_MEDIA?: string;
  /** Paid portrait generations allowed per UTC day (default 200). */
  PORTRAIT_DAILY_LIMIT?: string;
  /** Per-UTC-day caps (see src/lib/limits.ts): spoken sentences, recordings, Chief of Staff turns, new jobs. */
  TTS_DAILY_LIMIT?: string;
  STT_DAILY_LIMIT?: string;
  CHAT_DAILY_LIMIT?: string;
  JOB_DAILY_LIMIT?: string;
  /** Background jobs that may run at once (default 3). */
  MAX_ACTIVE_JOBS?: string;
  /** Comma-separated origins allowed to call the API and open the feed (scripts/dev.mjs passes the dev ports). */
  ALLOWED_ORIGINS?: string;
  /** Inc 0.5 living workforce (src/expr/config.ts): expression clip renders per UTC day (runtime + pre-voice; default 600). */
  EXPR_CLIP_DAILY_LIMIT?: string;
  /** Runtime clip renders (POST /api/expr/render) per minute (default 30). */
  EXPR_RENDER_PER_MIN?: string;
  /** Default and ceiling (600) of clips one pre-voice run renders (default 300). */
  EXPR_PREVOICE_MAX_CLIPS?: string;
  /** Sign-in (src/auth/auth.ts): "google" requires a session everywhere; unset/"off" leaves only loopback hosts open. */
  AUTH_MODE?: string;
  /** Exact public origin (no trailing slash) used for the OAuth redirect, e.g. https://headcount.example.workers.dev. */
  APP_ORIGIN?: string;
  /** Google OAuth web client id (public) and secret (a Worker secret). */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** Allowlist of Google emails that may sign in (comma-separated). Empty: nobody. A Worker secret. */
  OWNER_EMAILS?: string;
  /** "true" enables tooling-only routes (POST /api/media/image). Off when deployed. */
  ENABLE_MEDIA_TOOLS?: string;
}
