# Headcount · Increment 0 contracts

These are the contracts of **Inc 0 "First Light"** (docs/MVP-PLAN.md), as built and integrated. Every package
and route below is implemented; `docs/dev/INC0.md` says what works, how to run it and the demo script. For later
increments, builders still work **inside their own directories** and code against these contracts. If a contract
has to change, ask the integrator; do not edit someone else's files.

Binding inputs: `docs/OWNER-DIRECTIVES.md` (D2 communication first, D3 minimal sleek UI), `docs/PRODUCT.md` §4
(vocabulary), `docs/ARCHITECTURE.md` §2–4, §12, §16, `docs/EXPERIENCE.md` §2, §4, §10.

---

## 1. Commands

| Command | What it does |
|---|---|
| `pnpm install` | Installs everything (all anticipated deps are already declared) and builds the catalog bundle (postinstall). |
| `pnpm dev` | `scripts/dev.mjs`: catalog bundle → local D1 migrations → `wrangler dev` on **:8787** + Vite on **:5173**, prefixed logs, catalog rebuild on change; Ctrl-C (or either process dying) stops both. Flags: `--mock` (every key blanked, Mock chat), `--local` (cloud keys blanked, Ollama kept: nothing leaves the machine), `--mock-media` (Mock TTS/STT answer and count as available), `--fresh`, `--worker-port`, `--web-port`, `--persist-to`, `--no-watch`. Fails fast if a port is taken. Each Vite port has its own dependency cache (`node_modules/.vite-<port>`), so several servers can run at once. |
| `pnpm test` | Vitest across all workspace projects (`vitest.config.ts` → `packages/*/vitest.config.ts`, `apps/*/vitest.config.ts`). One project: `pnpm vitest run --project worker`. |
| `pnpm typecheck` | `tsc --noEmit` per package (worker also checks its test program; web also checks its Vite config), then root configs + e2e. Every package pins `typescript ^7.0.2` as a devDependency, so it never picks up a global `tsc` (Inc 0.5's `packages/expressions` still needs the same line). |
| `pnpm e2e` | Playwright (Chromium with a fake mic and camera, mic permission granted, autoplay allowed) against two keyless stacks: project **chromium** on `dev.mjs --mock --fresh` (**:5183 / :8797**, state `.wrangler/e2e-state`) and project **voice** (`e2e/voice.spec.ts`) on `dev.mjs --mock --mock-media --fresh` (**:5184 / :8798**, `.wrangler/e2e-voice-state`). Keyless even when `.dev.vars` has keys (`--mock` blanks them; `--var` beats `.dev.vars`, verified). |
| `pnpm e2e:screens` | `HEADCOUNT_SCREENS=1` run of `e2e/screens.spec.ts`: writes `docs/dev/screens/inc0/<screen>-<desktop\|mobile>-<light\|dark>.png`. Opt-in, so normal runs never rewrite docs. |
| `pnpm build` | Catalog bundle, `vite build` (web), `wrangler deploy --dry-run --outdir dist` (worker bundle check). |
| `pnpm catalog:build` | Regenerates `packages/catalog/generated/*` (git-ignored). `--watch` to follow edits. |
| `pnpm portraits:generate` | Asks the running worker to generate portraits, one at a time with `[i/n]` progress: the 12 leads by default; `--all`, `--department <id>[,id]`, `--only <id,id>`, `--force`, `--dry-run`, `--worker <url>`. Checks capabilities first, skips existing portraits, and stops on 503 (naming the key), on 429 (daily limit) or after 3 failures in a row. Uses `?wait=1`. |

Browser pane: `.claude/launch.json` config **headcount** runs `pnpm dev` on port 5173.

## 2. Layout and ownership

Builders may edit **only** inside their directories. Additive shared types go in
`packages/protocol/src/ext/<builder>.ts` (see §4.9).

| Owner | Paths |
|---|---|
| **models** | `packages/models/**` |
| **worker-core** | `apps/worker/src/workspace/**`, `apps/worker/src/jobs/**`, `packages/agent-loop/**`, `apps/worker/migrations/0001_init.sql` |
| **media** | `apps/worker/src/media/**`, `apps/worker/migrations/0002_media.sql` (to create), `scripts/portraits-generate.mjs` |
| **avatar** | `packages/avatar/**` |
| **audio** | `packages/audio/**` |
| **web** | `apps/web/**` |
| **integrator** | Router `apps/worker/src/index.ts`, `apps/worker/src/env.ts`, `apps/worker/src/lib/**`, `apps/worker/src/rooms/**`, `apps/worker/src/runs/**`, `apps/worker/test/**` (fake cloud), `apps/worker/wrangler.jsonc`, `apps/worker/.dev.vars.example`, `packages/protocol/src/*.ts` (core), `packages/catalog/**`, root configs (`package.json`, `pnpm-workspace.yaml`, `tsconfig*.json`, `vitest.config.ts`, `playwright.config.ts`), `scripts/dev.mjs`, `e2e/**`, `.claude/launch.json`, this file |

Needs a new binding, var, route, frame type or dependency? Ask the integrator; it is a one-line change on their side.

```
apps/web/            Vite 8 + Preact + @preact/signals. Four places + Chief of Staff bubble.
apps/worker/         Worker router + WorkspaceDO / ProjectDO / RoomDO / RunDO, D1 (DB), R2 (BLOBS)
packages/protocol/   ids, streams, envelope, frames, presence, API types, route table, face + voice types
packages/models/     provider fabric: contracts, registry, Mock (keyless, deterministic, schema-aware)
packages/agent-loop/ runTurn(): one tool loop
packages/catalog/    typed loader over generated bundles (full → worker, slim → web)
packages/avatar/     FaceView (procedural fallback, portrait strip-warp, viseme driver, landmarks)
packages/audio/      AudioEngine (one AudioContext, speak/barge-in, push-to-talk, browser fallbacks)
catalog/             READ-ONLY here (finalised by another process); read it only through packages/catalog
reference/           READ-ONLY source material (MIT, same owner)
```

## 3. Conventions

- **TypeScript strict** everywhere (`tsconfig.base.json`: strict, `verbatimModuleSyntax` → use `import type`, `isolatedModules`, bundler resolution, extensionless relative imports). TypeScript **7.0** (native compiler).
- **No package builds.** Packages export TypeScript source (`"exports": {".": "./src/index.ts"}`); Vite, wrangler (esbuild) and Vitest consume it directly. Import packages by name (`@headcount/protocol`), never by relative path across packages.
- **Environment neutrality.** `packages/protocol` uses only ES2023 (no DOM, no Workers, no Node). `models` and `agent-loop` must compile under both DOM lib and `@cloudflare/workers-types` (they are type-checked inside the worker program). `avatar`, `audio` and `web` are browser-only.
- **Porting from reference/**: copy into your package, adapt to TypeScript, and add a one-line provenance comment at the top of the file or function, e.g. `// Ported from personagram-ai/src/web/avatar/viseme-driver.js`. Never import from `reference/`.
- **Secrets.** Provider keys exist only server-side in `apps/worker/.dev.vars` (owner-managed, git-ignored; the file now exists — never open it). Never send a key to the browser, never put one in a response, error, log line or frame. Errors name the missing **env var names** only (`missingKeys`). Never read `reference/**/.dev.vars`, `oncloudnine/config.json`, `kv-dev.json` or `demo-token.txt`.
- **Keyless first.** Everything works with the Mock provider (tests, e2e, demo) and with Ollama (`qwen3:32b` chat with tools, `nomic-embed-text`) when it is running. A capability without a provider is **hidden** in the UI, never shown broken.
- **Vocabulary** (PRODUCT §4, binding for UI copy): Chief of Staff, Coworker, Project / Everyday, Floor / Desk, Room, Raised hand / Inbox, Delegate. Never: assistant, bot, Righthand, Engagement. Copy voice (EXPERIENCE §10.8): plain, short, verb-first, no model names, no exclamation marks; a failure is one sentence with its fix.
- **UI** (D3): four places only — Talk · Floor · Projects · Inbox — plus the Chief of Staff bubble on every screen. Faces are the status UI. Typography first, generous whitespace, one accent per agent, subtle motion, light + dark. Tokens: `apps/web/src/styles/tokens.css`.
- **Tests.** Vitest, colocated `src/**/*.test.ts`. Worker tests run in Node with `apps/worker/test/fake-cloud.ts` (`createTestEnv()` gives in-process DOs over real SQLite via `node:sqlite`, migrated D1, in-memory R2; `cloudflare:workers` is aliased to a shim). WebSockets are covered by e2e.
- **Runtime versions.** Node ≥22, pnpm 10, Vite 8 (Rolldown/Oxc: use `oxc` options, not `esbuild`), Vitest 5, wrangler 4.143, `compatibility_date` **2026-09-01** (verified with the installed workerd: `wrangler dev` boots with no fallback warning), `nodejs_compat` on.
- **Catalog.** Never edit `catalog/`. The bundle builder skips unparsable files and incomplete records with a warning (`packages/catalog/generated/report.json`), so the app keeps working while the catalog is edited.

## 4. Contracts

### 4.1 Ids and streams — `packages/protocol/src/ids.ts`

| Id | Shape | Notes |
|---|---|---|
| `WorkspaceId` | `'local'` in Inc 0 | `DEFAULT_WORKSPACE_ID`; the worker uses `env.WORKSPACE_ID` |
| `ProjectId` | `'everyday' \| 'prj_…'` | `EVERYDAY_PROJECT_ID` |
| `JobId`, `TurnId`, `MessageId`, `SteerId` | `job_…`, `turn_…`, `msg_…`, `steer_…` | `ids.job()`, `ids.turn()`, … — prefix + lowercase ULID, time-sortable |
| `OpId` | string (client ULID) | `ids.op()`; idempotency key for commands |
| `AgentId` | `cw_…` | Chief of Staff is **`CHIEF_ID = 'cw_chief'`**; catalog coworkers are `coworkerAgentId(personaId)` = `cw_<personaId>` |
| `ActorId` | `AgentId \| 'owner' \| 'owner:<user>' \| 'system'` | |
| `StreamId` | `ws:<ws>`, `p:everyday:<ws>`, `p:prj_…`, `rm:…`, `run:…` | `workspaceStream()`, `projectStream()`; DO names via `doNames.*` |

### 4.2 Event envelope and frames — `packages/protocol/src/frames.ts`

```ts
interface FrameEnvelope<T> { v: 1; streamId: StreamId; seq?: number; after?: number; ts: string; type: T;
                             opId?: OpId; actor?: ActorId; cause?: { streamId; seq }; data: FrameDataMap[T] }
type Frame = discriminated union over FrameType   // switch (frame.type) narrows frame.data
```

- **Persisted** frames carry `seq` — gap-free per stream, assigned inside the writer's storage transaction.
- **Ephemeral** frames carry no `seq`; they carry `after` = the stream's last persisted seq when emitted.
- Build frames with `makeFrame(streamId, {type, data, opId?, actor?, cause?}, {seq} | {after})`; parse with `parseFrame(raw)`.
- Nothing faster than a sentence is persisted (deltas are ephemeral; `job.progress` is sentence-rate).

| Type | Persisted | Data | Producer → consumer |
|---|---|---|---|
| `ready` | no | `{workspaceId, streamId, lastSeq, replayFrom, serverTime}` | WorkspaceDO → client, first frame on every socket |
| `talk.owner` | yes | `{turnId, messageId, text, via: 'text'\|'voice'}` (+`opId`) | WorkspaceDO echoes the owner's message |
| `talk.delta` | no | `{turnId, messageId, agentId, delta}` | Chief of Staff streaming reply |
| `talk.message` | yes | `{turnId\|null, messageId, agentId, text, kind: 'reply'\|'announcement'\|'status', jobId?}` | Complete Chief of Staff message; `announcement` = proactive (job finished) |
| `talk.done` | yes | `{turnId, messageId\|null, finish: 'stop'\|'cancelled'\|'error'\|'length', route?, usage?}` | Turn over; `route` ∈ answer, delegate, status, steer, cancel |
| `job.started` | yes | `{job: JobSnapshot}` | Everyday ProjectDO (mirrored to the feed) |
| `job.progress` | yes | `{jobId, label, step, of, partial?}` | At each checkpoint; `label` is the Activity row's running sentence |
| `job.steered` | yes | `{jobId, steerId, text, status: 'queued'\|'applied'}` | Queued on request, applied at the next checkpoint |
| `job.done` | yes | `{jobId, summary, result (Markdown), finishedText}` | |
| `job.failed` | yes | `{jobId, code, message, retryable}` | |
| `job.cancelled` | yes | `{jobId, reason?}` | |
| `presence` | no | `PresenceData` (§4.3) | Server claims (thinking, working); `speaking` is client-local |
| `workspace.updated` | yes | `{settings: WorkspaceSettings}` | Settings changed (other tab) |
| `error` | no | `{code, message, opId?, turnId?, missingKeys?}` | A command or turn failed |

**Owner feed (Inc 0 simplification).** The client holds **one** socket: `GET /api/ws?since=<seq>` → WorkspaceDO,
stream `ws:<ws>`. It carries talk frames (talk runs in WorkspaceDO in Inc 0, not in a RoomDO) and **mirrors** the
Everyday ProjectDO's job frames: ProjectDO appends to its own ledger `p:everyday:<ws>` (authoritative job state) and
forwards each frame to WorkspaceDO, which re-sequences it into `ws:<ws>` with `cause = {streamId: 'p:everyday:<ws>', seq}`.
So a single `since` cursor is enough.

**Socket protocol.** On connect: `ready` → persisted frames with `seq > since` from the hot window (oldest first,
≤ `WS_REPLAY_LIMIT` = 500) → current presence snapshot → live. Client → server (`WsClientMessage`): `{op:'ping', t}`
(server replies `{op:'pong', t}`, not a frame) and `{op:'resume', since}`, which replays the next page. Commands go
over HTTP with an `opId`; the resulting frames carry that `opId`. The client keeps the highest applied `seq`, ignores
`seq <= lastSeq` (replay overlap) and reconnects with it (`apps/web/src/api/ws.ts`: backoff 500 ms × 2ⁿ up to 8 s,
ping every 25 s).

- **Paging.** While its cursor is below `ready.lastSeq`, the client asks for the next page (`resume`, 40 ms after a
  replay burst goes quiet, retried after 2 s) and **holds** newer live frames until the gap is filled, so a long
  history never leaves a hole. `feedCatchUp(readyLastSeq, clientLastSeq)` in `@headcount/protocol/ext/worker-core`
  is the decision. When `ready.lastSeq` is below the client's cursor, the server state was reset (`--fresh`): the
  client drops feed state and reconnects with `since=0`.
- **Replay is history, not news.** Frames at or below `ready.lastSeq` are applied with `live: false`: never spoken,
  never animated. Replayed `workspace.updated` frames are ignored (they hold every earlier version); current settings
  come from `GET /api/workspace`, and settings only move forward (newer `updatedAt` wins).
- **Turns stay contiguous.** A newer owner message cuts a still-streaming reply (barge-in): the partial
  `talk.message` and its `talk.done {finish:'cancelled'}` are appended **before** the new `talk.owner`.
- **Frame order in a turn:** `talk.owner` → presence `thinking` → `talk.delta`* (a `'\n\n'` separator between model
  steps is itself a delta, so concatenated deltas equal the final text) → `talk.message {kind:'reply'|'status', jobId?}`
  → `talk.done {finish, route, usage}`. A model that acted but said nothing gets the tool's sentence as
  `talk.message` with no deltas. Announcements: `talk.message {turnId:null, kind:'announcement', jobId, cause}`.
- **Mirrored job frames** keep their original `ts` and carry `cause {streamId:'p:everyday:<ws>', seq}`.
  `job.started` carries the full `JobSnapshot`; `job.progress` comes after the plan, after each step and when a
  finding is recorded (`{label, step, of, partial}`); `jobProgressPercent(job)` = `(step-1)/of` (done = 100). A steer
  applied between steps raises `of` by one and adds a step labelled `Looking into your note: “…”`.
- **Presence from the server** is only for `cw_chief`: `thinking` (talk), `working` (label = the job's running
  sentence, `(+N more)` when several), `idle` (label `Available`), each with `dwellMs`. `speaking`/`listening` are
  client-local.

### 4.3 Presence — `packages/protocol/src/presence.ts`

`PresenceState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'working' | 'raised_hand'`;
`PresenceData = {agentId, state, label, causeSeq: number|null, dwellMs?, badges?: ('hand'|'lamp')[], projectId?}`.
Merge order `PRESENCE_PRIORITY` (speaking > raised_hand > listening > thinking > working > idle), `mergePresence()`,
dwell minimums `PRESENCE_DWELL_MS` (thinking 600 ms, others 300 ms). **Mouths move only when audio plays on this
client**: the web sets `speaking` locally from `AudioEngine.onSpeakingChange`; the server never emits `speaking`.

### 4.4 HTTP API — `packages/protocol/src/routes.ts` + `api.ts`

Route table `ROUTES` (method, path, auth, bodyCap, body). The worker registers a handler for every id
(`Record<RouteId, RouteHandler>` — a missing handler is a type error); the web builds URLs with `routePath(id, params)`.
Every non-2xx JSON response is `ApiErrorBody = {error: {code, message, missingKeys?, opId?}}`.

| Id | Method & path | Request | Response | Owner |
|---|---|---|---|---|
| `health` | GET `/api/health` | — | `HealthResponse {ok, service, version, time, workspaceId}` | integrator |
| `capabilities` | GET `/api/capabilities` | — | `CapabilitiesResponse` (§4.6): whitelisted fields only, key lists carry env var names only | media |
| `getWorkspace` | GET `/api/workspace` | — | `WorkspaceSettings {workspaceId, leadId, chiefName, voiceOn, updatedAt}` | worker-core |
| `putWorkspace` | PUT `/api/workspace` | `UpdateWorkspaceRequest` (any of `leadId`, `chiefName`, `voiceOn`) | `WorkspaceSettings`; appends `workspace.updated` and upserts the D1 row. 400 for an unknown `leadId` or a non-boolean `voiceOn`; a blank `chiefName` becomes null | worker-core |
| `ws` | GET `/api/ws?since=<seq>` | WebSocket upgrade | frames (§4.2) | worker-core |
| `talk` | POST `/api/talk` | `TalkRequest {text ≤8000, opId, via?}` | **202** `TalkAccepted {accepted, opId, turnId, messageId, duplicate?}` (idempotent on `opId`); **429** past `CHAT_DAILY_LIMIT` | worker-core |
| `listJobs` | GET `/api/jobs?limit=<1–100>` | — | `JobsResponse {jobs: JobSnapshot[]}`, newest first (the web merges it on every connect) | worker-core |
| `getJob` | GET `/api/jobs/:id` | — | `JobResponse` = `JobSnapshot` incl. `result` (Markdown) once done; 404 unknown | worker-core |
| `steerJob` | POST `/api/jobs/:id/steer` | `SteerJobRequest {text ≤2000, opId?}` | **202** `SteerJobAccepted {accepted, jobId, steerId}`; 404 unknown, 409 when finished | worker-core |
| `cancelJob` | POST `/api/jobs/:id/cancel` | — | **202** `CancelJobAccepted {accepted, jobId}`; 409 when already finished. The `job.cancelled` frame carries `by: 'owner'`, and the Chief of Staff acknowledges the stop in the thread | worker-core |
| `tts` | POST `/api/speech/tts` | `TtsRequest {text ≤4000, voiceRef: VoiceRef, speakerId, format?, response?: 'audio'\|'json'}` (also the loose `{provider?, voice}` form) | audio bytes (`audio/mpeg`\|`audio/wav`, headers `X-Speech-Provider`, `X-Speech-Voice`) or `TtsJsonResponse {mime, audioBase64, alignment, provider, voice}`. Keyless: **503 not_configured** naming `OPENAI_API_KEY`/`XAI_API_KEY` (the web uses browser speech); **429** past `TTS_DAILY_LIMIT` | media |
| `stt` | POST `/api/speech/stt[?language=xx]` | raw audio body (`audio/*` or `video/webm`, ≤ **10 MB**) | `SttResponse {text, provider, language?}`. Keyless: **503** naming the keys (the web uses browser dictation); **429** past `STT_DAILY_LIMIT` | media |
| `listPortraits` | GET `/api/portraits` | — | `PortraitListResponse {portraits: {personaId, version, hasLandmarks}[]}` (adopts R2 images D1 lost); the web asks once instead of probing every face | media |
| `generatePortrait` | POST `/api/portraits/:personaId/generate[?force=1][&wait=1]` | — | **202** `{status: 'generating'\|'exists'}`; with `wait=1`, **200** `PortraitGenerateResult {status:'exists', created, remainingToday}`. 503 names the image keys (Mock is never a portrait); **429 rate_limited** past `PORTRAIT_DAILY_LIMIT` | media |
| `getPortrait` | GET `/api/portraits/:personaId` | — | image bytes with `ETag`, `private, no-cache` (304 on match) and `X-Portrait-Version`; 404 with `X-Portrait-Status: none\|generating\|failed` → illustrated face | media |
| `getLandmarks` | GET `/api/portraits/:personaId/landmarks` | — | `LandmarksResponse {personaId, landmarks: FaceLandmarks\|null}` + `X-Portrait-Version` | media |
| `putLandmarks` | PUT `/api/portraits/:personaId/landmarks` | `PutLandmarksRequestWithVersion {landmarks, force?, portraitVersion?}` (≤110 KB) | `LandmarksResponse`. First valid write wins (409 after, unless `force`); an identical re-send is 200; a `portraitVersion` that is no longer current is 409; no portrait is 404 | media |

`:personaId` accepts a catalog persona id **or** a lead id (`lead-…`). Router behaviour: **only the app itself may
call** (`lib/origin.ts`): the Host must be loopback or a host in `ALLOWED_ORIGINS` (DNS rebinding), a present
`Origin` must be in `ALLOWED_ORIGINS` (`"null"` never is), a browser request without one must not be
`Sec-Fetch-Site: cross-site|same-site`, and the `ws` upgrade requires an allowed `Origin` → otherwise **403
forbidden**. Local tools without an Origin (curl, the portrait CLI, Playwright's request API) still work. JSON bodies
need the MIME essence `application/json` exactly (`text/plain;application/json` skips the CORS preflight) → 415.
Unknown `/api/*` → 404 (also a malformed `%`-escape in a path param);
wrong method → 405 with `Allow`; body over `bodyCap` → 413 (Content-Length or counted stream); thrown errors are
mapped by `toErrorResponse` (`HttpError` → its code; `MissingProviderError` → 503 `not_configured` + `missingKeys`;
`LandmarksError` → 400; `ProviderError` → 502; anything else → 500 with a generic sentence, message-only log).
`ErrorCode` includes `rate_limited` → **429** and `forbidden` → **403**. Missing-provider sentences name the capability in plain words, e.g.
"No provider is configured for spoken replies (text to speech). Add OPENAI_API_KEY or XAI_API_KEY to apps/worker/.dev.vars."

### 4.5 Worker internals — `apps/worker/src`

```ts
interface Env extends ProviderEnv { WORKSPACE, PROJECT, ROOM, RUN: DurableObjectNamespace<…>; DB: D1Database;
                                    BLOBS: R2Bucket; WORKSPACE_ID: string; APP_VERSION?: string;
                                    MOCK_MEDIA?: string /* "true": Mock TTS/STT answer and count as available */;
                                    PORTRAIT_DAILY_LIMIT?: string /* default 200 paid generations per UTC day */;
                                    TTS_DAILY_LIMIT?, STT_DAILY_LIMIT?, CHAT_DAILY_LIMIT?, JOB_DAILY_LIMIT?: string /* per UTC day: 3000, 600, 1500, 60 */;
                                    MAX_ACTIVE_JOBS?: string /* running at once, default 3 */;
                                    ALLOWED_ORIGINS?: string /* comma-separated; pnpm dev passes the web and worker ports */ }
type RouteHandler = (req: Request, rc: RouteContext) => Response | Promise<Response>;
interface RouteContext { env; ctx: ExecutionContext; route: RouteId; params; url: URL; registry(): Registry }
```

- `lib/http.ts`: `json()`, `errorResponse()`, `notImplemented(route)`, `readJson<T>()`, `class HttpError(code, message, {missingKeys?, opId?, status?})`.
- `lib/stubs.ts`: `workspaceStub(env)`, `projectStub(env, projectId = 'everyday')`, `roomStub`, `runStub`.
- `lib/origin.ts`: `guardRequest(req, url, routeId, originPolicy(env.ALLOWED_ORIGINS))` (403 for foreign origins and hosts).
- `lib/limits.ts`: spending limits. `takeDaily(env, 'tts'|'stt')` counts in D1 `media_usage` and returns a refund for
  calls no provider answered; `DailyCounter` counts chat turns (WorkspaceDO) and new jobs (ProjectDO) in the DO's own
  SQLite, synchronously with the command. Refusals are `rate_limited` with a sentence naming the env var.
- **Handler modules (fixed export names the router imports):**
  `workspace/routes.ts` → `handleGetWorkspace`, `handlePutWorkspace`, `handleWs`, `handleTalk` ·
  `jobs/routes.ts` → `handleListJobs`, `handleGetJob`, `handleSteerJob`, `handleCancelJob` ·
  `media/capabilities.ts` → `handleCapabilities` · `media/speech.ts` → `handleTts`, `handleStt` ·
  `media/portraits.ts` → `handleListPortraits`, `handleGeneratePortrait`, `handleGetPortrait`, `handleGetLandmarks`, `handlePutLandmarks`.
- **Test seams:** `workspace/runtime.ts` exports `runtime.registry(env)` and `runtime.now()`; tests swap them and
  restore with `Object.assign(runtime, defaultRuntime)`.
- **Durable Objects** (SQLite-backed, migration tag `v1`; extend `DurableObject<Env>` from `cloudflare:workers`, JS RPC):

| Class | Name | Intended RPC surface (owner may refine internals) |
|---|---|---|
| `WorkspaceDO` (worker-core) | `ws:<ws>` | `fetch()` = socket upgrade (hibernation API, `resume` paging); `getSettings()`, `updateSettings(patch)`; `talk(TalkRequest): TalkAccepted \| TalkRefusal` (202 path: accept, echo `talk.owner`, run the Chief of Staff turn in the background on the **fast** tier; refused past `CHAT_DAILY_LIMIT`); `ingest(MirrorBatch {source, frames, presence: {agentId, claim\|null}}) → {applied}` (ProjectDO mirrors job frames; deduplicated on `cause`); `frames(since, limit)` (debug/tests). Posts the proactive announcement on `job.done`/`job.failed`/`job.cancelled {by:'owner'}` **in the same transaction** as the mirrored frame. A fresh object clears any stale `talk` (Thinking) claim. |
| `ProjectDO` (worker-core) | `p:everyday:<ws>` | `startJob({title, brief, opId?, leadId?, chiefName?}): JobSnapshot \| JobRefusal` (refused `rate_limited` at `MAX_ACTIVE_JOBS` running or past `JOB_DAILY_LIMIT`); `listJobs(limit = 20)`, `getJob(id)`; `steerJob(id, text, opId?) → SteerJobAccepted \| JobRefusal {accepted:false, code:'not_found'\|'conflict'\|'bad_request', message}`; `cancelJob(id, reason?, by = 'owner') → CancelJobAccepted \| JobRefusal` (refusals are returned, not thrown, so they survive RPC); `alarm()` = one checkpoint per due job (plan → 2–4 work steps → synthesis, **reason** tier, each checkpoint with its own 5-minute `deadlineSignal` budget), queued steers applied between steps, between tool calls, and after the write-up (a steer that arrived while it was being written is applied and the write-up is written again, never dropped); each job's frames are mirrored as soon as its checkpoint ends; the Chief of Staff claims no presence for background work (available while working, D2); cancel fences the job and aborts the in-flight call, 3 attempts with backoff then `job.failed`. Mock pacing: with `MOCK_DELAY_MS > 0` checkpoints are 2.5 s apart (a Mock job takes 12–15 s). |
| `RoomDO` (integrator stub) | `rm:<id>` | `ping()`; rooms arrive in Inc 2 |
| `RunDO` (integrator stub) | `run:<jobId>` | `ping()`; available for long jobs |

- **D1**: `0001_init.sql` (worker-core): `workspaces`, `ledger_events (stream, seq) PK` (both streams, `INSERT OR IGNORE`), `jobs`. `0002_media.sql` (media): `portraits` keyed by `persona_id` (image row, version, generation lock, landmarks) and `media_usage (ws_id, day, kind)` daily counters. Migrations apply on every `pnpm dev`.
- **DO SQLite**: each DO keeps its own ledger (gap-free `seq` per stream, hot window 50k rows, replay 500 per page).
- **R2** keys: portraits at **`portraits/<personaId>.<ext>`** (png, jpg or webp; catalog faces are the same in every workspace, so not per-workspace), metadata on the object. Later (ARCHITECTURE §15.3): `.tile.webp`/`.token.webp` variants, `ws/<ws>/audio/<lineId>.wav`, `ws/<ws>/align/<lineId>.json`.

### 4.6 Provider fabric — `packages/models`

```ts
type ModelEvent = {type:'text',delta} | {type:'reasoning',delta} | {type:'tool_call',id,name,arguments /*JSON string*/}
  | {type:'citation',url,title?} | {type:'usage',input,output,cached?,usd:number|null,costStatus:'priced'|'unavailable'|'free'}
  | {type:'done',finish:'stop'|'tool_calls'|'length'|'refusal'|'incomplete'|'cancelled'} | {type:'error',message,code?,status?,retryable?}
type ChatMessage = {role:'user',content} | {role:'assistant',content,toolCalls?} | {role:'tool',toolCallId,name,content,isError?}
interface ChatRequest { model?; system?; messages; tools?: ToolSpec[]; toolChoice?; maxTokens?; temperature?;
                        reasoningEffort?; responseFormat?: {type:'json_schema',name,schema}; signal? }
interface ToolSpec { name; description; parameters: JsonSchema; mock?: MockToolHints }
interface ChatProvider { id; kind; family; defaultModel(tier?); chat(req): AsyncIterable<ModelEvent> }
interface SpeechProvider { id; kind; family; tts?(TtsRequest): Promise<TtsResult>; stt?(SttRequest): Promise<SttResult> }
interface ImageProvider { …; generate({prompt, aspect?, source?, signal?}): Promise<{image, mime, provider, model}> }
interface EmbeddingProvider { …; embed({texts, model?, signal?}): Promise<{vectors, model, dims, provider}> }
createRegistry(env: ProviderEnv, {fetch?, providers?, health?, probeTimeoutMs?, onRoute?}) → Registry {
  resolve(capability, policy?): Resolved   // throws MissingProviderError naming missing env vars
  resolveAsync(capability, policy?): Promise<Resolved>   // probes local providers first
  tryResolve(capability, policy?): Resolved | null
  capabilities({probe?}): Promise<CapabilitiesResponse>
  warm(): Promise<void> }
Resolved = { provider, providerId, model, tier: ModelTier, fallbacks: ProviderId[] }
ModelTier = 'fast' | 'reason' | 'voice'     // none = 'reason'; TierLike also accepts legacy 'deep' → reason, 'balanced' → fast
ModelPolicy = { prefer?, tier?, model?, localOnly?, excludeFamilies?, allowMock?, needs?: ModelFlag[] /* chat only, e.g. ['tools'] */ }
ProviderError(provider, message, status, retryable, kind)   // kind: auth | bad_request | model_not_found | rate_limited |
                                                            // upstream | unreachable | timeout | incomplete | bad_response | refused
MissingProviderError(capability, missingKeys, skipped?, hint?)
deadlineSignal(ms, parent?)                 // per-call time budget carried on the AbortSignal (expiry → error code 'timeout')
```

- Callers in Inc 0: talk resolves `chat {tier:'fast', needs:['tools']}`; job checkpoints `chat {tier:'reason', needs:['tools']}`
  with `deadlineSignal(300_000, jobSignal)`; portraits `image {allowMock:false}`; speech `tts`/`stt {allowMock: MOCK_MEDIA}`.
- `ProviderInstance` gains optional `health: {key, check(signal)}` for local providers; the reachability cache
  (`sharedHealth`, ~30 s) is module-level, so unit tests pass `health: new HealthCache()` and a fake `fetch` whenever
  they set `OLLAMA_BASE_URL` (`createTestEnv` does not set it, so worker tests stay offline).
- Additive request fields: `ChatRequest.responseFormat.strict`; `TtsRequest.model`/`.language`; `SttRequest.model`/`.prompt`;
  `ImageRequest.model`. `ProviderEnv` adds `OPENAI_COMPATIBLE_MODEL`, `OPENAI_COMPATIBLE_EMBED_MODEL` and the
  `*_BASE_URL` overrides (listed, commented out, in `apps/worker/.dev.vars.example`).

- Every stream ends with exactly one `done` or `error`; a stream cut short without the provider's final event is an `incomplete` error, a cancelled caller gets `done: cancelled`. Adapters (`src/adapters/<provider>.ts`: mock, ollama, openai, anthropic, xai, gemini, openai-compatible) cancel upstream on abort, retry 429/5xx twice with jitter and a capped Retry-After, and never retry an aborted caller. Tool calls from every dialect become one `{id, name, arguments}` event.
- Preference order when `DEFAULT_CHAT=auto`: chat anthropic → openai → xai → gemini → openai-compatible → ollama → mock; tts xai → openai → mock; stt openai → xai → mock; image xai → openai → mock; embeddings openai → gemini → ollama → openai-compatible → mock. **Failover**: a real provider that fails before any output with a retryable error hands the call to the next real one; never local → cloud and never to Mock.
- **Ollama** is configured by `OLLAMA_BASE_URL` (set by default), probed via `/api/tags` (800 ms, cached ~30 s). Unreachable, or the model not pulled → the next candidate, and the error names the fix (e.g. `ollama pull qwen3:32b`). qwen3 thinking is off unless asked.
- **Capabilities semantics**: `modalities[m].available` is true when a real provider can serve it, or — for `chat` and `embeddings` — Mock, or — for `tts`/`stt` — Mock when `MOCK_MEDIA=true`. So keyless: chat available (mock), TTS/STT/image **unavailable** (the UI hides them and uses browser speech / illustrated faces) and their routes answer 503 naming the keys. `missingKeys` lists env var names only. `capabilities({probe:true})` probes Ollama and reports `reachable`.
- **Mock provider** (deterministic): plain reply echoes the last user message and says it is a placeholder; if a tool's `mock.triggers` (regex sources, case-insensitive) match the last user message, it emits a `tool_call` with `mock.args(userText)` or schema-filled args; **built-in job intents** (tools named `start_job|delegate|create_job|start_background_job`, `job_status|list_jobs|get_job`, `steer_job`, `cancel_job` without `mock.triggers`): "look into / research / compare X" → delegate, "how's it going / status" → status, "also check Y / focus on Z" → steer (fills job ids from the latest `job_…` in tool outputs, replies or the system prompt), "cancel that / never mind" → cancel. After tool results it says the output's `say`/`summary`/`message`. Directives `!tool` and `!slow` for tests. `responseFormat` → schema-valid JSON (`fillSchema`); `MOCK_DELAY_MS` paces chunks; TTS = silent WAV + evenly spaced `Alignment` (60 ms per character); STT = fixed sentence; image = SVG placeholder; embeddings = 64-dim hashed.
- **Secrets**: keys are read only from `ProviderEnv`; every error message goes through `redact()` (the exact key plus anything key-shaped); auth errors name the env var (`OpenAI rejected the key in OPENAI_API_KEY (401)`).
- Helpers: `collectEvents(stream)`, `fillSchema(schema)`, `encodeWav`, `silentWav`, `PROVIDERS` descriptors, `MissingProviderError`, `ProviderError`.

### 4.7 Agent loop — `packages/agent-loop`

```ts
runTurn({ provider, model?, system, messages, tools?: AgentTool[], onEvent?, signal?, maxSteps? = 8 (hard 24),
          maxTokens?, temperature?, reasoningEffort?, toolChoice? /* first call only */, responseFormat?,
          checkpoint?(info) => {inject?: string[], stop?: 'done'|'cancelled'} }): Promise<TurnResult>
interface AgentTool<A> { spec: ToolSpec; execute(args: A, {callId, step, signal}): Promise<ToolOutcome> }
type ToolOutcome = {ok:true, content, summary?, endTurn?} | {ok:false, error, content?}
type LoopEvent = ModelEvent | {type:'step',step,wrapUp?} | {type:'tool_start',callId,name,args} | {type:'tool_end',callId,name,ok,summary?,durationMs}
               | {type:'checkpoint', …}
interface TurnResult { text; fullText; finish: FinishReason | 'error'; endedBy?; messages: ChatMessage[] /* produced this turn */;
                       usage: {input, output, usd}; steps; toolCalls; error?: {message, retryable?} }
```

Parallel tool calls per step; unparseable arguments go back as `argsError`; unknown tool → error outcome; an
identical failing call is not retried forever; tool output over 20,000 chars is clipped; `endTurn` ends the turn
after the tool; the `checkpoint` hook runs between tool rounds (steering is injected there); after `maxSteps` one
wrap-up call that keeps the tool definitions with `toolChoice: 'none'` (providers reject tool results without tool
definitions) and finishes `length`. A cancelled signal returns `finish: 'cancelled'`.

### 4.8 Catalog — `packages/catalog`

- `@headcount/catalog` → types (`Lead`, `Persona`, `PersonaSlim`, `Department`, `Skill`, `SkillIndexEntry`, `MatchQuiz`, `Appearance`, `CatalogFull`, `CatalogSlim`, …) and pure helpers: `indexCatalog(bundle)` → `{lead(id), persona(id), department(id), personasIn(dept), byHandle(h)}`, `leadVoiceRef(lead)`, `personaVoiceRef(persona)`, `chiefDisplayName(lead, chiefName)`, `firstName`, `initials`, `scoreMatchQuiz(quiz, answers, leads)` (weighted sum, normalised by max possible, ties → lower default autonomy).
- `@headcount/catalog/full` → `catalogFull`, `fullIndex` (**worker only**; ~3.6 MB).
- `@headcount/catalog/slim` → `catalogSlim`, `slimIndex` (**web**, lazy: `import('@headcount/catalog/slim')`, ~210 kB gzip): leads in full; personas `{id, name, handle, pronouns, title, department, seniority, one_liner, backstory, intro_line, skills, voice, avatar: {appearance, accent_color, portrait_prompt}}`; departments `{id, name, icon, description, personaIds}`; skills index; `matchQuiz` (from `catalog/leads/match-quiz.json`, 8 questions now; when it is absent the web uses its built-in 4-question quiz weighted by each lead's personality sliders).
- Ordering follows `catalog/taxonomy.json`. `report.warnings` lists skipped files/records.

### 4.9 Faces and voice shared types — `packages/protocol/src/face.ts`, `voice.ts`

```ts
interface MouthSample { openness; width; round; energy /* all 0–1 */; voiced?; done?; heard?; params?: VisemeParams; shape?: VisemeId; source? }
interface MouthSampler { sample(now: number): MouthSample }      // the ONLY audio ↔ face coupling
VisemeParams = {openY, stretchX, jawDrop, cornerPull, round}     // PG image-height units
VISEME_PARAMS: Record<VisemeId, VisemeParams>                    // the ONE shape table (audio samples it, avatar draws it)
FaceLandmarks (PG shape, 0–1 coords) + normalizeLandmarks(value) // ported from personagram-ai/src/shared/landmarks.ts; throws LandmarksError
FaceTier = 'hero' | 'tile' | 'token'
VoiceRef = { openai?: string; xai?: string; speed?: number; instructions?: string }
Alignment = { chars: string[]; startsMs: number[]; endsMs: number[] }
```

Additive types: add `packages/protocol/src/ext/<builder>.ts`, import as `@headcount/protocol/ext/<builder>`. New frame
types: define the data shape there and ask the integrator to add it to `FrameDataMap`.

### 4.10 Avatar — `packages/avatar`

```ts
new FaceView({ tier?, label?, name?, reducedMotion?, detectLandmarks? = true, chrome? = true, onLandmarks?: (lm) => void })
  .mount(el)                                         // <canvas role="img" aria-label> filling el
  .setPortrait({url, landmarks|null} | null)         // strip-warp when landmarks, still otherwise; detect once → onLandmarks
  .setAppearanceFallback({appearance, accent, name}) // procedural face from catalog appearance (+ procedural look fields)
  .setState(presenceState, label?)                   // ring, glyph, head pose; raised hand = glyph beside the face
  .attachSampler(MouthSampler | null)                // mouth follows what is playing
  .setTier('hero' | 'tile' | 'token')
  .setReducedMotion(boolean | null)                  // per-face override; null follows the OS setting
  .stats()
  .destroy()
detectLandmarks(image) / configureLandmarks({wasmBaseUrl?, modelAssetPath?})   // lazy MediaPipe chunk, GPU → CPU
VISEMES (= protocol VISEME_PARAMS), REST_PARAMS, sampleToParams(sample), paramsToMouth(params)   // render side only
configureFaceScheduler({maxAnimatedTiles})
```

- The accessible label is `'<name>, <presence label or state word>'` unless a fixed `label` is given; the web passes
  only the part after the name (`presenceText()` in `apps/web/src/components/Face.tsx`).
- `onLandmarks` fires once per portrait URL; the web PUTs the result with the image's `X-Portrait-Version`.
- The mount element needs an explicit size and a border-radius (the ring inherits it). FaceView injects one
  `<style id="hc-face-style">` that uses `--state-*`, `--hand`, `--panel`, `--muted`, `--dur-state`.
- Hidden tabs do not decode images or draw (the scheduler pauses on `visibilitychange`).
- **Lip sync lives in `packages/audio`** (spectral features, text/alignment timing, the fusion sampler). The avatar
  package only draws what a `MouthSampler` reports; the earlier `@headcount/avatar/driver` copy (never used at
  runtime) was removed so tuning cannot drift between two implementations.
- Motion (blink schedule, sway phase) is seeded per person from the face's name; the web passes it at construction.
- The portrait working copy is sized to the display (about 2× the canvas backing, capped per tier) and rebuilt
  larger when the face grows or is promoted.

One shared rAF scheduler for all faces (heroes always render and do not count against the tiles' budget; tiles share a 6 ms budget with at most 3 animating,
tokens redraw only on change, off-screen faces pause); reduced motion removes sway, blinks and brows but **keeps lip
sync**; MediaPipe `@mediapipe/tasks-vision` is pinned to **0.10.35**. Renderers: the photoreal strip-warp portrait
(ported from personagram-ai) when a portrait with landmarks exists, otherwise the illustrated face built from the
catalog `appearance`. The mouth moves only from the attached sampler.

### 4.11 Audio — `packages/audio`

```ts
createAudioEngine(deps?: AudioEngineDeps): AudioEngine   // deps inject AudioContext, speechSynthesis, MediaRecorder, … (null = unavailable)
  arm()                                  // create/resume the single AudioContext (also armed by the first tap/key)
  speak({speakerId, chunks: AsyncIterable<ArrayBuffer | SpeechChunk> | string, mime?, alignment?, text?, voiceHint?}): SpeakHandle
      // SpeechChunk = {audio?: ArrayBuffer|null, mime?, text?, alignment?}; a chunk with text and no audio is spoken by
      // the browser voice, in order. handle = {speakerId, generation, sampler, done: Promise<SpeakOutcome {…, playedMs?}>, stop()}
  sampler(speakerId): MouthSampler       // stable per speaker: attach once per face
  stopSpeaker(speakerId) / stopAll()     // barge-in by generation: stops playing AND loading (aborts pending TTS)
  generation(speakerId); speaking(); onSpeakingChange(cb)   // speaking = audio actually reaching the speakers (350 ms hangover)
  duck(on); readonly ducked; micLive(); onMicChange(cb)
  startPushToTalk(): Promise<MicSession> // {mime, level(), elapsedMs(), stop(): Promise<Blob>, cancel()}; throws MicError
                                         // {code: denied|no-device|busy|insecure|unsupported|network|failed, message}
  startDictation({lang?, onPartial?, onError?}): DictationSession | null   // keyless STT via SpeechRecognition; error()
  support(): {webAudio, mic, speechSynthesis, speechRecognition}; destroy()
createSpeechStream({synthesize?, prefetch?, onError?, onSentence?}) → {push(delta), end(), cancel(), AsyncIterable<SpeechChunk>}
speechChunkFromResponse(res, text?); TtsHttpError; SentenceChunker; speakable/SpeakableFilter
createPushToTalk(engine, {mode: 'hold'|'toggle'|'auto', dictation?, onResult, onError, onState, onPartial, onTooShort})
```

Graph (ARCHITECTURE §8.6): sources → utterance gain → speaker gain → per-speaker analyser tap (→ sampler) → voices
bus → ducker (−18 dB while the mic is live) → master. Mouth priority: provider alignment → the chunk's text timed
over the decoded clip → live spectrum → energy; while ducked the mouth rests (`heard: false`). `done` never rejects.
Everything is in heard time: windows start and end one output latency after the audio clock (`getOutputTimestamp`),
the analyser tap is read with the same delay, and an utterance finishes (mouth to rest, `speaking` off) only when
its last window has been heard. With a timeline, the tap gates the mouth only once it has carried voice (a silent tap
is dropped after 400 ms). Browser speech is cut at 60 tokens, and its text-timed mouth rests 1.5 s past the estimate.

### 4.12 Web — `apps/web`

- Routes (`src/router.ts`, History API, ids not names): `/` → `/welcome` until a lead is chosen, else `/talk`; `/welcome` (Onboarding: pick your Chief of Staff), `/talk`, `/floor` (Directory), `/desk/:personaId/profile` (CoworkerProfile), `/projects`, `/inbox`. `paths.*` builds them.
- Store (`src/store/index.ts`, signals): `settings`, `capabilities`, `connection`, `lastSeq`, `replayThrough`, `thread: ThreadItem[]`, `jobs`, `presence`, `localPresence`, computed `onboarded`, `activeJobs`, `jobList`, `chiefPresence`; `applyFrame(frame) → 'applied'|'ignored'|'resync'` (ignores replayed seqs); `onFrame(cb(frame, {live}))` (replayed frames are never spoken); `presenceFor(agentId)` / `setLocalPresence` (client `speaking`/`listening` merged by priority); `addPendingOwner`/`markOwnerAccepted`/`markOwnerFailed` (opId reconciliation, failed sends keep their text with Retry); `mergeJobs(snapshots)` (newer wins); `acceptSettings(next)` (settings only move forward).
- API client (`src/api/client.ts`): `api.health/capabilities/getWorkspace/putWorkspace/talk/listJobs/getJob/steerJob/cancelJob/tts/ttsAudio/stt/listPortraits/generatePortrait/portraitUrl/portraitImage/portraitBlob/getLandmarks/putLandmarks(id, lm, portraitVersion?)`; errors throw `ApiError {status, code, message, missingKeys}`.
- Feed (`src/api/ws.ts`): `connectFeed({onFrame, onStatus, since}) → {close(), reconnect()}` with replay paging (§4.2).
- Voice (`src/voice/*`): one `AudioEngine`; `AgentSpeaker` per speaker feeds live deltas into `createSpeechStream` (TTS per sentence with `response:'json'` when TTS is available, else the browser voice); `chiefSpeaker.mouth` drives every Chief of Staff face; `bargeIn()` on send, push-to-talk, Esc or a tap on the face; push-to-talk uses provider STT when available, else browser dictation, and is hidden when neither exists.
- Dev builds expose `window.__headcount = {store, applyFrame, chiefSpeaker}` for e2e.
- On Talk below 1280 px the floating bubble is hidden (it covered the thread); the Talk header face takes its gestures.
- Catalog (`src/catalog.ts`): `loadCatalog()` → `catalog` signal of `slimIndex`.
- Design tokens: `src/styles/tokens.css` (EXPERIENCE §10.2 colours, 8 px grid, radii 24/12, motion 200/250/400/1200 ms, light + dark via `prefers-color-scheme` or `data-theme`), `src/styles/base.css` (shell: left rail ≥1024, icon rail 768–1023, bottom tabs <768; bubble 56/76 px).

## 5. Inc 0 flows (how the pieces meet)

1. **Pick a Chief of Staff.** `/welcome` shows the 12 leads from the slim bundle: face (portrait if `GET /api/portraits/<leadId>` is 200, else `setAppearanceFallback`), voice sample (`api.tts({text: quiz.try_before_choosing.voice_preview_line ?? lead.communication.greeting, voiceRef: leadVoiceRef(lead), speakerId: CHIEF_ID})` → `audio.speak`, or `speak(text)` when TTS is unavailable), backstory teaser, `best_for_owners_who`, match quiz (`scoreMatchQuiz`, top 3). Choose + rename → `PUT /api/workspace {leadId, chiefName}`.
2. **Talk (text).** `POST /api/talk {text, opId}` → 202. WorkspaceDO appends `talk.owner`, emits `presence thinking`, builds the system prompt from the lead (personality, communication, backstory, origin moments, honesty note, guardrails — worker imports `@headcount/catalog/full`), runs `runTurn` with lead tools, streams `talk.delta`, ends with `talk.message` + `talk.done`.
3. **Voice.** Hold the bubble / the mic / Space → `createPushToTalk` → `api.stt(blob)` (or dictation when STT is unavailable) → `api.talk(text, 'voice')`. When `voiceOn`, the web feeds the Chief of Staff's live deltas into audio's `createSpeechStream({synthesize})` (TTS per sentence with `leadVoiceRef(lead)`, `response:'json'` for alignment) and passes the stream to `audio.speak`; every Chief of Staff face is attached to `audio.sampler(CHIEF_ID)` — the mouth follows the audio actually playing. **Barge-in**: owner starts talking or sends a message → `audio.stopSpeaker(CHIEF_ID)` at once, pending TTS requests are aborted, and a newer owner message cuts a still-streaming reply server-side.
4. **Delegate.** "Look into X" → the Chief of Staff's `delegate` tool → `ProjectDO.startJob` → `job.started` (Activity row shows `label`) → alarm-driven checkpoints → `job.progress` sentences. The talk turn ends immediately ("I started it") — the conversation never waits on the work (D2).
5. **Status.** "How's it going?" → a read tool over `ProjectDO.listJobs()` (live `JobSnapshot`: status, label, step/of, partial, steers) → answered from state (`talk.message kind:'status'`); the job is never paused or re-run.
6. **Steer.** "Also check Y" → `steer_job` tool or `POST /api/jobs/:id/steer` → `job.steered {status:'queued'}` → applied at the next checkpoint → `job.steered {status:'applied'}`. Cancel → `job.cancelled`.
7. **Completion.** `job.done` → WorkspaceDO posts `talk.message {kind:'announcement', jobId}`; spoken when `voiceOn`.
8. **Floor.** `/floor` lists ~160 catalog coworkers (face, name, title, one-liner), filter by department; click → `/desk/:personaId/profile`.

## 6. Status (Inc 0 integrated)

- Verified: `pnpm install`, `pnpm typecheck` (TypeScript 7 everywhere), `pnpm test`, `pnpm build`, `pnpm e2e`
  (chromium + voice projects), `pnpm e2e:screens`, and the full flow over HTTP/WebSocket on real workerd with Mock
  and with Ollama `qwen3:32b`. Details, numbers, the demo script and known gaps: `docs/dev/INC0.md`.
- Still stubs: `RoomDO`, `RunDO` (later increments).

## 7. Heads-up: D5 / Inc 0.5 (added to the plan while this scaffold was built)

OWNER-DIRECTIVES D5 ("a living workforce") and MVP-PLAN Inc 0.5 are built in parallel and integrated right after
Inc 0. They are **not** part of these contracts yet; the integrator will extend them. Expected touch points, so
Inc 0 builders do not design against them:

- New `packages/expressions` (reflex engine) and `catalog/expressions/` content → a new owner and new catalog bundle fields.
- `WorkspaceSettings.ambience` (`quiet | lively | buzzing`) and a reflex/micro-utterance frame type.
- Pre-voiced clips already fit `AudioEngine.speak({chunks, alignment})`; keep that path cheap to start (reflexes must play in under 200 ms).
- A mood-driven expression palette on `FaceView` (a later `setExpression`-style method) — keep the renderer's parameter set open to brows/expression inputs.
- Agents as actors with prioritized mailboxes: keep WorkspaceDO turn handling non-blocking so owner messages can pre-empt other work.
