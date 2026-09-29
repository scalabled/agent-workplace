# Office Phase 2: the Office in the app (contracts and ownership)

> **Status.** v1.1, 29 September 2026: built and integrated (§10 as built). The build plan for Office Phase 2: three
> parallel builders (A, B, C) and an integrator. It turns [OFFICE-PLAN §6](OFFICE-PLAN.md) and [OFFICE-LIFE §7.3](OFFICE-LIFE.md) into exact contracts,
> fixes the gaps found while planning, and assigns every file to exactly one owner.
>
> **Owner's words.** *"the new office layout mode should be fully autonomous - the agents move around automatically
> and even talk near the water cooler … We want this to feel familiar and meaningful, not arduous and unusable -
> please ensure the user experience is delightful!"* The Office has two modes, **desk mode** and the **conference
> room** (OWNER-DIRECTIVES D3), and it runs itself (D3 "The office runs itself", D5 "Water-cooler small talk", "Honest
> and never annoying").
>
> **Binding inputs.** OWNER-DIRECTIVES D2, D3, D5; OFFICE-PLAN §4–6 and §9 (Phase 1 as built); OFFICE-LIFE §2–8
> (life engine as built; §8.2 is the real API); INC05 §8 and CONTRACTS §8 (one voice per workspace: `mayVoice()`,
> `voice.owner`: **every new sound in this phase obeys it**); CONTRACTS §2–4, §7; EXPERIENCE X2, X4, X5, X8, X9, X11,
> §9.2, §10.8.
>
> **Baseline at planning time.** `npx vitest run packages/office packages/expressions/src/huddle.test.ts`: 163 tests
> pass (one run of four had a single timing failure under load; watch it). `apps/web` does not depend on
> `@headcount/office` yet. The tree holds the owner's **uncommitted** voice work (§2.2); nobody commits.

---

## 0. Phase 2 on one page

Open the Floor on a laptop and you are in the office: L1 on the liveliest neighbourhood (usually the café), the
water-cooler crew already talking in bubbles, a few people strolling, monitors lit only where real work runs. Rest on
a face and they look up with a short, true line in their own voice. Click anyone, anywhere (at a desk, at the cooler,
mid-aisle) and a quick chat opens in place; they stop and face you. Hover a huddle: **Listen** plays the small talk in
their voices (only in the tab that has the voice, within the ambient budget); **Join** turns them toward you, one
greets you by name, and you are in a group chat backed by the rooms endpoint. Walk into the Skyline room, invite three
people, ask a question: up to three answer in turn in their own voices with captions and lip sync, the Chief wraps
up, and you can barge in at any moment. Leave, and Talk carries one quiet line saying the meeting happened. The
Directory is one toggle away and stays the default on phones and the accessible alternative everywhere.

| Decision | Choice | Why |
|---|---|---|
| Where it lives | A lazy `office/` chunk behind an **Office \| Directory** toggle on the Floor; Directory users never load it | D3 few destinations; performance (§6) |
| Who talks in rooms | `POST /api/rooms/:roomId/say` in the **WorkspaceDO** (RoomDO stays the Inc 2 stub): ≤ 3 responders, sequential fast turns at machine speed; the client paces playback | OFFICE-PLAN §6.4; the conversation never waits on work (D2) |
| Huddle chat | The same endpoint with ad-hoc `huddle:<hash>` rooms (≤ 4 members, ≤ 2 responders) | One engine, one honesty guard (OFFICE-LIFE §3.5) |
| Honesty | A **reply guard** on every room, huddle and desk reply: no figures absent from the owner's own words, no metric or experience claims, no work claims or promises, ≤ 2 sentences (§4.2.6) | D5 "Honest and never annoying", X9; the demo's "it went up nine points" can never reach the app |
| Voice | Rooms and joined huddles: per-speaker TTS (writer ‖ voicer ‖ player) gated by `mayVoice()`; Listen-in: the clip service on the ambient bus within the shared ambient window; keyless: captions only | INC05 §8, LIVING-WORKFORCE §9.2 |
| Grounded small talk | Only from real store events: the Chief's finished jobs, spoken of as "write-up" (never the title) | D5 "grounded in a real event"; no private job titles in banter |
| Owner's name | `WorkspaceSettings.ownerName` (optional), one skippable field in onboarding and ⌘K | Greetings by name; `{owner_name}` slots become eligible |
| Meeting record | One muted `talk.message {kind: 'note'}` in Talk when you leave a room or huddle you spoke in | X2 "every side conversation returns as one line" |

### 0.1 Amendments to earlier documents (the integrator folds them in)

| Document | Was | Now |
|---|---|---|
| OFFICE-PLAN §6.3 | Click the Chief → navigate to Talk | Click the Chief → the same in-place quick chat as anyone (backed by the Talk thread, `SideThread` already supports `CHIEF_ID`); "Keep talking with {name} in Talk" and Enter on the empty field go to Talk. One gesture, no page change. |
| OFFICE-PLAN §6.4 | `roomId` in `skyline \| garden`; `talk.cancelled` frame | Room ids `skyline \| garden \| huddle:<hash>` (§4.1). There is no `talk.cancelled` frame: cancellation is `talk.done {finish: 'cancelled'}` plus an ephemeral `room.turn {state: 'cancelled'}`. |
| OFFICE-PLAN §6.4 | "The Chief adds one wrap-up line only if at least 2 others spoke" | Kept; the 202's `order` includes the Chief last when a wrap-up is planned, and `room.turn` drops it if fewer than 2 spoke. |
| OFFICE-PLAN §6.5 | Reflexes while a responder thinks: a voiced filler at −4 dB | Phase 2 shows the look-up face cue only; voiced room fillers are a later increment (§9). |
| OFFICE-LIFE §3.6, INC05 §3 | Quiet hours behave like Quiet for ambient chatter | For the Office, quiet hours silence **ambient voice** only: huddle bubbles still show (visual, shown only while the owner looks); Listen still voices because it is an explicit owner action (INC05: owner-initiated exchanges keep their reflexes). The Ambience setting still governs bubbles. |
| OFFICE-LIFE §3.5 | "Open in a room" | The as-built director ignores the `'room'` huddle action. A fixes it (§4.5.12). |
| OFFICE-LIFE §3.7 | Wins from `deliverable.accepted`, `verdict.approve`, `job.done` with an artifact | Inc 0.7 has only the Chief's `job.done`: `{artifact: 'write-up'}` (§4.5.8). The rest arrives with Inc 1 events. |

---

## 1. What ships (acceptance in one list)

1. The Floor has an **Office | Directory** toggle; Office is the default on a fine pointer ≥ 900 px wide, Directory
   on phones and coarse pointers; the choice persists (`localStorage['hc.floor.view']`); `?view=office|directory`,
   `&room=skyline|garden`, `&focus=<personaId>` deep links work. Before onboarding there is no toggle (the Office needs
   a Chief).
2. Desk mode is wired to the real app: FaceView faces at the office's LOD, presence and speaking from the store and the
   audio engine, passing-by on hover, quick chat on click, replyable FloorBubbles in scene anchors, R and L keys.
3. Office life runs (`createOfficeLife`): personality from `GET /api/office/people`, small talk from the huddle engine
   over the bundle's huddle packs, grounded only in real store events, recency persisted, real-state overrides
   (Chief jobs and activity, raised hands, quick-chat thinking, rooms), Ambience from settings, reduced motion,
   Pause, Follow, Autopilot, the What's happening pill.
4. **Listen** voices a huddle through `POST /api/expr/huddle/render` on the ambient bus, only on the voice-owner
   client, within the shared ambient window. **Join** opens a huddle group chat on the rooms endpoint, greets by name,
   signs off on leave.
5. The conference stage is live: dock composer (text and hold-Space push-to-talk to the room), invites, floor queue,
   captions (NOT VOICED when text-only), per-speaker voice with lip sync, barge-in within 300 ms, Esc leaves, one note
   line in Talk.
6. The worker serves `POST /api/rooms/:roomId/say`, `POST /api/rooms/:roomId/cancel`, `GET /api/office/people`,
   `POST /api/expr/huddle/render`, and `ownerName` in settings; every room, huddle and desk reply passes the reply
   guard.
7. Owner name: one optional field in onboarding and a ⌘K "Set your name" command.
8. Tests: unit tests per builder (§7.1–7.3); e2e and screens by the integrator (§7.4); budgets met (§6).

---

## 2. Rules for everyone

### 2.1 Environment

- **The owner's dev server** runs on **:5173 / :8787**. Never start, stop or restart it. Never call its `/api/talk`,
  `/api/desk/*`, `/api/rooms/*` or `PUT /api/workspace`. Never open `/app` tabs against it (a tab there would take the
  owner's voice). Its Vite hot-reloads **every save you make in this tree** (INC05 §8): keep the Floor route working at
  every save (put new work behind the lazy office chunk until it runs; never leave a broken import in a shared file).
- **Your own stack** (keyless, Mock chat, Mock TTS/STT), started from the repo root, stopped when you are done, with
  your state directory deleted afterwards (`--persist-to` is relative to `apps/worker`):

  | Who | Web | Worker | Command |
  |---|---|---|---|
  | A · WEB-OFFICE | 5191 | 8891 | `node scripts/dev.mjs --mock --mock-media --no-watch --web-port 5191 --worker-port 8891 --persist-to .wrangler/state-office-a` |
  | B · WORKER-ROOMS | 5192 | 8892 | `… --web-port 5192 --worker-port 8892 --persist-to .wrangler/state-rooms-b` |
  | C · WEB-STAGE | 5193 | 8893 | `… --web-port 5193 --worker-port 8893 --persist-to .wrangler/state-stage-c` |
  | Integrator | 5194 | 8894 | `… --web-port 5194 --worker-port 8894 --persist-to .wrangler/state-integrator` |

  Clean up with `rm -rf apps/worker/.wrangler/state-<you>`. The office demo harness, if A needs it:
  `OFFICE_DEMO_PORT=5872 node apps/web/node_modules/vite/bin/vite.js --config packages/office/demo/vite.config.mjs`
  (its portrait proxy forwards GETs to :8787 only; it never writes).
- **E2E runs only for the integrator** (`pnpm e2e` binds the fixed ports 5183/8797 and 5184/8798; two runs at once
  collide). Builders run unit tests: `npx vitest run <paths>`, `pnpm --filter <pkg> typecheck`.
- Browser pane: only your own ports. Never `apps/worker/.dev.vars`, never `reference/**`, never `catalog/**` content.
- **No commits, no stashes, no `git checkout`/`restore`/`reset`**, no whole-file reformatting. Read a file before you
  edit it; edits to the files in §2.2 are surgical and additive.

### 2.2 The owner's uncommitted files you will touch

`git status` shows the owner's voice work (one voice per workspace, hot-update hand-over, speech fixes). These files
are in it **and** in this plan; keep every existing line's behaviour:

| File | Owner in this plan | Your change is limited to |
|---|---|---|
| `apps/web/src/routes/Floor.tsx`, `routes/floor.css` | A | The toggle, the lazy office mount, hiding Directory tools in Office view (keep `VoiceElsewhere`) |
| `apps/web/src/living/{index,runtime,ports}.ts` | A | Additive exports (§4.5.13); ignore `surface: 'room'` frames |
| `apps/web/src/store/index.ts`, `api/client.ts`, `app.tsx`, `voice/chief-voice.ts`, `routes/Talk.tsx`, `routes/talk.css` | C | The Step 0 hooks (§4.3) |
| `apps/worker/src/workspace/{workspace-do,routes}.ts`, `expr/host.ts`, `desk/routes.ts` | B | New RPCs, `ownerName`, the `'room'` rate kind, guards (§4.2) |
| `packages/protocol/src/{api,frames}.ts`, `ext/expressions.ts`, `ext/voice-owner.ts` (untracked) | B | Additive types (§4.1) |
| `packages/expressions/src/types.ts` | A | Two optional `ChatterBudget` methods (§4.5.13) |
| `packages/office/src/**`, `packages/office/demo/**` | A | Additive API (§4.5.12); the demo's honesty fix |

### 2.3 Product rules every builder checks against

- **One voice per workspace.** Every new sound (room lines, joined-huddle replies, the Join greeting and sign-off,
  Listen-in) plays only when `mayVoice()` is true and `claimUnsettled()` is false at the moment it starts; a tab
  without the voice shows captions, bubbles and faces. Every owner request carries `clientId` so the sending tab takes
  the voice (§4.1.2). Losing the voice stops everything this tab says (the existing `silenceHere` covers
  `chiefSpeaker` and every `sideSpeaker`, which is why rooms reuse them).
- **Honesty.** Replies speak from persona expertise only: opinions, principles, questions, disagreements. No figures
  that are not in the owner's own messages of that conversation, no metrics, results, dates, studies or past events,
  no completed-work claims, no work promises from unstaffed coworkers. Small talk stays pre-authored and linted
  (OFFICE-LIFE §5.4); grounded mentions come only from real events (§4.5.8). Laughter never at a person.
- **Delight.** Zero required effort; everything reachable in one gesture (§5.2); calm, legible, dark, minimal chrome;
  no counters that ask for action; reduced motion respected (walks become fades, no autopilot, lip sync kept); the
  Directory is always one toggle away.
- **Copy** (EXPERIENCE §10.8): plain, short, verb-first, no model names, no exclamation marks; a failure is one
  sentence with its fix. Vocabulary: Chief of Staff, Coworker, Floor, Desk, Room.

---

## 3. Ownership map and order

### 3.1 Who owns what

Every path has one owner. Anything not listed is out of scope; if you need it, ask the integrator.

| Owner | Paths (new unless marked *edit*) |
|---|---|
| **A · WEB-OFFICE** | `apps/web/src/office/**` · `apps/web/src/routes/Floor.tsx`, `routes/floor.css` (*edit*) · `apps/web/src/lazy.ts` (*edit*: `loadOffice`) · `apps/web/src/living/**` (*edit*, additive) · `apps/web/src/components/FloorBubble.tsx` (*edit*: two optional props) · `apps/web/package.json` (*edit*: `"@headcount/office": "workspace:*"`, then `pnpm install` once, early) · `packages/office/**` (*edit*, additive, zero dependencies kept) · `packages/expressions/src/{gate,types}.ts` (*edit*: §4.5.13) + `gate.test.ts` |
| **B · WORKER-ROOMS** | `packages/protocol/src/ext/rooms.ts` · `packages/protocol/src/{api,frames,routes}.ts`, `ext/expressions.ts`, `ext/voice-owner.ts` (*edit*, additive) · `packages/expressions/scripts/bundle.d.ts` (*edit*: `huddles?`) · `apps/worker/src/index.ts` (*edit*: four registrations) · `apps/worker/src/rooms/**` (keep `room-do.ts` a stub) · `apps/worker/src/expr/huddle-render.ts` + `expr/{catalog,routes,host,prevoice}.ts` (*edit*) · `apps/worker/src/workspace/{workspace-do,routes,talk,chief-prompt}.ts` (*edit*) · `apps/worker/src/desk/desk.ts` (*edit*: the reply guard) |
| **C · WEB-STAGE** | `apps/web/src/room/**` · Step 0 shell hooks (*edit*): `apps/web/src/api/client.ts`, `store/index.ts`, `voice/chief-voice.ts`, `voice/ptt.ts`, `ui/unread.ts`, `app.tsx`, `routes/Talk.tsx`, `routes/talk.css`, `components/Palette.tsx`, `talk/actions.ts` · owner name UI: `routes/Onboarding.tsx`, `routes/onboarding.css` (*edit*) |
| **Integrator** | `e2e/**`, `playwright.config.ts`, `docs/dev/CONTRACTS.md` (§9 new), OFFICE-PLAN §6 check-off and §10 as built, OFFICE-LIFE §7.3 check-off, this document's §10, `docs/dev/screens/office-phase2/**`, merge review, full `pnpm typecheck && pnpm test && pnpm build && pnpm e2e` |

### 3.2 Order and hand-offs

```
t0 ──► B · Step 0 (≤ 30 min): protocol types + route ids + router registrations (handlers may answer 501 at first)
  │    A starts at once: pnpm install, Floor toggle, OfficeView mount, faceFactory, presence (no new API needed)
  │    C starts at once: room/session.ts and room/player.ts against the §4.4 contract with a fake api
  ├──► C · Step 0 (≤ 45 min after B's): client.ts methods, store and voice guards, ptt target, app key guards,
  │    Talk note, palette registry (§4.3)
  ├──► parallel: B rooms core → guard → office people → huddle render → ownerName
  │              A life → huddles → Listen → Join → keys/palette/hint → packages/office fixes
  │              C session → player → stage binding → dock/PTT → captions/queue → leave note → name UI
  └──► Integrator: merge review, typecheck/test/build, e2e (§7.4), screens, perf and a11y probes, docs, owner demo
```

Contracts in §4 are final for the build. A builder who needs a change writes it in their summary with the reason;
the integrator decides and updates this document. Builders never edit another owner's file; they code against the
contract (tests use fakes) until it lands.

---

## 4. Contracts

### 4.1 Protocol (B, Step 0)

#### 4.1.1 `packages/protocol/src/ext/rooms.ts` (new)

```ts
import { ulid, type AgentId, type MessageId, type OpId, type TurnId } from '../ids';
import type { ExprAgentProfile, ExprTtsProvider } from './expressions';

export type ConferenceRoomId = 'skyline' | 'garden';
export type HuddleRoomId = `huddle:${string}`;
export type RoomId = ConferenceRoomId | HuddleRoomId;
export type RoomKind = 'skyline' | 'garden' | 'huddle';

export const ROOM_ID_RE = /^(?:skyline|garden|huddle:[a-z0-9]{4,16})$/;
export const MEETING_ID_RE = /^mtg_[0-9a-z]{26}$/;
export function isRoomId(v: unknown): v is RoomId;
export function roomKindOf(id: RoomId): RoomKind;
/** 'huddle:' + FNV-1a 32-bit of the life huddle id ('hd:<day>:<spot>:<minute>') in base 36: stable, short, no colons. */
export function huddleRoomId(huddleId: string): HuddleRoomId;
/** Client-made, one per meeting (entering a room or joining a huddle): 'mtg_' + a lowercase ULID. */
export function newMeetingId(): string;

/** Participants exclude the owner. */
export const ROOM_LIMITS: Readonly<Record<RoomKind, { participants: number; responders: number; chiefWrap: boolean }>> = {
  skyline: { participants: 9, responders: 3, chiefWrap: true },
  garden: { participants: 7, responders: 3, chiefWrap: true },
  huddle: { participants: 4, responders: 2, chiefWrap: false },
};
export const ROOM_SAY_MAX_CHARS = 2000;
export const ROOM_TURNS_PER_MIN = 12;          // responder replies per workspace per minute
export const ROOM_PROJECTION_LINES = 12;       // meeting lines each responder sees
export const ROOM_REPLY_MAX_TOKENS = 160;      // at most two short sentences
export const ROOM_LABEL_RE = /^[\p{L} '’-]{1,40}$/u;  // a huddle's place, e.g. "water cooler"

export type FloorMode = 'mention' | 'group' | 'relevance' | 'phatic';

export interface RoomSayRequest {
  text: string; opId: OpId; meetingId: string;
  participants: AgentId[];                     // who is at the table / in the huddle now (the scene's truth)
  via?: 'text' | 'voice';
  clientId?: string;                           // the sending tab becomes the voice owner (CONTRACTS §8)
  label?: string;                              // huddles: the place, for prompts and the leave note
}
export interface RoomSayAccepted {
  accepted: true; opId: OpId; roomId: RoomId; meetingId: string;
  turnId: TurnId;                              // one room turn per owner message
  messageId: MessageId;                        // the owner's message
  order: AgentId[];                            // planned responders in speaking order (a planned Chief wrap-up is last)
  mode: FloorMode; gen: number; duplicate?: boolean;
}
export interface RoomRefusal { accepted: false; code: 'bad_request' | 'not_found' | 'rate_limited' | 'not_configured'; message: string }

export interface RoomCancelRequest {
  opId: OpId; meetingId: string;
  leave?: boolean;                             // the owner left: cancel, and post the note if they said anything
  participants?: AgentId[]; label?: string; clientId?: string;
}
export interface RoomCancelResponse { cancelled: boolean; noteId: MessageId | null }

/** Ephemeral frame `room.turn`: floor control as the server runs it. Never persisted, never replayed. */
export interface RoomTurnData {
  roomId: RoomId; meetingId: string; turnId: TurnId; gen: number;
  order: AgentId[];                            // responders not yet finished, in order
  next: AgentId | null;                        // generating now
  state: 'running' | 'done' | 'cancelled';
  reason?: 'owner' | 'left' | 'limit' | 'error';
}

/** GET /api/office/people: personality for office life and the huddle engine. */
export interface OfficePersonDto {
  agentId: AgentId;                            // 'cw_chief' or 'cw_<personaId>'
  groupId: string;                             // department id; 'chief' for the Chief
  isChief: boolean;
  teamRoles: string[];
  pairsWellWith: AgentId[]; tensionWith: AgentId[];   // catalog persona ids mapped to agent ids
  blend?: Record<string, number>;              // archetype → weight: signature pack `archetypes`, or `lead_blends[leadId]`
  profile: ExprAgentProfile;                   // as GET /api/expr/agents/:id builds it (sliders, traits, voice, …)
}
export interface OfficePeopleResponse { version: string; people: OfficePersonDto[] }

/** POST /api/expr/huddle/render: one small-talk turn in the speaker's voice (listen-in). Response: ExprClipRef. */
export interface ExprHuddleRenderRequest { exchangeId: string; index: number; agentId: AgentId; fills: Record<string, string>; provider: ExprTtsProvider }
```

#### 4.1.2 Additive edits

| File | Change |
|---|---|
| `ext/expressions.ts` | `TalkSurface = 'talk' \| 'floor' \| 'room'`. `ExprCatalogBundle` gains `huddles?: { version: string; packs: unknown[] }` (the bundle already carries it; the type did not). |
| `frames.ts` | `talk.owner`, `talk.delta`, `talk.message`, `talk.done` gain `roomId?: RoomId; meetingId?: string` (set exactly when `surface: 'room'`, and on a note). `talk.message.kind` gains `'note'`: a quiet thread line from the office (never voiced, never unread, never in the Chief's model history). New ephemeral frame `'room.turn': RoomTurnData` (add to `EPHEMERAL_FRAME_TYPES`). |
| `routes.ts` | `roomSay: POST /api/rooms/:roomId/say` (json, 16 KB) · `roomCancel: POST /api/rooms/:roomId/cancel` (json, 4 KB) · `officePeople: GET /api/office/people` · `exprHuddleRender: POST /api/expr/huddle/render` (json, 8 KB). `routePath` URI-encodes `huddle:…`. |
| `api.ts` | `WorkspaceSettings.ownerName?: string \| null` and `UpdateWorkspaceRequest.ownerName?: string \| null`; `export const OWNER_NAME_MAX_CHARS = 40`; `export function ownerFirstNameOf(s): string \| null` (first word, ≤ 24 chars, `\p{L}`, apostrophe, hyphen; null when unset). |
| `ext/voice-owner.ts` | `VoiceOwnerReason` gains `'room'`. |
| `packages/expressions/scripts/bundle.d.ts` | `huddles?: { version: string; packs: import('../src/huddle').HuddlePackInput[] }`. |

### 4.2 Worker (B)

#### 4.2.1 Routes and registration

`apps/worker/src/index.ts` registers `roomSay: handleRoomSay`, `roomCancel: handleRoomCancel` (`rooms/routes.ts`),
`officePeople: handleOfficePeople` (`rooms/people.ts`), `exprHuddleRender: handleExprHuddleRender`
(`expr/huddle-render.ts`). The origin guard, body caps and error mapping apply unchanged.

**`POST /api/rooms/:roomId/say`** validates like `desk/routes.ts`: JSON object; `text` non-empty after trim, ≤ 2000
(413 over); `opId` ≤ 128; `roomId` matches `ROOM_ID_RE` (404 otherwise); `meetingId` matches `MEETING_ID_RE`;
`participants` 1…`ROOM_LIMITS[kind].participants`, unique, each `cw_chief` (only with a chosen lead) or
`cw_<personaId>` of a catalog persona (400 otherwise); `label` matches `ROOM_LABEL_RE` when present; `clientId` passes
`isClientId`. Then `WorkspaceDO.roomSay(roomId, body)` → **202** `RoomSayAccepted`, or the refusal as its HTTP code
(429 `rate_limited`, 503 `not_configured` with the missing keys named).

**`POST /api/rooms/:roomId/cancel`** → `WorkspaceDO.roomCancel(roomId, body)` → **200** `RoomCancelResponse`.
Idempotent on `opId`. Cancelling nothing is `{cancelled: false, noteId: null}`.

#### 4.2.2 `WorkspaceDO` (thin RPCs; logic in `rooms/*.ts`)

```ts
async roomSay(roomId: RoomId, req: RoomSayRequest): Promise<RoomSayAccepted | RoomRefusal>;
async roomCancel(roomId: RoomId, req: RoomCancelRequest): Promise<RoomCancelResponse>;
private roomHost(): RoomHost;          // like deskHost(): feed, ledger, registry, settings, usage, rate, isCurrent(gen)
private recoverRoomTurns(): void;      // called from recoverInterruptedTurn(); meta 'active_room' → talk.done error
```

State: at most **one running room turn per workspace**: `{roomId, meetingId, turnId, gen, controller, done}`. A new
`roomSay` for any room bumps `gen`, aborts the running turn (the partial reply is appended as `talk.message` then
`talk.done {finish: 'cancelled'}`, as Talk's barge-in does), drops its queue, emits
`room.turn {state: 'cancelled', reason: 'owner'}`, then starts the new turn. `roomCancel` does the same with reason
`'owner'` (push-to-talk started) or `'left'` (`leave: true`).

`roomSay` order of work (202 path, no model call before 202):
1. `clientId` → `this.voice.claim(clientId, 'room')`. Duplicate `opId` → the stored result with `duplicate: true`.
2. The room turn rate and the daily chat limit must allow at least one reply (`this.expr.takeRate('room', …)` is
   taken per reply later; here only check that `usage` has one left) → else 429 with the sentence below.
3. Floor control (§4.2.3) → `order`, `mode`, `chiefWrap`.
4. In one ledger transaction: append `talk.owner {turnId, messageId, text, via, surface: 'room', roomId, meetingId}`,
   insert the op, write meta `active_room`. Broadcast. Return 202 with `order`.
5. In the background (`ctx.waitUntil`), run the responders **sequentially at machine speed** (§4.2.4).

#### 4.2.3 Floor control (`rooms/floor.ts`, pure)

```ts
export interface FloorCandidate { agentId: string; firstName: string; fullName: string; isChief: boolean; seat: number;
  title: string; departmentName: string; skillNames: string[]; oneLiner: string }
export interface FloorInput { text: string; kind: RoomKind; candidates: FloorCandidate[]; phatic: boolean;
  lastFirst: string | null; turnsBy: Record<string, number> /* replies so far this meeting */ }
export interface FloorPlan { order: string[]; mode: FloorMode; chiefWrap: boolean }
export function planFloor(i: FloorInput): FloorPlan;
```

`seat` is the index in `participants` (the scene's seat order, from the owner's left). Rules, in order:

1. **Mentions.** A candidate is addressed by `@First` (any case), by their full name, or by their first name as a
   capitalised whole word that is not a sentence's first word unless a comma follows it ("Hope, what do you think?"):
   several first names are ordinary words (Hope, Joy). Addressed people answer first, in the order they are named.
2. **Group cue.** `\b(everyone|everybody|all of you|you all|y'all|each of you|team|folks|anyone|any of you|go around|round the table|what do you (all )?think|thoughts)\b`.
   With a group cue the plan fills up to the cap after any mentions.
3. **Phatic** (`isPhatic(sniffOwnerText(text, exprLexicon()))`, the WorkspaceDO's helper moved to an export; e.g. "hi everyone", "thanks all"): up to 2 responders (huddle 1–2) in
   rotation order, each answered with a catalog reflex line (§4.2.4, no model call); `mode: 'phatic'`.
4. **Relevance.** Otherwise score every non-Chief candidate: lowercase word tokens of the text (stopwords removed,
   trailing `s`/`es`/`ing`/`ed` stripped, ≥ 3 characters) matched against title tokens × 3, department name × 2, skill
   names × 1.5, one-liner × 1. The top scorer speaks; others join while `score ≥ max(1, 0.35 × top)`, up to the cap.
   All zero → 2 speakers in a conference, 1 in a huddle, by rotation.
5. **Cap** `ROOM_LIMITS[kind].responders` (3; huddle 2) for everything above.
6. **Rotation** breaks ties: seat order starting after `lastFirst` (the previous turn's first responder), then fewer
   `turnsBy`, so no one always goes first.
7. **The Chief** is in the pool only when addressed or when no one else is present. Otherwise, in a conference, when
   the plan has ≥ 2 other responders, `chiefWrap: true` appends `cw_chief` to `order`; it speaks only if ≥ 2 others
   actually spoke.

#### 4.2.4 The room turn (`rooms/room-turn.ts`)

For each responder, in order, while the turn's `gen` is current:

1. `this.expr.takeRate('room', ROOM_TURNS_PER_MIN)` and, for model replies, `usage.take('chat', CHAT_DAILY_LIMIT)`;
   either refused → stop:
   `room.turn {state: 'done', reason: 'limit'}` and an `error` frame "That is a lot of room talk right now. Wait a
   minute and ask again." (the daily limit uses `limitMessage('chat', …)`).
2. `room.turn {state: 'running', next: agentId, order}`; presence claim `feed.claim(agentId, 'room', {state:
   'thinking', label: 'Thinking', causeSeq})`.
3. **Phatic mode:** a catalog reflex reply for that agent (reuse `phaticTurn` with `source: 'room'`, surface `'room'`,
   `roomId`, `meetingId`), no chat count. **Otherwise** a fast-tier, tool-free turn: `resolve('chat', {tier:
   'fast'})`, `callBudget(provider, model, ROOM_REPLY_MAX_TOKENS, 'none')`, `deadlineSignal(15_000, genSignal)`,
   `maxSteps: 1`, system prompt §4.2.5, messages = the room projection §4.2.5, every delta through the reply guard
   §4.2.6. Frames: `talk.delta {turnId, messageId, agentId, delta, surface: 'room', roomId, meetingId}` (whole
   sentences only), then persisted `talk.message {…, kind: 'reply'}` and `talk.done {turnId, messageId, agentId,
   finish, surface: 'room', roomId, meetingId, route: 'room'}`. Each responder gets its own `messageId`; all share the
   owner message's `turnId`.
4. Clear the presence claim. A failed or empty reply is skipped (`talk.done {messageId: null, finish: 'error'}`); the
   turn goes on with the next responder.
5. The Chief's wrap-up runs only if ≥ 2 others produced text. End: `room.turn {state: 'done', order: []}`; delete meta
   `active_room`.
6. Owner mood: `this.expr.ownerMood(agentId, cues, cause)` for each responder (as quick chat does).

Room lines never enter Talk, the Chief's Talk history or any 1:1 desk history: B changes `workspace/talk.ts`
`isChiefTalk`-style filters from `surface !== 'floor'` to "no surface or `'talk'`" and excludes `kind: 'note'`;
`deskHistory` already keeps only `surface: 'floor'`.

#### 4.2.5 Prompts and the room projection (`rooms/prompt.ts`)

System prompt, in order (persona blocks reuse `buildDeskSystemPrompt`'s parts; the Chief's use the lead's persona and
honesty policy from `chief-prompt.ts`):

```
## Platform rules (these override everything below)
- You are an AI coworker in Headcount, the owner's AI office. Your backstory is character lore, not a record of real
  events. If the owner sincerely asks whether you are an AI, answer plainly.
- You have no tools here: you cannot send, book, pay, publish, browse or change anything, and you never say you did.
- You are in {the Skyline room | the Garden room | a quick chat at the {label}} with the owner{, {ownerName},} and
  {Juno Park (Copy lead), Walt Brenner (Brand strategist), …}.
- Speak from your expertise: opinions, principles, questions, trade-offs. Never state a figure, percentage, date,
  result, study or past event unless the owner said it in this meeting. Never say you did, tested, measured, saw or
  finished anything, and never promise work.
- If a colleague already made your point, add something new, disagree politely, or agree in a few words.
## Who you are            (persona or lead block, as the desk / Talk prompts build it)
## Your status            coworker: "You are not on any project yet …" (as desk.ts); Chief: "You can start work only
                          from Talk; in a room you advise."
## Style                  At most two short sentences. Spoken style: plain words, no Markdown, no lists, no emoji,
                          no exclamation marks. Talk to the owner; you may address colleagues by first name.
## Chairing (Chief wrap-up only)  In one or two sentences, pull together what was said and suggest the next step.
                          Add no new facts.
```

**Projection.** The last `ROOM_PROJECTION_LINES` persisted lines of **this meeting** (`talk.owner` and `talk.message`
with this `meetingId`, from `ledger.recent`), oldest first: the owner's lines as `user`; this responder's own lines as
`assistant`; everyone else's as `[Juno (Copy lead)]: …` merged into the adjacent `user` message. The transcript starts
with `user` and ends with a `user` message holding the owner's current line followed by any earlier responders' lines
of this turn. Deterministic, so a test can rebuild what each responder saw.

#### 4.2.6 The reply guard (`rooms/guard.ts`, pure; also wired into `desk/desk.ts`)

```ts
export function figuresIn(text: string): Set<string>;   // normalised: digits and decimals ("9", "9.5", "10:40", "2026"),
  // % and currency ("40%", "$5k" → "5k"), ordinals, quarter-like tokens ("q2" → "2"), number words two…billions and
  // dozen(s) → digits. Not figures: one, a few, a couple, half, double, twice.
export interface ReplyGuardOptions { allowedFigures: Set<string>; workLine: string; figureLine: string; maxSentences: number }
export class ReplyGuard { constructor(o: ReplyGuardOptions); push(delta: string): string; flush(): string; rewrites: number }
```

`ReplyGuard` releases whole sentences (the `HonestyGuard` sentence splitter) and checks each, in order:

| Check | Rule | Action |
|---|---|---|
| Work | `claimsWork(sentence)` (desk's `WORK_CLAIM_RE` + `WORK_PROMISE_RE`) | Replace once with `workLine`; drop later ones |
| Figures | any `figuresIn(sentence)` not in `allowedFigures` | Replace once with `figureLine`; drop later ones |
| Metric movement | `\b(went up|went down|rose|fell|grew|dropped|increased|decreased|doubled|tripled|halved|spiked|jumped|climbed|declined)\b` together with `\b(after|since|last|this|by|points?|percent)\b` | As figures |
| Experience | `\b(I|we)\b[^.?!]{0,30}\b(tested|tried|ran|measured|saw|found|launched|shipped|built|surveyed|interviewed|analy[sz]ed)\b[^.?!]{0,40}\b(last|yesterday|ago|before|when we|this (week|month|quarter|year))\b`, unless the sentence starts with or contains `if|would|could|might|should` before the verb | As figures |
| Citation | `\b(according to|studies show|research shows|the data (shows|says)|surveys? (show|say)|reports? (show|say))\b` | As figures |
| Length | more than `maxSentences` sentences released | Drop the rest |

`allowedFigures` = `figuresIn` of the owner's messages in the projection (rooms) or in the desk history window (quick
chat). `figureLine` = "I'd want the real numbers before I put a figure on it." `workLine` = `unstaffedLine(chief)` for
coworkers, "Bring it to me in Talk and it goes on my list." for the Chief. Lines are logged by kind only (never the
text).

Fixtures `guard.test.ts` must pin:

| Must block | Must pass |
|---|---|
| "Then lead with the reorder rate: it went up nine points after the relaunch." | "I'd lead with sell-through, not brand love." |
| "I can have the one-pager with both numbers by tomorrow noon." | "Show me the reorder rate before we decide." |
| "Brand love doesn't move their Q2 number." (owner never said Q2) | "If churn is the worry, fix onboarding first." |
| "We tested that last spring and conversions doubled." | "I'd think twice before discounting." |
| "Our churn is 4% right now." | Owner: "We have three weeks." → "3 weeks is tight, so cut scope." |
| "Last quarter we closed 30 deals." | "Juno's right, and I'd add a small pilot." |
| "I just finished the competitor grid." | "One idea: test it with a small group first." |
| "According to the latest survey, most buyers prefer bundles." | "I'm not sure; I'd want the real numbers first." |

The office demo's canned lines ("it went up nine points after the relaunch", "I can have the one-pager … by tomorrow
noon", "Supplier prices are in. Two of three went up") become honest opinion lines in `packages/office/demo/main.ts`
(A), so nobody copies them.

#### 4.2.7 Leave note

`roomCancel {leave: true}` appends, when the meeting has at least one owner line, one persisted
`talk.message {turnId: null, messageId, agentId: 'cw_chief', kind: 'note', roomId, meetingId, text}` with no surface
(so it lands in the Talk thread). Deterministic template, no model call:

- Conference: `Skyline room with Juno, Walt and Lena · 4 min` (names from the meeting's speakers and participants,
  `listNames` style; minutes rounded up from the first to the last line).
- Huddle: `Water cooler with Kate and Pax · 2 min` (the `label`, capitalised), or `Huddle with Kate and Pax · 2 min`
  when no label was sent.

#### 4.2.8 `GET /api/office/people` (`rooms/people.ts`)

Every catalog persona (`cw_<id>`, `groupId` = department) plus, when a lead is chosen, the Chief (`cw_chief`, `groupId:
'chief'`, profile from `chiefProfile(settings)`). `pairsWellWith` / `tensionWith` map `pairs_well_with` and
`productive_tension_with[].persona_id` to agent ids (unknown ids dropped). `blend` from the bundle's signature packs
(`archetypes`) or `input.archetypes.lead_blends[leadId]`. `version` = short hash of catalog `sourceHash`,
`EXPR_CATALOG_VERSION`, `leadId`, `chiefName`; `ETag: "<version>"`, `private, no-cache`, 304 on match. Built once per
isolate per version (about 165 entries, ~15 KB gzip).

#### 4.2.9 `POST /api/expr/huddle/render` (`expr/huddle-render.ts`)

Validates the body; `agentId` → `profileFor` (404 unknown; `cw_chief` needs a lead); provider check as `exprRender`
(409 when the agent's provider changed, 503 for `browser`); `exprHuddles()` (new in `expr/catalog.ts`:
`compileHuddles(bundle.huddles.packs, exprCatalog())` once per isolate) → `renderHuddleUtterance(h, {exchangeId,
index, speaker: indexFor(profile), fills})` (400 with the problems) → `toDelivery` → `clipKey` → the same render,
store and rate path as `exprRender` (`EXPR_RENDER_PER_MIN`, `EXPR_CLIP_DAILY_LIMIT`; an R2 hit is `cached: true` and
free). Scope `workspace` when the fills hold a grounded slot or a renamed Chief's name, else `shared`. Response
`ExprClipRef`. A parity test proves the server's clip key equals the client's
`clipKey(toDelivery(huddleUtterance(pick, i), voice, provider))` for the same pick.

`GET /api/expr/catalog`'s **ETag** becomes `"<version>.<huddles.version>"` so a huddle content change is fetched;
`EXPR_CATALOG_VERSION` (the manifests' catalog version) does not change.

#### 4.2.10 Owner name

- `PUT /api/workspace {ownerName}`: string trimmed; blank → null; > 40 characters → 400; control characters or any of
  `<>{}[]\/@#` → 400 ("Use letters for your name."). Stored in the DO settings (no D1 column; the roll-up ignores it).
- Server grounding (`expr/host.ts`): `owner.firstName = ownerFirstNameOf(settings)`, so `{owner_name}` lines become
  eligible for the Chief's server reflexes. Pre-voicing (`expr/prevoice.ts`) passes the `owner_name` fill and puts it
  in the run fingerprint (a rename re-plans; those clips are workspace-scoped already).
- Prompts: rooms (§4.2.5), quick chat and the Chief's Talk prompt add "The owner's name is {first}. Use it rarely."
  when set.

#### 4.2.11 Worker tests (Mock provider unless stated; `apps/worker/src/rooms/*.test.ts`)

`floor.test.ts`: mentions first and in order; `@juno` and "Juno," both count; group cue fills to 3; relevance picks the
legal persona for a contract question and adds a second only above 0.35 × top; rotation moves the first speaker; the
Chief only when named or alone, wrap-up only with ≥ 2 others; huddle caps at 2 and never wraps up; phatic picks ≤ 2.
`guard.test.ts`: the §4.2.6 table; number words match digits both ways; one replacement per reply; the desk guard.
`rooms.test.ts` (in-process DO, scripted providers via `runtime.registry`): 202 order; frames carry `surface: 'room'`,
`roomId`, `meetingId`; ≤ 3 responders; the Chief's wrap-up only after 2; a second say mid-turn cancels (partial
message persisted, `room.turn cancelled reason owner`, queue dropped); `cancel {leave}` posts exactly one note, none
when the owner said nothing; same `opId` idempotent; 429 past `ROOM_TURNS_PER_MIN` and past `CHAT_DAILY_LIMIT`;
room lines absent from desk history, from the Chief's Talk history and from `deskSay`'s projection; a scripted
provider that says "it went up nine points" is rewritten; restart recovery closes an active room turn; `clientId`
claims the voice. `people.test.ts`, `huddle-render.test.ts` (validation, 409/503, clip-key parity, cache hit),
`ownerName` PUT validation.

### 4.3 Web shell hooks (C, Step 0)

| File | Change |
|---|---|
| `api/client.ts` | `roomSay(roomId, body: Omit<RoomSayRequest, 'clientId'>)` (adds `clientId()`), `roomCancel(roomId, body)`, `officePeople(): Promise<OfficePeopleResponse>` (the browser's HTTP cache revalidates the ETag), `exprHuddleRender(req, signal?)`. |
| `store/index.ts` | `reduce()` returns first for `talk.*` frames with `surface === 'room'` (they reach `onFrame` listeners but never the thread, side-threads or unread). `ThreadItem.kind` gains `'note'`. |
| `voice/chief-voice.ts` | Every `surface !== 'floor'` test becomes "no surface or `'talk'`"; `kind: 'note'` is never voiced. |
| `ui/unread.ts` | Ignores `surface: 'room'` and `kind: 'note'`. |
| `routes/Talk.tsx`, `talk.css` | `li.msg[data-kind="note"]`: one muted centred line with a small room glyph, no face, no actions. |
| `voice/ptt.ts` | A push-to-talk **target** (below). `startPtt` barges in on the target (the Chief's `bargeIn()` or the room's `onStart`); `onResult` sends to it; `setLocalPresence(CHIEF_ID, 'listening')` only for the Chief. |
| `app.tsx` | The global keydown returns early when `e.defaultPrevented` for Esc and Space (the scene and the stage handle their own Esc); Space push-to-talk follows the target. |
| `components/Palette.tsx` | `registerPaletteItems(provide: () => PaletteItem[]): () => void` (items appear while registered); a **Set your name** command (§4.6). |
| `talk/actions.ts` | `setOwnerName(name: string \| null)` via `PUT /api/workspace`. |

```ts
// apps/web/src/voice/ptt.ts (C)
export type PttTarget =
  | { kind: 'chief' }
  | { kind: 'room'; roomId: string; label: string;               // "the Skyline room", "Kate and Pax"
      onStart(): void;                                            // barge-in: hush the room (≤ 300 ms, X5)
      send(text: string, at: number): Promise<void> };
export const pttTarget: ReadonlySignal<PttTarget>;
/** Set while a room or joined huddle is open; returns the restore function (back to the Chief). */
export function setPttTarget(t: PttTarget): () => void;
```

### 4.4 Web rooms module (C): `apps/web/src/room/**`

#### 4.4.1 Session (`room/session.ts`), shared by the stage and the joined huddle

```ts
export type RoomEvent =
  | { type: 'owner'; text: string; via: 'text' | 'voice' }
  | { type: 'order'; order: string[]; mode: FloorMode }
  | { type: 'queue'; queue: string[] }                                  // planned responders not yet started; shrinks
  | { type: 'line'; agentId: string; messageId: string; text: string; final: boolean }   // streamed text
  | { type: 'start'; agentId: string; messageId: string; text: string; voiced: boolean; notVoicedTag: boolean }
  | { type: 'end'; agentId: string; messageId: string }
  | { type: 'idle' }                                                    // everything said, turn over
  | { type: 'error'; message: string };                                 // one sentence with its fix

export interface RoomSessionOptions {
  roomId: RoomId;
  participants: () => readonly string[];       // read at every say (the scene is the source of truth)
  label?: string;                              // huddles: the place
  onEvent(e: RoomEvent): void;
}
export interface RoomSession {
  readonly roomId: RoomId; readonly meetingId: string;
  say(text: string, via: 'text' | 'voice'): Promise<void>;   // hushes first; POST say; errors → 'error'
  hush(): void;                                // barge-in: stop audio now, drop the queue, POST cancel
  close(opts?: { leave?: boolean }): Promise<void>;          // stop, POST cancel {leave}; idempotent
  lines(): readonly { agentId: string | 'owner'; text: string; at: number; heard: boolean }[];  // transcript
}
export function openRoomSession(o: RoomSessionOptions): RoomSession;
```

Behaviour:

- **Writer.** `onFrame` (live only) for `talk.*` with `surface: 'room'`, this `roomId` and this `meetingId`, and
  `room.turn` for this meeting; everything else is ignored (other tabs' meetings included).
- **Voicer ‖ player.** Lines play in server order, one at a time. For line *k* the session feeds
  `speakerOf(agentId)` (`chiefSpeaker` or `sideSpeaker(agentId)`) only when *k* ≤ playing + 2 (two lines of TTS look
  ahead), with `holdNext(ended(k − 1))` so audio never overlaps; the gap between speakers is 250 ms. The mouth follows
  `audio().sampler(agentId)` through the faceFactory (§4.5.4); speaking flows through `onSpeakingChange` (A wires it to
  `scene.setSpeaking`).
- **Voice decision at each line's start:** `voiced = settings.voiceOn && mayVoice() && !claimUnsettled() && can('tts')`.
  Not voiced → the message is `silence(messageId)`d on its speaker and the line is paced as text for
  `clamp(1800 + 55 ms × characters, 2200, 6000)` ms. `notVoicedTag = !settings.voiceOn || !can('tts')` (keyless or voice
  off: NOT VOICED); a line voiced in another tab carries no tag. Keyless rooms are captions-only: no browser voice.
- **Barge-in.** `hush()` and `say()` stop every room speaker (`speaker.stop()`), emit `queue: []`, and (hush only)
  `POST cancel`; audio stops within 300 ms of the press (X5). Lines generated but never played stay in `lines()` with
  `heard: false`.
- **Close.** Stops everything; `POST cancel {leave}`; unsubscribes; restores the push-to-talk target.
- Errors from the 202 (`ApiError`) become one `error` event with the server's sentence.

#### 4.4.2 Stage binding (`room/stage.ts`)

```ts
export interface StageHost { scene: OfficeScene; nameOf(agentId: string): string }
export interface StageBinding {
  onEnterRoom(roomId: string, participants: string[]): void;          // open a session, mount the dock, set the PTT target
  onInvite(roomId: string, ids: string[], info: { via: 'picker' | 'drag' | 'keyboard' }): void | boolean;
  onLeaveRoom(roomId: string, participants: string[]): void;          // session.close({leave: true})
  onModeChange(mode: OfficeMode, roomId: string | null): void;
  onOpenInRoom(personId: string): void;        // Enter on a participant: dock field gets "@First " and focus
  meeting(): { roomId: string; meetingId: string; participants: readonly string[] } | null;
  destroy(): void;
}
export function bindStage(host: StageHost): StageBinding;
```

A creates the scene with callbacks that forward to the binding (late-bound through a ref), then calls `bindStage`
(§4.5.2). Event mapping: `owner` → `scene.showCaption(null, text)`; `order`/`queue` → `scene.setFloorQueue(queue)`;
`start` → `scene.showCaption(agentId, text, {voiced: !notVoicedTag, final: true})` and, for text-only lines,
`scene.setSpeaking(agentId, true)` until `end`; `line` while that line plays → update the caption; `idle` → clear the
caption after 4 s; `error` → the dock's one-line notice. Presence (the next responder *thinking*) comes from the
store through A's presence effect, and the stage already dims listeners and lifts the speaker.

#### 4.4.3 Dock (`room/RoomDock.tsx`, rendered with Preact `render()` into `scene.dock()`)

- One field: "Message the room, or hold Space to talk" (fine pointer) / "Message the room" (touch) with a hold-to-talk
  mic button (the `useHoldToTalk` gesture, room target) and a send button. Enter sends; Esc on an empty field leaves
  (the scene already handles it).
- While push-to-talk listens, the dock shows the live partial transcript (the global `PttCaption` stays for the
  Chief only).
- A collapsed **Transcript** disclosure lists the meeting's lines (`session.lines()`), unheard ones marked "not
  heard": the accessible, non-live record of every line (X11, EXPERIENCE §9.2).
- Empty state (no one invited): "Invite people to the table. They answer when you talk to the room." with the
  Invite (I) button.
- Errors: one sentence in the dock ("That is a lot of room talk right now. Wait a minute and ask again.",
  "Add a provider key or start Ollama to talk to the room.").

#### 4.4.4 C's tests (`room/*.test.ts`, happy-dom, fake api, fake speakers, fake clock)

Order → queue; lines play strictly in order with ≤ 2 ahead; a second say hushes and the new order replaces the queue;
hush stops speakers and posts cancel; close posts `{leave: true}` once; frames of another meeting are ignored;
`mayVoice()` false → no speaker fed, captions with no tag; keyless → NOT VOICED and reading-time pacing;
`claimUnsettled()` → text only; the store guard (room frames never in `thread`, `sideThreads` or unread); the
chief-voice guard (a Chief room line and a note are not voiced); the push-to-talk target routes the result and barges
in on the room; Esc and Space defer to `defaultPrevented`; the Talk note renders; the palette registry adds and
removes items; the onboarding name field is optional.

### 4.5 Web office (A): `apps/web/src/office/**`

#### 4.5.1 The Floor route

- `office/view.ts`: `floorView` signal (`'office' | 'directory'`). Resolution: `?view=` (then persisted) →
  `localStorage['hc.floor.view']` (try/catch) → default `'office'` when `matchMedia('(min-width: 900px) and (pointer:
  fine)')` matches, else `'directory'`. No toggle (and always Directory) before onboarding.
- `Floor.tsx`: a two-option segmented control **Office | Directory** in `.floor-head-controls` before
  `VoiceElsewhere` and `AmbienceControl` (`role="radiogroup"`, arrow keys, `data-testid="floor-view"`). Office view:
  the lede, `ChiefCard`, search and department tools and the Directory are not rendered; `<OfficeView/>` (lazy,
  `loadOffice` in `lazy.ts`) fills the route below the header: `height: calc(100dvh - <header> - <bottom tabs on
  phones>)`, full bleed, no page scroll. The office's skip link (`onRequestDirectory`) sets `'directory'` and focuses
  the Directory heading. An error boundary around the office falls back to the Directory with one notice: "The office
  view could not load. Showing the Directory."
- `useReplyKey` (R): with a joined huddle, R focuses `.hc-o-hcard__input`; otherwise it replies to `activeDesk` as
  today (the office sets it through `onFocusChange`).

#### 4.5.2 `OfficeView.tsx`: mount order

```ts
const scene = createOfficeScene(host, {
  people, groups, leadId: CHIEF_ID,                  // §4.5.3
  theme: resolvedTheme.value, accentFor,              // lib/accent's accentFor(hex, theme); an effect calls scene.setTheme
  faceFactory,                                        // §4.5.4
  keyTarget: 'document', timeOfDay: 'auto', reducedMotion: null,
  now: officeNow,                                     // real clock; DEV-only `?at=HH:MM` shifts it (e2e)
  insets: { right: 88, bottom: 88 },                  // the Chief bubble's corner (phones: 72); §4.5.12
  onHover, onHoverEnd, onOpen, onFocusChange,         // §4.5.6
  onEnterRoom: (r, ids) => stageRef.current?.onEnterRoom(r, ids),
  onInvite: (r, ids, i) => stageRef.current?.onInvite(r, ids, i),
  onLeaveRoom: (r, ids) => stageRef.current?.onLeaveRoom(r, ids),
  onModeChange: (m, r) => stageRef.current?.onModeChange(m, r),
  onViewportChange,                                   // §4.5.11
  onRequestDirectory, onFollowChange, onAutopilotChange, onLifePause,
});
stageRef.current = bindStage({ scene, nameOf });      // C
const life = createOfficeLife(scene, { people: lifePeople, seed: settings.workspaceId, ambience, reducedMotion: null,
  leadId: CHIEF_ID, lines, frameOpening: !cameraRestored && !deepLinkFocus, planIn: 'idle', now: officeNow,
  onHuddleLine, onJoinHuddle, onLeaveHuddle, onTalkToHuddle, onHuddleToRoom, onListenIn, onPauseChange });
// Unmount, in this order: keys and effects off → stage.destroy() → life.destroy() → scene.destroy().
```

`cameraRestored` = `sessionStorage['hc.office.camera']` exists. Life starts when `officePeople` answers or after 1.5 s
with neutral personalities (`{id}` only), then `life.setPeople()` when they arrive. Deep links: `&room=` →
`scene.enterRoom(room)` after binding; `&focus=<personaId>` → `scene.focus(coworkerAgentId(id), {zoom: 'desk'})`;
both are removed from the URL afterwards (`history.replaceState`), `view` stays.

#### 4.5.3 People

`OfficePerson`s from the slim catalog (no new fetch): the Chief `{id: CHIEF_ID, name: chiefName, title: 'Chief of
Staff', groupId: 'chief', accent: currentLead.avatar.accent_color, seniority: 'principal'}` and the 164 personas
`{id: coworkerAgentId(p.id), name, title, groupId: p.department, accent: p.avatar.accent_color, seniority}`; groups =
the catalog departments. `OfficeLifePerson`s from `GET /api/office/people`: `{id: agentId, sliders:
profile.personality.sliders, traits: profile.personality.traits, blend, pairsWellWith, tensionWith, teamRoles}`. A lead
or name change → `scene.setPeople()` then `life.setPeople()`.

#### 4.5.4 `faceFactory` (`office/faces.ts`)

```ts
const faceFactory: FaceFactory = (agentId, tier) => {
  const subject = subjectFor(agentId);                 // leadSubject(currentLead, chiefName) or personaSubject(persona)
  const el = document.createElement('div');
  el.className = 'office-face';
  el.style.setProperty('--accent', accentFor(subject.accent));
  const view = new FaceView({ tier, name: subject.name, detectLandmarks: false,     // stored landmarks only (§6)
    onLandmarks: (lm) => saveLandmarks(subject.id, lm) });
  view.setAppearanceFallback({ appearance: subject.appearance, accent: subject.accent, name: subject.name });
  view.mount(el);
  void portraitFor(subject.id).then((info) => info && view.setPortrait(info));
  const unregister = registerFace(agentId, { cue: (c) => view.cue(c), setExpressionBias: (b) => view.setExpressionBias(b) });
  const attach = (t: FaceTier) => view.attachSampler(t === 'token' ? null : audio().sampler(agentId));
  attach(tier);
  return {
    el, drawsChrome: true,                             // FaceView's ring and glyph; the office keeps halos only
    setTier: (t) => { view.setTier(t); attach(t); },
    setState: (s, label) => view.setState(toProtocolState(s), presenceText(subject, toProtocolState(s), label)),
    cue: (g) => view.cue({ gesture: g as FaceCue['gesture'], holdMs: 900 }),
    destroy: () => { unregister(); view.destroy(); },
  };
};
```

`toProtocolState` maps the office's `blocked` and `away` to `idle`. Mood reaches office faces through the existing
`registerFace` bias. The office's LOD decides tiers (L0 none; L1 tokens 24–32 px; L2 40–58 px; stage hero), capped by
FaceView's scheduler (`maxAnimatedTiles: 3`).

#### 4.5.5 Presence, speaking and real-state overrides (`office/presence.ts`)

- An effect over `presence` and `localPresence`: for each agent whose shown state changed, `scene.setPresence(id,
  state, {label, badges})`, where `state`/`label` merge the server claim with local *listening* (never local
  *speaking*) and `badges` come verbatim from the server's `PresenceData.badges` (nothing produces `lamp` or `hand`
  yet; wiring them costs nothing). The Chief's label is `chiefPresence`'s.
- `audio().onSpeakingChange((id, on) => scene.setSpeaking(id, on))`, unsubscribed on unmount.
- **The Chief's activity:** an effect over the Chief's running job: `life.setActivity(CHIEF_ID, activityOf(job.label))`
  (null when none). Research walks the Chief to the library; everything else keeps the desk.
- **The Chief in conversation:** while `chiefPresence.state` is `thinking`, `speaking` or `listening`, and for 20 s
  after, `life.pin(CHIEF_ID, 'here', 'owner')`.
- Quick chat: `openReply(id)` → `life.pin(id, 'here', 'owner')`; `closeReply` → unpin 20 s later.
- Raised hands, room seats, hover, focus, drags and anchors are already read by life through the scene (claims 1–5 of
  OFFICE-LIFE §2.9); life never writes presence.

#### 4.5.6 Desk mode: passing by, bubbles, quick chat

- `onHover(id, {phase, via})`: if `life.whereIs(id).state === 'huddle'` → nothing (the scene shows the huddle card);
  if it is `break`, `visit` or `walking` → on `dwell` only, an **availability** bubble: `showCaption({agentId: id, text:
  seededPick(DEFAULT_STRINGS.life.availability, id + dayKey), kind: 'bubble', replyable: true, ttlMs, intent:
  'passing_by'})` plus `livingCue(id, {gesture: 'look_up', holdMs: 1200})`, never voiced, never a work status
  (OFFICE-LIFE A4); otherwise `livingHover(id, phase, via)`. `onHoverEnd(id, {via})` → `livingHover(id, 'leave', via)`.
- `onFocusChange(id)` → `activeDesk.value = id`.
- **Bubbles:** for each agent in `bubbles.value` with a seat (desk mode), portal `<FloorBubble agentId first
  hovered onOpenDesk deskLabel onFollow placement="anchor"/>` into `scene.anchor(agentId).el`; release the anchor when
  the bubble goes. `hovered` from a signal fed by `onHover`/`onHoverEnd`. FloorBubble gains two optional props:
  `onFollow?()` (a "Follow" text button beside Reply → `scene.follow(id)`) and `placement?: 'card' | 'anchor'`
  (anchor: 72 px HUD clearance instead of the Directory's 120 px sticky bar).
- `onOpen(id, {mode})`: conference → `stage.onOpenInRoom(id)`; otherwise `openReply(id)` for anyone, the Chief
  included (§0.1); "Open desk" → the profile, the Chief's → Talk.

#### 4.5.7 Small talk: the huddle lines provider (`office/huddles.ts`)

The reference is `packages/office/demo/huddle-lines.ts`; the app version differs only where noted:

- **Content** comes from the bundle the living runtime already fetched: `living.huddles.packs` (§4.5.13). Until the
  runtime is ready and the huddles are compiled, `lines()` returns null (silent huddles).
- **Compile in idle time:** `compileHuddlesLenient(packs, living.catalog)` in one `requestIdleCallback` after life's
  first plan (the demo measured 50–84 ms at 4× CPU; never on the first frame).
- **Participants:** `{agentId, firstName, index: indexOf(id), mood: living.moodOf(id) ?? index.baseline, department:
  groupId, teamRoles, isChief, pairsWellWith, tensionWith, ...(req.hostId === id ? {atDesk: true} : {})}` with
  `indexOf(id)` = `buildAgentIndex(living.catalog, officePerson.profile)`, cached per agent and catalog version and
  built only for people in a huddle that talks.
- **Request:** `{huddleId, spot: req.spot.kind, participants, now: {epochMs, localHour, weekday}, ambience:
  req.ambience, provider: living.provider(CHIEF_ID) ?? 'browser', maxLines, contexts: req.contexts, chiefName,
  grounding, seed: req.seed, avoid: new Set(req.previous)}` → `huddleScriptOf(pick)`.
- **Recency:** `createHuddleRecency(snapshot)` from `localStorage['hc.expr.huddles.v1']` (try/catch); a pick is
  recorded on its first line seen (`onHuddleLine` with `visible` or `glyph`); saves debounced 400 ms and on
  `pagehide`. Cross-device sync is a later increment.

#### 4.5.8 Grounded events (`office/grounding.ts`)

`grounding = {events}` from the store, recomputed when `jobs` change:

- For each Chief job with `status: 'done'` and `finishedAt` within 8 h: `{kind: 'job.done', agentIds: [CHIEF_ID], at,
  visibility: 'team', cause: {streamId: 'ws:<workspaceId>', seq}, artifact: 'write-up'}`, where `seq` is the mirrored
  `job.done` frame's (tracked from `onFrame`, replay included; no seq known → the event is skipped).
- The job's **title, summary and result never reach small talk** (privacy; a job title is the owner's words).
- Nothing else is an event in Inc 0.7 (no hires, projects, deliverables or verdicts yet). No events → grounded
  exchanges never play (the engine's rule).

#### 4.5.9 Captions and the pill

`onHuddleLine(h, e)` → `logCaption({agentId, text: \`${first} → ${others} · ${h.label}: ${text}\`, kind:
'smalltalk'})` (a new export of `living/captions.ts`: the caption log only; never `lastSaid`, never live regions);
laughs log as "Emilio laughs". The What's happening pill, Follow, Autopilot (`autopilotKey` default, one-time offer)
and Pause are built into the scene; A wires ⌘K items through `registerPaletteItems` while the Office is mounted:
"Office: let the camera wander" / "Office: keep the camera still", "Pause office life" / "Resume office life",
"Office sky: Auto / Night / Dusk / Day" (session only).

#### 4.5.10 Listen-in voice (`office/listen.ts`)

`onListenIn(h)` records the listened huddle. On `onHuddleLine(h, e)` with `e.listening` and `e.line.kind !== 'face'`:

1. Gates, all required: `mayVoice()` and not `claimUnsettled()`; `settings.voiceOn`; `audio().armed`; Ambience not
   Quiet (quiet hours do not block an explicit Listen, §0.1); provider not `browser` (keyless listen is captions
   only); the line is `voiceable`; `!audio().micLive()`; no conversation audio playing
   (`!audio().foregroundActive()`: dropped, not queued); `living.ambientVoice.leftMs() ≥ estimated ms`.
2. `api.exprHuddleRender({exchangeId, index, agentId, fills, provider})` with a **1.2 s** timeout (the bubble shows
   either way; late → no audio) → `living.loadClip(clipKey)` → re-check `mayVoice()` →
   `audio().playPrepared({speakerId: agentId, audio: clip.handle, bus: 'ambient', gainDb: -6, priority: 4, ttlMs: 1200})`.
3. On start, `living.ambientVoice.spend(durationMs)`. Lip sync follows the sampler on the speaker's tile;
   `onSpeakingChange` drives `scene.setSpeaking`.
4. Listening ends as the director says (dispersal, 2 minutes, off-screen, second L). **L** (host key): `life.listenIn(
   life.getState().listening === card ? null : card)` with `card = scene.getState().huddleCard`.

#### 4.5.11 Join (`office/join.ts`)

- `onJoinHuddle(h)` opens C's session: `openRoomSession({roomId: huddleRoomId(h.id), participants: () => h.members,
  label, onEvent})`, where `label` is `h.label` in lower case when it matches `ROOM_LABEL_RE` and is omitted otherwise.
- **Greeting.** The greeter is the member with the highest warmth slider (seeded tie-break):
  `living.sayIntent(greeter, 'greeting')` → `life.reply(greeter, text)`. If the runtime is not ready yet, the greeter
  says "Oh, hi {ownerFirst}." (or "Oh, hi." with no name set), captions only.
- **Push-to-talk** goes to the huddle while joined: `setPttTarget({kind: 'room', roomId, label: names, onStart: () =>
  session.hush(), send: (t) => life.talk(t)})`, with the next `say` marked `via: 'voice'`.
- `onTalkToHuddle(h, text)` (the card's field, or `life.talk` above) → `session.say(text, via)`.
- Session events: `start` → `life.reply(agentId, text)`, so the bubble appears as the voice starts; `error` →
  `showNotice(message)`, never a line in someone's mouth. Replies are owner-directed: voiced per speaker like quick
  chat (outside the ambient budget) and gated like every room line (§4.4.1).
- `onLeaveHuddle(h)`: `living.sayIntent(lastMember, 'sign_off')` → a passive bubble; `session.close({leave: true})`
  (the note appears only if the owner said something); restore the push-to-talk target.
- **Open in a room** (`onHuddleToRoom`, §4.5.12): mark the move, then `session.close({leave: false})` with no
  sign-off and no note; the stage opens its own meeting with the same people, and leaving it writes the note.

#### 4.5.12 `packages/office` additions (additive; zero dependencies; the existing 127 office tests keep passing)

- `OfficeOptions.insets?: {top?, right?, bottom?, left?}` (px): the HUD (zoom buttons, mini-map, pill, chips) and
  bubble placement keep out of them.
- The director handles `HuddleAction 'room'` (the card's "Open in a room"): members = the people present; first
  `options.onHuddleToRoom?.(huddleInfo)` (new callback: the host marks the move, so its `onLeaveHuddle` skips the
  sign-off and the note), then `api.leave()`, then `port.enterRoom?.(members.length <= 7 ? 'garden' : 'skyline',
  members)` (`LifeScenePort.enterRoom?` is optional; OfficeScene has it). Tested.
- The demo's canned lines become honest (§4.2.6); `DEFAULT_STRINGS` unchanged unless a string is missing.
- Anything else found missing while wiring: additive, tested, listed in A's summary.

#### 4.5.13 Living runtime and expressions additions (A)

```ts
// apps/web/src/living/types.ts — LivingRuntime gains:
readonly huddles: { version: string; packs: readonly unknown[] } | null;     // bundle.huddles, kept at boot
readonly ambientVoice: { leftMs(): number; spend(ms: number): void };       // the runner's own 10-minute window
loadClip(clipKey: string): Promise<PreparedClip | null>;                    // the runtime's clip store
moodOf(agentId: string): Mood | null;                                       // decayed mood when loaded, else null
provider(agentId: string): ExprTtsProvider | null;
/** An owner-directed greeting or sign-off by catalog selection with live grounding (owner name, first meeting).
 *  Voiced only when voice is on and this tab may voice; returns the caption text. Never throws. */
sayIntent(agentId: string, intent: 'greeting' | 'sign_off'): Promise<{ text: string; voiced: boolean } | null>;

// packages/expressions ChatterBudget gains (gate.ts; optional in the interface):
voiceLeftMs?(now: number): number;          // cap − voiced ms in the rolling 10-minute window at this Ambience
spendVoice?(now: number, ms: number): void; // counts voiced ms without spending a chatter token
```

Also: `grounding.ts` fills `owner.firstName` from `ownerFirstNameOf(settings)`; the runtime ignores `talk.*` frames
with `surface: 'room'` (room turns are not the runner's conversations); `viewer.ts` `ViewerInput.office?: {mode,
roomId}` makes `stageOf` report `surface: 'room'` while the stage is open (`onViewportChange` updates a signal the
runtime reads; the op stays debounced 250 ms); `captions.ts` exports `logCaption`.

#### 4.5.14 First-run hint and dev hooks

- First Office open on a fine pointer (`localStorage['hc.office.hint.v1']` absent): one quiet chip at the HUD's bottom
  left for 8 s, "Rest on anyone to say hi · Click to chat · H for huddles", with a close button; any click dismisses
  it for good. No tour, no modal.
- DEV builds only: `window.__headcount.office = {scene, life, view: () => floorView.value, stage: () =>
  binding.meeting()}`; `?at=HH:MM` on `/app/floor` shifts the office clock (scene and life) for e2e and demos.

#### 4.5.15 A's tests (`apps/web/src/office/*.test.ts(x)`, happy-dom; `living/*.test.ts`; `gate.test.ts`)

Mounts with 165 `.hc-o-seat` and destroys with no `.hc-office`, no `#hc-office-style` and no pending timers (fake
timers); view default, persistence and `?view=`; no toggle before onboarding; the faceFactory returns `drawsChrome`,
attaches the sampler only above token and unregisters on destroy; hover routing (huddle → nothing, break →
availability bubble with no voice, desk → `livingHover`); presence diffing and the Chief's activity and pin; the lines
provider returns null before the runtime, a script after, `avoid` from `previous`, recency recorded only on seen
lines; grounding uses only done Chief jobs ≤ 8 h, as "write-up", never the title; the Listen gate matrix (no voice
owner, voice off, Quiet, keyless, budget spent, mic live, conversation playing → no render); a render later than
1.2 s plays nothing; Join opens a session with ≤ 4 members, greets, and leave closes with `{leave: true}`; the
`'room'` huddle action; `insets`; `voiceLeftMs`/`spendVoice`; `sayIntent` never plays without `mayVoice()`.

### 4.6 Owner name UI (C)

- **Onboarding:** under the Chief's rename field, an optional field "What should the office call you?" (hint:
  "Optional. Used in greetings."), `maxLength 40`, `autoComplete="given-name"`; saved in the same `PUT` as the lead;
  blank sends nothing. Skipping is the default path.
- **⌘K → Set your name:** the palette switches to one text field ("Your first name"), Enter saves via
  `setOwnerName`, Esc cancels, blank clears. The item's hint shows the current name.
- Nowhere else asks. The name is used only in greetings, sign-offs and prompts (§4.2.10), never in small talk
  (huddle packs have no `owner_name` slot by design).

---

## 5. The owner's experience

### 5.1 The first ten seconds (desktop)

1. Floor opens as the Office at L1 on the liveliest neighbourhood (usually the café), or where the owner left the
   camera this session. The huddle already on screen talks at once; if nobody is walking in view, one planned
   departure starts now (the opening nudge).
2. The first-run chip appears once. Nothing else asks for attention: no counters, no tour.
3. The Chief's corner office shows their real state; a running job lights their monitor, and research walks them to
   the library.

### 5.2 One gesture for everything

| The owner wants to | Gesture | What happens |
|---|---|---|
| See who is here | Open the Floor | The office, alive; faces are the status |
| Say hi | Rest on a face 600 ms | Look-up and one true line (voiced at Lively, in this tab only) |
| Chat with anyone | Click them, or R | Reply field in place; they stop and face you |
| Hear the water cooler | Hover the huddle → **Listen**, or L | Their small talk in their voices |
| Join them | **Join**, or Enter on the card | They turn, one greets you by name, you type or hold Space |
| Follow someone | F, or **Follow** in their bubble | The camera keeps them in view |
| Hold a meeting | Click a glass room (or the Conference toggle, or G) | The stage; I invites |
| Talk to the room | Type, or hold Space | Up to three answer in turn, captioned, lip-synced |
| Interrupt | Hold Space or send | Everyone stops within 300 ms; the new question takes the floor |
| Leave | Esc | Back at the desks; one quiet line in Talk |
| Use a list | **Directory**, or the skip link | The Directory, fully capable |

### 5.3 Copy

Toggle "Office" / "Directory". Dock "Message the room, or hold Space to talk". Huddle field "Say something to Kate and
Pax…" (built). Notes "Skyline room with Juno, Walt and Lena · 4 min", "Water cooler with Kate and Pax · 2 min". Hint
"Rest on anyone to say hi · Click to chat · H for huddles". Errors: "That is a lot of room talk right now. Wait a
minute and ask again." · "Add a provider key or start Ollama to talk to the room." · "The office view could not load.
Showing the Directory." · "Could not reach them. Try again."

### 5.4 Phones, accessibility, motion

- Phones: Directory by default; the Office one toggle away with the office's phone caps, the stacked stage and the
  dock's hold-to-talk button. Coarse pointers get 44 px targets (built).
- Screen readers cannot be detected: the toggle is the first control after the heading, the office's first stop is
  "Use the Directory (list view)", and the choice persists. The stage's dock, picker and transcript are ordinary
  controls. Nothing is announced live (EXPERIENCE §9.2).
- Reduced motion (OS setting, followed live): fades instead of walks, no autopilot, no tilt or bob, instant stage;
  lip sync stays.

---

## 6. Budgets

| Item | Budget | Source |
|---|---|---|
| Directory users | Load nothing of the office (no chunk, no art, no `/api/office/people`) | OFFICE-PLAN §6.2 |
| Office chunk | ≤ 70 kB gzip for `OfficeView` + `@headcount/office` (the expressions engine is already in the living chunk) | new |
| Opening | First office paint ≤ 300 ms after the chunk loads (warm); life running ≤ 1.2 s; host wiring adds no long task > 50 ms at 1× CPU | OFFICE-LIFE §8.3 (820 ms in the demo) |
| Pan and zoom | 60 fps; p95 ≤ 16.7 ms with 96 faces, life at Buzzing and 3 bubbles; ≤ 4 ms main thread per frame | OFFICE-PLAN §3.8, OFFICE-LIFE §7.1 |
| Idle | Zero office rAF with nothing visible moving; FaceView's scheduler only; no timers while off-screen or hidden | same |
| Faces | ≤ 96 mounted, ≤ 3 animated tiles + 1 hero, `detectLandmarks: false` (stored landmarks only) | OFFICE-PLAN §2.5, §3.8 |
| Host effects | Presence diff ≤ 1 ms per change; viewer op ≤ 1 per 250 ms; recency save debounced 400 ms, ≤ 32 KB | new, OFFICE-LIFE §7.1 |
| Huddle engine | Compile in idle time only; ≤ 1 ms per pick | OFFICE-LIFE §6.2 |
| Rooms latency (keyed) | 202 ≤ 150 ms; first responder's first sentence on screen ≤ 1.8 s; first voiced audio ≤ 2.5 s; barge-in audio stop ≤ 300 ms | D2, X5 |
| Rooms cost | ≤ 3 responders + 1 wrap-up per owner message; ≤ 160 output tokens each; ≤ 12 replies a minute; each reply counts against `CHAT_DAILY_LIMIT`; room TTS counts against `TTS_DAILY_LIMIT` | OFFICE-PLAN §6.4 |
| Listen-in | Within the shared ambient window: 20 s (Lively) / 40 s (Buzzing) of voiced ambient audio per 10 minutes, passing-by included; 1.2 s render timeout; `EXPR_CLIP_DAILY_LIMIT` | LIVING-WORKFORCE §9.2 |

---

## 7. Tests

### 7.1–7.3 Builders

B: §4.2.11. C: §4.4.4. A: §4.5.15. Each builder also runs, before handing over: `pnpm --filter <their packages>
typecheck` and `npx vitest run <their paths>` plus `npx vitest run packages/office packages/expressions apps/web/src/living`
(A), `npx vitest run --project worker` (B), `npx vitest run apps/web` (C).

### 7.4 End-to-end and screens (integrator)

`e2e/office.spec.ts` (project chromium, Mock), after onboarding with an owner name:

1. 1440 × 900, fine pointer: the Floor opens as the Office with 165 `.hc-o-seat`; the toggle persists across a reload;
   `?view=directory` shows `.cw-grid .cw-card`; the skip link switches to the Directory.
2. Keys at load: G opens Walk to, `/` focuses Find, Home focuses the Chief, arrows move along a bench, Enter opens the
   reply field.
3. Hover a desk 700 ms → a `.floor-bubble` inside `.hc-o-anchor` and `data-face-cue="look_up"` on its face.
4. Click a face → the reply field is focused; send → the Mock reply in the bubble; nothing in Talk.
5. A quick chat's thinking claim lights the desk (`.hc-o-sl[data-mon]`) and sets the seat's `data-state`.
6. Walk to the Skyline room → I → invite two → two `.hc-o-sseat`; send "What do you all think?" → two Mock replies as
   captions in order, each speaker highlighted; a second message cancels the rest (`room.turn` cancelled); Esc leaves
   → no `.hc-o-seat[data-room]` after 2 s; Talk shows one `li.msg[data-kind="note"]` and no room lines; the desk
   side-threads hold no room lines.
7. Drag a badge onto the Garden room → the door plate reads "… · waiting for you".
8. Reduced motion: computed transition durations 0 and the camera jumps.
9. 375 × 812: the Floor opens as the Directory; toggled, the HUD is one row with the Find icon.

`e2e/office-life.spec.ts` (`?at=10:35`): opens at L1 with a `.hc-o-huddle`; a talk bubble within 5 s; the hover card
with its habit line; Join greets the owner by name and focuses the field; a message gets ≤ 2 Mock replies as bubbles;
Esc leaves and Talk gets the note; clicking a walker stops them and opens the reply field; F shows the Following chip
and the person keeps walking; the pill says "on a break"; reduced motion fades; Pause freezes.

`e2e/office-voice.spec.ts` (project living-voice, Mock media): Listen voices a huddle line exactly once on the ambient
bus and stops when the window is spent; with two contexts on one workspace only the voice owner plays room lines and
listen-in (the other shows captions and the chip); stage speakers get `[data-speaking]` in order with a moving mouth;
holding Space stops room audio within 300 ms and sends to the room, not the Chief.

Screens (`docs/dev/screens/office-phase2/`): `office-night-l1`, `office-hover-bubble`, `office-quick-chat`,
`office-huddle-card`, `office-huddle-joined`, `office-stage-speaking`, `office-stage-not-voiced`, `talk-room-note`,
`office-mobile-375`, `directory-toggle`. Probes on the integrator's stack: pan p95 and idle rAF with life at Buzzing
(port `packages/office/demo/check.mjs`'s probe to `/app/floor`), opening long tasks at 1× and 4× CPU, axe on the
Office and the stage.

---

## 8. Integration checklist and the owner demo

1. B's Step 0 landed (types, routes, registrations); C's Step 0 landed (hooks); `pnpm typecheck` green.
2. Merge review against §3.1: no file edited by two builders; the §2.2 files keep the owner's lines.
3. `pnpm typecheck && pnpm test && pnpm build`; the office chunk size; `pnpm e2e` (all projects) with the new specs.
4. Screens and probes (§7.4); CONTRACTS §9 (rooms, office people, huddle render, ownerName, `room.turn`, `kind:
   'note'`, the push-to-talk target, the palette registry); OFFICE-PLAN §6 and OFFICE-LIFE §7.3 checked off; §10 here.
5. Clean up every state directory and server; report.

**Owner demo** (keyed stack, voice on): open the Floor at 10:36 → the café at L1, the cooler crew talking → rest on a
desk (look-up and a line) → click a walker (they stop; chat in place) → hover the cooler ("Their usual 10:40 at the
water cooler") → **Listen** → **Join** (greeted by name) → say something → Esc → F on a walker → What's happening →
walk to the Skyline room → invite three → "What do you all think about bundling?" → hear the answers, captioned →
hold Space to barge in → Esc → Talk shows the meeting line. At 23:10: two people at the north glass.

---

## 9. Risks and open questions

- **Room fillers.** Phase 2 shows a face cue while a responder thinks; a voiced "hm, good question" is left out to keep
  the one-voice and budget rules simple. First audio is about 2.5 s after sending with keys.
- **Chief in rooms has no tools.** "Look into it" in a room gets "Bring it to me in Talk and it goes on my list."
  Starting work from a room is Inc 2 (RoomDO with tools).
- **Notes are not in the Chief's model memory** (they would read as the Chief's own words). If the owner wants the
  Chief to remember meetings, add a system context line in Inc 1.
- **Guard false positives.** A sentence with an unmentioned figure is replaced even when harmless ("a 2x2 grid");
  the fixtures keep the common idioms passing. Tune with real transcripts.
- **Grounded small talk is thin** until Inc 1 events exist (only the Chief's write-ups).
- **Night Shift lamps** stay dark: nothing produces the `lamp` badge yet.
- **Recency across devices** is per browser until it syncs through the workspace (OFFICE-LIFE §7.5).
- **Unheard room lines** (generated, then cut by a barge-in) stay in the transcript marked "not heard"; the server
  generates at machine speed and cannot know playback.
- **Quiet hours** (§0.1): bubbles stay, ambient voice goes, explicit Listen still voices. The owner may prefer silent
  huddles at night; it is a one-line change.
- **Autopilot** stays off by default with the one-time offer (OFFICE-LIFE §7.5).

---

## 10. As built

*29 September 2026, integrator.* All three builders' work is in the tree (uncommitted, beside the owner's voice work),
wired end to end and verified on the integrator's own stack (`--mock --mock-media`, :5194/:8894) and the two e2e
stacks. Contracts: [CONTRACTS.md §9](CONTRACTS.md#9-inc-07--the-office-office-phase-2). What the owner sees:
[INC0.md §4d](INC0.md#4d-inc-07-the-office). Screens: [`screens/office-app/`](screens/office-app/).

### 10.1 What landed

- **A · web office:** the Office | Directory toggle (remembered, deep links, skip link, load-failure fallback), the
  lazy office mount (scene, faces, presence, office life, small talk, listen-in, Join, ⌘K items, hint, dev hook),
  the living-runtime additions, `@headcount/office` additions (insets, `onOpened`, the huddle card's "Open in a
  room", honest demo lines).
- **B · worker rooms:** `POST /api/rooms/:roomId/say|cancel` in the WorkspaceDO (floor control, sequential fast
  turns, the room projection, cancel and leave with one note), the reply guard on every room, huddle and desk reply,
  `GET /api/office/people`, `POST /api/expr/huddle/render`, `ownerName`.
- **C · web stage:** the room session (writer ‖ voicer ‖ player), the stage binding, the dock (text, hold-to-talk,
  transcript), the shell hooks (store and voice guards for room frames and notes, the push-to-talk target, Esc and
  Space deferring to the page, the palette registry, the Talk note line), the owner-name field and ⌘K command.

### 10.2 Integration changes (the integrator's, and why)

| Change | Where | Why |
|---|---|---|
| The office shows the Chief's running job as `working` (the running sentence as status, monitor lit), under any conversation state | `office/presence.ts` (`chiefJob`, `shownClaim(…, work)`) + test | The server never claims the Chief busy (D2: "working and available together"), so the Chief sat idle in the office with a job running and life never brought them to their desk. §5.1.3 asks for "a running job lights their monitor". |
| Join greets by name: `sayIntent('greeting')` prefers, among the lines the catalog allows now, one that says the owner's name (seeded retries, pure) | `living/runtime.ts` + `living/office.test.ts` | The first-meeting pool often picked "Hello. I'm Ayu — I work with Rosa." with the owner's name set; §0 promises "one greets you by name". |
| A joined huddle's reply grows in place: the session's later `line` events update the speaker's line and bubble (`OfficeLife.reply(id, text, {update: true})`) | `office/join.ts`, `packages/office/src/life/director.ts` + tests | A reply shown at its start (the first sentence, keyless) never showed the rest. |
| The huddle label keeps its capitals (`"At Liban's desk"` → `"at Liban's desk"`); the prompt uses a place phrase as it is | `office/join.ts` `huddleLabel`, `apps/worker/src/rooms/prompt.ts` `placePhrase` + `rooms/prompt.test.ts` | The leave note read "At liban's desk with Liban and Ayu", and the prompt "a quick chat at the at liban's desk". |
| Enter on a desk right after an arrow key focuses the reply field once the person is on screen | `office/OfficeView.tsx` (`FOCUS_REPLY_WITHIN_MS`) | The field was rendered in an anchor hidden during the camera's flight, and a hidden field cannot take focus: the reply field stayed unfocused (found by the keys e2e). |
| What's happening fills only the top moment's action (a raised hand's Talk always) | `packages/office/src/scene/life-ui.ts` + `scene/life.test.ts` | Five filled amber "Listen" buttons in a column; the list is calmer with one. |
| Phones: in Office view the header's Ambience control is its icon (its name stays in the accessible label) | `routes/floor.css` | With the "Play here" chip the one-row header clipped the Ambience control. |
| Existing e2e specs that test the Directory pin it (`pinDirectory`); Talk-replay and onboarding checks updated for room lines and the owner-name field | `e2e/helpers.ts`, `floor`, `living`, `living-voice`, `one-voice`, `smoke`, `screens`, `talk`, `onboarding` specs | A desktop opens the Floor as the Office now; room owner lines (`surface: 'room'`) are not Talk lines; onboarding has a second text field. |

### 10.3 Where the build differs from §4

- **Life starts after 1 s** without the roster (§4.5.2 said 1.5 s), to keep life running within the 1.2 s budget;
  it replans when the roster arrives. The veil lifts at the first count of the floor (at the latest 1.6 s).
- **Insets:** two adjacent edges reserve their corner and a lone edge a strip; the app passes `{right: 88, bottom:
  88}` (phones 72): only the zoom buttons rise above the Chief bubble.
- **`LivingRuntime.profileOf(agentId)`** is added beyond §4.5.13 (the small-talk provider's fallback without the
  roster). The dev hook is `window.__headcount.office = {scene, life, view(), stage(), huddles, ready()}`.
- **The office chunk** bundles C's room modules and the huddle engine glue (static imports from `OfficeView`).
- **Viewer op:** `surface: 'room'` while the stage is open; the visible agent ids are not sent (side-talk is not
  emitted before Inc 1).
- **Settings:** the office follows the OS reduced-motion setting live; the app has no still-portrait or Text Floor
  setting yet.
- **Screens** live in `docs/dev/screens/office-app/` (the task's name), not `office-phase2/`.

### 10.4 Tests

- **Unit:** `pnpm test` 118 files, 1324 tests, green (Office Phase 2's own: 22 files, 165 tests across
  `apps/web/src/office`, `room`, `living/office.test.ts`, `apps/worker/src/rooms`, `expr/huddle-render.test.ts`,
  `packages/protocol/src/ext/rooms.test.ts`; plus the office package's life and scene tests). Two known timing
  tests flake under full-suite load and pass alone (`packages/office` "draws the keyless skyline quickly" < 50 ms,
  `packages/expressions` "matches the validator reference implementation" 5 s timeout).
- **E2E:** new `e2e/office.spec.ts` (9 tests: the default view, the toggle, `?view=`, the skip link and that
  Directory users load no office code; the first-run hint; keys at load; passing by with the look-up and the anchored
  bubble; a quick chat in place with the reply guard live ("went up nine points" becomes the figure line) and Talk
  untouched; a thinking claim dims the monitor; the roundtable: two invited, two captions in server order with one
  speaker lit, the canned figure never repeated, a new message cancels the running turn (`room.turn cancelled,
  reason owner`), Esc leaves, one note in Talk and no room lines in Talk or the side-threads; drag onto the Garden
  room → "waiting for you"; reduced motion; 375 px), `e2e/office-life.spec.ts` (6 tests at `?at=10:35`: opening at
  L1 with a huddle talking within 5 s and an honest pill; the huddle card, L, Join greeting the owner by name, ≤ 2
  replies, Esc → note; clicking a walker stops them, F follows while they walk on, Follow in a bubble; a real job
  brings the Chief to the desk with the monitor on; reduced motion fades; Pause), `e2e/office-voice.spec.ts`
  (project living-voice, 2 tests: room lines voiced in order with the speaker lit and no NOT VOICED tag, holding
  Space stops the room — measured **11 ms** — and sends to the room, not the Chief; one voice per workspace: a
  second tab plays no room line and no listen-in, Listen voices small talk once each on the ambient bus).
  Existing specs that test the Directory pin it (`pinDirectory`). **`pnpm e2e`: 73 passed, 4 skipped** (the opt-in
  screen specs) in 8.4 min on the final tree (earlier full runs: one test-side assertion each, fixed; two
  `one-voice` flakes once, see §10.7). `office-screens.spec.ts` (opt-in) writes the screens: 3 passed.

### 10.5 Budgets (measured)

Measured on the integrator's stack: a production build (`vite build`, served by `vite preview` through the Mock +
mock-media worker), Chromium at 1440×900 on the integrator's Mac, the Floor opened from Talk with the chunk warm,
Ambience Buzzing, owner name set.

| Item | Budget | Measured | |
|---|---|---|---|
| Directory users | load nothing of the office | no office chunk, art, manifest or `/api/office/people` request (e2e `office.spec.ts`) | met |
| Office chunk | ≤ 70 kB gzip | **116.9 kB** gzip (`OfficeView-*.js`, 344 kB min), + 1.4 kB CSS. esbuild split of `@headcount/office` alone: scene, stage, art, plan and styles **83 kB**, life 28 kB; the rest is host code and the room modules (~12 kB) | **missed** (§10.7) |
| Opening | first paint ≤ 300 ms after the chunk loads; life running ≤ 1.2 s | scene in the DOM 0.45 s after the click on Floor (route change included); the veil lifts with life placed and the first small talk bubble **1.28 s** after the click (4× CPU: 1.07 s and 2.83 s) | first paint met from the chunk; life ~0.1 s over, counted from the click |
| Long tasks while opening | host wiring adds none > 50 ms at 1× | two at 1×, 114–138 ms, both inside `@headcount/office` under the veil: `createOfficeScene` (~80 ms, the plate and 165 seats) and placing the opening plus the director's first tick; the life planner itself runs in slices (every step < 10 ms, 187 ms in total over ~350 idle slices). The host's own wiring adds none | host met; the package's two are §10.7 |
| Pan and zoom | p95 ≤ 16.7 ms with 96 faces, Buzzing, bubbles | pan at L1: p50 16.7 ms, **p95 16.8 ms** over 150 frames, 96 faces mounted, 2 small-talk bubbles | met (vsync) |
| Idle | zero office rAF with nothing moving; FaceView's scheduler only | life paused, walks ended: every animation frame in 2 s is FaceView's scheduler (`packages/avatar/src/scheduler.ts`, 60/s for its ≤ 3 animated tiles); the office requests none | met |
| Faces | ≤ 96 mounted, ≤ 3 animated + hero, stored landmarks only | 96 mounted at L1 (pan probe); the factory passes `detectLandmarks: false` | met |
| Rooms latency | 202 ≤ 150 ms; first sentence ≤ 1.8 s; voiced audio ≤ 2.5 s; barge-in ≤ 300 ms | Mock: 202 in 118 ms cold, 5 ms warm; barge-in (hold Space while a room line sounds, Mock TTS) **11 ms** from the key press to the room's audio stopping (e2e `office-voice.spec.ts`). Keyed first-sentence and first-audio times not measured (no keyed run in this round) | 202 and barge-in met |
| Rooms cost | ≤ 3 + 1 responders, ≤ 160 tokens, ≤ 12 replies a minute | enforced server-side (`ROOM_LIMITS`, `ROOM_REPLY_MAX_TOKENS`, `ROOM_TURNS_PER_MIN`; worker tests) | met |
| Accessibility | ordinary controls; axe on the Office and the stage | no interactive element without an accessible name in desk mode or on the stage (a DOM probe); the skip link, the toggle's radio group and the dock are keyboard-reachable (e2e). axe-core is not in the workspace and was not run | partly |

### 10.6 Screens (`screens/office-app/`, 2×, the Mock + mock-media stack, owner "Sam")

`office-night-l1` (the opening at 23:10: five at the north glass, one huddle), `office-night-wide` (the whole floor
under the city), `office-desk-huddle` (the coffee round at 10:35, a bubble), `office-huddle-card`,
`office-huddle-joined` ("Hello, Sam. I'm Joon. It's good to meet you."), `office-hover-bubble`, `office-quick-chat`,
`office-follow` ("Following Tulga"), `office-whats-happening`, `office-stage-seated` (three at the table),
`office-stage-speaking` (voiced, the speaker lifted and lit, the floor queue), `office-stage-not-voiced` (voice off:
NOT VOICED), `office-stage-transcript`, `talk-room-note`, `directory-toggle`, `office-mobile-375`,
`directory-mobile-375`. Regenerate: `HEADCOUNT_SCREENS=1 pnpm e2e e2e/office-screens.spec.ts`.

### 10.7 Known gaps

- **The office chunk is 116.9 kB gzip against a 70 kB budget.** The budget was set before Phase 1's size was
  measured: the scene package alone (plate, art, styles, stage) is 83 kB. Splitting life into its own chunk would not
  make the opening feel faster (the veil waits for life's placement); moving the room modules (session, player,
  stage binding, dock) behind the first room entry or Join would save about 12 kB. Directory users load none of it.
  Recommendation: set the budget to 120 kB and split the room modules when the chunk next grows.
- **Two opening long tasks (114–138 ms at 1×)** are inside `@headcount/office` under the veil (scene creation, the
  opening placement and first director tick). A later pass could build the plate SVG in two frames and place the
  opening in slices.
- **No keyed run** in this round (the rules keep the integrator off `.dev.vars`): the rooms' keyed latency (first
  sentence ≤ 1.8 s, first audio ≤ 2.5 s), real-model reply-guard hit rates and the prompts' tone are unmeasured. Mock
  replies quote the owner's words, so the Mock room transcript reads oddly ("You said: …").
- **Voiced room fillers** are not built (§0.1): a thinking responder shows the face cue only.
- **Grounded small talk is thin:** only the Chief's finished jobs ("write-up") ground huddle lines until Inc 1 events
  exist; recency is per browser.
- **In a huddle with no relevance match, one person answers** (the floor rule's all-zero case): the other member
  stays quiet unless named or asked as a group ("you two", "everyone").
- **Resting on a walker** rarely shows the availability line: the dwell needs the pointer still over them and they
  walk out from under it; clicking a walker stops them at once (claim 1), and F follows.
- **A followed person's bubble still offers Follow**, and the quick-chat bubble has no name header (the placeholder
  says "Reply to Akeem"); both are FloorBubble polish.
- **Catalog passing-by lines** such as "Everything filed, everything labelled." and "A green test run deserves one
  drum roll. Exactly one." read close to work status for coworkers on no project; they come from the expression
  catalog (not changed here) and are worth a content review against D5.
- **e2e flakes seen once:** in the first full run, two `one-voice.spec.ts` tests failed after the new specs (an
  acknowledgement clip not played within 5 s, a `quiet()` wait); they passed alone, with `office-voice` before them,
  and in the next full runs. The two known timing unit tests (§10.4) flake under full-suite load.
- **Night Shift lamps, raised hands and real visits** stay dark until something produces them (Inc 1).
