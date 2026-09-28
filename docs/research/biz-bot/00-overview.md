# biz-bot — Consolidated overview (lead analyst)

> Consolidates the three slice reports — [bb1 backend runtimes](bb1-backend-runtimes.md), [bb2 orchestration](bb2-orchestration.md), [bb3 experience](bb3-experience.md) — with a completeness check against `README.md`, `docs/*.md`, every unit-test title (`public/test`, `bridge/test`, `worker/test`) and the five browser suites (`scripts/*e2e*.mjs`). It also spot-checks the slice reports against the source. All paths are relative to `reference/biz-bot/`. No secret files were opened; variable names come from `.dev.vars.example` only.
>
> Verification run (read-only): `node --test public/test/*.test.mjs worker/test/*.test.mjs` gives **237 tests, 235 pass, 2 fail**. One failure is real: `refine.test.mjs` "noteSkillOutcome: trial versions are promoted…" fails against current `refine.js`. The other is environmental: `worker/test/runtime.test.mjs` cannot import the `yaml` package because `node_modules` is not installed in the snapshot. Bridge tests were not run because they spawn sandboxes and CLIs.

---

## 1. Identity

**biz-bot ("Bizbot")** is a single-user, local-first **personal operating agent** by Greg DeCarlo (MIT, `package.json` v2.0.0). You chat with one lead agent, Bizbot, and it works like a team. Bizbot answers small things itself, delegates to specialist agents (`ask_bot`), and turns bigger outcomes into **projects**. A project is a generated team of agents that drafts a reviewed plan (a task DAG), works in parallel in a shared workspace, reviews its own output, and leaves artifacts, runs, automations and apps attached to the project.

- **Who it is for:** one owner or operator, such as a solo founder, researcher, developer or small-business operator. Everything is designed around one principal identity. There are no multi-user accounts, RBAC or billing.
- **Runtime and deploy shape.** It runs in three places that share one engine:
  1. **Static SPA** (`public/`): plain ES modules with no framework and no build step. Records live in localStorage; chat logs, plans, artifacts, apps and vectors live in IndexedDB.
  2. **Cloudflare Worker** (`worker/src/index.js`): holds the provider keys as secrets and normalises OpenAI, xAI, Anthropic, Workers AI and Mock into one SSE event stream (`/api/chat` plus image, speech, transcribe, embeddings, search, MCP, fetch and realtime token). It also mounts a SQLite-backed **Durable Object** (`RuntimeDO`) with an **R2** workspace at `/api/runtime/*`, so projects keep running in the cloud. One `wrangler deploy` ships the Worker and the SPA assets together.
  3. **Optional local Node bridge** (`bridge/src`, `npm run local`): hosts the same Worker in-process and adds Ollama, OpenAI-compatible local servers, **Claude Code / Codex CLIs** as agents, a sandboxed shell, workspace files, a Playwright browser with take-over, stdio MCP, memory-as-files, reflection, and a background runner with triggers. LAN mode adds TLS and QR pairing for phones.
  - `runtime-auto.js` uses the bridge when it is online, otherwise the cloud DO, and pins each plan to the runtime that started it.
- **Maturity:** a large, well-tested codebase: about 10.6k dense lines in `public/js`, 237 app/worker unit tests plus about 20 bridge suites, and 5 Playwright suites that run keyless against the mock provider. It is currently mid-"convergence": `docs/convergence.md` has every checklist item unchecked, and the ledger, services, catalog publication and manual refinement are new and partly wired.

---

## 2. Signature ideas (must not be lost in a blended product)

1. **One lead, many instances of one identity.** Bizbot is a *virtual* bot built from the **Principal** on every turn, so it can't be deleted. Every specialist is an *instance* with the same voice, preferences, standing rules and proactivity dial, differing only in specialty and skills (`bizbot.js`, `agent.js buildSystemPrompt`). A per-turn **routing brief** lists the live roster, the teams and the in-flight projects.
2. **Delegate an outcome, get a project.** Objective, scope and criteria produce an auto-assembled team, a **reviewed plan DAG**, a workspace (`inbox/ artifacts/ apps/ notes/`), an **Inbox**, **runs** and **artifacts** that stay attached "for as long as the project lives". Simple mode reduces this to **one question** ("What do you want done?").
3. **Clusters and evidence-backed completion.** Each task has a lead, co-owners and **cross-discipline reviewers**, and runs work → review (`APPROVED`/`CHANGES`) → revise. A failed lead rotates to another owner. Assembled teams include a designated **sceptic** who "speaks for whoever is not in the room". A turn counts as complete only when `finish === 'stop'` and the output is non-empty. `repairPlan` reopens false completions, and partial output is never shown as done.
4. **The Inbox decision is the universal pause.** Plan approval, command and MCP approvals inside tasks, `request_user_input`, Codex native approvals, budget raises, reflection compactions and "open the tab for this step" all become one durable decision type (`InputRequired` control flow). Sibling tasks keep running, and resolving the decision auto-resumes whichever runtime owns the plan.
5. **Same engine everywhere, with honest limits.** `executePlan` is pure, and the portable engine runs in the tab, the bridge or the Durable Object. A missing capability throws `RuntimeUnavailable` with a plain sentence. A local bot is **never silently moved to a paid cloud model**.
6. **Graded consent and bounded self-extension.** `approveAction` checks grants first, then asks through a chat card or an Inbox decision. Grants come as once, task, session, 24 hours or standing, scoped by a command glob, path, origin or `server/tool`. Money, sending and identity are refused by construction. The lead's `system` tool has tiers, 3/12/40 rate limits, taint escalation, secret-shaped-input refusal, and a full audit trail with **Undo**.
7. **The transcript is the source of truth.** The live team graph, replay scrubber, "Show in chat" deep links, audit trail and run records are all *derived* from the persisted log.
8. **Proactivity as a budget.** The off/quiet/on dial, a daily **annoyance budget** (0/6/30 pings) and a small **LLM judge** ("does this matter?") gate every proactive interruption.
9. **Memory you can read and edit.** Memory is stored as Markdown files, one fact per line with an id comment, with echo-safe two-way sync. Reflection *proposes* compactions as Inbox diffs rather than silently rewriting.
10. **Keyless, mock-first.** A schema-aware mock provider makes the whole product demoable and e2e-testable with no API keys.
11. **Plain, portable configuration.** Templates, the skill and connector catalogs, and (newer) `AGENT.md` / `SKILL.md` / `WORKFLOW.yaml` / `RUBRIC.md` / `CONTRACT.yaml` content files are human-readable, validated and exported without secrets.

---

## 3. Pillar coverage at a glance

| Pillar | biz-bot strength | Summary |
|---|---|---|
| P1 Lead orchestrator | **Strong** | Virtual Bizbot + routing brief + create_project/propose_idea + one-question delegation. Gap: the lead cannot message or steer a *running* project team (only individual non-project agents via `ask_bot`). |
| P2 Personas | **Strong (text)** | Principal/instance layering, Assemble with sceptic, presets, voice per agent. Faces are emoji/letter/uploaded images only. |
| P3 Avatars | **Missing** | No rendering, visemes, expressions or lip sync. Closest assets: graph speaking halos, activity event bus, realtime PCM playhead, TTS voice resolution. |
| P4 Workflow orchestration | **Strongest** | DAG executor, clusters, checkpoints, repair, typed activities with receipts, approvals, triggers, ledger with leases/fencing, background runners. |
| P5 Intra-agent comms | **Strong** | `ask_bot`, `message_bot`, @mentions/router, `/discuss` meeting protocol, channel per team, CLI relay, SSE replay. |
| P6 Projects with plans | **Strong** | Project record, plan approval, Inbox, runs archive, artifacts, apps, automations, goals board. |
| P7 LLM providers | **Strong minus Google** | OpenAI/xAI (Responses), Anthropic (Messages), Workers AI, Ollama, OpenAI-compatible, Claude Code, Codex, Mock. **No Gemini**; catalogs are hand-maintained. |
| P8 Multimodal | **Partial** | STT, TTS, xAI realtime voice, image gen (edit is server-only), vision, embeddings, PDF/CSV/video frames. No video gen, camera/screen capture or paste. |
| P9 Context & memory | **Good** | Scoped facts, Markdown memory, reflection, IndexedDB vectors, project context bundle; typed memory graph is backend-only. |
| P10 Tools/MCP/self-extension/apps | **Strong** | MCP HTTP+stdio, 11-connector catalog (OAuth docs-only), system tool, skills, sandboxed apps SDK, local shell/files/browser. |
| P11 Navigation & UX | **Good (list-based)** | Conversations, task dock, Simple/Full, team graph with replay; no spatial office. |
| P12 Trust & governance | **Strong (single-user)** | Grants, taint, audit, undo, sandbox chain, bridge auth; budgets hampered by missing rates; no tenancy. |
| P13 Business | **Partial** | Templates (business-ops), scenarios, share links, export/import; no billing, guests or tenancy. |
| P14 Infrastructure | **Strong** | Worker + DO + R2 + Workers AI single deploy; bridge; sync protocol 2; fakes and fixtures; live verify scripts. |

---

## 4. Complete feature inventory

Maturity: **solid**, **partial**, **stub** or **docs-only**. Reuse: **Adopt** (lift largely as-is), **Adapt** (keep the idea, change the implementation), **Reference** (learn from it) or **Avoid**. ★ marks features newly found in this consolidation that are not in any slice report. Duplicate features across slices are merged into one row.

### P1 — Lead orchestrator
| Feature | Pillar | Maturity | Reuse | Where |
|---|---|---|---|---|
| Bizbot virtual lead agent (built from the Principal each turn, undeletable, excludes CLI providers) | P1 | solid | Adopt | bb2 §2.1, bb3 §2.7 · `public/js/bizbot.js:9` |
| Per-turn routing brief (4 routing rules + delegable agents + standalone teams + projects with status) | P1 | solid | Adopt | bb2 §2.1 · `bizbot.js:27` |
| Single message entry point `deliver()` with slash-command intercepts and per-kind dispatch | P1/P11 | solid | Adopt | bb3 §1 · `controllers/runs.js:198-250` |
| Project creation (`materializeProject`), Turn into project, `create_project` system tool, Pin idea as goal | P1/P6 | solid | Adopt | bb2 §2.10, bb3 §2.9 · `project-create.js:7` |
| ★ Simple-mode **one-question delegation** (objective + optional "how will you know" → auto name, team, plan for approval) | P1/P11 | solid | Adopt | ★ §5.3 · `controllers/projects.js:315,459-476` |
| Headless portable engine (same scheduler and turn loop in tab, bridge and DO) | P1/P4/P14 | solid | Adopt | bb2 §2.28, bb1 §2.14 · `headless-engine.js:41` |
| Completion delivery back to the originating conversation (ledger outbox → `delivery` event) | P1/P5 | partial | Adapt | bb2 §2.28, bb1 §2.18 · `headless-engine.js`, `runner.js:17` |

### P2 — Personas
| Feature | Pillar | Maturity | Reuse | Where |
|---|---|---|---|---|
| Principal + instance prompt layering (identity → tone → prefs → standing rules → proactivity → uncertainty rule → specialty → skills → memory → room → execution rules → voice note → external rule) | P2 | solid | Adopt | bb2 §2.2 · `agent.js:43`, `store.js:56 normalizePrincipal` |
| Principal persona editor and proactivity dial (Admin → Bizbot, shows today's ping count) | P2/P12 | solid | Adopt | bb3 §2.23 · `settings.js` |
| Agent configuration form (presets, readiness line, provider/model/effort, avatar upload, voice provider+voice, tools, CLI fieldset, trust, MCP, skills, files) | P2 | solid | Adapt | bb3 §2.24 · `botform.js`, `config-presets.js` |
| Assemble a team: scenario → 2–6 specialists (enum-constrained JSON schema, one sceptic, provider spread, clamping) | P2/P4 | solid | Adopt | bb2 §2.9 · `assemble.js:51,122,164,221` |
| Emoji / letter / uploaded-image avatars (`emojiAvatar`, `avatarHtml`) | P2/P3 | solid (static) | Replace | bb2 §2.9, bb3 §7 · `ui.js:25`, `assemble.js:210` |
| AI auto-fill "magic wand" for every form field; blank-field completion on save | P2/P13 | solid | Adopt | bb3 §2.25 · `autofill.js` |
| Starter templates as business packs (personal-assistant, research, software, business-ops) | P2/P13 | solid | Adopt | bb2 §2.35, bb3 §2.4 · `public/templates/*.json`, `templates.js` |

### P3 — Avatars (closest existing assets)
| Feature | Pillar | Maturity | Reuse | Where |
|---|---|---|---|---|
| Graph "presence": speaking halos, "thinking… / answering…" labels, tool bursts, pulses | P3/P11 | solid | Adapt | bb2 §2.31 · `graph.js` |
| Engine activity event bus `{turn,route,ask,handoff,tool,decision,team,skill,idle}` (the future avatar-state driver) | P3/P5 | solid | Adapt | bb2 §2.31, §6.14 · `swarm.js onActivity`, `graph.js controller.activity` |
| Gapless PCM playhead playback of realtime audio (base for amplitude lip sync) | P3/P8 | partial | Adapt | bb3 §2.14 · `voice.js:160-172` |
| Avatars, visemes, expressions, lip sync | P3 | **absent** | Build new | all slices · (none; `grep viseme` finds nothing) |

### P4 — Workflow orchestration
| Feature | Pillar | Maturity | Reuse | Where |
|---|---|---|---|---|
| Plan drafting `/plan [--web\|--code\|--document\|--resume]`: goal → DAG of 2–8 tasks with clusters; enum-constrained members | P4 | solid | Adopt | bb2 §2.13 · `plan.js:85,126` |
| Plan review and approval gate (`__plan__` decision, `runId` identity, stale on edit) | P4/P12 | solid | Adopt | bb2 §2.14 · `controllers/runs.js:~313` |
| DAG executor `executePlan` (concurrency 3, work→review→revise, 1 revision, 2 attempts with lead rotation, skip dependants, finisher + QA reviewer, `extractDeliverable`) | P4 | solid | Adopt | bb2 §2.15 · `plan.js:371`, `:213-215`, `:272` |
| Checkpoints, drafts, `repairPlan` recovery, `archiveFinal` previous-work history | P4 | solid | Adopt | bb2 §2.16 · `plan.js:229`, `turn-record.js` |
| Typed workflow activities (14: llm, research, review, ingest, mcp, stt, tts, storage, log, human, command, agent, browser, files), activity library, step inspector | P4 | solid | Adopt | bb2 §2.17 · `activities.js:2`, `workflow-editor.js` |
| Deterministic activity runner with execution receipts (idempotent retries, `git diff --stat` after coding agents) | P4 | solid | Adopt | bb2 §2.18 · `activity-runner.js:7` |
| Structured discussions / meetings `/discuss` (chair frames, openings, debate rounds, synthesis; 1–4 rounds) | P4/P5 | solid | Adopt | bb2 §2.8 · `swarm.js:92,111,289` |
| Automations and triggers: schedule, page watcher (edge-triggered conditions), file/docs watchers, reflect; skill or plan actions; gating with LLM judge | P4 | solid (bridge) / partial (cloud: schedule+page, UTC) | Adopt | bb2 §2.25, bb1 §2.17, §2.44 · `bridge/src/runner/triggers.js`, `worker/src/runtime/triggers.js`, `triggers.js` |
| Transactional execution ledger (idempotent enqueue, leases, fencing, backoff, dead-letter, events, outbox, effects/receipts, budget reservations) | P4/P14 | partial (effects unwired) | Adopt | bb1 §2.18, bb2 §2.30 · `public/js/runtime/ledger.js`, `bridge/src/runner/ledger.js` |
| Run records and run archive (≤200 per project, snapshot + index) | P4/P6 | solid | Adopt | bb2 §2.26 · `runs.js` |
| Bridge background runner (hand-off, journal JSONL, crash recovery, release/take-over, TAB_ONLY steps) | P4/P14 | solid | Adopt | bb1 §2.43 · `bridge/src/runner/index.js`, `engine.js` |
| Runner client: hand-off, take-over, SSE event mirroring, catch-up | P4/P11 | solid | Adopt | bb2 §2.29 · `runner.js:17,59` |
| Workflow dispatch tickets (only *published* workflows or approved plans; runtime ownership) | P4 | partial (no UI caller) | Adapt | bb1 §2.22 · `public/js/runtime/services.js:5-22` |
| ★ **Portable content-file catalog**: `AGENT.md` / `SKILL.md` / `RUBRIC.md` (YAML front matter) + `WORKFLOW.yaml` / `CONTRACT.yaml`; draft (content-hashed) → evaluate against a protected **golden** case store → **explicit-approval publish** with baseline-version check → history → rollback | P4/P10/P12 | partial (backend-only) | Adapt | ★ §5.1 · `public/js/runtime/catalog-store.js:3-50` |
| Bounded self-improvement `/refine` (smallest evidence-backed diff to skill, memory, trigger or task prompt; reject reasons) | P4/P9 | partial (auto-promotion removed; test drift) | Adapt | bb2 §2.34 · `refine.js:110` |
| Scenario library (12 guided workflows doubling as acceptance tests) | P4/P13 | solid | Reference | bb2 §2.36, bb3 §2.5 · `scenarios.js`, `docs/test-scenarios.md` |

### P5 — Intra-agent communication
| Feature | Pillar | Maturity | Reuse | Where |
|---|---|---|---|---|
| Synchronous delegation `ask_bot` (depth ≤2, nested "asked by X" bubble, graph `ask` edge, InputRequired propagates) | P5 | solid | Adopt | bb2 §2.5 · `tools.js:323`, `swarm.js:382` |
| Asynchronous hand-offs `message_bot` (≤6 rounds, `🤝 @A → @B` notes, `everyone`) | P5 | solid | Adopt | bb2 §2.6 · `swarm.js:273,422` |
| @mention routing (parallel owners), coordinator nudge, fast-model auto-router | P5 | solid (substring matching) | Adapt | bb2 §2.7 · `swarm.js:74,186,217` |
| ★ **Per-agent perspective projection** of a shared room transcript (own turns → assistant, others → `[Message from bot "X"]`, hand-offs/notes tagged, incomplete drafts flagged, bounded external-framed attachments, role merging) | P5/P9 | solid | Adopt | ★ §5.2 · `swarm.js:32-72` |
| Conversation records `bizbot\|agent\|project\|channel` (one channel per team; orphan-archive, never cascade delete; AI titles) | P5/P6 | solid | Adopt | bb3 §2.6, bb2 §2.38 · `conversations.js`, `store.js:23-32` |
| Ad-hoc project specialists `add_project_agent` (≤4 ad hoc, ≤12 members) | P5/P2 | solid | Adopt | bb2 §2.12 · `swarm.js:138` |
| Per-run MCP relay (CLI agents call `ask_bot`, documents and memory back into the app; run token; ≤8 pending; long-tool timeouts; system tools never relayed) + relay client | P5/P7 | solid | Adopt | bb1 §2.38, bb3 §2.28 · `bridge/src/relay.js`, `mcp-server.js`, `mcp-shim.js`, `public/js/relay.js` |
| Durable event bus with `?since` replay (store, plan, log, decision, memory, trigger, notice, system, artifact, record…) | P5/P11 | solid | Adopt | bb1 §2.19 · `/runner/events` |

### P6 — Projects with plans
| Feature | Pillar | Maturity | Reuse | Where |
|---|---|---|---|---|
| Project model (objective/scope/criteria/autonomy/budget/workspace/executor), scoped capability unions, context bundle, single status model | P6 | solid | Adopt | bb2 §2.11 · `projects.js:6,24,42` |
| Inbox decisions / human-in-the-loop (`request_user_input`, `InputRequired`, approval/input/notification kinds, graded grant buttons, revision direction) | P6/P12 | solid | Adopt | bb2 §2.19, bb1 §2.21 · `tools.js:35`, `project-view.js:40` |
| Project workspace UI (hero, decisions, execution list, deliverable, team presence, activity, runs, artifacts, apps, automations, background journal, audit trail, boundaries; project dialog) | P6/P11 | solid | Adapt | bb2 §2.33 · `project-view.js:119` |
| Home: goals board with verb-first next action, active-agents graph, Ideas (pin/dismiss) | P6/P11 | solid | Adopt | bb2 §2.32 · `home-graph.js:9,80` |
| Artifacts registry (10 kinds, idempotent keys, `Artifact: <path>` reply convention) and result modal (document / running web page / code; Install as app) | P6/P8 | solid | Adopt | bb2 §2.27, bb3 §2.17 · `artifacts.js`, `plan.js:708` |
| Shared project workspace `inbox/ artifacts/ apps/ notes/` (bridge roots or R2 `projects/…`) | P6 | solid | Adopt | bb3 §2.27, `docs/project-platform.md` · `local.js ensureProjectWorkspace` |
| ★ **Referential-integrity repair** across bots/teams/projects/decisions/conversations (identity is the bot *name*; renames propagate to membership, coordinator, `bot:` tools, memory, conversations; one project per team) | P6/P14 | solid | Adapt (use stable ids) | ★ §5.5 · `store.js:249-268,295-312` |
| ★ `PROJECT.md` mirror of the project brief in the content store during background runs | P6/P9 | partial | Adapt | ★ §5.8 · `content-store.js projects.save`, `headless-engine.js:260` |

### P7 — LLM providers
| Feature | Pillar | Maturity | Reuse | Where |
|---|---|---|---|---|
| Unified provider router and event protocol (`text\|reasoning\|tool_call\|citation\|image\|usage\|done\|error` + bridge `session\|activity`) | P7 | solid | Adopt | bb1 §2.1 · `worker/src/index.js:97,204,214`, `util.js:175` |
| Reliable SSE producer/parser (15 s heartbeat only when no write pending, abort propagation) | P7/P14 | solid | Adopt | bb1 §2.3 · `worker/src/util.js:41,92` |
| Responses API adapter with completion enforcement, per-part text reconciliation and citation dedupe | P7 | solid | Adopt | bb1 §2.4 · `worker/src/providers/responses.js:47,82,193` |
| OpenAI provider (gpt-5.6-sol/terra/luna…, gpt-image-2, gpt-4o-mini-tts, gpt-transcribe, text-embedding-3-*) | P7/P8 | solid | Adopt | bb1 §2.5 · `providers/openai.js` |
| xAI provider (grok-4.6…, `x_search`, grok-imagine-image-2.0 + edits, `/v1/tts` 26 voices, `/v1/stt`, realtime client secrets) | P7/P8 | solid | Adopt | bb1 §2.6 · `providers/xai.js:34,154` |
| Anthropic Messages provider (adaptive thinking, `output_config` effort/format, `web_search_20260209`, `code_execution_20260120`, refusal fallback beta) | P7 | solid | Adopt | bb1 §2.7 · `providers/anthropic.js:27-38,119-127` |
| Static model catalog with capability flags and per-capability defaults | P7 | solid (hand-maintained, no `rates`) | Adapt | bb1 §2.9 · `worker/src/catalog.js` |
| Model resolution and fallback (never local→cloud), `pickPlanner`, `pickRouter` | P7 | solid | Adopt | bb2 §2.4 · `agent.js:19`, `assemble.js:21`, `swarm.js:186` |
| Provider catalog reconciliation, local catalog merge, model pickers with offline state | P7/P11 | solid | Adopt | bb3 §2.27 · `app.js:257`, `local.js mergeCatalogs` |
| Workers AI keyless embeddings fallback (`@cf/baai/bge-base-en-v1.5`) | P7/P8 | solid | Adopt | bb1 §2.10 · `providers/cloudflare.js` |
| Schema-aware mock provider (`!tool`, `!slow`, canned teams/plans/pages, hashed embeddings) | P7/P14 | solid | Adopt | bb1 §2.11 · `providers/mock.js` |
| Local chat endpoint (same contract + `agent` params) | P7 | solid | Adopt | bb1 §2.30 · `bridge/src/chat.js` |
| Ollama provider (dynamic catalog, per-model tools/vision/thinking/embedding detection) | P7 | solid | Adopt | bb1 §2.31 · `bridge/src/providers/ollama.js` |
| OpenAI-compatible local servers (LM Studio, llama.cpp, vLLM) | P7 | solid | Adopt | bb1 §2.32 · `providers/openai-compat.js` |
| CLI agent adapter framework (binary discovery, fingerprint, stdin prompt, idle kill, env scrub, stale-resume healing) | P7 | solid | Adopt | bb1 §2.33 · `bridge/src/cli/adapter.js` |
| CLI session tail-resume negotiation (prefix hash, fingerprint, resume-by-hint) | P7 | solid | Adopt | bb1 §2.34 · `bridge/src/cli/session.js` |
| Claude Code provider (`claude -p --output-format stream-json …`, StructuredOutput capture, cost from `total_cost_usd`) | P7 | solid | Adopt | bb1 §2.35 · `providers/claude-cli.js:134` |
| Codex CLI provider (`codex exec --json`, resume, `-o last.txt`, stdio MCP shim) | P7 | solid | Adopt | bb1 §2.36 · `providers/codex-cli.js` |
| Codex app-server transport with native approvals → Inbox decisions (500 ms polling) | P7/P12 | partial (opt-in, untested) | Adapt | bb1 §2.37 · `providers/codex-app-server.js:45` |
| CLI coding agents as orchestrated team members (session per chat and bot, activity chips, coding-agent activity step) | P7/P5 | solid | Adopt | bb2 §2.3 · `agent.js`, `activities.js` |
| Google Gemini / live model discovery for cloud providers | P7 | **absent** | Build new | bb1 §7 |

### P8 — Multimodal
| Feature | Pillar | Maturity | Reuse | Where |
|---|---|---|---|---|
| Speech-to-text (worker STT preferred, browser recognizer fallback with auto-switch, click-to-toggle mic, auto-send on final) | P8 | solid | Adopt | bb3 §2.12 · `speech.js`, `controllers/conversations.js:531-554` |
| Text-to-speech auto-read replies per persona voice (`ttsFor`, `speakable`, `autoSpeak`, iOS tap fallback; excluded from assembled rooms) | P8/P3 | solid | Adapt | bb3 §2.13, bb2 §2.39 · `tools.js:374-416`, `assemble.js:41` |
| Realtime speech-to-speech voice session (xAI `grok-voice-latest`, ephemeral secret, server VAD, tool calls through same runners) | P8/P3 | partial (xAI only, single-agent chat, ScriptProcessor, weak barge-in) | Adapt | bb3 §2.14 · `voice.js`, `controllers/conversations.js:622-680` |
| Image generation tool (`generate_image`: gpt-image-2 / grok-imagine) | P8 | solid | Adopt | bb3 §3 · `tools.js:146` |
| Image edit endpoint `/api/image/edit` (xAI) | P8 | stub (no client caller) | Adapt | bb1 §2.8, bb3 §3 |
| Vision input; tool screenshots become an image turn for vision models | P8 | solid | Adopt | bb2 §2.3 · `agent.js`, `local-agent.test.mjs` |
| File ingestion and attachments (pdf.js text, images, audio → transcript, bounded `wrapExternal` context, saved to workspace `inbox/`) | P8/P9 | solid | Adopt | bb3 §2.15 · `files.js`, `swarm.js:34-54` |
| Video key-frame extraction (ffprobe/ffmpeg in the sandbox, ≤12 frames) | P8 | solid (bridge only) | Adopt | bb3 §2.15 · `artifacts.js extractVideoFrames` |
| Teach-by-showing: screenshots/frames → draft skill (vision + JSON schema) | P8/P10 | solid | Adapt | bb3 §2.15 · `draftSkillFromDemo` |
| File preview (PDF canvas pages, CSV RFC parser, JSON tables, media, code, binary fallback; focus-trapped modal) | P8/P11 | solid | Adopt | bb3 §2.16 · `file-preview.js` |
| Embeddings (OpenAI, Workers AI, Ollama, mock) with model-tagged vectors | P8/P9 | solid | Adopt | bb1 §2.10, bb3 §2.20 |
| Mermaid and rich content enhancement (lazy Mermaid 11.12.0, strict, retry, keep source) | P8/P11 | solid | Adopt | bb3 §2.10 · `rich-content.js` |
| Speech/ingest workflow activities (tab-only in background runs) | P8/P4 | solid (tab) / partial (headless) | Adapt | bb2 §2.17 · `headless-engine.js:30 TAB_ONLY` |
| Video generation, camera/screen capture, clipboard paste | P8 | **absent** (README says "paste images", but there is no paste handler) | Build new | bb3 §7 |

### P9 — Context & memory
| Feature | Pillar | Maturity | Reuse | Where |
|---|---|---|---|---|
| Memory facts (`remember`/`recall` with keyword scoring; bot, shared and project scopes; `/forget`) | P9 | solid (lexical only) | Adapt | bb3 §2.19 · `tools.js:268-290`, `store.js:593-650` |
| Memory as editable Markdown files with echo-safe two-way sync (`principal.md`, `project-<id>.md`) | P9 | solid (bridge) | Adopt | bb1 §2.45, bb3 §2.19 · `memory-files.js`, `memory-sync.js`, `bridge/src/runner/memory.js` |
| Reflection: compaction diff as Inbox decision, ≤3 ideas, a "what you may be missing" note; nightly trigger | P9 | solid (bridge) | Adopt | bb1 §2.46 · `bridge/src/runner/reflect.js` |
| ★ Weekly reflection mode (flag from trigger name or ≥6-day interval; "Weekly reflection" notice) | P9 | solid | Adopt | ★ §5.7 · `bridge/src/runner/triggers.js:108`, `reflect.js:21,34` |
| Document vector store (IndexedDB, sentence chunks, model-tagged, brute-force cosine, scopes) | P9 | solid (does not scale) | Adapt | bb3 §2.20 · `vectors.js` |
| Typed memory (`semantic\|episodic\|procedural\|profile`) with provenance, confidence, recency decay, history and a `memory_link` edge graph | P9 | partial (services-only, no UI caller) | Adapt | bb1 §2.22 · `public/js/runtime/content-store.js memory` |
| Content-addressed file store (SHA-256 blobs, chunks, lexical + optional cosine) | P9 | partial (FTS5 index written but never queried) | Adapt | bb1 §2.22 · `content-store.js files`, `bridge/src/runner/content.js:9-10` |
| Project context bundle per turn (scope, resolved decisions, ≤25 artifacts, `list_artifacts`/`read_artifact`) | P9/P6 | solid | Adopt | bb2 §2.11, §2.27 · `projects.js:24` |
| Chat log and state store (IndexedDB, ≤500 entries per log, substring search) | P9/P14 | solid (hard cap) | Adapt | bb3 §4 · `chatlog.js` |

### P10 — Tools, connectors, MCP, self-extension, apps
| Feature | Pillar | Maturity | Reuse | Where |
|---|---|---|---|---|
| Bot turn tool loop (≤8 iterations, parallel tool calls, identical-failure guard, partial results on error, `beforeModel`/`afterModel` hooks) | P10 | solid | Adopt | bb2 §2.3 · `agent.js:93` |
| Worker MCP client (Streamable HTTP; version negotiation; JSON or SSE; session cache) | P10 | solid (tools only) | Adopt | bb1 §2.12 · `worker/src/mcp.js` |
| Bridge MCP client (stdio without a shell, scrubbed env, idle stop, restart once; private HTTP) | P10 | solid | Adopt | bb1 §2.39 · `bridge/src/mcp-client.js` |
| MCP connector catalog (11: Cloudflare docs, DeepWiki, GitHub, Notion, HubSpot, QuickBooks, Xero, Asana, monday, Calendly, Canva) with token-pending state and `mcpTarget` routing | P10 | partial (OAuth docs-only) | Adapt | bb3 §2.21 · `connectors.js`, `public/connectors/catalog.json` |
| SSRF-safe `fetch_page` reader | P10/P12 | solid | Adopt | bb1 §2.13 · `worker/src/fetch-page.js` |
| Shell execution with a sandbox chain (docker → seatbelt → confined; deny-list; env scrub) | P10/P12 | solid | Adopt | bb1 §2.40 · `bridge/src/exec.js`, `sandbox/*` |
| Workspace-confined file system (realpath confinement, `if_mtime` optimistic concurrency, rg/JS search) | P10 | solid | Adopt | bb1 §2.41 · `bridge/src/fs.js` |
| Real browser with `ref_N` snapshots, screenshots, take-over/hand-back, password-field guard | P10/P12 | solid | Adopt | bb1 §2.42 · `bridge/src/browser.js` |
| Local machine tools with approvals (`run_command`, `read/write/list/search_files`, `browser_*`) | P10 | solid | Adopt | bb2 · `local-tools.js` |
| Bounded self-extension `system` tool (9 tools, tiers 0/1/2, 3/12/40 budgets, taint escalation, `looksLikeSecret`, audit + Undo) | P10/P12 | solid | Adopt | bb2 §2.24 · `system-tools.js:10-11,63` |
| Skills catalog (14) and versioned skills (`use_skill`, `/skill-name`, pin/retire/rollback, workflow templates) | P10 | solid | Adopt | bb3 §2.22 · `skills.js`, `public/skills/catalog.json` |
| Sandboxed in-app apps with `window.bizbot` SDK (opaque srcdoc iframe, `connect-src 'none'`, permissions, rate limit, approvals) | P10 | solid | Adopt | bb3 §2.18 · `apps.js`, `app-host.js` |
| ★ Bounded tool-output envelope (never cut JSON mid-property; >200k chars → `{truncated, originalCharacters, preview}`) | P10 | solid | Adopt | ★ §5.6 · `public/js/tool-output.js` |

### P11 — Navigation & UX
| Feature | Pillar | Maturity | Reuse | Where |
|---|---|---|---|---|
| Team graph (force layout, provider rings, weighted flowing edges per kind, in-flight dashed links, inspector, "Show in chat", replay scrubber, composer under graph) | P11/P5 | solid | Adapt (→ spatial office) | bb2 §2.31 · `graph.js:37,…` |
| Plan DAG view with task cards, cluster chips and step inspector | P11/P4 | solid | Adopt | bb2 §2.31 · `graph.js mode:'plan'` |
| App shell and late-bound controller wiring | P11/P14 | solid | Reference | bb3 §2.1 · `app.js`, `docs/ui-architecture.md` |
| Hash router with reflect-vs-apply semantics | P11 | solid | Adopt | bb3 §2.2 · `router.js` |
| Simple vs Full modes (template-dependent default) | P11 | solid | Adopt | bb3 §2.3 · `mode.js`, `controllers/chrome.js:138` |
| First-launch template chooser, Getting started page, Admin `?` help | P11/P13 | solid | Adopt | bb3 §2.4–2.5 · `components/template-chooser.js`, `getting-started.js`, `admin-help.js` |
| Per-conversation persistent chat views, drafts and the open-task dock | P11 | solid | Adopt | bb3 §2.9 · `controllers/conversations.js`, `drafts.js` |
| Sidebar with Today/Yesterday/Earlier grouping and `/` search | P11 | solid | Adopt | bb3 §2.8 · `sidebar.js` |
| Empty-state onboarding in new chats (starters, scenarios, agents, setup chips) | P11 | solid | Adopt | bb3 §2.9 · `components/empty-state.js` |
| Streaming message rendering with tool chips, live stdout, nested JSON tables, citations | P11 | solid | Adopt | bb3 §2.10 · `ui.js addMessage` |
| Stream reliability and partial-output recovery (10 min network / 20 min progress budgets; turn records from the first token) | P11/P4 | solid | Adopt | bb3 §2.11 · `api.js readEventStream`, `turn-record.js` |
| Admin area with 14 sections | P11 | solid | Adapt | bb3 §2.23 · `components/admin-nav.js` |
| Mobile-first viewport handling (`visualViewport`, `dvh`, no-zoom inputs, off-canvas sidebar) | P11 | solid | Adopt | bb3 §2.32 |
| Desktop notifications and toasts (only when hidden; tag dedupe; click routes) | P11/P12 | solid | Adopt | bb3 §2.30 · `notify.js` |
| No-framework component toolkit (`html```, `paint` preserving focus/caret/details/scroll, `keyedList`, import-safe) | P11/P14 | solid | Reference | bb3 §2.1, bb2 §2.33 · `components/base.js` |
| Spatial office, avatars at desks, joinable meetings | P11 | **absent** | Build new | — |

### P12 — Trust & governance
| Feature | Pillar | Maturity | Reuse | Where |
|---|---|---|---|---|
| `approveAction` single gate + scoped grants (kinds once/task/session/hours/standing; capabilities; refused money/send/identity; `suggestScope`) | P12 | solid (decision-card kind mismatch for system/app) | Adopt | bb2 §2.20 · `tools.js:55`, `grants.js` |
| Untrusted-content framing (`<external source>`, OTP/token-link stripping) and turn taint | P12 | partial (MCP, search and delegate outputs not wrapped) | Adapt | bb2 §2.21 · `grants.js:86`, `agent.js:226` |
| Audit trail (`buildAudit`: done/asked/granted/denied/failed with cost per run) | P12 | solid | Adopt | bb2 §2.22 · `grants.js:94` |
| Self-extension audit with Undo (`/undo`, message action, Admin → Activity) | P12 | solid | Adopt | bb2 §2.24, bb3 §2.23 |
| Trust & grants admin UI; "Ask before…" defaults; per-bot Trust overrides | P12 | solid | Adopt | bb3 §2.23 · `settings.js` |
| Cost budgets per goal (ledger reservations with three scopes) + annoyance budget | P12 | partial (no model `rates`; see corrections) | Adapt | bb2 §2.23 · `budgets.js`, `headless-engine.js:122-142`, `ledger.js:51-63` |
| Usage and cost accounting display (per-reply cost note; "unknown is not zero") | P12 | partial | Adapt | bb3 §2.29 · `usage.js` |
| Bridge auth policy (Host pinning, bearer + allow-listed origins, constant-time compare, throttle, PNA/LNA headers) | P12 | solid | Adopt | bb1 §2.26 · `bridge/src/auth.js` |
| Bridge config precedence and secret isolation (worker keys only in `workerEnv`, token 0600) | P12 | solid | Adopt | bb1 §2.25 · `bridge/src/config.js` |
| Worker origin policy (same-origin; Cloudflare Access as the only authn) | P12 | solid (single-tenant) | Avoid as sole auth | bb1 §2.2 · `worker/src/index.js:70` |
| Secret redaction in sync; secret-shaped input refusal | P12 | solid | Adopt | bb1 §2.20, bb2 §2.24 · `sync.js:23-31`, `system-tools.js looksLikeSecret` |

### P13 — Business features
| Feature | Pillar | Maturity | Reuse | Where |
|---|---|---|---|---|
| Template apply/export/import (idempotent, source-tagged, never secrets; pending triggers queue) | P13 | solid | Adopt | bb2 §2.35, bb3 §2.4 · `templates.js` |
| Share links for agents, conversations and rooms (base64url, ≤8000 chars; trusts payload) | P13 | solid (unsanitised import) | Adapt | bb3 §2.31 · `controllers/share.js` |
| Data export/import backups (refused during active runs) | P13/P14 | partial (drops conversation records; includes connector tokens) | Adapt | bb3 §2.26 · `settings.js:471-483` |
| Billing, guest links, multi-tenant accounts, marketing pages | P13 | **absent** | Build new | — |

### P14 — Infrastructure
| Feature | Pillar | Maturity | Reuse | Where |
|---|---|---|---|---|
| Cloud runtime Durable Object `RuntimeDO` (one per deployment via `idFromName('default')`; honest 503 limits) | P14 | solid (single DO, no keep-alive alarm for runs) | Adapt | bb1 §2.14 · `worker/src/runtime/project-runtime.js`, `worker/src/index.js:105` |
| DO SQLite storage (kv + events tables) and run journal | P14 | solid | Adopt | bb1 §2.15 · `worker/src/runtime/storage.js` |
| R2 cloud workspace file system (same fs contract as the bridge) | P14 | solid (naive search) | Adopt | bb1 §2.16 · `worker/src/runtime/fs.js` |
| Protocol-2 versioned record sync (rev/updatedAt, tombstones, changelog, "resolved beats pending") | P14 | solid | Adopt | bb1 §2.20, bb3 §2.26 · `sync.js`, `store.js` |
| Bridge server core and module composition; Node↔Web adapter; static SPA | P14 | solid | Adopt | bb1 §2.23 · `bridge/src/index.js`, `http.js` |
| In-process worker host and loopback fetch | P14 | solid (patches globals) | Adapt | bb1 §2.24 · `worker-host.js`, `runner/engine.js` |
| Device pairing via token, link and QR; LAN mode with automatic TLS | P14/P11 | solid | Adopt | bb1 §2.27–2.28, bb3 §2.27 · `pair.js`, `tls.js`, `qr.js` |
| Health and capability probes, honest `limits`, `RuntimeUnavailable`, runtime contract test, `runtime-auto` per-plan pinning | P14 | solid | Adopt | bb1 §2.29, bb3 · `runtime/runtime.js`, `runtime-auto.js`, `public/test/runtime.test.mjs` |
| Single-deploy Cloudflare topology (Worker + assets + DO + R2 + AI; `run_worker_first: ["/api/*"]`) | P14 | solid | Adopt | bb1 §3 · `wrangler.jsonc` |
| Version-skew auto reload and no-cache headers | P14 | solid | Adopt | bb3 §2.1, §2.33 · `app.js:242-248`, `public/_headers`, `scripts/stamp.mjs` |
| Captured CLI fixtures and cloud fakes (fake SQL, R2, DO ctx, assets; fake claude/codex/ollama/mcp binaries) | P14 | solid | Adopt | bb1 §2.47 · `worker/test/fake-cloud.mjs`, `bridge/test/fixtures/*` |
| Browser e2e suites (e2e, projects, ux, admin, local; Chromium + WebKit + iPhone; boot flag; `pollUntil`) | P14 | solid | Adopt | bb3 §8, `docs/test-scenarios.md` · `scripts/*e2e*.mjs` |
| ★ **Live verification harness** (`verify:live`: per-provider chat, tool round-trip, JSON schema, Assemble, vision, native search, images, **TTS→STT round-trip**, embeddings, realtime token; `verify:local`: Ollama, Claude, Codex, exec, fs, browser, media) | P14/P7 | solid | Adopt | ★ §5.4 · `scripts/verify-live.mjs:1-20`, `scripts/verify-local.mjs:1-3` |
| CI workflow `.github/workflows/deploy-worker.yml` | P14 | **docs-only** (not in snapshot) | — | README step 5 |

Totals: 146 feature rows. 8 are ★ newly found; the other 138 consolidate the slice-report features, with duplicates across slices merged into one row and a few composite items split. Six more rows record gaps: 5 **absent** capabilities and 1 **docs-only** item.

---

## 5. Missed features (detailed)

### 5.1 Portable content-file catalog with a golden-evaluation publication gate — P4/P10/P12 · partial (backend-only)
`public/js/runtime/catalog-store.js` defines five catalog kinds stored as human-readable files: `catalog/agents/<name>/AGENT.md`, `skills/<name>/SKILL.md`, `rubrics/<name>/RUBRIC.md` (Markdown with YAML front matter; the body is `instructions`), plus `workflows/<name>/WORKFLOW.yaml` and `contracts/<name>/CONTRACT.yaml` (`:3`). The lifecycle works as follows:
- **Validation** (`validateEntry`, `:11`): workflows need unique task ids, no dependency cycles, known dependencies and acceptance criteria on every task.
- **Draft** (`draft`, `:30`): writes `drafts/<kind>/<name>/<sha256>.json` and bumps the version.
- **Evaluate** (`evaluate`, `:31-38`): loads cases **only from a protected `golden/<kind>/<name>.json` store** ("never from a generated draft"). It checks required and forbidden substrings, records `coverage: 'golden' | 'structural-only'`, and stores `evaluations/<hash>.json`.
- **Publish** (`publish`, `:39-47`): requires `approved: true`, a passing evaluation, and an unchanged **baseline version**. Otherwise it fails with "Published baseline changed; evaluate again". It archives the previous version to `catalog-history/…`.
- **Rollback** (`:48`): re-drafts an old version, so a rollback also has to pass evaluation and publication.

`services.js` exposes this as `catalog_*` RPC and dispatches **only published workflows** (`:12-14`), mapping owners onto the project team.
- **Gap:** no app or UI code calls `runtime.services` (grep finds only the passthroughs in `runtime-bridge.js:32` and `runtime-cloud.js:44`), and rubrics and contracts have no consumer.
- **Why it matters for the Workplace:** it is a ready design for "publishable agent, skill and workflow definitions with eval gates", exactly the governance a business owner needs before an agent-authored workflow runs on a schedule.

### 5.2 Per-agent perspective projection of a shared room transcript — P5/P9 · solid
`swarm.js:32 transcriptToMessages(transcript, botName, {images})` turns one shared room log into a provider-neutral history *from one agent's point of view*:
- the agent's own entries become `assistant` turns;
- other agents' entries become `user` turns prefixed `[Message from bot "X"]`;
- hand-offs become `[Hand-off from "A" to "B"]`, and notes become `[System note]`;
- incomplete drafts are labelled "saved incomplete draft, not completed work";
- the most recent attachments are included within a 32k-char budget (16k per file), `wrapExternal`-framed.

Consecutive same-role turns are merged so every provider gets a strictly alternating history, images attach to the last user turn, and a synthetic `(conversation start)` is prepended if needed. Test: `spa.test.mjs` "transcriptToMessages: perspective per bot, merging, hand-offs, images on the last user turn". This is the core primitive for multi-agent rooms and meetings in which every avatar "hears" the same conversation. There is no token-aware truncation beyond the 500-entry log cap.

### 5.3 Simple-mode one-question delegation — P1/P11 · solid
In Simple mode, "+ Delegate a project" (`controllers/projects.js:315`) opens a two-field dialog (`:459-476`) instead of the full project modal. The fields are "What do you want done?" (required) and "How will you know it is done?" (optional). The dialog auto-names the project from the first 60 chars and sets `autonomy: 'review'` with an empty team (`swarmId: ''`), which triggers `planTeam` and `assembleTeam`. The plan is then drafted for approval in the Inbox ("Bizbot puts a team together, drafts a plan for you to approve, and asks here when it needs you"). This is the purest "business owner delegates to a chief of staff" UX in the codebase.

### 5.4 Live verification harness — P14/P7 · solid
- **`scripts/verify-live.mjs`** runs against a running worker. It imports the *real* client modules by redirecting relative `/api/*` fetches to the worker under test (`:16-19`). For every configured provider it checks chat streaming, a tool round-trip, JSON-schema output, `planTeam`, vision (a runtime-generated PNG), native web search, `/api/search`, images, a **TTS→STT round-trip**, embeddings and realtime tokens. It prints a pass/fail table and exits non-zero on failure. Flags: `--only`, `--skip`, `--url`.
- **`scripts/verify-local.mjs`** starts its own bridge and checks real Ollama, Claude Code, Codex, exec/sandbox, fs, browser and media (python/openpyxl, ffmpeg).

This is a cheap "few cents" canary that the Workplace should copy for every provider and modality it adds, including avatar TTS timing.

### 5.5 Referential-integrity repair with name-keyed identities — P6/P14 · solid (design debt)
Bots are keyed by **display name**. `store.saveBot` propagates a rename to team membership and coordinator, to other bots' `bot:<name>` tools, to the memory slice key, and to conversations (`store.js:295-312`). `repairReferences()` (`:249-268`) runs after deletes, imports and syncs. It prunes team members that no longer exist, re-picks coordinators, deletes projects whose team is gone or already linked (**one project per team**), pauses projects with empty teams, drops orphan decisions and orphan-archives conversations. Tests: `spa.test.mjs` "store: rename keeps swarm membership, memory and delegation references in sync", and `projects.test.mjs` "team rename and deletion repair…" and "renaming or removing shared capabilities repairs project and bot references". **Lesson:** use stable ids for personas in the Workplace, since display names and avatars will be edited often, and keep an equivalent repair pass.

### 5.6 Bounded tool-output envelope — P10 · solid
`public/js/tool-output.js` never cuts a JSON string mid-property. Beyond 200k chars it returns a valid JSON envelope `{truncated:true, originalCharacters, note, preview}`, so the UI's nested JSON tables and persisted logs stay parseable (`ux.test.mjs` "long JSON remains valid above the former 4000-character cutoff").

### 5.7 Weekly reflection mode — P9 · solid
The bridge `reflect` trigger passes `weekly: true` when the trigger name contains "week" or the interval is ≥6 days (`bridge/src/runner/triggers.js:108`). The Principal's reflective turn then includes "(weekly review)" in its context, and the notice is titled "Weekly reflection" (`reflect.js:21,34,67`). This implements the roadmap's weekly "what am I missing on your goals" note (`docs/studio-roadmap.md` M6).

### 5.8 `PROJECT.md` project brief mirror — P6/P9 · partial
When a background run starts on a runtime with a content store, `headless-engine.js:260` calls `content.projects.save(project)`. That writes `projects/<id>/project.json` plus a human-readable `projects/<id>/PROJECT.md` (name, objective, workspace) (`content-store.js projects.save`). It is a small seed of "a project is a folder of readable files", but nothing reads `PROJECT.md` back yet.

### 5.9 Docs-only items (claimed in docs, not in code)
- The CI workflow `.github/workflows/deploy-worker.yml` (README step 5) is not present in this snapshot.
- `docs/studio-roadmap.md` mentions a Principal "caution slider", a `flag_uncertainty` tool and messenger channels (Slack/iMessage/email). None are implemented: `normalizePrincipal` has no caution field, and uncertainty is a prompt rule (`budgets.js:35 UNCERTAINTY_RULE`).
- `docs/convergence.md` lists "worktrees, watchdog", "tickets, conversation delivery and primary navigation" and "evaluations and manual publication". Worktrees and watchdog have no code. Tickets, delivery and evaluation exist only server-side (§5.1).
- OAuth sign-in for the 8 `auth:'oauth'` connectors: catalog hints say "signs you in the first time", but no OAuth code exists (confirmed; see bb3 §7).

---

## 6. Corrections to slice reports (from spot-checks)

I spot-checked 19 claims against source. Most held: the refine drift, backup bug, caps, MCP taint gap, decision-card grant buttons, ledger effects unwired, DO naming and missing alarm keep-alive, provider endpoints, no avatars, no paste/OAuth/image-edit caller, and the budget "raise by the same amount". The following claims were wrong or overstated:

1. **Realtime voice barge-in is overstated (bb3 §2.14, §5, §6.7).** On `input_audio_buffer.speech_started`, `voice.js:98` only resets `playhead = audioCtx.currentTime`. Audio chunks already scheduled with `src.start(at)` (`:160-172`) are never stopped: no `AudioBufferSourceNode.stop()` and no `response.cancel` is sent. So when the user interrupts, the queued reply keeps playing, and new audio can overlap it. Real barge-in has to be built, not reused.
2. **Cost budgets are effectively CLI-only (bb2 §2.23 "solid in the tab"; bb1 §2.18 "the engine reserves before every model call").** No model in any worker catalog defines `rates`, and no worker provider emits `usage.cost`; the only cost source is Claude Code's `total_cost_usd` (`bridge/src/providers/claude-cli.js:134`). The consequences:
   - In the tab, `runCost` counts only entries with `usage.cost`, so cloud-model spend is invisible to project budgets.
   - In bridge/DO background runs, once `project.budgetUsd > 0`, `ledger.reserve` throws "Cost is unknown; configure a rate or use a token budget" for **every** cloud-model call (`ledger.js:55`). `headless-engine.js:136-139` turns that into an Inbox input decision ("Configure model rates…"), but there is no UI to configure rates.

   Token budgets (`budget_set` `dailyTokens`/`taskTokens`) do work.
3. **The FTS5 content search is write-only (bb1 §2.22, "On the bridge, content search is backed by a SQLite FTS5 table").** `bridge/src/runner/content.js:9-10` creates and populates `content_search`, but nothing queries it. `content-store.js files.search` scans every JSON record in JS (lexical overlap, plus cosine only when an embedder is passed, which the bridge's `localContent` never does). The whole services RPC has **no app caller**.
4. **Anthropic adaptive thinking scope (bb1 §2.7).** `thinking:{type:'adaptive'}` goes to every model except Haiku and legacy 4.0/4.1/4.5 (`supportsAdaptiveThinking`, `anthropic.js:36`). The regex bb1 quotes (`opus-5|sonnet-5|fable-5|mythos-5|opus-4-[78]`) only decides whether `display:'summarized'` is added (`:37,119`). So `claude-sonnet-4-6` does get adaptive thinking.
5. **"Push-to-talk" (bb3 §2.12, feature list).** The mic is a click-to-start / click-to-stop toggle (`controllers/conversations.js:551-554`); there is no hold-to-talk. It does auto-send on the final transcript, as stated.
6. **Room TTS overlap (bb2 §2.39, bb3 §2.13; addition).** In `runSwarmMessage`, `autoSpeak` is not awaited (`swarm.js:264`), so parallel @mentioned TTS-enabled bots would talk over each other. The discussion path awaits it (`swarm.js:326`). The Workplace needs floor control.
7. **`/refine` test drift is confirmed by execution (bb2 §2.34).** Running `node --test public/test/refine.test.mjs` gives 4/5 pass; test 3 fails because `noteSkillOutcome` (`refine.js:110`) no longer promotes, rolls back or retires. `npm run predeploy` (stamp + `npm test`) would therefore block `npm run deploy` on this snapshot.
8. **README screenshot is stale.** `docs/screenshot.png` shows the legacy shell (BOTS / ROOMS sidebar, "Settings" footer). The current Conversations / Projects / Admin shell appears only in `docs/graph.png`.
9. **Unused dependencies.** `package.json` declares `exceljs`, `mammoth`, `pdf-lib`, `pdfjs-dist` and `pptxgenjs`, but no source imports them; only `yaml` is used, by `catalog-store.js`. The "making" skills use python `openpyxl`/`python-pptx` in the sandbox, and the SPA loads pdf.js 4.10.38 from cdnjs. They are likely placeholders for convergence work.
10. **`create_automation` gating is ambiguous, not bridge-only (bb2 §2.24/§7).** Its description says "runs on the local bridge", but the gate is `ctx.system.bridgeOnline()`, which is wired to `runner.available()` over `runtime-auto` (`app.js:92`). It may therefore succeed against the cloud DO, which supports schedule and page triggers. This was not verified live.

Additional gap confirmed while checking P1: Bizbot's `ask_bot` roster excludes project members (`bizbot.js:29`, `!b.projectId`), and Bizbot has no tool to post into a project's channel or query a running plan. The lead sees projects only as one-line status in its brief, so steering a running project goes through the project's own chat or Inbox.

---

## 7. Top reusable assets for the Agent Workplace (ranked)

1. **Pure DAG executor plus the evidence invariants** (`public/js/plan.js` `executePlan`, `normalizePlan`, `repairPlan`, `archiveFinal`; `activities.js`; `activity-runner.js`).
   - *Why:* it is the most mature orchestration code in the reference set (16 execution tests, 7 checkpoint tests), with clusters, reviewer rotation, InputRequired waiting, receipts and draft recovery.
   - *How:* extract it as a framework-agnostic package with `runTurn({bot, prompt, phase, onProgress})`, where `runTurn` becomes "run persona X with avatar Y". Replace first-line `APPROVED` parsing with a JSON verdict schema, make the caps configurable, and host it in a Durable Object per project.
2. **Portable engine, runtime contract and transactional ledger** (`headless-engine.js`, `public/js/runtime/{runtime,runtime-auto,ledger}.js`, the DO wrapper `worker/src/runtime/project-runtime.js`).
   - *Why:* one engine runs in any host, with leases, fencing, dead-letter, outbox and budget reservations.
   - *How:* run one DO per project or tenant rather than `idFromName('default')`, add an alarm tick while any job is running, inject `fetch` and storage instead of patching globals, and wire `effect`/`receipt` around every external side effect.
3. **Unified model event protocol and provider adapters with completion enforcement** (`worker/src/util.js`, `providers/{responses,openai,xai,anthropic,mock,cloudflare}.js`, `bridge/src/providers/*`).
   - *Why:* one stream vocabulary for every source, and truncation is never reported as success.
   - *How:* adopt it as the Workplace bus and extend it with `speech_chunk`, `viseme` and `emotion` events so avatars subscribe to the same stream as transcripts. Add Gemini and live model discovery, and add per-model `rates` so budgets work.
4. **Lead-agent pattern: virtual Principal, routing brief and instance layering** (`bizbot.js`, `agent.js buildSystemPrompt`, `store.js normalizePrincipal`, `project-create.js`, Simple-mode delegate).
   - *Why:* it is the chief-of-staff design almost verbatim.
   - *How:* extend the Principal with brand voice, face rig and voice id, and extend instances with role, face and voice. Add lead tools to post into and steer running projects, and a spoken "handoff card".
5. **Inbox decisions, `InputRequired`, `approveAction` and scoped grants** (`tools.js:35,55`, `grants.js`, `project-view.js decisionCard`).
   - *Why:* one universal, durable pause and consent model across runtimes.
   - *How:* use structured decision payloads instead of `approved:<kind>` strings, and show only the grant kinds the capability allows. An avatar can "raise its hand" when a decision is pending.
6. **Room communication primitives** (`swarm.js`: `ask_bot`, `message_bot`, `parseMentions`, `discussionPlan`/`discussionDirective`, `transcriptToMessages`).
   - *Why:* delegation, hand-offs and a ready meeting protocol with per-agent perspective histories.
   - *How:* turn `/discuss` into "meetings" where avatars take the floor in turn (awaiting TTS), and let the user join mid-meeting through the same `deliver()` path. Use exact-handle mention parsing.
7. **Live team graph and activity bus** (`graph.js`, `home-graph.js`, `onActivity` events).
   - *Why:* the best existing analogue to "watch the office work": presence, flows, in-flight links, replay and deep links, all derived from the log.
   - *How:* re-skin it as a spatial office, with nodes as avatar desks and edges as visible conversations; the replay scrubber becomes "rewind the meeting".
8. **Bounded self-extension** (`system-tools.js`).
   - *Why:* safe "admin powers" for the lead (tiers, budgets, taint, secret refusal, before/after audit, Undo).
   - *How:* adopt it as-is. Add persona, avatar and voice creation as tier-0 drafts, and add the missing taint sources (MCP, search, delegate outputs).
9. **CLI coding agents, session tail-resume and per-run MCP relay** (`bridge/src/cli/*`, `providers/claude-cli.js`, `codex-cli.js`, `relay.js`, `mcp-server.js`, `mcp-shim.js`).
   - *Why:* external agent processes become first-class coworkers that can call back into the team.
   - *How:* use them for "engineer" personas. Keep the run tokens, pending caps and the "system tools never relayed" rule.
10. **Voice pipeline seeds** (`voice.js`, `xai.js realtimeToken`, `tools.js ttsFor/speakable/autoSpeak`, `speech.js`).
    - *Why:* keys stay server-side with ephemeral realtime tokens, tool calls run through the same runners, and voice resolution is per persona.
    - *How:* replace `ScriptProcessorNode` with an AudioWorklet and implement real barge-in (stop sources, `response.cancel`). Add OpenAI Realtime and Gemini Live adapters, and tap output PCM (or provider timestamps) for visemes.
11. **Assemble a team** (`assemble.js`).
    - *Why:* enum-constrained schema generation plus clamping, and team-design heuristics (sceptic, discipline and provider diversity).
    - *How:* it becomes "hire a team for this project", generating persona, face and voice alongside role.
12. **Projects, runs, artifacts and goals board** (`projects.js`, `runs.js`, `artifacts.js`, `home-graph.js goalBoard`, `project-view.js`).
    - *Why:* a proven data model and the "never a status without a verb" home.
    - *How:* adopt the shapes and move storage to D1/R2 per tenant.
13. **Memory as Markdown plus reflection-as-proposal** (`memory-files.js`, `memory-sync.js`, `bridge/src/runner/{memory,reflect}.js`), with the typed memory graph in `content-store.js`.
    - *Why:* business owners can read and edit what agents know, and compaction is reviewable.
    - *How:* store the files in R2, add a `company.md` business-context file, and use typed facts, `memory_link` edges and Vectorize for retrieval.
14. **Content-file catalog with golden-eval publication** (`catalog-store.js`).
    - *Why:* governance for agent-authored definitions.
    - *How:* use it as the storage format for personas (`AGENT.md`), skills, workflows and rubrics, with a UI for draft → evaluate → approve → publish.
15. **Templates, Simple/Full modes and onboarding** (`templates.js`, `public/templates/business-ops.json`, `mode.js`, `components/{template-chooser,getting-started,empty-state}.js`).
    - *Why:* business-in-a-box onboarding.
    - *How:* ship industry packs (agency, e-commerce, consulting) that seed personas and avatars, teams, skills, connectors and automations.
16. **Sandboxed apps SDK** (`app-host.js`, `apps.js`).
    - *Why:* agent-built dashboards that run safely inside projects.
    - *How:* adopt it, and scope artifact access for apps not bound to a project.
17. **Mock-first test strategy and live verifiers** (`providers/mock.js`, `worker/test/fake-cloud.mjs`, `bridge/test/fixtures/*`, `scripts/verify-*.mjs`, the e2e boot flag).
    - *Why:* the whole orchestration graph can be tested without keys, and real APIs get cheap canaries.
    - *How:* copy the pattern and add avatar/TTS-timing checks.
18. **Local companion security model** (`bridge/src/{auth,config,tls,pair,exec,fs,browser}.js`, `sandbox/*`).
    - *Why:* a proven design for a desktop helper (sandbox chain with probes, Host pinning, QR pairing, browser take-over, password guard).
    - *How:* lift it for an optional "Workplace desktop companion".

---

## 8. Screens and UX summary

Sources: `docs/graph.png` (current shell), `docs/screenshot.png` (legacy shell), `public/index.html` element ids, `docs/ui-architecture.md` routes, and the e2e suites. The app is dark-only (`theme-color #1A202C`; no `prefers-color-scheme`).

- **Shell (current, `graph.png`).** The left sidebar has "biz-bot — Your team. Working together.", then **✦ New chat · Projects · Inbox**, a **CONVERSATIONS** filter box with Today/Yesterday/Earlier rows (emoji or letter avatar, title, subtitle, relative time), and a **PROJECTS** section with a filter and "+ New". The footer holds **⚙ Admin**, the API dot and the bridge dot. The top bar shows the conversation title with member chips (★ coordinator), the team goal, "OPEN TASKS" pills (the task dock), and Restart / Share / Members / ⋯ actions. Tabs are **Chat | ⬡ Graph**; projects use Overview, Chat, Team, Artifacts, Workflow, Automations and Settings.
- **Team graph (`graph.png`).**
  - A **Room | Plan** toggle, then "3 members · 6 exchanges", then legend chips that double as filters: Delegation (blue), Hand-off (orange), Mention (green), You (grey), with counts.
  - The canvas shows "You" at the top and members as circles with provider-coloured rings, titles under the names, and a ★ badge on the coordinator. Curved links animate, and a pulse dot travels along the active link.
  - The right inspector shows the team goal, per-member stats ("2 messages · handed off 1×"), the "Busiest link: You ↔ Researcher · 4×" and usage hints.
  - At the bottom: a ▶ replay slider with a ● Live chip and an exchange count, and a composer ("Message the room and watch it happen — @Name, @everyone or /discuss …") with a Send button.
- **Room chat (`screenshot.png`, legacy shell).**
  - Tool results appear as bordered cards ("List documents · done · (empty) ▸ ✓ 0 documents"; "Recall · Query … ▸ ✓ 0 memories").
  - Hand-offs show as a yellow system line "🤝 @Researcher → @Analyst: …".
  - Bot bubbles have a coloured avatar letter, the name, a provider badge ("Anthropic"), the model id ("claude-opus-5"), a "via hand-off from Researcher" tag, a collapsible "▸ Thinking…" and rich Markdown (headings, bullets, ✅).
  - The composer has upload and mic buttons, and @mention chips below it (@Assistant, @Researcher, @Analyst, @everyone).
- **Other screens (from routes and e2e titles):**
  - `#/welcome`: template chooser with a Simple/Full radio. `#/start`: Getting started.
  - `#/projects`: home with metrics, decision cards, goal cards with next-action buttons, the active-agents graph, recent artifacts and Ideas.
  - `#/projects/<id>/<tab>` and `#/inbox`: decision cards grouped as Needs your input / Project updates / Recently resolved.
  - `#/admin/<section>`: 14 sections with `?` help.
  - `#/pair?url&token`: pairing. `#/share/<kind>/<payload>`: share import.
  - Modals: Assemble (describe → review member cards → create room), activity library and step inspector, result modal (running web page / document / code; Install as app), file preview, app host with an in-modal approval strip, and scenario library.
- **Mobile.** An off-canvas sidebar with scrim, the composer pinned above the keyboard via `visualViewport`, and dialogs that fit and scroll. Tested in WebKit with an iPhone viewport (`e2e.mjs` "mobile: no horizontal overflow…").
- **What the Workplace should change.** Replace the list-plus-graph navigation with a spatial office where avatars sit at desks and meetings are rooms you can walk into. Keep the list as an accessible fallback. Turn the graph's presence signals (halos, tool bursts, in-flight links) into avatar animation states. Add a light theme.
