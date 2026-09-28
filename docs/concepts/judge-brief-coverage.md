# Judge scorecard: brief & blend coverage

> **Lens.** Does the concept satisfy every element of the owner's brief? Does it blend the distinctive features of **all three** references?
> The blend check uses each `00-overview.md` §2 "Signature ideas" list and each "Top reusable assets" list.
> **Evidence read in full:**
> - the four concepts;
> - `research/capability-matrix.md` (all of §1–§6);
> - the signature-idea and top-asset sections of `biz-bot/00-overview.md` (§2, §5, §7), `oncloudnine/00-overview.md` (§2, §4.5, §5, §7) and `personagram-ai/00-overview.md` (§2, §4, §6).
>
> **Tags:** [BB] biz-bot · [OC] oncloudnine · [PG] personagram-ai · [NEW] white space.

---

## 1. Verdict

| Concept | Brief (/24) | Blend (/34) | Composite | Shared-gap deduction | **Score** |
|---|---|---|---|---|---|
| **C · Mainspring** (systems-first) | 22 | 30.5 | 9.1 | −0.4 | **8.7** |
| D · Headcount (category-defining) | 22 | 28.5 | 8.9 | −0.4 | **8.5** |
| A · Righthand (owner-first) | 21 | 28 | 8.5 | −0.4 | **8.1** |
| B · Ninth Floor (living office) | 20.5 | 26.5 | 8.2 | −0.4 | **7.8** |

**How the scores are computed**
- **Composite** = 0.6 × (brief score, scaled to 10) + 0.4 × (blend score, scaled to 10).
- **Shared-gap deduction:** every concept loses 0.4 for gaps all four share (§6): no web search, no multilingual speech, video deferred in every MVP, and no voice path for a 1:1 with a coworker.

**Winner under this lens: C · Mainspring, narrowly over D.**
- **Brief coverage is a tie** (22 vs 22), but the two get there differently:
  - **C** is the only concept that designs *every* subsystem the brief lists as a first-class mechanism. It has:
    - a route table for the lead (§4.2);
    - a plan engine with evidence (§4.3);
    - a comms "wire" table with bounds (§4.5);
    - a provider fabric covering Gemini, Azure, Bedrock, Vertex, local servers and CLIs (§4.6);
    - a pipeline per modality (§4.7);
    - a connector-fed company graph with `asOf` (§4.8).
  - **D** covers the experience half better: navigate, view, join, converse and listen.
- **The blend breaks the tie.**
  - C covers **100% of BB's signatures, 86% of OC's and 83% of PG's**.
  - D ties A as the most PG-faithful concept (96%) but is the least OC-faithful of all four (64%).
  - The lens asks for *all three*, so the weakest reference counts.
- **C's weakness is real.** The experiential half of the brief is thin, and its MVP falls short on "conversate with all agents":
  - it offers "a Stage for Iris and one coworker" and a "Floor-lite" (§10);
  - it barely specifies casting of faces and voices for spawned coworkers;
  - it has no AI-disclosure badge.
- **So the final spec should use C's engine chapters and graft B's Floor and D's staffing and persona layer on top** (§7).

---

## 2. Brief coverage grid

**Scale:**
- **2:** fully designed in the vision *and* present in the MVP.
- **1.5:** designed but thin, or cut back in the MVP.
- **1:** partial.
- **0:** absent.

| # | Brief element | A | B | C | D |
|---|---|---|---|---|---|
| 1 | **Single lead agent** that spawns and orchestrates on the user's behalf | 2 · Righthand rebuilt per turn; `steer/pause/rescope/convene/brief` (§8 P1) | 2 · Chief of Staff; "one front door" (§2.3) | 2 · 7 routes as CI-checked data; brief includes project members (§4.2) | 2 · Morgan; `staff`, `steer_project`, `brief_me` (§6) |
| 2 | **Navigate and view** all agents | 1.5 · MVP "list-first desk tiles"; "the full spatial Floor" pushed to *Next* (§13) | 2 · semantic zoom Building→Desk (§5.2); Directory parity and keymap (§10) | 1.5 · Floor is a table row (§5); MVP "Floor-lite (a desk grid)" (§10) | 2 · Floor pods, doors, edges, list view, keyboard (§4); in MVP |
| 3 | **Join and converse** with all agents | 2 · desk 1:1 plus room join, whisper, take the floor (§5.3) | 2 · walk up to any desk; **plan diff** contract when you talk past the lead (§2.3) | 1.5 · "Talks face to face with any coworker" (§5), but MVP is "Iris and one coworker"; whispers out | 2 · stage per coworker in MVP; walk-in, take the floor (§5.2–5.3); whispers in phase 2 |
| 4 | **Listen** while avatars speak | 2 · spoken Brief, listen-in, Friday replay at 1.5× (§4, §5.6) | 2 · voice on demand, skip-to-live, spatial audio, patch-in (§5.4, §7, §8.6) | 2 · voice on demand, catch-up, exact replay "faces moving exactly as they did" (§4.5, §6.7) | 2 · walk-in; stand-up with each lead in their own voice (§5.2, §5.5) |
| 5 | **Interactive avatars** | 1.5 · states listed, not specified (§8 P3, §9) | 2 · 12 states with priority and dwell times; honest about renderer limits (§6); LOD (§5.3) | 1.5 · event→face table (§4.1); LOD (§4.7); claims gaze [NEW] with no renderer caveat | 1.5 · states, LOD, procedural placeholder bust (§5.1, §6); claims gaze (§5.2) |
| 6 | **Specialized personas** | 2 · schema, track record, hire by interview or auto-cast (§3, §7.2) | 1.5 · schema (§9); no hiring flow | 1.5 · schema plus `modelPolicy` (§4.6); no voice uniqueness or casting flow | 2 · persona card, hire interview, "Learned" chips, sceptic on another model family (§6) |
| 7 | **Workflow orchestration** | 1.5 · DAG, ProjectDO, business triggers, playbooks (§8 P4) | 1.5 · Plan Wall, JSON verdicts, Night Shift (§9) | 2 · evidence contract, `when`/`forEach`, leases, fences, effect reconciliation, kill switch (§4.3–4.4) | 1.5 · DAG and ledger summarised (§6) |
| 8 | **Intra-agent communication** | 1.5 · delegate, handoff, escalate; rooms; minutes→tasks (§8 P5) | 2 · arbiter priorities, paced and fast modes, whisper `quietly`/`attribute` (§7) | 2 · ask, message, mention, meeting, whisper, broadcast with bounds; perspective projection (§4.5) | 2 · as A and B, plus **screen share fanned out to every participant** (§5.7) |
| 9 | **Projects with plans** | 2 · Engagements with forecast and spend envelope (§5.2) | 1.5 · room per project; plan semantics thin | 2 · forecast, reserve-on-approve, per-criterion evidence (§4.3, §6.2) | 2 · plan approval with credits and decisions expected (§5.1) |
| 10 | **All LLM providers** | 1.5 · Gemini yes; no Azure, Bedrock or Vertex; OpenAI-compatible only via the Companion | 1 · MVP defers "Gemini, live discovery, CLI coworkers" (§13) | 2 · Anthropic, OpenAI, xAI, **Gemini dialect**, Azure, Bedrock, Vertex, Workers AI, Ollama, LM Studio, llama.cpp, vLLM, CLIs, Mock; policy JSON (§4.6) | 1.5 · Gemini in MVP; Azure, Bedrock and Vertex in phase 3; local models in phase 3 |
| 11 | **Multimodal** (text, speech, voice, image, video, embeddings, etc.) | 1.5 · no video understanding or folder context; video is *Next* | 1.5 · broad list including key-frame understanding (§9); video and folders deferred | 2 · pipeline table covers every modality, frame differencing, re-embed on model change (§4.7) | 2 · full list including keyframes, meeting MP4, screen fan-out (§6) |
| 12 | **Contextual business information** | 2 · House Book, connector-fed graph, first-hour onboarding (§3, §6) | 1.5 · Library, Handbook, "drop target is the scope" (§8.7); graph not connector-fed | 2 · `ContextItem` kinds `connector/kpi/artifact`, `asOf`, the lead routes items, scheduled connector sync (§4.8) | 1.5 · company brain and onboarding; no connector sync or `asOf` |
| | **Total** | **21** | **20.5** | **22** | **22** |

---

## 3. Blend coverage grid: the 34 signature ideas

**Scale:** 1 = present, 0.5 = partial or implicit, 0 = absent.

| Reference signature (00-overview §2) | A | B | C | D |
|---|---|---|---|---|
| **BB-1** One lead, instances of one identity, routing brief | 1 | 1 | 1 | 1 |
| **BB-2** Delegate an outcome → project; Simple mode's one question | 1 | 1 | 1 | 1 |
| **BB-3** Clusters, sceptic, evidence-backed completion, `repairPlan` | 1 | 0.5 | 1 | 1 |
| **BB-4** Inbox decision as the universal pause | 1 | 1 | 1 | 1 |
| **BB-5** Same engine everywhere; honest limits; never local→cloud | 0 | 0.5 | 1 | 0.5 |
| **BB-6** Graded grants and bounded self-extension with Undo | 1 | 1 | 1 | 1 |
| **BB-7** The transcript is the source of truth (derived graph, replay, audit) | 0.5 | 1 | 1 | 0.5 |
| **BB-8** Proactivity as a budget (dial, annoyance budget, judge) | 1 | 1 | 1 | 1 |
| **BB-9** Memory as editable Markdown; reflection as a proposal | 1 | 1 | 1 | 1 |
| **BB-10** Keyless, Mock-first | 0.5 | 0.5 | 1 | 1 |
| **BB-11** Portable config (`AGENT.md`, `WORKFLOW.yaml`) with golden-eval publishing | 1 | 0.5 | 1 | 1 |
| *BB subtotal /11* | *9* | *8.5* | *11* | *10* |
| **OC-1** Server-owned brain, zero model chrome | 0.5 | 1 | 1 | 0.5 |
| **OC-2** Routing by answer shape, as data, with enforced human copy | 1 | 1 | 1 | 0.5 |
| **OC-3** Results delivered exactly once to their origin (task store, tray) | 1 | 0.5 | 1 | 1 |
| **OC-4** Everything is a visible, removable chip (`ContextCard`) | 1 | 1 | 1 | 1 |
| **OC-5** Visible hybrid memory (BM25 + vector + RRF, "memory used") | 1 | 1 | 1 | 1 |
| **OC-6** A face that follows the real sound (`captureTap`, reduced-motion rule, `update_persona`) | 1 | 1 | 0.5 | 0.5 |
| **OC-7** Two realtime transports, one protocol | 0.5 | 0.5 | 1 | 1 |
| **OC-8** Honest capability gating (hidden not disabled; errors name the key) | 0 | 0 | 0.5 | 0.5 |
| **OC-9** Failure is a sentence | 0 | 0.5 | 0.5 | 0 |
| **OC-10** Workers-native, protected by default (SSRF per hop, policy table) | 1 | 1 | 1 | 0.5 |
| **OC-11** Contracts kept honest by tests (preflight, drift, log hygiene) | 0.5 | 0.5 | 1 | 0.5 |
| *OC subtotal /11* | *7.5* | *8* | *9.5* | *7* |
| **PG-1** The face is the interface (landmarks, warpable portraits) | 1 | 1 | 1 | 1 |
| **PG-2** Lip sync from whatever timing exists (fusion driver) | 1 | 1 | 1 | 1 |
| **PG-3** Server-owned realtime (ConversationDO → RoomDO) | 1 | 1 | 1 | 1 |
| **PG-4** Voice front, brain back | 1 | 1 | 1 | 1 |
| **PG-5** Train by talking; "Learned" chips; distillation | 1 | 0.5 | 0.5 | 1 |
| **PG-6** Tools scoped per session role, re-checked at dispatch | 1 | 1 | 1 | 1 |
| **PG-7** Draft → approve publishing boundary | 1 | 0 | 0.5 | 0.5 |
| **PG-8** One identity, many purpose-scoped doors | 1 | 1 | 1 | 1 |
| **PG-9** Instant-first latency design | 0.5 | 0.5 | 0.5 | 1 |
| **PG-10** Multi-avatar voiced meetings you can join and replay exactly | 1 | 1 | 1 | 1 |
| **PG-11** Agents build runnable software safely (canvas, self-repair) | 1 | 1 | 1 | 1 |
| **PG-12** Consent-gated persistence and honest AI disclosure | 1 | 1 | 0.5 | 1 |
| *PG subtotal /12* | *11.5* | *10* | *10* | *11.5* |
| **Total /34** | **28** | **26.5** | **30.5** | **28.5** |
| **Weakest reference covered** | OC 68% | OC 73% | **PG 83%** | OC 64% |

**Top-reusable-asset spot check** (00-overview §7/§6 lists, 44 assets in total). All four concepts cite roughly 38–41 of them. The notable misses:
- **BB relay for CLI coworkers:** only C and B cite it.
- **OC safe rendering and `aido:` action links:** no concept cites them.
- **PG QR share:** no concept cites it.
- **PG `inventCast`/`assignVoice`:** C does not cite them.
- **PG Stripe:** Stripe is in the MVP of A and D only; B defers billing and C meters usage only.

---

## 4. Per-concept assessment

### C · Mainspring (8.7), the winner under this lens

**Strengths**
- **A mechanism for every listed element of the brief.** Each is a table, not a paragraph:
  - the lead's routes (§4.2);
  - the plan engine with a per-criterion **evidence contract** (`citation | receipt | artifact | metric(asOf) | owner_answer`) (§4.3);
  - the comms wire with bounds (§4.5);
  - the provider fabric (§4.6);
  - the multimodal pipeline table (§4.7);
  - the company graph (§4.8).
- **The only concept that takes "ALL LLM providers" literally.** It names:
  - a Gemini dialect alongside the three OC dialects;
  - Azure OpenAI, Bedrock and Vertex;
  - LM Studio, llama.cpp and vLLM;
  - a per-persona `modelPolicy` with voice `fallbacks`;
  - a logged `route.model` selection order;
  - `verify:live` canaries per provider and modality.
- **The best treatment of business context.**
  - `ContextItem` gains the kinds `connector`, `kpi` and `artifact`, plus `scope`, `provenance` and `asOf`.
  - The lead **routes items** to one step, not the whole room ("An invoice photo goes to Theo's step").
  - Connectors feed the graph on a schedule.
- **The most faithful to biz-bot's thesis.** Its line "The workforce is a ledger with faces" takes BB's "the transcript is the source of truth" and makes it the architecture.
  - The frequency rule keeps the ledger sane: "nothing faster than a sentence goes in the ledger".
  - `speech.line {audioKey, alignment}` gives exact replay.
- **It closes the real-world-effect loop with reconciliation.** "reconciled, never blindly replayed" (§4.4, §6.5). `send` and `pay` are never standing grants, and a kill switch fences every live job within 30 s.
- **"Why did we…?" as a ledger query** that returns the meeting clip (§6.7). This is the best use of replay for business context in any concept.

**Weaknesses**
- **The experiential half of the brief is under-designed.**
  - The Floor, Stage and Rooms are rows in a surfaces table (§5).
  - Navigation has no semantic zoom and no directory design.
  - The MVP ships "Floor-lite" and "a Stage for Iris and one coworker" (§10), which **fails "conversate with all agents" at launch**.
- **Spawned coworkers have no casting.**
  - `inventCast`, `assignVoice` and voice uniqueness are absent.
  - In §6.2, "five desks slide in" with no faces or voices described.
- **It never mentions an AI-disclosure badge** (PG-12), even for Doors.
- **It claims "Listening: gaze turns to the speaker [NEW]" and "Thinking: gaze drifts"** (§4.1). PG's renderer has no eye movement (see B §6).
- **The MVP cuts whispers, doors, the Companion, CLI coworkers and video.**

### D · Headcount (8.5), runner-up

**Strengths**
- **The best overall balance on the brief.** Only D and B score 2/2 on every navigate/view/join/converse/listen element with those elements in the MVP. D's MVP also keeps what B's defers:
  - The MVP includes a "stage per coworker", walk-in, take the floor, catch me up, replay links and the daily stand-up.
  - The MVP also includes Gemini and Stripe, which B defers.
- **The strongest PG blend.** "Staff it" (§5.1) chains `assembleTeam` → `inventCast` → `assignVoice` → `paintPortraits` → landmark job. It shows an **OC procedural bust as a placeholder until the portrait paints**, which is a neat graft of OC into PG's instant-first latency.
  - It also uses PG's interviewer ("hire a specialist"), "Learned" chips, distillation, `PLAN_LIMITS`, `meta.ts` OG unfurls, the showcase seed and doors with a real `handoff` → Inbox escalation (§5.6).
- **It uses PG's director mode exactly where T9 allows it.** The stand-up is "one script from real state, voiced per coworker" (§5.5).
- **It is the only concept that fills the matrix white space "screen share into a live meeting".** The RoomDO fans one card out to every participant's perspective (§5.7).
- **The sceptic runs on a different model family from the lead** (§6). This turns "all providers" into a quality mechanism, not just a checkbox.
- **"Presence is observability for non-engineers"** (§1) is the clearest one-line justification for why the brief asks for avatars.

**Weaknesses**
- **The weakest OC blend of the four (64%).**
  - No zero-model-chrome rule.
  - Routing is not data or CI-checked ("Inline or background routing with human-readable step copy").
  - No capability gating, no failure-as-a-sentence, no SSRF or perimeter detail, no tests-as-contracts.
- **Business context is not mechanised.** It has no connector sync, no `asOf` and no KPI items.
- **Some brief-adjacent features are deferred.**
  - Whispers and front doors go to phase 2.
  - Local models, CLI coworkers, Azure, Bedrock and Vertex go to phase 3.
  - Solo-tier governed actions are "Draft only".
- **It claims "gaze toward the speaker [NEW]"** (§5.2) with no renderer caveat.
- **The mechanisms are summaries** (§6), so they would need C's depth to be buildable.

### A · Righthand (8.1)

**Strengths**
- **It turns "listen while avatars speak" into a habit.** The owner rhythm (§4) runs from the Morning Brief to the Decision Deck, Evening Wrap, Friday Review (chaptered replay at 1.5×) and the Month-end Board.
- **The best answer to "orchestrate an output based on contextual information".**
  - The House Book combines `company.md`, a connector-fed graph and standing rules.
  - A first-hour onboarding (§6) uses PG's interviewer discipline ("never re-ask, never request passwords") and PG's intake guard ("no model is called on empty input").
- **It fills the most matrix white space on the lead side.**
  - The **handoff card** (§5.4) is listed in P1 white space and appears in no other concept.
  - It adds an **urgency ladder** from digest to Deck to push to live 1:1.
  - It adds **per-action-class autonomy** with **track-record promotion and demotion** (§7.1–7.2).
  - It adds a **Time-back report** (§10).
- **Voice fallbacks are mapped per provider** "so a coworker still sounds like themselves after a switch" (§9.7). This is the only concept that addresses cross-provider voice equivalence (P2 white space).
- **It is the only concept with full PG-7** (draft → approve cards for everything onboarding learns). It shares full PG-5 ("What I've learned" chips) with D.

**Weaknesses**
- **Navigation is secondary.** The MVP Floor is "list-first desk tiles" and "the full spatial Floor" is *Next* (§13).
- **Multimodal gaps.** It has no video understanding, no folder context and no web search, and video generation is *Next*.
- **Providers are incomplete.** There are no enterprise endpoints, and OpenAI-compatible servers are reachable only through the Companion.
- **It has the weakest OC-5 through OC-11 discipline.** There is no zero-chrome rule, no capability gating and no failure-as-a-sentence.
- **It never names BB's honest limits** ("never silently local → cloud").

### B · Ninth Floor (7.8)

**Strengths**
- **It is the most literal answer to the brief's defining sentence.**
  - Semantic zoom runs from Building to Floor to Room to Desk (§5.2).
  - You can walk up to any desk, and a **Directory** gives parity with a full keymap (§10).
  - Listen-in includes a catch-up, **skip-to-live** and **paced vs fast** meetings (§7).
  - Spatial audio, room tone and a mixer let you "hear your company working" (§5.4).
  - Walkie-talkie patch-in works with Media Session lock-screen controls (§8.6).
- **It resolves the brief's internal tension best** ("all interaction with a single agent" versus "conversate with all agents"). You can talk at any desk, the lead sees it, and a scope change surfaces as a **plan diff** (§2.3).
- **The best avatar spec.**
  - It defines 12 states with a priority order and minimum dwell times.
  - Every presence frame carries a `cause.seq`, and a test asserts it (§6, §13).
  - It is **honest about the renderer**: "no arms and no eye movement", so the raised hand is a UI glyph and "looks toward" is a head yaw (§6).
- **Whisper has a use policy** (`quietly` or `attribute`). Voice approvals are limited to "once" and "task", and standing grants require a tap after a spoken read-back (§8.5).
- **"The drop target is the scope"** (§8.7) makes OC's `ContextCard` scope tangible.

**Weaknesses**
- **The MVP defers "Gemini, live discovery, CLI coworkers and the Workshop"** (§13). This keeps the one major provider none of the references has, which is a direct miss on "all LLM providers".
- **Business context is the thinnest of the four.** There is no connector-fed graph and no KPIs, and onboarding is one table cell.
- **Engine depth is light.**
  - Completion enforcement and `repairPlan` are absent.
  - `InputRequired` appears once.
  - Exactly-once external sends are "spike only" in the MVP.
- **The MVP also defers billing, guests and RBAC.**

---

## 5. Head-to-head call

- **If the panel takes the synthesis route, C's §4 chapters are the spine.** They are the ledger, routes, plan engine, durable execution, wire, provider fabric, multimodal pipelines, context graph and governance.
- **D and B then supply the experience layer:**
  - D §5.1 ("Staff it"), §5.2–5.3 (walk-in, take the floor), §5.5 (the stand-up) and §5.7 (screen-share fan-out);
  - B §5–§7 (Floor zoom, states, room mechanics) and §10 (accessibility).
- **A then supplies the owner loop:** the rhythm, autonomy dial, track record, handoff card and first-hour onboarding.
- **Under this lens, no single concept should be adopted as-is.** Each misses at least one brief element at MVP and at least 17% of one reference's signatures.

---

## 6. Gaps every concept shares (the basis for the −0.4)

1. **Web search with citations is absent from all four.** BB has native search plus `/api/search`, and OC has normalised Anthropic and xAI citations (matrix P8), yet no concept names web search. It is a core "etc." modality for research coworkers.
2. **Multilingual speech is absent.** PG hard-codes `language=en`, and its viseme table covers English graphemes only (matrix P3 and P8 white space). No concept states which languages it supports.
3. **Video is deferred in every MVP** (A *Next*, B deferred, C out, D phase 3). The brief names video explicitly, and OC's xAI video job is rated *solid* with Low–Med port risk (reuse rank 27).
4. **No voice path for a 1:1 with a coworker who is not the lead.** T7 reserves realtime speech-to-speech for the lead. No concept specifies how the owner *talks* to Kit or Priya at their desk: streaming STT → that coworker's own brain → chunked TTS with timestamps, with a latency target. A mentions an "STT → brain → TTS" fallback only for the lead.
5. **No retrieval over artifacts, runs and meeting tapes** (a P9 white-space item). Only C's "why" ledger query (§6.7) gestures at it, so embeddings stay invisible infrastructure.
6. **No generic OpenAI-compatible *cloud* adapter in any first release.** Mistral, DeepSeek, Groq, OpenRouter, Together and similar providers are covered only through local or Companion paths.

---

## 7. Ideas to graft (from any concept)

| # | Idea | From | Why |
|---|---|---|---|
| 1 | The ledger as the single spine. The frequency rule: nothing faster than a sentence is persisted, and `speech.line {audioKey, alignment}` gives exact replay | C §4.1 | Makes "listen" replayable and auditable, and keeps faces honest |
| 2 | Seven lead routes as CI-checked data `{route, taskKind, costClass, approvalRequired, runningText, finishedText, executor}`, each emitting a `route` event with its reason | C §4.2 | Makes the single lead explainable, and fixes the OC `orchestrator.ts:496` override bug and the BB `bizbot.js:29` exclusion |
| 3 | A per-criterion evidence contract, JSON verdicts, `when`/`forEach`, and a forecast range on the approval card that reserves the upper bound | C §4.3 | Makes "orchestrate an output" checkable |
| 4 | Effect reconciliation ("never blindly replayed"); `send`/`pay` never standing; a kill switch that fences every job within 30 s; five-layer governance | C §4.4, §4.10 | The brief implies coworkers act in the real world, and BB refused to |
| 5 | A provider fabric with a Gemini dialect, enterprise endpoints, local servers and a per-persona `modelPolicy` with voice fallbacks | C §4.6 | The only literal reading of "all LLM providers" |
| 6 | A multimodal pipeline table: every modality maps to a route, a cost class and a `ContextItem` or artifact | C §4.7 | Keeps the brief's modality list complete and costed |
| 7 | `ContextItem` kinds `connector/kpi/artifact` with `asOf`; the lead routes items to one step; connector-fed company graph | C §4.8 | Mechanises "contextual information" |
| 8 | "One front door, every other door open": desk conversations are visible to the lead, and scope changes arrive as a plan diff | B §2.3 | Resolves the brief's single-agent vs converse-with-all tension |
| 9 | The FloorProjector: a pure reducer of the event bus, 12 states with priority and dwell times, and `cause.seq` on every frame (tested) | B §2, §6, §13 | Honest, flicker-free presence |
| 10 | Semantic zoom (Building → Floor → Room → Desk), Directory parity, a keymap, "Just tell me" mode, "the drop target is the scope" | B §5.2, §8.7, §10 | Delivers "navigate and view" accessibly |
| 11 | Room mechanics: arbiter priorities, paced vs fast meetings, skip-to-live, 90 s speaking budgets, whisper `quietly`/`attribute` | B §7 | Makes listening in usable at machine speed |
| 12 | Renderer honesty: raised hand as a UI glyph, "looks toward" as a head yaw, gaze as v2 behind `sample(now)` | B §6 | Keeps the spec buildable on PG's actual renderer |
| 13 | A walkie-talkie with Media Session lock-screen patch-in; voice approvals only for "once" and "task" | B §8.5–8.6 | Supports listening on mobile and makes voice consent safe |
| 14 | "Staff it" in one sentence: assemble → cast → unique voice → painted portrait → landmark job, with a procedural bust placeholder until the portrait paints | D §5.1 | Fills C's biggest gap; PG instant-first latency |
| 15 | A stand-up in the coworkers' own voices from real state (director mode, allowed by T9); decisions resolved by voice mid-meeting | D §5.5 | Makes "listen while avatars speak" a daily habit |
| 16 | Screen share fanned out to every meeting participant as a context card, with frame differencing | D §5.7 | Fills matrix white space; multimodal context for groups |
| 17 | Front doors with the persona `handoff` turned into a real Inbox escalation; OG unfurls with a disclosure badge; a keyless Mock demo office | D §5.6, §7, §9 | Completes PG's door and storefront blend |
| 18 | The sceptic on a different model family from the lead; an "unverified" badge on unsourced numbers | D §6, §11 | Makes "all providers" a quality mechanism |
| 19 | The owner rhythm (Brief, Deck, Wrap, Friday Review with chapters at 1.5×), the urgency ladder and a spoken handoff card | A §4, §5.4, §5.6 | Operationalises listening and escalation |
| 20 | An autonomy dial per action class with promotion and demotion from the track record | A §7.1–7.2 | Earned autonomy grounded in BB grants |
| 21 | First-hour onboarding (interview + URL + files → `company.md` cards to approve), three starter delegations, no model call on empty input | A §6 | Seeds business context; PG draft → approve and intake guards |
| 22 | Voice fallbacks mapped per provider so a coworker keeps a recognisable voice | A §9.7 | Cross-provider voice equivalence (P2 white space) |
| 23 | Model names hidden on the Floor and shown in the desk inspector; OC `update_persona` so the lead can design and adjust faces through a strict schema | B §9 | Restores OC-1 and OC-6, which D and A drop |

---

## 8. Must-fix for the final spec

1. **Define "all LLM providers" concretely and put a generic OpenAI-compatible *cloud* adapter in the MVP.** The list should include:
   - native Anthropic, OpenAI, Gemini and xAI;
   - OpenAI-compatible cloud by base URL (Mistral, DeepSeek, Groq, OpenRouter, Together and others);
   - Azure, Bedrock and Vertex;
   - local servers (Ollama, LM Studio, vLLM), reachable through the Companion or a URL;
   - Claude Code and Codex CLIs;
   - Mock.
   The spec must also list which providers cover each modality: realtime (including Gemini Live), STT, TTS, image, video and embeddings. Rates and discovery come with every entry. Never defer Gemini (B §13).
2. **Add web search with citations** as a named tool and modality (BB native plus the OC citation normaliser).
3. **Ship at least one video path early.** Video generation via the OC xAI job as a RunDO, plus key-frame video understanding moved server-side.
4. **Specify the 1:1 voice path to any coworker.** Streaming STT (PG `endpointing`/`smart_turn`), then the coworker's own brain and tools, then `SentenceChunker` TTS with timestamps, then the fusion driver. Set a first-audio latency target. The MVP must let the owner talk to **every** coworker, not "Iris and one coworker" (C §10).
5. **Write down the single-agent contract** (B §2.3). What the owner says to a coworker is logged where the lead sees it, and scope changes route through the lead as a plan diff.
6. **Do not promise gaze or eye movement on the PG renderer** (C §4.1, D §5.2). Use a head yaw and glyphs until a v2 renderer ships behind `sample(now)`.
7. **Every spawned coworker gets:**
   - a unique voice per workspace or project, with mapped fallbacks;
   - a warpable portrait plus a landmark job;
   - a placeholder until the portrait paints;
   - a permanent AI-disclosure badge wherever a non-owner sees it.
   C omits all of these.
8. **Mechanise business context.** Connector-fed graph sync with provenance and `asOf`, KPI and connector context items, per-agent and per-project memory permissions, and tombstones with undo. B and D leave this thin.
9. **Restore OC's product rules, which A and D drop:**
   - zero model chrome by default (inspector only);
   - capability-gated affordances that are hidden, not disabled;
   - errors that name the missing key;
   - failure stated as a sentence;
   - `TOOL_SUMMARY` copy enforced by CI.
10. **Carry every inherited defect fix from matrix §1.6 into the port plan:**
    - BB fake barge-in;
    - BB missing `rates`;
    - BB cloud DO with no keep-alive and one DO per deployment;
    - BB `bizbot.js:29`;
    - OC split voice brain;
    - OC background override throw;
    - PG unreachable timestamped TTS;
    - PG dropped first deltas and early drain;
    - PG xAI-only brain.
11. **Declare language scope** for STT, TTS and visemes. PG is `language=en` with an English-only grapheme table. Either commit to multilingual speech or state that English comes first, with a plan.
12. **Make embeddings user-visible.** Add retrieval over artifacts, runs and meeting tapes ("find where we decided X") on model-tagged, dimension-safe vectors, re-embedded on model change.
13. **Decide explicitly on PG's headline capability.** PG's core product is a *consented talking likeness of a real person*. Every concept uses it only as a prohibition. Either offer an owner-likeness lead or front-door avatar under PG likeness consent and permanent disclosure, or document why not.
14. **Keep the exactly-once real-world effect in the MVP, not as a spike.** B defers it. It should cover at least email send, with reconciliation (C §6.5).
15. **Keep the three largest net-new risks as spikes before stage 1 completes** (matrix §6.2):
    - many faces on one AudioContext mixer;
    - RoomDO observer fan-out with the floor arbiter;
    - a ProjectDO that survives eviction with no duplicate effects.
