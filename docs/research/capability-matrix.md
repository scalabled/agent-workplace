# Agent Workplace — Capability Matrix

> **What this is.** This document combines the twelve research reports on the three reference projects into one decision document for the new Agent Workplace:
> - `biz-bot/{00-overview,bb1-backend-runtimes,bb2-orchestration,bb3-experience}.md`
> - `oncloudnine/{00-overview,oc1-server,oc2-client-app,oc3-shared-core,oc4-input-persona}.md`
> - `personagram-ai/{00-overview,pg1-worker-backend,pg2-web-avatar}.md`
>
> The target product is a business owner who talks to **one lead agent (Chief of Staff)**. That agent spawns and coordinates projects of AI coworkers, each with a persona and an **interactive, lip-synced avatar**. The owner can navigate to, watch, join and listen to any agent.
>
> **Conventions**
> - **Abbreviations:** **BB** = biz-bot, **OC** = oncloudnine, **PG** = personagram-ai.
> - **Paths** are relative to `reference/`, with `:line` where the reports pinned one.
> - **Maturity:**
>   - **solid** = implemented and tested
>   - **partial** = works, with known defects or never verified live
>   - **stub** = declared or wired but inert
>   - **docs-only** = claimed in docs but not in code
>   - **absent** = not in the project
> - **Verification:** I re-checked these anchors against source while writing:
>   - `oncloudnine/server/providers/registry.ts:84-217`: model constants, `PROVIDER_DEFINITIONS` and the capability orders
>   - `personagram-ai/src/worker/providers.ts:3-17`: `MODELS`
>   - `biz-bot/worker/src/providers/{anthropic,openai,xai}.js`: the catalog ids, the xAI `realtime` entry and `realtimeToken`
>   - `biz-bot/public/js/plan.js:371`: `executePlan`
>   - `oncloudnine/server/lib/agentRuntime.ts:1183`: `runAgentLoop`
>   - `biz-bot/public/js/bizbot.js:9,27`: `routerBot` and `routingBrief`
>   - `biz-bot/public/js/swarm.js:32`: `transcriptToMessages`
>   - `personagram-ai/src/worker/groups.ts:350,653`: `inventCast` and `advance`
>   - `personagram-ai/src/web/avatar/viseme-driver.js:80`: `createVisemeDriver`
>   - `oncloudnine/shared/Modules/SpeechOutput.ts:432`: `captureTap`
>   - `oncloudnine/server/lib/orchestrator.ts:77`: `TOOL_ROUTING_TABLE`
>   - `personagram-ai/wrangler.toml`: DO/D1/R2 binding names only
>
>   A grep for `gemini|generativelanguage` across all three code trees returns **nothing**. No BB model catalog defines `rates`.
> - **Secrets:** no secret-bearing file was opened. Env variable **names** only.

---

## Contents
1. [Executive summary](#1-executive-summary)
2. [Concept glossary](#2-concept-glossary)
3. [Pillar matrices P1–P14](#3-pillar-matrices)
4. [Provider & model union](#4-provider--model-union)
5. [Key architectural tensions](#5-key-architectural-tensions)
6. [Reuse plan](#6-reuse-plan)

---

## 1. Executive summary

### 1.1 What each reference contributes

| Reference | In one phrase | What it brings | What it lacks |
|---|---|---|---|
| **biz-bot** | **The brain and the org chart** | A lead agent (Bizbot) derived from a Principal profile with a per-turn routing brief. Delegation through `ask_bot` and `message_bot`, @mentions and a `/discuss` meeting protocol. Auto-assembled teams with a designated sceptic. **Projects** with reviewed **DAG plans**, clusters, review/revise, checkpoints and repair. The **Inbox decision** as the universal pause, graded **grants**, and bounded **self-extension** with audit and Undo. **Automations** (schedule, page, file, docs, reflect) with a proactivity gate. A transactional **ledger**. The broadest provider layer: OpenAI and xAI through the Responses API, Anthropic, Workers AI, Ollama, OpenAI-compatible servers, **Claude Code and Codex CLIs**, and Mock. MCP over HTTP, stdio and relay. A sandboxed apps SDK and a **local bridge** for shell, files, browser and CLI agents. | Any embodiment: avatars are emoji or letters, and voice is xAI-only with fake barge-in. Tenancy. Working cost budgets (no `rates`). It is single-user and local-first. |
| **oncloudnine** | **The senses, the single-assistant contract and the plumbing** | A thin client with a **server-owned orchestrator** that routes each tool **inline or to the background** as data, with human step copy enforced by a test. A durable **task store**, **Pending tray** and deliver-to-origin. A **capability-ordered model registry**, one tool loop over **three tool dialects**, and a Workers-native **MCP client**. **Multimodal capture** of camera, screen, mic, dictation, files and folders into one **ContextCard** envelope. **Knowledge-graph memory** with visible BM25+vector+RRF recall. A realtime voice client over **two transports** (OpenAI WebRTC, xAI WebSocket) with barge-in. **Envelope lip sync** on a cheap CSS/PNG face. A strong perimeter and ship-safety tooling. | Multi-agent anything, projects, plans, approvals and tenancy. Realtime and cloud providers were **never exercised live**, and voice and chat are **two separate brains**. |
| **personagram-ai** | **The face, the voice and the storefront** | The only complete **still-portrait → talking-face** pipeline: MediaPipe landmarks, a fusion viseme driver and a Canvas2D strip-warp renderer. **Server-mediated realtime sessions** in a Durable Object, with generation-tagged barge-in. **Voice front / brain back** delegation. Persona **interview**, self-training tools and end-of-session **distillation**. **Auto-casting** of distinct coworkers (role, voice, face). **Multi-avatar voiced meetings** with floor control and exact **replay**. Agent-built **sandboxed apps** with self-repair. Google OAuth, **Stripe billing**, hashed **share links**, and a D1/R2/DO topology with a Wrangler integration harness. | Orchestration, projects and plans. Providers are xAI plus OpenAI Live only. Retrieval, MCP and metering (`usage_events` is never written). |

### 1.2 How they complement each other

No single reference covers more than about half the pillars well. Each layer of the target product still has one clear best source:

```
 EXPERIENCE   PG immersive stage, group stage, onboarding · OC chat surface, Pending tray, a11y · BB projects/inbox/goals board, team graph
 EMBODIMENT   PG landmarks → fusion driver → strip-warp renderer · OC stream tap (captureTap), presence states, reduced-motion rule
 VOICE/ROOMS  PG ConversationDO (server-held sockets, generations, TurnAssembler) · OC realtime event handling, VoiceMode · BB perspective projection
 ORCHESTRATION BB lead + routing brief, DAG executor, grants, ledger, triggers · OC inline/background routing, task store · PG alarm job DO
 MODELS/TOOLS OC registry + dispatch + 3 tool dialects · BB adapters + unified events + CLI/local providers · OC+BB MCP · BB system tool · PG/BB sandboxed apps
 CONTEXT      OC ContextCard + graph memory + hybrid recall · BB markdown memory + reflection + project context bundle · PG budgeted per-turn brief + distillation
 PLATFORM     PG Worker+DOs+D1+R2+OAuth+Stripe+integration harness · BB Worker+DO+R2+Workers AI, bridge, sync protocol 2, mock provider · OC preflight, guards, doc-sync tests
```

- **BB decides what work happens and who does it.**
- **OC turns everything the owner shows or says into context and runs tools safely.**
- **PG makes the coworkers visible and audible and wraps the product in accounts, billing and sharing.**

The conflicts that must be resolved are listed in §5. They include three provider layers, three voice stacks, two lip-sync approaches, three storage philosophies and three UI toolkits.

### 1.3 Coverage heat map

Legend: ●●● strong · ●● moderate · ● weak · ○ absent.

| Pillar | BB | OC | PG | Best base |
|---|---|---|---|---|
| P1 Lead orchestrator | ●●● | ●● | ● | BB brain + OC turn protocol + PG voice front |
| P2 Personas | ●●● (text) | ● | ●●● | PG persona entity + BB layering and team design |
| P3 Interactive avatars | ○ | ●● | ●●● | PG avatar stack + OC stream tap and presence |
| P4 Workflow orchestration | ●●● | ●● | ●● | BB plan engine and ledger, hosted with the PG DO pattern |
| P5 Intra-agent comms | ●●● | ● | ●● (theatre) | BB semantics + PG audible stage |
| P6 Projects with plans | ●●● | ● | ● | BB data model |
| P7 All LLM providers | ●●● (no Gemini) | ●● | ● | OC registry shape + BB adapters |
| P8 Multimodal | ●● | ●●● | ●● | OC capture and endpoints + PG voice/TTS/STT |
| P9 Context & memory | ●● | ●●● | ●● | OC graph and recall + BB markdown + PG briefs |
| P10 Tools/MCP/apps | ●●● | ●●● | ●● | BB + OC MCP, BB system tool, PG canvas |
| P11 Navigation & UX | ●● | ●● | ●● | Mix; the spatial office is net-new |
| P12 Trust & governance | ●●● (single-user) | ●● | ●●● | BB grants and audit + PG auth and scoping + OC perimeter |
| P13 Business | ● | ● | ●●● | PG billing and sharing + BB templates |
| P14 Infrastructure | ●●● | ●● | ●●● | PG topology and harness + BB engine hosting and mocks |

### 1.4 The product the blend makes possible

These concepts are the **seams** each source already supports. The white space is marked **[new]**.

- **Chief of Staff (lead agent).**
  - A virtual lead derived from the owner's profile and house rules (BB `routerBot`/`routingBrief`).
  - It speaks through a realtime voice front while a reasoning model does the work (PG voice-front/brain-back).
  - It reports what it started in one sentence (OC "I started it" semantics).
  - **[new]** It can steer, pause and re-scope *running* projects, host stand-ups and deliver a spoken daily brief.
- **Coworkers.** Each is a persona with a role, personality, skills and tools (BB instances plus PG `PersonaProfile` and instruction lines), plus a unique voice and face (PG `inventCast`/`assignVoice`/portrait prefixes), and trains by talking (PG `update_instructions`/`save_memory`/`distill`).
- **The Floor [new].** A spatial office where each coworker has a **desk tile** with a live avatar.
  - Tile state is driven by engine events (BB activity bus): idle, thinking, using a tool, speaking, or waiting on you.
  - Edges between desks show delegations in flight (BB team graph).
  - The owner can click any desk to open that agent's stage (PG immersive stage) and **listen in**.
- **Rooms and Meetings.** Each team has a room (BB channel-per-team). Meetings run a real per-agent discussion protocol (BB `/discuss` with `transcriptToMessages` perspective projection). They are performed on the PG group stage: writer ‖ voicer ‖ player, current-speaker lip sync, and `next: continue/user/end` floor control. Every meeting is replayable (PG exact replay). **[new]** Observers, whispering to one agent, and live minutes that become tasks.
- **Raise a hand.** An Inbox decision (BB `InputRequired`) shows as a gesture on the avatar plus a card with graded grants. **[new]** The gesture and a spoken escalation.
- **Projects.** A project has an objective, a reviewed DAG plan, runs, artifacts, apps and automations (BB). Files and folders attach as visible context cards (OC). Durable runs execute with live progress (PG `BuilderDO` pattern). The Activity rail shows what is running (OC Pending tray).
- **Playbooks and business packs.** Templates seed personas, teams, skills, connectors and automations (BB templates). A catalog publication gate uses golden evaluations (BB `catalog-store.js`, currently backend-only). Onboarding asks the owner to paste, add files, or talk it through (PG).
- **Guest doors.** Purpose-scoped share links let customers talk to a coworker, with consent-gated transcripts landing in the inbox (PG Personagrams). **[new]** Guest access to project deliverables and meeting replays.

### 1.5 Top white space (nothing in the references provides it)

1. **Many simultaneous avatars.** This needs a shared rAF scheduler, a single app-wide AudioContext with a mixer and per-agent analyser taps, level-of-detail tiles and off-screen pausing. PG itself says its stack is sized for 1–6 faces (pg2 §7).
2. **Listening in on agent-to-agent conversations.** This needs observer sockets on a room DO, lazy "voice on demand" of text-native agent chatter, and a floor arbiter. BB's room TTS overlaps (`swarm.js:264` is not awaited), and OC has one global voice session.
3. **A spatial office metaphor** for navigating, joining and conversing, with an accessible list fallback.
4. **Conversational face states and expressions** driven by run events: listening, thinking, waiting for approval, handing off, raising a hand. OC's `setExpression` is a no-op, and PG has no gaze or emotion.
5. **A lead that steers running projects.** BB's lead cannot message a project team: `bizbot.js:29` excludes project members.
6. **Google Gemini**, together with live model discovery, per-model pricing, and budgets that work for every provider.
7. **Multi-tenant organisations with RBAC**, a server-side secret vault, **OAuth for MCP connectors** (docs-only in BB), and a unified audit log across model calls, tool calls and data egress.
8. **Governed real-world actions** such as sending email or making payments. BB refuses these by construction, and PG forbids action claims in the prompt. The Workplace needs them behind explicit approvals and exactly-once effects (BB `effect`/`receipt` is unwired).
9. **Business-data context.** A company knowledge graph fed by connectors (CRM, accounting), scoped per project and per agent.
10. **Usage metering and pricing for an agent workforce.** PG's `usage_events` is a stub and OC shows a token footer only.

### 1.6 Corrections that change the reuse calculus

These come from the reports' verification passes. They are "looks reusable, is not as claimed".

| Claim | Reality | Source |
|---|---|---|
| BB realtime voice has barge-in | It only resets the playhead. Scheduled sources keep playing, and `response.cancel` is never sent. | `biz-bot/public/js/voice.js:98,160-172` |
| BB project cost budgets work | No catalog defines `rates`, so with a USD budget the ledger refuses **every** cloud call ("Cost is unknown"). Only Claude Code reports cost. | `biz-bot/public/js/runtime/ledger.js:55`, `bridge/src/providers/claude-cli.js:134` |
| BB `/refine` auto-promotes skills | The code no longer does this, and the test fails, which blocks `predeploy`. | `biz-bot/public/js/refine.js:110`, `public/test/refine.test.mjs` |
| BB bridge content search uses FTS5 | The FTS5 table is written but never queried. The services RPC has no UI caller. | `biz-bot/bridge/src/runner/content.js:9-10` |
| BB cloud DO runs projects in the background | There is no alarm keep-alive while jobs run, and one DO serves the whole deployment (`idFromName('default')`). | `biz-bot/worker/src/runtime/project-runtime.js`, `worker/src/index.js:105` |
| OC realtime voice is production-ready | The project's own docs say neither transport was ever exercised live. It uses `ScriptProcessorNode`. | `oncloudnine/docs/architecture/workspace-persona-voice.md:235` |
| OC operator can move any tool to background | This throws for MCP and inline built-ins. | `oncloudnine/server/lib/orchestrator.ts:496-497` |
| OC `query_memory` tool works in chat | It is dormant: no `MEMORY_HOST` is set and the client sends no memory. | `oncloudnine/server/lib/agentRuntime.ts:398-404` |
| OC voice and chat are one assistant | They are separate brains. Voice has 5 client tools plus MCP and never sees the orchestrator. | `oncloudnine/app/Views/WorkspaceView.tsx:898-1074` |
| PG lip sync uses exact character timestamps | The timestamped-TTS path is unreachable (`conversation.ts:652` returns before `:661`). | `personagram-ai/src/worker/conversation.ts:652-667` |
| PG lip-sync text queue starts at the first delta | The first deltas are dropped when the first audio arrives (`newDriver()`). | `personagram-ai/src/web/voice/transports.ts:285-296,347-351` |
| PG OpenAI Live is an independent provider | Every substantive answer still needs `XAI_API_KEY` (the brain is xAI). The end-to-end SDP path is not mocked. | `personagram-ai/src/worker/conversation.ts:939-1080` |

---

## 2. Concept glossary

The **Workplace term** column is the proposed canonical name.

| Workplace term | biz-bot | oncloudnine | personagram-ai | Notes / decision |
|---|---|---|---|---|
| **Owner / Workspace** (tenant) | Single user. **Principal** profile `{name,title,icon,tone,preferences,rules,proactivity,voice}` (`store.js normalizePrincipal`). No accounts; Cloudflare Access only. | Single user. Per-browser `cn9_browser` cookie hashed into a task owner id. Admin is "not an authentication boundary". | **Creator** = Google OAuth user (`users`, `auth_sessions`). A `CreatorDO` per owner serialises quota and billing. | Use PG accounts with a per-owner DO, and add orgs and roles. The BB Principal becomes the Workspace's **house style and standing rules**. |
| **Chief of Staff** (lead agent) | **Bizbot**: a virtual bot rebuilt from the Principal each turn, undeletable (`bizbot.js:9`), with a routing brief (`:27`). | The **orchestrator** ("Cloud Nine AI") that runs `orchestrateChatTurn` (`orchestrator.ts:599`). One per deployment, admin-configured. | The owner-mode private avatar is the nearest analogue. The group **director** (`groups.ts:653`) is the floor-control analogue. | Keep BB's "derived and undeletable" rule. Give it a face and voice (PG), the OC turn protocol, and PG voice-front/brain-back. |
| **Coworker** (agent) | **Bot / agent**, usually an *instance* of the Principal (`instanceOf:'principal'`). Keyed by **display name**. | None. The `run_agent_task` sub-agent is silent (`emit: () => {}`). | **Private AI Avatar** ("doppelganger" in code, `doppelganger.ts`), up to 40 per owner. Cast members become real avatars. | A coworker is a persona entity with a **stable id** (BB's name keys are design debt, bb 00 §5.5). |
| **Persona** | Bot fields (`title, description, instructions, tools, skills, provider, model, reasoning, voice, trust, agent`) plus Principal layering (`agent.js:43`). Also the `AGENT.md` catalog kind. | `PersonaSettings`: 33 fields, mostly face appearance (`persona/interfaces.ts`), plus `update_persona`. | `PersonaProfile`, 9 fields: `name, headline, identity, personality, expertise, stories, preferences, boundaries, handoff` (`domain.ts:5-15`). Instructions stored as **lines**. | A persona combines identity (PG fields), role and skills (BB), policy (tools, grants, model, budget), a voice profile and a face rig. |
| **Voice profile** | `bot.voice {provider, voice}` via `ttsFor` (`tools.js:374-416`). | Persona `voice` plus provider catalogues. Realtime voice set at mint time. | `avatar.provider/voice`, a voice catalog, per-speaker `speed`, and **voice uniqueness** in a cast. | `{provider, voiceId, speed, fallbacks[]}` per persona, unique within a project. |
| **Avatar / face rig** | Emoji-in-SVG, letter or uploaded image (`ui.js:25`, `assemble.js:210`). | A layered PNG bust with CSS eyes, brows and mouth (`persona/Components/Persona.tsx`) and a `FaceAnimation` ECS. | A portrait asset plus **landmarks** (`avatar_assets.landmarks`), `FaceLipSync`, and `<avatar-view>`. | `{renderer:'portrait'\|'procedural', assetId, landmarks, appearance}`. PG is primary and OC-style is the cheap LOD. |
| **Team / crew** | **Swarm / team / room** `{id,name,goal,bots,coordinator,rounds}`, 2–12 members, with one sceptic when assembled. | None. | **Cast** / `group_conversations.participants` snapshot, 2–6. | A team belongs to a project and has a coordinator (who is never the sceptic). |
| **Room** (persistent channel) | Conversation `kind:'channel'`, unique per team (`conversations.js`, `store.js:23-32`). | A conversation (single thread). | A `ConversationDO` per live session. `/g/:token` replays. | A **RoomDO** holds participants (agents, owner, observers, guests) and the transcript as the source of truth. |
| **Meeting** | `/discuss`: framing → opening → debate → synthesis (`swarm.js:92,111,289`). | None. | **Group conversation studio**: director JSON lines, 8 styles, `next` floor control, per-line audio (`groups.ts`). | A structured session in a room. It uses BB semantics and the PG stage and replay. |
| **Delegation / hand-off** | `ask_bot` (synchronous, depth ≤2) and `message_bot` (asynchronous, ≤6 rounds). | `run_agent_task` as a background task. | `create_experience` queues durable work; persona `handoff` is prompt-only. | `delegate(persona, goal)`, `handoff(to, note)` and `escalate(owner)` all become events on the bus. |
| **Project** | Project `{objective, scope, successCriteria, autonomy, budgetUsd, workspace, executor, swarmId}` (`projects.js`). | Nothing beyond `conversationId` on tasks. | The **Personagram** link is the closest analogue: a purpose-scoped brief (`domain.ts:48-62`). | BB model plus a PG-style "door" for guests. |
| **Plan** | A DAG of 2–8 tasks with clusters (lead, co-owners, reviewers) (`plan.js:85,371`). | None. The agent step loop has max 24 steps. | None. | BB plan. |
| **Task / Run / Job** | Plan task, run record (`runs.js`) and ledger job (`ledger.js`). | `TaskRecord` / `TaskJob` (image, video, application, document, agent) (`taskStore.ts`, `TaskRegistry.ts`). | `BuilderDO` job and experience build (`builder.ts`). | Run = one plan execution. Step = a DAG node. Job = a durable unit (a RunDO or ledger job). The tray shows jobs. |
| **Decision** (human in the loop) | **Inbox decision** `{kind: approval\|input\|notification}` raised by `InputRequired` (`tools.js:35`). | None. | The creator **inbox** of consented transcripts, and draft → approve boundaries. | BB decision with structured payloads, rendered as an avatar "raised hand". |
| **Grant / permission** | `approveAction` plus grants: once, task, session, hours, standing (`grants.js`). | An endpoint policy table (`security.ts:51`). | **Capability-scoped tools** per session role, re-checked at dispatch (`conversation.ts:414-421`). | Three layers: role-scoped tool offering (PG), grants at call time (BB), endpoint policy (OC). |
| **Artifact** | 10 kinds, idempotent keys, `Artifact: <path>` convention (`artifacts.js`). | `ChatArtifact` / `TaskArtifact` and the files hub (`FileStore.ts`). | Experiences (HTML), group line audio, portraits, all in R2. | BB registry, stored in R2 and scoped to project, agent and run. |
| **In-app app** | Sandboxed srcdoc app with the `window.bizbot` SDK (`app-host.js`). | `createApplication` HTML in a sandboxed iframe. | **Canvas experience** with sketch‖full build, `REPORTER` and self-repair (`experiences.ts`). | BB SDK and permissions, PG build/repair loop, OC/PG sandbox rules. |
| **Context item** | Attachments `wrapExternal`-framed, plus the `projectContext` bundle. | **ContextCard** `{id, kind: file\|capture\|memory, …}` on the **ContextBus** (upsert, consume, retire, archive). | Knowledge cards (approved), canvas files, per-turn brief sections. | An extended ContextCard with scope, provenance and cost, visible as chips on every agent turn. |
| **Memory** | Facts (shared, bot, project scopes), **Markdown files**, reflection proposals, typed memory graph (backend-only). | A **knowledge graph** (entities, relations, chunks) with BM25+cosine+RRF recall, browser-only. | `memories` (fact or conversation, cap 300) plus **distillation** at session end. | A server-side graph, markdown projection and distillation (§5 T11). |
| **Skill / Playbook** | Skills catalog (14), `SKILL.md`, `WORKFLOW.yaml`, typed activities. | None. | None (instruction lines only). | Skill = reusable capability. Playbook = a published workflow. |
| **Automation** | Triggers: schedule, page, file, docs, reflect, with a gate and annoyance budget. | None. | Maintenance cron only. | BB triggers, run by DO alarms, with the owner's timezone. |
| **Event stream** | Activity events `{turn, route, ask, handoff, tool, decision, team, skill, idle}` plus a durable bus with `?since`. | SSE frames `delta, tool, task, done, error`, `task_update`, and the ContextBus. | DO events: `transcript, audio{generation}, thinking, interrupted, speech_started, persona, memory, instructions, experience`. | One vocabulary, namespaced with `agentId`/`roomId`/`projectId` (§5 T4). |
| **Live session** | Browser ↔ xAI realtime with an ephemeral token (`voice.js`). | Browser ↔ OpenAI WebRTC or xAI WebSocket with an ephemeral token (`VoiceChat.ts`). | Browser ↔ **ConversationDO** ↔ providers (server-mediated). | Server-mediated RoomDO by default (§5 T5). |
| **Floor control** | None. `autoSpeak` is not awaited in rooms. | `VoiceSessionCoordinator`: a single session where the agent floor wins. | Director `next: continue/user/end`, plus the player queue. | A floor arbiter per room with priority for the owner. |
| **Guest link** | Share links carrying a base64url payload (the import trusts the payload). | None. | **Hashed bearer links**, with the raw token kept in the owner's DO, capability cookies, rotate and revoke. | PG. |
| **Business pack** | Templates such as `business-ops.json`, plus scenarios and Simple mode. | Config bootstrap. | Showcase seed and onboarding intake. | BB template format plus PG onboarding. |
| **Desktop companion** | **Bridge** (`bridge/src`): shell sandbox, fs, Playwright, CLI agents, stdio MCP, QR pairing. | Dev server plus the stdio `MCP_HOST` bridge. | None. | BB bridge as an optional, paired companion. |
| **Self-extension** | The `system` tool with tiers, budgets, taint and Undo (`system-tools.js`). | `update_persona` (the model restyles itself). | `update_instructions`, `save_memory`, `save_persona_facts`. | BB guard pipeline around all of them. |

---

## 3. Pillar matrices

Each pillar has four parts: a feature table, the best-of recommendation, overlaps and conflicts, and white space.

### P1 — Lead orchestrator

| Feature | Src | Maturity | Where |
|---|---|---|---|
| Virtual lead rebuilt from the Principal each turn. Undeletable, and CLI providers are excluded. | BB | solid | `biz-bot/public/js/bizbot.js:9` `routerBot` |
| Per-turn routing brief: 4 rules, delegable roster, teams, and projects with status | BB | solid | `bizbot.js:27` `routingBrief` |
| Single entry point `deliver()` with slash-command intercepts and per-kind dispatch | BB | solid | `biz-bot/public/js/controllers/runs.js:198-250` |
| `create_project` → auto team → auto plan. `propose_idea`. "Turn into project". | BB | solid | `biz-bot/public/js/project-create.js:7` `materializeProject` |
| Simple-mode **one-question delegation** ("What do you want done?") | BB | solid | `biz-bot/public/js/controllers/projects.js:315,459-476` |
| Completion delivered back to the originating conversation (ledger outbox) | BB | partial | `biz-bot/public/js/headless-engine.js`, `runner.js:17` |
| Thin client, server-owned brain, no model chrome (tests assert no provider or model is shown) | OC | solid | `oncloudnine/server/lib/orchestrator.ts:599`, `app/ViewModels/ChatViewModel.ts:388-524`, `test/unit/chat-orchestration.test.js:474,617` |
| Inline-vs-background tool routing as data, plus a human summary table enforced by a test | OC | solid | `orchestrator.ts:77` `TOOL_ROUTING_TABLE`, `:118` `TOOL_SUMMARY_TABLE`, `:201` `classifyTool` |
| "I started it" semantics: a turn that only starts a task is a valid `done` | OC | solid | `oncloudnine/server/api/chat.ts` |
| Operator override to background for MCP or inline tools | OC | **bug** | `orchestrator.ts:496-497` |
| Voice front / brain back: OpenAI Live `delegation:{type:"client"}` plus `session.commentary.append` fed by `SentenceChunker` | PG | partial | `personagram-ai/src/worker/conversation.ts:939-1080`, `providers.ts:386-415`, `src/shared/chunker.ts` |
| A tool that queues durable work and answers in one sentence (`create_experience`) | PG | solid | `conversation.ts:475-491` |
| Persona `handoff` ("when to send to the real person") | PG | partial (prompt-only) | `src/shared/domain.ts:14`, `src/worker/content.ts:232` |

**Best-of.**
- **BB is the brain.** The virtual lead, routing brief and `materializeProject` chain, together with Simple-mode delegation, are the chief-of-staff design almost verbatim.
- **OC is the turn protocol.** The thin client, the `delta/tool/task/done/error` frames and the routing and summary tables turn every delegation into a readable, observable step with "I started it" semantics.
- **PG is the voice.** Voice front / brain back keeps the lead conversational while a reasoning model plans and spawns.

**Overlaps and conflicts.**
- The BB lead runs in the **browser tab engine**, while the OC lead is **server-side**. Choose server-side.
- BB's lead cannot steer a running project: its `ask_bot` roster excludes project members (`bizbot.js:29`).
- OC sub-agents are invisible (`emit` is a no-op) and OC voice is a second brain.
- PG's "brain" is hard-wired to xAI `grok-4.20-0309-non-reasoning`.

**White space.**
- Lead tools to **post into, steer, pause and re-scope running projects**, and to query plan state.
- One lead identity shared by text, voice and meetings, with one memory.
- A spoken "handoff card" and a daily brief or stand-up the lead synthesises and **speaks**.
- Escalation that pulls the owner into a live room.
- Multimodal intents, such as "look at my screen and make a task".
- Delegation to *human* staff.

### P2 — Specialized personas

| Feature | Src | Maturity | Where |
|---|---|---|---|
| Principal + instance prompt layering: identity, tone, preferences, standing rules, proactivity, uncertainty rule, specialty, skills, memory, room, execution rules, voice note | BB | solid | `biz-bot/public/js/agent.js:43` `buildSystemPrompt` |
| "Assemble a team": enum-constrained JSON schema, 2–6 members, **one sceptic**, provider spread, clamping | BB | solid | `biz-bot/public/js/assemble.js:51,122,164,221` |
| Agent config form with presets, readiness line, voice provider and voice, trust, CLI fieldset, magic autofill | BB | solid | `biz-bot/public/js/botform.js`, `config-presets.js`, `autofill.js` |
| `AGENT.md` catalog kind (draft → evaluate → publish) | BB | partial (backend-only) | `biz-bot/public/js/runtime/catalog-store.js:3-50` |
| `PersonaSettings` (33 fields, mostly appearance) and `applyDefaultSettings` (`\|\|` swallows zeros) | OC | partial | `oncloudnine/persona/interfaces.ts`, `persona/Modules/PersonaSettings.ts:1-40` |
| `update_persona`: the model restyles and re-voices its avatar through a strict schema | OC | partial (mapping bugs; untyped on xAI) | `oncloudnine/server/api/getSessionToken.ts:312-366`, `app/Modules/VoiceChat.ts:1270-1284` |
| `PersonaProfile` (9 fields) with draft → approve and likeness consent | PG | solid | `personagram-ai/src/shared/domain.ts:5-15`, `src/worker/creator.ts:42-103` |
| Interviewer: typed JSON, realtime spoken with `save_persona_facts`, bulk fill. Refuses sensitive data. | PG | solid | `personagram-ai/src/worker/content.ts:205-369`, `conversation.ts:387-406` |
| Private avatars (≤40): instructions as **lines**, memories, files, owner vs guest mode | PG | solid | `personagram-ai/src/worker/doppelganger.ts:162-319,545-664` |
| Self-training tools `update_instructions` and `save_memory`, plus end-of-session `distill()` | PG | solid | `conversation.ts:428-470`, `doppelganger.ts:675-724` |
| `inventCast`: N distinct people with role, quirks, speed and look, each given a unique gender-fitting voice and a painted portrait | PG | solid | `personagram-ai/src/worker/groups.ts:350-445` |
| Cast editor with voice-uniqueness swap and speed bounds 0.85–1.15 | PG | solid | `personagram-ai/src/web/groups.ts` |

**Best-of.**
- The **coworker entity** comes from PG `doppelganger`: persona fields, line-based instructions, memories, owner and guest modes, and self-training plus distillation.
- **Principal layering** comes from BB, so every coworker speaks in the owner's house style.
- **Team design** comes from BB `PLANNER_SYSTEM` and `assemble.js`: distinct disciplines, a sceptic and provider spread.
- The **face and voice for spawned coworkers** come from PG `inventCast` with `assignVoice` and the warpable-portrait prefixes.
- **Appearance as a strict tool schema** comes from OC `update_persona`, so the lead can design and adjust faces.

**Overlaps and conflicts.**
- BB keys agents by display name (renames propagate through repair). PG and OC use ids. **Use ids.**
- PG's persona models a real person's *likeness* (consent, disclosure), while coworkers are fictional. Keep the disclosure rules but drop likeness consent for generated faces.
- OC's appearance schema is tied to its CSS face and cannot be reused as-is for PG portraits.
- BB strips TTS from assembled rooms ("six bots reading themselves aloud", `assemble.js:41`). The Workplace inverts that decision and needs floor control instead.

**White space.**
- A persona schema that unifies role, personality sliders, skills, tool grants, model policy, voice, face and expression palette, working hours and cost budget.
- A "hire a coworker" interview.
- **Evaluation of personas** against golden cases, the only design being BB's backend-only catalog.
- An org chart or reporting lines.
- Persona versioning and export (`AGENT.md`).
- Cross-provider voice equivalence, so a persona keeps a recognisable voice when the provider changes.

### P3 — Interactive avatars

| Feature | Src | Maturity | Where |
|---|---|---|---|
| MediaPipe landmark capture: pinned `@mediapipe/tasks-vision@0.10.35`, GPU, retryable singleton | PG | solid | `personagram-ai/src/web/avatar/face-landmarks.js:71`, `src/shared/landmarks.ts` |
| `FaceLipSync` Canvas2D strip-warp renderer with tiers: full, mouth-only, static | PG | solid | `personagram-ai/src/web/avatar/face-lipsync.js` (cap 1024 px, 2 px strips, attack/release/snap 40/90/20 ms) |
| Fusion viseme driver: alignment > timed deltas > deltas > spectrum > energy, with AGC, hysteresis and dead-analyser drop | PG | solid | `personagram-ai/src/web/avatar/viseme-driver.js:80` |
| Audio DSP: live features, offline FFT, speech segmentation, timeline warp | PG | solid (offline path dormant) | `personagram-ai/src/web/avatar/audio-features.js` |
| `<avatar-view>` element: `load`, `drive(driver)`, stale-load revision | PG | solid (minimal API) | `personagram-ai/src/web/avatar/avatar-view.ts` |
| Timestamped TTS alignment (xAI WS `with_timestamps`) | PG | **partial (unreachable)** | `personagram-ai/src/worker/conversation.ts:652-667,749-788`, `providers.ts:436-463` |
| Group stage: only the current speaker lip-syncs, and the speaking seat lifts and glows | PG | solid | `personagram-ai/src/web/groups.ts:182-400` |
| Generation-counter interruption with client-side drop of stale audio | PG | solid | `conversation.ts:602-623`, `src/web/voice/transports.ts:310-320` |
| Warpable-portrait prompt prefix and identity-preserving edit prefix | PG | solid | `personagram-ai/src/worker/content.ts:45-138` |
| Layered PNG bust with CSS eyes, brows and mouth, skin by filter, photo masking | OC | solid | `oncloudnine/persona/Components/Persona.tsx:18-254` |
| `FaceAnimation` ECS: blink, gaze, brows | OC | partial (gaze and brow bugs, leaks) | `oncloudnine/persona/Modules/FaceAnimation.ts:23-254` |
| Envelope lip sync: mid-band mean mapped to 6 classes (thresholds .04/.10/.22/.38/.55) | OC | solid (amplitude only) | `FaceAnimation.ts:355-466` |
| Text viseme fallback with 11 classes | OC | solid | `FaceAnimation.ts:313-345,473-508` |
| Stream tap for lip sync: `captureStream()` first, AudioContext only if running | OC | solid | `oncloudnine/shared/Modules/SpeechOutput.ts:432` |
| Presence scaling (`--scale-factor`, 76 px phone bubble), tap-to-barge-in | OC | solid | `oncloudnine/app/Styles/chat.css:875-976`, `app/Views/WorkspaceView.tsx:326-343` |
| Reduced motion: decoration off, lip sync on | OC, PG | solid | `FaceAnimation.ts:15-21`, `face-lipsync.js` |
| Speaking halos, "thinking…" labels and tool bursts in the graph | BB | solid | `biz-bot/public/js/graph.js`, `swarm.js` `onActivity` |
| Avatars, visemes, lip sync | BB | **absent** | — |

**Best-of.**
- **The PG stack** (geometry → driver → renderer) is the only complete talking-face pipeline. The `sample(now)` contract decouples timing sources from rendering, so any provider works, including ones with no timestamps.
- **From OC:** the stream-sourcing order (`captureTap`), presence states and the reduced-motion rule. A procedural bust is a cheap LOD for walls of tiles.
- **From BB:** the activity event bus drives non-speech states (thinking, tool, waiting).

**Overlaps and conflicts.**
- Two lip-sync approaches exist: OC amplitude classes and PG fusion. **Adopt PG.**
- OC uses random brows every 3 s, while PG raises brows on energy onsets.
- Both create **one AudioContext per avatar or session** and one rAF loop per face.
- PG assumes **one conversation per page**, and server-painted cast portraits carry no landmarks (every viewer re-detects).

**White space.**
- **Many simultaneous avatars:** a shared scheduler, one AudioContext mixer, per-agent analyser taps, `maxSide`/tier/pause on `<avatar-view>`, `IntersectionObserver` pausing, and OffscreenCanvas or a WebGL mesh warp.
- **Face states** driven by run events: idle, listening, thinking, speaking, waiting on the owner, handing off.
- **Gaze** toward the current speaker in meetings.
- **Expressions** from content or sentiment.
- A **raise-hand** gesture for pending decisions.
- Spatial audio panning per desk.
- Phoneme-accurate visemes for every provider, and non-English support. PG's table is English graphemes only.
- A landmark job for server-generated faces.
- An optional 3D, Live2D or Rive rig behind the same driver.

### P4 — Workflow orchestration

| Feature | Src | Maturity | Where |
|---|---|---|---|
| `/plan` drafting: goal → DAG of 2–8 tasks with clusters, owners and reviewers as member enums | BB | solid | `biz-bot/public/js/plan.js:85,126` |
| Plan approval gate (`__plan__` decision, `runId`, stale on edit) | BB | solid | `biz-bot/public/js/controllers/runs.js:~313` |
| `executePlan`: concurrency 3, work → review → revise, lead rotation, finisher plus QA, `extractDeliverable` | BB | solid (16 tests) | `plan.js:371` |
| Checkpoints and drafts, `repairPlan`, `archiveFinal` | BB | solid | `plan.js:229`, `turn-record.js` |
| 14 typed activities (llm, research, review, ingest, mcp, stt, tts, storage, log, human, command, agent, browser, files) with receipts | BB | solid | `biz-bot/public/js/activities.js:2`, `activity-runner.js:7` |
| Triggers: schedule, page (edge-triggered), file, docs, reflect. LLM judge gate and annoyance budget. | BB | solid (bridge) / partial (cloud: schedule and page, UTC) | `biz-bot/bridge/src/runner/triggers.js`, `worker/src/runtime/triggers.js` |
| Ledger: idempotent enqueue, leases (90 s), fencing, backoff, dead letter, outbox, effects, reservations | BB | partial (effects unwired) | `biz-bot/public/js/runtime/ledger.js`, `bridge/src/runner/ledger.js` |
| Portable engine running in the tab, bridge or DO, with per-plan runtime pinning | BB | solid | `biz-bot/public/js/headless-engine.js:41`, `runtime/runtime-auto.js` |
| Catalog publication gated by golden evaluations | BB | partial (no UI caller) | `biz-bot/public/js/runtime/catalog-store.js:3-50` |
| Task store: state machine, per-kind ceilings (image 5 min, document 3 min, app 10 min, video 20 min, agent 10 min), cap 3 per owner, reaper, detached blobs, `delivered` | OC | solid (single isolate) / partial (multi-isolate) | `oncloudnine/server/lib/taskStore.ts`, `server/api/tasks.ts` |
| TaskRegistry, Pending tray, deliver-to-origin | OC | solid | `oncloudnine/app/Modules/TaskRegistry.ts`, `app/Components/PendingTray.tsx` |
| Agent loop step ceiling (12, hard cap 24) with a wrap-up turn | OC | solid | `oncloudnine/server/lib/agentRuntime.ts:1183` |
| Deadline-on-signal (budgets ride the AbortSignal) | OC | solid | `oncloudnine/server/lib/http.ts` |
| `BuilderDO`: alarm-driven job, ≤2 attempts, `/progress`, stale-row reconciliation | PG | solid | `personagram-ai/src/worker/builder.ts` |
| Sketch ‖ full generation, expansion pass, fallback to sketch | PG | solid | `personagram-ai/src/worker/experiences.ts:389-538` |
| Bounded self-repair from real browser errors | PG | solid | `experiences.ts:546`, `src/web/canvas.ts:518-545` |
| `runWithConcurrency`, `SingleFlight` (drop, don't queue), `RestartPolicy` | OC | solid | `oncloudnine/input/Modules/FolderContext.ts:406-436`, `input/Modules/CaptureSupport.ts:91-153` |

**Best-of.**
- **The BB plan engine** (`executePlan` plus clusters, receipts, repair and triggers) is the most mature orchestration code in the set.
- It should run inside a **per-project DO** that uses the **PG alarm pattern** for keep-alive and bounded retries.
- **BB ledger semantics** (fencing, reservations, outbox) sit underneath.
- The **OC task store and tray semantics** are the user-visible layer: terminal-is-final, readable failures, `delivered` idempotency and tiny records.

**Overlaps and conflicts.**
- There are three retry models:
  - BB: 2 attempts with lead rotation, plus ledger backoff with 3 attempts.
  - OC: none at task level.
  - PG: ≤2 alarm attempts.
- There are three sets of caps. BB has max 8 tasks, depth 2, 6 hand-off rounds, 1 revision and concurrency 3. OC has concurrency 3 per owner.
- BB's cloud DO has **no alarm keep-alive**, and trigger time is UTC in the cloud but local on the bridge.
- BB parses review verdicts from the first line (`^APPROVED`). Use JSON verdicts.
- OC's live updates use in-isolate pub/sub.

**White space.**
- A visual plan editor. Conditional branches, loops and fan-out/fan-in.
- Deadlines and SLAs per task. Cost forecasts before plan approval.
- **Business triggers**: inbound email, a CRM stage change, a form, a payment, a webhook.
- Calendar-aware scheduling. Dry runs.
- **Exactly-once external effects** (the ledger `effect`/`receipt` exists but is unwired).
- Human tasks assigned to real staff. Recurring OKR-style projects. Run-to-run comparison.

### P5 — Intra-agent communication

| Feature | Src | Maturity | Where |
|---|---|---|---|
| `ask_bot`: synchronous delegation, depth ≤2, "asked by X" bubble, `InputRequired` propagates | BB | solid | `biz-bot/public/js/tools.js:323`, `swarm.js:382` |
| `message_bot`: asynchronous hand-offs, ≤6 rounds, `everyone` | BB | solid | `swarm.js:273,422` |
| @mention parallel owners, coordinator nudge, fast-model router | BB | solid (substring matching: `@Ann` also matches `@Anna`) | `swarm.js:74,186,217` |
| `/discuss`: chair frames, openings, debate (1–4 rounds), synthesis | BB | solid | `swarm.js:92,111,289` |
| **Per-agent perspective projection** of a shared room transcript | BB | solid | `swarm.js:32` `transcriptToMessages` |
| One channel conversation per team, orphan-archive | BB | solid | `biz-bot/public/js/conversations.js`, `store.js:23-32` |
| Per-run MCP relay: CLI agents call `ask_bot` back into the app | BB | solid | `biz-bot/bridge/src/relay.js`, `mcp-server.js`, `mcp-shim.js`, `public/js/relay.js` |
| Durable event bus with `?since` replay | BB | solid | `/runner/events` (DO and bridge) |
| Team graph derived from the log: flows, pulses, in-flight links, replay scrubber | BB | solid | `biz-bot/public/js/graph.js:37` |
| Typed page bus with count-returning `emit` and a doc-sync test | OC | solid (single tab) | `oncloudnine/shared/Modules/ContextBus.ts`, `test/unit/context-bus.test.js:150` |
| `VoiceTranscript` state machine (deltas append, done replaces, interrupted keys) | OC | solid | `oncloudnine/app/Modules/VoiceChat.ts:56` |
| Sub-agent (`run_agent_task`) messages | OC | absent (silent) | `agentRuntime.ts` |
| Group director: JSON lines with `next: continue/user/end`, 8 styles, first chunk of 8 lines then 12 | PG | solid | `personagram-ai/src/worker/groups.ts:653-769` |
| Client writer ‖ voicer (3 ahead) ‖ player, seek, exact replay, WAV export | PG | solid | `personagram-ai/src/web/groups.ts:114,182-400` |
| `TurnAssembler` on the provider timeline (gap 1500 ms, reopen/revise) | PG | solid | `personagram-ai/src/shared/turns.ts` |
| Memory isolation: cast notes come from each participant's *guest* context only | PG | solid | `groups.ts` `advance` |

**Best-of.**
- **BB supplies the semantics.** Agents take real turns from their own context through `transcriptToMessages`, with the delegation and hand-off primitives and the discussion protocol.
- **PG supplies the audible stage.** The pipeline starts playback in seconds, `next` gives floor control, and replay is exact.
- **OC supplies observability.** The frame protocol and transcript state machine let the owner watch any conversation.

**Overlaps and conflicts.**
- BB rooms run TTS unawaited, so voices overlap (`swarm.js:264`).
- PG's meetings are **single-director theatre**: one model writes everyone's lines, so it cannot represent private agent context.
- OC's bus is page-local.
- BB's graph is the only "watch the office" analogue but is an SVG force layout.

**White space.**
- A **RoomDO** with typed participants (agent, owner, observer, guest) and **observer sockets** for listen-in.
- A **floor arbiter**: a speaking queue, owner priority, moderator lead, per-speaker generations.
- **Whispers**: private owner → one-agent notes during a meeting.
- **Voice-on-demand** rendering of text-native agent chatter.
- Live per-speaker captions.
- Meeting minutes → action items → plan tasks.
- Agent DMs and cross-project channels.
- Speaking-time budgets.
- Audio ducking while the owner does something else.

### P6 — Projects with plans

| Feature | Src | Maturity | Where |
|---|---|---|---|
| Project model (objective, scope, criteria, autonomy, budget, workspace, executor), scoped capability unions, context bundle | BB | solid | `biz-bot/public/js/projects.js:6,24,42` |
| Single status model `projectSummary` and the verb-first `goalBoard` ("Answer: …", "Approve the plan") | BB | solid | `projects.js:42`, `home-graph.js:80` |
| Inbox: "Needs your input", "Project updates", "Recently resolved"; graded grant buttons; revision direction | BB | solid | `biz-bot/public/js/project-view.js:40` |
| Project workspace UI: hero, decisions, execution, deliverable, team presence, runs, artifacts, apps, automations, journal, audit | BB | solid | `project-view.js:119` |
| Run archive (≤200 per project) and artifact registry (10 kinds) | BB | solid | `biz-bot/public/js/runs.js`, `artifacts.js` |
| Shared workspace `inbox/ artifacts/ apps/ notes/` (bridge roots or R2) | BB | solid | `biz-bot/public/js/local.js` `ensureProjectWorkspace` |
| `PROJECT.md` mirror | BB | partial | `biz-bot/public/js/runtime/content-store.js` |
| Deliver-to-origin, deduplicated by `taskId` in the transcript | OC | solid | `oncloudnine/app/ViewModels/ChatViewModel.ts` `deliverTask`/`taskMessageIn` |
| Files hub with dedupe and zip export | OC | solid | `oncloudnine/app/Components/FilesHub.tsx`, `shared/Modules/FileStore.ts:602-737` |
| Folder context: visible ignore rules, diff re-sync, stable per-path ids | OC | solid | `oncloudnine/input/Modules/FolderContext.ts` |
| Purpose-scoped briefs: purpose, audience, outcome, greeting, overlay, selected knowledge | PG | solid | `personagram-ai/src/shared/domain.ts:48-62`, `src/web/studio.ts:731` |
| Inbox with LLM summaries and 90-day retention | PG | solid | `personagram-ai/src/worker/index.ts` inbox routes |
| Revision chains (`based_on`) | PG | solid | `personagram-ai/src/worker/experiences.ts` |
| `/api/me` bootstrap snapshot | PG | solid | `personagram-ai/src/worker/index.ts:509-541` |

**Best-of.**
- **BB supplies the data model and derivations** (project, plan, decisions, runs, artifacts, `projectSummary`, `goalBoard`).
- **OC supplies files and folder context** and deliver-to-origin.
- **PG supplies the storage layout** (D1 rows plus R2 prefixes), the bootstrap snapshot and summaries.

**Overlaps and conflicts.**
- BB allows **one project per team**.
- BB's IndexedDB/localStorage caps (500 entries per log, 1000 artifacts) and name-keyed repair.
- OC has conversations only.
- PG's "project" is really a share link.

**White space.**
- A portfolio view across projects.
- Timeline or Gantt.
- KPI dashboards on live business data.
- Project retrospectives feeding memory.
- Cross-project dependencies.
- Budget forecasting.
- A project "room" on the Floor.
- Hand-off of a project to a human.
- Client-facing deliverable portals (PG links applied to projects).

### P7 — All LLM providers + model registry

| Feature | Src | Maturity | Where |
|---|---|---|---|
| Unified event protocol `text, reasoning, tool_call, citation, image, usage, done, error`, plus bridge `session` and `activity` | BB | solid | `biz-bot/worker/src/index.js:97,204,214`, `worker/src/util.js:175` |
| SSE producer and parser with bounded heartbeat and abort propagation | BB | solid | `biz-bot/worker/src/util.js:41,92` |
| Responses API adapter with **completion enforcement** and citation dedupe (OpenAI and xAI) | BB | solid | `biz-bot/worker/src/providers/responses.js:47,82,193` |
| Anthropic Messages: adaptive thinking, `output_config`, server tools, refusal fallback beta | BB | solid | `biz-bot/worker/src/providers/anthropic.js:27-38,119-127` |
| Ollama (dynamic catalog with capability detection) and OpenAI-compatible local servers | BB | solid | `biz-bot/bridge/src/providers/ollama.js`, `openai-compat.js` |
| Claude Code and Codex CLIs as providers: tail-resume sessions, `StructuredOutput` capture, env scrub | BB | solid | `biz-bot/bridge/src/cli/{adapter,session}.js`, `providers/claude-cli.js`, `codex-cli.js` |
| Codex app-server with native approvals → Inbox | BB | partial | `biz-bot/bridge/src/providers/codex-app-server.js:45` |
| Schema-aware Mock provider (keyless demos and e2e) | BB | solid | `biz-bot/worker/src/providers/mock.js` |
| `resolveModel` (never silently local → cloud), `pickPlanner`, `pickRouter` | BB | solid | `biz-bot/public/js/agent.js:19`, `assemble.js:21`, `swarm.js:186` |
| Static catalog with capability flags; **no `rates`** | BB | solid / hand-maintained | `biz-bot/worker/src/catalog.js` |
| **Single registry** with capability flags and per-capability preference orders; `requireProvider` and `assertProviderSupports` | OC | solid | `oncloudnine/server/providers/registry.ts:119-217,330,355` |
| Dispatch table as the only name → implementation switch | OC | solid | `oncloudnine/server/providers/dispatch.ts` |
| One tool loop over **3 dialects** (Anthropic `tool_use`, Responses `function_call`, compat `tool_calls`) with `argsError`-as-tool-error | OC | solid | `oncloudnine/server/lib/agentRuntime.ts:643-1183` |
| Fetch policy: retries, `Retry-After`, deadline-on-signal | OC | solid | `oncloudnine/server/lib/http.ts:75` |
| Lenient JSON reader, richest candidate wins, one strict retry | OC | solid | `oncloudnine/server/lib/lenientJson.ts:122`, `server/api/extractMemory.ts:227` |
| `MODELS` frozen constant (xAI plus OpenAI Live) | PG | partial (no routing) | `personagram-ai/src/worker/providers.ts:3-17` |
| Bounded hand-rolled SSE, stable error mapping, 503 on a missing key, base-URL overrides | PG | solid | `personagram-ai/src/worker/providers.ts:42-117,360-385` |
| `parseObject` tolerant JSON (first `{` to last `}`) | PG | solid | `personagram-ai/src/worker/doppelganger.ts:727-739` |
| Google Gemini (any modality) | all | **absent** | grep-verified |

**Best-of.**
- **The OC registry shape** is the model registry: capability flags, per-capability preference orders, honest key-naming errors, and "model ids live in one file".
- **The BB adapters** are the implementation layer: broader coverage, Responses for xAI, reasoning effort, JSON schema, native tools, CLI and local providers, the Mock provider, and completion enforcement.
- **The OC three-dialect loop** merges with **BB `runBotTurn` features**: parallel tool calls, the identical-failure guard, `beforeModel`/`afterModel` hooks, and partial output on error.

**Overlaps and conflicts.**
- There are three provider layers (§5 T4).
- OC routes xAI chat through `/chat/completions`; BB uses `/responses`.
- Model ids diverge. For example, OC's OpenAI default is `gpt-5.2` while BB's is `gpt-5.6-sol`, and BB uses `grok-4.20-non-reasoning` while PG uses `grok-4.20-0309-non-reasoning` (see §4).
- Default preference orders conflict: chat is `openai→xai→anthropic→mock` in BB and `anthropic→openai→xai→ollama` in OC.

**White space.**
- **Gemini**: chat, Live realtime, embeddings, image and video.
- **Live model discovery** for cloud providers.
- **Per-model pricing (`rates`)** so budgets work for every provider.
- Prompt caching controls.
- Per-persona model policy with cost and latency routing.
- Azure OpenAI, Bedrock and Vertex endpoints.
- Evaluation-driven model selection.
- More CLI agents behind the same adapter framework.

### P8 — Multimodal

| Modality | BB | OC | PG | Best source |
|---|---|---|---|---|
| **Text chat / streaming** | solid (all providers) | solid (4 providers, mock-tested cloud) | solid (xAI) | BB adapters |
| **STT batch** | solid: worker STT preferred, browser fallback, auto-send (`speech.js`) | solid: `/api/transcribe` with a **rolling prompt**; the recorder segments with a header-prefix trick (`input/Modules/CaptureSupport.ts:158-216`) | solid: xAI `POST /stt` | OC capture + BB fallback logic |
| **STT streaming** | — | — (segments only) | solid: xAI WS `/stt` with `endpointing=450`, `smart_turn=0.7` (`conversation.ts:549-601`) | PG |
| **TTS** | solid: `ttsFor`, `speakable`, `autoSpeak`, iOS tap fallback (`tools.js:374-416`) | solid: `SpeechOutput` with generation counter, cache, browser fallback and **stream tap**; truncates at 4000 chars with no chunking | solid: REST TTS with **expressive tags** and speed; WS TTS with timestamps (unreachable) | OC `SpeechOutput` per agent + PG tags + PG `SentenceChunker` for chunking |
| **Realtime speech-to-speech** | partial: xAI browser-direct, `ScriptProcessor`, fake barge-in (`voice.js`) | partial: OpenAI WebRTC and xAI WS, good barge-in, never live-tested (`VoiceChat.ts:573,637,1031`) | solid for xAI: DO-held per-turn socket; partial for OpenAI Live with sideband | PG server-mediated + OC event handling |
| **Vision input** | solid: images and tool screenshots → vision turn | solid: vision gate with honest note; `describeImage`; captions on frames | — | OC |
| **Image generation** | solid: `gpt-image-2`, `grok-imagine-image-2.0` | solid: 4 families with size mapping (`server/providers/images.ts`) | solid: `grok-imagine-image-2.0` at 3:4 with the portrait prefix | OC service + PG prompt prefixes |
| **Image edit** | stub: xAI `/images/edits` with no client caller | absent | solid: identity-preserving portrait edit | PG (generalise) |
| **Video generation** | absent | solid: xAI `grok-imagine-video-1.5` job with poll and MP4 proxy (`server/providers/video.ts`) | absent | OC |
| **Video understanding** | solid on the bridge: ffmpeg key frames (≤12) | absent | absent | BB (move server-side) |
| **Embeddings** | solid: OpenAI, Workers AI, Ollama, mock; model-tagged | solid: Ollama first, then OpenAI; dimension-safe | absent | BB + OC `VectorIndex` rules |
| **File ingestion** | solid: pdf.js, CSV, JSON, media, 32k-char bounded untrusted context (`files.js`) | solid: DOCX, **XLSX without SheetJS**, PDF, RFC 4180 CSV/TSV, JSON, text, images, audio (`input/Modules/FileProcessor.ts:628-691`) | solid: unpdf and mammoth, server-side (`content.ts:162-194`) | OC client + PG server extraction |
| **Folder context** | bridge fs | solid: File System Access, ignore rules, diff (`FolderContext.ts`) | — | OC |
| **Camera / screen capture** | absent | solid: interval snapshots, `SingleFlight` descriptions, truthful privacy dot (`CameraInputManager.ts`, `CaptureContextPublisher.ts`) | partial: camera for portraits only | OC |
| **Web search with citations** | solid: native plus `/api/search` | solid: Anthropic and xAI with normalised citations (`websearch.ts`) | — | OC normaliser + BB native tools |
| **Document generation** (DOCX/XLSX/PPTX) | solid via sandbox skills (openpyxl, python-pptx) | partial: DOCX round-trip bugs (`shared/Components/Document.tsx`) | — | BB skills (bridge) |
| **Face landmarks** | — | — | solid: MediaPipe in the browser | PG |

**Overlaps and conflicts.**
- There are two TTS clients: BB post-hoc whole-reply TTS, and OC `SpeechOutput`.
- There are three realtime stacks (§5 T5).
- STT defaults differ: BB `gpt-transcribe`, OC `gpt-4o-mini-transcribe`, PG xAI-only.
- OC captures every frame as a card and a memory, which is noisy (oc4 §7.9).

**White space.**
- Video generation beyond xAI.
- Video and audio *understanding* server-side.
- Image-edit UI for general assets.
- OCR for scanned PDFs.
- PPTX ingestion.
- **Streaming TTS with timings** for every provider.
- Multilingual STT and TTS (PG hard-codes `language=en`).
- Screen share into a live **meeting** as shared context for all agents.
- Frame-differencing and card coalescing for ambient capture.
- Exporting a meeting as an avatar video or MP4.

### P9 — Context & memory

| Feature | Src | Maturity | Where |
|---|---|---|---|
| Memory facts (`remember`/`recall` lexical; bot, shared and project scopes; `/forget`) | BB | solid (lexical only) | `biz-bot/public/js/tools.js:268-290`, `store.js:593-650` |
| **Memory as editable Markdown** with echo-safe two-way sync | BB | solid (bridge) | `biz-bot/public/js/memory-files.js`, `memory-sync.js`, `bridge/src/runner/memory.js` |
| Reflection **as a proposal**: a compaction diff becomes an Inbox decision; weekly mode | BB | solid (bridge) | `biz-bot/bridge/src/runner/reflect.js`, `triggers.js:108` |
| Typed memory (`semantic, episodic, procedural, profile`) with provenance, decay and `memory_link` | BB | partial (no UI caller) | `biz-bot/public/js/runtime/content-store.js` |
| IndexedDB vector store: sentence chunks, model-tagged, brute force | BB | solid (does not scale) | `biz-bot/public/js/vectors.js` |
| Project context bundle per turn (≤20 decisions, ≤25 artifacts) | BB | solid | `biz-bot/public/js/projects.js:24` |
| Per-agent perspective history, bounded external attachments (32k) | BB | solid | `biz-bot/public/js/swarm.js:32-72` |
| **ContextCard** lifecycle: upsert by id, consume on send, retire, archive | OC | solid | `oncloudnine/shared/Modules/ContextBus.ts:1-11`, `app/ViewModels/ChatViewModel.ts:335-445` |
| Graph identity (`name\|type` keys, rename-merge, cascade delete) | OC | solid | `oncloudnine/shared/Modules/Memory/MemoryStore.ts:139-160,480-520` |
| BM25 index with prefix expansion (k1 1.2, b 0.75) | OC | solid | `shared/Modules/Memory/FtsIndex.ts:18-153` |
| Dimension-safe cosine plus weighted RRF (k 60) | OC | solid | `shared/Modules/Memory/VectorIndex.ts:50-126` |
| Bounded hybrid recall with provenance labels as a **visible chip** (limit 4, 1200 chars, 3 s embed timeout) | OC | solid | `shared/Modules/Memory/MemoryRecall.ts:32-186` |
| Chunk-first, debounced extraction; self-throttle on 503 | OC | solid | `shared/Modules/Memory/GraphExtractor.ts:102-263`, `server/api/extractMemory.ts` |
| Memory panel with d3 graph, edit and "memory used" | OC | solid (search is BM25 only) | `oncloudnine/app/Components/MemoryPanel.tsx` |
| **Budgeted per-turn brief**: profile 6k, files 20k, facts 7k (newest win), summaries 3k, recent 6k; "reference data, not instructions" | PG | solid | `personagram-ai/src/worker/doppelganger.ts:451-664` |
| Knowledge cards with explicit approval and per-link selection (≤24k) | PG | solid (no retrieval) | `personagram-ai/src/worker/creator.ts:148-166`, `content.ts:162-194` |
| Distillation `{summary, facts[], instructions[]}` at session end, including a 120 s tab-close wrap-up | PG | solid | `doppelganger.ts:675-724`, `conversation.ts:180-200` |
| "Conversation so far" (≤6k) in every per-turn realtime brief | PG | solid | `personagram-ai/src/worker/providers.ts:469-481` |

**Best-of.**
- **OC algorithms and UX**: graph identity, BM25+vector+RRF, chunk-first extraction, visible recall chips. Port them **server-side** to D1 plus Vectorize.
- **BB editability and governance**: a Markdown projection per scope, reflection as a reviewable diff.
- **PG context assembly**: per-section budgets, approval before publishing, distillation.

**Overlaps and conflicts.**
- There are three memory stores with different identity models: BB facts by id per scope, OC entities by `name|type`, PG rows.
- There are two vector stores: BB IndexedDB brute force and OC IndexedDB. Both are browser-only.
- PG stuffs the prompt instead of retrieving.
- OC extraction is noisy for captures.

**White space.**
- A **company knowledge graph**: customers, products, KPIs, people.
- **Connector-fed business data** with sync and retention.
- Per-agent and per-project **memory permissions**.
- Retrieval over artifacts and runs.
- Temporal facts and conflict detection.
- **Memory audit and undo**. OC deletes are hard deletes.
- A context-budget visualiser per agent turn.
- Re-embedding on model change.
- A `company.md` business context file (suggested by BB reports).

### P10 — Tools, connectors, MCP, self-extension, in-app apps

| Feature | Src | Maturity | Where |
|---|---|---|---|
| Bot tool loop: ≤8 iterations, parallel calls, identical-failure guard, hooks | BB | solid | `biz-bot/public/js/agent.js:93` |
| Worker MCP client (Streamable HTTP; negotiates `2025-11-25` → `2025-06-18` → `2025-03-26`) | BB | solid (tools only) | `biz-bot/worker/src/mcp.js` |
| Bridge MCP client (stdio without a shell, scrubbed env, idle stop; private HTTP) | BB | solid | `biz-bot/bridge/src/mcp-client.js` |
| Connector catalog: 11 business servers, token-pending state, `mcpTarget` routing | BB | partial (**OAuth docs-only**) | `biz-bot/public/connectors/catalog.json`, `public/js/connectors.js` |
| Bounded self-extension `system` tool: 9 tools, tiers 0/1/2, budgets 3/12/40, taint, `looksLikeSecret`, audit and Undo | BB | solid | `biz-bot/public/js/system-tools.js:10-11,63` |
| Skills catalog (14) with versioned skills | BB | solid | `biz-bot/public/skills/catalog.json`, `public/js/skills.js` |
| Sandboxed apps with the `window.bizbot` SDK (opaque srcdoc, `connect-src 'none'`, permissions, rate limit, approvals) | BB | solid | `biz-bot/public/js/app-host.js`, `apps.js` |
| Local tools: sandbox chain, realpath-confined fs, Playwright with `ref_N` snapshots and take-over, password guard | BB | solid | `biz-bot/bridge/src/{exec,fs,browser}.js`, `sandbox/*` |
| SSRF-safe `fetch_page` | BB | solid | `biz-bot/worker/src/fetch-page.js` |
| Bounded tool-output envelope (never cuts JSON) | BB | solid | `biz-bot/public/js/tool-output.js` |
| Workers-native MCP client: Streamable HTTP, **legacy SSE**, stdio through a host bridge; per-hop SSRF | OC | solid (tools only) | `oncloudnine/server/mcp/client.ts` |
| MCP namespacing, **bijective wire names**, schema normalisation (depth ≤8, ≤64 properties) | OC | solid | `oncloudnine/server/mcp/schema.ts:66-79` |
| MCP tools bridged into realtime voice (cap 24, hijack-safe) | OC | solid | `oncloudnine/app/Modules/VoiceChat.ts:348` |
| Configuration-derived built-in tools; request allowlist can only remove | OC | solid | `oncloudnine/server/lib/agentRuntime.ts:595-614` |
| Themed HTML app generator (revise via `html`) | OC | solid (prompt is whimsical) | `oncloudnine/server/api/createApplication.ts:74` |
| Canvas experiences: sketch ‖ full, `EXPERIENCE_CSP`, `REPORTER` self-repair, `PG_ASSETS` | PG | solid | `personagram-ai/src/worker/experiences.ts:67-80,203-227,546,584-595` |
| Tool side-effects streamed as UI events ("Learned: …") | PG | solid | `personagram-ai/src/web/doppelganger.ts:503` |
| Capability-scoped tool dispatch with adversarial tests | PG | solid | `personagram-ai/src/worker/conversation.ts:414-421`, `tests/integration.test.ts:1087` |

**Best-of.**
- **MCP**: the OC client (namespacing, schema normalisation, SSE legacy, per-hop SSRF), combined with BB version negotiation, the bridge stdio client and the **relay** for CLI agents, and the BB connector catalog.
- **Self-extension**: the BB `system` tool pipeline, unchanged.
- **In-app apps**: the BB SDK and permissions, plus the PG build, repair and CSP loop and the `builderPrompt` quality contract.
- **Tool safety**: PG role-scoped offering, re-checked at dispatch.

**Overlaps and conflicts.**
- There are two MCP clients with different protocol versions.
- There are three HTML-app generators with different sandbox flags:
  - BB: `allow-scripts allow-forms allow-modals`
  - OC: `allow-scripts`, sometimes with `allow-forms`
  - PG: `allow-scripts allow-pointer-lock` plus CSP headers
- BB OpenAI remote MCP runs with `require_approval:'never'`, which bypasses grants.
- MCP results are **not taint-wrapped** in BB.

**White space.**
- **OAuth 2.1/PKCE for MCP connectors**.
- MCP resources, prompts, sampling and elicitation.
- A server-side secret vault. BB keeps tokens in localStorage.
- A per-persona tool-grant UI.
- Inbound webhooks.
- Governed **send, email, calendar and payments** tools.
- A marketplace for skills and playbooks.
- Publishing agent-built apps to guests with data scoping. BB's non-project apps see all artifacts.

### P11 — Navigation & UX

| Feature | Src | Maturity | Where |
|---|---|---|---|
| Conversations with persistent per-conversation views, a **task dock** of running threads, drafts per conversation | BB | solid | `biz-bot/public/js/controllers/conversations.js`, `drafts.js` |
| Simple vs Full modes (Chat · Projects · Inbox · "+ Delegate a project") | BB | solid | `biz-bot/public/js/mode.js`, `controllers/chrome.js:138-173` |
| Team graph (Room and Plan modes) with inspector, "Show in chat", replay scrubber and a composer under the graph | BB | solid | `biz-bot/public/js/graph.js` |
| Home: goals board, active-agents graph, Ideas | BB | solid | `biz-bot/public/js/home-graph.js`, `project-view.js` |
| Hash router, 14-section Admin with `?` help, empty-state onboarding, mobile visual-viewport | BB | solid | `router.js`, `components/*` |
| Single chat surface with plain-language tool steps, capability-hidden controls, error sentences | OC | solid | `oncloudnine/app/Components/ChatView.tsx`, `ChatComposer.tsx` |
| Pending tray: elapsed clock, progress, stop, retry, auto-open | OC | solid | `oncloudnine/app/Components/PendingTray.tsx` |
| Voice panel (status pill, mode and voice pickers, transcript) and voice mode matrix | OC | solid | `app/Components/VoicePanel.tsx`, `app/Modules/VoiceMode.ts:175` |
| Show/Talk/Share capture verbs, truthful privacy dot, drop-anywhere overlay | OC | solid | `oncloudnine/input/Components/{MediaInput,DropOverlay}.tsx` |
| Accessibility discipline: 44 px targets, no emoji chrome, no horizontal scroll at 375 px, light/dark/system | OC | solid | `app/Styles/*`, `app/Modules/Theme.ts` |
| Immersive stage: blurred ambient portrait, presence status line, countdown, interrupt, CC drawer, recovery panel | PG | solid | `personagram-ai/src/web/guest.ts`, `doppelganger.ts` |
| Customize drawer, talk-first creation, "Learned: …" chips | PG | solid | `personagram-ai/src/web/doppelganger.ts`, `avatars.ts` |
| Group stage with seats, seek, ready band, keyboard player, replay page | PG | solid | `personagram-ai/src/web/groups.ts` |
| Readability and accessibility tests (200% scaling, reduced motion, copy rules) | PG | solid | `personagram-ai/public/readability.css`, `tests/e2e/accessibility.spec.ts` |
| Spatial office, desks, joinable meetings | all | **absent** | — |

**Best-of.**
- **PG** for "join an agent": the stage, status line, captions and interrupt.
- **OC** for the chat surface, tray, capture and accessibility discipline.
- **BB** for the information architecture: conversations, projects, inbox, Simple/Full, the goals board, and the graph as the precursor of the Floor.

**Overlaps and conflicts.**
- BB and PG are dark-only; OC has light, dark and system.
- There are three toolkits (§5 T1).
- BB uses a sidebar list, OC a drawer plus tabs, PG a studio sidebar.

**White space.**
- **The Floor**: a spatial office with desks, rooms and presence, with a list fallback.
- **Join, listen and whisper from anywhere**.
- A picture-in-picture floating speaker while browsing other screens.
- A per-agent timeline.
- An **audio mixer** (solo, mute agents).
- A notification centre.
- A command palette.
- A mobile "walkie-talkie" mode for the lead.
- Keyboard navigation of the office.

### P12 — Trust & governance

| Feature | Src | Maturity | Where |
|---|---|---|---|
| `approveAction` single gate plus scoped grants. Kinds: once, task, session, hours, standing. `REFUSED` money, payment, send, email, message, identity, login, credentials. | BB | solid (card and kind mismatch for system and app) | `biz-bot/public/js/tools.js:55`, `grants.js` |
| Untrusted-content framing plus turn taint | BB | partial (MCP, search and delegate outputs are not wrapped) | `grants.js:86`, `agent.js:226` |
| Audit trail with cost; self-extension Undo | BB | solid | `grants.js:94`, `system-tools.js` |
| Cost budgets and annoyance budget | BB | partial (no `rates`) | `biz-bot/public/js/budgets.js`, `runtime/ledger.js:51-63` |
| Bridge auth: Host pinning, bearer plus origins, constant-time compare, throttle, PNA/LNA; sandbox chain | BB | solid | `biz-bot/bridge/src/auth.js`, `sandbox/*` |
| Secret redaction in sync; `looksLikeSecret` | BB | solid | `biz-bot/public/js/sync.js:23-31`, `system-tools.js` |
| Policy-table guard, **protected by default**; three rate classes; HMAC session tokens | OC | solid (per-isolate limits) | `oncloudnine/server/lib/security.ts:51,596,648` |
| SSRF policy re-checked on every redirect hop | OC | solid (no DNS-rebinding defence) | `oncloudnine/server/mcp/net.ts:147` |
| Peer-address locality gate (fixes an RCE) | OC | solid | `security.ts:236` |
| Allowlist DOM sanitiser, sandbox without `allow-same-origin`, `textContent` for untrusted text | OC | solid | `oncloudnine/shared/Components/Markdown.tsx`, `Document.tsx:29-96` |
| Log-hygiene test; deploy preflight scans published assets for config values | OC | solid | `oncloudnine/test/unit/server-api.test.js:571`, `tools/deploy.ts` |
| Google OAuth with state and PKCE; hashed 30-day sessions | PG | solid | `personagram-ai/src/worker/security.ts:159-278` |
| Origin checks, bounded bodies, error redaction, CSP and Permissions-Policy | PG | solid | `security.ts:48-108`, `index.ts:1157-1203` |
| D1 rate limiter with **refunds** | PG | solid | `security.ts:131-153` |
| **Role-scoped tools**, re-checked at dispatch (adversarial tests) | PG | solid | `conversation.ts:414-421` |
| Consent-gated persistence; erase ends the live DO first | PG | solid | `conversation.ts:341-369` |
| Audio token bucket (48 B/ms), message and answer caps, expiry alarm | PG | solid | `conversation.ts:255-340` |
| Hashed bearer links with the raw token kept in the owner DO; path-scoped capability cookie | PG | solid | `creator.ts:127-306`, `index.ts:106-178` |
| Architecture guard tests: no key patterns in browser code, no voice cloning | PG | solid | `personagram-ai/tests/architecture-guard.test.ts` |
| Server-mediated realtime (the OpenAI Live data channel allowlist is empty) | PG | solid | `personagram-ai/src/worker/providers.ts:386-415` |

**Best-of.**
- **PG** for identity, sessions, consent, role-scoped tools and link security.
- **BB** for action governance: grants, taint, audit, Undo and the self-extension tiers.
- **OC** for the perimeter (policy table, rate classes, SSRF, sanitiser, preflight, log hygiene).

**Overlaps and conflicts.**
- There are three session models: Cloudflare Access (BB), HMAC tokens with a browser cookie (OC), and OAuth sessions (PG).
- There are three rate-limit designs: none (BB), per-isolate memory (OC), D1 upsert (PG).
- BB refuses sending and money outright, while the Workplace must allow them with approvals.
- BB OpenAI remote MCP bypasses approval.

**White space.**
- **Orgs, RBAC and staff seats**.
- A server-side **secret vault**.
- **Budgets that work for every provider**, carried on signals (OC deadline pattern) and reserved in the ledger (BB).
- A **unified audit log** across model calls, tool calls and data egress, including which frame went to which provider.
- **Approved real-world actions** with exactly-once effects.
- Ambient-capture consent per agent.
- PII redaction.
- Retention policies.
- A kill switch for all agents.
- Per-agent concurrency and rate caps.

### P13 — Business features

| Feature | Src | Maturity | Where |
|---|---|---|---|
| Templates as "business packs" (`personal-assistant`, `research`, `software`, `business-ops`); apply, export and import without secrets | BB | solid | `biz-bot/public/templates/*.json`, `public/js/templates.js` |
| Scenario library (12), Getting started page, one-question delegation | BB | solid | `biz-bot/public/js/scenarios.js`, `components/getting-started.js` |
| Share links for agents, conversations and rooms (payload trusted on import) | BB | solid / unsafe | `biz-bot/public/js/controllers/share.js` |
| Keyless demo via the Mock provider | BB | solid | `biz-bot/worker/src/providers/mock.js` |
| Local-only mode (Ollama), config bootstrap, token footer | OC | solid | `oncloudnine/tools/build.ts:32-128` |
| Consulting-services positioning | OC | docs-only | `oncloudnine/README.md` |
| Stripe: live pricing, idempotent checkout with a pre-persisted attempt, reconcile-by-current-state webhooks, portal | PG | solid | `personagram-ai/src/worker/billing.ts`, `creator.ts:307-486` |
| `PLAN_LIMITS = {free:3, pro:25}` and plan-aware rate limits | PG | solid | `personagram-ai/src/shared/domain.ts:3` |
| Five-step onboarding: paste, files, talk or typed intake; intake cost guards | PG | solid | `personagram-ai/src/web/studio.ts:28,412,459` |
| Share dialog with a **local QR encoder**, rotate and turn off | PG | solid | `personagram-ai/src/web/share.ts`, `qr.ts` |
| Marketing site with a text-only lip-sync demo; OG, Twitter and JSON-LD meta | PG | solid | `personagram-ai/src/web/marketing.ts`, `src/worker/meta.ts` |
| Showcase seed validated by tests | PG | solid | `personagram-ai/scripts/seed-demo.mjs`, `tests/demo-seed.test.ts` |
| Usage metering | PG | **stub** (`usage_events` never written) | `personagram-ai/src/worker/index.ts:1204-1225` |

**Best-of.**
- **PG** supplies billing, plan limits, onboarding intake, sharing and QR, meta and the showcase seed.
- **BB** supplies the template format as industry packs, Simple mode and the Mock-provider demo.

**Overlaps and conflicts.**
- BB and PG each have their own QR encoder: BB uses ECC L for the terminal and pairing, PG ECC M as SVG.
- BB's share import trusts `trust` and `permissionMode`.
- There is no metering anywhere.

**White space.**
- A pricing model for an agent workforce: seats plus usage credits, with budget caps.
- **Metering** of tokens, audio seconds, renders and tool calls.
- Customer-facing **guest doors** to coworkers (PG Personagrams applied to sales and support).
- **Industry business packs** that seed personas with faces and voices.
- A business-context onboarding interview (PG interviewer plus BB templates).
- ROI reporting ("hours saved").
- A marketplace for personas and playbooks.
- White-labelling.

### P14 — Infrastructure

| Feature | Src | Maturity | Where |
|---|---|---|---|
| Single deploy: Worker, assets, SQLite `RuntimeDO`, R2, Workers AI; `run_worker_first: ["/api/*"]` | BB | solid (one DO per deployment; no run keep-alive) | `biz-bot/wrangler.jsonc`, `worker/src/runtime/project-runtime.js` |
| DO SQLite `kv` and `events` tables; R2 fs with the same contract as the bridge | BB | solid | `biz-bot/worker/src/runtime/{storage,fs}.js` |
| Protocol-2 record sync (rev, tombstones, "resolved beats pending") | BB | solid | `biz-bot/public/js/sync.js`, `store.js` |
| Bridge server, in-process worker host, pairing with auto-TLS | BB | solid (patches globals) | `biz-bot/bridge/src/{index,worker-host,pair,tls}.js` |
| Health, honest `limits`, `RuntimeUnavailable`, `runtime-auto` pinning | BB | solid | `biz-bot/public/js/runtime/{runtime,runtime-auto}.js` |
| Test assets: fake cloud (SQL, R2, DO), captured CLI fixtures, 5 Playwright suites, `verify:live` / `verify:local` canaries | BB | solid | `biz-bot/worker/test/fake-cloud.mjs`, `bridge/test/fixtures/*`, `scripts/verify-live.mjs` |
| CI deploy workflow | BB | docs-only | README step 5 |
| Pages advanced-mode Worker plus KV; 18 exact routes; dual-runtime dev server with KV shim | OC | solid | `oncloudnine/server/_worker.ts:29-94`, `tools/serve.ts` |
| Deploy preflight (13 checks, leaked-config scan), build fingerprint plus e2e guard, doc-sync and drift tests | OC | solid | `oncloudnine/tools/deploy.ts`, `test/e2e/support/dev-server-guard.mjs` |
| Zero-dependency fixture generator (PDF, DOCX, XLSX, PNG, WAV) | OC | solid | `oncloudnine/scripts/make-fixtures.mjs` |
| Custom concatenating bundler and JSX runtime | OC | partial (fragile) | `oncloudnine/tools/build.ts`, `shared/element.ts` |
| Worker with 3 SQLite DO classes (`CreatorDO`, `ConversationDO`, `BuilderDO`), D1 (7 migrations), private R2, cron `0 3 * * *` | PG | solid | `personagram-ai/wrangler.toml`, `migrations/*.sql` |
| Wrangler integration harness with HTTP/WS stubs of xAI and Stripe, including adversarial tool calls | PG | solid | `personagram-ai/tests/integration.test.ts`, `tests/stripe-stub.ts` |
| esbuild ESM build; fake-canvas and WebAudio unit tests; Playwright on desktop and iPhone 13 | PG | solid | `personagram-ai/scripts/build.mjs`, `tests/renderer.test.ts` |
| Observability | PG, OC | absent | — |

**Best-of.**
- **PG topology**: an entity DO per owner, session and job, plus D1, R2 and the Wrangler integration harness.
- **BB engine hosting and test strategy**: a portable engine in a DO, the Mock provider, fake cloud, and live canaries.
- **OC ship-safety**: preflight, fingerprint guard, doc-sync and drift tests, fixture generator.

**Overlaps and conflicts.**
- Workers plus DOs (BB, PG) versus Pages plus KV (OC).
- A single deployment-wide DO (BB) versus per-entity DOs (PG).
- Three build systems.
- BB patches `globalThis.fetch` and `localStorage` inside the DO and bridge.

**White space.**
- A DO topology designed for N rooms × N agents: WebSocket hibernation, **Queues** for fan-out, **Vectorize**, per-tenant sharding.
- Tracing and cost telemetry.
- Load tests for concurrent avatars and voice streams.
- CI/CD.
- Migrations for DO storage.
- Multi-region audio latency.

---

## 4. Provider & model union

All ids and endpoints below appear in code. Catalogs are hand-maintained and several are future-dated relative to the code's own notes. **Treat every id as data to verify against live discovery**, not a fixed truth.

### 4.1 Chat / reasoning models

| Provider | Model id | Used by | For | Endpoint / dialect |
|---|---|---|---|---|
| Anthropic | `claude-opus-5` | BB (default; vision, reasoning, 1M), OC (the only model; chat, streaming, vision, tools, search) | Default chat; planner candidate | `POST https://api.anthropic.com/v1/messages`, `anthropic-version: 2023-06-01` |
| Anthropic | `claude-sonnet-5` | BB (fast; `search()` model) | Fast chat, search | same |
| Anthropic | `claude-haiku-4-5` | BB (fast, no adaptive thinking) | Fast chat | same |
| Anthropic | `claude-fable-5` | BB | Chat | same |
| Anthropic | `claude-opus-4-8`, `claude-sonnet-4-6` | BB | Chat | same |
| Anthropic (Claude Code CLI) | aliases `sonnet` (default), `opus`, `haiku`; `claude-opus-5`, `claude-sonnet-5`, `claude-fable-5-1`, `claude-haiku-4-5-20251001` | BB bridge | Coding-agent coworkers | `claude -p --output-format stream-json --verbose --include-partial-messages …` |
| OpenAI | `gpt-5.6-sol` (default), `gpt-5.6-terra`, `gpt-5.6-luna` (fast; `search()` model), `gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.4-nano`, `gpt-5.1`, `gpt-4.1`, `gpt-4.1-mini` | BB | Chat and reasoning (`low/medium/high/xhigh`) | `POST https://api.openai.com/v1/responses` (`store:false`) |
| OpenAI | `gpt-5.2` | BB (catalog), OC (default) | Chat | BB and OC: `/responses` |
| OpenAI (Codex CLI) | `default` (from `~/.codex/config.toml`), `gpt-5.5`, `gpt-5.5-codex`, `gpt-5.4`, `gpt-5-codex`, `gpt-5-mini` | BB bridge | Coding-agent coworkers | `codex exec --json …`, `codex exec resume`, `codex app-server --stdio` |
| xAI | `grok-4.6` | BB (default), PG (`MODELS.xai.text`: interview JSON, bulk fill, summaries, distillation) | Chat and text | BB: `POST https://api.x.ai/v1/responses`; PG: `/chat/completions` |
| xAI | `grok-4.5` | BB, OC (default) | Chat | BB: `/responses`; OC: `/chat/completions` (compat) |
| xAI | `grok-4.3` | BB (fast, 1M; `search()` model), OC | Chat, search | same |
| xAI | `grok-4.20-multi-agent`, `grok-4.20-reasoning`, `grok-4.20-non-reasoning` (fast), `grok-build-0.1` (coding) | BB | Chat | `/responses` |
| xAI | `grok-4.20-0309-non-reasoning` | PG (`MODELS.xai.chat` and `.builder`: replies, casting, directing, canvas builder) | Low-TTFT replies (~0.5 s) and page building | `/chat/completions` (`store:false`, ≤3 tool rounds) |
| Ollama (local) | dynamic from `/api/tags` (first tools-capable model is the default) | BB bridge | Local chat, tools, vision and thinking per model | `/api/version`, `/api/tags`, `/api/show`, `/api/chat` (NDJSON) |
| Ollama (local) | `qwen3:32b` | OC (dev-only) | Local chat with `reasoning_effort:'none'` | `{root}/v1/chat/completions` |
| OpenAI-compatible local | dynamic from `/v1/models` (LM Studio, llama.cpp, vLLM) | BB bridge (`local-openai`) | Local chat | `/v1/chat/completions` |
| Mock | `mock-1` | BB (`ENABLE_MOCK=true`) | Keyless demos and e2e | in-process |
| Cloudflare Workers AI | (embeddings only; see §4.2) | BB | — | `env.AI.run()` |
| **Google Gemini** | — | **none** | — | **absent** (grep-verified) |

**Server tools and native tools.**

| Provider | Tools | Used by |
|---|---|---|
| Anthropic | `web_search_20260209` | BB, OC |
| Anthropic | `web_fetch_20260209`, `code_execution_20260120`; beta header `server-side-fallback-2026-07-01` with `fallbacks:'default'` for `claude-(opus-5\|fable-5\|mythos-5)` | BB |
| OpenAI Responses | `web_search`, `code_interpreter`, `image_generation` (`gpt-image-2`), remote `mcp` (`require_approval:'never'`) | BB |
| xAI Responses | `web_search`, `x_search`, `code_interpreter`, `image_generation`, `mcp` | BB |
| xAI Responses | `web_search` | OC (Live Search `search_parameters` now returns 410) |

### 4.2 Embeddings

| Provider | Model | Dims | Used by | Endpoint |
|---|---|---|---|---|
| OpenAI | `text-embedding-3-small` | 1536 | BB (default) | `POST /v1/embeddings` |
| OpenAI | `text-embedding-3-large` | 3072 | BB (option), OC (fallback) | same |
| Cloudflare Workers AI | `@cf/baai/bge-base-en-v1.5` | 768 | BB (keyless fallback; batches of 100, 2000 chars) | `env.AI.run()` |
| Ollama | dynamic (prefers nomic, bge, minilm) | model-dependent | BB bridge | `/api/embed` |
| Ollama | `nomic-embed-text` | 768 (per oc 00 §5) | OC (preferred) | `{root}/api/embed` |
| OpenAI-compatible | ids matching `/embed/` | — | BB bridge | `/v1/embeddings` |
| Mock | `mock-embed` | 64 (hashed) | BB | in-process |
| xAI, Anthropic | none | — | — | — |

### 4.3 Speech-to-text

| Provider | Model | Used by | Endpoint / notes |
|---|---|---|---|
| OpenAI | `gpt-transcribe` (default), `gpt-4o-transcribe`, `whisper-1` | BB | `POST /v1/audio/transcriptions` (multipart) |
| OpenAI | `gpt-4o-mini-transcribe` | OC (batch and realtime input transcription) | same; OC sends `prompt` (rolling transcript) |
| xAI | `grok-stt` (label only; the endpoint takes no model) | BB, OC, PG | `POST https://api.x.ai/v1/stt`, multipart with the `file` part last. OC drops `prompt`; PG sends `language=en` |
| xAI streaming | — | PG | `WS /stt?sample_rate=24000&encoding=pcm&interim_results=true&endpointing=450&smart_turn=0.7&smart_turn_timeout=1800`; events `transcript.created`, `transcript.partial{text,speech_final}` |
| Browser | Web Speech API `SpeechRecognition` / `webkitSpeechRecognition` | BB (fallback with auto-switch), OC (dictation, bounded restart) | — |
| Mock | `mock-stt` | BB | — |

### 4.4 Text-to-speech

| Provider | Model | Used by | Endpoint / notes |
|---|---|---|---|
| OpenAI | `gpt-4o-mini-tts` (default, supports `instructions`), `tts-1-hd` | BB (`gpt-4o-mini-tts` default) | `POST /v1/audio/speech` (input ≤4096) |
| OpenAI | `gpt-4o-mini-tts` | OC | `POST /v1/audio/speech` (text ≤4000); returns `X-Speech-Voice` and `X-Speech-Provider` |
| xAI | `grok-tts` (label only) | BB, OC, PG | `POST https://api.x.ai/v1/tts {text (≤15000), voice_id, language, output_format:{codec mp3\|wav\|pcm, sample_rate 24000, bit_rate}}`. BB clamps speed to 0.7–1.5; PG clamps to 0.85–1.15 and adds expressive tags |
| xAI streaming with timestamps | — | PG (implemented, **unreachable**) | `WS /tts?language=en&voice=…&codec=pcm&sample_rate=24000&with_timestamps=true` → `audio.delta{delta, audio_timestamps{graph_chars,graph_times}}` |
| xAI voice catalog | — | PG | `GET /tts/voices` (cached 1 h) |
| Browser | `speechSynthesis` | OC (no-key fallback; lip sync falls back to text timing) | — |
| Mock | `mock-tts` | BB | — |

### 4.5 Realtime speech-to-speech

| Provider | Model | Used by | Mint / transport |
|---|---|---|---|
| OpenAI Realtime | `gpt-realtime-2` (override `OPENAI_MODEL_RT`) | OC | Mint at `POST /v1/realtime/client_secrets` with the GA session shape (`server_vad`: threshold 0.5, prefix 300 ms, silence 500 ms, `interrupt_response:true`). The browser connects over **WebRTC** by posting SDP to `https://api.openai.com/v1/realtime?model=…`. Metadata comes back in `X-Realtime-*` headers. |
| OpenAI Live | `gpt-live-1` | PG | `POST /v1/live/sessions {session:{model, instructions, delegation:{type:"client"}, store:false, audio.output.voice, client.data_channel.allowed_*:[]}, transport:{type:"webrtc", sdp}}`. **Sideband WS** at `/live/sessions/{id}/attach` handles `session.commentary.append`, `session.instructions.append` and `session.input_audio.mute/unmute`. Hang up with `POST /live/sessions/{id}/hangup`. |
| xAI | `grok-voice-latest` | BB, OC | Mint at `POST https://api.x.ai/v1/realtime/client_secrets {expires_after:{seconds}}`. The **browser** connects directly to `wss://api.x.ai/v1/realtime?model=…` with subprotocol `xai-client-secret.<token>`, PCM16 at 24 kHz and `server_vad`. |
| xAI | `grok-voice-think-fast-2.0` | PG | A **server-held** fresh socket per turn: `WS /realtime?model=grok-voice-think-fast-2.0`, `turn_detection:null`, tools batched with one follow-up `response.create`. |

### 4.6 Image, video and vision

| Capability | Provider | Model | Used by | Endpoint |
|---|---|---|---|---|
| Image generation | OpenAI | `gpt-image-2` | BB (default; n≤4) | `POST /v1/images/generations` |
| Image generation | OpenAI | `gpt-image-1` (legacy `dall-e-3`, `dall-e-2` only if pinned) | OC | same (family table with size mapping) |
| Image generation | xAI | `grok-imagine-image-2.0` | BB (default), PG (portraits, `aspect_ratio:"3:4"`, `b64_json`) | `POST https://api.x.ai/v1/images/generations` |
| Image generation | xAI | `grok-imagine-image`, `grok-imagine-image-quality` | BB, OC | same |
| Image edit | xAI | same models | BB (server-only; no client caller), PG (identity-preserving portrait edit) | `POST /v1/images/edits {image:{url:<data URL \| https>}}` |
| Video generation | xAI | `grok-imagine-video-1.5` (default), `grok-imagine-video` | OC | `POST /v1/videos/generations {model,prompt,duration,aspect_ratio,resolution}`, then `GET /v1/videos/{request_id}`. OpenAI Videos/`sora-2` was removed from code (deprecation note: Sept 2026 shutdown). |
| Vision input | Anthropic, OpenAI, xAI chat models | per model flags | BB (all), OC (`VISION_PROVIDER_ORDER = anthropic→openai→xai`, `/api/describeImage`) | chat endpoints |
| Face landmarks (client) | Google MediaPipe | `@mediapipe/tasks-vision@0.10.35`, `face_landmarker/float16/1` | PG | jsDelivr `+esm` and `storage.googleapis.com` model file |
| Mock | — | `mock-image` (1×1 PNG) | BB | in-process |

### 4.7 Voice catalogues (deduplicated)

| Catalogue | Voices | Used by |
|---|---|---|
| OpenAI TTS (BB) | marin (default), cedar, alloy, ash, ballad, coral, echo, fable, onyx, nova, sage, shimmer, verse — 13 | BB |
| OpenAI TTS and Realtime (OC) | alloy, ash, ballad, coral, echo (default), sage, shimmer, verse — 8 | OC (TTS and realtime) |
| OpenAI Live (PG) | alloy, ash, ballad, beacon, bossa, cedar, cinder, coral, delta, echo, gleam, marin, meridian, quartz, ripple, sage, shimmer, stone, tempo, verse, vesper, willow — 22 | PG |
| xAI TTS | eve, ara, leo, rex, sal, carina, zagan, helix, orion, luna, iris, altair, zenith, perseus, helios, lux, kepler, rigel, cosmo, celeste, ursa, sirius, lumen, castor, naksh, atlas — 26 | BB, OC (default `eve`); PG loads dynamically via `GET /tts/voices` (default `ara`) |
| xAI realtime | eve (default), ara, rex, sal, leo — 5 | OC; BB (default `eve`) |
| Persona default | `shimmer` | OC `PersonaSettings` |

**Union of OpenAI voices:** alloy, ash, ballad, beacon, bossa, cedar, cinder, coral, delta, echo, fable, gleam, marin, meridian, nova, onyx, quartz, ripple, sage, shimmer, stone, tempo, verse, vesper, willow. That is 25, and availability differs by endpoint. **Load the catalogue from the provider per endpoint** (PG pattern for xAI), then validate against it (PG `validateVoice`) and test for drift (OC).

### 4.8 Protocols and non-LLM external APIs

| Kind | Detail | Used by |
|---|---|---|
| MCP client | Negotiates `2025-11-25` → `2025-06-18` → `2025-03-26`; Streamable HTTP; tools only | BB worker (`worker/src/mcp.js`) |
| MCP client | `2025-06-18`; stdio | BB bridge (`bridge/src/mcp-client.js`) |
| MCP server (relay) | Default `2025-03-26`, echoes the client's version | BB bridge (`bridge/src/mcp-server.js`) |
| MCP client | `2025-06-18`; Streamable HTTP, legacy SSE, stdio through `MCP_HOST` | OC (`server/mcp/client.ts`) |
| MCP connector catalog | Cloudflare docs `https://docs.mcp.cloudflare.com/mcp`, DeepWiki `https://mcp.deepwiki.com/mcp`, GitHub `https://api.githubcopilot.com/mcp/`, Notion `https://mcp.notion.com/mcp`, HubSpot `https://mcp.hubspot.com/anthropic`, QuickBooks `https://ai-inc.quickbooks.intuit.com/v1/mcp`, Xero `https://mcp.xero.com/mcp`, Asana `https://mcp.asana.com/v2/mcp`, monday.com `https://mcp.monday.com/mcp`, Calendly `https://mcp.calendly.com/`, Canva `https://mcp.canva.com/mcp` | BB (`public/connectors/catalog.json`; OAuth entries are docs-only) |
| Google OAuth | `accounts.google.com/o/oauth2/v2/auth`, `oauth2.googleapis.com/token`, `openidconnect.googleapis.com/v1/userinfo` | PG |
| Stripe | `https://api.stripe.com/v1`: `/customers`, `/checkout/sessions` (and `/{id}`, `/{id}/expire`), `/subscriptions?customer=…&status=all&limit=100`, `/billing_portal/sessions`, `/prices/{id}` | PG |
| CDN libraries | markdown-it 14.1.0, DOMPurify 3.2.6 (jsDelivr), pdf.js 4.10.38 (cdnjs), Mermaid 11.12.0 | BB |
| CDN libraries | JSZip, docx-preview, docx, d3 v7, pdf.js 4.x (vendored) | OC |
| CDN libraries | MediaPipe 0.10.35 | PG |
| Server libraries | `unpdf`, `mammoth` | PG |
| Local tools probed | Docker, `sandbox-exec` (seatbelt), Playwright Chromium, ripgrep, ffmpeg/ffprobe, python3, mkcert/openssl | BB bridge |

### 4.9 Environment variable names (union; values never read)

- **BB worker:** `OPENAI_API_KEY`, `XAI_API_KEY`, `ANTHROPIC_API_KEY`, `ENABLE_MOCK`.
- **BB bridge:** `BRIDGE_*` (port, host, LAN, TLS, token, workspaces, sandbox, docker image, network, Claude and Codex bins, models and transports, MCP transport and limits, browser settings, runner limits), `OLLAMA_BASE_URL`, `LOCAL_OPENAI_BASE_URL`, `LOCAL_OPENAI_API_KEY`.
- **OC:** `ANTHROPIC_API_KEY`, `ANTHROPIC_API_URL`, `ANTHROPIC_MODEL`, `OPENAI_API_KEY`, `OPENAI_API_URL`, `OPENAI_MODEL`, `OPENAI_ORGANIZATION_ID` (legacy `OPENAI_ORG_ID`), `OPENAI_IMAGE_MODEL`, `OPENAI_MODEL_RT`, `OPENAI_INSTRUCTIONS`, `OPENAI_MAX_TOKENS`, `XAI_API_KEY`, `XAI_API_URL`, `XAI_MODEL`, `XAI_IMAGE_MODEL`, `XAI_VIDEO_MODEL`, `XAI_MODEL_RT`, `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `DEFAULT_PROVIDER`, `DEFAULT_MODEL`, `SYSTEM_PROMPT`, `ADMIN_SECRET`, `APP_SESSION_SECRET`, `ALLOWED_ORIGINS`, `API_RATE_LIMIT`, `AGENT_FETCH_ALLOWLIST`, `AGENT_MAX_STEPS`, `AGENT_MAX_WALL_CLOCK_MS`, `TASK_BACKGROUND_TOOLS`, `TASK_MAX_CONCURRENT`, `TASK_MAX_WALL_CLOCK_MS(_<KIND>)`, `TASK_RETENTION_MS`, `MCP_SERVERS`.
- **PG:** `APP_ORIGIN`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `XAI_API_KEY`, `OPENAI_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_ANNUAL`, `SESSION_CAP_SECONDS`, `DEMO_PERSONAGRAM_TOKEN`; test overrides `XAI_BASE_URL`, `OPENAI_BASE_URL`, `STRIPE_BASE_URL`.
- **Naming conflict to settle:** base-URL overrides are `*_API_URL` in OC and `*_BASE_URL` in PG and BB. Pick `*_BASE_URL`.

### 4.10 Discrepancies to resolve in the unified registry

1. **The same capability has different defaults in each project.**
   - OpenAI chat: `gpt-5.6-sol` (BB) vs `gpt-5.2` (OC).
   - OpenAI image: `gpt-image-2` (BB) vs `gpt-image-1` (OC).
   - OpenAI STT: `gpt-transcribe` (BB) vs `gpt-4o-mini-transcribe` (OC).
   - Embeddings: `-3-small` (BB) vs `-3-large` (OC). Mixing them is safe only with model-tagged, dimension-checked vectors, which both implement.
2. **Two xAI realtime models** (`grok-voice-latest` vs `grok-voice-think-fast-2.0`) and **two OpenAI realtime products** (`gpt-realtime-2` via client secrets vs `gpt-live-1` via Live sessions with delegation).
3. **Id spelling drift:**
   - `grok-4.20-non-reasoning` (BB) vs `grok-4.20-0309-non-reasoning` (PG).
   - `claude-fable-5` (API) vs `claude-fable-5-1` (Claude Code list).
4. **xAI chat dialect:** `/responses` (BB) vs `/chat/completions` (OC, PG).
5. **Preference orders:** chat is `openai→xai→anthropic→mock` (BB) vs `anthropic→openai→xai→ollama` (OC). Embeddings are `openai→mock→cloudflare` (BB) vs `ollama→openai` (OC).
6. **No pricing anywhere.** Add `rates {input, output, cached}` per model, or budgets stay broken (BB) or absent (OC, PG).

---

## 5. Key architectural tensions

Each tension lists the options found in the references, a recommendation and the reasoning.

| # | Tension | What the references do | Recommendation | Why |
|---|---|---|---|---|
| **T1** | **UI stack**: framework-free versus typed TSX with a framework | **BB**: no build, plain ES modules, a `html` tag with `paint()`, giant string templates. **OC**: a custom JSX-to-DOM runtime (fragments crash, `false` props become attributes) and a regex concatenating bundler. **PG**: custom elements with string `innerHTML` and esbuild. | **TypeScript end to end, Vite/esbuild, and a keyed-reconciliation UI framework** for the multi-pane shell (Floor, rooms, projects, inbox). Keep the **avatar and audio engine framework-agnostic**: pure TS modules plus the `<avatar-view>` custom element. Keep BB's discipline of "pure render, controller owns state, stable e2e selectors". | All three reports conclude that their DIY rendering will not scale to many live, streaming panes (oc3 §7, pg2 §7, bb2 §7). The PG avatar modules and OC pure-core modules are already DOM-free and tested under `node:test`. |
| **T2** | **Where agents run**: Worker plus Durable Objects, local bridge, or browser tab | **BB**: the portable engine runs in tab, bridge or cloud DO with `runtime-auto` per-plan pinning, one deployment-wide `RuntimeDO`, no alarm keep-alive. **OC**: Pages plus KV with work kept alive by `ctx.waitUntil`. **PG**: an entity DO per owner, session and job, alarm-driven. | **Cloud-first on Workers with entity DOs**: a `WorkspaceDO` per org (quota, billing, secrets, share tokens; from PG `CreatorDO`), a `ProjectDO` per project (plan engine, ledger, durable event bus with `?since`; from BB), a `RoomDO` per live room or meeting (provider sockets, participants, observers; from PG `ConversationDO`), and a `RunDO`/job per long task (alarm keep-alive and bounded retries; from PG `BuilderDO`). Keep the **BB bridge as an optional paired Desktop Companion** for shell, fs, browser, local models and CLI agents, with honest `limits` and per-plan pinning. **Never** execute in the tab by default. | A business owner expects work to continue when the laptop sleeps. BB's single DO and tab default are its main tenancy and durability flaws. PG's topology is proven in integration tests. |
| **T3** | **System of record**: browser storage versus server storage | **BB**: localStorage records plus IndexedDB logs, vectors and artifacts, with protocol-2 sync to the bridge or DO. **OC**: IndexedDB conversations and memory, CacheStorage files; server KV holds only tasks and config. **PG**: D1 rows, R2 blobs, DO storage. | **D1 for records, R2 for artifacts and audio, DO SQLite for hot per-project and per-room state, Vectorize for embeddings.** IndexedDB is only a **cache and offline layer**. Reuse **BB protocol-2 merge rules** (rev and `updatedAt`, tombstones, "resolved beats pending") for Companion ↔ cloud sync. | Multi-device, sharing, guests and audit all require a server-side truth. BB's 500-entry log cap and OC's browser-only memory are explicitly called out as limits. |
| **T4** | **Three provider layers** | **BB**: JS adapters that normalise into one event vocabulary (`text/reasoning/tool_call/citation/image/usage/done/error` plus `session/activity`), with completion enforcement and CLI and local providers. **OC**: a TS registry with capability orders, a dispatch table, and a tool loop over 3 dialects with seams (`interceptTool`, `seedMessages`, `toolOptions`). **PG**: a `MODELS` constant and hand-rolled SSE. | **One `models` package**: the OC registry shape (capability flags, per-capability orders, `requireProvider`, key-naming errors, one file of ids) **implemented with BB adapters**. Add Gemini, `rates` and discovery. **One agent loop**: OC `runAgentLoop` seams merged with BB `runBotTurn` behaviour (parallel tool calls, identical-failure guard, hooks for ledger reservations, partial output on error). **One event vocabulary**: BB's events extended with `agent_id`, `room_id`, `project_id` and the frames `handoff`, `message{from,to}`, `plan`, `approval_request`, `speech_start/end`, `viseme`, `emotion`. Keep BB's Mock provider. | BB has the broadest and most battle-tested adapters. OC has the cleanest selection and seam design. PG's layer is too narrow. |
| **T5** | **Voice stack**: browser-direct ephemeral tokens versus server-mediated DO | **BB**: browser ↔ xAI WebSocket with an ephemeral token, `ScriptProcessor`, no real barge-in. **OC**: browser ↔ OpenAI WebRTC or xAI WebSocket with an ephemeral token, good barge-in, never live-tested. **PG**: browser ↔ `ConversationDO` ↔ providers; keys and instructions never reach the client; generation counters; audio budgets. | **Server-mediated RoomDO by default** (PG), with an **AudioWorklet** uplink (PG `audio-worklet.js`) and **OC event handling** (GA and beta aliases, `VoiceTranscript`, voice-mode matrix). Allow browser-direct ephemeral mode only as a measured latency optimisation for **1:1 owner ↔ lead** sessions with no observers. | Listen-in, recording or replay, role-scoped tools, budgets and audit all need the server in the audio path. PG is the only stack tested end to end (for xAI) with interruption and budgets. |
| **T6** | **One brain or two** for voice and text | **OC**: realtime voice has its own client tools, separate from the chat orchestrator (gap 7.2). **PG**: voice front / brain back (OpenAI Live delegates, the server answers with a text LLM streamed back as commentary). **BB**: the realtime session runs the same browser tool runners. | **Voice front, brain back, provider-agnostic.** The realtime model handles turn-taking, fillers and barge-in only. Every tool call and every substantive answer goes to the **server orchestrator**, streamed back as `SentenceChunker` chunks. Tool calls within one response are batched with one follow-up (PG). | The Chief of Staff must be the *same agent* whether typed to, talked to, or in a meeting. It also keeps model choice and memory in one place. |
| **T7** | **Coworker speech in meetings**: realtime speech-to-speech versus LLM plus TTS | **PG groups**: director-written text, then TTS per line, stored in R2 for replay. **BB**: text turns with post-hoc TTS. | Coworkers in meetings use **their own text LLM turn** (BB `transcriptToMessages` perspective) and then **TTS per utterance** in their own voice (PG voicer with expressive tags). Only the lead uses realtime S2S. | Each coworker keeps its own model, tools and private context. The audio becomes a storable, replayable artifact, and cost is predictable. |
| **T8** | **Always voiced versus voice on demand** for agent-to-agent traffic | BB: no audio in rooms by design. PG: every line is voiced. | **Text-native, voiced on demand.** Agents converse in text at full speed. When an observer "listens in" to a room, the RoomDO voices the **live tail** through the writer ‖ voicer ‖ player pipeline with 3-line look-ahead (PG), plus a catch-up summary spoken by the lead. Voiced lines are stored for replay. | This controls TTS cost (PG allows 3000 TTS calls per day per owner) and latency while still making listening in real. |
| **T9** | **Meeting model**: real agents versus a single director | **BB** `/discuss`: sequential real turns with phase directives. **PG**: one director model writes all lines, with `next: continue/user/end`. | **Real per-agent turns** (BB) under a **lead moderator** that owns floor control, keeping PG's `next` signal and the owner "take the floor" affordance. Keep **director mode** only for "podcast-style" briefings and summaries. | Work meetings need independent reasoning and private context. PG itself calls the director "single-model theatre". |
| **T10** | **Avatar renderer**: photoreal portrait warp versus procedural stylised face | **PG**: Canvas2D strip warp on a portrait with MediaPipe landmarks; sized for 1–6 faces. **OC**: PNG bust plus CSS features; very cheap; stylised. | **PG as the hero and stage renderer. A tile LOD** for the Floor: the same PG renderer at `maxSide` 256 on a **shared scheduler** with off-screen pausing, falling back to a **static portrait plus a speaking ring** when there are many tiles. Keep the **driver interface (`sample(now)`) as the only coupling**, so a WebGL, Live2D or 3D renderer can be swapped in later. Generate faces with PG's warpable prompt prefixes and run a landmark job for every generated portrait. | Realism and continuity with generated faces argue for PG. Scale requires LOD and scheduling, which neither project has. |
| **T11** | **Lip-sync timing source** | **OC**: amplitude envelope mapped to 6 classes. **PG**: fusion driver over alignment, timed deltas, deltas, spectrum and energy (tier 1 dead in practice). | **PG fusion driver everywhere**, fed by **OC's stream-sourcing order** (`captureTap`: `captureStream()` first, AudioContext only if running). **Revive timestamped TTS** for per-line meeting audio. Fix the dropped-first-delta and early-drain bugs. | PG's driver degrades gracefully for any provider. Exact alignment is available for stored TTS lines, which is exactly the meeting case. |
| **T12** | **Orchestration layering**: routing table, DAG and task store | **OC**: per-turn inline/background routing plus a flat task store. **BB**: project DAG plans plus a ledger. **PG**: alarm job DO. | **Three layers.** (1) **Turn level**: the OC routing and summary tables, generalised to `{route, taskKind, costClass, approvalRequired, runningText, finishedText, executor}`, with CI failing on missing copy *or* a missing executor (fixes the OC bug). (2) **Project level**: the BB DAG engine with JSON verdicts and configurable caps. (3) **Durable level**: BB ledger semantics inside `ProjectDO`, and PG-style alarm `RunDO`s for long single jobs. The **OC tray** and **BB inbox** are the two user-facing views. | Each reference solved a different altitude well, and they compose without overlap once the executors are unified. |
| **T13** | **Memory architecture** | **BB**: Markdown facts per scope, reflection proposals, typed memory (backend-only), IndexedDB vectors. **OC**: browser knowledge graph with BM25+vector+RRF and visible recall. **PG**: flat memories, distillation, budgeted brief, approved knowledge cards. | Use a **server-side graph** in D1 (OC identity model) with **Vectorize** chunks and **OC hybrid recall** (same constants as a start). A **Markdown projection** per scope (`company.md`, `project-<id>.md`, `agent-<id>.md`) keeps memory editable, with **reflection as an Inbox diff** (BB). The **per-turn brief builder with budgets** and "reference data, not instructions" framing comes from PG, with **distillation** at the end of every session and meeting (PG). Every injection is a **visible context chip with provenance** (OC). | This combines the best retrieval, the best editability and governance, and the best context assembly, all of which the owner can inspect. |
| **T14** | **Identity and tenancy** | **BB**: Cloudflare Access only, name-keyed agents. **OC**: HMAC token plus browser cookie; admin by locality or secret. **PG**: Google OAuth with PKCE, hashed sessions, per-owner DO. | **PG auth** extended with **orgs, roles (owner, staff, guest) and seats**. The **OC policy-table guard** (protected by default, rate classes) sits in front of every route. Use **stable ids** for every entity, and keep a BB-style `repairReferences` pass for integrity. | Guests, staff and billing require real identity. Name keys break as soon as personas are renamed, which will happen often. |
| **T15** | **Governance model for tools** | **BB**: grants at call time (`approveAction`), refusing money, sending and identity. **PG**: tools offered by session role and re-checked at dispatch. **OC**: endpoint policy table. | **All three, layered.** Role- and persona-scoped **offering** (PG), then **grants at call** (BB, including graded Inbox decisions and taint escalation), then **endpoint policy** (OC). Replace BB's hard refusal of money and sending with **approval-required plus exactly-once effects** (wire the BB ledger `effect`/`receipt`). Taint-wrap **MCP, search and delegate outputs** (BB gap). | Coworkers must act in the real world. That is safe only with per-action approval, idempotency and audit. |
| **T16** | **Build and test** | **BB**: no build, `node:test`, Playwright, Mock provider, fake cloud, live canaries. **OC**: custom bundler, doc-sync and drift tests, preflight, fake-media e2e. **PG**: esbuild, Wrangler integration harness with WS/HTTP provider stubs, architecture guards. | **esbuild/Vite with node:test or vitest.** Use the **PG Wrangler integration harness** (extended with stubs for OpenAI, Anthropic and Gemini), the **BB Mock provider** for keyless e2e, the **OC fake-media Playwright harness** and **preflight**, **BB `verify:live`** canaries per provider and modality (add avatar TTS timing), and **PG architecture guards** (no keys or provider calls in web code). | Each is best-in-class for a different failure mode. Together they cover keyless development, adversarial providers, media devices and deploy safety. |
| **T17** | **MCP client** | **BB**: worker version negotiation, bridge stdio, relay server for CLI agents, catalog with token-pending state. **OC**: Streamable HTTP plus legacy SSE, bijective names, schema normalisation, per-hop SSRF, write-only secrets. | Use the **OC client core** plus **BB version negotiation**, **BB bridge stdio** in the Companion, the **BB relay** for CLI coworkers and the **BB catalog**. Add OAuth 2.1, resources and prompts, and per-persona grants. | They are complementary halves with no conflicting semantics. |
| **T18** | **Time and trigger semantics** | BB: `dailyAt` is UTC in the cloud and local time on the bridge; minimum interval 60 s versus 1 s. | **Owner timezone stored on the Workspace**, one trigger implementation run by DO alarms, and the Companion only for folder watchers. | This removes the divergence BB documents. |

---

## 6. Reuse plan

Estimates are for one experienced engineer and include the pre-port fixes listed.

- **Effort:** **S** ≤ 1 week, **M** 1–3 weeks, **L** > 3 weeks.
- **Risk:** **Low**, **Med**, **High**. Risk means the chance that the port reveals hidden work or fails its purpose.
- Items are **ranked by value to the target product** divided by cost, with foundational dependencies first.

| Rank | Module(s) to port | From | Target (new) | Action | Effort | Risk | Pre-port fixes / notes |
|---|---|---|---|---|---|---|---|
| 1 | Provider adapters and unified event protocol: `worker/src/util.js` (`sseResponse`, `parseSSE`, `collectEvents`), `providers/{responses,openai,xai,anthropic,cloudflare,mock}.js`, `bridge/src/providers/{ollama,openai-compat}.js` | BB | `packages/models/adapters` | Adapt (to TS) | M | Med | Add Gemini, `rates` and discovery. Keep completion enforcement. Remove `require_approval:'never'` for provider-side MCP. |
| 2 | Registry and dispatch: `server/providers/registry.ts`, `dispatch.ts`, `server/lib/http.ts` (deadline-on-signal), `server/lib/sse.ts`, `server/lib/lenientJson.ts` | OC | `packages/models/registry` | Adopt and extend | S–M | Low | Merge BB catalog ids (§4.10). Add per-persona model policy, cost and budget on the signal. |
| 3 | Agent loop: `server/lib/agentRuntime.ts` (3 dialects, `AgentRunOptions` seams) + `public/js/agent.js:93` (`runBotTurn` behaviours) | OC + BB | `packages/agent-loop` | Adapt | M | Med | Emit step and tool frames to the room bus instead of a no-op. JSON tool envelope from BB `tool-output.js`. |
| 4 | Lead orchestrator: `public/js/bizbot.js` (`routerBot`, `routingBrief`), `project-create.js`, Simple-mode delegate + `server/lib/orchestrator.ts` routing and summary tables + `server/api/chat.ts` frames | BB + OC | `worker/lead` | Adapt | M | Med | Add lead tools `post_to_project`, `steer_project`, `convene_meeting`, `escalate`. Include project members in the brief (fix `bizbot.js:29`). Every routed tool must have an executor (fix `orchestrator.ts:496`). |
| 5 | Plan engine: `public/js/plan.js` (`planGoal`, `normalizePlan`, `executePlan`, `repairPlan`, `archiveFinal`), `activities.js`, `activity-runner.js`, `turn-record.js`, `projects.js`, `runs.js` | BB | `packages/plan-engine` | Adopt | M | Low–Med | JSON review verdicts. Configurable caps. Structured decision payloads. Stable ids. Its 16 plus 7 test titles become the spec. |
| 6 | Inbox decisions and grants: `tools.js:35,55` (`requestProjectInput`, `approveAction`), `grants.js`, `budgets.js`, `project-view.js` `decisionCard` | BB | `packages/governance` | Adapt | M | Med | Fix grant-kind UI mismatch. Allow multiple pending questions per task. Taint-wrap MCP, search and delegates. |
| 7 | Ledger and portable engine: `public/js/runtime/ledger.js`, `headless-engine.js`, `runtime/{runtime,runtime-auto}.js`, `worker/src/runtime/{project-runtime,storage,fs,triggers}.js` | BB | `ProjectDO` | Adapt | L | High | One DO per project, not `idFromName('default')`. Add an alarm tick while jobs run and WebSocket hibernation. Inject `fetch` and storage instead of patching globals. Wire `effect`/`receipt`. Unify trigger timezones. |
| 8 | Durable job DO: `src/worker/builder.ts`, sketch ‖ full in `experiences.ts:389-538`, `creator.ts` alarm queue | PG | `RunDO` | Adopt | S–M | Low | Generalise from "experience build" to any long job, with checkpoints in DO storage. |
| 9 | Task store and tray: `server/lib/taskStore.ts`, `server/api/tasks.ts`, `app/Modules/TaskRegistry.ts`, `app/Components/PendingTray.tsx`, deliver-to-origin in `ChatViewModel.ts` | OC | Activity rail and ProjectDO task table | Adapt | M | Low | Add `agentId`, `projectId`, `planStepId`, `dependsOn`, `requiresApproval` and `cost`. Blobs go to R2. Move pub/sub into the DO. |
| 10 | Talking-face stack: `src/web/avatar/{face-landmarks.js,viseme-driver.js,audio-features.js,face-lipsync.js,avatar-view.ts,audio-worklet.js,audio-cleanup.js}`, `src/shared/landmarks.ts` | PG | `packages/avatar` | Adopt and add scale | M (L with WebGL) | Med | Shared rAF scheduler, one AudioContext mixer with per-agent taps, `maxSide`/tier/pause on `<avatar-view>`, `IntersectionObserver`. Fix the dropped-first-delta and early-drain bugs. Landmark job for generated faces. |
| 11 | Session engine: `src/worker/conversation.ts` (generations, audio budget, tool batching, sideband, consent persistence), `src/shared/{turns,chunker,captions}.ts` | PG | `RoomDO` | Adapt | L | High | Multiple agent participants, observer sockets and a `join` upgrade, per-speaker generations, floor arbiter. Revive the timestamped-TTS path. Remove the xAI-only brain. |
| 12 | Client voice: `src/web/voice/{transports,webrtc}.ts` + `app/Modules/{VoiceChat,VoiceMode}.ts` event handling | PG + OC | `packages/voice-client` (`TransportManager`) | Adapt | L | High | One mic and many remote streams through one mixer. Replace `ScriptProcessorNode`. Route realtime tool calls to the server brain. Live-test both transports (OC never did). |
| 13 | Meeting playback: the `Engine` in `src/web/groups.ts` (writer ‖ voicer ‖ player, seek, ready band, `toWav`), group replay DTO | PG | `packages/meeting-player` | Adapt | M | Med | Per-speaker driver and analyser. Lines produced by real agents. Owner "take the floor". Stored audio used for replay and audit. |
| 14 | Room semantics: `public/js/swarm.js` (`transcriptToMessages`, `ask_bot`, `message_bot`, `parseMentions`, `discussionPlan`/`Directive`, `addProjectSpecialist`) | BB | `packages/rooms` | Adapt | M | Med | Exact-handle mentions. Await speech through the floor arbiter (fix the `swarm.js:264` overlap). Merge the tab and headless context builders (drift risk). |
| 15 | Personas and casting: `src/shared/domain.ts` (`PersonaProfile`, `personaPrompt`), `src/worker/doppelganger.ts` (`context`, `avatarPrompt` with `fit`, tools, `distill`), `groups.ts` (`inventCast`, `assignVoice`, `paintPortraits`), `content.ts` (interviewer, image prefixes) + `agent.js:43`, `assemble.js` | PG + BB | `packages/personas` | Adapt | M | Med | Unified persona schema (§3 P2). Drop likeness consent for generated faces but keep disclosure. Voice uniqueness per project. |
| 16 | Stream-sourced speech: `shared/Modules/SpeechOutput.ts` (`captureTap`, generation counter, suspend versus enabled, deps injection) | OC | `packages/speech-output` (one instance per agent) | Adapt | S | Low | Add sentence chunking (PG `SentenceChunker`) to remove the 4000-char cut. Read `X-Speech-Voice`. |
| 17 | Context pipeline: `shared/Modules/ContextBus.ts` (`ContextCard`), `input/Modules/{FileProcessor,FolderContext,CaptureContextPublisher,CaptureSupport,CameraInputManager,ScreenInputManager,UserMediaManager}.ts` | OC | `packages/context` and `packages/media-core` | Adopt (pure cores) | M | Low | Add `scope`, `provenance`, `agentId` and `costEstimate` to cards. Frame differencing and latest-frame coalescing. Gate memory extraction on captures. Server-side extraction path (PG `unpdf`/`mammoth`). |
| 18 | Memory: `shared/Modules/Memory/{MemoryStore,FtsIndex,VectorIndex,MemoryRecall,GraphExtractor}.ts`, `server/api/extractMemory.ts` + `memory-files.js`, `memory-sync.js`, `bridge/src/runner/{memory,reflect}.js` | OC + BB | `packages/memory` (D1 + Vectorize) | Adapt | L | Med | Scope by workspace, project and agent. Tombstones and undo. Re-embed on model change. Markdown projection and reflection-as-decision. |
| 19 | MCP: `server/mcp/{client,manager,schema,net}.ts` + `worker/src/mcp.js` (version negotiation) + `public/connectors/catalog.json`, `connectors.js` | OC + BB | `packages/mcp` | Adapt | M | Med | Add OAuth 2.1/PKCE (net-new) and a server-side vault. Resources and prompts. Per-persona grants. Unify the SSRF checks (BB `fetch-page.js` rules plus OC `net.ts`). |
| 20 | Self-extension: `public/js/system-tools.js` (tiers, budgets, taint, `looksLikeSecret`, audit, Undo) | BB | Lead admin powers | Adopt | S | Low | Add persona, avatar and voice creation as tier-0 drafts. Mirror changes to the audit log. |
| 21 | Security kit: `src/worker/security.ts` (OAuth + PKCE, `sameOrigin`, bounded bodies, `redactError`, `rateLimit` + `refund`) + `server/lib/security.ts` (policy table, rate classes) + `server/mcp/net.ts` + `shared/Components/Markdown.tsx` sanitiser | PG + OC | `worker/security` | Adopt | M | Low | Add orgs and RBAC. The rate limiter becomes a cost ledger. |
| 22 | Sandboxed apps: `public/js/{app-host,apps}.js` (SDK) + `src/worker/experiences.ts` (`EXPERIENCE_CSP`, `REPORTER`, `builderPrompt`, repair) + `src/web/canvas.ts` | BB + PG | `packages/apps` | Adapt | M | Low | Scope artifact access for non-project apps (BB gap). Persist app grants. Business-grade builder prompt (not OC's whimsical one). |
| 23 | Billing and sharing: `src/worker/billing.ts`, `creator.ts` checkout and billing-event, hashed links, capability cookie, `src/web/{share,qr}.ts`, `src/worker/meta.ts` | PG | `WorkspaceDO`, guest doors | Adopt | S–M | Low | Add metering (write the `usage_events` equivalent). Plan limits for agents, minutes and renders. |
| 24 | Templates and onboarding: `public/js/templates.js`, `public/templates/business-ops.json`, `mode.js`, `components/{template-chooser,getting-started,empty-state}.js` + `src/web/studio.ts` intake (paste, files, talk) | BB + PG | Business packs and onboarding | Adapt | M | Low | Packs seed personas with faces and voices. The onboarding interview builds `company.md`. |
| 25 | Team graph → the Floor: `public/js/graph.js` (`extractExchanges`, `buildGraph`, `replaySteps`), `home-graph.js` (`goalBoard`, `buildHomeGraph`) | BB | `apps/web/floor` | Adapt (new renderer) | L | Med | Keep the log-derived model and the replay. Rewrite rendering as spatial desks and rooms with avatar tiles, plus a list fallback. |
| 26 | Rich rendering and previews: `rich-content.js` (Mermaid), `file-preview.js`, `tool-output.js` + `shared/Components/{Markdown,Document}.tsx` (`HtmlPreview`) | BB + OC | `packages/render` | Adopt | S | Low | `aido:`-style links become typed `action:` buttons (Approve, Ask @Finance). |
| 27 | Multimodal services: `server/api/{generateImage,generateVideo,describeImage,search,transcribe,speech,embeddings}.ts`, `server/providers/{images,video,websearch}.ts` + BB `/api/*` equivalents | OC + BB | Capability services behind the registry | Adapt | M | Low–Med | Video and media jobs become RunDOs. Fix OC's voice image "JPEG" bug pattern. Image-edit UI. |
| 28 | Test and ship tooling: `tests/integration.test.ts` + stubs, `tests/architecture-guard.test.ts` (PG); `providers/mock.js`, `worker/test/fake-cloud.mjs`, `scripts/verify-{live,local}.mjs` (BB); `tools/deploy.ts`, `test/e2e/capture.spec.js`, `scripts/make-fixtures.mjs`, doc-sync tests (OC) | all | CI | Adopt | M | Low | Add avatar and TTS timing canaries and multi-avatar load tests. |
| 29 | Desktop Companion: `bridge/src/{index,auth,config,tls,pair,exec,fs,browser,relay,mcp-server,mcp-shim,mcp-client}.js`, `bridge/src/cli/*`, `providers/{claude-cli,codex-cli,codex-app-server}.js`, `sandbox/*` | BB | `companion/` (optional) | Adopt (phase 2+) | L | Med–High | Coding agents run unsandboxed under their own permission modes: gate them behind grants. The Codex app-server needs tests. Pair through the Workspace, not a raw token in the URL. |
| 30 | Protocol-2 sync: `public/js/sync.js`, store changelog | BB | Companion ↔ cloud and offline cache | Adapt | S–M | Low | Only needed for the Companion and offline. The server stays authoritative. |

### 6.1 Do not port (use the lessons only)

- **OC JSX runtime and component library** (`shared/element.ts`, `Card`/`Form`/`ListEditor`, `ModalDialog`, `Tabs`) and the **regex concatenating bundler** (`tools/build.ts` `combineJs`). They have known defects and a global-script architecture.
- **BB globals patching** (`globalThis.fetch` and `localStorage` shims in the DO and bridge), the **single deployment-wide DO**, **name-keyed identities**, **text protocols** (`^APPROVED`, `approved:<kind>` strings, substring @mentions), **localStorage secrets**, and **trusting share-link payloads**.
- **PG `MODELS` constant as a registry**, the **1,226-line regex router**, the **string-template SPA pages**, **fresh realtime sockets per turn** as the only mode, and **single-director scripts for work meetings**.
- **OC split voice brain**, **per-isolate pub/sub and rate limits**, and **browser-only memory as the system of record**.

### 6.2 Suggested sequencing

1. **Foundation.** Items 1–3, 21 and 28: the models, the agent loop, auth and perimeter, and the test harness with the Mock provider. Result: a keyless Chief of Staff answering in text.
2. **Work.** Items 4–9 and 20: lead, plan engine, inbox and grants, ProjectDO, RunDO, tray and self-extension. Result: "delegate an outcome, get a reviewed plan and results".
3. **Presence.** Items 10–16: avatar stack, RoomDO, voice client, meetings, rooms, personas and speech output. Result: coworkers with faces and voices, meetings you can **listen in on and join**.
4. **Context and tools.** Items 17–19, 22 and 26–27: context cards, memory, MCP with OAuth, apps and multimodal services.
5. **Business.** Items 23–25: billing, sharing, packs and onboarding, and **the Floor**.
6. **Reach.** Items 29–30: the Desktop Companion with CLI coworkers and sync.

The largest **net-new** risks sit in stage 3: many simultaneous avatars and the audio mixer, observer fan-out in the RoomDO, and the floor arbiter. Stage 2 depends on long-running DO execution (keep-alive, fencing, exactly-once effects). Both should be spiked first, before stage 1 is finished.
