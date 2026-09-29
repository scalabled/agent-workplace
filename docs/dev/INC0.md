# Increment 0 · First Light

You pick a Chief of Staff from the 12 catalog leads, name them and talk: text or push-to-talk, with spoken replies
and a face whose mouth follows the audio actually playing. You can interrupt at any time. You can hand them a
background job ("look into X"). While it runs you keep talking: "how's it going?" is answered from live job state,
"also check Y" steers the job at its next checkpoint, and they tell you when it is done. The Floor lists the
catalog's 164 coworkers with profiles.

**Inc 0.6** (§4a) adds a public landing page at `/` (the app moved to `/app`), a dark theme by default everywhere,
and a re-cast of all 176 people (12 leads, 164 coworkers) as modern knowledge workers, with one shared "staff photo
shoot" art direction and a new generated portrait for each of them. It also fixes background jobs that failed with
"The model returned an empty step." on reasoning models.

Everything runs without keys, on the Mock provider or your local Ollama. Adding a key upgrades one capability at a
time; a capability without a provider is hidden, never shown broken.

Contracts: [CONTRACTS.md](CONTRACTS.md). Plan: [../MVP-PLAN.md](../MVP-PLAN.md) (Inc 0). Cast art direction:
[../../catalog/ART-DIRECTION.md](../../catalog/ART-DIRECTION.md).

---

## 1. Run it

```sh
pnpm install          # also builds the catalog bundle
pnpm dev              # worker :8787 + web :5173, uses apps/worker/.dev.vars → open http://localhost:5173
```

`http://localhost:5173/` is the landing page; **Enter the office** opens the app at `/app` (onboarding the first
time, Talk after). Old app addresses (`/talk`, `/welcome`, `/floor`, `/desk/…/profile`, …) redirect to `/app/…`.

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
pnpm e2e:screens      # regenerates docs/dev/screens/inc0.6/*.png on the keyless Mock stack (illustrated faces)
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

### Pre-generate the portraits

With `pnpm dev` running and `XAI_API_KEY` or `OPENAI_API_KEY` set:

```sh
pnpm portraits:generate              # the 12 leads, 3 at a time, [i/n] progress; skips existing portraits
pnpm portraits:generate --dry-run    # what it would do
pnpm portraits:generate --all        # every lead and coworker (176 images; mind the cost)
pnpm portraits:generate --all --force --concurrency 4   # repaint everyone (after a re-cast)
pnpm portraits:generate --only lead-warm-mentor --force   # repaint one
node scripts/landmarks-precompute.mjs   # measure face landmarks for every portrait that has none
```

- Portraits are stored in local R2 at `portraits/<id>.<ext>`, with a row in D1. Prompts follow
  `catalog/ART-DIRECTION.md`: charcoal seamless backdrop, a rim light in the person's accent colour, an even key light.
- `--force` stores a new version and clears its landmarks. `scripts/landmarks-precompute.mjs` then measures them in
  headless Chromium through the dev page `apps/web/public/dev/landmarks.html` (the app's own `@headcount/avatar`
  MediaPipe code, via Vite), so faces warp and lip-sync from their first appearance. Without it, landmarks are
  detected in the browser the first time a portrait shows, then saved. Options: `--only`, `--force`,
  `--delegate CPU|GPU`, `--dry-run`, `--headed`, `--web <url>`.
- Faces switch from the illustration to the portrait on their own. The landing page asks for
  `/api/portraits/:id?v=<version>`, which the worker marks immutable, so each image downloads once per version; the
  app still revalidates the unversioned URL (ETag, 304).
- `PORTRAIT_DAILY_LIMIT` (default 200 per UTC day) caps paid generations, shared with marketing images; the script
  stops at the limit (in-flight requests finish).
- In the app, a quiet "Generate portrait" link appears on the onboarding stage once an image provider exists.

### Landing page images

```sh
node scripts/marketing-images.mjs --list       # the seven images and their art direction
node scripts/marketing-images.mjs              # generate the missing ones through the running worker
node scripts/marketing-images.mjs --only hero --force --note "warmer light"   # redo one
```

- The script calls `POST /api/media/image` on the running worker (the keys stay in the worker), then writes
  `apps/web/public/marketing/<key>.webp` (≤ 400 KB) with a `.jpg` fallback and `manifest.json` (alt text, size,
  provider, model). It needs `ffmpeg` and `cwebp` on the PATH. `--reprocess` re-optimises the stored R2 originals
  without generating; `--provider openai|xai`, `--concurrency`, `--dry-run`.
- Art direction for every image: dark, premium, no text, no logos, no real brands, no recognisable real people.
- Seven images are in the repo: `hero` and `meeting` (xAI grok-imagine), `floor`, `voice`, `context`, `trust` and
  `providers` (OpenAI gpt-image). The page uses three: `hero` (a dark backdrop behind the real cast), `floor` (the
  full-bleed living-workforce band) and `voice` (beside the Talk illustration). `context`, `trust`, `providers` and
  `meeting` are spare: the Trust section draws an approval card around a real coworker's face instead. The landing
  reads the manifest at build time; without it the page falls back to gradients.
- Each image ships as a WebP (quality 74, always lighter than its JPEG) plus 640/1024/1600 px WebP widths for
  `srcset`, so phones never download the desktop file. `--reprocess` re-encodes from the stored originals.

### Landing voice samples

```sh
node scripts/voice-samples.mjs            # pre-voice every lead's sample through the running worker (TTS)
node scripts/voice-samples.mjs --only lead-warm-mentor --force
```

- Each lead says "Hi, I'm {first}." plus the match quiz's preview line in their own voice. The audio and its
  lip-sync timing live in `apps/web/public/marketing/voices/` (12 leads, 24 files, about 1.5 MB, fetched only on ▶).
  "Hear …" on the landing plays these: it works keyless and never spends the TTS budget. A lead without a sample
  falls back to the TTS route when a speech provider exists; with neither the control is absent.

## 3. Demo script (about 5 minutes)

1. `pnpm dev --mock` (instant), or `pnpm dev --local` (real answers from Ollama, slower), or `pnpm dev` with keys.
   Open http://localhost:5173: the landing page. Scroll it (the real cast in the hero, the coworker wall, the twelve
   Chiefs of Staff with **Hear …** (pre-voiced, keyless too), how it works, every capability marked Works today, In
   the works or Planned, pricing marked as planned), then press **Enter the office**.
2. **Pick your Chief of Staff.** Browse the twelve (Eddie, Joy, Kate, Ben, Victor, Sasha, Zack, Hope, Owen,
   Irma, Frankie, Anna) and click a few cards; each has a face, a backstory teaser, "best for owners who…" and an
   honesty line. With a TTS key, press "Hear …'s voice". Press **Find your match · 8
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
    Staff, theme); on phones it is the fifth tab, **More**. Dark is the default whatever the OS prefers; ⌘K →
    **Use light theme** (or **Match system theme**) switches and is remembered in this browser, while the landing
    page stays dark. The layout also works at phone width, where onboarding pins the name and **Choose** to the
    bottom of the screen.

## 4. What works (verified)

| Area | Status |
|---|---|
| Landing | `/`: a kinetic hero with the real cast (six portraits with the app's state rings, labelled Illustration, one Demo side-talk line) over a darkened generated office, a statement band, the coworker wall (curated: younger half first, at most one 45+ per row), how it works, the twelve Chiefs of Staff with pre-voiced samples, the living workforce as a full-bleed band, talk while they work, multimodal with a plain compatibility list of providers, trust with an illustrated approval card, industry packs in one row, planned pricing with a call to action, FAQ. Every capability carries a status chip (Works today, In the works, Planned). No testimonials, logos, customer counts or metrics. Self-hosted Inter and Source Serif 4. A phone menu, one call to action at a time on phones, the call to action above the fold at 1366×768 and 1280×720, `/#section` links, and Back returns to where you were. It never loads the app, socket, audio engine or catalog until someone walks in. |
| Onboarding | 12 leads with portraits (illustrated faces when none exist), story teaser, fit, honesty line. The catalog match quiz (8 questions) gives a top 3 with reasons. The name is saved, and the choice can be switched later with ⌘K → Switch Chief of Staff. |
| Talk | `POST /api/talk` → 202 in about 8 ms. Streaming `talk.delta`, then `talk.message` and `talk.done`. The system prompt is layered from the lead's catalog personality, communication, backstory and origin moments, plus a live work-state block. Failed sends stay in the thread with Retry. |
| Background jobs | These run in the Everyday ProjectDO on alarms: plan → 2–4 steps → write-up. Status is answered from state while the job runs (Mock: 312 ms, job at step 2/5). Steering goes queued → applied at the next checkpoint; a steer sent while the write-up is being written is applied and the write-up is redone, never dropped. The completion announcement and deliverable arrive in Talk and Projects, and Stop cancels a job (acknowledged in the thread). Each job's frames are mirrored as soon as its checkpoint ends. Jobs survive a worker restart. |
| Feed | One socket per client: `?since` replay, then paging with `{op:'resume'}` past 500 frames, holding live frames until the gap is filled. Seqs are gap-free, and a reload rebuilds the thread and jobs. Replayed frames are never spoken, and replayed settings never roll the app back. A socket that goes silent after a ping (sleep, Wi-Fi change) is dropped and resumed within 10 s. Only the app's own origin can open it. |
| Voice | One AudioContext, TTS per sentence, and a `speaking` state driven by audio actually playing, in heard time (output latency included at both ends; the analyser is delayed to match). The mouth follows provider alignment when it exists, else the chunk text timed over the clip; a silent tap never holds it shut. Barge-in stops speech in under 1 s. Push-to-talk records the mic and sends through STT, or browser dictation keyless; Space held in the empty composer talks too. |
| Faces | All 176 people have a generated portrait in the shared art direction, with landmarks precomputed. Photoreal strip-warp portraits (ported from personagram-ai) when a portrait exists, with a working copy sized to the display; illustrated faces from the catalog `appearance` otherwise (hair length, vitiligo and beauty marks follow the catalog's words and sides). Blink, sway, state poses and lip sync, seeded per person; one shared scheduler; reduced motion keeps lip sync. |
| Floor | 164 coworkers in 18 departments, with search by name, role or skill, a department filter and profiles. |
| Providers | Mock, Ollama, OpenAI, Anthropic, xAI, Gemini and OpenAI-compatible, with retries, deadlines, failover (never local → cloud, never to Mock) and key redaction. |
| Keyless | TTS, STT and portraits are hidden in the UI, and their routes answer 503 naming `OPENAI_API_KEY` / `XAI_API_KEY`. |

**Run on real workerd** (`wrangler dev`, HTTP + WebSocket, script in the integrator's scratchpad):

- **Anthropic, keyed (Inc 0.6):** the whole flow passed through the web app on `pnpm dev` with the owner's keys.
  The greeting turn took about 3.8 s end to end. "Look into coffee suppliers in Portland" started a 6-step job; the
  status reply came from live state ("Still on step 2 of 6, 17% …"); the fair-trade steer was queued and applied 8 s
  later; the job finished in 1 min 40 s with a sourced-as-unverified write-up. There was no empty step and no
  thinking-budget retry. The announcement arrived in the lead's own voice ("Done. Atlas Coffee in Seattle comes out
  as the best primary supplier …"), within the 2.5 s budget.
- **Mock:** the whole flow passed. First delta 27 ms, status reply 312 ms mid-job, steer applied about 2 s later,
  job done in about 14 s, 28 frames gap-free, `?since` replay exact.
- **Ollama qwen3:32b (`--local`):** the whole flow passed. Tool calls for delegate and steer; the status was answered
  from the prompt's live work state while the job ran; a real write-up in about 2 minutes; 34 frames gap-free, replay
  exact. Replies took 10–16 s to the first token (see known gaps).

**Automated checks:**

- Unit (Inc 0.6 review round): 687 tests across 62 files pass (including the living-workforce packages built in
  parallel). New since the round before: the landing's honesty (every capability has a status and only built ones say
  "Works today", no "pause", US spelling), casting (younger first, at most one 45+ per row, varied rim light, no
  lead on the wall), night accents (OKLCH lightness and hue), `srcset`, voice sample text, the landing theme pinned
  before the first render, scroll memory for Back, Ask again on a failed job, the write-up label, call budgets for
  unknown cloud models, failover re-sizing (cloud → Ollama gets no thinking; a reasoning fallback gets its room),
  Gemini thinking budgets and never pinning bytes of another portrait version.
- e2e (Inc 0.6 review round): 35 pass (31 in the chromium project, 4 in the voice project), plus the opt-in
  screenshot run. New: `/#pricing` scrolls there and Back from the app returns to it, no light flash for an owner who
  chose light, the call to action above the fold at 1366×768 and 1280×720, the hero's real faces, statuses on unbuilt
  features, and at 375 px faces above the headline, one call to action at a time and a working menu. The voice
  project plays a pre-voiced sample from its static files.
- `pnpm typecheck` and `pnpm build` are clean. The build splits a tiny entry (router, theme; 10.8 kB gzip), the
  landing (33 kB JS + 8 kB CSS gzip), the app (53 kB) and the slim catalog (228 kB, app only). Fonts: about 125 kB
  of WOFF2 for Latin text (Inter regular is preloaded; italics, Latin Extended and the serif load only when used).
- **Keyed re-run (review round, Anthropic):** "Look into reusable cup programs for cafés in Portland" ran all 6 steps,
  the status reply came from live state ("Still at step 2 of 6, 17% …"), the compostable-lids steer was applied, and
  the job finished with no empty step and no thinking-budget retry in the worker log.

## 4a. Inc 0.6: dark theme, landing page, new cast, job fix

**Routes.** `/` is the public landing page and the app lives under `/app`: `/app` (→ onboarding until a Chief of
Staff is chosen, else Talk), `/app/welcome`, `/app/talk`, `/app/floor`, `/app/desk/:personaId/profile`,
`/app/projects`, `/app/inbox`. Pre-landing paths (`/talk`, `/welcome`, `/floor`, `/projects`, `/inbox`,
`/desk/:id/profile`) are replaced by their `/app/…` form, keeping the query and hash. `main.tsx` is a small shell
(router, theme, tokens) that lazy-loads either the landing or the app; hovering or focusing a call to action warms
the app chunk.

**Dark by default (D3).** `index.html` sets `data-theme` before first paint: dark unless this browser chose light
(or "Match system") in ⌘K; the landing is always dark (`forceTheme('dark')`). `<html data-theme>` is always
explicit, so the CSS and the face renderer agree, and `theme-color` follows. Tokens (`styles/tokens.css`): rich
blacks (`--surface #0a0b0d`, layered panels), hairline borders, luminous per-agent accents with a calm glow and a
brand spectrum for the landing; light keeps the Inc 0 "day" palette with a slightly darker `--muted`. 55 catalog accents that were too dark for the
dark panels were lifted to at least 3:1 on `#1A1D22` (same hue; `catalog/renames.json` keeps the old values).

**Landing page** (`apps/web/src/landing/`). Copy lives in `content.ts`; names and faces come from the catalog at
build time through the `virtual:headcount-landing` Vite plugin (`apps/web/landing-data.ts`: the 12 leads and three
coworkers per department, about 20 kB), portraits from `GET /api/portraits` with versioned, immutable image URLs.
Generated images come from `public/marketing/manifest.json` (§2). Motion: kinetic tagline, scroll reveals, idle
faces with blinks and sway, side-talk bubbles tagged **Demo** (one at a time, on the speaker's own portrait);
reduced motion shows everything at once. "Hear …" plays each lead's pre-voiced sample (§2), or the TTS route when a lead has none and a speech
provider exists. Honesty rules: no testimonials, logos, customer counts or metrics; not-yet-built capabilities are
marked Planned; pricing is marked planned (PRODUCT §10).

**New cast (D3).** All 176 people were re-cast as modern knowledge workers (`catalog/renames.json`,
`catalog/ART-DIRECTION.md`, catalog v2.0.0): new contemporary names and handles that fit each person's heritage,
ages 24–54, new looks, same pronouns and heritages. First names are unique and never equal a voice id or a story
name (`taxonomy.reserved_first_names`: Dana, Luis, Priya, Morgan, Rosa, …), which `catalog/scripts/validate.mjs`
checks. The twelve leads: Eddie Ramos, Joy Lema, Kate Kim, Ben Addo, Victor Rios, Sasha Sarkis, Zack
Vang, Hope Girma, Owen Price, Irma Vega, Frankie Flores and Anna Kask. (The leads were renamed a second time after
2.0.0 because the owner found the first names hard to remember; faces, voices and lore stayed, and `renames.json`
keeps the 2.0.0 names as `interim_name`.) Every portrait was regenerated in one "staff photo shoot" look (charcoal
seamless, accent rim light, even key light, 85 mm, 3:4), and landmarks were precomputed. Contact sheets:
`docs/dev/screens/cast/` (`leads.jpg` still captions the 2.0.0 names).

**Media scripts.** `POST /api/media/image` and `GET /api/media/:key` (worker, media-owned, outside the protocol route
table), `scripts/marketing-images.mjs`, `scripts/landmarks-precompute.mjs` and `pnpm portraits:generate
--concurrency` (§2).

**Job fix: "The model returned an empty step."** On reasoning models the thinking counts against `max_tokens`, so a
1200-token work step at the provider's default effort could be all thinking and no text (the forced-tool planner
worked because forced tool use turns thinking off). Now:
- Every call is sized by `callBudget(provider, model, output, effort)` (`@headcount/agent-loop`): the visible
  output (plan 1000, work step 1500, write-up 4000, talk 900 tokens) plus room to think at an explicit effort (low
  4000, medium 8000, high 16000), for cloud models the catalog marks as reasoning. Local and Mock get the output
  only, so Ollama never starts thinking.
- `runTurn` sends a call that ended `length` with no text and no tool call once more, with twice the budget and one
  notch less effort, and emits a `retry` event (the job logs it).
- A work step that already recorded findings is never failed; its findings are its notes.
- Anthropic: `reasoningEffort: 'none'` sends `thinking: {type: 'disabled'}` on models that think by default, and the
  lowest effort on models that cannot turn thinking off.

**Announcements.** The failure announcement no longer says its first sentence twice: the job's failure message is
the reason only, and the template names the job once. Done, failed and stopped announcements are now phrased in the
chosen lead's voice by the fast model, grounded only in the job's result (every number must appear in the facts),
within 2.5 s, else the template. A pending row written with the mirrored frame guarantees one announcement even if
the object restarts meanwhile. Local and Mock use the template.

## 4b. Inc 0.6 review round (design and correctness)

**Landing.** Every capability carries a status chip (INC0 §4 decides what may say "Works today"): the living
workforce is In the works or Planned, approvals, receipts, Everyone stop and the industry packs are Planned, the
Talk points no longer offer "pause", and Voice is "your Chief of Staff's own voice". The hero is built from the real
cast (six portraits with the app's rings, captions and one Demo side-talk line under the faces; a strip of five above
the headline on phones) over the office image as a darker backdrop. The headline is two lines, sized by width and
height, so the call to action stays above the fold on laptops; its accessible name is the whole sentence. New
rhythm: a centred statement band, a full-bleed living-workforce band, Models folded into Multimodal as a plain
compatibility list, packs in one row, and a call to action under pricing with an honest "Built for small teams" label.
The carousel shows exactly three leads on wide screens and a faded peek below that; split sections keep their media
sticky beside long text. Wall tiles carry no hover affordance, show job titles only and clamp to two lines. Phones get
a menu sheet, a 92% opaque nav, compact how-it-works and multimodal rows, and a two-column provider list. US spelling
throughout.

**Cast.** Eddie Ramos (vitiligo, grey temples), Nayra Choque (wheelchair backrest) and Amara Okafor, Esi Mensah and
Jonas Brandt (apparent age) were repainted with the signature detail right after the prompt prefix and the age said
outright, then their landmarks were measured again (`docs/dev/screens/cast/repainted-before-after.jpg`). ART-DIRECTION
§8 now has a per-portrait approval checklist. The landing leads with the younger half of the cast (`landing/cast.ts`).

**App.** Self-hosted fonts; night accents (each agent's hue at OKLCH lightness about 0.76) for rings, glows and labels
on dark; the Talk header face wears the lamp's working arc while a job runs, and the status dot is filled (proof,
lamp or hand); the phone bubble is 56 px and tucks away while you scroll down; the phone tab bar is 97% opaque;
Projects is one surface with hairline rows, the status under the title on phones, a three-line summary, **Ask again**
on failed or stopped jobs and "The write-up" instead of a repeated title; palette group labels use `--muted`.

**Worker and models.** A cloud model the catalog does not know (an OpenAI-compatible gateway) gets its output budget
only, never output + 8000. A failover re-sizes the call for the candidate that serves it (`ChatRequest.budget`), so
Ollama behind a failed cloud chain never starts thinking. Gemini maps the explicit effort to `thinkingBudget` (0 on
Flash for 'none'). A `?v=` portrait is cached for good only when the stored bytes carry that version.

**Web shell.** The landing's dark theme is pinned before the first render (no light flash for owners who chose light),
`/#pricing` scrolls to its section once the lazy page exists, the first render keeps the browser's own scroll, and
Back from the app returns to where you were on the landing.

## 5. Screenshots

**Inc 0.6** — `docs/dev/screens/inc0.6/`, recaptured after the review round on the keyed stack (`pnpm dev`, Anthropic
chat, real portraits, the five repainted faces; the screens spec with keyed waits, delegating "reusable cup programs
for cafés in Portland" because the Chief of Staff remembered the coffee job) at 1440×900 (`-desktop`) and 375×812
(`-mobile`), 2×, dark by default with the OS asking for light. The thread and Projects also show earlier keyed runs
(the coffee job and a job that failed before the empty-step fix):

- `landing-hero-*`, `landing-full-*` (the whole page), `landing-wall-*` (the cast wall with a side-talk bubble)
- `welcome-*`: first run, pick your Chief of Staff
- `talk-working-*`: a real Anthropic job running after delegate, status and steer
- `talk-done-*`: the voiced announcement with its write-up open (`talk-done-desktop-light`: the light option)
- `floor-*` (and `floor-desktop-light`), `profile-*`, `projects-*`, `inbox-*`

`pnpm e2e:screens` writes the same file names from the keyless Mock stack (illustrated faces, Mock copy).
`docs/dev/screens/cast/` has contact sheets of all 176 portraits (taken before the review round; the five repainted
faces are in `repainted-before-after.jpg`).

**Inc 0** — `docs/dev/screens/inc0/`, each in `desktop-light`, `desktop-dark`, `mobile-light` and `mobile-dark`
(1440×900 and 375×812 at 2×), with the Inc 0 names and illustrated faces:

- `welcome-*`: pick your Chief of Staff
- `talk-working-*`: a background job running after delegate, status and steer ("Available · 1 job running")
- `talk-done-*`: the completion announcement with its write-up open
- `floor-*`: the Directory
- `profile-*`: a coworker profile
- `projects-*`: Everyday with the finished job open
- `inbox-*`: the calm empty Inbox

## 6. Known gaps

**Providers**
- **Partly run against real cloud APIs.** Inc 0.6 ran the full talk-and-job flow on Anthropic (keyed, §4) and
  generated all 176 portraits and the seven landing images through the real image providers (xAI and OpenAI).
  Not re-verified by the integrator in this round: OpenAI and xAI as the chat provider for jobs, provider TTS and
  STT heard by a person, xAI REST TTS timestamps (if the shape differs, lip sync falls back to text timing and the
  audio still plays) and the Gemini model aliases.
- **Ollama is slow for talk.** The Chief of Staff's prompt is about 3.9k tokens, and a 32B model takes 10–16 s to the
  first token. Job steps and talk turns share Ollama's single slot, so a reply can wait behind a job step (a steer
  reply took 25 s). Setting `OLLAMA_NUM_PARALLEL=2` for the Ollama server helps. The D2 targets (text in under 1 s)
  hold on Mock and are expected on cloud providers, not on a local 32B model.
- **Unverified model features.** OpenAI reasoning summaries may need organisation verification. Anthropic thinking
  blocks and Gemini signatures are cached per isolate. Gemini `thinkingBudget` (0 on Flash, 128 on Pro, graded
  budgets) is unit-tested but not run live (no Gemini key here); Gemini 3 models prefer `thinkingLevel`. There is no
  Workers AI adapter, and `vision` is a flag only.
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
- **Voiced announcements are cloud-only.** Local and Mock always use the template, and a slow fast model (over
  2.5 s) falls back to it too.
- **Failed jobs from before the fix keep their old message.** Their stored failure text still reads "I could not
  finish … because the model kept failing", which the template no longer doubles.
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
- **No TTS cache in the app.** Onboarding's voice samples and replies are synthesised each time; only the landing's
  samples are pre-voiced.

**Portraits**
- **Provider image URLs.** Only public `https:` URLs are fetched (loopback, private and link-local literals are
  refused, redirects are checked hop by hop, bodies stop at 5 MB). A public name that resolves to a private address
  is not caught: Workers cannot resolve DNS first.
- **Full-size images only.** There are no `.tile.webp`/`.token.webp` variants, so the Floor decodes full-size
  portraits once they exist.
- **Background generation relies on `waitUntil`.** That is fine locally, but capped in production; the CLI uses
  `?wait=1`.

**Landing page**
- **Pre-voiced samples must be refreshed by hand.** They are static files made by `scripts/voice-samples.mjs`; a
  renamed lead, a new voice or a new preview line needs `--force`. A lead without a sample still falls back to the TTS
  route (limited only by `TTS_DAILY_LIMIT`).
- **The hero image is 1280 px wide.** The image providers stop at about 1536 px, so it is used as a darkened
  backdrop behind the faces (upscaling no longer shows). Regenerate it at 2560 px when a provider allows.
- **No "delighted" expression yet.** The review asked for the approved closed-lip "delighted" variant on marketing
  surfaces; expression variants are not generated or stored anywhere yet (it needs an image-edit route and landmarks
  per variant). The landing uses the resting portraits, curated to lead with the younger half of the cast.
- **The default and featured lead is an owner call.** Eddie (45–49) is still first in the carousel and the default
  selection in onboarding; the hero opens on the first lead under 40 instead.
- **Page length.** About 12,000 px at 1440 and 14,800 px at 375: sections were merged and phone layouts compacted, but
  a statement band and a full-bleed band were added. Cutting further (for example FAQ into the final call to action)
  is a copy decision.
- **A dev page ships in the build.** `apps/web/public/dev/landmarks.html` (the landmark precompute tool) is copied
  into `dist/`. It only works with the Vite dev server, but it should be excluded from production builds.
- **The phone bubble covers part of the speaker.** On a 375 px wall a three-line side-talk bubble covers the lower
  half of that portrait for about four seconds.

**Cast**
- **Portrait side conventions.** Eddie's vitiligo now shows clearly, on the viewer's left (the catalog says "left
  temple"); the illustrated face follows the catalog's side. Other signature details were not re-audited beyond the
  five repainted faces.
- **Old names remain in files owned by the living-workforce process:** `packages/expressions/**`,
  `catalog/expressions/**` and `docs/LIVING-WORKFORCE.md` still use the Inc 0 names (their tests pass). Story names in
  PRODUCT, EXPERIENCE and ARCHITECTURE are left as they are and are now reserved.
- **Wording to settle:** the shared "concerned" expression and about 80 records say "lips pressed softly closed" (two
  leads also say "jaw set"), while ART-DIRECTION §5 says expressions change only brows, eyes and cheeks.

**UI and tooling**
- **Not built in Inc 0:** dropping a file on the bubble, the H and ? shortcuts, hands-free mode, the Everyone stop
  control and the usage readout. The Inbox has no raised hands yet.
- **The phone bubble still floats.** It is 56 px and tucks away while you scroll down, but at rest it can sit on the
  last lines of a short page. On Talk it is hidden at every width, and the header face takes its gestures.
- **Floor cards show no state.** Faces there are the directory's catalog people; rings belong to hired coworkers, and
  nobody is hired in Inc 0.
- **No contextual "How's it going?" chip.** The starters show delegation, but no chip offers a status question while
  a job runs.
- **One package does not pin TypeScript.** `packages/expressions` (Inc 0.5, built in parallel) still resolves `tsc`
  from the PATH. Add `"typescript": "^7.0.2"` to its devDependencies.
- **Lip sync lives in one place.** The unused fusion driver copy in `packages/avatar` (and its tests for the PG
  "dropped first delta" and "early drain" fixes) was removed; `packages/audio` is the only lip-sync implementation, and
  both packages draw from one viseme table in `@headcount/protocol`.

## 7. Integration changes (for reviewers)

**Inc 0.6 review round (design and correctness fixes, §4b)**
- Landing: `content.ts` statuses, `Hero.tsx` real cast, `cast.ts`, `PortraitWall.tsx` (coworkers only, curated),
  `Landing.tsx` (statement and band sections, merged models, approval illustration, packs row, pricing CTA, menu,
  hash scroll), `LeadCarousel.tsx` and `voice.ts` (pre-voiced samples), `Picture.tsx` (`srcset`), `landing.css`.
- Shared: `styles/fonts.css` and `public/fonts/` (OFL), `lib/accent.ts`, `lib/theme.ts` (`resolvedTheme`,
  `forcedThemeFor`, `initTheme(pinned)`), `router.ts` (`lastNav`, `savedScroll`), `main.tsx`.
- App: Talk header ring and dots, `ChiefBubble` tuck, tab bar opacity, Projects rows and Ask again, palette labels.
- Models: `packages/models/src/budget.ts` (`callBudget`, `resizeRequest`, moved from agent-loop and re-exported),
  `ChatRequest.budget`, `wrapChat` re-sizing, Gemini `geminiThinking`. Worker: portrait `immutable` only for stamped
  bytes.
- Scripts: `marketing-images.mjs` (srcset widths, lighter WebP), new `voice-samples.mjs`. Catalog: five portrait
  prompts, Amara's hair wording, ART-DIRECTION §8 checklist.

**Inc 0.6 round (dark theme, landing, cast, media, job fix)**
- Stages integrated: the re-cast (`catalog/**`, `renames.json`, `ART-DIRECTION.md`, validator, catalog v2.0.0 and every
  test and doc that named people), media (`/api/media/*`, marketing images, portrait concurrency, landmark
  precompute, versioned immutable portrait URLs), portraits (all 176 regenerated with landmarks), the landing page and
  dark theme (`apps/web`: `/` vs `/app`, lazy halves, `lib/theme.ts`, tokens), and the job fix (`callBudget`, the
  thinking-only retry, Anthropic `thinking: disabled`, voiced announcements, no doubled failure sentence).
- Integrator fixes from the keyed screenshots:
  - Talk: the Activity row's dismiss button was invisible (`.icon-button-sm { position: relative }` in
    components.css loads after talk.css and pulled it out of the row). The rule is now `.activity-row
    .activity-dismiss`.
  - Landing wall: side-talk bubbles covered the names of the row above and, on phones, each other. A bubble now sits
    on the lower part of the speaker's own portrait (measured, so the staggered columns are followed), and the line
    gives way to the reply instead of both showing.
  - Faces: a blink drew two black ovals on anyone with a fringe (the lid colour was sampled at one point above the
    eye, on the hair). The lid colour is now the median of five skin probes (brow bone and upper cheek), with a test.
- Docs: this file and CONTRACTS.md (routes, `/api/media/*`, `callBudget` and `retry`, voiced announcements, theme,
  commands and scripts).

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
