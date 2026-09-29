# Increment 0.5 · The living workforce in the app — build plan

> **Status.** Plan v1, 28 September 2026, for three parallel builders (A worker, B web, C audio + avatar) and the
> integrator. It turns the library-only living-workforce layer (`packages/expressions`, `catalog/expressions`) into
> behaviour the owner can see and hear in `/app`.
>
> **Binding inputs.** `docs/OWNER-DIRECTIVES.md` (D2 communication first, D3 minimal and dark, D5 living workforce),
> `docs/LIVING-WORKFORCE.md` (the spec: §1 timing, §1.4 silence rules, §2.3 preemption, §3 intents, §6 mood, §7
> pre-voicing, §8 passing-by, §9 Ambience, §10 honesty), `packages/expressions/README.md` (E3 worker, E4 web, E5
> protocol, keyless modes), `docs/dev/CONTRACTS.md` (Inc 0 contracts, conventions), `docs/dev/INC0.md`.
>
> **The owner's words.** "Agents feel like real multi-tasking human beings who can retrieve small amounts of
> text/voice for side-talk, passing-by conversation, filler responses, canned expressions, laughing and other quips —
> so the user can engage interactively with their headcount in a living breathing workforce."
>
> Where this plan and the spec disagree, the spec's honesty rules (H1–H12, L1–L7) win; §8 lists every place this
> plan narrows the brief for that reason.

---

## 0. What ships

After Inc 0.5, with keys or keyless:

- **Talk feels attended.** The Chief of Staff nods and says "mm-hm" in the pauses while you hold to talk, says "On
  it." or a short filler while the model thinks, laughs in their own laugh style at a joke, answers "thanks" and
  "bye" instantly without a model call, says "hold that thought" when you ask something new while it is still
  speaking, and comes back with "Okay — all yours." Every sound is captioned.
- **Work is felt, never faked.** A job's progress, a retried attempt and a finished job show on the Chief's face
  (mood) and, when you are at Talk, as a short line in their voice ("That's two of five so far.", "Hm. That didn't
  work. Retrying.", "Nice." before the announcement). Nothing claims work that did not happen.
- **The Floor breathes.** Rest the pointer on a desk for 600 ms: the face looks up, a bubble says a short, true line
  ("Hi — Jelena, architecture. Nothing on my desk yet."), softly voiced when Ambience allows. Press **R** or click
  **Reply** to chat in place; the coworker answers in two sentences in their own voice with lip sync. Your Chief of
  Staff has a card at the top of the Floor with a live state ring.
- **One quiet control.** Ambience (Quiet · Lively · Buzzing, default Lively) in ⌘K and one small control in the Floor
  header. Quiet keeps functional reflexes and turns everything else into faces.
- **Instant.** Lines are pre-voiced once in each agent's own voice (content-addressed clips in R2 plus the browser's
  Cache Storage, with lip-sync alignment) and play in well under 200 ms.

Side-talk between coworkers stays engine-only in 0.5 (no coworker events exist yet; LIVING-WORKFORCE §11.5); it goes
live in Inc 1.

---

## 1. Rules for every builder

### 1.1 The owner's running app hot-reloads your edits

The owner is using `pnpm dev` on **:5173 / :8787** with keys and default local state. Wrangler and Vite watch
`apps/worker/src`, `apps/web/src` and the packages, so **every file you save reloads the owner's app**.

- Never start, stop or restart anything on :5173 or :8787, and never use the Browser pane's `headcount` launch config
  (it runs those ports). Never `PUT /api/workspace` or `POST /api/talk` against :8787.
- Keep every saved state loadable: create a module before importing it, wire routers and DOs last, and never leave a
  half-edited file saved. Esbuild does not typecheck, but a missing import or a syntax error takes the owner's
  worker down.
- Durable Object schema changes are additive only (`CREATE TABLE IF NOT EXISTS` in constructors). **No new D1
  migration is required in Inc 0.5**; the owner's server applies D1 migrations only on restart, so any D1 access you
  add must tolerate a missing table (best effort, logged).
- No new Durable Object class and no `wrangler.jsonc` binding change (both need a restart). `RunDO` (SQLite-backed,
  already bound) hosts the pre-voice runner.

### 1.2 Your ports and state

`--persist-to` is resolved relative to `apps/worker` by `scripts/dev.mjs`.

| Who | Command (keyless) | Web / worker | State |
|---|---|---|---|
| A worker | `pnpm dev --mock --mock-media --no-watch --worker-port 8851 --web-port 5151 --persist-to .wrangler/state-a` | 5151 / 8851 | `apps/worker/.wrangler/state-a` |
| B web | `pnpm dev --mock --mock-media --no-watch --worker-port 8852 --web-port 5152 --persist-to .wrangler/state-b` (also `--mock` alone to see the browser-voice path) | 5152 / 8852 | `apps/worker/.wrangler/state-b` |
| C audio + avatar | unit tests; if a page is needed: `… --worker-port 8853 --web-port 5153 --persist-to .wrangler/state-c` | 5153 / 8853 | `apps/worker/.wrangler/state-c` |
| Integrator | `pnpm e2e` (5183/8797 and 5184/8798, its own state) | — | `.wrangler/e2e-*` |

- Stop what you start. Builders do not run `pnpm e2e` (its ports are fixed and shared); the integrator runs it once.
- Builders never run keyed. `--mock` blanks every key; never open `apps/worker/.dev.vars`; never touch `reference/**`;
  never edit `catalog/**` (read-only here). Keys stay server-side; nothing key-shaped in frames, logs or responses.
- The repository is a git repo: **do not commit**.

### 1.3 Honesty and quiet (checked in review)

- **Grounded or silent (H1, L2).** Every slot value comes from state or the cause event. A line whose slots do not
  resolve is never picked. The owner has no name setting yet, so `owner_name` is always unresolvable in 0.5 (lines
  that use it are filtered out, by design).
- **No claims of work not done (H2).** Completion and progress lines need a real cause event. Coworkers are not
  staffed in 0.5: their quick-chat never claims, offers or promises work.
- **No fake busyness (H5, L3).** `juggling` and `back_with_you` fire only on real voice contention (§8.1).
- **Laughter never at the owner (H4).** Laughs only on humor cues; nothing after distress, frustration or errors.
- **Every voiced micro-utterance is captioned (L6).** Talk: the live caption line; Floor: the bubble.
- **Never over the owner (L5).** Only a backchannel inside a real pause, cancelled the moment the owner resumes.
- **Nothing plays on page load (X4 amended).** Audio needs a gesture in this session and voice on.
- **Ambience and the chatter budget govern chatter.** Owner-directed replies (phatic replies, acknowledgements,
  fillers, quick-chat answers) are exempt.

### 1.4 Keyless must work

| Mode | Reflex TTS provider | Reflex voice | Pre-voice | Mouth |
|---|---|---|---|---|
| Keyed (xAI or OpenAI TTS) | `xai` / `openai` | pre-voiced clips; runtime renders for slotted lines | Chief P0 on Talk open, then P1 | xAI alignment; OpenAI text timing over the clip |
| `--mock --mock-media` | `mock` | Mock clips (silent audio with character timing) | instant | alignment |
| `--mock`, `--local` | `browser` | `speechSynthesis` for verbal lines; nonverbal lines face only | none | text-timed |
| Voice off (any) | — | none: captions, bubbles and faces | as above | — |

### 1.5 Done means

`pnpm typecheck` and `pnpm test` green for your packages (the 176 expressions tests included), your acceptance
checks in §4–6 demonstrated on your own ports, no TODOs or stubs left (the §3.1 stubs are replaced), and a short
note of anything you could not verify.

---

## 2. Ownership map

| Owner | May edit | Must not edit |
|---|---|---|
| **A · worker** | `apps/worker/src/**` (router `index.ts`, `env.ts` and `lib/**` included for Inc 0.5), `apps/worker/test/**` (fake cloud: additive), `apps/worker/migrations/*` (none needed; §1.1), `packages/protocol/src/ext/expressions.ts` (new) and the §3.1 core protocol edits, `packages/expressions/src/events.ts` + `events.test.ts` (additive, §3.8) | `apps/web/**`, `packages/audio/**`, `packages/avatar/**`, other `packages/expressions` files |
| **B · web** | `apps/web/src/**`, `packages/expressions/src/runner.ts`, `runner.test.ts` and `types.ts` (additive, §3.8) | `apps/worker/**`, `packages/protocol/**`, `packages/audio/**`, `packages/avatar/**` |
| **C · audio + avatar** | `packages/audio/**`, `packages/avatar/**` | everything else |
| **Integrator** | Phase 0 (§3.1) when run before fan-out; afterwards root `package.json`, `scripts/dev.mjs`, `packages/expressions/package.json` + `scripts/**`, `apps/*/package.json`, `playwright.config.ts`, `e2e/**`, `docs/dev/CONTRACTS.md`, `docs/dev/INC0.md` | the builders' files (ask) |

**Phase 0 (contract landing) runs first.** If the orchestrator has an integrator step before fan-out, the integrator
applies §3.1 verbatim. Otherwise **A applies §3.1 as its first action** (including the two `apps/*/package.json`
dependency lines and the `packages/expressions/package.json` export, which are otherwise outside A's area) and
nothing else outside its area. B and C code against §3 as written from minute one.

**API-surface-first rule.** B depends on C's new methods and A's routes. So C lands the §3.6/§3.7 type additions
with minimal implementations (drop/ignore) in its first step, and A lands route stubs in Phase 0; both then implement
behind the same signatures. Nobody changes a §3 signature without the integrator.

---

## 3. Contracts

### 3.1 Phase 0 — verbatim edits

**P0-1 · `packages/expressions/package.json`.** Add the bundle export and pin TypeScript (INC0 known gap):

```jsonc
"exports": {
  ".": "./src/index.ts",
  "./testing": "./src/testing.ts",
  "./bundle": { "types": "./scripts/bundle.d.ts", "default": "./generated/expressions.json" }
},
"devDependencies": { "@headcount/protocol": "workspace:*", "typescript": "^7.0.2" }
```

and create `packages/expressions/scripts/bundle.d.ts` (so TypeScript never infers a type from the 2.9 MB JSON):

```ts
import type { ExpressionCatalogInput } from '../src/types';
declare const bundle: { kind: 'expression_bundle'; version: string; input: ExpressionCatalogInput };
export default bundle;
```

**P0-2 · dependencies.** Add `"@headcount/expressions": "workspace:*"` to `dependencies` in `apps/worker/package.json`
and `apps/web/package.json`, then `pnpm install --offline` (links only; fall back to `pnpm install`). The worker is the
only importer of `@headcount/expressions/bundle`; the web fetches it (§3.2).

**P0-3 · `packages/protocol/src/ext/expressions.ts` (new).** Structural mirrors of `@headcount/expressions` types
(protocol cannot depend on it). A's `apps/worker/src/expr/conformance.test.ts` asserts both directions assign.

```ts
// Inc 0.5 wire types of the living-workforce layer (docs/LIVING-WORKFORCE.md §10.4, docs/dev/INC05-PLAN.md §3).
// Structural mirrors of @headcount/expressions (protocol cannot depend on it); a worker conformance test keeps them equal.
import type { AgentId, MessageId, OpId, StreamId, TurnId } from '../ids';
import type { Alignment, VoiceRef } from '../voice';

// ── vocabulary ──────────────────────────────────────────────────────────────────
export type Ambience = 'quiet' | 'lively' | 'buzzing';
export const AMBIENCES: readonly Ambience[] = ['quiet', 'lively', 'buzzing'];
export const DEFAULT_AMBIENCE: Ambience = 'lively';
export const isAmbience = (v: unknown): v is Ambience => v === 'quiet' || v === 'lively' || v === 'buzzing';
/** Settings written before Inc 0.5 carry no ambience: that means Lively. */
export const ambienceOf = (s: { ambience?: Ambience | undefined } | null | undefined): Ambience => s?.ambience ?? DEFAULT_AMBIENCE;

export type ExprIntentId =
  | 'backchannel' | 'acknowledge' | 'thinking_filler' | 'holding_filler' | 'deferral'
  | 'laugh' | 'surprise' | 'delight' | 'concern' | 'sympathy' | 'encouragement'
  | 'gratitude_reply' | 'apology' | 'yield_floor' | 'juggling' | 'back_with_you'
  | 'greeting' | 'passing_by' | 'micro_status' | 'quip' | 'sign_off'
  | 'handoff_give' | 'handoff_take' | 'ask_coworker' | 'answer_coworker' | 'share_result'
  | 'review_approve' | 'review_changes' | 'sidetalk_reply'
  | 'celebrate' | 'blocked' | 'unblocked' | 'oops';
export type ExprSlotId =
  | 'owner_name' | 'chief_name' | 'self_name' | 'coworker' | 'project' | 'client' | 'step_label' | 'artifact'
  | 'done' | 'total' | 'eta' | 'other_thread' | 'blocker' | 'finding_count' | 'weekday' | 'part_of_day' | 'gist';
export type ExprSlotValues = Partial<Record<ExprSlotId, string>>;
export type ExprTtsProvider = 'xai' | 'openai' | 'browser' | 'mock';
export type FaceGesture =
  | 'none' | 'nod' | 'double_nod' | 'look_up' | 'brow_flash' | 'head_tilt' | 'smile' | 'wince' | 'exhale' | 'glance' | 'still';
export type PaletteState = 'resting' | 'thinking' | 'delighted' | 'concerned';
export type ReactHint = 'laugh' | 'surprise' | 'delight' | 'concern' | 'sympathy' | 'encouragement' | 'apology' | 'none';
export type MoodEventKind =
  | 'deliverable.accepted' | 'deliverable.accepted_edited' | 'verdict.approve' | 'verdict.changes' | 'verdict.block'
  | 'job.done' | 'step.retry' | 'job.failed' | 'step.blocked' | 'step.unblocked' | 'decision.approved' | 'decision.declined'
  | 'project.done' | 'teammate.win' | 'owner.thanks' | 'owner.praise' | 'owner.frustrated' | 'owner.distress'
  | 'hired' | 'everyone.stop' | 'work.hour';
export type ExprSurface = 'talk' | 'desk' | 'floor' | 'room' | 'elsewhere';
/** Where a talk.* frame belongs: the Talk transcript (absent = 'talk') or a Floor side-thread. */
export type TalkSurface = 'talk' | 'floor';
export type AttentionKind = 'talk' | 'desk' | 'sidethread' | 'meeting' | 'ask' | 'work';
export type ExprSliderKey = 'warmth' | 'directness' | 'formality' | 'humor' | 'risk_appetite' | 'detail' | 'pace';
export type ExprTeamRole = 'lead' | 'co_owner' | 'reviewer' | 'sceptic' | 'facilitator' | 'specialist';
export type ExprSeniority = 'specialist' | 'senior' | 'lead' | 'principal';

export interface ExprMood { valence: number; energy: number }
export interface ExprCause { streamId: StreamId; seq: number }
export interface FaceCue { gesture: FaceGesture; expression?: PaletteState; weight?: number; holdMs: number }
export interface ExpressionBias {
  expression: PaletteState; weight: number; cornerPull: number; brow: number; pitchDeg: number; blinkScale: number; swayScale: number;
}

// ── ephemeral frame data (agentId/turnId stay `string`, as in @headcount/expressions) ──
export interface ReflexSayData {
  agentId: string; intent: ExprIntentId; lineId: string; fillKey: string; caption: string;
  gloss?: string;
  clip: { key: string; url: string; durationMs: number; alignmentUrl: string | null } | null;
  render: { lineId: string; fills: ExprSlotValues } | null;
  channels: { voice: boolean; bubble: boolean; caption: 'line' | 'reaction' | 'none' };
  face: FaceCue; gainDb: number; priority: number; ttlMs: number;
  audience: 'owner' | 'floor' | 'room'; threadId?: string; turnId?: string; gen?: number; cause?: ExprCause;
}
export interface ReflexFaceData { agentId: string; cue: FaceCue; cause?: ExprCause }
export interface SideTalkLineData {
  threadId: string; index: number; projectId: string; agentId: string; toAgentId: string; intent: ExprIntentId; lineId: string;
  text: string; opener: string; gist: string | null;
  clip: { key: string; url: string; durationMs: number } | null;
  voice: 'never' | 'listen_in' | 'floor_audio'; atMs: number; expiresAt: string; replyable: boolean; cause: ExprCause;
}
export interface MoodChangedData {
  agentId: string; valence: number; energy: number; at: number; baseline: ExprMood; bias: ExpressionBias;
  reason: MoodEventKind; cause?: ExprCause;
}
export interface AttentionChangedData {
  agentId: string;
  focus: { threadId: string; kind: AttentionKind; label: string } | null;
  background: { threadId: string; kind: AttentionKind; label: string }[];
  voiceBusyUntil: string | null; floorHeld: boolean;
}

// ── agent profile and clip manifest ─────────────────────────────────────────────
/** Mirror of AgentExpressionProfile. The worker is the single source; the web builds its AgentIndex from it. */
export interface ExprAgentProfile {
  agentId: string; personaId: string; firstName: string;
  personality: { sliders: Record<ExprSliderKey, number>; traits: readonly string[]; roles?: readonly ExprTeamRole[]; seniority?: ExprSeniority; leadId?: string };
  voice: VoiceRef; teamRole?: ExprTeamRole | 'chief';
}
/** Mirror of ClipManifest: rendered clips only. Key: `${lineId}|${fillKey}`. */
export interface ExprClipManifest {
  agentId: string; catalogVersion: string; provider: ExprTtsProvider; voiceKey: string;
  clips: Record<string, { clipKey: string; durationMs: number; scope: 'shared' | 'workspace'; pronunciationChecked?: boolean }>;
}

// ── HTTP ────────────────────────────────────────────────────────────────────────
/** GET /api/expr/catalog. `input` is an ExpressionCatalogInput: pass it to compileCatalog(). */
export interface ExprCatalogBundle { kind: 'expression_bundle'; version: string; input: unknown }

export type ExprPrevoiceTier = 'p0' | 'p1' | 'p2';
export interface ExprPrevoiceStatus {
  runId: string; state: 'queued' | 'running' | 'done' | 'failed' | 'stopped_budget';
  provider: ExprTtsProvider; tiers: ExprPrevoiceTier[]; agentIds: string[];
  planned: number; cached: number; rendered: number; failed: number;
  startedAt: string; finishedAt?: string; error?: string;
}

/** GET /api/expr/agents/:agentId (cw_chief or cw_<personaId>). */
export interface ExprAgentResponse {
  agentId: string; personaId: string; catalogVersion: string;
  profile: ExprAgentProfile;
  /** Always false for catalog coworkers in Inc 0.5; true for cw_chief. */
  staffed: boolean;
  /** The renderer this agent's reflexes use right now (§3.5). */
  provider: ExprTtsProvider;
  voiceKey: string;
  manifest: ExprClipManifest;
  /** The latest pre-voice run that covered this agent, or null. */
  prevoice: ExprPrevoiceStatus | null;
  baseline: ExprMood; reactivity: number;
  /** null = no mood event yet (the face uses the baseline). */
  mood: MoodChangedData | null;
  attention: AttentionChangedData | null;
}

/** POST /api/expr/render. lineId: `<id>`, `<id>~prefix`, `<id>~tail` or `<id>~gist`. */
export interface ExprRenderRequest { agentId: string; lineId: string; fills: ExprSlotValues; provider: ExprTtsProvider }
export interface ExprClipRef {
  clipKey: string; url: string; alignmentUrl: string; durationMs: number; scope: 'shared' | 'workspace';
  /** True when the clip already existed (no TTS call, no budget used). */
  cached: boolean;
}
/** GET /api/expr/clips/:clipKey/align. `alignment` null → the mouth is text-timed over the clip. */
export interface ExprClipAlignment { clipKey: string; text: string; alignment: Alignment | null }

/** POST /api/expr/prevoice. Either plan server-side (agentIds + tiers) or pass a planPrevoice() plan as `items`. */
export interface ExprPrevoiceRequest {
  agentIds: string[];                       // 1–12
  tiers?: ExprPrevoiceTier[];               // default ['p0']
  perIntent?: number;                       // 1–24; default per tier (p0 6, p1 8, p2 4)
  allLinesFor?: ExprIntentId[];             // every line of these intents (LIVING-WORKFORCE §7.1)
  items?: { agentId: string; lineId: string; fills: ExprSlotValues }[];   // ≤ 400; each re-validated and re-keyed
  maxClips?: number;                        // this run's cap; default EXPR_PREVOICE_MAX_CLIPS (300)
  dryRun?: boolean;                         // plan and count only: no TTS, no budget
}
export interface ExprPrevoiceAccepted {
  accepted: true; runId: string | null; provider: ExprTtsProvider;
  planned: number; alreadyCached: number; toRender: number; estAudioMs: number; remainingToday: number;
  /** True when an equivalent run already completed (same agents, tiers, provider, voice and catalog version). */
  reused?: boolean; dryRun?: boolean;
}

/** POST /api/desk/:personaId/say: a Floor quick-chat message to a catalog coworker. */
export interface DeskSayRequest { text: string; opId: OpId; via?: 'text' | 'voice' }
export interface DeskSayAccepted { accepted: true; opId: OpId; agentId: AgentId; turnId: TurnId; messageId: MessageId; duplicate?: boolean }

// ── client → server socket ops (fire-and-forget) ────────────────────────────────
export interface ViewerOp {
  op: 'viewer';
  surface: ExprSurface;
  /** cw_chief on Talk, cw_<personaId> on a coworker's profile (their desk), else null. */
  stageAgentId: string | null;
  floorVisible: boolean;
  visibleProjectIds: string[];
  listeningProjectIds: string[];
  audioArmed: boolean;
  voiceOn: boolean;
  pageVisible: boolean;
  reducedMotion: boolean;
  quietHours: boolean;
  /** Date.prototype.getTimezoneOffset() of the owner's browser: server-side owner-local time (part of day, new day). */
  tzOffsetMin: number;
  /** An agent's voice that is audibly busy in this tab (conversation audio), until when (epoch ms). */
  voice: { agentId: string; untilMs: number } | null;
}
export interface ExprRecentOp { op: 'expr.recent'; agents: Record<string, string[]> }   // ≤ 32 line ids per agent
```

**P0-4 · core protocol edits (additive only).**

`packages/protocol/src/frames.ts`:
- `import type { AttentionChangedData, MoodChangedData, ReactHint, ReflexFaceData, ReflexSayData, SideTalkLineData, TalkSurface, ExprIntentId, ExprRecentOp, ViewerOp } from './ext/expressions';`
- `'talk.owner'` data gains `agentId?: AgentId` (the addressee; absent = the Chief of Staff) and `surface?: TalkSurface`.
- `'talk.delta'` data gains `surface?: TalkSurface` and `hint?: ReactHint` (first delta of a Chief turn only, after the
  `⟦react:…⟧` head token was stripped).
- `'talk.message'` data: `kind` becomes `'reply' | 'announcement' | 'status' | 'reflex'`; gains `surface?: TalkSurface`,
  `intent?: ExprIntentId` and `lineId?: string` (both only on `kind: 'reflex'`).
- `'talk.done'` data gains `agentId?: AgentId` (absent = the Chief of Staff) and `surface?: TalkSurface`.
- `FrameDataMap` gains `'reflex.say': ReflexSayData`, `'reflex.face': ReflexFaceData`, `'sidetalk.line': SideTalkLineData`,
  `'mood.changed': MoodChangedData`, `'attention.changed': AttentionChangedData`; all five join `EPHEMERAL_FRAME_TYPES`.
- `ClientSocketMessage` becomes `{op:'ping'; t?} | {op:'resume'; since} | ViewerOp | ExprRecentOp`.

`packages/protocol/src/api.ts`:
- `WorkspaceSettings` gains `ambience?: Ambience` (GET and PUT responses always fill it; absent in stored or replayed
  settings means Lively). `UpdateWorkspaceRequest` gains `ambience?: Ambience`.
- `WsClientMessage` gains `ViewerOp | ExprRecentOp`.

`packages/protocol/src/routes.ts` — `ROUTES` gains:

```ts
exprCatalog: { method: 'GET', path: '/api/expr/catalog', auth: 'owner' },
exprAgent: { method: 'GET', path: '/api/expr/agents/:agentId', auth: 'owner' },
exprClip: { method: 'GET', path: '/api/expr/clips/:clipKey', auth: 'owner' },
exprAlign: { method: 'GET', path: '/api/expr/clips/:clipKey/align', auth: 'owner' },
exprRender: { method: 'POST', path: '/api/expr/render', auth: 'owner', body: 'json', bodyCap: 8 * 1024 },
exprPrevoice: { method: 'POST', path: '/api/expr/prevoice', auth: 'owner', body: 'json', bodyCap: 128 * 1024 },
exprPrevoiceStatus: { method: 'GET', path: '/api/expr/prevoice/:runId', auth: 'owner' },
deskSay: { method: 'POST', path: '/api/desk/:personaId/say', auth: 'owner', body: 'json', bodyCap: 16 * 1024 },
```

`packages/protocol/src/ext/worker-core.ts`: `TalkRoute` gains `'reflex'` (a phatic turn answered without a model call).

**P0-5 · router stubs.** `apps/worker/src/index.ts` registers the eight new route ids to `notImplemented(route)` from
`lib/http.ts`, so `Record<RouteId, RouteHandler>` typechecks. A replaces them with the real handlers (fixed export
names: `expr/routes.ts` → `handleExprCatalog`, `handleExprAgent`, `handleExprClip`, `handleExprAlign`,
`handleExprRender`, `handleExprPrevoice`, `handleExprPrevoiceStatus`; `desk/routes.ts` → `handleDeskSay`).

Phase 0 exit: `pnpm typecheck` and `pnpm test` green, the owner's app still loads.

### 3.2 HTTP routes (A implements, B calls)

Every error body is `ApiErrorBody`; sentences are plain with their fix; missing providers name env vars only.

| Id | Behaviour | Errors | Caching |
|---|---|---|---|
| `exprCatalog` | Serves the worker's imported bundle (`ExprCatalogBundle`) as JSON. `ETag: "<version>"`; `If-None-Match` → 304. | — | `private, no-cache` + ETag |
| `exprAgent` | `ExprAgentResponse`. Builds the profile from the full catalog: the lead for `cw_chief` (`firstName` = `chiefDisplayName(lead, chiefName)`, `leadId`, `teamRole: 'chief'`, `voice: leadVoiceRef(lead)`), the persona for `cw_<personaId>` (`sliders`, `traits`, `roles: team_roles`, `seniority`, `voice: personaVoiceRef`). Manifest = rendered clips for (agent, voiceKey, catalog version). | 404 unknown agent or no lead chosen | `no-store` |
| `exprClip` | Clip bytes from R2 (shared prefix first, then this workspace's). Headers `Content-Type`, `X-Clip-Duration-Ms`. Key must match `^c1_[a-z2-7]{32}$`. | 400 bad key, 404 not rendered | shared: `public, max-age=31536000, immutable`; workspace: `private, max-age=31536000, immutable` |
| `exprAlign` | `ExprClipAlignment` (always has `text`; `alignment` when the provider gave one). | 400, 404 | as the clip |
| `exprRender` | Validates the agent, `renderUtterance(index, lineId, fills)` + `validateFills`, and that `provider` equals the agent's current provider (§3.5). `toDelivery` → `clipKey`. Returns the existing clip (`cached: true`) or renders it once in that provider (no failover: a clip keyed for xAI is xAI audio), stores it, records the manifest entry. → `ExprClipRef`. | 400 invalid fills, 404 unknown line, 409 provider changed (the body names the current one), 429 `EXPR_RENDER_PER_MIN` or `EXPR_CLIP_DAILY_LIMIT`, 503 no TTS (`browser` provider), 502 provider failed | `no-store` |
| `exprPrevoice` | Plans with `planPrevoice(index, catalog, provider, fills, {tiers, perIntent, allLinesFor, maxClips})` per agent, or re-validates `items` (unknown lines and invalid fills are skipped and counted). Removes clips already in R2 (recording them in the manifest without TTS), then enqueues the rest in the pre-voice runner (§4 A3). **Idempotent:** a completed run with the same fingerprint (agents, tiers, perIntent, allLinesFor, provider, voice keys, catalog version) is returned with `reused: true, toRender: 0`. `dryRun` returns the counts (200) and spends nothing. Provider `browser` → 200 with `planned: 0` (nothing to pre-voice). | 400, 404, 429 when nothing fits today's budget | 202 (`dryRun`/`reused`/browser: 200) |
| `exprPrevoiceStatus` | `ExprPrevoiceStatus`. | 404 | `no-store` |
| `deskSay` | Quick-chat to `cw_<personaId>` (§4 A11). Idempotent on `opId`. → 202 `DeskSayAccepted`; the reply streams on the workspace socket. | 400, 404 unknown persona, 413 over 2,000 chars, 429 `CHAT_DAILY_LIMIT` | — |

`PUT /api/workspace` also accepts `{ambience}` (400 unless `isAmbience`); every settings response carries `ambience`.

### 3.3 Frames and socket ops

All five expression frames are **ephemeral** (`after`, no `seq`), travel on the workspace stream, and are never
spoken or animated when replayed (they are never replayed: they are not persisted).

| Frame | Emitted by (A) | When | Consumer (B) |
|---|---|---|---|
| `reflex.say` | WorkspaceDO | §3.4 server column | the tab rules below, then `runner.frame()` |
| `reflex.face` | WorkspaceDO | `job.failed` at Talk (`wince`, `concerned`, 2,000 ms); an owner message to the Chief while a job runs (`glance`, 800 ms) | `runner.frame()` |
| `mood.changed` | WorkspaceDO | when `moodChanged(prev, next, prevBias, nextBias)` is true, else coalesced to ≤ 1 per 10 s per agent; never for pure decay; plus a snapshot on every socket connect (after presence) for agents with a mood event | mood cache → `runner.frame()` → face bias |
| `attention.changed` | WorkspaceDO | the Chief's background threads (running jobs) or voice claim changed; a snapshot on connect | `runner.frame()` |
| `sidetalk.line` | not emitted in 0.5 | Inc 1 | the runner handles it already |

`talk.*` frames of a desk quick-chat carry `agentId: cw_<personaId>` (on `talk.owner` and `talk.done` too) and
`surface: 'floor'`. They are persisted in `ws:<ws>` like Chief turns, are **excluded from the Chief's model history and
from the Talk transcript**, and are never spoken by the Chief's speaker.

**Which tab plays a `reflex.say`.** Owner-turn reflexes (with `turnId`) play only in the tab that sent that turn; event
reflexes (no `turnId`) only in a visible tab whose surface is that agent's stage. Other tabs apply the face cue only.

**Socket ops (B sends, A handles).** `viewer` is sent on connect (after `ready`) and on any change, debounced 250 ms.
The WorkspaceDO stores it in the socket's attachment (`serializeAttachment`, survives hibernation) and derives
"someone is at agent X's stage" = any socket with `surface ∈ {talk, desk}`, `stageAgentId === X` and `pageVisible`.
`expr.recent` is sent after each connect and at most every 10 s when it changed; the WorkspaceDO merges it into its
workspace recency memory so server picks avoid lines the client just played.

### 3.4 Who fires which reflex

The client runner owns the owner-turn timeline (it knows EOT, audio and VAD; LIVING-WORKFORCE §2.5). The server
fires what only it knows (model latency, tool calls, job events) and the phatic replies that must land in the
transcript. Dedupe key everywhere: `${agentId}|${intent}|${turnId}`; one `acknowledge` and one `thinking_filler` per
turn.

| Intent | Client runner (B) | Server, for the Chief (A) |
|---|---|---|
| `backchannel` | VAD pause 350–1,000 ms inside a hold-to-talk utterance ≥ 2.5 s: face nod always, soft voice by Ambience | — |
| `acknowledge` | at EOT on request or stop/steer cues (§1.3 spec) | after `start_background_job` succeeded in the turn; on `job.steered {queued}` with context `steer_queued` |
| `thinking_filler` | 700 ms voice / 2,500 ms text without a first token | safety net: no text delta 1,200 ms (voice) / 2,500 ms (text) after the server turn started |
| `holding_filler` | 3,500 ms without a speakable chunk (voice) | — |
| reactions (`laugh`, `surprise`, `delight`, `concern`, `sympathy`, `encouragement`, `apology`) | `sniffOwnerText` cues at EOT; `talk.delta.hint` within 1,200 ms; text turns: face only | — |
| `gratitude_reply`, `greeting`, `sign_off` as the whole reply | face reacts at once | phatic owner turn to the Chief or a coworker: no model call; persisted `talk.message {kind:'reflex'}` + `reflex.say` |
| `juggling`, `back_with_you` | owner sends while that agent's voice is busy with 2.5–8 s left (§2.3), then back after it | — (§8.1) |
| `greeting` (proactive) | Talk opens after ≥ 3 h away, a new day, or first meeting (never right after onboarding's greeting) | — |
| `passing_by`, `micro_status`, `quip`, `blocked`, `unblocked` | Floor or Chief-bubble hover dwell | — |
| `micro_status` (event) | — | mirrored `job.progress` or `job.steered {applied}` while someone is at Talk; coalesced per job (latest wins, TTL 20 s), held until the active turn ends (+400 ms), 2-min cooldown |
| `celebrate` | — | mirrored `job.done` while someone is at Talk, emitted before the announcement (a lead-in) |
| `oops` | — | ProjectDO `step.retry` signal (a failed attempt that will be retried) while someone is at Talk |
| `sign_off` (proactive) | leaving the app after ≥ 2 turns; 5 min of silence at an open stage | — |

### 3.5 Clips, providers, storage and budgets

**Provider per agent (server decides; B never guesses).** `registry.tryResolve('tts', {prefer, allowMock: MOCK_MEDIA})`
with `prefer` built like `chooseVoice` (`xai` when the voice has an xAI id, then `openai`). Resolved `xai`/`openai` with
a voice id for it → that provider; resolved Mock → `mock`; nothing → `browser`. The same function serves
`exprAgent`, `exprRender`, `exprPrevoice` and the server reflex planner.

**Clip key.** `clipKey(toDelivery(utterance, profile.voice, provider))` from the engine (content-addressed; identical in
worker and browser). Pass `model` to the TTS call only for OpenAI (xAI ignores it). Chief lines with `self_name` are
`workspace` scope when the owner renamed the Chief (their chosen name is workspace data, H8); otherwise the engine's
`PrevoiceItem.scope` rules apply.

**R2 layout.**

| Scope | Audio | Alignment |
|---|---|---|
| shared (no tenant data) | `expr/clips/<clipKey>.<mp3\|wav>` | `expr/clips/<clipKey>.align.json` |
| workspace | `ws/<ws>/expr/<clipKey>.<ext>` | `ws/<ws>/expr/<clipKey>.align.json` |

Audio `customMetadata`: `{durationMs, mime, provider, voiceKey, scope, lineId, fillKey, catalogVersion, alignment: 'chars'|'none', createdAt}`.
Duration: WAV header; MP3 frame scan (Xing/VBRI aware); else the alignment's last `endsMs` + 120 ms.

**WorkspaceDO tables (new, `CREATE TABLE IF NOT EXISTS`).**
- `expr_manifest (agent_id, voice_key, catalog_version, line_key, clip_key, duration_ms, scope, tier, at, PRIMARY KEY (agent_id, voice_key, catalog_version, line_key))` — rows for older catalog versions are pruned on write.
- `expr_mood (agent_id PRIMARY KEY, state TEXT /* MoodState JSON */, emitted_at INTEGER)`.
- `expr_recent (id INTEGER PRIMARY KEY CHECK (id = 1), snapshot TEXT)` — saved debounced (≤ 1 per 5 s).
- `expr_rate (minute TEXT PRIMARY KEY, count INTEGER)` — `EXPR_RENDER_PER_MIN`, pruned hourly.

**RunDO (`run:expr-prevoice:<ws>`, one per workspace) tables.** `prevoice_runs (run_id PK, fingerprint, request, state,
provider, planned, cached, rendered, failed, started_at, finished_at, error)`, `prevoice_items (run_id, clip_key,
agent_id, line_key, tier, delivery TEXT, scope, state, PRIMARY KEY (run_id, clip_key))`.

**Env (all optional; defaults in code; declared in `env.ts`).**

| Var | Default | Meaning |
|---|---|---|
| `EXPR_CLIP_DAILY_LIMIT` | 600 | Clip renders per UTC day (runtime + pre-voice), counted in D1 `media_usage` kind `expr_clip` (existing table). Mock renders are free and uncounted. |
| `EXPR_RENDER_PER_MIN` | 30 | Runtime renders (`exprRender`) per minute, counted in the WorkspaceDO. |
| `EXPR_PREVOICE_MAX_CLIPS` | 300 | Default and ceiling (600) for one pre-voice run. |

Quick-chat turns count against the existing `CHAT_DAILY_LIMIT`; a phatic turn answered by a reflex gives its count back.

### 3.6 Audio engine API (C implements, B calls)

Additive to `packages/audio/src/types.ts` and `AudioEngine`; existing behaviour and tests unchanged.

```ts
export type AudioBus = 'conversation' | 'reflex' | 'ambient';

/** A clip decoded once and played many times (opaque: holds the AudioBuffer). */
export interface PreparedAudio {
  readonly key: string;
  readonly durationMs: number;
  readonly alignment: Alignment | null;
  /** Spoken text: the mouth is text-timed over the clip when there is no alignment. */
  readonly text: string | null;
  /** Decoded size in bytes, for the client's LRU. */
  readonly bytes: number;
}

export interface PlayPreparedRequest {
  speakerId: string;
  audio: PreparedAudio;
  bus: 'reflex' | 'ambient';
  /** dB on top of the speaker's gain (backchannel −8, passing-by −4, side-talk −6). */
  gainDb: number;
  /** intents.json priority class, 1 (juggling, phatic replies) … 6 (quips). Lower is more important. */
  priority: number;
  /** Must start within this many ms of the call, else it is dropped — never started late. */
  ttlMs: number;
  /** 'interject': wait (≤ ttlMs) for this speaker's next conversation chunk boundary, play, then the conversation resumes. */
  mode?: 'now' | 'interject';
  /** May play while the owner's mic is live (a backchannel inside a real pause). */
  duringOwner?: boolean;
  onStart?(): void;
}

export interface ReflexHandle {
  /** Resolves true when the first sample is heard, false when dropped. */
  readonly started: Promise<boolean>;
  /** Never rejects. */
  readonly done: Promise<'completed' | 'stopped' | 'dropped'>;
  /** 60 ms fade, idempotent. */
  stop(): void;
}

export interface SpeakerActivity {
  /** A conversation utterance (speak()) is sounding or queued for this speaker. */
  conversation: boolean;
  reflex: boolean;
  ambient: boolean;
  /** Heard-time ms left of conversation audio already decoded and scheduled; null when none is scheduled. */
  remainingMs: number | null;
  /** More conversation chunks may still arrive (the stream has not ended). */
  streamOpen: boolean;
}

/** Owner voice activity while a recording mic is live. `at` is epoch ms (Date.now()). */
export interface OwnerVadEvent { kind: 'start' | 'pause' | 'resume' | 'end'; at: number; pauseMs?: number; utteranceMs: number }

// AudioEngine gains:
prepare(bytes: ArrayBuffer, opts?: { key?: string; mime?: string; alignment?: Alignment | null; text?: string }): Promise<PreparedAudio>;
playPrepared(req: PlayPreparedRequest): ReflexHandle;
/** Keyless path: a short line in the browser voice on the reflex/ambient bus. null when speechSynthesis is unavailable. */
speakReflexText(req: { speakerId: string; text: string; bus: 'reflex' | 'ambient'; priority: number; ttlMs: number; voiceHint?: BrowserVoiceHint; onStart?(): void }): ReflexHandle | null;
activity(speakerId: string): SpeakerActivity;
/** Any conversation utterance is sounding or queued, for any speaker. */
foregroundActive(): boolean;
stopReflexes(filter?: { speakerId?: string; bus?: 'reflex' | 'ambient' }): void;
/** The speaker's conversation utterance ends after the chunk now playing (a sentence boundary); queued chunks are dropped. */
stopAtBoundary(speakerId: string): void;
onOwnerVad(cb: (e: OwnerVadEvent) => void): () => void;
```

**Semantics (the priority ladder: owner > answer > reflex > ambient).**

1. **Owner speaking** (a recording mic is live). Voices stay ducked 18 dB (existing). `playPrepared` without
   `duringOwner` is dropped. With `duringOwner` it plays on the reflex bus ducked only 6 dB (so a −8 dB "mm-hm" is
   soft but audible); the runner calls `stopReflexes({speakerId})` the moment VAD reports `resume` (60 ms fade).
2. **An answer is sounding** (conversation audio of any speaker). Reflex and ambient requests for *other* speakers are
   dropped. For the *same* speaker, `mode: 'interject'` waits for the next chunk boundary (≤ `ttlMs`, else dropped);
   `'now'` is dropped.
3. **A reflex is sounding for speaker S** and `speak()` starts for S: the conversation starts right after the reflex
   (the reflex is capped by its intent's `max_ms`, ≤ 2.5 s). `speak()` for another speaker fades the reflex out.
4. **One reflex voice at a time** (safety net; the runner enforces it too): a new reflex is dropped unless its
   `priority` is lower (more important), in which case the playing one fades out.
5. **Ambient** plays only when nothing else sounds; it is faded out when a conversation or reflex starts.
6. **Lip sync.** Prepared audio goes through the same per-speaker channel (speaker gain → analyser tap), so
   `sampler(speakerId)` follows it: provider alignment first, else `text` timed over the clip, else energy.
7. **Presence.** `speaking()` and `onSpeakingChange` keep reporting conversation audio only; reflexes move the mouth
   but never flip the face to "Speaking".
8. **Latency.** With an armed context and nothing blocking, sound starts ≤ 30 ms after `playPrepared`.
   `prepare()` works before `arm()` (decodes on an `OfflineAudioContext` when the main context does not exist yet).
9. **VAD.** While a `startPushToTalk` recording is live, sample `MicSession.level()` at 20 Hz: `start` on the first
   level ≥ 0.04; `pause` after level < 0.02 for ≥ 350 ms (with `pauseMs` so far, emitted once per pause); `resume` when
   level ≥ 0.04 again; `end` when the session stops. Browser dictation emits nothing (no level; §9).

### 3.7 FaceView API (C implements, B calls)

Additive to `FaceViewApi` in `packages/avatar/src/types.ts`; types come from `@headcount/protocol/ext/expressions`.

```ts
/** A reflex gesture (+ optional palette expression) for cue.holdMs. Latest cue wins. */
cue(cue: FaceCue): void;
/** The mood palette (mood.changed / expressionBias). null → neutral. */
setExpressionBias(bias: ExpressionBias | null): void;
```

- **Tiers.** Hero and tile animate gestures. Tokens ignore gestures and apply `expression`/bias as one static redraw.
- **Reduced motion.** Gestures are omitted; `expression` and bias apply statically, without easing; lip sync
  unchanged.
- **Test hooks.** While a gesture plays (not under reduced motion) the mount element carries
  `data-face-cue="<gesture>"`; it always carries `data-face-expression="<palette state>"`.
- **Budget.** No new rAF: a cue wakes the face in the shared scheduler; a cued tile counts as animating for the
  cue's duration (it takes a slot from the least recently active tile); the 6 ms tile budget is unchanged. No new
  portraits or image assets: everything is warp and pose parameters.

| Gesture | Pose (FacePose units; pitch up = +) | Timing |
|---|---|---|
| `nod` | pitch −0.22 → 0 | 380 ms |
| `double_nod` | two nods of −0.18 | 2 × 300 ms |
| `look_up` | pitch +0.25, lean +0.4, yaw → 0 (toward the viewer), brow flash 0.6 for 150 ms | ease in 150 ms, hold `holdMs`, ease out 300 ms |
| `brow_flash` | brow 0.7 | 180 ms |
| `head_tilt` | swayRot +0.05 rad | hold, ease out 300 ms |
| `smile` | cornerPull +0.35 (×0.4 while speaking) | hold `holdMs` |
| `wince` | brow 0.3, cornerPull −0.15, blink 0.35 for 180 ms | hold `holdMs` |
| `exhale` | pitch −0.12, one breath cycle | 600 ms |
| `glance` | yaw ±0.3 (seeded side) → 0 | 300 ms out, back by 800 ms |
| `still` | sway, breath and blink frozen | `holdMs` |

Head gestures blend at 50% amplitude while the face is speaking. A cue's `expression` overrides the bias for
`holdMs`, then the bias returns.

**Bias mapping** (the numbers from `expressionBias()` are final; the presets are already baked in):
`cornerPull` adds to the rest mouth's corner pull (×0.4 while speaking), `brow` adds to the brow raise, `pitchDeg / 12`
adds to pose pitch, `blinkScale` multiplies the blink interval, `swayScale` the sway amplitude. `expression` +
`weight` add only what parameters cannot show: `concerned` raises the inner brow on the illustrated face
(`browInner = 0.4 × weight`); the portrait renderer shows brows only at tier 1 and ignores the inner brow. Bias eases
over 300 ms; a change of `expression` holds ≥ 1.2 s before the next change.

### 3.8 `packages/expressions` changes allowed in 0.5

The engine stays as built (176 tests green). Only these additive changes:

- **A · `events.ts`.** `ServerReflexArgs` gains `instantOnly?: boolean` and `clips?: ClipAvailability`, forwarded to
  `selectLine`, so reflex-grade server picks (`acknowledge`, `thinking_filler`) choose only lines already in the
  manifest. Tests in `events.test.ts`.
- **B · `runner.ts` / `types.ts`.** (R1) `fire()` returns false when `played` already holds
  `${agentId}|${intent}|${turnId}` (a server frame played first). (R2) `playServerSay()` marks a known turn covered:
  `thinking_filler` → `turn.fillerAt ??= now()`, `holding_filler` → `turn.holdingDone = true`, `acknowledge` or a
  reaction → `turn.reacted = true`, and cancels the runner's pending item of that intent for that turn. (R3)
  `ReflexTelemetry.turnId?: string`. Tests for both orders in `runner.test.ts`.

---

## 4. Builder A — worker

New code lives in `apps/worker/src/expr/**` (catalog, profiles, grounding, clips, pre-voice, reflexes, mood,
attention) and `apps/worker/src/desk/**` (quick-chat). The WorkspaceDO stays the single writer of the owner feed, mood,
viewer state and manifests. Nothing on the talk path awaits a clip, a TTS call or another object's model call.

**A0 · Phase 0** (§3.1) if assigned. Then keep the owner's worker loadable at every save.

**A1 · Catalog in the worker.** `expr/catalog.ts`: `import bundle from '@headcount/expressions/bundle'`; compile lazily
once per isolate (`compileCatalog(bundle.input)`, ~300 ms; never on the 202 path: the phatic sniff uses
`bundle.input.intents.affect_lexicon` directly). Profile builders for the lead and personas (§3.2 `exprAgent`), an
`AgentIndex` cache (LRU 64, keyed by agent + profile hash), the Chief's index rebuilt on lead or name change, and
`exprProviderFor(voice)` (§3.5).

**A2 · Clip service.** `expr/clips.ts`: `renderClip(env, delivery, meta)` → TTS in exactly `delivery.provider`
(`withAlignment: true`; voice `{xai: voiceId, speed}` or `{openai: voiceId, speed, instructions}`), R2 put with
metadata and `.align.json`, idempotent by `clipKey` (R2 head first; an in-isolate in-flight map joins concurrent
renders), budget (`EXPR_CLIP_DAILY_LIMIT` via `consumeDaily(db, ws, 'expr_clip', limit)`, refunded when the provider
failed; Mock free), manifest row via a WorkspaceDO RPC. Routes `exprClip`, `exprAlign`, `exprRender` (§3.2).

**A3 · Pre-voice runner.** `exprPrevoice` plans (§3.2) and hands the queue to `RunDO` named `run:expr-prevoice:<ws>`
(`runs/run-do.ts`, A-owned in 0.5): an alarm loop renders up to 3 clips in parallel per tick, P0 before P1 before P2
and by prior within a tier, records each in the manifest, stops with `stopped_budget` when the daily budget runs out,
survives restarts (state in its SQLite), and answers `exprPrevoiceStatus`. It never runs on its own: only an explicit
`POST /api/expr/prevoice` starts work.

**A4 · `exprCatalog` and `exprAgent`** (§3.2), including `mood`, `baseline`, `reactivity` and `attention`.

**A5 · Ambience setting.** `WorkspaceSettings.ambience` stored with the other settings; `getSettings()` fills `'lively'`;
`PUT` validates with `isAmbience`; `workspace.updated` carries it. The server gate and chatter budget use it.

**A6 · Socket ops and connect snapshots.** Handle `viewer` (validate every field; store in the socket attachment;
recompute the stage map) and `expr.recent` (merge into the recency memory with each line's `textHash` from the
compiled lines). On connect, after the presence snapshot: `mood.changed` for agents with a mood event and
`attention.changed` for the Chief. Server time for grounding uses the latest viewer's `tzOffsetMin` (UTC when none).

**A7 · Mood.** One `MoodState` per agent that has had an event (`createMoodState(agentId, index.baseline,
index.reactivity, now)`), persisted in `expr_mood`, folded with `applyMoodEvent` (`{sceptic}` never applies in 0.5).
Events, all real:
- the owner's text to that agent (Chief turns and quick-chat), from `sniffOwnerText`: `owner.thanks` (gratitude ≥ 0.6),
  `owner.praise` (praise ≥ 0.6), `owner.frustrated` (frustration ≥ 0.5), `owner.distress` (distress);
- the Chief's jobs: `job.done`, `job.failed`, `step.retry` (A9), each with its `cause`.
Emit `mood.changed` per §3.3 with `moodChangedData(state, now, presence)`.

**A8 · Attention.** The Chief's threads: one `work` thread per running job (`job:<id>`, label `“<title>” (step n of m)`)
plus a voice claim from the viewer op's `voice`. Merge with `mergeAttention`; emit `attention.changed` on change. In the
Chief's prompt (`chief-prompt.ts`), add to the role directive: when a job is running and the owner asks about something
else, the reply may mention it in a few words ("the supplier search is still going — step 3 of 5"), never as a reason
to wait.

**A9 · Server reflexes for the Chief** (`expr/reflexes.ts`, called from the WorkspaceDO; each builds a grounded
`GroundingState` for the Chief — presence `working` while a job runs, `work: {stepLabel: label, done: step − 1, total:
of}`, `owner.firstName: null`, owner-local time from `tzOffsetMin` — and calls `planServerReflex` with the viewer, the
workspace recency, the manifest, a server `TimingGate` + `ChatterBudget` for the current Ambience, and
`instantOnly` for reflex-grade intents):
- **Phatic closure** in `talk()`: `sniffOwnerText(text, lexicon)`; when `phatic && !distress && !sincereAi`, skip the
  model, give the chat count back, and in the turn's background task pick `gratitude_reply` / `greeting` / `sign_off`
  (context `owner_praise` / `owner_greeting` / `owner_farewell` as the spec's `context_first` requires), append
  `talk.message {kind:'reflex', intent, lineId, text: caption}` and `talk.done {route:'reflex'}` in one transaction, and
  emit `reflex.say` (with its clip when rendered, else `render`) with the `turnId`. Chief presence goes thinking →
  idle as for any turn.
- **`thinking_filler` safety net** (§3.4) from a `setTimeout` in the turn; cancelled by the first text delta.
- **`acknowledge`** via a new `onDelegated(jobId)` hook in `chief-tools.ts` after `start_background_job` succeeds, and on
  mirrored `job.steered {status:'queued'}` (context `steer_queued`; with the turn's `turnId` when the steer came from a
  tool in a turn).
- **`micro_status`** on mirrored `job.progress` and `job.steered {applied}` (context `steer_queued`), only when
  `done ≥ 1` or a steer applied, coalesced and deferred per §3.4.
- **`celebrate`** on mirrored `job.done` with `work.artifact = sanitize(job title)`; emitted and broadcast before the
  announcement in the same `ingest` call.
- **`oops`** on a new ProjectDO signal: `MirrorBatch` gains `signals?: {kind:'step.retry'; jobId; attempt; at}[]`, sent
  from the retry branch of `advance()` (attempt < `MAX_ATTEMPTS`, retryable) even when no frame is pending; the
  WorkspaceDO folds mood and plans `oops`.
- **Faces:** `reflex.face` on `job.failed` and on owner messages while a job runs (§3.3).

**A10 · Reaction hint.** Add to the Chief's role directive: an optional single head token
`⟦react:laugh|surprise|delight|concern|sympathy|encouragement|apology|none⟧` when the owner's message clearly calls for
it (never laughing at a problem), and "do not open with an acknowledgement such as 'On it' or 'Sure'; the office plays
one for you". In `runChiefTurn`, buffer the head while `maybeReactHintPrefix(head)` is true, then `parseReactHint`: the
first `talk.delta` carries `hint` and only the rest of the text. The token never reaches a delta, the persisted
message, the history or TTS.

**A11 · Desk quick-chat** (`desk/`). `deskSay(personaId, req)` on the WorkspaceDO:
- Idempotent on `opId` (the `ops` table); `CHAT_DAILY_LIMIT`; ≤ 12 per minute per workspace.
- Appends `talk.owner {agentId, surface:'floor', …}`; a new message to the same coworker cuts that coworker's reply
  still streaming (as the Chief's turns do); it never touches the Chief's turn. Presence claim `desk` for that agent:
  thinking during the turn.
- Phatic turns use A9's phatic path in the coworker's voice.
- Otherwise a fast-tier turn, no tools, `callBudget(provider, model, 160, 'none')`, history = the last 12 floor
  messages with that coworker. The system prompt: platform rules (AI honesty; no real-world actions), the persona from
  the full catalog (name, pronouns, title, department, one-liner, a short backstory, traits, temperament, humor, intro
  line), the status "You are not on any project yet: no tasks, no tools, no files. Never say you are working on,
  starting, finishing or will deliver anything; if the owner asks for work, say {chief} can bring you onto a project",
  and the style: at most two short sentences, spoken style, no Markdown, no exclamation marks.
- **Honesty guard.** Deltas are released one complete sentence at a time; a sentence that claims or promises work or a
  completed external action (`/\b(I|I'm|I've|I'll|we|we're|we've|we'll)\b[^.?!]{0,40}\b(working on|started|starting|finished|finishing|sent|emailed|booked|paid|published|deployed|shipped|drafted|drafting|researched|researching|looking into|will (do|send|draft|research|look))\b/i`)
  is replaced by "I'm not on a project yet — {chief} can bring me in." and logged (no text).
- Frames per §3.3; `talk.done {agentId, surface:'floor', route:'answer'}`.
- The Chief's `historyFromFrames` input and the announcement logic ignore `surface: 'floor'` frames and messages from
  other agents.

**A12 · Tests** (Vitest, `createTestEnv()`; extend `test/fake-cloud.ts` additively where needed):
- conformance: protocol mirrors ⇄ engine types, both directions;
- clips: render once then `cached`, R2 keys and metadata by scope, WAV and MP3 duration, provider mismatch 409,
  invalid fills 400, unknown line 404, per-minute and daily budgets 429, Mock free, `browser` 503;
- pre-voice: plan counts, cached clips skipped and recorded, idempotent reuse, `dryRun` spends nothing, budget stop,
  resume after a new instance;
- phatic: "thanks" makes no model call (scripted registry), persists `kind:'reflex'`, refunds the chat count, emits
  `reflex.say`; a question with "thanks" in it is not phatic;
- reflexes: filler safety net with a gated provider (and none after a delta), acknowledge on delegate, `micro_status`
  deferred until `talk.done` then emitted once, cooldown, no viewer → nothing, `celebrate` broadcast before the
  announcement, `oops` on the retry signal, `reflex.face` on failure;
- mood: fold, persistence, emission thresholds and the connect snapshot; attention on job start and finish;
- viewer attachment survives a hibernation round trip; `expr.recent` merge;
- desk: frames carry `agentId` and `surface`, the Chief's history excludes them, the guard rewrites a work claim, the
  opId retry is a duplicate;
- reaction hint: split across deltas, never in delta, message or history.

**Acceptance (A, on :8851 with `--mock --mock-media`).** `curl` shows: the catalog with an ETag and 304 on repeat;
`GET /api/expr/agents/cw_chief` with a profile and `provider: 'mock'`; a P0 pre-voice run finishing in seconds with
≥ 60 clips, then `reused: true` on repeat; a clip and its alignment; "thanks" answered by a reflex message in under
500 ms; a desk quick-chat reply on the socket. With `--mock` alone, `provider: 'browser'` and pre-voice plans nothing.

---

## 5. Builder B — web

New code lives in `apps/web/src/living/**` plus small edits to Talk, Floor, the palette, the store, the feed, the
voice modules and `Face`. The living runtime is a lazy chunk loaded after the app is idle; the app works unchanged
until it is ready.

**B1 · Runtime bootstrap** (`living/runtime.ts`). After boot idle: `GET /api/expr/catalog` → `compileCatalog(input)` in
`requestIdleCallback` → `createReflexRunner(deps)` with the §B2 ports, `recency: createRecencyMemory()` (restored from
`localStorage` when present, in try/catch), `budget: createChatterBudget(catalog.ambience, ambience)`, `clock:
Date.now`, `schedule: setTimeout`. `living/agents.ts` caches `ExprAgentResponse` per agent (the Chief at boot and on
lead or name change; coworkers on the first hover), builds each `AgentIndex` from the returned `profile`, and keeps a
mood cache (`MoodState` rebuilt from `mood.changed` + baseline, decayed locally with `moodAt`).

**B2 · Ports** (`living/ports.ts`).
- `ReflexAudioPort` over §3.6: `armed` → `engine.armed`; `ownerSpeaking` → `engine.micLive()`; `voiceBusy(a)` →
  `activity(a)` (busy when conversation or reflex; `remainingMs` = scheduled + 65 ms × unsynthesised characters when
  the stream is open); `foregroundActive`; `play` → `playPrepared` (`duringOwner` for backchannels; `mode:'interject'`
  for `juggling`); `speakText` → `speakReflexText`.
- `ReflexFacePort`: a face registry (`living/faces.ts`) keyed by agent id; `Face` gains an `agentId` prop and registers
  its `FaceView`; `cue` and `bias` go to every registered view of that agent (bias re-applied on mount).
- `ReflexCaptionPort`: signals for the Talk live caption and Floor bubbles (`living/captions.ts`) plus a caption log
  (dev) for L6 checks.
- `ClipStore` (`living/clips.ts`): Cache Storage `hc-expr-v1` (URL = the clip URL; alignment cached beside it) +
  a decoded LRU of `PreparedAudio` (32 MB by `bytes`); `get` is synchronous; `load` = cache → fetch → `prepare`;
  `prefetch` with 4 at a time; `manifest(agentId)` from the agents cache. All storage access in try/catch; memory
  only when Cache Storage is unavailable.
- `render()` → `POST /api/expr/render` then `load(clipKey)`; null on any error.

**B3 · Pre-voice and warm-up.** When Talk mounts and the Chief's provider is `xai`, `openai` or `mock`: `POST
/api/expr/prevoice {agentIds:['cw_chief'], tiers:['p0']}` (idempotent), poll its status every 2 s, refresh the
manifest, then the same for `['p1']`. Decode the Chief's P0 clips eagerly (decoding needs no gesture). Coworkers: no
batch; the first hover renders at runtime (render once, then cached).

**B4 · Grounding** (`living/grounding.ts`). The Chief: presence `working` while any job runs (content only: the face
keeps its D2 "available" state), `activity` = the running job's label, `work = {stepLabel, done: step − 1, total: of}`,
`history` from the thread (`firstMeeting` when no owner turn exists, `returning` after ≥ 3 h, `newDay`),
`owner.firstName: null`, `chiefName`, `quietHours`. Coworkers: `staffed: false`, presence `idle`, `activity: null`,
`firstMeeting` when no quick-chat exists. `now.weekday` is JS (0 = Sunday); `localHour` owner-local.

**B5 · Talk.**
- Call `runner.ownerTurn` right after `api.talk` resolves, with the server `turnId`, `at` = send time (text) or the
  push-to-talk release time (voice, recorded in `ptt.ts`), and `cues = sniffOwnerText(text, lexicon)`. Conversation
  events that arrive before `ownerTurn` for their turn are held and replayed right after it.
- First `talk.delta` of a turn → `conversation({kind:'first_token', hint})`; the Chief's first audio heard →
  `first_chunk`; every 250 ms while the Chief's reply sounds → `speaking` with `remainingMs`; `talk.done` → `done` or
  `cancelled`.
- VAD (`engine.onOwnerVad`) → `runner.ownerSpeech({agentId: CHIEF_ID, …})`; at release the face shows `look_up` +
  `thinking` while STT runs.
- **Send while the Chief speaks (§2.3, §8.4):** typing no longer stops the voice. Sending: a stop or steer cue ≥ 0.6
  → `stopAtBoundary(CHIEF_ID)` (the runner acknowledges with context `interrupted`); ≤ 2.5 s left → finish, then the
  answer; 2.5–8 s → finish (the runner plays `juggling`, then `back_with_you`); > 8 s → `stopAtBoundary` (the rest stays
  on screen). Esc, a tap on the face and pressing to talk still stop at once (`bargeIn`).
- `runner.stage(CHIEF_ID, 'open')` when Talk mounts and `'close'` (`'navigate'`) when it unmounts; `'leave'` only when
  navigating to the landing page. No proactive greeting in the session where onboarding's greeting was spoken.
- `talk.message {kind:'reflex'}` is shown as a normal reply and is **not** spoken by `chiefSpeaker` (its `reflex.say`
  clip voices it). `store`'s `talk.done` presence reset applies to the Chief only.
- A live caption line under the Talk header name (reaction style: muted, "Joy: mm-hm"; never `aria-live`) and a small
  bubble under the header face for text-mode fillers.

**B6 · Floor.**
- **Chief card** pinned above the Directory: tile face with the state ring and the presence label, "Chief of Staff",
  `N jobs running`. Hover → `runner.hover(CHIEF_ID, …)`; **Reply** sends a normal Talk message (`api.talk`) and the
  bubble shows the streaming reply (it is also in Talk: one conversation).
- **Coworker cards.** `pointerenter` → `hover('enter')` + fetch the agent; a dwell of 600 ms under 0.3 px/ms →
  `hover('dwell','pointer')`; keyboard focus 900 ms → `'keyboard'` (bubble only); a tap on the face on touch →
  `'touch'` (and no navigation for that tap); `pointerleave` → `'leave'`. The hovered card's face is promoted from
  token to tile while hovered or while its bubble is open (so the look-up shows) and wears `audio().sampler(agentId)`.
- **Bubble** (`components/FloorBubble.tsx`): at most two lines, anchored to the card, TTL 4 s + 60 ms/char (≤ 9 s),
  kept while hovered and 3 s after; **Reply** (click or **R**) opens a one-line field in place; **Esc** closes;
  **Enter** on an empty field opens the profile.
- **Side-thread** (`components/SideThread.tsx`): `POST /api/desk/:personaId/say` (with `runner.ownerTurn` for that agent
  in text mode, so a text filler bubble can cover a slow reply), the reply streams into the bubble from
  `sideThreads[agentId]` in the store, and is voiced by a per-coworker `AgentSpeaker` (`personaVoiceRef`, TTS when
  available, else the browser voice) when voice is on. After three exchanges the bubble offers "Keep talking on
  {first}'s profile"; the profile page shows the same `SideThread` under its primary action.
- Directory rows expose the last bubble text to assistive tech ("Joy · … · said: '…'"); no `aria-live`.

**B7 · Ambience.** ⌘K Settings group: "Ambience: Quiet", "Ambience: Lively", "Ambience: Buzzing" (the current one
marked). One small control in the Floor header (icon + current value; a popover with three radio options and one line
each: Quiet "Faces only. Replies still speak." · Lively "Hellos and short updates, softly." · Buzzing "More chatter
while you're on the Floor."). Both `PUT /api/workspace {ambience}` through `updateSettings`, then
`runner.setSettings({ambience})`. No other new UI.

**B8 · Store and feed.** `ThreadItem.kind` gains `'reflex'`. Frames with `surface: 'floor'` (or `talk.owner` with an
`agentId`) go to `sideThreads[agentId]`, never to `thread`; `ui/unread.ts` ignores them. Expression frames are passed
to the runtime (live only), after the §3.3 tab rules. `connectFeed` gains `send(op)` (queued until open); after each
`ready` the runtime sends `viewer` and `expr.recent`. The viewer op is derived from the route (Talk → `talk` +
`cw_chief`; profile → `desk` + `cw_<id>`; Floor → `floor`; else `elsewhere`), audio armed, voice on, page visibility,
reduced motion, quiet hours, `tzOffsetMin` and `voice: {agentId: CHIEF_ID, untilMs}` while the Chief's reply sounds.

**B9 · Motion, quiet hours, hidden pages.** `ReflexSettings`: `reducedMotion` from `prefers-reduced-motion`; `quietHours`
= owner-local 22:00–07:00 (a constant until the interruption-budget settings exist); `captions` and
`captionReactions` true; `provider` from the Chief's `ExprAgentResponse`; `voiceOn` from settings. Bubbles and captions
do not animate under reduced motion. Page hidden: the runner's surface reports `pageVisible: false`.

**B10 · Dev hooks and test ids.** `window.__headcount.living = {runner, captions, clipsDecoded(), ambience}` in dev
builds. Test ids: Floor card `data-agent-id`; `data-testid` `floor-bubble` (+ `data-agent-id`), `bubble-reply`,
`bubble-input`, `bubble-answer`, `live-caption` (+ `data-kind`), `ambience-control`; reflex replies render as
`li.msg[data-kind="reflex"]`.

**B11 · Runner additions** (§3.8 R1–R3) with tests.

**B12 · Tests** (Vitest + happy-dom, `test/fake-audio.ts` extended): clip store (cache hit, fetch, LRU eviction,
storage unavailable), ports (priority mapping, voice busy, interject for juggling), grounding (Chief working with
progress; unstaffed coworker), Talk hooks (ownerTurn after POST with the server turnId; buffered first token; hint;
reflex messages not spoken; send-while-speaking branches), Floor dwell (600 ms pointer, 900 ms keyboard bubble only, a
sweep across six cards yields at most one line, touch tap), bubble reply to `deskSay`, the three-exchange limit,
Ambience via ⌘K and the Floor control, store routing of floor frames, unread ignoring them.

**Acceptance (B, on :5152 with `--mock --mock-media`, then `--mock`).** Hovering a coworker shows a bubble within
1 s and the face looks up; Reply gets a streamed answer, voiced (mouth moves); "thanks" in Talk shows a reflex reply
at once; a slow turn (`!slow 3000`) shows a filler; Quiet turns hovers into look-ups; reduced motion keeps bubbles and
captions without gestures; with `--mock` the same flows use the browser voice.

---

## 6. Builder C — audio + avatar

**C0 · API surface first.** Land the §3.6 and §3.7 additions with minimal implementations (reflex requests resolve
`dropped`, cues are ignored) so B compiles; then implement.

**C1 · `prepare` / `playPrepared`.** Decode once (works before `arm()`); play through the speaker's channel with the
per-request gain and a 60 ms fade on stop; `onStart` and `started` in heard time; `done` never rejects.

**C2 · Buses and the priority ladder** (§3.6 rules 1–5): a reflex bus and an ambient bus per speaker under the voices
bus; owner ducking (18 dB; the reflex bus only 6 dB for `duringOwner`); drops, fades and the same-speaker queue.

**C3 · `interject` and `stopAtBoundary`.** Hold the next conversation chunk of a speaker while an interjecting reflex
plays, then continue; end an utterance after the chunk now playing (queued chunks dropped, `done` = `stopped`).

**C4 · `activity`, `foregroundActive`, `remainingMs`, `streamOpen`** in heard time.

**C5 · `speakReflexText`** (keyless): the browser voice lane with the same priority rules; nonverbal text is never
passed here (the runner shows a face instead).

**C6 · `onOwnerVad`** (§3.6 rule 9).

**C7 · Gestures.** `FaceMotion` gains a cue layer (the §3.7 table) blended into the pose; `FaceView.cue()` wakes the
scheduler, handles tiers and reduced motion, and sets the data attributes.

**C8 · Expression bias.** `setExpressionBias()` → eased parameters in `FaceMotion` (corner pull, brow, pitch, blink and
sway scales) with the 1.2 s hysteresis; the procedural renderer draws the inner brow; the portrait renderer maps
corner pull to its existing mouth warp and brow to its tier-1 brow strip. No new rAF, no new assets.

**C9 · Tests.** Audio (fakes in `src/test/fakes.ts`): prepared playback latency ≤ 30 ms on a fake clock; each ladder
rule; interject timing at a chunk boundary; `stopAtBoundary`; `duringOwner` and the 6 dB duck; the VAD event sequence
from a scripted level trace; `activity` numbers; the sampler follows prepared audio (alignment and text timing).
Avatar: each gesture's timeline returns to rest; latest cue wins; tokens ignore gestures; reduced motion applies only
the expression; bias easing and hysteresis; data attributes; scheduler budget tests unchanged.

**Acceptance (C).** The unit suites above, plus the existing audio and avatar suites green.

---

## 7. Integrator (after the three builders)

1. **Build pipeline.** `postinstall`, `catalog:build`, `test`, `typecheck` and `e2e` also run
   `node packages/expressions/scripts/build-expressions.mjs` (so `generated/expressions.json` exists everywhere);
   `scripts/dev.mjs` rebuilds it when `catalog/expressions/**` changes (effective on the owner's next restart).
2. **e2e** (`e2e/living.spec.ts` on the Mock stack; additions to `e2e/voice.spec.ts` on Mock + mock media):
   - hover a coworker 700 ms → `floor-bubble` within 1.5 s and `data-face-cue="look_up"` on its face; Reply → a
     `bubble-answer`, and nothing new in the Talk thread;
   - "thanks" in Talk → `li.msg[data-kind="reflex"]` within 1 s and `talk.done.route === 'reflex'` in the store;
   - ⌘K "Ambience: Quiet" → a hover shows no bubble, the face still looks up, and `GET /api/workspace` says `quiet`;
   - reduced motion → a hover still shows the bubble and no `data-face-cue`;
   - `!slow 3000` → a filler caption or bubble within 3.5 s, and no filler when the reply is fast;
   - voice project: opening Talk pre-voices the Chief's P0 (`prevoice.state === 'done'` within 20 s); a voice turn plays
     an acknowledgement clip with a caption-log entry while the Chief's mouth sampler moves; a Mock job finishing
     while at Talk logs `celebrate` before the announcement, and the mood cache records `job.done`.
3. **Verify:** `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm e2e` (isolated ports), plus a keyless walk-through of
   the §10 demo on the integrator's own ports.
4. **Pre-voice on the owner's running server** (allowed: clip endpoints only; never `PUT /api/workspace` or
   `/api/talk`). First `POST http://localhost:8787/api/expr/prevoice {agentIds:['cw_chief'], tiers:['p0','p1'],
   dryRun:true}` and report the counts; then run P0, then P1, keeping the total at or under 250 renders; confirm with
   `GET /api/expr/agents/cw_chief`. Coworkers are not batch pre-voiced. Measured on the live catalog for one lead: P0
   (top 6 per intent) = 66 clips, P0 + P1 = 209; "every line of every conversation intent" (spec §7.1) would be about
   380 for P0 alone and about 890 with P1, so the Chief's `allLinesFor` is left for a later, budgeted pass.
5. **Docs.** CONTRACTS.md: the new routes, frames, socket ops, settings, env vars, ownership and the audio and avatar
   APIs (replace §7 "Heads-up"); INC0.md gains an "Inc 0.5" section (run it, what works, known gaps).

---

## 8. Where this plan narrows the brief, and amendments

1. **No `juggling` for a job step in flight (H5, L3, D2).** The brief asked for juggling "when an owner message
   arrives while a job step is mid-flight". Talk never waits on work (D2), the intent `requires: contention` (H5), and
   nearly all of its 752 catalog lines promise a wait ("back in {eta}", "then yours", "you're next"), so that would be
   fake busyness. What ships instead: the server sends
   `attention.changed` (the job as a background thread) and a `glance` face cue, and the reply mentions the job in
   words (A8). `juggling` / `back_with_you` fire on the real contention: a new question while the agent's voice is still
   speaking (client runner, B5).
2. **`oops` on a retried attempt, not on the final failure (H2).** `oops` lines say "Retrying." A job that failed is
   not being retried, so its announcement carries the words and the face winces; `oops` plays on the ProjectDO's real
   `step.retry` (A9).
3. **`celebrate` on `job.done`.** The spec reserves `celebrate` for accepted deliverables; Everyday jobs have no
   acceptance yet. It plays as a short lead-in to the real completion announcement, with `owner_name` unresolvable (no
   thanking the owner for an approval that did not happen) and the job title as `{artifact}`.
4. **EXPERIENCE X5 amended (per LIVING-WORKFORCE §2.3).** Typing no longer stops the voice; sending follows §2.3.
   Esc, a tap on the face and holding to talk still stop it at once.
5. **The server `thinking_filler` is a safety net**, deduped against the client's (§3.4, §3.8).
6. **Route name.** Quick-chat is `POST /api/desk/:personaId/say` (the brief), not the spec's
   `/api/agents/:agentId/talk`; the frames follow the spec (`talk.*` with `surface: 'floor'`).
7. **The Chief pre-voices the top lines, not every line (spec §7.1).** P0 + P1 top-N is about 209 clips; every
   conversation line would be about 890 renders. The smaller pool repeats sooner; widening it is a budgeted follow-up.

## 9. Not in 0.5 (known gaps to record in INC0.md)

- Side-talk on the Floor (engine and fixtures only; Inc 1 has the events).
- `deferral` (moving a slow turn to the background).
- An owner name setting, so no line addresses the owner by name.
- Voiced-segment alignment for OpenAI clips (text timing over the clip is used).
- Backchannels in keyless dictation mode (no mic level).
- A quiet-hours setting (fixed 22:00–07:00), a "Caption reactions" switch (always on), clip garbage collection and
  the 60-minute per-workspace pre-voice cap (the daily render cap stands in).
- Compressed delivery of the 2.9 MB catalog bundle in local dev (production compresses automatically).

## 10. Exit checklist (the demo, keyless first, then on the owner's keyed server)

1. Open Talk after a break: the Chief looks up and greets (in voice once audio is armed); P0 is pre-voiced ("reflex
   ready") within seconds on Mock media.
2. Hold to talk for five seconds with a pause: a nod and a soft "mm-hm" in the pause, gone the moment you resume.
3. Ask something slow (`!slow 3000` on Mock): a filler within 700 ms of releasing, then the answer.
4. "Haha, the printer's haunted again": the Chief laughs in their own style, then answers. Typed: a smile only.
5. "Thanks": "Anytime." in about 400 ms, marked as a reply, with no model call.
6. "Look into three packaging suppliers", then ask a second question while the reply is still speaking: "Hold that
   thought — back in a few seconds", the rest of the first answer, "Okay — all yours", the second answer.
7. While the job runs, stay on Talk: a short true progress line after a checkpoint (never over a reply); when it
   finishes, a brief celebration, the announcement, and a brighter face.
8. Floor: the Chief card shows the job; rest on it for a short status line. Rest on a coworker: a look-up and "Hi —
   {name}, {role}…"; Reply "what do you do?": two sentences in their voice with a moving mouth, and no promise of work.
9. ⌘K → "Ambience: Quiet": hovers only look up; fillers and replies still speak. Reduced motion: no gestures, all
   captions and bubbles remain.
