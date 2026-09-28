# Headcount: the AI Office

> **Concept D: category-defining.** Why this product wins, and the category it creates.
> Evidence base: `docs/research/capability-matrix.md` and the three reference overviews. Provenance tags:
> **[BB]** biz-bot, **[OC]** oncloudnine, **[PG]** personagram-ai, **[NEW]** white space that no reference covers.

| | |
|---|---|
| **Name** | **Headcount** |
| **Tagline** | *Hire a team in a sentence. Watch it work. Walk in anytime.* |
| **Category** | **The AI Office.** A persistent, spatial and audible workplace. AI coworkers with faces and voices run real projects under one Chief of Staff. |
| **For** | Owner-operators of service businesses with 2–25 people |
| **Wedge** | Boutique agencies and consultancies: "Staff a client engagement in one sentence." |
| **Packaging** | Human seats plus one pool of usage credits. AI coworkers are never billed as seats. |
| **The MVP proves** | One sentence produces a visible, audible, staffed project. It ships a reviewed deliverable while you listen in. |

---

## 1. The big idea

AI can already do much of a small business's knowledge work. What it cannot yet do is **be managed by the person who owns the business.**

Owners manage by presence. They know who is on what. They sit in on the meeting that matters. They are asked before anything irreversible leaves the building. When something goes wrong, they can reconstruct how the decision was made. Each existing AI category breaks at least one of these habits:

- **Chat assistants** give you one brilliant generalist. The work lives in a single scrolling thread, and nobody else is in the room.
- **Agent builders** make the owner the workflow engineer. You can see work in progress only through run logs and traces.
- **Avatar products** give you presence with no work behind it: a face that talks but runs no projects.

Headcount's thesis: **presence is observability for non-engineers.** A face "thinking" at a desk, two coworkers arguing in a room, a hand raised for approval: these are the signals an engineer reads in a trace viewer, shown in the one interface every owner already reads fluently, a team. The faces and voices are not decoration. **They are the monitoring UI.** Engine events drive avatar state directly: a tool call makes the face "working", `InputRequired` raises a hand, `speech_start` starts lip sync **[BB activity bus → PG face stack + NEW states]**.

On top sits **one Chief of Staff**, so you never have to manage the team to use it: you talk to one agent, and it staffs, plans, runs and reports. Yet the office is never a black box. Every desk, room and replay is one click away, and you can walk in, listen and speak at any time.

> **The category line:** Chat gave you an answer. Builders gave you a flowchart. Avatars gave you a face. **Headcount gives you staff.**

---

## 2. Why this wins: the category map

| | Chat assistants (ChatGPT, Claude, Gemini apps) | Agent builders (CrewAI, LangGraph, Relevance AI, Lindy, Zapier Agents, n8n) | AI avatar products (HeyGen, Synthesia, Character-style apps) | **Headcount** |
|---|---|---|---|---|
| Unit of value | An answer or a task | A workflow you designed | A video, or a chat with one face | **A staffed project with a deliverable** |
| Who designs the work | You, prompt by prompt | You or a developer, node by node | A script writer | **The Chief of Staff drafts a plan and you approve it** |
| How you see work in progress | A spinner or step list | Logs and traces | Not applicable | **Desks, rooms, raised hands, replays** |
| Can you hear it or join it | Voice mode with one assistant | No | One avatar at a time | **Listen in on any room, take the floor, whisper** |
| A team with distinct roles | No persistent org | Yes, but invisible | A cast with no work | **Faces, voices, roles and a designated sceptic** |
| Customer-facing | No | Through integrations | Yes, scripted | **Front doors to any coworker, scoped and consented** |
| Models | Mostly the vendor's own | Configurable | Mostly the vendor's own | **Every provider, chosen per coworker** |

The table describes each category's centre of gravity, not a feature checklist. **The defensible part is the integration.** Headcount needs three hard stacks that usually live in three different companies:

1. A **durable multi-agent plan engine** with approvals and exactly-once effects **[BB]**.
2. **Server-mediated multi-party realtime audio** with barge-in and replay **[PG + OC]**.
3. A **portrait-to-talking-face pipeline** that scales to a room of faces **[PG]**.

The owner has already shipped a working version of each: biz-bot's plan engine (237 unit tests), personagram-ai's Wrangler-tested ConversationDO, and oncloudnine's orchestrator and capture (840 unit and contract tests). That head start is the unfair advantage.

**Why now.** Realtime voice supports delegation, so a fast voice can front a slow brain (PG's OpenAI Live path). TTS returns character timestamps for exact lip sync (PG's xAI path). MCP reaches QuickBooks, Xero and HubSpot (BB's catalog). Image models paint warpable portraits on demand (PG's prefix).

---

## 3. Target owner

**Primary: Dana, 41, owner of a 9-person brand-and-growth agency.** She has six active clients. Every proposal, QBR deck and campaign post-mortem passes through her. She turned down two retainers this quarter because she could not staff them. She manages by walking the floor and sitting in on meetings, and she will never open a trace viewer.

Her jobs map onto the moments in §5: staff without hiring (§5.1), know status without asking (§5.2, §5.5), steer while work happens (§5.3), approve before anything leaves (§5.4), and give clients a door that is always open (§5.6).

**Secondary owners:**
- E-commerce operators with 5–15 staff.
- Fractional CFO and CMO practices.
- Real-estate and home-services teams.

**Not for yet:**
- Enterprises building internal agent platforms.
- Developers who want graph-level control. They should keep using LangGraph, and Headcount can later host their agents as coworkers.

---

## 4. Core concepts and vocabulary

- **Workspace**: The business: its owner, staff seats, house rules, timezone, credits and company brain. *(PG `CreatorDO` → `WorkspaceDO`; BB Principal as house style)*
- **Chief of Staff (CoS)**: The one lead agent. The owner names it (default "Morgan"). It cannot be deleted and has one identity across text, voice and meetings. It staffs, plans, moderates and reports. *(BB `routerBot`/`routingBrief`, OC turn protocol, PG voice front / brain back)*
- **Coworker**: A persona with a stable id, a role, skills, tools, a model policy, a budget, a **face** and a **voice**. *(PG doppelganger entity, BB instance layering)*
- **Persona card**: The coworker's editable definition. It exports as `AGENT.md`. *(PG `PersonaProfile`, BB catalog kinds)*
- **The Floor**: The spatial office. Desks are grouped into project pods, rooms have glowing doors, and delegation edges are drawn in flight. An accessible list view mirrors it. *(BB team graph → **[NEW]** spatial renderer)*
- **Desk**: A coworker's live tile. Its face state shows idle, thinking, using a tool, speaking, handing off or raising a hand. *(BB activity bus → PG face → **[NEW]** states)*
- **Room / Meeting**: A persistent team channel. A meeting is a moderated session inside it. *(BB channel-per-team and `/discuss`; PG group stage)*
- **Walk-in**: Opening a room as an observer and hearing the live tail voiced. *(**[NEW]** observer sockets + PG voicer)*
- **Take the floor**: Speaking into a room. The owner has priority and cuts the current speaker. *(PG generation counters + **[NEW]** floor arbiter)*
- **Whisper**: A private note to one coworker during a meeting. Nobody else in the room sees it. *(OC ContextCard + **[NEW]** scope)*
- **Raised hand**: A pending decision, shown as a gesture on a desk and as a card in the Inbox. *(BB `InputRequired` + **[NEW]** gesture)*
- **Grant**: Graded consent for an action: once, this task, this project, 24 hours or standing. *(BB `grants.js`)*
- **Project / Plan / Step**: An objective with success criteria. The plan is a reviewed DAG of 2–8 steps, each with a lead, co-owners and reviewers. *(BB `projects.js`, `plan.js`)*
- **Deliverable**: A finished artifact that has passed review, with its evidence attached. *(BB `extractDeliverable`, artifact registry)*
- **Context card**: Any file, capture or recalled memory, shown as a visible and removable chip with provenance. *(OC ContextBus)*
- **Company brain**: The workspace knowledge graph, readable as `company.md`, `project-*.md` and `agent-*.md`. *(OC graph + BB Markdown memory)*
- **Front door**: A purpose-scoped public link to one coworker, used by customers and clients. *(PG Personagram links)*
- **Replay**: An exact playback of any meeting, with faces, voices, captions and evidence. *(PG `/g/:token` + BB transcript-as-truth)*
- **Pack**: An industry bundle of coworkers, faces, voices, skills, connectors, automations, front doors and golden evals. *(BB templates + **[NEW]** embodiment)*
- **Credits**: One currency for every modality, reserved before spend and capped per project. *(BB ledger + OC signal budgets + **[NEW]** rates)*
- **Companion**: An optional paired desktop helper for shell, files, browser, local models and CLI coworkers. *(BB bridge)*

```
 THE FLOOR (Dana's agency, 10:40)                                   [ list view ⇄ ]
 ┌── Harbor Pet renewal ───────────────┐   ┌── Nordic Oat launch ───────────────┐
 │ [Priya ◉ speaking] [Walt ◉ listening]│   │ [Ines ✋ needs you]  [Omar ⋯ HubSpot]│
 │ [Marcus ⋯ HubSpot]    [Lena ○ idle]  │   │ [Kai ○ idle]                        │
 │  ▣ ROOM: Pricing option · 3 inside ◀─┼── glowing door: click or press L       │
 └─────────────────────────────────────┘   └────────────────────────────────────┘
  [Morgan · Chief of Staff  🎙 hold Space]   Activity rail: 4 running · 1 decision
```

---

## 5. Seven "only we can" moments

Each moment is a scenario, its mechanism (**Under the hood**), and why no competitor category can deliver it (**Why only us**).

### 5.1 Staff it: a team with faces in one sentence

**8:10 am.** Dana is walking the dog. She taps the Chief of Staff bubble on her phone: *"Harbor Pet's renewal is in two weeks and they're wobbling. Build me a renewal case: results, what we'd change, and a pricing option. Under ten slides."*

Morgan answers in about a second: *"Staffing it now. You'll have a plan to approve in about a minute."*

By the time she gets home, the Floor has a new pod:
- **Priya**, account strategist, with a warm alto voice.
- **Marcus**, performance analyst, wired to HubSpot.
- **Lena**, deck designer, with image generation.
- **Walt**, the sceptic, briefed to "speak for Harbor's CFO". He runs on a different model family from the lead.

Each coworker has a face that blinks and a voice nobody else in the office uses. The Inbox reads: *"Approve the plan: 6 steps, about 40 minutes, about 180 credits, 1 decision expected (send deck)."* Dana says "approve".

**Under the hood.**
1. `create_project` calls `materializeProject` with the objective, criteria and `autonomy: review` **[BB]**.
2. `assembleTeam` builds 2–6 members from an enum-constrained schema, with one sceptic and a spread of providers **[BB]**.
3. `inventCast`, `assignVoice` (unique within the project) and `paintPortraits` create each face with the warpable-portrait prefix **[PG]**. A **landmark job** runs once per face, so viewers never re-detect **[NEW]**.
4. Until a portrait lands, the desk shows a procedural CSS bust **[OC]**.
5. `/plan` drafts a clustered DAG **[BB]**, costed from per-model `rates` **[NEW]**.
6. The reply uses "I started it" semantics **[OC]** over voice front / brain back **[PG]**.

**Why only us.** Builders make you design the team. Avatar tools make you design the face. Chat assistants cannot staff anything.

### 5.2 Walk the Floor: listen in on your coworkers

**10:40.** Dana opens Headcount on her laptop. Marcus's desk shows a chart glyph and the caption "querying HubSpot". A door on the Harbor pod glows: *Pricing option · 3 in room.* She presses **L**, and the audio fades in on the live tail.

> **Walt:** "Twelve percent more against flat ROAS? Their CFO stops reading at slide two."
> **Priya:** "Then we lead with the retention cohort, not ROAS."

The speaker's tile lifts, the other faces turn toward it, and a caption line runs underneath. **Catch me up** has Morgan speak a 20-second summary of the fourteen lines Dana missed.

**Under the hood.**
- Coworkers converse **in text at full speed**. Opening the room makes Dana an **observer** on the RoomDO, a promoted PG `ConversationDO` **[PG + NEW]**.
- The RoomDO voices the tail through **writer ‖ voicer (3 lines ahead) ‖ player** **[PG]**. Each utterance is TTS in the coworker's own voice, and revived **timestamped alignment** gives exact visemes **[PG]**.
- Every turn is a real turn by that agent, built from its own perspective by `transcriptToMessages` **[BB]**.
- One app-wide AudioContext feeds per-agent analyser taps, with gaze toward the speaker and stereo panning by desk **[NEW]**.
- Voiced lines are stored in R2 for exact replay **[PG]**.

**Why only us.** Hearing agents confer, with faces, takes both real multi-agent room semantics and an audible stage.

### 5.3 Take the floor, and whisper

Dana is still listening. She holds **Space**: *"Walt's right about the CFO. Don't touch price. Offer a performance kicker instead."*

Walt's audio cuts off mid-word. Priya picks up: *"Got it: flat retainer plus an eight percent kicker above 3.2 ROAS. Marcus, can you model that?"*

Then Dana presses **W** on Lena's tile and whispers: *"Use the client's navy, not our teal."* Lena's head gives a small nod. Nothing appears in the room transcript, and her next draft is navy.

**Under the hood.**
- Dana's voice goes up an AudioWorklet uplink to the RoomDO **[PG]**.
- **Per-speaker generation counters** cancel in-flight audio on the server and drop stale chunks on the client **[PG]**.
- A **floor arbiter** gives the owner priority and makes the Chief of Staff the moderator. It keeps PG's `next: continue | user | end` signal **[PG + NEW]**.
- Dana's words enter the transcript as an owner turn, and every agent sees it through its own projection **[BB]**.
- A whisper is a context card scoped to one agent **[OC + NEW]**.

**Why only us.** Barge-in exists for one assistant. A multi-party arbiter over a *real work meeting* does not.

### 5.4 Raise a hand: approvals with evidence

**14:05.** Dana is on a client call. On the Floor, Priya's desk raises a hand: a small animation and an amber ring.

Dana is in walkie mode, so Morgan says quietly in her earbud: *"Priya's ready to send the Harbor deck to their CMO. Want to see it first?"*

The Inbox card shows the deck, the recipient and the exact email text. Its buttons are **Send once · Allow for this project · Not now · Change something**. Dana says "Send once". The email goes out exactly once, and the receipt is attached to the run. The decision links to the **replay clip** from the meeting where the kicker was decided.

**Under the hood.**
- `InputRequired` becomes a structured Inbox decision with graded grants **[BB]**.
- The send tool is offered only to Priya's role, and the role is checked again at dispatch **[PG]**.
- The send runs through the ledger's `effect`/`receipt` path for exactly-once delivery, which biz-bot built but never wired **[BB → NEW]**.
- The gesture and spoken escalation are new **[NEW]**. The proactivity dial and annoyance budget decide whether Morgan speaks or only queues it **[BB]**.

**Why only us.** biz-bot refused to send by design, and chat assistants rarely act with per-action approval tied to replayable evidence. Here, "may act in the real world" is an auditable grant.

### 5.5 The stand-up in your ears

**7:45 next morning.** Dana is on her commute. A daily automation fires, and Morgan convenes a four-minute stand-up. Each project lead reports **in their own voice, from real run state**:

> "Harbor: deck approved and sent, and the CMO opened it twice. QBR is on Thursday."
> "Nordic Oat: blocked on your approval for the $600 ad test."

Dana interrupts: *"Approve Nordic, cap it at four hundred."* The decision resolves. The minutes arrive as a replay link, together with three new plan tasks.

**Under the hood.**
- A schedule trigger fires in the owner's timezone **[BB + T18]**.
- Each report is written from `projectSummary` and the verb-first `goalBoard` **[BB]**.
- Briefings are the one place PG's **director mode** is used: one script from real state, voiced per coworker, audio stored **[PG, T9]**.
- Morgan's tools resolve Inbox decisions spoken during the meeting **[BB + NEW]**. Minutes become action items, and action items become plan tasks **[NEW]**.
- On a phone, the stand-up plays in the OC presence bubble **[OC]**.

**Why only us.** Elsewhere, status is a dashboard. Here it is a team meeting you can interrupt.

### 5.6 Front doors: customers talk to your coworkers

**11 pm.** Harbor's CMO has a question. The renewal email carried a link: *"Talk to Priya about this proposal."*

The page shows Priya's face and a permanent **AI coworker** badge. Her knowledge is limited to the proposal, the approved case studies and a pricing FAQ that Dana signed off. The CMO asks about the kicker maths, and Priya explains it. Then the CMO asks: *"Can you do seven percent?"* Priya answers: *"That's Dana's call. I'll get it to her tonight."*

The CMO consents to a transcript. The transcript and a summary land in Dana's Inbox, and Morgan proposes a follow-up project.

**Under the hood.**
- The link is a Personagram-style **purpose-scoped brief**: purpose, audience, desired outcome, greeting and selected knowledge **[PG]**.
- Hashed bearer tokens live in the WorkspaceDO, and revoking a link ends its live sessions **[PG]**.
- **Guest mode** has no tools, no memories and approved facts only, and this is checked again at dispatch **[PG]**.
- The persona's `handoff` rule, which was only a prompt line in personagram-ai, becomes a real escalation into the Inbox **[PG → NEW]**.
- Transcripts persist only with consent **[PG]**.

**Why only us.** Avatar vendors have the face without the context; builders have the context without the face. Neither routes a customer's request into a staffed project.

### 5.7 Show it to the room

**Thursday, QBR prep.** Dana opens a meeting with Marcus and Priya and shares her screen, which shows the client's store analytics. *"Why did repeat purchases dip in August?"*

Every coworker in the room receives the same frame as a context card. Marcus answers: *"The dip lines up with the subscription price change on August 4th. It's the card in the top right."*

Dana drags the client's August email calendar (a PDF) into the room, and it becomes a chip everyone can see. A recall chip reads: *memory used: Harbor Q2 retro (keyword + vector).*

**Under the hood.**
- Screen capture with a truthful privacy dot, `SingleFlight` vision descriptions and cards upserted by id **[OC]**.
- The RoomDO **fans one card out to every participant's perspective** **[NEW]**. Frame differencing and card coalescing keep ambient capture from flooding the room **[NEW]**.
- PDF, DOCX and XLSX are extracted **[OC + PG]**.
- Hybrid recall uses BM25, vectors and reciprocal-rank fusion, and shows a provenance chip **[OC]**. It moves server-side to D1 and Vectorize **[NEW]**.

**Why only us.** Screen share into a multi-agent meeting, as shared working context.

---

## 6. Feature set by pillar

**Lead agent (Chief of Staff)**
- One identity across text, voice and meetings, built each turn from the owner's house rules, and undeletable **[BB]**.
- The routing brief includes running projects *and their members*, which biz-bot excluded (`bizbot.js:29`) **[BB + NEW]**.
- Voice front, brain back: the realtime model handles turn-taking and barge-in, and every tool call and substantive answer goes to the server orchestrator, streamed back as speakable chunks **[PG, T6]**.
- Inline or background routing with human-readable step copy **[OC]**.
- Lead tools: `create_project`, `staff`, `convene_meeting`, `post_to_project`, `steer_project` (pause, re-scope, reassign), `escalate`, `brief_me` **[BB + NEW]**.
- Proactivity dial, daily annoyance budget and an LLM "does this matter?" judge **[BB]**.

**Personas and coworkers**
- The persona card combines PG identity fields, BB role, skills and tools, and a model policy, voice, face rig and budget **[PG + BB + NEW]**.
- Instructions are stored as lines. Coworkers **train by talking** (`update_instructions`, `save_memory`) with "Learned: …" chips, and every session and meeting ends with **distillation** **[PG]**.
- A "hire a specialist" interview **[PG interviewer + NEW]**. Cards export as `AGENT.md`, and publishing is gated by golden evaluations **[BB]**. Ids are stable **[BB lesson]**.

**Interactive avatars**
- Portrait → MediaPipe landmarks → fusion viseme driver (`sample(now)`) → Canvas2D strip-warp renderer **[PG]**.
- **Face states** come from engine events: idle, listening, thinking, using a tool, speaking, handing off, raised hand **[NEW]**.
- **Floor LOD**: one rAF scheduler, one AudioContext mixer with per-agent taps, off-screen pausing, 256 px tiles, and a still portrait with a speaking ring beyond N visible faces **[NEW, T10]**.
- A procedural bust holds the desk while a portrait paints **[OC]**. Reduced motion keeps lip sync **[OC + PG]**. No voice cloning, and generated faces only unless there is likeness consent **[PG]**.

**Workflow orchestration**
- The DAG engine runs work → review → revise, rotates the lead on failure, and ends with a finisher and QA, using JSON verdicts **[BB, T12]**.
- A **ProjectDO** hosts the engine and ledger (leases, fencing, outbox, reservations) with an alarm keep-alive. **RunDOs** run long renders and builds with bounded retries **[BB + PG `BuilderDO`]**.
- The **Activity rail** shows progress, offers stop and retry, and delivers each result exactly once to the conversation that asked **[OC]**.
- Automations fire on a schedule or page change, and (net-new) on inbound email, webhooks or CRM stage changes **[BB + NEW]**.
- Plan approval shows a cost forecast. Budgets ride the AbortSignal and are reserved in the ledger **[OC + BB + NEW rates]**.

**Intra-agent communication**
- `ask`, `message`, `handoff` and exact-handle `@mention` are events on one bus **[BB]**.
- Each team has a room. Meetings follow `/discuss` (framing → openings → debate → synthesis) with the Chief of Staff moderating **[BB, T9]**.
- The **RoomDO** has typed participants (agent, owner, observer, guest), observer sockets, a floor arbiter, per-speaker generations and whispers **[PG + NEW]**.
- Agent traffic is text by default and **voiced on demand** **[T8]**. Minutes become tasks **[NEW]**.

```json
{"type":"speech_start","projectId":"pj_harbor","roomId":"rm_pricing","agentId":"cw_walt",
 "lineId":"ln_0142","gen":7,"voiced":"on_demand","alignment":"char_timestamps"}
{"type":"floor_request","roomId":"rm_pricing","from":"owner","priority":"owner","preempt":true}
{"type":"decision","kind":"approval","agentId":"cw_priya","action":"email.send",
 "grants":["once","project","hours:24"],"effectKey":"eff_7f3a","evidence":["ln_0142","art_deck_v3"]}
```

**Projects with plans**
- Objective, scope, success criteria, autonomy, budget and a workspace (`inbox/ artifacts/ apps/ notes/`) **[BB]**.
- An Inbox (Needs your input, Project updates, Recently resolved) and a goals board of verb-first next actions **[BB]**.
- Evidence-backed completion, with `repairPlan` reopening false completions **[BB]**. Run-to-run comparison and client deliverable portals **[NEW + PG links]**.

**All LLM providers**
- One registry with capability flags, per-capability preference orders and honest missing-key errors **[OC]**, implemented with BB adapters: OpenAI, Anthropic, xAI, Workers AI, Ollama, OpenAI-compatible servers, Claude Code and Codex CLIs, and Mock **[BB]**.
- Net-new: **Google Gemini** (chat, Live, embeddings, image), live model discovery, per-model `rates`, and later Azure, Bedrock and Vertex **[NEW]**.
- One agent loop over three tool dialects **[OC]**, with parallel tool calls, the identical-failure guard and partial output on error **[BB]**.
- **Per-persona model policy.** The sceptic defaults to a different model family from the lead, for cross-examination across brains **[BB provider spread + NEW]**. Local models never silently move to paid cloud **[BB]**.

**Multimodal**
- Text; batch and streaming STT; persona TTS with expressive tags; realtime speech-to-speech over WebRTC and WebSocket, server-mediated **[PG + OC]**.
- Vision, camera and screen capture, folders, and files (PDF, DOCX, XLSX, CSV, images, audio) **[OC + PG]**.
- Image generation and identity-preserving edits **[OC + PG]**; video generation as RunDO jobs **[OC]**; video understanding from keyframes, server-side **[BB]**; model-tagged, dimension-safe embeddings **[BB + OC]**; meeting-to-MP4 export **[NEW]**.

**Context and memory**
- The company brain is a D1 graph (OC identity model) with Vectorize chunks and hybrid recall, readable as `company.md`, `project-*.md` and `agent-*.md` **[OC + BB]**.
- Reflection arrives as Inbox diffs **[BB]**. Per-turn briefs are budgeted, and every injection is a visible "memory used" chip **[PG + OC]**. Per-agent memory permissions, tombstones and undo **[NEW]**.

**Tools, connectors and apps**
- MCP over Streamable HTTP, legacy SSE and (through the Companion) stdio, with OAuth 2.1 **[OC + BB + NEW]**. The catalog covers QuickBooks, Xero, HubSpot, Notion, Asana, monday.com, Calendly, Canva and GitHub **[BB]**.
- Agent-built dashboards run in the sandboxed apps SDK with a build-and-repair loop **[BB + PG]**. The lead's self-extension is bounded, with audit and Undo **[BB]**.

**Navigation and UX**
- The Floor, with a list fallback and keyboard navigation **[NEW]**; an immersive stage per coworker with captions and interrupt **[PG]**; a chat surface with tool steps **[OC]**; Simple/Full modes **[BB]**.
- Picture-in-picture speaker, solo/mute mixer, walkie mode and a command palette **[NEW]**. 44 px targets and no horizontal scroll at 375 px **[OC + PG]**.

**Trust and governance**
- Three layers of tool governance: role-scoped offering **[PG]**, grants at call time **[BB]**, endpoint policy **[OC]** **[T15]**. MCP, search and delegate outputs are taint-wrapped **[BB gap closed]**.
- Orgs with RBAC, a secret vault, a unified audit log of which frames went to which provider, and an **"Everyone stop"** kill switch **[NEW]**.

**Business and infrastructure**
- Stripe billing reconciled by current state **[PG]**; metering that actually writes usage events **[NEW]**; packs **[BB]**; an onboarding interview that writes `company.md` **[PG + BB]**.
- Workers with `WorkspaceDO`, `ProjectDO`, `RoomDO` and `RunDO`, plus D1, R2 and Vectorize **[PG + BB, T2]**. Mock-first tests, the Wrangler harness and live canaries including avatar timing **[BB + PG + OC]**.

---

## 7. What makes it compelling: the flywheel

1. **Legibility → trust → autonomy.** Owners grant more when they can see and hear the work. Each workspace's **grant ladder** (once → project → standing) is a measurable trust curve, and it is the leading indicator of expansion.
2. **Trained staff create switching costs.** Every session distils facts and instruction lines into coworkers who get better at *this* business. Leaving means firing a trained team and wiping the company brain.
3. **Every artifact is a demo.** Replays, front doors and deliverable portals unfurl with Open Graph meta and a permanent disclosure badge **[PG `meta.ts`]**. Clients who meet Priya become prospects.
4. **Provider neutrality.** The model market is volatile, and Headcount is the layer that stays put. Each role gets the best model for the job, and bring-your-own-key is supported.
5. **Headcount maths.** Each plan step carries a human-equivalent estimate set at approval **[NEW]**, so the Friday brief can say: *"Your team did about 31 hours of work this week for 2,140 credits."* That line is the renewal argument.

---

## 8. Packaging and pricing

**Principles.**
- **Humans pay for seats. Coworkers are not seats.** If every hire were a purchase, "hire in a sentence" would die. Plans cap coworkers on staff instead (PG's `PLAN_LIMITS` pattern).
- **One credit pool covers every modality.** Every model has `rates`, every project has a budget, and spend is reserved before it happens **[BB ledger + OC signal + NEW]**. At the cap, a project either **stops** or **raises a hand**; the owner chooses which per project.
- **You pay for voice only when someone listens.** Agent traffic is text by default (T8).

| | **Solo** | **Team** | **Business** |
|---|---|---|---|
| Price (illustrative) | $49 / month | $199 / month | $799 / month |
| Human seats | Owner | Owner + 2 staff (+$29 each) | Owner + 9 staff, SSO |
| Coworkers on staff | 8 | 30 | 100 |
| Active projects | 3 | Unlimited | Unlimited |
| Front doors | 1 | 10 | Unlimited, white-label |
| Included credits per month | 2,500 | 12,000 | 50,000 |
| Replay retention | 30 days | 1 year | Custom policy |
| Governed actions | Draft only | Send and schedule, with approvals | Adds standing grants and audit export |
| Bring your own keys, Companion, local models | — | Yes | Yes |

**What a credit buys.** 1 credit = $0.01. The figures below are illustrative and will be calibrated in the MVP against live rates.

- **Model tokens:** provider list rate × a platform margin, per model from the registry's `rates`.
- **Hiring a coworker:** about 8 credits (portrait, landmark job, voice audition).
- **Voiced meeting minute** (walk-ins, stand-ups): about 6 credits.
- **Chief of Staff realtime minute:** about 10 credits.
- **Image / video:** 4–8 per image; about 15 per second of video.
- **Front-door guest minute:** about 8 credits, capped per link and per day **[PG rate limits]**.

With bring-your-own-key, model spend goes to your provider bill, and credits cover only hosted presence (rooms, voicing, renders).

---

## 9. Go-to-market wedge and industry packs

**The wedge: boutique agencies and consultancies with 2–25 people.** Their output (decks, analyses, copy) is what today's models do well. They already think in *engagements* and *staffing*. Their clients spread the product through front doors and replays. Billable-hour maths makes the ROI obvious, and they adopt tools quickly.

**The motion:**
1. **A hero demo with no cuts.** A 90-second screen recording: one sentence → faces → plan → walk-in → take the floor → deck.
2. **A keyless trial.** The Mock provider runs a preloaded demo office **[BB]**, and a seeded showcase coworker is ready to talk **[PG]**. Visitors walk the Floor before signing up. Signing up adds starter credits.
3. **Viral surfaces.** Replays, front doors and deliverable portals, each with a "Made with Headcount" disclosure.
4. **Partners.** Consultancies build custom packs for their verticals, turning OC's consulting positioning into a partner channel. A revenue-sharing pack marketplace follows later.

**Packs.** A pack uses BB's template JSON, extended with `face`, `voice`, `modelPolicy`, `frontDoors[]` and `golden[]`. It applies idempotently and publishes through the golden-evaluation gate **[BB `catalog-store`]**.

| Pack | Coworkers (sceptic in italics) | Connectors | Automations | Front door |
|---|---|---|---|---|
| **Agency** | Account strategist, performance analyst, copywriter, deck designer, *"client CFO"* | HubSpot, Canva, Notion, Asana | Morning stand-up, weekly client pulse | "Talk to your account team" |
| **Fractional CFO** | FP&A analyst, bookkeeping reviewer, collections coordinator, client liaison, *"the auditor"* | QuickBooks, Xero | Month-end close checklist, AR-ageing watch | "Ask about your books" |
| **E-commerce** | Merchandiser, ads analyst, ops and inventory, content maker (image and video), *"the returning customer"* | HubSpot, Canva, store platform **[NEW]** | Daily sales brief, low-stock page watch | "Product concierge" |
| **Home services / real estate** | Lead concierge, scheduler, listing writer, market analyst, *"the first-time buyer"* | Calendly, HubSpot | New-lead response under 5 minutes | "Book a visit" |
| **Software studio** | Builder (a CLI coworker through the Companion), reviewer, tester, docs writer, *"the on-call engineer"* | GitHub, DeepWiki | Nightly test run | "Ask about the release" **[BB `software` template]** |

---

## 10. Roadmap and the MVP that proves the magic

**Phase 0: spikes (weeks 0–4).** These are the three net-new risks the capability matrix says to test first.

- **Many faces:** 8 lip-synced faces plus one mixer at ≥30 fps and <35% CPU, on an M1 laptop and an iPhone 13.
- **RoomDO fan-out:** 4 agents, the owner and 2 observers, with floor hand-off in <300 ms and a barge-in cut in <150 ms.
- **Durable ProjectDO:** a 6-step plan survives isolate eviction and a sleeping laptop, with exactly-once delivery to a fake email sink.

**Phase 1: MVP, "The magic" (weeks 4–16).** It proves five moments: **Staff it**, **Walk the Floor**, **Take the floor**, **Raise a hand** and **the stand-up**.

- **In:** the Chief of Staff in text and realtime voice (voice front / brain back); Staff it (assemble, cast, faces, voices, landmark job); the BB plan engine in the ProjectDO with Inbox, grants and the Activity rail; the Floor (pods plus list view) with desk states and a stage per coworker; rooms with walk-in, take the floor, catch me up and replay links; the daily stand-up; context from files, screen share, the onboarding interview (`company.md`) and project-scoped recall; OpenAI, Anthropic, Gemini, xAI and Mock, all with `rates`; one governed action (send email, exactly once); the Agency pack; Stripe Solo and Team with credits and budgets.
- **Out, deliberately:** front doors and whispers (phase 2), video generation and meeting-to-MP4, the Companion, CLI coworkers and local models, the marketplace and custom pack authoring, RBAC beyond owner plus staff, and any money movement.

**MVP success criteria.** The magic has to be measured:
- A sentence becomes a staffed pod on the Floor in **p50 < 45 s** and p95 < 90 s. Portraits may finish painting afterwards.
- The Chief of Staff's first audio arrives in **p50 < 1.5 s**. PG measured about 1.2 s on its realtime path.
- **≥60%** of new workspaces walk into a room in week 1, and **≥30%** take the floor.
- **≥50%** of approved plans reach an accepted deliverable with at most one revision.
- At least one replay is shared per active workspace per week, which signals the viral loop.
- **Zero** external effects happen without approval, verified from the audit log.

**Phase 2: "Open the doors" (months 4–7).** Front doors and whispers; OAuth connectors for QuickBooks, Xero, HubSpot and Calendly; governed email, calendar and CRM actions; business triggers (inbound email, webhooks, CRM stage changes); minutes become tasks; mobile walkie mode; three more packs.

**Phase 3: "Scale the office" (months 7–12).** The Companion with CLI coworkers and local models; video generation and meeting-to-MP4; orgs, RBAC, SSO and audit export; human staff as plan assignees; pack publishing with golden evaluations; Azure, Bedrock and Vertex.

**Phase 4: platform (12 months and beyond).** A pack marketplace with revenue share, white-label front doors, a public API and webhooks, and a WebGL or 3D renderer behind the same `sample(now)` driver.

---

## 11. Risks and mitigations

- **"It's a gimmick."** Faces can read as toys to a buyer who wants output. *Mitigation:* every demo leads with the deliverable, and faces are framed as status UI. Simple mode swaps faces for still portraits. The north-star metric is deliverables accepted, not minutes watched.
- **Overtrust in a confident face.** Anthropomorphism amplifies authority, including for wrong work. *Mitigation:* evidence-backed completion and `repairPlan` **[BB]**, a sceptic on a different model family, provenance chips on claims **[OC]**, and an "unverified" badge on unsourced numbers **[NEW]**.
- **Voice cost blow-out.** TTS and realtime minutes add up. *Mitigation:* voice on demand (T8), ledger reservations, per-project caps and cheap LOD. Credits keep cost visible.
- **Many faces on phones.** PG's stack is sized for 1–6 faces. *Mitigation:* LOD tiers, off-screen pausing and an audio-only mode, proven in the phase-0 spike.
- **Meeting latency.** Real turns from several models take seconds. *Mitigation:* agents think in text ahead of voicing with 3-line look-ahead; the Chief of Staff fills gaps; "Catch me up" covers long ones.
- **Liability for real-world actions.** *Mitigation:* exactly-once effects, per-action grants, opt-in standing grants, audit and a kill switch. No money movement until after the MVP.
- **Front-door misuse and disclosure law.** *Mitigation:* a permanent AI badge, no voice cloning, generated faces only, consent-gated transcripts, rate limits and guest-mode tools **[PG]**.
- **Provider churn.** Catalogs are hand-maintained and future-dated. *Mitigation:* live discovery, capability-based routing and `verify:live` canaries **[BB]**.
- **Competitive convergence.** Chat apps will add teams; avatar companies will add agents. *Mitigation:* the moat is the integration, trained staff, packs and the replay loop, so win the wedge first.
- **Engineering scope.** Three hard stacks at once. *Mitigation:* the capability matrix's 30 ranked ports, spikes first, and an MVP without the Companion, video or marketplace.

---

**Bottom line.** biz-bot already knows *what work to do and who should do it*. oncloudnine knows *how to turn everything the owner shows or says into context*. personagram-ai knows *how a coworker should look and sound*. Headcount puts the three in one office and adds the missing layer: **you can walk in and listen.** That is what turns "AI that does tasks" into *staff*, and it is a category none of the incumbents is built to occupy.
