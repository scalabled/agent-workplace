# Mainspring

**One voice to direct it. One ledger to prove it.**

> Concept C, systems-first. This design starts from the engine (router, plan engine, ledger, wire, provider fabric, media pipelines, company graph, governance) and works outward to the product.
>
> Provenance tags: **[BB]** biz-bot · **[OC]** oncloudnine · **[PG]** personagram-ai · **[NEW]** white space none of them covers. **Tn** = tension n in `docs/research/capability-matrix.md`.

---

## 1. The big idea

A business owner does not want "agents". They want work to leave their head and come back done, with a way to check it. Mainspring gives them one Chief of Staff to talk to by voice, text, camera, screen or file, backed by coworkers who have faces and voices. The idea that makes it trustworthy sits underneath:

**The workforce is a ledger with faces.**

Every routing decision, model call, tool call, hand-off, spoken line, verdict, raised hand, reserved dollar and sent email is appended as an event to a durable ledger, one per project. Everything the owner sees is a *projection* of that ledger:

- **A coworker's face.** If Theo looks like he is thinking, a model call is in flight. If his hand is up, a decision is waiting. A face cannot look busy when nothing is running.
- **Every other surface.** The Floor (the spatial office), the Inbox, the audit trail, the cost meter, replay and memory are all projections too.

This is biz-bot's "the transcript is the source of truth" [BB] made architecture, on personagram-ai's Durable Object topology [PG], speaking oncloudnine's frame protocol [OC]. Three consequences are the product:

1. **Honest presence.** Avatars are instruments, not decoration.
2. **Work that survives.** Runs hold leases in Durable Objects, not browser tabs.
3. **Everything is explainable.** "Why did we drop the Saturday tasting?" is a ledger query. It returns the meeting clip, the verdict and the cost.

## 2. Who it is for

**Primary: the operator-owner of a business with 3–40 people**, such as a catering bakery, a boutique agency, an e-commerce brand or a clinic group. They already run 5–15 SaaS tools. They have more work than staff and have been burned by automation that "said it did it". They will delegate only if they can check the work, cap the spend and stop everything instantly.

**Secondary:**
- **Agencies**, which give clients a door into one coworker or one deliverable [PG].
- **Technical founders**, who want local models and CLI coding agents in the loop [BB].

None will configure providers or read JSON. The engine stays hidden until asked about. Simple mode is one question: "What do you want done?" [BB]

## 3. Core concepts

| Term | Meaning | Built on |
|---|---|---|
| **Workspace** | Tenant: members, house style, rules, timezone, budgets, vault, kill switch | PG `CreatorDO`; BB Principal; roles [NEW] |
| **Chief of Staff (CoS)** | Undeletable lead, rebuilt each turn; the only agent the owner *must* talk to | BB `routerBot`; PG voice front / brain back |
| **Coworker** | Persona with a stable id: identity, role, skills, grants, model policy, voice, face rig, memory scope. **A configuration, not a process.** | PG doppelganger; BB instances |
| **Route** | The CoS's per-turn choice: answer, ask, delegate, project, steer, meeting or escalate | OC `TOOL_ROUTING_TABLE` |
| **Project · Plan · Step** | Objective with a reviewed DAG. Each step is owned by a cluster: a lead, co-owners and reviewers. | BB `executePlan` |
| **Verdict · Evidence** | Structured review judgment, plus the receipts, citations and artifacts that prove each criterion | BB review loop; [NEW] |
| **Run · Job** | Run: one plan execution. Job: a durable unit with a lease, a fence and retries. | BB ledger; PG `BuilderDO` |
| **Ledger · Projection** | Append-only event log per project; every surface is derived from it | BB bus; OC frames; PG events |
| **Room · Meeting · Floor** | Room: a channel. Meeting: a phased session. Floor: the right to speak. Observers listen; whispers reach one agent. | BB `/discuss`; PG stage; [NEW] |
| **Decision · Grant · Effect** | Decision: the universal pause. Grant: a graded permission. Effect: an exactly-once action with a receipt. | BB `InputRequired`, grants, ledger |
| **Context item · Company graph** | A visible, scoped, costed chip for any context; the connector-fed graph of business facts it draws on | OC `ContextCard` + graph |
| **Model policy · Rates** | Per-persona provider rules; per-model prices; budget reserved before each call | OC registry; BB `reserve`; [NEW] |
| **Companion · Door** | Companion: a paired desktop runtime. Door: a purpose-scoped guest link. | BB bridge; PG links |

---

## 4. The engine, from the inside out

```
         Owner ── voice · text · camera · screen · files · phone
                               │
         ┌─────────────────────▼──────────────────────┐
         │ CHIEF OF STAFF    voice front ── brain back │
         │ ROUTER answer·ask·delegate·project·steer·meeting·escalate
         └─────┬───────────────┬───────────────┬──────┘
           RunDO jobs      ProjectDO         RoomDO
        (renders, builds, (plan DAG, ledger, (participants, observers,
         CLI steps)        bus, triggers)     floor arbiter, provider sockets)
               └───────────────┼───────────────┘
  provider fabric · media pipelines · context + company graph · tools/MCP · governance
                               │
                THE LEDGER (append-only, per project, seq-numbered)
                               │
  projections → faces · Floor · Inbox · Activity rail · audit · cost · replay · memory
```

### 4.1 The ledger: one spine, many projections

One envelope for every event: BB's vocabulary, namespaced by workspace, project, room and agent (tension T4):

```json
{ "seq": 18240, "at": "2026-10-05T14:02:11Z", "ws": "ws_harbor", "project": "pj_grad",
  "room": "rm_grad", "run": "rn_7f2", "step": "s3", "actor": "ag_theo", "type": "message",
  "data": { "to": ["ag_maya"], "intent": "challenge", "text": "At $16 we lose money on delivery under 20 guests." },
  "cost": { "usd": 0.0031, "tokens": 812, "status": "reported" },
  "provenance": { "model": "anthropic/claude-sonnet-5", "context": ["ci_88", "ci_91"] } }
```

**Event families:** `route`, `turn.*`, `tool.*`, `plan.*`, `step.*`, `verdict`, `ask`, `message`, `handoff`, `meeting.*`, `floor.*`, `speech.line`, `presence`, `decision.*`, `grant.*`, `effect.*`, `context.consume`, `memory.*`, `cost.*`.

**Storage.** Hot events live in the ProjectDO's SQLite `events(run, seq)` table [BB]. They roll up to D1 for cross-project queries. Blobs go to R2 behind pointers, because records never carry artifact bytes [OC]. Clients catch up with `?since=seq` [BB].

**The frequency rule [NEW]: nothing faster than a sentence goes in the ledger.** Visemes, audio frames and token deltas stream live but are never persisted. A spoken line is stored once as `speech.line {audioKey, alignment}`, and replay recomputes lip sync from it exactly.

**Face states come straight from events:**

| Event | Face state |
|---|---|
| `turn.start` | Thinking: gaze drifts |
| `tool.running` | Working: glances down, with OC-style copy on the desk tile ("Reading QuickBooks") |
| `speech.line` | Speaking: PG fusion lip sync |
| Another participant holds the floor | Listening: gaze turns to the speaker [NEW] |
| `decision.pending` | Hand raised [NEW] |
| `handoff` | Turns toward the target desk |
| 60 s with no events | Idle: blink and breathe only |

### 4.2 The router: how the Chief of Staff decides

The CoS is rebuilt every turn from the house style, as Bizbot is [BB]. Each turn she receives a **routing brief**:
- the full roster *including project members*, which fixes the exclusion at `bizbot.js:29`;
- each project's `projectSummary` status;
- open decisions and budget headroom;
- the owner's newly attached context items.

Routing follows OC's rule: route by *the shape of the answer*, not by how long the work takes [OC]. Each route is a data entry `{route, taskKind, costClass, approvalRequired, runningText, finishedText, executor}`. CI fails if any entry lacks its copy **or its executor**, which fixes OC's broken background override (`orchestrator.ts:496`).

| Route | Taken when | Executor | Owner hears |
|---|---|---|---|
| answer | The result must be read before replying (≤2 inline tools) | CoS loop | the answer |
| ask | One specialist's answer is needed now | sync `ask`, depth ≤2 [BB] | "Theo says margin is 31%." |
| delegate | One specialist, producing an artifact or making many calls | RunDO [PG `BuilderDO`] | "Sol is drafting flyers, ~2 min." |
| project | ≥2 disciplines, a deliverable, or recurring work | `materializeProject` → team → plan → approval [BB] | "Opened a project; plan coming." |
| steer | Concerns a live project | `post_to_project`, `steer_project`, `pause`, `rescope` [NEW] | "Told the team; two steps re-plan." |
| meeting | A trade-off needs debate | `convene_meeting` → RoomDO [BB `/discuss` + PG stage] | "Pricing huddle, ~6 min. Listen?" |
| escalate | Needs the owner's judgment, consent or money | Decision [BB] | a raised hand and one question |

Every route emits a `route` event with its reason, so "why is this a project?" gets the recorded reason, not a guess.

**Voice front, brain back [PG, generalised per T6].** A realtime model (OpenAI Live with `delegation:{type:"client"}`, xAI realtime, or Gemini Live [NEW]) handles only turn-taking, fillers and barge-in. Tool calls and substantive answers go to the server brain and stream back through `SentenceChunker`. One identity, memory and router serve text, voice and meetings, closing OC's "two brains" gap. **"I started it" [OC]:** a turn that only starts a job is complete.

### 4.3 The plan engine: DAGs with review loops and evidence

Mainspring adopts `executePlan` [BB], the most mature orchestration code across the references (16 execution tests and 7 checkpoint tests), as a pure package hosted in the ProjectDO. It keeps BB's behaviour:
- **Drafting.** `planGoal` makes one JSON-schema call in which owners and reviewers are enums of real members. The plan must be "a graph, not a list".
- **Clusters.** Each step has 1–3 owners and 0–2 reviewers from another discipline, and the lead rotates on failure.
- **Review loop.** Work, then parallel review, then one revision. Open issues become a `needs_review` decision. Dependents wait while siblings run, and `InputRequired` parks one step only.
- **Finishing.** A finisher assembles the deliverable and a QA reviewer checks it.
- **Checkpoints.** Drafts are saved each second, and `repairPlan` reopens false completions.

What Mainspring adds:

- **JSON verdicts** replace BB's `^APPROVED` first-line parse:
  `{"verdict":"changes","findings":[{"criterion":"a2","issue":"No delivery-fee math","severity":"blocking"}],"evidenceChecked":["rc_41","cite_7"]}`.
  A truncated verdict counts as `changes`, preserving BB's rule that a truncated approval is not approval.
- **An evidence contract [NEW].** Each acceptance criterion declares its proof: `citation`, `receipt`, `artifact`, `metric` (a company-graph value with `asOf`) or `owner_answer`. A step is done only when all four hold: `finish === "stop"`, the output is non-empty [BB], no blocking finding is open, and every criterion links evidence.
- **Graph shapes [NEW].** `when` conditions on prior structured output; `forEach` fan-out and fan-in; per-step deadlines; free dry runs on the Mock provider [BB].
- **A cost forecast on the approval card [NEW].** Tokens × rates plus media units, shown as a range such as "$3.40–$5.10, ~40 min". Approving reserves the upper bound.
- **Typed activities.** BB's 14 types plus `image`, `video`, `send` and `sync` [NEW]. Receipts mean retries never repeat a success [BB].
- **Playbooks.** A plan that succeeded saves as `WORKFLOW.yaml`. It publishes after golden evaluations plus approval, and can be rolled back. This is BB's backend-only `catalog-store`, given a UI.

### 4.4 Durable execution

| Unit | Holds | From |
|---|---|---|
| **WorkspaceDO** (per org) | Quotas, billing, secret vault, door tokens, budget scopes, kill switch | PG `CreatorDO` |
| **ProjectDO** (per project) | Plan engine, ledger, event bus, triggers | BB `RuntimeDO`, made per-project |
| **RoomDO** (per live room) | Owner, observer and guest sockets; provider sockets; floor arbiter; generations | PG `ConversationDO` |
| **RunDO** (per long job) | Renders, app builds, CLI steps; checkpoints; ≤2 attempts | PG `BuilderDO` |

There is deliberately **no AgentDO**. A coworker is a loop configuration [OC `runAgentLoop` seams]: a prompt, a set of tools and a model policy, plus its memory scopes and ledger history. Spawning six specialists writes six rows and six `presence` events.

Ledger semantics come from BB, with the gaps closed:
- **Jobs [BB].** `enqueue` is idempotent. A claim takes a 90 s lease with a **fence**, and heartbeats run every 30 s. Stale writers get `LedgerConflict`. Failed jobs back off and are dead-lettered after 3 attempts.
- **Keep-alive.** DO alarms tick while jobs are live (PG pattern; BB's cloud DO had none). Hibernation keeps idle rooms cheap [NEW].
- **Outbox.** Each result is delivered exactly once, to the conversation that asked [BB + OC].
- **Effects.** Every real-world action calls `effect(key, intent)` before acting and `receipt(key, result)` after. If a crash leaves an effect `pending`, it is **reconciled, never blindly replayed**. BB defined this but never wired it. Mainspring wires it into every `send`, `pay`, `publish` and MCP write.
- **Reservations [BB].** Budget is reserved against `run`, `step`, `day` and `workspace` before a call and settled after. Unknown cost is never free.
- **Kill switch [NEW].** A WorkspaceDO flag is checked at every claim and heartbeat. Flipping it fences every live job within 30 s and ends all speaker generations.
- **Time.** Triggers use the workspace timezone, which fixes BB's UTC/local split (T18).
- **Companion.** Shell, local-file, browser, local-model and CLI steps are pinned to the Desktop Companion [BB `runtime-auto`]. If the laptop sleeps, the step waits with an honest reason. It never moves silently to a paid cloud model [BB `resolveModel`].

### 4.5 The wire: how coworkers talk to each other

| Primitive | Semantics | Bounds | From |
|---|---|---|---|
| `ask` | Synchronous; the asker waits | depth ≤2; `InputRequired` propagates | BB `ask_bot` |
| `message` | Async hand-off; the target owns the next round | ≤6 rounds | BB `message_bot` |
| `mention` | Parallel owners in a room | exact handles (fixes BB substring matching) | BB |
| `meeting` | Framing → opening → debate → synthesis | 1–4 rounds; floor arbiter | BB `/discuss` + PG stage |
| `whisper` | Private owner note to one agent mid-meeting | recipient's projection only | [NEW] |
| `broadcast` | CoS steering a project team | recorded as a plan note | [NEW] |

**Perspective projection.** No agent reads the room transcript raw. Each turn, `transcriptToMessages(room, agentId)` [BB] builds that agent's own history:
- its own lines become `assistant` turns, and other agents' lines become `[Message from "Theo"]`;
- hand-offs are tagged and incomplete drafts are flagged;
- attachments are capped at 32k and framed as external;
- whispers appear only for their recipient.

Private memory never enters a room. As in PG's group engine, agents share only guest-safe context [PG].

**Real turns, not theatre (T9).** In meetings, each coworker calls its own model with its own tools and context, and the CoS moderates. PG's single-director mode is kept only for podcast-style briefings.

**Floor arbiter [NEW, on PG primitives].** The RoomDO holds a speaking queue. Priority runs owner > CoS > addressed agent > others. Every speaker has a generation counter: barge-in bumps it, and stale audio is dropped on both server and client [PG]. Agents yield with PG's `next: continue | user | end`. This replaces BB's unawaited room TTS (`swarm.js:264`), which let voices overlap.

**Voice on demand (T8).** Coworkers converse in text at full speed. When an observer attaches, the RoomDO voices the **live tail**:
- It uses PG's writer ‖ voicer (3 lines ahead) ‖ player, in each agent's own voice.
- Lines are stored in R2 with timestamped-TTS alignment, reviving PG's exact-timing path, which is unreachable today.
- The CoS first speaks a catch-up of at most 20 s.
- Voicing stops when the last observer leaves, and a daily voiced-seconds cap bounds cost.

**Joining.** `join` upgrades an observer socket to a speaker [NEW]. Owner audio then flows through PG's server-mediated path (AudioWorklet uplink, audio token bucket) into every agent's next projection.

### 4.6 The provider fabric

One `models` package combines the **OC registry shape** with **BB adapters** (T4). The OC shape contributes capability flags, per-capability preference orders, `requireProvider`, errors that name the missing key, and one file of model ids. The BB adapters contribute the Responses API with completion enforcement, Anthropic Messages, local servers, CLIs and Mock.

| Family | Used for | In references |
|---|---|---|
| Anthropic | chat, tools, vision, search | BB, OC |
| OpenAI | chat, `gpt-realtime-2`, `gpt-live-1`, TTS, STT, image, embeddings | BB, OC, PG |
| xAI | chat, realtime, streaming STT, timestamped TTS, image + edit, video | BB, OC, PG |
| **Google Gemini** | chat, Live, embeddings, image, video | **absent: new adapter [NEW]; ids from live discovery** |
| Azure OpenAI, Bedrock, Vertex | enterprise endpoints | [NEW] |
| Workers AI · Ollama, LM Studio, llama.cpp, vLLM | keyless embeddings · local chat, embeddings, vision | BB (local via Companion) |
| Claude Code, Codex CLI · Mock | coding coworkers with resume + relay · keyless demos, dry runs | BB |

**One agent loop, four dialects.** OC's `runAgentLoop` keeps a neutral transcript over Anthropic `tool_use`, Responses `function_call` and compat `tool_calls`. Mainspring adds:
- a **Gemini dialect** [NEW];
- BB `runBotTurn` behaviours: parallel tool calls, a refusal of a third identical failure, and `beforeModel`/`afterModel` hooks that hold reservations;
- ledger frames in place of OC's no-op `emit`.

**Per-persona model policy [NEW]:**

```json
"modelPolicy": {
  "reason":   { "prefer": ["anthropic/claude-opus-5"], "fallback": ["openai/gpt-5.6-sol", "gemini/*"] },
  "fast":     { "prefer": ["openai/gpt-5.6-luna", "xai/grok-4.20-non-reasoning"] },
  "voice":    { "provider": "xai", "voice": "ara", "fallbacks": [{ "provider": "openai", "voice": "marin" }] },
  "localOnly": false, "budget": { "perTurnUsd": 0.25, "dailyUsd": 6 } }
```

Selection checks, in order: capability, policy order, key available, never local → cloud [BB], budget headroom, latency class, price. The reason is logged as a `route.model` event. Planners get the strongest reasoner and room routing gets a fast model [BB `pickPlanner`/`pickRouter`]. Team assembly spreads providers "so the perspectives really differ" [BB `assemble.js`].

**Cost is a signal, not a report.**
- Every model carries `rates {input, output, cached}`, and media models carry per-unit rates. No reference had any [NEW].
- Budgets ride the AbortSignal, as OC's deadlines do (`setProviderDeadline`), and are reserved in the ledger [BB].
- Discovery flags model-id drift.
- A `verify:live` canary for each provider and modality runs on every deploy, including a TTS → STT round trip [BB].

### 4.7 Multimodal pipelines

Every modality is a pipeline with a route (inline or job), a cost class, and an output that is either a ContextItem or an artifact.

| Modality | Pipeline | From |
|---|---|---|
| Speech in, batch | Header-prefix segmenting; STT with a rolling prompt | OC |
| Speech in, streaming | AudioWorklet PCM16 → RoomDO → streaming STT (`endpointing=450`, `smart_turn=0.7`) → `TurnAssembler` | PG |
| Realtime voice | Server-mediated RoomDO over OpenAI WebRTC/Live, xAI WS or Gemini Live [NEW]; generation-tagged barge-in | PG + OC |
| Speech out | Per-agent `SpeechOutput` + `captureTap` → `SentenceChunker` → tagged, timestamped TTS → fusion viseme driver | OC + PG |
| Vision | Honest vision gate; `describeImage`; screenshots become vision turns | OC + BB |
| Camera / screen | Interval snapshots, `SingleFlight`, privacy dot; **frame differencing** [NEW] | OC |
| Files / folders | DOCX, XLSX, PDF, CSV, JSON; folder diff re-sync; server extraction | OC + PG |
| Image gen / edit | Family table; warpable-portrait prefix; identity-preserving edit | OC + PG |
| Video gen / understand | Provider job as a RunDO (xAI today, Gemini [NEW]); ≤12 keyframes → vision turn, moved server-side [NEW] | OC + BB |
| Embeddings | Model-tagged, dimension-safe vectors in Vectorize; re-embed on model change [NEW] | BB + OC |
| Faces | Landmarks → fusion driver `sample(now)` → strip-warp; landmark job per generated portrait [NEW] | PG |

**The client for many avatars [NEW, T10].** All faces share one `AudioContext`, with a mixer bus and an analyser tap per agent, and one rAF scheduler. `<avatar-view>` gains `maxSide`, `tier` and `paused`, and `IntersectionObserver` pauses faces that are off-screen. There are three levels of detail:
- **Hero**, on the Stage: PG full warp at 1024 px.
- **Seat**, in meetings: 256 px, mouth only.
- **Desk**, on the Floor: a static portrait with a speaking ring.

The mixer supports solo, mute and ducking, with stereo panned by desk position. A picture-in-picture speaker follows the owner between screens.

### 4.8 Context and the company knowledge graph

**ContextItem** extends OC's `ContextCard` to `{id, kind: file|capture|memory|connector|artifact|kpi, scope: workspace|project|room|agent, provenance, visibility, asOf, tokens, costEstimate}`.
- It keeps OC's lifecycle. Items are upserted by id, so a camera frame appears at once and upgrades when its description lands. They are consumed on send, then retired and archived.
- **The CoS routes items [NEW].** An invoice photo goes to Theo's step, not to all six agents.
- Each turn emits `context.consume`, so every message shows exactly which chips it used.

**Company graph.** OC's graph algorithms move server-side into D1 and Vectorize.
- It covers customers, products, suppliers, people and KPIs, with `name|type` identity and rename-merge [OC].
- **Connectors feed it on a schedule** via MCP (HubSpot, QuickBooks, Xero and the rest of BB's catalog).
- Every fact carries its provenance and an `asOf` date, so a price can be correct and still stale [NEW].

**Recall** uses OC's constants: BM25 (k1 1.2, b 0.75) plus cosine similarity (floor 0.25), fused with RRF (k 60), capped at 4 items and 1,200 characters, with a 3 s embedding timeout. Results are filtered by per-agent memory permissions [NEW] and shown as a "memory used" chip.

**Briefs** combine PG's section budgets (profile 6k, files 20k, facts 7k, summaries 3k, recent 6k) with BB's project bundle (≤20 decisions, ≤25 artifacts). They are labelled *reference data, not instructions*.

**Memory stays editable.**
- Markdown projections: `company.md`, `project-<id>.md`, `agent-<id>.md` [BB].
- Reflection proposes changes as Inbox diffs [BB].
- Meetings end in PG distillation `{summary, facts[], instructions[]}`.
- Deletes are tombstones with Undo [NEW].

### 4.9 Tools, MCP and connectors

- **MCP.** OC's Workers-native client provides Streamable HTTP and legacy SSE, per-hop SSRF checks, bijective wire names and schema normalisation. BB adds version negotiation. **New:** OAuth 2.1/PKCE (docs-only in BB), a server-side vault (BB used localStorage), and resources and prompts.
- **Relay.** CLI coworkers call `ask`, documents and memory back through BB's per-run MCP relay. System tools are never relayed.
- **Hygiene.** BB's bounded output envelope; MCP, search and delegate outputs are **taint-wrapped** (a BB gap closed).
- **Self-extension.** The CoS gets BB's `system` tool: tiers, 3/12/40 budgets, secret refusal, audit and Undo. New personas, faces and voices are tier-0 drafts.
- **Apps.** Agent-built dashboards run in opaque sandboxes with `connect-src 'none'`. They combine BB's app SDK with PG's sketch ‖ full build and `REPORTER` self-repair.

### 4.10 Governance: one gate, five layers

```
offer (persona + role scoped, re-checked at dispatch)               [PG]
 → grant at call (once · task · session · 24h · standing)           [BB]
  → endpoint policy + rate class (protected by default)             [OC]
   → effect ledger (intent → receipt, reconcile on crash)           [BB, wired NEW]
    → unified audit (model call, tool call, egress, which frame to which provider) [NEW]
```

- **Real-world actions.** BB refuses money and sending outright. Mainspring makes `send`, `pay` and `publish` approval-required, and they **never** get a standing grant. This extends BB's `NO_STANDING` rule [NEW].
- **Taint.** A tainted turn needs approval even for tier-0 changes [BB].
- **Proactivity** is budgeted: off/quiet/on allows 0/6/30 pings a day, filtered by an LLM judge [BB].
- **Identity.** PG's Google OAuth with PKCE, plus orgs and the roles owner, staff and guest. Doors use hashed tokens whose raw value lives only in the WorkspaceDO. Guests consent and get role-scoped tools [PG].
- **Ship safety.** PG architecture guards, OC log-hygiene and preflight checks, and BB Mock-provider end-to-end tests.

---

## 5. What the engine unlocks

| Surface | What the owner does | Engine underneath |
|---|---|---|
| **Talk** | Speaks or types to the CoS anywhere, including phone walkie-talkie mode | Voice front / brain back; router |
| **The Floor** | Sees coworkers at desks and projects as rooms, with live hand-off edges; a list view is the accessible fallback | Presence + in-flight edges; BB `extractExchanges` |
| **Stage** | Talks face to face with any coworker, even mid-step (the CoS sees it in the ledger); interrupts; reads captions | PG stage on a RoomDO |
| **Rooms** | Listens in, takes the floor, whispers; minutes become plan steps | Wire, arbiter, voice on demand |
| **Projects** | Reviews the DAG, forecast, evidence, runs and artifacts | Plan engine + ledger |
| **Inbox · Activity** | Answers raised hands; stops or retries jobs | Pending decisions (BB `goalBoard`); OC Pending tray |
| **Replay · Doors** | Scrubs history and asks "why"; shares scoped links | Ledger + R2 audio (PG exact replay; BB `buildAudit`); PG links |

---

## 6. Signature experiences

*The setting: Harbor & Rye, a bakery-café with a catering arm and 14 staff. The owner is Dana, and her Chief of Staff (CoS) is **Iris**. The coworkers are Maya (marketing), Theo (finance and the designated sceptic), Priya (ops), Sol (design) and Jonah (a web engineer running on Claude Code through the Companion).*

**6.1 The Monday brief.** At 7:40 Dana taps walkie-talkie mode in her car and asks, "What happened over the weekend?" Within about a second Iris answers:

> "Butter is up 9%; the price watcher fired twice, but only that change matters. Maya drafted 14 review replies for one-tap approval. And I moved Sol to a backup image model for an hour on Sunday."

"Put butter on Theo's list." "Done."

*Under the hood:*
- The realtime front handles the conversation. The brain reads a digest of the ledger.
- The second watcher firing was demoted by the quiet-mode judge and the annoyance budget [BB].
- The model swap is logged as a `route.model` event.
- "Put butter on Theo's list" becomes a `steer`.

**6.2 One sentence, a project.** "I want to push catering for spring graduations. Three weeks." A new room appears on the Floor and five desks slide in. Ninety seconds later the Inbox asks: *Approve the plan?* The plan card shows:
- seven steps in three stages;
- Theo reviewing Maya's pricing;
- a forecast of **$3.40–$5.10, about 40 minutes**;
- the evidence each criterion needs, for example "margin ≥ 30%: QuickBooks metric, asOf this week".

*Under the hood:* `materializeProject` → `planTeam` (with a sceptic) → `planGoal` → a plan decision bound to a `runId` [BB]. Approval reserves the top of the forecast.

**6.3 Listening in, then taking the floor.** The edge between Theo's and Maya's desks pulses: a `challenge`. Dana taps the room.
1. Iris catches her up: "Maya wants $16 a head. Theo says deliveries under 20 guests lose money."
2. Then Dana hears both of them, faces lip-syncing.
3. She whispers to Theo, "We can raise the minimum."
4. Theo: "Delivery from 25 guests, then $16 holds."
5. Dana taps *Take the floor*: "Do it."
6. Two steps re-plan.

*Under the hood:*
- Voicing started only when Dana attached as an observer.
- The whisper reached only Theo's projection.
- `join` gave the owner priority on the floor.
- The minutes became a `broadcast`, which marked the affected approvals stale [BB].

**6.4 Show it, don't type it.** Dana points her phone camera at a flour invoice and asks, "Does this change anything?" A chip reading "Photo · invoice" appears. A second later it becomes "Miller & Sons · flour $38.20". Iris: "Up 11%. I've sent it to Theo." The plan's `when` branch fires: "cost basis moved >5% → re-run margin."

*Under the hood:*
- The snapshot is upserted as a ContextItem, then upgraded when the vision result arrives [OC].
- The supplier fact is stored with an `asOf` date [NEW].
- The item was routed to one step, not to the whole room.

**6.5 The email that went out exactly once.** Maya's avatar raises a hand: *Send "Graduation catering is open" to 42 HubSpot contacts via the email connector?* Dana taps *Allow for this task*. Midway, a deploy restarts the ProjectDO:
- The expired lease is fenced out.
- The ledger shows 27 receipts and 1 pending effect.
- The pending effect checks the provider's sent record and finds it delivered.
- Only the last 14 emails are sent.

The Activity rail reads: "42 of 42 sent, no duplicates."

*Under the hood:*
- A `forEach` fan-out step.
- `send` gets task-scoped approval and can never be standing [BB + NEW].
- Effect keys combine project, recipient and template hash.
- The email connector is new.

**6.6 The engineer on the laptop.** "Jonah, put the offer on the website." Jonah is a Claude Code coworker on the office iMac. He edits the site repo and, midway, asks Sol through the relay for a hero image. His receipt shows `git diff --stat` and a preview link. At 6 p.m. the iMac sleeps, and his next step reads "Waiting for the office computer, which is asleep".

*Under the hood:*
- Companion pinning [BB `runtime-auto`].
- CLI session resume and the MCP relay [BB].
- A diff-stat receipt.
- Never falls back from local to cloud [BB].

**6.7 "Why did we…?"** Weeks later: "Why don't we deliver to small parties?" Iris: "From the pricing meeting on the 6th. Theo showed sub-20 deliveries lost about $11 each, and you set a 25-guest minimum. Want to hear it?" Dana taps *Play* and hears the 40-second exchange, faces moving exactly as they did.

*Under the hood:*
- A ledger query over `meeting.*`, `verdict` and `decision.resolved`, joined to graph metrics.
- Replay reads `speech.line` audio and alignment from R2 [PG].
- Dana's own voice is included because her audio passed through the RoomDO under workspace recording consent.

---

## 7. Feature set by pillar

| Pillar | Mainspring | Source |
|---|---|---|
| P1 Lead | Per-turn CoS; brief includes project members; 7 routes as CI-checked data; steer running projects; spoken brief; voice front on any provider | BB, OC, PG, NEW |
| P2 Personas | One schema: role, skills, grants, model policy, voice + fallbacks, face, memory scope. Auto-cast teams with a sceptic. Train by talking. `AGENT.md` + eval gate | PG, BB, NEW |
| P3 Avatars | Landmarks → fusion driver → warp; event-driven face states; raised hand; gaze; 3 LODs, one scheduler | PG, OC, NEW |
| P4 Orchestration | `executePlan` + JSON verdicts, evidence, `when`/`forEach`, forecasts; leases, fences, effects, reservations | BB, PG, NEW |
| P5 Comms | ask, message, mention, meeting, whisper, broadcast; perspective projection; arbiter; voice on demand | BB, PG, NEW |
| P6 Projects | Projects, Inbox, runs, artifacts, apps, automations; per-criterion evidence | BB, OC, NEW |
| P7 Providers | OC registry + BB adapters; Gemini, Azure, Bedrock, Vertex; 4 dialects + CLIs; policy; rates; canaries | OC, BB, NEW |
| P8 Multimodal | STT, realtime, timestamped TTS, vision, differenced capture, files, image, video, embeddings | OC, PG, BB, NEW |
| P9 Context | Routed items; connector-fed graph with `asOf`; hybrid recall; budgeted briefs; Markdown memory; distillation | OC, BB, PG, NEW |
| P10 Tools | MCP + OAuth 2.1 + vault; relay; taint wrapping; self-extension; self-repairing apps | OC, BB, PG, NEW |
| P11 UX | Talk, Floor, Stage, Rooms, Projects, Inbox, Activity, Replay, Doors; mixer; PiP; Simple mode | PG, OC, BB, NEW |
| P12 Governance | offer → grant → policy → effect → audit; kill switch; RBAC; recording consent | PG, BB, OC, NEW |
| P13 Business | Packs with faces and voices; onboarding interview writes `company.md`; seats + metered usage; doors | BB, PG, NEW |
| P14 Infra | Four DO classes; D1, R2, Vectorize, Queues; Wrangler stub harness; Mock; preflight | PG, BB, OC, NEW |

---

## 8. What makes it compelling

- **Trust by mechanism, not tone.** Claims carry evidence and actions carry receipts. Money is reserved before it is spent. An owner can check all three without reading code.
- **The faces tell the truth.** Because each face is a projection of the ledger, a glance at the Floor is a real status check.
- **One voice to command, any voice to join.** The owner talks only to Iris, yet can hear any room within seconds and speak up.
- **Provider-neutral.** Every role gets its best model, and local models run where data must stay local. An outage becomes a line in the brief.
- **Cheap to staff.** Coworkers are configurations and their chatter is text. Voice costs money only when someone listens.
- **The owner's own work, compounded.** Every layer has a tested source in the references. The new parts are few, and each is named.

---

## 9. Risks

| Risk | Why real | Mitigation |
|---|---|---|
| Long-running DO execution and exactly-once effects | BB's cloud DO had no keep-alive; effects were unwired | Spike first; port BB ledger tests; chaos tests that kill DOs and assert zero duplicate receipts |
| Many simultaneous avatars | PG is sized for 1–6 faces | Shared scheduler, LODs, pausing; load test of 30 tiles + 4 speakers on a mid-range phone |
| Realtime voice never live-tested | OC used no paid key; PG's OpenAI Live SDP path is unmocked | Start on PG's xAI path (tested end to end); gate every other transport behind canaries |
| Cost blow-up from agent chatter | Agents × rounds × voicing multiply | Text by default, voice on demand, speaking budgets, reservations, forecasts |
| Prompt injection reaching real actions | Connectors and captures feed agents that can send | Taint wrapping; taint forces approval; `send`/`pay` never standing |
| Model-id drift | Reference catalogs disagree | Live discovery, one registry file, canaries |
| Ledger volume | Every agent step is an event | Frequency rule, rollups, R2 pointers, retention |
| Recording privacy | PG's privacy copy drifted from its code | Explicit consent, visible indicator, retention limits, erase ends live rooms [PG] |
| Owner overwhelm | A lot of machinery | Simple mode; everything goes through Iris |

---

## 10. MVP slice

**Goal:** prove the engine end to end behind a small surface, with enough presence to show the faces are real. About 12 weeks for a small team.

**Spikes (weeks 1–2):**
1. A ProjectDO runs a mock plan with keep-alive, lease and fence, is killed mid-step, and resumes with no duplicate effect.
2. 12 desk tiles and 3 speaking seats hold 60 fps on a mid-range phone, sharing one AudioContext.

**In scope:**
- **Engine:** the ledger and its projections; all 7 routes; `executePlan` with JSON verdicts and evidence (no `when`/`forEach` yet); decisions and grants; effects on one email `send` tool; rates and reservations; the kill switch.
- **Providers:** Anthropic, OpenAI and xAI chat; Gemini chat and embeddings; Mock throughout; PG's xAI realtime path for the CoS.
- **Modalities:** text, batch and streaming STT, timestamped TTS, vision on uploads and camera snapshots, image generation, embeddings, files.
- **Context:** routed items; the company graph with hybrid recall; one connector (QuickBooks or HubSpot) with `asOf`.
- **Presence:** Floor-lite (a desk grid with state glyphs); a Stage for Iris and one coworker; one meeting type with listen-in, take-the-floor and replay for up to 4 agents.
- **Platform:** PG auth; the four DO classes; the Wrangler stub harness; `verify:live`.

**Out of scope:** the Companion and CLI coworkers, video, whispers, doors, Stripe billing (metering only), staff roles, the full spatial Floor.

**Exit criteria:**
- Scenarios 6.2, 6.3 (without the whisper) and 6.5 pass on real providers.
- A forced DO restart duplicates no email.
- The first voiced line plays within 3 s of joining.
- Forecasts land within ±35% on 20 golden projects.
- No cost is silently zero.
- Every non-idle face state is backed by a ledger event from the last 2 s.
