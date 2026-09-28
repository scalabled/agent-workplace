# personagram-ai — Worker backend: creator/avatar domain, CreatorDO & ConversationDO, experiences, groups, doppelganger, canvas files, providers, security, billing, D1 schema

> Slice reviewed: `personagram-ai/src/worker/**`, `personagram-ai/src/shared/**`, `personagram-ai/migrations/*.sql`,
> `README.md`, `IMPLEMENTATION_STATUS.md`, `PROVENANCE.md`, `wrangler.toml`, `.env.example` (names only), and the unit /
> integration tests listed in scope. A few browser files (`src/web/voice/transports.ts`, `src/web/groups.ts` header) were
> skimmed only to confirm the wire protocol the worker speaks. All paths below are relative to `reference/`.
> No secret values are reproduced. (`wrangler.toml` commits a concrete D1 id and a "public by design" demo link token;
> neither is quoted here.)

---

## 1. Purpose & architecture

**What the product is.** Personagram AI is a single Cloudflare Worker app (`personagram-ai/wrangler.toml`, `main = "src/worker/index.ts"`) where a *creator* signs in with Google, builds **one public "AI Avatar"** of themselves (persona fields + approved portrait + built-in voice + approved knowledge cards), and publishes **purpose-specific unlisted links ("Personagrams")** that anyone can open to have a live voice/text conversation with that avatar, lip-synced on the creator's portrait. Guests may opt in to share a transcript, which lands in the creator's inbox with an LLM summary.

Since the Sept‑15 checkpoint documented in `IMPLEMENTATION_STATUS.md`, four large features were added in code (migrations 0003–0007, dated Sept 24–25) that the README and status doc **do not mention at all**:

1. **Private AI Avatars** ("doppelgangers" in code, `src/worker/doppelganger.ts`): up to 40 per creator, each with its own name, portrait, voice, line-based instructions, private files, and long-term memories, trained *by talking to it* via tool calls; each shareable via its own `/a/:token` link.
2. **Group conversations / "conversation studio"** (`src/worker/groups.ts`): 2–6 avatars (optionally with the creator in the room) discuss a topic or reference document in a chosen style/length/energy; a "director" LLM writes the script in chunks, each line is voiced separately in the speaker's voice and stored, and the conversation is shareable as a replay (`/g/:token`).
3. **Canvas "experiences"** (`src/worker/experiences.ts`, `src/worker/builder.ts`): a private avatar can call `create_experience` mid-conversation; a dedicated `BuilderDO` streams a 1,000+ line single-file HTML/JS/WebGL page from an LLM, with a quick "first version" playable in ~20 s, served in a strict sandbox, with a browser-error → auto-repair loop.
4. **Canvas files** (`src/worker/canvas-files.ts`): documents/images attached to an avatar for its builds; docs become brief text, images get inlined into the built pages as `window.PG_ASSETS`.

**Runtime pieces.**

| Piece | File | Role |
|---|---|---|
| Worker router | `src/worker/index.ts` (1,226 lines) | Hand-rolled regex router, auth, CSRF origin checks, rate limits, security headers, SSR meta injection, cron cleanup. |
| `CreatorDO` | `src/worker/creator.ts` | One per creator (`idFromName(ownerId)`). Serializes quota-sensitive and billing mutations through an in-memory promise queue; holds raw share tokens; runs durable document extraction via alarms; Stripe checkout/webhook reconciliation. |
| `ConversationDO` | `src/worker/conversation.ts` (1,189 lines) | One per live session (`idFromName(sessionId)`). Owns the browser WebSocket, provider sockets (xAI STT, xAI realtime/TTS, OpenAI Live sideband), tool dispatch, turn assembly, persistence policy, caps, and session expiry. |
| `BuilderDO` | `src/worker/builder.ts` | One per experience build (`idFromName(experienceId)`). Runs the build from an alarm so it survives the page disconnecting; exposes `/progress`. |
| D1 (`DB`) | `migrations/0001..0007` | Users, sessions, avatars, assets, knowledge, links, guest sessions/turns, subscriptions, rate limits, doppelgangers, memories, groups, lines, experiences, canvas files. |
| R2 (`BUCKET`) | private bucket | Portraits (`avatars/{owner}/{id}`), source docs (`sources/{owner}/{id}`), group line audio (`groups/{owner}/{group}/{line}`), experience HTML (`experiences/{owner}/{id}.html` + `.preview.html`), canvas files (`canvas-files/{owner}/{id}.{ext}`). |
| Static assets | `ASSETS` binding, `dist/` | SPA shell; worker runs first (`run_worker_first = true`) so it can inject per-link OG meta. |
| Cron | `[triggers] crons = ["0 3 * * *"]` | `scheduled()` purges expired auth/oauth/rate-limit/active-session rows and 90‑day-old guest sessions + usage events. |

**Main flow (guest conversation, xAI path):**

```mermaid
sequenceDiagram
  participant B as Browser (guest /p/:token)
  participant W as Worker index.ts
  participant D as D1
  participant C as ConversationDO(sessionId)
  participant S as xAI STT (WS)
  participant R as xAI realtime (WS, per turn)
  B->>W: POST /api/public/personagrams/:token {consent?,name?,email?}
  W->>D: publicLink(hash(token)) + rateLimit(guest:ip, guest-owner)
  W->>W: personaPrompt(persona, link, approved+selected knowledge)
  W->>D: INSERT active_sessions (+ guest_sessions if consent)
  W->>C: POST /init SessionConfig{token_hash of capability, expires, prompt,...}
  W-->>B: 201 {id, provider, expires} + Set-Cookie pg_voice=<capability>; Path=/api/sessions/:id
  B->>W: GET /api/sessions/:id/ws (Origin checked) -> C /ws (X-Session-Capability)
  C-->>B: {type:"ready"}
  B->>C: {type:"start"}  -> C opens S (/stt?sample_rate=24000&encoding=pcm&...)
  S-->>C: transcript.created -> C-->>B {type:"mic_ready"}
  B->>C: binary PCM16 @24kHz, 100 ms frames (audio budget enforced)
  S-->>C: transcript.partial{text, speech_final}
  C-->>B: {type:"transcript", role:"user", text, final}
  C->>R: (on speech_final) connect /realtime?model=grok-voice-think-fast-2.0; session.update{instructions=turnBrief, tools?}
  R-->>C: session.updated -> C sends conversation.item.create(user text) + response.create
  R-->>C: response.output_audio.delta / ..._transcript.delta / function_call_arguments.done / response.done
  C-->>B: {type:"audio", audio(base64 PCM), generation} + {type:"transcript", delta, stream_mode:"tokens"}
  C-->>B: {type:"transcript", final:true} + {type:"audio_done"}
  Note over B: lip sync = transcript text progression + spectral analyser on played PCM
```

ASCII view of the ownership / control structure:

```
                 ┌──────────── Worker (index.ts) ─────────────┐
 Google OAuth ──►│ authRoute, user(), sameOrigin, rateLimit   │──► D1 (all tables)
 Stripe webhook─►│ verifyStripeSignature ─► CreatorDO         │──► R2 (private)
                 │ creator(env, owner, "/publish"|...)        │
                 └──────┬──────────────┬───────────────┬──────┘
                        │              │               │
             CreatorDO(owner)   ConversationDO(sid)   BuilderDO(expId)
             - promise queue    - client WS           - alarm job (≤2 attempts)
             - raw link tokens  - xAI STT/realtime/TTS- streams builder LLM
             - extract alarms   - OpenAI Live sideband- progress polled
             - Stripe checkout  - tools gated by type
             - billing reconcile- memory distill on end
```

---

## 2. Feature inventory

### 2.1 Google OAuth sign-in with state + PKCE, hashed sessions
- **What**: sign-in only via Google; account row keyed by `google_sub`.
- **How**: `authRoute()` in `src/worker/security.ts:159-278`. `GET /api/auth/google` creates `state = token()` and `verifier = token(48)`, stores `hash(state) → verifier` in `oauth_states` (10 min), sets `pg_oauth` cookie, redirects to `https://accounts.google.com/o/oauth2/v2/auth` with `scope=openid email profile`, `code_challenge_method=S256`, `prompt=select_account`. Callback compares query `state` to the cookie, atomically consumes the state row (`DELETE … RETURNING verifier`), exchanges at `https://oauth2.googleapis.com/token` (15 s timeout), reads `https://openidconnect.googleapis.com/v1/userinfo`, requires `email_verified`, upserts `users`, issues `pg_session` (32 random bytes, base64url) stored as SHA‑256 hash in `auth_sessions` with 30‑day expiry, redirects to `/studio` if a published avatar exists else `/onboarding`. Logout is POST + `sameOrigin`.
- **Cookies**: `setCookie()` (`security.ts:39`) = `HttpOnly; SameSite=Lax; Max-Age; Secure` only when `APP_ORIGIN` is https.
- **Maturity**: solid.

### 2.2 Request hardening layer (origin checks, bounded bodies, error redaction, headers)
- `sameOrigin()` (`security.ts:48`) — exact match of `Origin` against `APP_ORIGIN`; applied to every non-GET/HEAD API call after auth routes (`index.ts:323`) and explicitly to the session WebSocket upgrade (`index.ts:470`).
- `boundedBytes()/boundedText()/boundedForm()/body()` (`security.ts:52-108`) — streaming readers that abort at a byte cap (413), JSON-object-only bodies (400). Each route chooses a cap (e.g. 8.1 MB for images, 10.5 MB for sources, 4.3 MB for group docs, 32 KB for avatar settings).
- `redactError()` — only `HttpError` messages reach clients; everything else becomes "Something went wrong."
- Global response wrapper (`index.ts:1157-1203`): drains an unread request body (≤12 MB) before replying so early refusals are not seen as opaque 500s (a real bug they fixed); sets `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy: camera=(self), microphone=(self), geolocation=()`, `X-Robots-Tag: noindex…` on `/p/ /a/ /g/ /studio /onboarding /settings /api/`, and a site CSP (`default-src 'self'; script-src 'self' blob: https://cdn.jsdelivr.net 'wasm-unsafe-eval'; … connect-src 'self' https://cdn.jsdelivr.net https://storage.googleapis.com; frame-ancestors 'none'…`) unless the route set its own (experiences do).
- **Maturity**: solid.

### 2.3 D1-backed rate limiting with refunds
- `rateLimit(env, key, limit, windowMs)` (`security.ts:131-147`) is a single `INSERT … ON CONFLICT DO UPDATE … RETURNING count` upsert; the count saturates at `limit+1` so refused attempts do not accumulate ("a refused attempt uses nothing up"). `refund()` (`security.ts:149`) decrements when the paid-for thing failed (image generation, portrait painting).
- Keys seen in `index.ts`: `owner:{id}` 180/min; `guest:{link}:{ip}` 12/h; `guest-owner:{owner}` 60/day free, 500/day pro; `avatar-guest:{avatar}:{ip}` 12/h; `interview:{owner}` 40 voice/80 text per day; `doppelganger:{owner}` 80/day; `builds:{owner}` 40 free/200 pro per day; `groups` 60, `cast` 20, `group-turns` 400, `group-voice` 3000, `group-docs` 60, `bulk` 30, `transcribe` 60, `preview` 50, `images` 10 free/50 pro, `sources` 30, `canvas-files` 60 per day.
- Test: `tests/integration.test.ts:1875` "a refused image attempt uses nothing up, and neither does a generation that fails".
- **Maturity**: solid (plan-aware, cheap). No per-token/$ budget exists.

### 2.4 Creator's public AI Avatar (draft → approved persona)
- **Domain**: `PersonaProfile` (`src/shared/domain.ts:5-15`) = `name, headline, identity, personality, expertise, stories, preferences, boundaries, handoff`. `AIAvatar` has `persona` (approved/public), `draft_persona`, `asset_id` (approved image), `draft_asset_id`, `provider: "xai"|"openai"`, `voice`, `status: draft|published`, `version`, `step` (onboarding 0–5). One row per owner (`avatars.owner_id UNIQUE`).
- **How**: `PUT /api/avatar` → `CreatorDO /avatar` (`creator.ts:42-103`). Draft edits never touch `persona` unless `approve === true`, which requires a name, an image, and `likeness_consent === true`; approval copies draft → public and marks the image approved. Voice changes go through `validateVoice()` against the live catalog. `personaOf()` (`domain.ts:99`) whitelists fields and truncates (name 100, others 4,000).
- Migration `0002_avatar_review.sql` added `draft_asset_id` "Keep a new look private until the creator explicitly approves the update"; test `integration.test.ts:787` "swapping the draft image leaves already-published links serving the approved portrait".
- **Maturity**: solid.

### 2.5 Creator interview (text JSON interviewer, realtime spoken interviewer, bulk fill)
Three ways to fill `draft_persona`:
1. **Text interview** — `POST /api/interview` → `CreatorDO /interview` → `interview()` (`content.ts:322-369`). Persists `interview_messages`, asks xAI (`grok-4.6` default text model) to return `{question, profile}` JSON, merges profile into draft.
2. **Spoken interview** — `POST /api/interview/session` (`index.ts:549-567`) starts a normal `ConversationDO` session with `interview: true`. Each turn's brief is rebuilt from the *current* draft (`turnBrief()`, `conversation.ts:508-522`) and offers the `save_persona_facts` tool (`SAVE_FACTS_TOOL`, `content.ts:216-236`, fields = persona keys, `additionalProperties:false`). `saveFacts()` (`conversation.ts:387-406`) → `applyPersonaFacts()` (`content.ts:246-271`) merges only changed, allowed string fields and pushes `{type:"persona", profile, learned}` to the page. Comment in code: realtime path measured ~1.2 s to first audio vs ~18 s through the reasoning model.
3. **Bulk fill** — `POST /api/interview/bulk` → `bulkFillPersona()` (`content.ts:278-320`): pasted text (≤24k) + up to 40 extracted knowledge cards (≤40k chars) → one JSON extraction pass, merged via the same `applyPersonaFacts()`.
- Guard: `saveFacts` returns `{saved:false}` unless `config.interview` — test `integration.test.ts:1087` forces the provider stub to emit an unoffered tool call during a guest chat and asserts the persona is untouched.
- **Maturity**: solid.

### 2.6 Portrait images: upload, generate, edit, approve, landmarks
- `POST /api/assets` → `saveImage()` (`content.ts:45-138`). Modes: `upload` (data URL), `generate`, `edit`. Generation calls xAI `POST /images/generations` (model `grok-imagine-image-2.0`, `aspect_ratio:"3:4"`, `response_format:"b64_json"`), edits call `POST /images/edits` with the original as a data URL in `image.url`. Prompts are prefixed with portrait constraints ("A single adult, front-facing portrait, unobstructed face, relaxed closed lips…"; edits add "Preserve this adult person's exact identity…"). A URL response is fetched with `redirect:"error"`, https-only, 5 MB bound.
- `decodeImage()` (`content.ts:19-38`) accepts only PNG/JPEG/WebP data URLs ≤5 MB and validates magic bytes. Stored to R2 with `generation_metadata` `{model, operation, source_asset_id, created_at}`.
- `PATCH /api/assets/:id` (`index.ts:968-985`) sets `landmarks` (via `normalizeLandmarks()`, `src/shared/landmarks.ts`) and `approved` (requires `likeness_consent`). Landmarks are computed **in the browser** (MediaPipe, per `PROVENANCE.md`) and only normalized geometry (0..1 points: face box, eyes, nose, mouth corners, chin, lip/jaw/eyelid/brow contours of 3–30 points) is accepted, capped at 100 KB.
- Public serving (`/api/public/assets/:id`, `index.ts:484-506`) only if the image is approved **and** used by some active link of a published avatar; cached 600 s for unfurlers.
- **Maturity**: solid.

### 2.7 Knowledge sources → unapproved cards → explicit approval → per-link selection
- `POST /api/sources` (`index.ts:987-1025`): PDF/DOCX/TXT/MD/JSON/CSV ≤10 MB, stored raw to R2 as `application/octet-stream`, `sources` row `status=processing`, optional `doppelganger_id` scope, then `CreatorDO /extract-source` enqueues `extract:{sourceId}` in DO storage and sets an alarm (+1 s).
- `CreatorDO.alarm()` (`creator.ts:489-529`) processes up to 5 jobs per alarm, re-arms while jobs remain; `extractSource()` (`content.ts:162-194`) uses `unpdf` (≤100 pages) / `mammoth` / TextDecoder, slices to 120k chars, chunks at 3,500 chars, inserts cards with deterministic ids `${sourceId}-${i}` (`ON CONFLICT DO NOTHING` → idempotent re-runs), inherits the source's avatar scope, marks `ready` or `failed` with a user-facing reason.
- Cards are `approved=0` by default; `PATCH /api/knowledge/:id` edits title/content/approved and bumps `version`. `POST /api/knowledge` creates a manual card.
- Publishing a link validates that every selected id is an **approved** card of the owner and the selection totals ≤24,000 chars (`creator.ts:148-166`). `personaPrompt()` (`domain.ts:168-187`) only injects cards that are approved AND selected.
- Tests: `tests/extraction.test.ts` (PDF/DOCX/plain-text, idempotent re-run, fail-closed, bounded chunks), `integration.test.ts:832`.
- **Maturity**: solid; retrieval is "stuff the selected cards into the prompt" — no embeddings/vector search.

### 2.8 Personagram links (publish, quota, recover, revoke)
- **Data**: `Personagram` (`domain.ts:48-62`): `title, purpose, audience, outcome, greeting, overlay, knowledge_ids[], asset_id (per-link portrait override), ask_consent, status active|revoked, token_hash`.
- **Publish** (`creator.ts:127-202`): requires approved persona + approved default image; counts active links, checks `canPublish(plan, n)` against `PLAN_LIMITS = {free:3, pro:25}` (`domain.ts:3`); validates knowledge and custom image; mints `raw = token()` (256‑bit base64url), stores **only `hash(raw)` in D1**, stores the raw token in CreatorDO storage `link:{id}` so the owner can recover the URL later via `/links`; sets avatar `status=published`.
- **Quota serialization**: `CreatorDO.fetch` chains every operation on `this.queue` (`creator.ts:16-37`) so concurrent publishes cannot race the count. Test `integration.test.ts:488` fires 4 concurrent Free publishes (3×201, 1×409) and 26 Pro (25×201, 1×409).
- **Revoke** (`creator.ts:279-306`): sets `revoked`, looks up `active_sessions` for the link, POSTs `/revoke` to each `ConversationDO` (ending them live), deletes the stored raw token.
- **Downgrade**: existing links are kept; new publishes blocked while over limit (documented in README; code simply counts).
- **Maturity**: solid.

### 2.9 Guest session start, consent gating, capability cookie
- `POST /api/public/personagrams/:token` (`index.ts:326-363`): token format check `[\w-]{40,100}`, `publicLink()` (`repo.ts:69-89`) requires active link + published avatar + approved image; IP and owner-level rate limits; `validateConsent()` (`domain.ts:129-140`) can only record consent if the link allows it (`ask_consent`) and validates email; builds the system prompt server-side.
- `startSession()` (`index.ts:106-178`): session id (UUID) + separate **capability** (`token()`), stores only `hash(capability)` in the DO config, sets `pg_voice` cookie scoped to `Path=/api/sessions/{sid}` with Max-Age = session length. Durations: voice preview 20 s; owner's own private avatar 1,800 s; everything else `clamp(SESSION_CAP_SECONDS, 60, 900)` default 600. Inserts `active_sessions` (routing only — no transcript), and `guest_sessions` only when consented. If `/init` fails (e.g. link revoked in between → 410) it rolls back both rows.
- Session proxy (`index.ts:468-483`): `/api/sessions/:id/(ws|sdp|end)` forwards to the DO with `X-Session-Capability` from the cookie.
- **Maturity**: solid.

### 2.10 ConversationDO — the live session engine
**Config** `SessionConfig` (`conversation.ts:34-58`): `id, token_hash, owner, personagram_id|null, provider, voice, prompt, greeting, consent, expires, preview?, interview?, doppelganger?, avatar_guest?`. Session *type* is derived from these flags: guest-of-link, voice preview, creator interview, owner↔private-avatar, guest-of-private-avatar.

**Lifecycle / endpoints** (`fetch`, `conversation.ts:108-244`): buffers the body first (deterministic refusals); `/init` (409 if already initialized; 410 if link revoked; stores config; alarm at `expires`), `/revoke`, `/erase` (both call `end()`), capability check (`hash(X-Session-Capability) === token_hash` else 403), `/ws` (accepts WebSocketPair, sets `binaryType="arraybuffer"`, replaces any previous client socket on reconnect, stops providers, sends `{type:"ready", provider, expires}`), `/sdp` (OpenAI only, validates `v=0` offer, one concurrent start), `/end`.

**Browser → DO protocol** (`message()`, `conversation.ts:255-340`):
| Frame | Meaning |
|---|---|
| binary ArrayBuffer ≤24,000 B | PCM16 mono 24 kHz mic audio (client batches 2,400 samples = 100 ms, `src/web/voice/transports.ts:181-205`). Token-bucket audio budget: 96,000 B burst, refills 48 B/ms (= exactly real-time 24 kHz×16‑bit) — exceeding it ends the session. Relayed to xAI STT unless muted. |
| `{type:"start"}` | xAI: open streaming STT. |
| `{type:"text", text}` | Typed turn (≤4,000 chars); cancels any in-flight answer. |
| `{type:"interrupt"}` | Barge-in (client detects mic level > 0.055 for 45 frames while playing). |
| `{type:"mute", muted}` | xAI: echoed; OpenAI: `session.input_audio.mute/unmute` to sideband. |
| `{type:"stop_voice"}` | Stop provider sockets, stay in text. |
| `{type:"end"}` | End the session. |
Text frames >20,000 chars are dropped; >1,500 messages or >60 answers (200 for owner avatar) end the session.

**DO → browser events**: `ready`, `mic_ready`, `mic_lost`, `transcript {role, text|delta, final?, stream_mode:"tokens"?, start_ms?, end_ms?}`, `thinking`, `audio {audio: base64 PCM16 24 kHz, alignment?, generation}`, `audio_done`, `response_done`, `interrupted {generation}`, `speech_started`, `mute {muted}`, `persona {profile, learned}`, `memory {added}`, `instructions {instructions, added, removed}`, `experience {experience}`, `error {message}`, `ended {message}`.

**Generation counter / interruption**: `cancel()` (`conversation.ts:602-623`) bumps `generation`, aborts the text stream, sends `text.clear`+`response.cancel` and closes the output socket, appends a "guest is interrupting" instruction to a Live session, and emits `interrupted`. Every provider callback checks `generation !== this.generation` before forwarding, and the client drops audio from older generations — a clean, reusable barge-in model.

**Persistence policy** (`record()`, `conversation.ts:341-369`): history is memory-only (24 turns, 40 for private avatars); only the owner↔private-avatar conversation persists history to DO storage (so memory distillation survives eviction); only consented guest sessions write `guest_turns` (upsert by turn id). `end()` (`conversation.ts:1101-1173`) force-closes turns, stops providers, writes a deterministic "Guest interests: …" summary then replaces it asynchronously (`waitUntil`) with a 3-sentence xAI summary (prompt explicitly treats transcript as data); for owner private-avatar sessions runs `distill()` into memories; deletes `active_sessions` row and `storage.deleteAll()`. Closing the owner's tab schedules wrap-up 120 s later unless the page reconnects.

**Maturity**: solid for the xAI path (integration-tested with stubbed STT/realtime/TTS); OpenAI Live path is implemented but its full WebRTC negotiation is not covered by mocks (per `IMPLEMENTATION_STATUS.md` §"Required verification").

### 2.11 xAI voice pipeline (STT + per-turn realtime socket)
- **STT**: persistent WebSocket `connectProvider(env,"xai","/stt?sample_rate=24000&encoding=pcm&interim_results=true&endpointing=450&smart_turn=0.7&smart_turn_timeout=1800")` (`conversation.ts:549-601`). Events consumed: `transcript.created` (→ `mic_ready`), `transcript.partial {text, speech_final}` (relayed as user transcript; any new text cancels an in-flight answer = barge-in; `speech_final` dispatches `answer()`), `error`.
- **Answer (spoken)**: `realtimeTurn()` (`conversation.ts:793-938`) opens a **fresh** realtime socket per turn: `WS /realtime?model=grok-voice-think-fast-2.0`, sends `session.update {voice, instructions, turn_detection:null, tools?, tool_choice:"auto", audio:{input/output: {type:"audio/pcm", rate:24000}}}`; on `session.updated` injects `conversation.item.create {type:"message", role:"user", content:[{type:"input_text", text}]}` and `response.create {modalities:["text","audio"]}`. Forwards `response.output_audio.delta|response.audio.delta` as `audio` and `response.output_audio_transcript.delta|response.audio_transcript.delta` as token transcript. Because every turn is a new socket, `turnBrief()` embeds "THE CONVERSATION SO FAR" (≤6,000 chars) in the instructions (`conversationSoFar()`, `providers.ts:469-481`).
- **Realtime tool calls**: on `response.function_call_arguments.done` the handler (only if the session type allows that tool) is run; calls are collected, and on the carrying `response.done` all `function_call_output` items are sent followed by **one** `response.create` (test asserts "two tool calls, ONE follow-up response", `integration.test.ts:1222`). 15 s timer finalizes the turn if the follow-up never arrives.
- **Answer (typed / non-voice)**: `generateText()` or `chatWithTools()` streaming over `/chat/completions` with `MODELS.xai.chat` (`grok-4.20-0309-non-reasoning`), tokens relayed as transcript deltas.
- **Timestamped TTS**: `tts()` (`conversation.ts:749-788`) implements `WS /tts?language=en&voice=…&codec=pcm&sample_rate=24000&with_timestamps=true` with `text.delta/text.done/text.clear/response.cancel` and `audio.delta {delta, audio_timestamps{graph_chars, graph_times}}` → `timestampAlignment()` (`providers.ts:436-463`) → `{characters, character_start_times_seconds, character_end_times_seconds}` sent as `alignment` for exact viseme timing. **However**, the only call site (`conversation.ts:661-667`) is guarded by the same condition that already returned into `realtimeTurn()` at line 652 — so in the current code this path is unreachable. The README's description ("substantive turns use Grok text streamed through timestamped TTS"; `isCasual()` routing) is stale: `isCasual()` (`domain.ts:163`) is exported and tested but never called.
- **Maturity**: STT + realtime: solid; timestamped-TTS streaming: implemented but dead code.

### 2.12 OpenAI Live (`gpt-live-1`) WebRTC with server sideband and "delegation"
- **Session creation** (`startLive()`, `conversation.ts:939-1002`): browser POSTs its SDP offer to `/api/sessions/:id/sdp`; DO calls `POST {OPENAI_BASE}/live/sessions` with `liveSession()` (`providers.ts:386-415`):
  ```
  { session: { model:"gpt-live-1", instructions, delegation:{type:"client"}, store:false,
               audio:{output:{voice}}, client:{data_channel:{allowed_client_events:[], allowed_server_events:[]}},
               input: last 12 turns as message items (input_text / output_text) },
    transport: { type:"webrtc", sdp } }
  ```
  → returns `{session.id, transport.sdp}`; the answer SDP goes back to the browser. The browser's data channel is **empty-allowlisted** — it cannot inject or receive events; all control flows via the authenticated same-origin WebSocket.
- **Sideband**: `WS /live/sessions/{id}/attach`. Consumed: `session.input_transcript.delta`/`session.output_transcript.delta` (`delta, start_ms, end_ms`) reduced by `safeVoiceEvent()` (`providers.ts:416-435`, everything else dropped — test lists `error`, `session.created` with `client_secret`, `rate_limits.updated`, etc. as never forwarded), `session.input_audio.muted/unmuted`, `session.delegation.created` (when `delegation.target === "client"`), `session.closed`, `error`. Sent: `session.input_audio.mute|unmute`, `session.instructions.append {event_id, delegation_id:null, content}`, `session.commentary.append {delegation_id, event_id, content}`. Hang-up: `POST /live/sessions/{id}/hangup` (5 s timeout) in `stopProviders()`.
- **Delegation = "voice front, brain back"**: when Live delegates a turn to the client, the DO assembles the user utterance (TurnAssembler, below), runs `answer()` with the **xAI** chat model, and streams the answer back into the Live voice via `session.commentary.append` chunks from `SentenceChunker` (≤120 est. tokens, well under Live's 500-token append cap; `src/shared/tokens.ts`). The Live instructions add "delegate to the application… Never invent an answer while waiting." The greeting is spoken by appending it as commentary when history is empty.
- **Maturity**: partial — code complete and payload/redaction unit-tested (`tests/providers.test.ts:267-331`), but no mocked end-to-end negotiation; the OpenAI provider silently depends on `XAI_API_KEY` for every substantive answer.

### 2.13 Turn assembly on the provider's timeline (`TurnAssembler`)
- `src/shared/turns.ts` (358 lines). Builds utterances from transcript fragments using **provider timeline gaps** (`start_ms − prevEnd ≤ 1,500 ms` continues) rather than arrival gaps (fallback 1,200 ms), because Live fragments arrive up to ~0.9 s apart while their timeline is contiguous. Strong signals (`signal(offsetMs)`) dispatch unless the signal is >300 ms past the last transcribed word (then "pending" — the DO waits 350 ms, `conversation.ts:1062-1068`). A dispatched-but-undelivered turn can be **reopened** by a continuation (revision bumped; caller cancels the stale answer), `confirm()` reconciles an authoritative final transcript with edit-distance ≤10% (`sameUtterance`), `markDelivered()` freezes a turn, `typedTurn()` models typed input. Close reasons: `delegation | ack | gap | final | forced`.
- Used by `liveEvent()` (`conversation.ts:1010-1078`): user fragments opening a new turn force-close the assistant turn and emit `speech_started`; a reopened user turn triggers `cancel()`; an idle assistant turn is settled after 1.5 s.
- Tests: `tests/turns.test.ts` (11 cases: spacing assembly, timeline vs arrival gaps, pending signal, confirm vs revise, reopen-only-if-undelivered, interruption, unique ids).
- **Maturity**: solid (library); `confirm()`/`typedTurn()` unused by the worker.

### 2.14 Sentence chunker and caption buffer
- `SentenceChunker` (`src/shared/chunker.ts:94-179`): streams LLM deltas into whole sentences; abbreviation/initial-aware boundary detection; releases the **first clause early** (≥60 chars) to cut time-to-first-audio; splits over-long sentences at clause boundaries, never mid-word; merges short sentences (<24 chars) after the first.
- `CaptionBuffer` (`src/shared/captions.ts`): append-only per-role caption lines, duplicate-final suppression, token-delta mode (no inserted spaces), bounded to 12 lines. Used by `src/web/guest.ts` and `src/web/doppelganger.ts`.
- Tests: `tests/streaming.test.ts`.
- **Maturity**: solid.

### 2.15 Lip-sync data contract (server side)
The worker supplies three tiers of timing data, consumed by the browser viseme driver (`src/web/voice/transports.ts:283-372`):
1. **Exact character timestamps** — `audio.alignment` from xAI TTS timestamps (`timestampAlignment()`); client converts via `alignmentToVisemeSequence()` and offsets by audio scheduling time. Currently only reachable if the dead TTS path is revived.
2. **Transcript spans** — OpenAI Live `start_ms/end_ms` on each transcript delta; client `driver.pushText(delta, {startMs,endMs})` *appends* (replacing restarted the clock → "dubbed movie" bug noted in comments).
3. **Text progression + spectral analysis** — plain token deltas plus an `AnalyserNode` on played PCM (xAI realtime path and group replays).
Face geometry comes from `avatar_assets.landmarks` in every public DTO (`publicPersonagram()`, shared avatar DTO, group replay cast via `withLandmarks()`), so the client can warp the mouth on the still portrait.
- **Maturity**: solid contract; tier 1 effectively unused today.

### 2.16 Voice catalog, validation and previews
- `voices(env, provider)` (`providers.ts:318-347`): OpenAI → a hard-coded list of 22 built-in voices (`OPENAI_VOICES`, `providers.ts:18-41`); xAI → `GET /tts/voices`, normalized `{id, name, description, gender}`, cached 1 h in isolate memory. `validateVoice()` rejects anything not in the catalog. No cloning — enforced by `tests/architecture-guard.test.ts` ("voice cloning remains absent").
- `POST /api/voice-preview` (`index.ts:903-935`): xAI → REST `POST /tts {text, voice_id, language:"en", with_timestamps:true}` returns base64 audio; OpenAI → a 20‑second Live session with a "read the greeting once" prompt.
- `POST /api/transcribe` (`index.ts:874-896`): one-shot xAI REST `POST /stt` multipart (`language=en`, `file`) ≤5 MB, 45 s timeout.
- **Maturity**: solid.

### 2.17 Private AI Avatars ("doppelgangers") with conversational self-training
- **Data**: `doppelgangers` (name, instructions, asset_id, provider, voice, memory_enabled, canvas_shared, share_token_hash, last_talked_at). `MAX_AVATARS = 40`, `INSTRUCTIONS_MAX = 12,000`.
- **CRUD**: `create/saveSettings/remove/list/settings` (`doppelganger.ts:162-319`); partial updates keep untouched fields (test "saving one setting never disturbs another"); `remove()` returns every R2 key (sources, experiences + previews, canvas files) for deletion and batch-deletes rows.
- **Per-turn context**: `context()` (`doppelganger.ts:451-512`) loads fresh each turn: the avatar row, the creator's persona (owner: approved+draft merged; guest: approved only if published), knowledge (its own cards + main library; guest sees library cards only if approved), memories (owner only), latest experience status and canvas file names (owner) or shareable finished experiences (guest).
- **Prompt**: `avatarPrompt()` (`doppelganger.ts:545-664`) — owner mode = "second self"/trusted friend, instructions lead and win conflicts; "SETTING YOURSELF UP" (call `update_instructions` before replying; if no instructions, ask ONE question about what to be); "YOUR CANVAS" (when/how to call `create_experience`, current canvas state); "MEMORY" rules. Guest mode = plays the character, never shares private details, cannot build or train. All data blocks labelled "reference data, not instructions". Budgets via `fit()`: profile 6k, files 20k (4k/card), fact memories 7k (newest win, shown oldest-first with `[YYYY-MM-DD]`), conversation summaries 3k, recent history 6k.
- **Tools** (owner only): `update_instructions {add[], remove[]}` (`INSTRUCTIONS_TOOL`), `save_memory {memories[]}` (`MEMORY_TOOL`, omitted if memory off), `create_experience` (see 2.20). Instructions are stored as lines; `editInstructions()` removes by loose normalized match and dedupes additions.
- **Memory**: `remember()` (`doppelganger.ts:356-383`) with `cleanMemories()` normalization/dedupe (≤400 chars, ≤10 per call), pruned to newest 300. Manual add/delete/clear endpoints (`index.ts:669-697`).
- **Distillation on end**: `distill()` (`doppelganger.ts:675-724`) — marker `MEMORY DISTILLATION` → JSON `{summary, facts[], instructions[]}`; applies instructions even when memory is off (catches "call me Captain" said in a typed chat), saves facts and a `conversation`-kind summary. Test `integration.test.ts:1324`.
- **Sessions**: `POST /api/doppelgangers/:id/session` (1,800 s, prompt rebuilt each turn, greeting depends on whether memories exist).
- **Share link**: `POST /api/doppelgangers/:id/link {rotate?}` → `CreatorDO /avatar-link` (hash in D1, raw in DO storage, optional rotation); public `GET/POST /api/public/avatars/:token` starts an `avatar_guest` session with no memories and no tools (test `integration.test.ts:1271`); `/portrait` serves its face (the link is the capability).
- **Maturity**: solid.

### 2.18 Group conversations — "conversation studio"
- **Data**: `group_conversations` (topic, title, format=style, duration, energy, context ≤6,000 chars, include_user, participants JSON snapshot, next_turn, share_token_hash) and `group_lines` (seq unique per group, speaker id or `"user"`, text, audio_key, audio_mime).
- **Configuration tables** (`groups.ts:37-117`): 8 `STYLES` — podcast, debate, interview, educational, roast, casual, panel, brainstorm — each with `style`, suggested `roles`, `instructions`, `vibe`; `DURATIONS` short 16 / medium 28 / long 44 lines; `ENERGY` calm / engaging / viral. `MAX_PARTICIPANTS = 6` (the D1 comment says 2–4; code allows 6).
- **Casting**: pick existing avatars (`castFromAvatars`, ownership-checked) or `cast: N` → `inventCast()` (`groups.ts:350-409`): one LLM call invents N distinct people (ordinary names, gender, role, persona quirks, speed 0.95–1.06, photographic "look"); each becomes a **real private avatar** with a distinct gender-fitting voice via `assignVoice()`; portraits are painted afterwards in `ctx.waitUntil(paintPortraits())`, each within the creator's image allowance (rate-limit + refund), and patched into the JSON snapshot with a single atomic `json_group_array/json_set` UPDATE so concurrent paints cannot clobber each other.
- **Directing**: `advance()` (`groups.ts:653-769`) — the director (xAI `grok-4.20-0309-non-reasoning`) writes the next chunk (first 8 lines for fast start, then 12) as JSON `{title?, lines:[{speaker:<cast id>, text}], next: continue|user|end}` given cast notes built from each participant's **guest** context (never memories — "a group is written to be shared"), conversation so far (last 24), optional reference document, style/energy/length guide, and expressive speech-tag rules. Speakers named by name instead of id are resolved; unknown speakers dropped; one retry if the script is empty. With `include_user`, the creator's typed line is inserted as `speaker:"user"` and the director may hand the floor back (`next:"user"`). "Keep going" (`more`) extends past the planned length.
- **Voicing**: `voiceLine()` (`groups.ts:775-793`) calls xAI REST `/tts` via `speech()` (`providers.ts:87-117`) with the speaker's voice and `speed` (clamped 0.85–1.15), after `speakable()` normalizes tags (keeps `[pause] [long-pause] [laugh] [sigh] [breath] [sharp-breath] [cough] [yawn]` and balanced `<whisper|soft|loud|slow|fast>`; drops others); stored in R2 and served with `Cache-Control: private, no-cache` because re-voicing overwrites the same key. OpenAI-voiced avatars borrow the first xAI voice. `readable()` strips tags for display.
- **Editing**: `updateCast()` (names/roles/personas/voices/speeds, add/remove speakers — new ones become new avatars with painted portraits; voice uniqueness via first-claim map), `reset()` (clear lines + audio, optional recast), delete.
- **Replay sharing**: `/api/groups/:id/link` → CreatorDO `/group-link`; public `GET /api/public/groups/:token` returns topic/title/style/creator name/cast (with landmarks and portrait URLs)/lines with audio URLs; audio and portraits are scoped under the same token path.
- **Client pipeline** (from `src/web/groups.ts` header): *writer* (fetches chunks) ‖ *voicer* (3 lines concurrently, in order, with retries) ‖ *player* (plays ready lines through one analyser, driving the current speaker's lip sync) — the conversation starts within seconds.
- **Reference docs**: `POST /api/groups/document` extracts text server-side (PDF/DOCX/TXT/MD/JSON/CSV/RTF ≤4 MB), returns `{name, text ≤6000, chars, truncated}`; stored only with the conversation.
- Tests: `tests/studio.test.ts`, `integration.test.ts:1380, 1474, 1511, 1541`.
- **Maturity**: solid.

### 2.19 Canvas files (materials for builds)
- `canvas-files.ts`: ≤8 files per avatar. Images PNG/JPEG/WebP/GIF ≤1.5 MB each, ≤4 MB total (they get embedded in every page), magic-byte sniffed, stored in R2 with client-reported width/height; documents (PDF, DOCX, text, code, GLSL, SVG, YAML…) ≤4 MB extracted once to text (≤40k chars) — `content.ts` is dynamically imported so the builder bundle path stays light. Names are uniquified (`photo (2).jpg`) because pages look images up by name.
- `materials()` builds the brief: documents concatenated under a 60k budget with "(shortened)" markers; `imageData()` returns `{name: data:URL}`.
- **Maturity**: solid.

### 2.20 Canvas experiences + BuilderDO (LLM-built sandboxed apps)
- **Request**: tool `create_experience {title, brief, revise?, webgl?}` (`experiences.ts:19-45`) from a spoken or typed owner conversation, or `POST /api/doppelgangers/:id/experiences`. `request()` inserts a `queued` row; `revise` links `based_on` to the latest ready experience and inherits its WebGL choice. The tool result tells the avatar to say in one sentence that a first version appears in ~20 s.
- **Build**: `POST /api/experiences/:id/build` → `BuilderDO /start` (join if already running) → `alarm()` → `build()` (`experiences.ts:389-538`): atomically claims the row (`status IN (queued, failed)` or stale >10 min, or resume); streams `/chat/completions` with `MODELS.xai.builder` (`grok-4.20-0309-non-reasoning`, `temperature 0.7`, `max_tokens 32,000`, sketch 6,000). For new ideas, a **sketch** (150–250 lines, hard-stopped at 450) runs *concurrently* with the full build and is saved as `.preview.html` + `preview_lines` so the canvas can play it; the sketch is aborted once the full version works. If the full page is <1,000 lines, one **expansion** pass. `works()` = ≥1,500 chars, has `<script`, and `getContext(` if WebGL required. If the full build fails, a working sketch is kept as the result. 6-minute timeout; `MAX_BYTES 450,000`. Progress (`lines, chars, tail (last 1,600 chars), phase sketching|writing|expanding`) reported ≤2.5×/s — comment notes re-splitting the whole page on each delta cost ~50 ms CPU and hit Worker limits.
- **Durability**: `BuilderDO` (`builder.ts`) stores the job, runs from an alarm (up to 15 min wall-clock), retries once after eviction/deploy (`attempts ≥ 2` → failed). `GET /api/experiences/:id` merges DB state with live `/progress`; if no builder is running but the row says building, it re-reads and marks failed so retry is possible.
- **Serving**: `serve()` returns HTML with `EXPERIENCE_CSP` (`sandbox allow-scripts allow-pointer-lock; default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; img/media data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'`), `Cross-Origin-Resource-Policy: same-origin`, `no-store`, optional `Content-Disposition` download. Opaque origin: no cookies/storage/network. Images ride in as `<script id="pg-assets">window.PG_ASSETS={…}</script>` on **one line** (keeps the model's line numbers valid) and are **stripped before a page goes back to the builder** (`stripAssets`/`withAssets`).
- **Self-repair loop**: `REPORTER` script (one line, injected only for in-canvas runs) collects `error`, `unhandledrejection`, and `console.error` (where shader compile/link failures surface), deduped, ≤8, and `postMessage`s them to the parent after load+2.5 s / 7 s. The page POSTs them to `/api/experiences/:id/repair` → a new experience `based_on` the broken one with the errors embedded as data.
- **Sharing**: guests of an avatar's share link see `sharedList()` — only ready pages and only the newest of a revision chain — when `canvas_shared` is on; served via `serveShared()` without the reporter.
- Tests: `tests/experiences.test.ts`, `integration.test.ts:1575-1875`.
- **Maturity**: solid.

### 2.21 Creator inbox (consented transcripts + summaries)
- `GET /api/inbox` (last 100 sessions with title/name/email/summary), `GET /api/inbox/:id` (turns), `DELETE /api/inbox/:id` — first ends the live DO via `/erase` (503 if it cannot, so deletion never races an active writer), then deletes the session (turns cascade). 90-day retention via cron.
- Tests `integration.test.ts:443, 665, 712`.
- **Maturity**: solid.

### 2.22 Stripe billing: dynamic pricing, idempotent checkout, reconciling webhooks, portal
- `pricing()` (`billing.ts:93-107`): reads `unit_amount/currency/interval` live from Stripe `/prices/{id}` — no hard-coded amounts; annual optional.
- `CreatorDO /checkout` (`creator.ts:307-429`): creates a customer once (idempotency key `personagram-customer-{owner}`), reuses an open Checkout session for the same price, expires an open one for a different price, and — the key trick — writes a `checkout-attempt {key, price, params, expires}` record **before** calling Stripe so an uncertain/lost response is replayed with the same `Idempotency-Key` on the next click. Sessions expire in 31 min.
- **Webhook** (`index.ts:285-320` → `CreatorDO /billing-event`, `creator.ts:430-486`): HMAC-SHA256 verification with 300 s tolerance and constant-time compare (`verifyStripeSignature`, `billing.ts:33-75`); supported types `checkout.session.*`, `customer.subscription.*`, `invoice.*`, `entitlements.active_entitlement_summary.updated`; dedupe via `stripe_events`; then **ignores the event payload** and lists `/subscriptions?customer=…&status=all&limit=100`, filters to configured prices, prefers active/trialing then newest, and writes `subscriptionEntitlement()` — robust against out-of-order/stale events.
- `plan()` (`repo.ts:57-68`): Pro iff status active/trialing and `period_end` in the future.
- Portal: `POST /billing_portal/sessions`.
- Tests: `tests/billing-provider.test.ts`, `integration.test.ts:524-664` (Stripe stub in `tests/stripe-stub.ts`).
- **Maturity**: solid.

### 2.23 Server-rendered link previews, SEO, robots
- `html()` (`index.ts:186-263`) + `src/worker/meta.ts`: for `/p/:token`, `/a/:token`, `/g/:token` resolves the entity and injects OG/Twitter/JSON-LD tags between `<!--%META%-->` markers (escaped; JSON-LD `</` escaped); dead links get a generic card without revealing why. Unlisted links are `noindex`; the showcase demo link is indexable and allow-listed in `robots.txt`/`sitemap.xml`. Tests: `tests/meta.test.ts` (13 cases incl. attribute-injection).
- **Maturity**: solid.

### 2.24 Showcase/demo seed
- `scripts/seed-demo.mjs` + `scripts/demo-content.mjs` seed an idempotent showcase avatar/link (fixed ids, `INSERT OR REPLACE`), portrait `public/hero.png` + `demo-landmarks.json`; token reused across runs so printed QR codes keep working. `tests/demo-seed.test.ts` validates the seed with the app's own validators (all persona fields substantive, ≤24k selected knowledge, `ask_consent = 0`, landmarks enable lip sync).
- **Maturity**: solid.

### 2.25 Architecture guard tests
- `tests/architecture-guard.test.ts`: (1) no source file under `src/` or `public/` references `reference/`; (2) no voice-clone route/UI/strings (`/api/voices/clone`, `voice_clone`); (3) browser files contain no `sk-…`/`xai-…` key patterns. Cheap, grep-style invariants enforced in CI.
- **Maturity**: solid.

### 2.26 Maintenance cron & usage metering
- `scheduled()` (`index.ts:1204-1225`) purges expired rows; `usage_events` table exists and is purged but **never written** — no usage metering or cost accounting is implemented (stub).

---

## 3. Providers, models & external APIs

**Model registry** — `MODELS` in `src/worker/providers.ts:3-17` (frozen):

| Key | Model id | Used for |
|---|---|---|
| `openai.live` | `gpt-live-1` | OpenAI Live WebRTC voice sessions |
| `xai.text` | `grok-4.6` | default for `generateText()` — text interview JSON, bulk persona fill, guest summaries, memory distillation |
| `xai.chat` | `grok-4.20-0309-non-reasoning` | conversational replies (typed + delegated), `chatWithTools`, group casting & directing (comment: ~0.5 s to first token vs ~8 s for reasoning) |
| `xai.builder` | `grok-4.20-0309-non-reasoning` | canvas experience builder (comment: reasoning model thought 90 s before writing) |
| `xai.voice` | `grok-voice-think-fast-2.0` | per-turn realtime speech |
| `xai.image` | `grok-imagine-image-2.0` | portrait generate/edit |

**xAI** (base `https://api.x.ai/v1`, override `XAI_BASE_URL`; `Authorization: Bearer`):
- `POST /chat/completions` — `{model, messages, max_tokens:1200, stream, store:false, tools?, tool_choice:"auto"}`; SSE parsed by hand with 256 KB buffer cap and 20k-char answer cap; builder uses `max_tokens 32000` / `6000`, `temperature 0.7`.
- `POST /images/generations` — `{model, prompt, n:1, response_format:"b64_json", aspect_ratio:"3:4"}`; `POST /images/edits` — `{…, image:{url:"data:…"}}`.
- `POST /stt` (multipart `language`, `file`) and `WS /stt?sample_rate=24000&encoding=pcm&interim_results=true&endpointing=450&smart_turn=0.7&smart_turn_timeout=1800` (events `transcript.created`, `transcript.partial{text,speech_final}`, `error`).
- `POST /tts` — `{text, voice_id, language:"en", with_timestamps?, speed?}`; returns raw audio bytes (or JSON `{audio, content_type}` — both handled; the "every line came back mute" bug comment).
- `WS /tts?language=en&voice=…&codec=pcm&sample_rate=24000&with_timestamps=true` — client `text.delta/text.done/text.clear/response.cancel`; server `audio.delta{delta, audio_timestamps{graph_chars,graph_times}}`, `audio.done`, `error`.
- `GET /tts/voices` — catalog (`voice_id|id, name, gender, description`), cached 1 h.
- `WS /realtime?model=grok-voice-think-fast-2.0` — `session.update`, `conversation.item.create`, `response.create`, `function_call_output`; server `session.updated`, `response.output_audio.delta`/`response.audio.delta`, `response.output_audio_transcript.delta`/`response.audio_transcript.delta`, `response.function_call_arguments.done{name, call_id, arguments}`, `response.done`, `error`. Audio: PCM16 24 kHz both ways; `turn_detection: null`.

**OpenAI** (base `https://api.openai.com/v1`, override `OPENAI_BASE_URL`):
- `POST /live/sessions` (payload in §2.12), `WS /live/sessions/{id}/attach` (sideband), `POST /live/sessions/{id}/hangup`.
- Built-in voices (hard-coded): alloy, ash, ballad, beacon, bossa, cedar, cinder, coral, delta, echo, gleam, marin, meridian, quartz, ripple, sage, shimmer, stone, tempo, verse, vesper, willow.

**Socket connect helper**: `connectProvider()` (`providers.ts:360-385`) — fetch with `Upgrade: websocket`, 15 s timeout scoped to the handshake only (fix for sessions dying at exactly 15 s), requires 101.

**Google**: `accounts.google.com/o/oauth2/v2/auth`, `oauth2.googleapis.com/token`, `openidconnect.googleapis.com/v1/userinfo`.

**Stripe** (base `https://api.stripe.com/v1`, override `STRIPE_BASE_URL`, form-encoded, optional `Idempotency-Key`): `/customers`, `/checkout/sessions`, `/checkout/sessions/{id}`, `/checkout/sessions/{id}/expire`, `/subscriptions?customer=…&status=all&limit=100`, `/billing_portal/sessions`, `/prices/{id}`.

**Browser-side third parties (CSP)**: `cdn.jsdelivr.net` (version-pinned MediaPipe code/WASM), `storage.googleapis.com` (face landmark model). Landmark detection runs locally.

**Capability flags / env** (`src/worker/env.ts`, `.env.example` names): `APP_ORIGIN`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `XAI_API_KEY`, `OPENAI_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_ANNUAL`, `SESSION_CAP_SECONDS`, plus `DEMO_PERSONAGRAM_TOKEN` and test-only `XAI_BASE_URL`/`OPENAI_BASE_URL`/`STRIPE_BASE_URL`. Missing credentials surface as 503 "X is not configured yet" before any network call (`providerConfig()`); features degrade independently (marketing works with no keys).

**Provider coverage is only two vendors.** There is no Anthropic, Google Gemini, local/Ollama, or generic OpenAI-compatible adapter, no embeddings, no video. `Provider = "xai" | "openai"` (`domain.ts:1`) is a *voice transport* choice, not an LLM router: text reasoning is always xAI.

---

## 4. Data model & persistence

### 4.1 D1 schema (by migration)
- **0001_initial**: `users(id, google_sub UNIQUE, name, email)`, `auth_sessions(token_hash PK, user_id, expires_at)`, `oauth_states(state_hash PK, verifier, expires_at)`, `avatars(id, owner_id UNIQUE, persona JSON, draft_persona JSON, asset_id, provider='xai', voice='ara', status='draft', version, step)`, `avatar_assets(id, owner_id, r2_key, mime, source_type, landmarks JSON, approved)`, `interview_messages(id, owner_id, role, content)`, `sources(id, owner_id, name, r2_key, mime, status='processing', error)`, `knowledge(id, owner_id, source_id, title, content, approved)`, `personagrams(id, owner_id, title, purpose, audience, outcome, greeting, overlay, knowledge_ids JSON, asset_id, ask_consent, status='active', token_hash UNIQUE)`, `guest_sessions(id, personagram_id, owner_id, consent_version, name, email, summary, ended_at)`, `guest_turns(id, session_id ON DELETE CASCADE, role, content)`, `subscriptions(user_id PK, customer_id UNIQUE, subscription_id, product_id, status='free', billing_interval, period_end, updated_at)`, `stripe_events(id PK)`, `rate_limits(key PK, count, reset_at)`, `usage_events(id, owner_id, kind, seconds)` (unused), `active_sessions(id, personagram_id, expires_at)`.
- **0002_avatar_review**: `avatars.draft_asset_id`, `avatar_assets.generation_metadata JSON`, `knowledge.version`.
- **0003_doppelganger**: `doppelgangers(…, share_token_hash UNIQUE, last_talked_at)`, `memories(id, owner_id, doppelganger_id ON DELETE CASCADE, kind fact|conversation, content, session_id)`, `sources.doppelganger_id`, `knowledge.doppelganger_id` (scope: NULL = public library).
- **0004_groups**: `group_conversations(…, participants JSON snapshot, next_turn, share_token_hash UNIQUE)`, `group_lines(id, group_id ON DELETE CASCADE, seq, speaker, text, audio_key, audio_mime)` + `UNIQUE(group_id, seq)`.
- **0005_group_studio**: `title, duration='medium', energy='engaging', context`.
- **0006_experiences**: `experiences(id, owner_id, doppelganger_id, title, brief, based_on, status queued|building|ready|failed, r2_key, lines, bytes, error)`.
- **0007_canvas_files**: `experiences.preview_lines, experiences.webgl (NULL=auto)`, `doppelgangers.canvas_shared=1`, `canvas_files(id, owner_id, doppelganger_id, name, kind text|image, content, r2_key, mime, width, height, bytes)`.

JSON columns are decoded centrally by `decode()` (`repo.ts:10-29`: `persona, draft_persona, knowledge_ids, landmarks, generation_metadata`, `ask_consent`→boolean) or per-module decoders (`decodeCast`, `decodeGroup`, experiences `decode` which also *derives* `failed` for stale builds without writing).

### 4.2 Durable Object storage
- **CreatorDO** (key/value): `link:{personagramId}` → raw token; `avatar-link:{avatarId}`, `group-link:{groupId}` → raw tokens; `extract:{sourceId}` → job; `checkout` → `{id, price, url, expires}`; `checkout-attempt` → `{key, price, params, expires}`. (Declared as SQLite-backed class but used as KV.)
- **ConversationDO**: `config` (SessionConfig incl. capability hash) and, for owner private-avatar sessions only, `history {history, ids}`; wiped by `deleteAll()` on end. In-memory: sockets, generation, assemblers, budgets.
- **BuilderDO**: `job {owner, id, ownerName, attempts}`; in-memory `progress`, `running`, `error`.

### 4.3 R2 layout
`avatars/{owner}/{assetId}`, `sources/{owner}/{sourceId}` (served back only as `application/octet-stream` + `attachment`), `groups/{owner}/{groupId}/{lineId}`, `experiences/{owner}/{id}.html`, `experiences/{owner}/{id}.preview.html`, `canvas-files/{owner}/{fileId}.{ext}`. Bucket is private; every read goes through an owner- or capability-checked route.

### 4.4 Key DTO shapes
- Public Personagram (`publicPersonagram()`, `domain.ts:141-159`): `{id, title, purpose, greeting, ask_consent, name, headline, provider, voice, avatar_url, landmarks}` — never owner id, token hash, knowledge ids, draft fields.
- Shared avatar: `{name, creator, provider, avatar_url, landmarks, experiences[]}`.
- Group replay: `{topic, title, style, creator, include_user, participants[{id,name,role,avatar_url,landmarks}], lines[{id,seq,speaker,text,audio,audio_url}]}`.
- Experience: `{id, title, brief, based_on, status, lines, bytes, preview_lines, webgl, error, created_at, updated_at, progress?}`.

---

## 5. UX details worth keeping

- **Draft vs published everywhere.** Persona, portrait and knowledge all have a private draft state and an explicit approve step; a new look stays private until approved; the review UI is "the publishing boundary". Likeness consent is asked once, at approval.
- **Training by talking.** Both the creator interview and private avatars learn through tool calls *during* the conversation, and the page gets immediate events (`persona`, `memory`, `instructions`) so it can show "what I just learned" chips. Tool results are phrased to make the model react like a friend rather than announce "saved".
- **Fast first response by design.** Non-reasoning chat model for replies (0.5 s TTFT), realtime voice per turn (~1.2 s to first audio), early first-clause release in the chunker, first group chunk of 8 lines, experience sketch playable in ~20 s while the full build continues, and portraits painted after the group already started.
- **Honest progress for long jobs.** Builds expose `phase`, line count and the last 1,600 chars being written ("watch it being written"); a crashed build is reported as failed rather than stuck, so retry is always possible.
- **Interruption semantics.** Barge-in via mic level or new STT text, generation-tagged audio so stale audio never plays, `speech_started`/`interrupted` events flush playback, "do not repeat interrupted content" instruction to Live.
- **Graceful degradation.** Voice failures fall back to text ("The text response is still available"); faceless cast members are fine; missing MediaPipe leaves a still portrait; missing keys produce clear 503s per feature; a failed full build keeps the sketch.
- **Session resilience.** Reconnect with backoff (client) re-attaches to the same DO session; owner avatar conversations wrap up (and are memorized) 2 minutes after the tab closes unless it reconnects.
- **AI disclosure without nagging.** A permanent on-screen "AI Avatar" badge; prompt says disclose when asked or when someone seems confused, never repeat — test enforces the wording (`tests/domain.test.ts:73-92`).
- **Recoverable links, one-click rotate/revoke.** Owners can always get a link back (and its QR) because the raw token lives in their DO; rotation for avatar links; revocation kills live sessions instantly.
- **Link previews with a face.** Shared links unfurl with the approved portrait and a clear "Clearly AI, never the real person" description.
- **Studio controls.** Style chips (8), length (short/medium/long), energy (calm/engaging/viral), "include me", attach a document, edit cast (voice, pace), reset/recast, "keep going", retry failed lines, shareable replay.
- **Canvas.** Revise-in-place ("change the one showing"), WebGL choice (auto/force/forbid), files attached as build materials, auto-fix from real browser errors, download as a single HTML file, optionally shown to link guests.

---

## 6. Patterns worth reusing (and how to lift them)

1. **Per-entity Durable Object as a serialization boundary** (`CreatorDO` promise queue, `creator.ts:16-37`). Lift: a `WorkspaceDO` (per business owner) that serializes quota, budget, plan and billing mutations and holds recoverable secrets (share tokens, OAuth refresh tokens). Caveat: don't run slow LLM calls inside the queue (the text interview does today).
2. **Per-session Durable Object that owns all provider sockets** (`ConversationDO`). Lift directly as `AgentSessionDO`: one per live conversation with an agent; browser talks only to our WebSocket; provider keys and instructions never reach the client; session type flags (`interview`, `doppelganger`, `avatar_guest`, `preview`) generalize to `{agentId, role: owner|observer|guest, tools[]}`. Add "observer" sockets so the owner can *listen in* on an agent-to-agent meeting.
3. **Capability-scoped tool dispatch** (`toolHandler()`, `conversation.ts:414-421`): tools are offered per session type AND re-checked on every call; an unoffered tool call resolves to `null` and is dropped. Integration tests force a provider to emit unoffered calls. Lift as the core of P12 grants: `(agent, session role) → allowed tools`, enforced at dispatch, with adversarial tests.
4. **Realtime tool-call batching with a single follow-up** (`conversation.ts:847-913`): collect calls during a response, answer all, then one `response.create`; timeout fallback. Directly reusable for any realtime voice agent that calls tools (spawn coworker, create task, request approval) mid-sentence.
5. **Voice front / brain back delegation** (OpenAI Live `delegation:{type:"client"}` + `session.commentary.append` fed by `SentenceChunker`). Lift for the lead orchestrator: a low-latency voice model handles turn-taking and small talk while the orchestrator (any LLM, with tools and memory) produces the substance, streamed back as speakable chunks. Provider-agnostic in spirit.
6. **Generation counter for interruption** (`cancel()` + `generation` on every `audio` event + client-side drop). Cheap and correct; reuse for every speaking avatar, including multiple avatars in a meeting (per-speaker generations).
7. **Per-turn fresh brief** (`turnBrief()`, `avatarPrompt()` with `fit()` budgets): instructions rebuilt every turn from live state (settings, files, memories, canvas status, recent history), each block labelled "reference data, not instructions". Lift as the context assembler for each coworker agent, with explicit per-section budgets and "newest wins, shown oldest first" memory ordering.
8. **Self-training via tools + end-of-session distillation** (`update_instructions`, `save_memory`, `distill()` with dedupe/normalization and caps). Lift for persona evolution: the owner shapes a coworker by talking; distillation catches what tools missed. Store instructions as lines for surgical add/remove.
9. **TurnAssembler on provider timeline** (`src/shared/turns.ts`): reuse verbatim for any realtime transcript source; reopen/revise semantics matter when users pause mid-sentence.
10. **Hashed bearer links + raw token in owner DO** (`creator.ts:175-201`, `/avatar-link`, `/group-link`) and **capability cookie scoped to one session path** (`index.ts:169-176`). Lift for guest links to projects/meetings/artifacts and for "join this meeting" invites.
11. **Consent-gated persistence** (memory-only by default, `guest_turns` only with explicit versioned consent, summary replaced asynchronously, erase ends the live session first). Lift for customer-facing agents and for any external participant in a meeting.
12. **Director/script pattern for multi-agent talk** (`groups.ts` `advance()`): one director model writes N lines for a cast from each participant's shareable context; JSON with speaker ids, name fallback, `next` handoff (`continue|user|end`), style/energy/length presets, chunked for streaming playback, per-line TTS stored for exact replay. Lift for "meetings" between coworkers where the user can listen, jump in (`include_user`), and share a replay. For real task work, replace the single director with actual per-agent turns, but keep the chunk/voice/play pipeline.
13. **Writer ‖ voicer ‖ player pipeline** (client, `src/web/groups.ts`): start playback within seconds while the rest is generated/voiced (3 concurrent TTS requests, in-order playback, retries). Reuse for agent stand-ups and briefings read aloud.
14. **Alarm-driven durable job DO** (`BuilderDO`): one DO per job, alarm execution (survives client disconnect), bounded retries, live progress endpoint merged with DB status, stale-row detection. Lift as the generic *run executor* for long agent tasks (P4), with checkpoints stored in DO storage.
15. **Sketch-then-full parallel generation with fallback** (`build()`): fast preview written alongside the full artifact; keep the preview if the full fails; expansion pass if under quality bar. Lift for any artifact agent (reports, decks, apps).
16. **Sandboxed LLM-written apps + error reporter + repair loop** (`EXPERIENCE_CSP`, `REPORTER`, `repair()`, one-line asset inlining). Lift for P10 "in-app apps": agents build mini-tools/dashboards that run in an opaque-origin iframe with no network; runtime errors feed a fix job automatically.
17. **D1 upsert rate limiter with refunds** (`rateLimit()`/`refund()`): drop-in, plan-aware; extend with cost units to become a budget ledger.
18. **Stripe reconciliation by current state** (`/billing-event`): dedupe event ids, then fetch authoritative subscriptions instead of trusting event payloads; pre-persisted idempotency attempt for checkout. Lift unchanged for P13.
19. **SSR meta injection for SPA share links** (`meta.ts`, `html()`): face + name in unfurls, noindex by default.
20. **Architecture guard tests** (`tests/architecture-guard.test.ts`): grep-level invariants (no secrets in browser code, forbidden features absent, no imports from reference). Cheap to replicate for the workplace (e.g. "no provider key strings in `src/web`", "no direct provider calls from the browser").
21. **Integration harness with Wrangler + local provider stubs** (`tests/integration.test.ts` spins isolated D1/DOs and an HTTP/WS stub that impersonates xAI chat/stt/tts/realtime/images and Stripe, including adversarial behaviors like unoffered tool calls). Strong template for P14.

---

## 7. Gaps, debt & risks

- **Docs drift.** README/IMPLEMENTATION_STATUS (Sept 15) describe neither private avatars, groups, experiences nor canvas files; they claim the QR encoder is not done (it exists: `src/web/qr.ts`, `tests/qr.test.ts`); they describe casual-vs-substantive routing (`isCasual`) and "Grok text streamed through timestamped TTS" which the code no longer does. README says `wrangler.toml` contains a placeholder D1 id; it contains a concrete one and a concrete workers.dev origin.
- **Dead code in the voice path.** `ConversationDO.tts()` is unreachable (`conversation.ts:652` returns before `:661`), so exact character-timestamp lip sync (tier 1) is unused; `TurnAssembler.confirm()`/`typedTurn()` unused by the worker; `usage_events` never written.
- **Only two providers, text is xAI-only.** `Provider` is a voice-transport enum; OpenAI Live sessions need `XAI_API_KEY` for every substantive answer; group voicing forces xAI TTS (OpenAI-voiced avatars "borrow" a voice). No model registry beyond a constants object, no fallback/routing, no Anthropic/Gemini/local, no embeddings, no video.
- **No retrieval.** Knowledge is "selected cards concatenated into the prompt" (≤24k chars per link, ≤20k in private avatars). Memories are a flat list pruned at 300. No vectors, graph, or relevance ranking — it will not scale to business-sized context.
- **No metering/cost control.** Rate limits count requests, not tokens, seconds or dollars; `usage_events` is a stub. Group voicing allows 3,000 TTS calls/day per owner.
- **CreatorDO queue runs slow LLM work.** `/interview` (a full `generateText` round trip) blocks publish/checkout/link operations for that creator while it runs; the queue is in-memory (lost on eviction — acceptable because D1 is the source of truth, but ordering isn't durable).
- **Group director is single-model theatre.** Participants don't actually reason independently; one prompt writes everyone's lines. Great for podcasts/debates, not for agents doing real work or holding private context.
- **Per-turn realtime sockets.** A fresh xAI realtime session per spoken turn, carrying history in instructions (≤6k chars). Works and is fast, but loses provider-side conversation state and re-pays setup on every turn.
- **OpenAI Live coverage.** No mocked end-to-end WebRTC negotiation; sideband behavior verified only by unit tests of payload/redaction.
- **Mixed guards on doppelganger ownership.** Most mutations check `owner_id`, but `touch()` updates by id only (called after an ownership check) and several helpers (`memories(env, avatarId)`) rely on callers having checked ownership first. `PATCH /api/knowledge/:id` silently no-ops on a foreign/missing id (no 404).
- **Experience CSP allows `'unsafe-eval'` and inline scripts** (necessary for generated code) — safe only because of `sandbox` without `allow-same-origin`; any future relaxation (e.g. `allow-same-origin` for storage) would expose the signed-in origin. `frame-ancestors 'self'` + CORP same-origin mitigate embedding.
- **Hard-coded English.** STT/TTS `language=en` everywhere.
- **In-isolate caches.** The xAI voice catalog cache (`voiceCache`) is per isolate; fine, but not shared.
- **Cron only purges; no R2 GC.** R2 objects for revoked links/old guest sessions aren't touched by the cron (sources/avatars are deleted by explicit routes; group audio by reset/delete).
- **`MAX_PARTICIPANTS` mismatch** (migration comment says 2–4; code allows 6).
- **Regex router in one 1,226-line file.** Easy to follow but hard to extend; ownership checks are repeated inline per route.

---

## 8. Relevance to the Agent Workplace (pillar mapping)

| Pillar | What this slice offers | Verdict |
|---|---|---|
| **P1 Lead orchestrator** | Owner-talks-to-one-avatar model; tool calls mid-voice (`create_experience` returns immediately while a DO builds); voice-front/brain-back delegation (OpenAI Live → xAI answer via commentary). | **Adapt**: the lead agent should be an owner-mode avatar session whose tools are `spawn_coworker`, `create_project`, `assign_task`, `convene_meeting`, `request_approval`, each queuing durable work (BuilderDO pattern) and answering in one short sentence. |
| **P2 Personas** | `PersonaProfile` 9 fields; line-based instructions editable by voice; `inventCast()` generating distinct personas with gender-fitting voices, pace, and portrait "look"; guest vs owner prompt modes. | **Adopt** persona schema + `update_instructions` + `inventCast` (as "hire a team for this project"). Add skills/tools and model choice per persona. |
| **P3 Avatars** | Server-side lip-sync contract (landmarks in DTOs, three timing tiers, generation-tagged PCM), portrait generate/edit with identity-preserving prompts, likeness consent, approved-image gating. | **Adopt** the data contract; revive the timestamped-TTS path for exact visemes; extend to multi-speaker stages (group player already drives per-speaker lip sync). |
| **P4 Workflow orchestration** | `BuilderDO` alarm jobs with bounded retries, progress, stale detection; sketch‖full with fallback; repair-from-errors loop; CreatorDO alarm queue for extraction. | **Adopt** as the run executor primitive; add DAG/plan layer, checkpoints and human approvals on top. |
| **P5 Intra-agent comms** | Group conversation director, `next: continue|user|end` floor handoff, include-user, chunked script, per-line voice, shareable replay, cast notes from shareable context only. | **Adapt**: use for "meetings" the owner can watch/join and replay; replace single-director with real per-agent turns for work meetings; keep the writer‖voicer‖player pipeline and memory-isolation rule. |
| **P6 Projects & plans** | Not present (no projects/tasks). Nearest analogues: group conversations (topic + reference doc + cast), experiences with `based_on` revision chains, inbox with summaries. | **Build new**; reuse inbox/summary and revision-chain ideas for project artifacts and decisions. |
| **P7 LLM providers** | xAI (chat/text/builder/image/stt/tts/realtime) and OpenAI Live only; `MODELS` constant; base-URL overrides for tests; hand-rolled SSE with bounds; stable error mapping (no upstream leakage). | **Avoid** as the registry design (too narrow); **adopt** the SSE/tool-call parsing, bounded streaming, error redaction and base-URL override pattern inside a real multi-provider registry. |
| **P8 Multimodal** | Streaming STT, realtime speech, REST/streaming TTS with timestamps and expressive tags (`speakable`), image gen/edit, PDF/DOCX extraction, one-shot transcription, WebRTC. No embeddings, video, camera/screen. | **Adopt** STT/TTS/realtime plumbing and tag handling; add embeddings/video/vision elsewhere. |
| **P9 Context & memory** | Approved knowledge cards, per-avatar scoping (`doppelganger_id` NULL = shared library), memories (fact/conversation) with dedupe + distillation, budgeted per-turn briefs, "data not instructions" framing. | **Adapt**: keep scoping + approval + distillation; replace prompt-stuffing with vector/graph retrieval feeding the same budgeted brief builder. |
| **P10 Tools / apps** | Tool schemas (`save_persona_facts`, `save_memory`, `update_instructions`, `create_experience`), `chatWithTools` (3 rounds max), sandboxed LLM-built HTML apps with materials and auto-repair. | **Adopt** sandboxed app pattern for in-app agent-built tools; **adopt** capability-scoped tool dispatch. No MCP here. |
| **P11 Navigation & UX** | Session types for owner/guest; reconnect; captions; barge-in; progress UIs; share sheets; replay pages. | **Adopt** interaction patterns; add an "observer" role so the owner can listen to any agent's live speech. |
| **P12 Trust & governance** | Google OAuth+PKCE, hashed tokens/sessions, capability cookies, origin checks, CSP/Permissions-Policy, bounded bodies, error redaction, rate limits with refunds, consent versioning, draft→approve boundaries, likeness consent, no voice cloning (guarded by test), provider data-channel allowlist empty. | **Adopt wholesale**; extend rate limits into token/$ budgets and add audit logs (none here). |
| **P13 Business** | Free/Pro plan limits in one constant, Stripe dynamic pricing, idempotent checkout, reconciling webhooks, portal, OG unfurls, showcase seed + demo tests. | **Adopt** billing core and plan-limit enforcement in the workspace DO. |
| **P14 Infrastructure** | Workers + 3 DO classes + D1 + private R2 + cron; SPA with worker-first SSR meta; Wrangler integration harness with provider/Stripe stubs; architecture-guard tests. | **Adopt** the stack and test harness; split the router into modules. |

**Bottom line.** This slice is the best available reference for *how a single speaking avatar session should be engineered* (DO-owned provider sockets, per-turn briefs, capability-scoped tools, interruption, lip-sync data, consent) and for two workplace-relevant primitives: **durable alarm-driven jobs with live progress** and **multi-avatar "meetings" with voiced, replayable output**. It offers nothing for projects/plans, multi-provider LLM routing, retrieval, or MCP — those must come from other references.
