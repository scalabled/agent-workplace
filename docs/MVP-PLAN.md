# Headcount MVP plan: show it early, grow it in increments

The product docs (PRODUCT.md, EXPERIENCE.md, ARCHITECTURE.md) describe a production MVP of about 70 engineer-weeks. This plan gets there another way. It builds a runnable walking skeleton first and shows it right away. It then adds the remaining features in small increments. You can see each increment running before the next one starts.

Every increment is built on the target architecture, so nothing is thrown away. Every increment runs with no API keys: the Mock provider or your local Ollama `qwen3:32b` covers chat, and `nomic-embed-text` covers embeddings. Adding keys upgrades an increment to real providers.

Binding inputs:
- [OWNER-DIRECTIVES.md](OWNER-DIRECTIVES.md): D1 catalog, D2 communication first, D3 minimal UI, D4 iterate.
- PRODUCT.md vocabulary: Chief of Staff, Coworker, Project, Floor/Desk, Room, Raised hand/Inbox, Brief, Front door.
- ARCHITECTURE.md: the topology with four Durable Object classes and the reuse plan (§18).

## Stack and repo layout

These follow ARCHITECTURE §16.1 and §2.

```
agent-workplace/
  apps/web/             Vite + Preact + @preact/signals, TypeScript. Four places: Talk · Floor · Projects · Inbox
  apps/worker/          Cloudflare Worker + WorkspaceDO / ProjectDO / RoomDO / RunDO, D1, R2 (wrangler dev runs all of it locally)
  packages/protocol/    ids, event frames {seq, streamId, type, …}, route table, presence frames
  packages/models/      registry + streaming adapters: mock, ollama, openai-compatible, anthropic, openai, xai, gemini, workers-ai
  packages/agent-loop/  one tool loop over the provider dialects                              [OC agentRuntime + BB agent.js]
  packages/plan-engine/ DAG executor: clusters, review/revise, evidence (its tests are the spec) [BB plan.js]
  packages/catalog/     typed loader for catalog/, and Staff it (recipes + formation.json)
  packages/avatar/      Inc 0: procedural face; Inc 3: photoreal strip-warp renderer and viseme driver [OC → PG]
  packages/audio/       one AudioContext, playback queue with taps, mic capture, barge-in       [OC SpeechOutput + PG worklet]
  catalog/ docs/        (exist)        reference/   (read-only)
```

- `pnpm dev` starts the worker on :8787 and Vite on :5173.
- It runs in the app's browser pane, so you see each increment inline.
- Keys go in `apps/worker/.dev.vars`, a file that git ignores. It has a checked-in `.example`.

## Minimal UI, applied everywhere (D3)

- **Four places:** Talk · Floor · Projects · Inbox. Handbook, Settings and Replay are reached through ⌘K and the avatar menu, never as top-level navigation.
- **Chief of Staff bubble on every screen:** tap to open Talk, hold for push-to-talk, drop a file on it to hand it over.
- **Faces show status:** idle, listening, thinking, working, speaking, and a raised hand. Captions are always available. Each coworker has one accent colour.
- **Look and feel:** typography first with generous whitespace, matching light and dark themes, and subtle motion. Every screen has one primary action.

## Increments

Each increment ends with a demo script that you run, or that I run and show you, in the browser pane.

### Inc 0 · First light: meet your Chief of Staff (build first, show right away)

- **Pick your Chief of Staff (D1).** A gallery of the 12 catalog leads shows each one's face, a voice sample, a teaser from their backstory and "best for owners who…". A match quiz suggests your top 3. You can rename your choice, and switch later.
- **Talk.** The chat streams. The Chief of Staff's system prompt is built from the lead's personality, communication style, backstory and origin moments [BB routerBot layering].
  - Push-to-talk uses provider STT, or the browser's speech recognition with no keys.
  - Spoken replies use provider TTS in the lead's catalog voice, or the browser voice as a fallback.
  - The face's mouth follows the audio that is actually playing [OC captureTap envelope].
  - You can interrupt; barge-in stops the audio.
- **Communication while working (thin D2 slice).**
  - "Look into X for me" starts a background job in the Everyday ProjectDO. The Activity row shows its running sentence.
  - You keep talking while it runs. "How's it going?" is answered from live job state, not by pausing the job.
  - "Also check Y" steers the job at its next checkpoint.
  - When the job finishes, the Chief of Staff tells you, or says it aloud if voice is on.
- **Floor (browse).** The Directory of about 150 catalog coworkers, each with a face, name, title and one-liner, filterable by department. Click a coworker to see their profile.
- **Faces.** Procedural illustrated faces are generated from each persona's catalog `appearance` fields: blink, idle sway, and a lip-synced mouth. They need no keys and load instantly.
- **Built from:** the models package (mock, ollama, openai, anthropic, xai, gemini), the WorkspaceDO and a minimal ProjectDO, the event stream with `?since` replay, the Preact shell, and the procedural avatar with audio.

### Inc 0.5 · The living workforce (D5, built in parallel with Inc 0 and integrated right after it)

- **Reflex layer.** A `packages/expressions` engine selects instant micro-utterances by intent, persona, mood and live state. It avoids repetition and fills slots only when they are grounded in real state. It is governed by the Ambience setting (Quiet, Lively or Buzzing) and the interruption budget.
- **Expression content.** Shared archetype packs plus a signature pack for every lead and coworker (`catalog/expressions/`), covering about 30 intents, with expressive delivery tags.
- **Pre-voicing.** Lines are rendered once in each persona's voice, cached in R2 and the browser with lip-sync timing, so reflexes play instantly.
- **In the app:**
  - Talk: fillers cover model latency, backchannels play while the owner speaks, laughs and reactions fit the moment, and the Chief of Staff can say "I'm juggling two things, back in a sec".
  - Floor: passing-by lines when the owner hovers over a desk, with an inline quick reply, and side-talk bubbles derived from real events.
  - Faces: the mood model drives the avatar's expression palette.
- **Asynchronous actors.** Every agent gets prioritized mailboxes and multiple attention threads, and owner communication always goes first.

### Inc 1 · Hire a team in a sentence

- **Routes.** The Chief of Staff chooses a route: answer, ask a coworker, delegate, or start a project. Routes are stored as a data table, and each has a running and a finished sentence [OC orchestrator + BB bizbot].
- **Staff it.** A catalog recipe is matched, then the formation rules fill the gaps. The result is a team with one designated sceptic and voices that are unique within the team. The Chief of Staff explains the staffing choice in one sentence.
- **Plan card.** A DAG of 3–8 steps with owners and reviewers, and a forecast. You approve it with a raised hand in the Inbox [BB plan.js, InputRequired].
- **ProjectDO executes.** Steps run in parallel with work → review → revise loops, alarm keep-alive, and a ledger that assigns sequence numbers. Deliverables are Markdown documents with evidence.
- **The Floor comes alive.** Project pods and desks show faces driven by FloorProjector presence frames. A raised hand appears on a face when a coworker needs you.
- **Talk to anyone while they work (full D2).**
  - Open any desk to start a 1:1 with that coworker. Its conversation loop runs on a fast model that reads the coworker's live step.
  - You can redirect, add context, pause or cancel. The change reaches the running work at its next checkpoint, and sibling steps keep going.
  - Coworkers message you proactively about milestones and blockers, within the interruption budget.
- **Projects.** Overview, Plan, Runs and Deliverables. **Everyone stop** halts all work.

### Inc 2 · Rooms, voices and listen-in

- **Rooms.** Each project has a RoomDO. Every agent sees the room from its own perspective [BB transcriptToMessages]. Kickoff and review meetings run as real per-coworker turns, with the Chief of Staff moderating.
- **Floor arbiter.** Speaking priority is owner, then Chief of Staff, then a raised hand, then speaking order. The owner can take the floor, whisper to one coworker by text, and replay the meeting with captions.
- **Voice on demand.** Agent chatter stays as text until you listen in. Then each line is voiced in its speaker's voice through the writer ‖ voicer ‖ player pipeline, lines are cached for replay, and per-speaker lip sync runs on the stage [PG groups].
- **Chief of Staff live voice.** Realtime voice handles the front end (turn-taking and quick acknowledgements), while the reasoning model supplies the substance. The primary realtime provider is xAI or OpenAI, with a cascade fallback (STT → brain → TTS). Barge-in uses generations so stale audio is dropped [PG voice-front/brain-back].
- **Now-playing bar.** Listening continues while you move around the app.

### Inc 3 · Real faces

- Portraits are generated from the catalog's warpable portrait prompts with gpt-image-2 or grok-imagine. A key is required; without one the procedural faces remain.
- A landmark job runs MediaPipe in the browser.
- The PG strip-warp renderer and fusion viseme driver are ported, including the Phase 0 fixes for dropped first deltas and early drain.
- Level of detail: 1 hero face, up to 3 animated tiles, and still tokens, all on one shared scheduler.

### Inc 4 · Context and memory

- **Onboarding interview.** The Chief of Staff interviews you about the business and writes the Handbook (`company.md`, clients, standing rules).
- **Context cards.** Supported inputs: files (PDF, DOCX, XLSX, CSV), folders, and camera or screen snapshots described by a vision model [OC FileProcessor/Capture]. Where you drop an item sets its scope.
- **Memory.** A graph in D1, with hybrid recall that fuses BM25 and cosine scores by RRF [OC Memory]. Recall is visible as chips. Distillation runs after every 1:1 and meeting. Web search results carry citations that count as evidence.

### Inc 5 · Every provider, every modality

- **Providers.** All adapters are live: Anthropic, OpenAI, xAI, Gemini, Workers AI, Ollama, OpenAI-compatible, and Mock. Each persona has a model policy, and each model has rates, metering and budgets.
- **Media.** Image generation and editing, video generation (xAI, behind a flag), key-frame video understanding, and audio briefings.
- **CLI coworkers.** Claude Code, Codex and Gemini CLI are already installed here. They run through the Companion bridge [BB bridge].

### Inc 6 · Trust and real actions

- **Controls.** An autonomy dial per action class, graded grants, and an audit trail with Undo.
- **Real actions.** One exactly-once `email.send` (fake sink first, then a provider), with receipts.
- **Connectors.** MCP connectors from the catalog; HubSpot is read-only. Coworkers can extend themselves through the bounded self-extension `system` tool [BB].

### Inc 7 · The rhythm

- **The Brief.** A spoken daily digest in which each project lead speaks in their own voice.
- **Recurring work.** The Weekly Review with replay chapters. Automations and triggers with an LLM judge and an attention budget.
- **Walkie-talkie.** A mobile PWA with hold-to-talk.

### Inc 8 · Open the doors

- **Front doors.** Guest links to one coworker, with an AI badge and role-scoped tools [PG].
- **Apps and packs.** Sandboxed agent-built apps with self-repair [PG canvas + BB app-host]. Industry packs and polished onboarding.
- **Billing.** Stripe, once metering is calibrated.

## How each increment is built and verified

1. **Build.** A workflow splits the increment into modules. Agents implement them in parallel in separate packages, using isolated git worktrees where their changes overlap.
2. **Integrate and test.** An integration agent wires the modules together, and test agents add vitest units and a Playwright smoke test with the Mock provider.
3. **Check it myself.** I run it in the browser pane, walk the demo script and fix what I find. Then I show it to you with screenshots and a short "try this" list.
4. **Commit and hand over.** I commit the increment (with your OK on git) and ask what to change before the next one. Your feedback can reorder the increments.

## Scope notes and defaults

- **One user and one workspace.** Local, single-owner mode until Inc 8; OAuth, orgs and billing come later.
- **English voice first.** Text works in any language.
- **Working name "Headcount".** The trademark check is still open.
- **Secrets.** Keys are read only from `apps/worker/.dev.vars`. I will not read the reference projects' `.dev.vars` files.
