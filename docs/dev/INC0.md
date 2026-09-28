# Increment 0 · First Light

You pick a Chief of Staff from the 12 catalog leads, name them and talk: text or push-to-talk, with spoken replies
and a face whose mouth follows the audio actually playing. You can interrupt at any time. You can hand them a
background job ("look into X"). While it runs you keep talking: "how's it going?" is answered from live job state,
"also check Y" steers the job at its next checkpoint, and they tell you when it is done. The Floor lists the
catalog's 162 coworkers with profiles.

Everything runs without keys, on the Mock provider or your local Ollama. Adding a key upgrades one capability at a
time; a capability without a provider is hidden, never shown broken.

Contracts: [CONTRACTS.md](CONTRACTS.md). Plan: [../MVP-PLAN.md](../MVP-PLAN.md) (Inc 0).

---

## 1. Run it

```sh
pnpm install          # also builds the catalog bundle
pnpm dev              # worker :8787 + web :5173, uses apps/worker/.dev.vars → open http://localhost:5173
```

| Mode | Command | Chat | Voice out | Voice in | Faces |
|---|---|---|---|---|---|
| Your keys | `pnpm dev` | first configured of Anthropic, OpenAI, xAI, Gemini, OpenAI-compatible, then Ollama, then Mock | provider TTS in the lead's catalog voice | provider STT | portraits once generated, else illustrated |
| Local only | `pnpm dev --local` | Ollama `qwen3:32b` (Mock when Ollama is not running) | browser voice | browser dictation | illustrated |
| Keyless demo | `pnpm dev --mock` | Mock (instant, clearly labelled placeholder answers and write-ups) | browser voice | browser dictation | illustrated |
| Voice path, no keys | `pnpm dev --mock --mock-media` | Mock | Mock TTS: silent audio with character timing (the mouth moves, nothing is heard) | Mock STT (a fixed sentence) | illustrated |

- `--local` and `--mock` blank the cloud keys for that run even if `.dev.vars` has them: nothing leaves the machine.
- Other flags: `--fresh` (wipe local DOs, D1 and R2), `--worker-port`, `--web-port`, `--persist-to`, `--no-watch`.
- The Browser pane config `.claude/launch.json` → **headcount** runs `pnpm dev` on :5173.

Tests:

```sh
pnpm typecheck        # TypeScript 7, every package
pnpm test             # Vitest, all packages and apps
pnpm e2e              # Playwright: two keyless stacks (Mock :5183/:8797 and Mock + mock media :5184/:8798), fake mic
pnpm e2e:screens      # regenerates docs/dev/screens/inc0/*.png
pnpm build            # vite build + wrangler dry-run bundle
```

## 2. Add keys

Keys live only in `apps/worker/.dev.vars` (git-ignored, server-side only). Create it from the example the first
time, fill in what you have, and restart `pnpm dev`:

```sh
cp apps/worker/.dev.vars.example apps/worker/.dev.vars   # only if it does not exist yet
```

| Key | Unlocks |
|---|---|
| `ANTHROPIC_API_KEY` | chat |
| `OPENAI_API_KEY` | chat, spoken replies (gpt-4o-mini-tts), voice input (gpt-4o-transcribe), portraits (gpt-image), embeddings |
| `XAI_API_KEY` | chat, spoken replies (preferred for voices with an xAI id), voice input, portraits (grok-imagine, preferred) |
| `GEMINI_API_KEY` | chat, embeddings |
| `OPENAI_COMPATIBLE_BASE_URL` (+ `_API_KEY`, `_MODEL`) | any OpenAI-compatible server (LM Studio, vLLM, a gateway) |
| `OLLAMA_BASE_URL` | local chat and embeddings (default `http://127.0.0.1:11434`) |

- `DEFAULT_CHAT=auto` picks the first configured provider in the order above. Set it to one id to pin a provider.
- Spending limits per UTC day: `TTS_DAILY_LIMIT` (3000 spoken sentences), `STT_DAILY_LIMIT` (600 recordings),
  `CHAT_DAILY_LIMIT` (1500 Chief of Staff turns), `JOB_DAILY_LIMIT` (60 new jobs), plus `MAX_ACTIVE_JOBS` (3 running at
  once) and `PORTRAIT_DAILY_LIMIT` (200). Past a limit the route answers `429` with a sentence naming the variable,
  and the Chief of Staff says so instead of promising work.
- Only the app itself may call the worker: other origins and host names get `403` (cross-site pages, DNS
  rebinding). `pnpm dev` allows its own web and worker ports; to open the app from another address, start it with
  `HEADCOUNT_ALLOWED_ORIGINS=http://<address>:5173 pnpm dev`.
- When a key is missing, its route answers `503` and names the key. For example: "No provider is configured for
  spoken replies (text to speech). Add OPENAI_API_KEY or XAI_API_KEY to apps/worker/.dev.vars."
- `GET /api/capabilities` shows what is configured. It lists key names only, never values.
- Keys never reach the browser, logs, frames or error messages; errors are scrubbed of anything key-shaped.

### Pre-generate the lead portraits

With `pnpm dev` running and `XAI_API_KEY` or `OPENAI_API_KEY` set:

```sh
pnpm portraits:generate              # the 12 leads, one at a time, [i/n] progress; skips existing portraits
pnpm portraits:generate --dry-run    # what it would do
pnpm portraits:generate --all        # every lead and coworker (~174 images; mind the cost)
pnpm portraits:generate --only lead-warm-mentor --force   # repaint one
```

- Portraits are stored in local R2 at `portraits/<id>.<ext>`, with a row in D1.
- Faces switch from the illustration to the portrait on their own. Face landmarks are detected in the browser
  (MediaPipe) the first time a portrait shows, then saved.
- `PORTRAIT_DAILY_LIMIT` (default 200 per UTC day) caps paid generations; the script stops at the limit.
- In the app, a quiet "Generate portrait" link appears on the onboarding stage once an image provider exists.

## 3. Demo script (about 5 minutes)

1. `pnpm dev --mock` (instant), or `pnpm dev --local` (real answers from Ollama, slower), or `pnpm dev` with keys.
   Open http://localhost:5173.
2. **Pick your Chief of Staff.** Browse the twelve and click a few cards; each has a face, a backstory teaser, "best
   for owners who…" and an honesty line. With a TTS key, press "Hear …'s voice". Press **Find your match · 8
   questions** and answer; your top 3 appear with the reason for each. Rename your pick (for example "Rosa") and press
   **Choose**.
3. **Talk.** Say "Hi, what can you take off my plate this week?" and watch the reply stream in.
4. **Delegate.** "Look into coffee suppliers in Portland for me" (the first starter chip is a delegation too). The
   reply comes at once, and an Activity row shows the job's running sentence and progress. The header reads
   "Chief of Staff · Available · 1 job running": the face stays available while the work runs.
5. **Status while it works.** "How's it going?" is answered from live state ("step 2 of 5 …") while the row keeps
   moving.
6. **Steer.** "Also check which ones are fair trade certified." Open the row: the note shows "At the next checkpoint",
   then "Applied", and the plan gains a step.
7. **Completion.** After about 15 s on Mock (about 2 minutes on qwen3:32b) the Chief of Staff says "… is done", as
   its own named, timed message. **Read** opens the write-up, which **Projects** also lists. Try it from the Floor with
   voice off: the Talk tab and the bubble show a count, and the bubble pulses once.
8. **Stop.** "Research standing desks under 500 dollars", open its row, press **Stop this job** (at the far end of
   the panel, apart from Steer). The Chief of Staff acknowledges it in the thread.
9. **Voice.** Voice is on by default, and the speaker icon in the Talk header toggles it. Replies are spoken, with the
   provider voice when a TTS key exists and the browser voice otherwise. Hold **Space** (outside a text field) or the mic to talk. Type while the
   Chief of Staff is speaking: the voice stops at once (barge-in). A message sent while a reply is still streaming
   cuts that reply ("Interrupted").
10. **Floor.** Search "contract", filter a department, open a profile (face, story, signature methods).
11. **Shell.** Four places plus the Chief of Staff bubble (tap = Talk, hold = talk, also by holding Space on it; on
    Talk the header face takes its place). **⌘K** opens the palette (places, all coworkers, voice, switch Chief of
    Staff, theme); on phones it is the fifth tab, **More**. Light and dark follow the OS. The layout also works at
    phone width, where onboarding pins the name and **Choose** to the bottom of the screen.

## 4. What works (verified)

| Area | Status |
|---|---|
| Onboarding | 12 leads with illustrated faces (portraits when generated), story teaser, fit, honesty line. The catalog match quiz (8 questions) gives a top 3 with reasons. The name is saved, and the choice can be switched later with ⌘K → Switch Chief of Staff. |
| Talk | `POST /api/talk` → 202 in about 8 ms. Streaming `talk.delta`, then `talk.message` and `talk.done`. The system prompt is layered from the lead's catalog personality, communication, backstory and origin moments, plus a live work-state block. Failed sends stay in the thread with Retry. |
| Background jobs | These run in the Everyday ProjectDO on alarms: plan → 2–4 steps → write-up. Status is answered from state while the job runs (Mock: 312 ms, job at step 2/5). Steering goes queued → applied at the next checkpoint; a steer sent while the write-up is being written is applied and the write-up is redone, never dropped. The completion announcement and deliverable arrive in Talk and Projects, and Stop cancels a job (acknowledged in the thread). Each job's frames are mirrored as soon as its checkpoint ends. Jobs survive a worker restart. |
| Feed | One socket per client: `?since` replay, then paging with `{op:'resume'}` past 500 frames, holding live frames until the gap is filled. Seqs are gap-free, and a reload rebuilds the thread and jobs. Replayed frames are never spoken, and replayed settings never roll the app back. A socket that goes silent after a ping (sleep, Wi-Fi change) is dropped and resumed within 10 s. Only the app's own origin can open it. |
| Voice | One AudioContext, TTS per sentence, and a `speaking` state driven by audio actually playing, in heard time (output latency included at both ends; the analyser is delayed to match). The mouth follows provider alignment when it exists, else the chunk text timed over the clip; a silent tap never holds it shut. Barge-in stops speech in under 1 s. Push-to-talk records the mic and sends through STT, or browser dictation keyless; Space held in the empty composer talks too. |
| Faces | Photoreal strip-warp portraits (ported from personagram-ai) when a portrait exists, with a working copy sized to the display; illustrated faces from the catalog `appearance` otherwise (hair length, vitiligo and beauty marks follow the catalog's words and sides). Blink, sway, state poses and lip sync, seeded per person; one shared scheduler; reduced motion keeps lip sync. |
| Floor | 162 coworkers in 18 departments, with search by name, role or skill, a department filter and profiles. |
| Providers | Mock, Ollama, OpenAI, Anthropic, xAI, Gemini and OpenAI-compatible, with retries, deadlines, failover (never local → cloud, never to Mock) and key redaction. |
| Keyless | TTS, STT and portraits are hidden in the UI, and their routes answer 503 naming `OPENAI_API_KEY` / `XAI_API_KEY`. |

**Run on real workerd** (`wrangler dev`, HTTP + WebSocket, script in the integrator's scratchpad):

- **Mock:** the whole flow passed. First delta 27 ms, status reply 312 ms mid-job, steer applied about 2 s later,
  job done in about 14 s, 28 frames gap-free, `?since` replay exact.
- **Ollama qwen3:32b (`--local`):** the whole flow passed. Tool calls for delegate and steer; the status was answered
  from the prompt's live work state while the job ran; a real write-up in about 2 minutes; 34 frames gap-free, replay
  exact. Replies took 10–16 s to the first token (see known gaps).

**Automated checks:**

- Unit: 609 tests across 58 files pass (the avatar package's unused lip-sync driver and its three test files were
  removed; new tests cover the origin guard, limits, late steering, restart presence, the feed watchdog, heard-time
  audio, hair and complexion parsing, working-copy sizing and the new UI behaviour).
- e2e: 26 pass (23 in the chromium project, 3 in the voice project), plus the opt-in screenshot run. New: the origin
  guard through the real proxy and workerd, a steer during the write-up, Stop's acknowledgement, and More on phones.
- `pnpm typecheck` and `pnpm build` are clean.

## 5. Screenshots

`docs/dev/screens/inc0/`, each in `desktop-light`, `desktop-dark`, `mobile-light` and `mobile-dark` (1440×900 and
375×812 at 2×):

- `welcome-*`: pick your Chief of Staff
- `talk-working-*`: a background job running after delegate, status and steer ("Available · 1 job running")
- `talk-done-*`: the completion announcement with its write-up open
- `floor-*`: the Directory
- `profile-*`: a coworker profile
- `projects-*`: Everyday with the finished job open
- `inbox-*`: the calm empty Inbox

## 6. Known gaps

**Providers**
- **Not run against real cloud APIs.** No provider keys were used while building Inc 0. The cloud chat, TTS, STT and
  image adapters are tested with scripted HTTP only. Unverified shapes to check first: xAI REST TTS timestamps (if
  the shape differs, lip sync falls back to text timing and the audio still plays) and the Gemini model aliases.
- **Ollama is slow for talk.** The Chief of Staff's prompt is about 3.9k tokens, and a 32B model takes 10–16 s to the
  first token. Job steps and talk turns share Ollama's single slot, so a reply can wait behind a job step (a steer
  reply took 25 s). Setting `OLLAMA_NUM_PARALLEL=2` for the Ollama server helps. The D2 targets (text in under 1 s)
  hold on Mock and are expected on cloud providers, not on a local 32B model.
- **Unverified model features.** OpenAI reasoning summaries may need organisation verification. Anthropic thinking
  blocks and Gemini signatures are cached per isolate. There is no Workers AI adapter, and `vision` is a flag only.
- **Costs.** Cloud usage reports `usd: null`, because there is no verified rates table yet.

**Jobs and Talk**
- **Jobs work from model knowledge only.** There are no web or search tools yet, and the prompts forbid claiming
  browsing. Mock write-ups are labelled placeholders.
- **Simplified job runtime.** Jobs run in the Everyday ProjectDO alarm, with a simplified lease (a 120 s keep-alive,
  a per-job fence and 3 attempts). Each job's frames and announcement now go out as soon as its checkpoint ends, but
  alarms do not overlap: with several jobs due at once, the next checkpoint of every job (and the first of a job
  started meanwhile) waits for the slowest one in flight (up to its 5-minute budget). One RunDO per job fixes this
  (planned).
- **No cold replay.** The hot window keeps 50k rows per stream, and nothing older can be replayed from D1. The web
  pages the replay and also merges `GET /api/jobs`.
- **Templated announcements.** Announcement copy (done, failed, stopped) is fixed, not written in the lead's voice.
- **Stop has no undo.** Stop is set apart from Steer and acknowledged in the thread, but a stopped job cannot be
  resumed; ask again to start it anew.
- **Spending limits are coarse.** They count calls per UTC day (TTS and STT in D1, turns and jobs in the Durable
  Objects), not tokens or dollars, and there is no per-minute rate limit.
- **Server turns are not cancelled from the web.** A newer message cuts a streaming reply; Esc or a tap only stops
  the audio.

**Voice**
- **Not heard by a person.** e2e used Chromium's fake mic and Mock silent audio with timing: the pipeline, the
  speaking state, the mouth sampler and barge-in are verified, but a real microphone, sound quality, provider voices
  and Safari's mp4 recording are not.
- **Barge-in stops at once.** It does not duck first as EXPERIENCE §5.3 describes. There is also no hands-free voice
  activity detection, no AudioWorklet uplink, no per-voice loudness normalisation and no earcons.
- **No TTS cache.** Voice samples are synthesised again each time they play.

**Portraits**
- **Provider image URLs.** Only public `https:` URLs are fetched (loopback, private and link-local literals are
  refused, redirects are checked hop by hop, bodies stop at 5 MB). A public name that resolves to a private address
  is not caught: Workers cannot resolve DNS first.
- **Full-size images only.** There are no `.tile.webp`/`.token.webp` variants, so the Floor decodes full-size
  portraits once they exist.
- **Background generation relies on `waitUntil`.** That is fine locally, but capped in production; the CLI uses
  `?wait=1`.

**UI and tooling**
- **Not built in Inc 0:** dropping a file on the bubble, the H and ? shortcuts, hands-free mode, the Everyone stop
  control and the usage readout. The Inbox has no raised hands yet.
- **The phone bubble floats over content.** On profiles it covers part of the text. On Talk it is hidden at every
  width, and the header face takes its gestures.
- **No contextual "How's it going?" chip.** The starters show delegation, but no chip offers a status question while
  a job runs.
- **One package does not pin TypeScript.** `packages/expressions` (Inc 0.5, built in parallel) still resolves `tsc`
  from the PATH. Add `"typescript": "^7.0.2"` to its devDependencies.
- **Lip sync lives in one place.** The unused fusion driver copy in `packages/avatar` (and its tests for the PG
  "dropped first delta" and "early drain" fixes) was removed; `packages/audio` is the only lip-sync implementation, and
  both packages draw from one viseme table in `@headcount/protocol`.

## 7. Integration changes (for reviewers)

**Review round 2 (security, directives, avatar and audio)**
- Worker: an origin guard on every route and the feed socket (`lib/origin.ts`, `ALLOWED_ORIGINS` from `dev.mjs`),
  Host checks against DNS rebinding, and the exact JSON content type. Malformed `%`-escapes answer a JSON 404, and
  matching and the body cap run inside the router's error handling. New error code `forbidden` (403).
- Limits: `TTS_DAILY_LIMIT`, `STT_DAILY_LIMIT`, `CHAT_DAILY_LIMIT`, `JOB_DAILY_LIMIT`, `MAX_ACTIVE_JOBS`
  (`lib/limits.ts`). Provider image URLs must be public `https:`, with checked redirects and a 5 MB streamed cap.
- Jobs: steering during the write-up is applied and the write-up redone. Frames are mirrored per checkpoint, the
  announcement is written in the same transaction as the mirrored `job.done`/`job.failed`/`job.cancelled {by:'owner'}`,
  and a restarted WorkspaceDO clears a stale Thinking claim. The Chief of Staff no longer claims "working" for
  background jobs: available while working (D2).
- Web: a Talk count and bubble badge with one pulse for news off Talk; the screen-reader announcer moved to the
  shell; announcements are their own named, timed messages. Renamed leads greet by the chosen name, and Choose shows
  the typed name. Phones get a More tab (palette), a pinned Choose footer, a scroll to the matches after the quiz, and
  job detail as a bottom sheet. The dock no longer covers new messages. One progress percent is shared with the
  spoken status. Activity lists a finished job only until its outcome is in the thread, and any finished row can be
  dismissed. Stop is set apart from Steer. Profile ("Ask … about …") and Projects ("Delegate something") have a
  primary action, and the first starter is a delegation. Space held in the empty composer talks, and so does Space
  held on the face or bubble. The composer shows a focus ring, instruction text meets 4.5:1 contrast, and the bubble
  is hidden on Talk at every width, with the push-to-talk caption above the dock. Thinking and background work have
  distinct rings. The Talk face is round, the keyless quiz intro drops its voice promise, the "Read story" target is
  44 px, and the feed watchdog replaces half-open sockets.
- Avatar and audio: `speaking` and the mouth follow heard time at the end too (output latency), and the analyser is
  delayed to match. A silent tap no longer holds the mouth shut. Browser-voice sentences are capped at 60 tokens, and
  the text rhythm stops 1.5 s past its estimate. "Longer on top" cuts are no longer long hair, and vitiligo and beauty
  marks sit where the catalog says. Motion is seeded per person, and the portrait working copy is sized to the
  display. Heroes no longer spend the tiles' budget. Landmarks are checked against the image version. The duplicate
  lip-sync driver is gone: one viseme table lives in `@headcount/protocol` (`VISEME_PARAMS`).

**Contracts and routes**
- New routes `GET /api/jobs`, `GET /api/jobs/:id` and `GET /api/portraits`. The web now hydrates jobs from the first
  and asks the portrait list once instead of probing every face.
- New error code `rate_limited` (429). STT is capped at 10 MB, and missing-provider messages use plain words.
- `WsClientMessage` (ping and resume). CONTRACTS.md now reflects every builder's changes.

**Worker**
- Mock speech is opt-in (`MOCK_MEDIA`, `--mock-media`), so keyless TTS/STT answer 503 naming the keys.
- Jobs run on the `reason` tier with a 5-minute budget per checkpoint. A deadline counts as a failed attempt instead
  of silently retrying forever. Talk and jobs require tool support.

**Web fixes**
- Replay paging, holding live frames until the gap is filled.
- Replayed `workspace.updated` frames no longer send the app back to onboarding.
- The Talk header ellipsizes long job sentences. Before, the phone page was 843 px wide and the bottom tabs were off
  screen.
- The face accessible label no longer repeats the name.
- Landmarks are saved with the portrait version.

**Tooling**
- Each package pins TypeScript 7.
- `dev.mjs` has the `--local` and `--mock-media` flags, and each Vite port has its own cache.
- Playwright runs the voice project with a fake mic.
