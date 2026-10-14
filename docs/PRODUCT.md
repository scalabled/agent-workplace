# Headcount: Product Specification

> **Status.** Definitive product specification, v1.0, 28 September 2026. The vocabulary in §4 is binding for `EXPERIENCE.md` and `ARCHITECTURE.md`.
>
> **Lineage.** Headcount succeeds three MIT projects by the same owner:
> - **[BB] biz-bot**: the brain and the org chart.
> - **[OC] oncloudnine**: the senses and the single-assistant contract.
> - **[PG] personagram-ai**: the face, the voice and the storefront.
>
> **[NEW]** marks white space none of them covers. *Tn* refers to tension *n* in `docs/research/capability-matrix.md` §5.
>
> **How this design was chosen.** Four concepts were judged on owner value, feasibility and brief coverage.
> - **Product spine: Concept A** (*Righthand*, owner-first). It had the highest combined score: A 23.6, C 22.7, D 22.0, B 20.8.
> - **Engine spine: Concept C** (*Mainspring*). It won the feasibility and brief-coverage lenses.
> - **Name, category and packaging: Concept D** (*Headcount*).
> - **Presence and room mechanics: Concept B** (*Ninth Floor*).
>
> Every judge must-fix is resolved. Appendix B shows where.

---

## 1. Name, tagline, pitch

**Name:** **Headcount** · **Category:** *the AI Office*

**Tagline:** ***Hire an AI team. Watch it work.***

> Chat gave you an answer. Builders gave you a flowchart. Avatars gave you a face. **Headcount gives you staff.**

Headcount is an AI office for the owner of a 2–40 person business. You talk to one agent, your **Chief of Staff**, by voice, text, camera, screen or file.

**One sentence becomes a staffed project.** The Chief of Staff:
- reuses coworkers who already know your business;
- hires new ones, each with its own face, voice and specialty, only when a skill is missing;
- drafts a reviewed plan with a dollar forecast;
- runs the work durably in the cloud while your laptop sleeps.

**Two things come back to you:**
- **Deliverables**, each with evidence attached.
- **Decisions only you can make.** They arrive through a five-minute spoken **Brief**, **raised hands** in one **Inbox**, and a weekly **Review** that shows the time you got back.

**Nothing is hidden:**
- Every coworker's **desk** on the **Floor** shows a face driven by what the engine is actually doing.
- Every meeting is a **room** you can listen in on, whisper into or join.
- Every real-world action carries a receipt.
- **Front doors** let customers reach your staff when you can't.

### 1.1 The brief, point by point

| The owner's brief asks for | Headcount's answer | Where |
|---|---|---|
| A single agent who spawns and orchestrates | The **Chief of Staff**: one brain across text, voice and meetings, with seven routes | §5.1, §5.5, P1 |
| Groups and projects of coworkers | **Staff it**: reuse before hire, with a sceptic, and a reviewed plan (a DAG) | §5.1, P2, P4, P6 |
| Interactive avatars with specialized personas | Talking portrait faces driven by real events. Each persona has its own voice and model policy. | §5.2, P2, P3 |
| Workflow orchestration | A durable plan engine with evidence and exactly-once effects | P4 |
| Intra-agent communication | Asks, hand-offs, meetings and whispers, with per-agent perspective and a floor arbiter | §5.3, P5 |
| Projects with plans | Criteria, a forecast, deliverables with lineage, and a room | §5.1, P6 |
| All LLM providers | Anthropic, OpenAI, Gemini and xAI; OpenAI-compatible clouds; Azure, Bedrock and Vertex; local models; command-line tools; Mock | §8 |
| Multimodal (text, speech, voice, image, video, embeddings, etc.) | 17 modalities, each mapped to providers and surfaces | §7 |
| An output built from contextual information | Scoped context cards, a Handbook fed by connectors, and evidence per acceptance criterion | P9, §5.6 |
| Navigate, view, join and converse | The Floor with its Directory, a 1:1 voice stage at every desk, and rooms you can join | §5.2–5.4, P11 |
| Listen while avatars speak | Rooms voiced on demand, a Brief in coworkers' own voices, and exact replay | §5.2, §5.5, §5.9 |

---

## 2. The owner & the problem

### 2.1 Who it is for

Owner-operators of 2–40 person service businesses who already delegate to people. They run 5–15 SaaS tools, they have more work than staff, and many have been burned by automation that "said it did it".

**The launch wedge is boutique agencies.** Their output (decks, reports and copy) is what today's models do well. They already think in terms of staffing, billable-hour maths makes the return obvious, and their clients spread the product.

| | **Dana**, agency founder *(the wedge)* | **Luis**, e-commerce operator | **Priya**, professional services |
|---|---|---|---|
| **Business** | Brightline: an 11-person brand-and-growth agency with 7 retainers | Direct-to-consumer coffee on Shopify: $2.4M a year, 3 staff and an outsourced logistics (3PL) partner | A 6-person bookkeeping and tax practice with 80 clients |
| **AI staff for** | Pitches, renewal decks, client reports, content calendars | Reorders, launch kits (copy, images, video), support drafts, ads | Intake, engagement letters, document chasing, deadline tracking |
| **Systems** | HubSpot, Google Workspace, Canva, Asana | Shopify, Gmail, QuickBooks, Meta Ads, 3PL portal | QuickBooks or Xero, Gmail, Calendly |
| **Biggest fear** | Off-brand or leaked work reaching a client | Money moving wrongly | A confidentiality breach, or a missed statutory deadline |
| **A win** | A proposal out in a day, not a week | A launch without the 11 pm scramble | Every client's month-end close done by the 5th |
| **Pack** | Agency (MVP) | E-commerce (v1) | Practice (v1) |

**Not for (yet):** enterprises building agent platforms, or developers who want graph-level control.

### 2.2 The problem

AI can already do much of a small business's knowledge work. **It cannot yet be managed by the person who owns the business.**

Owners manage by presence. They know who is on what, sit in on the meeting that matters, approve anything irreversible, and can reconstruct how a decision was made.

Each existing category breaks one of those habits:
- **Chat assistants** give you one generalist in one thread.
- **Agent builders** make the owner the workflow engineer.
- **Avatar products** give you a face that does no work.

Attention is the owner's scarcest resource. More dashboards, more agents to manage and more rituals all make the problem worse.

### 2.3 Jobs to be done

1. **"Take this off my plate."** One sentence in, reviewed work out.
2. **"Tell me what needs me in ten seconds, and nothing else."**
3. **"Let me check in without micromanaging."** Look, listen, ask why.
4. **"Only ask me what only I can decide. Never let money or a message leave wrong."**
5. **"Prove it was worth it."** Time back and dollars spent, in numbers the owner believes.
6. **"Let customers reach my team when I can't,** and bring them back to me when it matters."

### 2.4 Why now

- **Realtime voice can front a separate brain.** PG measured about 1.2 s to first audio on xAI realtime. A reasoning brain takes about 18 s, so substantive work goes to the background.
- **Speech output can carry character timestamps**, which enables exact lip sync. PG's xAI path for this is unreachable today, so reviving it is a Phase 0 fix.
- **MCP reaches business systems**, and image models can paint portraits that are ready to animate.
- **The owner has built each hard stack once:**
  - BB's plan engine (16 execution tests, 7 checkpoint tests);
  - PG's Wrangler-tested `ConversationDO` and face pipeline;
  - OC's orchestrator and capture, although its cloud providers never ran against a paid key.

**The moat is the integration.** Three stacks that usually live in three separate companies meet in one product:
- a durable multi-agent plan engine;
- multi-party voice mediated by the server;
- a talking-face pipeline.

---

## 3. The big idea & product principles

### 3.1 The big idea

**Presence is observability for non-engineers.** An engineer reads a trace viewer; an owner reads a team. A face "working", two coworkers disagreeing, a hand raised for approval: these are trace signals, shown in the one interface every owner already reads. **The faces and voices are the monitoring UI.**

**The workforce is a ledger with faces.** Every route, call, hand-off, spoken line, verdict, raised hand, reserved dollar and sent email is appended to a durable ledger, and everything the owner sees is a *projection* of it. So a face cannot look busy when nothing is running, and "Why did we…?" is a query rather than a guess. This takes BB's "the transcript is the source of truth" and makes it the architecture.

**It is organised around the owner's attention.** Everything resolves into a **deliverable** to accept, a **decision** to make, or **nothing**, because it is handled.

```
 Owner ── voice · text · camera · screen · file · phone
   ▼  one front door
 CHIEF OF STAFF (voice front ─ brain back)  routes: answer · ask · delegate · project · steer · meeting · escalate
   ▼ staffs (reuse → hire)            ▼ convenes
 PROJECTS (plan DAG, review, evidence) ── ROOMS (listen in · whisper · take the floor)
   └────────── THE LEDGER (append-only; per project + per workspace) ──────────┘
       projections → faces · Floor · Inbox · Brief · Review · replay · audit · cost · Handbook
```

### 3.2 The owner's loop

**Delegate → staffed project → durable work → raised hands → deliverables → Brief and Review → delegate again.**

The loop closes through **at most three default touchpoints**. Each can be rescheduled or removed:

| Touchpoint | Default | Shape | Limits |
|---|---|---|---|
| **Brief** | Weekdays at 7:30, in the owner's timezone | Spoken. The Chief of Staff opens and project leads report in their own voices. The owner can interrupt, and can decide by voice. | 5-minute cap. "Shorter" and "skip" feedback. Listen-through is tracked. On a quiet day: *"Quiet night. Nothing needs you."* |
| **Inbox sitting** | One nudge at 12:30, only if hands are waiting | A card stack cleared by tap, keyboard or voice | States the expected time, e.g. "About 2 min" |
| **Weekly Review** | Friday at 15:00 | A replayable meeting with one chapter per project, played at 1–2×, ending with the Time-back report | At most 90 s per project lead |

The Evening Wrap and a month-end Review are **opt-in**. Anything else comes only when asked for, or when it climbs the urgency ladder (§9.7).

### 3.3 Product principles

1. **Decisions, not dashboards.** Every status comes with a next verb [BB `goalBoard`], and every loop ends in a deliverable or a decision.
2. **Trust is earned per action, not granted per agent.** Autonomy is set per action class. It grows with the track record, and any reversal shrinks it automatically.
3. **Faces and voices exist to save time.**
   - Audio plays only when the owner asks for it.
   - A summary comes before any stream.
   - Everything plays at 1–2×.
   - Listening replaces reading.
4. **Nothing is faked.** Every non-idle face state has an event cause (`cause.seq`) from the last 2 s. A quiet office stays quiet.
5. **One front door, every other door open.** The owner can talk to any coworker. The lead sees it, and scope changes become **plan diffs**.
6. **No claim without evidence.** Every claim has a citation, artifact, receipt or dated metric, or it is badged "unverified". Nothing counts as "sent" without a receipt.
7. **Money is predictable.** Forecasts are ranges. Spend is reserved before each call. Overruns raise a hand. Everything is priced in dollars, and unknown cost is never zero.
8. **Meetings slow down for you. Work never does.** Agents talk in text, and a room is voiced only while someone listens.
9. **Hide what can't work, and say why in one sentence** [OC]. There is no model chrome, and errors name the missing key.
10. **Staff before hiring, and isolate clients by default.**

---

## 4. Core concepts & vocabulary

This vocabulary is **binding** for `EXPERIENCE.md`, `ARCHITECTURE.md` and all UI copy. It has three tiers: owner nouns (§4.1), owner-visible terms (§4.2) and system terms (§4.3). Plain words such as *plan*, *step*, *deliverable*, *budget*, *replay*, *meeting* and *guest* keep their everyday meaning.

### 4.1 Owner nouns (first-run UI)

| Term | Meaning | Built on | Never call it |
|---|---|---|---|
| **Chief of Staff** | The one lead agent. The owner names it (default "Morgan"). It cannot be deleted and is rebuilt every turn. It is the same agent in text, voice and meetings. It staffs, plans, steers, moderates, briefs and escalates. | [BB] `routerBot`/`routingBrief`; [PG] voice front, brain back; [OC] turn protocol | Righthand, Bizbot, assistant |
| **Coworker** | A persona with a stable id, a role, skills, tools, a model policy, a budget, a **face**, a **voice** and a track record. It is a configuration, not a process. | [PG] doppelganger, `inventCast`; [BB] instance layering | bot; agent or avatar (as the UI noun) |
| **Project** | An objective with criteria, a team, a reviewed **plan** of **steps**, a budget, **deliverables** and a room. **Everyday** is the built-in project for one-off tasks. | [BB] `projects.js`, `plan.js` | Engagement, swarm |
| **Floor** (with **Desks**) | The spatial office. Each coworker has a **desk** tile whose live face shows its state. Desks are grouped into project pods. The **Directory** list does everything the Floor does. | [BB] team graph → [NEW] | office map |
| **Room** | A project's persistent channel and stage. A **meeting** is a moderated session in it, and each room keeps a **replay**. | [BB] channel, `/discuss`; [PG] group stage | Tape, huddle |
| **Raised hand** (in the **Inbox**) | A pending decision. It shows as a hand glyph beside the coworker's face and as an Inbox card with graded grants. | [BB] `InputRequired`; [NEW] glyph | Knock, ticket |
| **Brief** (and **Weekly Review**) | The spoken daily digest, in which project leads speak in their own voices. The Weekly Review is its Friday meeting form. | [BB] triggers; [PG] director mode | Deck, digest, stand-up |
| **Front door** | A purpose-scoped link through which a **guest** talks to one coworker, with a permanent AI badge | [PG] Personagram links | Lobby, guest door |

**Owner verbs:**

| Verb | Meaning |
|---|---|
| **Delegate** | Hand work to the Chief of Staff |
| **Listen in** | Hear a room |
| **Whisper** | Send a private note to one coworker in a meeting |
| **Take the floor** | Speak into a room |
| **Approve** | Resolve a raised hand with a grant |
| **Everyone stop** | Stop all work at once (the kill switch) |

### 4.2 Owner-visible terms

| Term | Meaning | Built on |
|---|---|---|
| **Handbook** | What your staff knows: `company.md`, client and project notes, standing rules, and a graph of customers, products, people and KPIs. All editable as Markdown. | [BB] Principal, Markdown memory; [OC] graph |
| **Context card** | A visible, removable chip for a file, capture, memory, connector fact, artifact or KPI. It shows scope, source and `asOf`. **The drop target is the scope.** | [OC] `ContextCard`; [NEW] |
| **Autonomy** | Set per action class: **Ask**, **Propose**, **Act & report** or **Act quietly** (§9.2) | [NEW] → [BB] grants |
| **Grant** | **Once**, **This task**, **This project**, **24 hours** or **Standing (bounded)** | [BB] `grants.js` |
| **Track record** | Per coworker and action class: approved as-is, edited, declined, reversed. Shown as a résumé on the desk card. | [BB] `buildAudit`; [NEW] |
| **Forecast** · **Usage** | A range of dollars, time and human-equivalent hours on every plan card. All spend, in dollars, from one balance. | [NEW] rates, metering |
| **Receipt** · **Evidence** | Proof of a real-world effect. The proof behind an acceptance criterion: a citation, artifact, receipt, metric with `asOf`, or owner answer. | [BB] `effect`/`receipt`; [NEW] |
| **Night Shift** | A lit desk lamp: durable work continued while no one watched | [NEW]; [PG] alarm jobs |
| **Pack** · **Playbook** | An industry starter: faces, voices, a sceptic, connectors, defaults and front doors. A proven plan, saved and gated by golden evaluations. | [BB] templates, `catalog-store` |
| **Just tell me** · **Walkie-talkie** | Simple mode: the Chief of Staff, Inbox and projects only. Mobile hold-to-talk with audio-only patch-in to a room. | [BB] Simple mode; [NEW] |
| **Companion** | An optional desktop helper for local models, command-line coworkers, shell, files and browser | [BB] bridge |

### 4.3 System terms (binding for `ARCHITECTURE.md`)

| Term | Meaning | Built on |
|---|---|---|
| `WorkspaceDO` | The tenant. It holds members, roles, timezone, the secret vault, billing, quotas, front-door tokens, triggers, the kill switch and the **workspace ledger**. | [PG] `CreatorDO` |
| `ProjectDO` | One per project, including Everyday. It holds the plan engine, the project ledger and bus, and triggers. It is the **single writer for effects**. | [BB] `RuntimeDO`, per project |
| `RoomDO` | One per live room. It holds sockets for the owner, observers and guests; the floor arbiter; per-speaker generations; and provider sockets. | [PG] `ConversationDO` |
| `RunDO` | One per long job: renders, builds, video and command-line steps. It checkpoints and makes at most 2 attempts. | [PG] `BuilderDO` |
| *(no AgentDO)* | Coworkers are data rows plus loop configurations. The number of Durable Objects scales with projects and rooms, not with headcount. | [NEW]; [OC] `runAgentLoop` |
| **Ledger** · `seq` | Append-only events per project and per workspace, rolled up to D1. **Frequency rule:** nothing faster than a sentence is persisted. | [BB] bus; [NEW] |
| **FloorProjector** · **presence frame** | A pure reducer over the ledger. It emits frames `{state, label, cause.seq, dwellMs}`. | [NEW]; [BB] `graph.js` |
| **Route table** | Rows of `{route, taskKind, costClass, approvalRequired, runningText, finishedText, executor}`, checked in CI | [OC] routing tables |
| **Run** · **Step** · **Job** · **Verdict** | **Run:** one plan execution. **Step:** a DAG node owned by a cluster (a lead, co-owners and reviewers). **Job:** a leased, fenced durable unit. **Verdict:** a JSON result, `{verdict, findings[], evidenceChecked[]}`. | [BB]; [PG] |
| **Decision** · **Effect** | **Decision:** the universal pause. **Effect:** an exactly-once external action, written as `effect(key)` → `receipt(key)`. It is reconciled after a failure and never replayed blindly. | [BB] |
| **Voice seam** | The realtime or cascade front handles turn-taking, acknowledgements and barge-in. The server brain supplies all substance and tools. | [PG]; T6 |
| **Floor arbiter** · **generation** | The speaking queue: owner, then Chief of Staff, then a raised hand, then speaking order. Barge-in bumps the current speaker's generation, and stale audio is dropped. | [PG]; [NEW] |
| **Observer** · `speech.line` | A room is voiced only while an audio observer is attached. `voice(lineId)` is idempotent and cached in R2. Each line is persisted once, as `speech.line {audioKey, alignment}`. | [PG]; T8 |
| **Perspective projection** | One agent's view of a room: "conversation so far" capped at 6k tokens, plus a rolling summary | [BB] `transcriptToMessages`; [PG] |
| **Model policy** · **rates** | Per-persona tiers (reason, fast, voice with fallbacks, local-only, budget). Price per model. | [OC] registry; [NEW] |
| **ContextItem** | `{id, kind, scope, provenance, visibility, asOf, tokens, costEstimate}` | [OC]; [NEW] |
| **Distillation** | `{summary, facts[], instructions[]}`, written after every 1:1 and every meeting | [PG] `distill` |
| **Landmark job** · **LOD tier** | Face landmarks, detected once per portrait. Detail tiers: **Hero** (1024 px), **Tile** (256 px, at most 3 animated), **Token** (still image). | [PG]; [NEW] |

### 4.4 Retired terms

These terms appear only as provenance, never in UI copy.

| Retired term | Use instead |
|---|---|
| Engagement | project |
| Pass | hand-off |
| Tape | replay |
| Mailroom | automations |
| Knock Budget | interruption budget |
| Lobby, guest door | front door |
| House Book | Handbook |
| Decision Deck | Inbox sitting |
| Credits | dollars |
| Righthand | Chief of Staff (owners name their own, such as Morgan, Rosa or Wren) |
| Bizbot, doppelganger, Personagram | no replacement; provenance only |

---

## 5. Signature experiences

**Cast**

| Owner | Business | Chief of Staff | Coworkers |
|---|---|---|---|
| **Dana** | **Brightline**, an agency. Clients: Harbor Pet, Northwind Outdoor, Nordic Oat. | Morgan | Juno (copy), Marcus (analytics, HubSpot), Lena (decks), Walt (the sceptic), Pax (research; hired in §5.1) |
| **Luis** | E-commerce | Rosa | Kit (operations), Bea (customer care), Sol (content), Otto (ads) |
| **Priya** | Bookkeeping practice | Wren | Hale (intake) |

Each scene is tagged with the phase it ships in (§11).

### 5.1 One sentence, a staffed project (Dana, Monday 10:05) · MVP

**Dana** (holding the mic): *"Northwind Outdoor invited us to pitch their spring campaign. Deck due Thursday. Build the proposal."*

**Morgan** asks at most two questions: *"What budget did they hint at? Are you presenting, or Juno?"*
**Dana:** *"40 to 60k. Me."*
**Morgan:** *"Staffing it now. You'll have a plan in about a minute."*

**The pod appears.** A Northwind pod appears on the Floor within seconds:
- Juno, Lena and Walt slide in with their trained faces and résumé chips ("Juno · 31 deliverables accepted").
- A fourth desk shows a sketched bust labelled *Hiring: market researcher*.
- Twenty seconds later the bust paints into **Pax**, whose voice nobody else in the office uses.

**The plan card.** Morgan's hand rises with the plan card:

| | |
|---|---|
| **Team** | **Reuse:** Juno (lead), Lena, and Walt, who "speaks for Northwind's CMO" and runs on a different model family from Morgan. **Hire:** Pax, because *no one on staff covers outdoor-retail research.* |
| **Plan** | Research → positioning → concepts → deck → budget sheet → QA. Each step has an owner and a reviewer from another discipline. |
| **Criteria → evidence** | A 12-slide deck in the house template (artifact). Every market claim cited (citation). The budget ties to the rate card (owner answer). |
| **Forecast** | **$14–$22**. Ready Wednesday 11:00. About 16–22 hours of human-equivalent work. One decision expected from you. At $22 it raises a hand rather than stopping. |

Dana taps **Approve**.
**Morgan:** *"Started. Pax will have a first competitor grid in about three minutes."*
A rough grid lands in the room. The full grid replaces it when ready.

**Under the hood.**
- **Routing.** The Chief of Staff chooses route `project` and logs why: "two or more disciplines, a deliverable, a deadline" [OC].
- **Staffing.** Reuse is scored on skills, track record and availability. `assembleTeam` fills only the gaps, adding one sceptic and a spread of providers. The sceptic runs on a different model family from the lead [BB + NEW].
- **Hiring.** `inventCast` gives the new hire a unique voice and a warpable portrait [PG]. A placeholder bust holds the desk meanwhile [OC], and Dana's browser writes back the face landmarks [NEW].
- **Cost of a hire.** One row and one presence event. No new process.
- **Approval.** Approving is a decision bound to the plan's `runId` and reserves $22 [BB]. A quick sketch appears first and is replaced by the full version [PG].

### 5.2 Walk the Floor and listen in (Dana, Monday 12:15) · MVP

The Floor shows three project pods and the Everyday row. At a glance:
- **Marcus's lamp is lit.** His overnight HubSpot refresh ran at 02:10.
- **Pax's head is tilted down.** His status reads *"Reading 14 outdoor-retail reports."*
- **Juno is "thinking…"**.
- **The Northwind door plate** reads *"In session: positioning · Juno, Walt, Lena · no listeners."*

**Listening in.** Dana presses **L**.
- **Morgan** gives an 18-second catch-up: *"Eleven minutes in. Juno wants to lead with 'the slow outdoors'. Walt says their CMO will ask how that sells jackets."*
- The live tail then plays in the coworkers' own voices. **Walt**, dry and low: *"Brand love doesn't move their Q2 number. Show me sell-through."*
- The speaker's face lifts to hero size and lip-syncs. The others dim to tokens, turned toward the speaker, while captions run.

**Pacing and exit.**
- The room is now **paced**: each next turn is written while the current line plays.
- Dana looks away for 90 seconds and falls eight lines behind. Morgan inserts a skip line: *"They've moved on. Juno accepted sell-through; now it's budget tiers."*
- She closes the room. Voicing stops within one line, and the meeting returns to machine speed.

**Under the hood.**
- **Presence.** Each tile state is a FloorProjector frame with a recent `cause.seq` [NEW].
- **Listening.** Pressing **L** makes Dana an **observer** on the RoomDO. The first observer triggers the catch-up and voice on demand (T8).
- **Voicing.** Agents take turns in text. The client pipelines writer ‖ voicer (three lines ahead) ‖ player. Each line is voiced once through `voice(lineId)`, cached in R2 and stored as `speech.line` [PG].
- **Level of detail.** One hero face, at most three animated tiles, and one `AudioContext`.
- **MVP limits.** One room is audible at a time, and listening time is metered [NEW].

### 5.3 Whisper, then take the floor (Dana, Monday 12:20) · MVP; voice whispers in v1

**The whisper.** Dana selects Walt's seat, presses **W**, and types: *"Their new CMO came from REI. Push on retail sell-through."*
- The policy stays on **quietly**.
- Walt uses the note without quoting it: *"Their retail partners report sell-through weekly. If the concept can't show up in that report, it won't survive the first review."*

**Taking the floor.** Dana holds **Space**: *"Before you close: lead with sell-through, and put the Harbor case study on slide 4."*
- Juno's audio ducks the moment Dana's mic detects speech, and stops within **300 ms**.
- All three faces turn toward Dana's tile.
- **Juno:** *"Sell-through first, Harbor on slide 4. That changes the concepts step, so I'm sending Morgan a change."*
- A **plan diff** appears: step 3 gains Marcus as a reviewer, step 4 gains a criterion, and the forecast rises by $3. Dana taps **Accept**.

Tapping **Raise hand** instead would have let Juno finish her sentence first.

**Under the hood.**
- **The whisper** reaches only Walt's view of the room. It is tagged `quietly` or `attribute`, is locked on Dana's replay, and is never shown to staff or guests [BB `transcriptToMessages` + NEW].
- **Barge-in.** The owner's claim has priority 0. The client ducks the audio as soon as speech is detected (about 120 ms). The server then bumps Juno's **generation**, and stale audio is dropped [PG].
- **Owner turns.** Dana's speech goes through streaming STT and `TurnAssembler`. The moderator fills the 2–4 s reply gap [PG + NEW].
- **Scope changes** arrive as a plan diff, and any approvals they touch are marked stale [BB].
- **Replay.** Dana's own voice is kept only because she consented. Otherwise her lines replay as captions.

### 5.4 Talk to anyone: the single-agent contract (Dana, Monday 16:00) · MVP

**At Lena's desk.** Dana walks up to **Lena's desk** (Enter). It opens as a stage showing Lena at hero size, her thread, her context cards and her current step.

**Dana:** *"Can the budget slide show three tiers?"*
**Lena**, two seconds later, in her own voice: *"Yes. That changes what Walt reviews and adds about forty minutes. I'll send it to Morgan as a change."*
Dana accepts the plan diff at the desk.

**Sharing a file.** She drags Northwind's brand guide onto Lena's desk, and the card reads *"Brand guide · Lena only"*.
- On the **room wall**, it would have gone to the whole team.
- On **Morgan**, it would have been routed by Morgan.

**What the lead sees.** Morgan's thread later shows one line: *"You talked to Lena (2 min). Three budget tiers, change accepted, brand guide shared."*

**Under the hood.**
- **The 1:1 voice path to any coworker** runs:
  1. streaming STT;
  2. `TurnAssembler`;
  3. that coworker's own fast-tier brain and tools;
  4. `SentenceChunker`, which releases the first clause of 60 characters or more early;
  5. TTS in the coworker's voice;
  6. the lip-sync driver.

  Target: first audio **within 2.5 s at p50** [PG + NEW].
- **The single-agent contract.**
  - Each desk conversation is logged to the ledger and distilled for the Chief of Staff [PG `distill`].
  - A coworker cannot write the plan, criteria, budget or deadline. The ProjectDO accepts those writes only as a plan diff, raised through `propose_change`.
  - The write guard *is* the contract, so no scope detector is needed [NEW].
- **The drop target sets `ContextItem.scope`** [OC + NEW].

### 5.5 The Brief in your ears (Dana, Tuesday 7:40, driving) · MVP

Dana's lock screen reads *"Brief · 4 min 10 s · 2 need you."* She plays it at 1.25×.

**The opening.**
- **Morgan:** *"Morning. Two things need you, three are handled. Nothing's on fire."*
- **Juno**, in her own voice: *"Northwind: positioning is locked, the deck is at slide 9, and we're on track for Wednesday."*
- **Marcus:** *"Harbor Pet: retention is up 14% as of last night's HubSpot sync. The renewal deck is drafted."*

**The first decision.**
- **Morgan:** *"Juno's follow-up to Nordic Oat's brand lead, one recipient. Approve once?"*
- **Dana:** *"Approve once."*
- **Morgan** reads it back: *"Sending Juno's follow-up to Kirsten at Nordic Oat, once."* A receipt chip appears.

**The second decision.**
- **Morgan:** *"Marcus wants to send the Harbor deck with a pricing option to their CMO and CFO—"*
- **Dana** cuts in: *"What's the pricing option?"*
- The recording ducks, and **Morgan** answers live: *"A flat retainer plus an 8% kicker above 3.2 ROAS. Marcus's model is attached, and Walt signed off."*
- **Dana:** *"Send it."*
- **Morgan:** *"That's client pricing, so it needs your screen. It's first in your Inbox for when you park."*

**Under the hood.**
- **Composing the Brief.**
  - A trigger in Dana's timezone builds the Brief at 07:10 from every ledger entry since the last Brief.
  - Items are ranked by who needs Dana, then deadline, then dollars, and each starts with a verb [BB `goalBoard`].
- **Real state only.**
  - The script is written in **director mode from real state**. Any sentence that cannot cite an event, receipt or metric is cut.
  - Each line is voiced once and cached [PG + NEW].
- **Barge-in** hands the turn to the xAI realtime front, which answers from the fast tier (T6).
- **Voice approvals.** Voice alone can grant only Once or This task, only under the voice cap, and only after a read-back (§9.3).

### 5.6 Show it, don't type (Luis, at the roastery) · v1 pack; the capture and video paths ship in the MVP

**A damaged delivery.** Luis points his phone at a crushed pallet and the 3PL receiving slip: *"Figure out what happened and get it fixed."*

Two cards appear at once and sharpen a second later: *"Photo · 6 bags torn"* and *"3PL slip #88213 · 38 of 44 undamaged"*. Rosa routes the **cards**, not just a task:
- **Kit** matches the slip against the 3PL portal and drafts a damage claim. He raises a hand only for the send.
- **Bea** drafts delay notes for the 11 affected pre-orders. That is one raised hand, with one receipt per email.

**An ads question.** Later, in a meeting with Otto and Sol, Luis shares Meta Ads Manager: *"Why did cost per acquisition jump yesterday?"*
- Otto, the coworker addressed, gets the frames. The room gets one shared description.
- **Otto** answers with a chart: *"Frequency on the Guji ad set hit 4.1 (Meta Ads, asOf 09:00)."*

**Making video.** *"Sol, cut a 15-second video for the Guji launch from Thursday's photos."*
- A storyboard frame appears in about 20 s.
- The clip lands about two minutes later.
- From a harvest video Luis drops in, Sol pulls three stills for the launch email.

**Under the hood.**
- **Captures** are ContextItems. Each is upserted and then enriched in place. Frames are differenced and handled one at a time. A privacy dot shows while capturing [OC + NEW].
- **Routing.** Each item goes to one step [NEW]. In a meeting, only the **addressed** coworker gets the raw frame; everyone else gets the description [NEW]. Connector facts carry `asOf`.
- **Video.**
  - Generation runs as a RunDO job on xAI `grok-imagine-video-1.5` [OC + PG].
  - Understanding extracts up to 12 key frames on the client [BB + NEW].

### 5.7 A raised hand, and a send that happens exactly once (Priya, month-end) · v1 pack; the mechanism ships in the MVP

**The raised hand.** Hale's desk raises a hand: *"Price monthly payroll for Lotus Kitchen? I suggest $180/month, based on two comparable clients"* (both cited).

**The urgency ladder.** The client signs today, and Priya is in back-to-back calls.
- The ladder climbs: digest → Inbox → **push** → **live**.
- The judge marks it "matters now".
- One push goes out, within today's budget.

**The handoff card.** Priya taps the push and lands on Hale's stage. His **15-second handoff card**, spoken and shown, covers:
- who is asking;
- what is needed;
- why now ("the client signs today");
- his recommendation ($180);
- the options: approve, change or hold.

**Priya:** *"Do $195, and add it to the standard menu."* It takes 45 seconds. The standing change arrives as a Handbook card to approve.

**The send.** Wren then asks: *"Send document-chase emails to the 23 clients due by the 5th?"* Priya taps **Approve for this task**.
- A deploy restarts the ProjectDO after 9 sends.
- The stale lease is fenced out.
- The one pending effect is checked against the email provider's record. It was delivered, so sending resumes at 10.

The rail reads: *"23 of 23 sent, no duplicates."*

**Under the hood.**
- **The decision.** `InputRequired` becomes a structured decision that offers only the grants that are allowed [BB]. The urgency ladder and handoff card are new [NEW].
- **Exactly once.** The emails go out through a `forEach` step. Each effect key combines the project, the recipient and a hash of the template. A pending effect is reconciled against the provider, never blindly replayed [BB ledger, wired NEW].
- **The receipt check.** Hale cannot say "sent" without a receipt [PG → NEW].

### 5.8 The front door (Dana, Thursday 23:10) · v1

**The guest arrives.** Harbor Pet's CMO clicks *"Questions? Talk to Marcus about this proposal."*
- She sees Marcus's face and a permanent **"AI coworker · Brightline"** badge.
- Marcus knows only what was approved for this door: the proposal, two case studies and a pricing FAQ.
- His one tool is *request a callback*.

**The ask.**
- Marcus explains the kicker, citing slide 6.
- **CMO:** *"Can you do seven percent?"*
- **Marcus:** *"That's Dana's call. I'll get it to her tonight."*
- The CMO consents to a transcript.

**The morning.** Dana's Inbox holds:
- the transcript and its summary;
- a raised hand: *"Harbor asks for a 7% kicker. Walt: it holds only if the ROAS floor rises to 3.4"*;
- Morgan's proposed follow-up project, with a forecast.

Dana approves during her Brief.

**Under the hood.**
- **What a door is.** A purpose-scoped brief behind a hashed bearer link. The raw token lives only in the WorkspaceDO.
- **Revoking** a door ends its live sessions.
- **Guest tools** are re-checked at dispatch [PG].
- **Handoff.** PG's prompt-only `handoff` becomes a real escalation into the Inbox [NEW].
- **Transcripts and limits.** Transcripts are kept only with versioned consent, and guest minutes are capped.
- **Branding.** Brightline's tier removes Headcount branding. The AI badge stays.

### 5.9 The Weekly Review, "Why did we…?", and earned autonomy (Dana, week 6) · the Review ships in the MVP; promotions and "Why" in v1

**The Review.** Morgan chairs Friday's Weekly Review.
- Each lead speaks for no more than 90 s.
- Walt challenges one thing per project.

Dana replays it in the car at 1.5×, one chapter per project. She says "skip" at Nordic Oat. At Harbor she asks, *"Why is this over budget?"* The replay pauses, Morgan answers, and it resumes.

**The Time-back report** closes it:

> *"27 deliverables accepted. 9 decisions, median 2 h 10 min to resolve. $186 spent. An estimated 34–46 hours of work at your calibrated rates. Forecasts landed in range on 5 of 6 projects."*

**A promotion.** Morgan proposes one:

> *"Juno drafted 24 posts for Brightline's LinkedIn in five weeks: 22 approved as-is, 2 lightly edited, none reversed. Let Juno publish from the approved asset library, at most 3 a week, for 30 days?"*

Dana taps **Allow** on screen; voice never grants standing permissions.

**A demotion.** Two weeks later she pulls a post that cites a retired case study. Juno's *publish* class drops back to **Propose** automatically, and the next Brief says why.

**"Why did we…?"** A month on:
- **Dana:** *"Why did we stop pushing Harbor on price?"*
- **Morgan:** *"In the pricing meeting on the 6th, Walt showed their CFO would reject 12% at flat ROAS, and you chose the kicker. Want to hear the 40 seconds?"*

The faces move exactly as they did.

**Under the hood.**
- **The Review** is BB `/discuss` under a moderator (T9), with PG exact replay plus chapters.
- **Time-back** ranges come from human-equivalent estimates attached to each plan step at approval, which the owner calibrates [NEW].
- **Promotion** is a **bounded** standing grant, proposed from the coworker's track record and demoted automatically on any reversal (§9.4).
- **"Why did we…?"** queries the workspace's D1 roll-up of verdicts, decisions and meetings, plus embeddings over replays. It returns `speech.line` audio with its alignment [NEW].

---

## 6. Feature specification by pillar

**Phase key:** **M** = MVP, **1** = v1, **2** = v2, **P0** = Phase 0.

*Italic* clauses are testable acceptance criteria.

### P1: Lead orchestrator (Chief of Staff)

| Capability and acceptance | Src | Ph |
|---|---|---|
| **Per-turn build.** The Chief of Staff is rebuilt each turn from the Handbook plus a routing brief. The brief holds the roster *including project members*, each project's status, open decisions, budget headroom and new context cards. *A test fails if any member is missing* (fixes `bizbot.js:29`). | BB | M |
| **Seven routes as data.** Answer, ask, delegate, project, steer, meeting, escalate. Each row carries running and finished copy **and** an executor. *CI fails if either is missing* (fixes `orchestrator.ts:496`). Every turn emits `route {reason}`. | OC, NEW | M |
| **Lead tools.** `create_project`, `post_to_project`, `steer_project` (pause, rescope, reassign), `convene_meeting`, `escalate` and `brief_me`. `search_history` comes in v1. | BB, NEW | M |
| **One brain for text, voice and meetings.** A turn that only starts work counts as done ("I started it"). Each result is delivered once, to the thread that asked for it. | OC, PG | M |
| **The voice seam.** *Acknowledgement at p50 ≤ 1.5 s. A fast-brain answer at p50 ≤ 3 s.* Work that needs a reasoning model, or more than 2 tools, goes to the background after a one-sentence reply. | PG, NEW | M |
| **Staff before hiring.** The plan card shows reuse versus hire, with a reason. The Chief of Staff hires only for disciplines nobody covers. Active coworkers are capped per tier. | NEW | M |
| **Proactivity.** A dial allows 0, 6 or 30 pings a day, with an LLM judge, an urgency ladder and a handoff card (§9.7). | BB, NEW | M |
| **Everyday.** A built-in project for one-off work, so every effect has exactly one writer. | NEW | M |

### P2: Specialized personas (Coworkers)

| Capability and acceptance | Src | Ph |
|---|---|---|
| **The coworker schema.** Each coworker is keyed by a stable id and records:<br>• the 9 PG identity fields, including the handoff rule;<br>• role and skills;<br>• instructions stored as lines (≤ 12k characters);<br>• tools, grants and model policy;<br>• voice as `{provider, voiceId, speed 0.85–1.15, fallbacks[]}`;<br>• face as `{renderer, assetId, landmarks}`;<br>• memory scopes, budget and track record.<br>Every prompt inherits the owner's house style and standing rules [BB `agent.js:43`]. | PG, BB, NEW | M |
| **Staff it.** Assemble 2–6 members, including one sceptic and a spread of providers. Then cast them, give each a unique voice, paint a portrait and detect landmarks. *The pod is visible at p50 < 45 s and p95 < 90 s.* | BB, PG, OC | M |
| **A cross-family sceptic.** The sceptic's policy excludes the lead's model family. Every pack ships an in-character sceptic. | NEW | M |
| **Train by talking.** Coworkers learn through `update_instructions`, `save_memory` and "Learned: …" chips. Every 1:1 and every meeting ends with distillation. | PG | M |
| **Hire interview.** It follows PG's interviewer rules: one question at a time, and never ask for secrets or identifiers. | PG | 1 |
| **Appearance and voice edits.** Made through a strict schema, with an identity-preserving edit, as tier-0 drafts. | OC, PG, BB | 1 |
| **Export and retirement.** `AGENT.md` export. Golden-evaluation publishing. A retired coworker keeps its track record. | BB | 1 |

### P3: Interactive avatars

| Capability and acceptance | Src | Ph |
|---|---|---|
| **The face pipeline.** MediaPipe landmarks feed the fusion driver `sample(now)`, which drives the Canvas2D strip-warp renderer. The driver's timing sources, in priority order: alignment > timed deltas > deltas > spectrum > energy. | PG | M |
| **Level of detail.** One Hero at 1024 px. At most 3 animated Tiles at 256 px. Everyone else is a Token. One rAF scheduler, `IntersectionObserver` pausing, and `<avatar-view maxSide tier paused>`. One `AudioContext`, created in a user gesture, with per-agent analyser taps fed in `captureTap` order. *1 hero, 3 tiles and 12 tokens run at 60 fps on a laptop and 30 fps on an iPhone 13.* | OC, PG, NEW | M |
| **States.** MVP: idle, thinking, working, listening, speaking, handing off, raised hand, blocked. v1 adds attending, receiving, delivered and away. Priority: speaking > raised hand > blocked > listening > handing off > … > idle. Minimum dwell: thinking 600 ms, handing off 1.2 s, delivered 2 s. *A bus-replay test checks that every non-idle frame carries a `cause.seq` ≤ 2 s old.* | NEW | M, 1 |
| **Renderer honesty.** The raised hand is a glyph beside the face. "Looks toward" is a head yaw, because the renderer has no eye movement or arms. Gaze and expressions arrive only with a v2 renderer (WebGL, Live2D or Rive) behind `sample(now)`. | NEW | M, 2 |
| **The landmark job.** The owner's browser, as first viewer, detects landmarks and writes them back, validated by `landmarks.ts`: coordinates 0–1, contours of 3–30 points, at most 100 KB. v1 adds a server-side browser job for portraits made with no client attached. *No viewer ever re-detects.* | PG, NEW | M, 1 |
| **Fallbacks.** A procedural bust holds the desk while a portrait paints. Night Shift lamps. Reduced motion keeps lip sync on. Still-portrait mode and Text Floor are available. | OC, PG, NEW | M |
| **Lip-sync fixes.** Fix the dropped first deltas and the early drain. Revive timestamped TTS. *Exact lip sync is claimed only after the alignment canary passes.* | PG | P0 |

### P4: Workflow orchestration

| Capability and acceptance | Src | Ph |
|---|---|---|
| **The plan engine.** BB `executePlan` runs as a pure package in the ProjectDO:<br>• a DAG of 2–8 steps (configurable), each owned by a cluster;<br>• concurrency 3;<br>• work → review → one revision;<br>• lead rotation, then a finisher and QA;<br>• checkpoints and `repairPlan`;<br>• JSON verdicts.<br>*BB's 16 execution tests and 7 checkpoint tests become the spec.* | BB | M |
| **The evidence contract.** Each criterion names its proof: citation, artifact, receipt, metric with `asOf`, or owner answer. A step is done only when `finish = stop`, the output is non-empty, no blocking finding is open, and every criterion is linked to its proof. Metric proofs arrive in v1. | NEW | M, 1 |
| **Forecast at approval.** Ranges for dollars, time and human-equivalent hours. Approval reserves the upper bound. Each project chooses what hitting the cap does: *stop* or *raise a hand*. | NEW | M |
| **Durable execution.** Idempotent enqueue. A 90 s lease with a fence, and a 30 s heartbeat. Backoff, then dead-letter after 3 attempts. An outbox and an alarm keep-alive. RunDO jobs get at most 2 attempts, with time ceilings: image 5 min, document 3, app 10, video 20, agent 10. *In a deploy-restart chaos test, no receipt is duplicated.* | BB, PG, OC | M |
| **Plan shapes.** `forEach` fan-out and fan-in (M). `when` branches, per-step deadlines and free dry runs on the Mock provider (1). | BB, NEW | M, 1 |
| **Triggers in the owner's timezone.** Schedule and page watch (M). Inbound email, webhook, form, payment and CRM stage change (1). | BB, NEW | M, 1 |
| **The Activity rail.** Stop, retry, readable failures, records of at most 2 KB, and delivery once to the thread that asked. | OC | M |
| **Playbooks.** `WORKFLOW.yaml` → golden evaluation → approve → publish → rollback. | BB | 1 |

### P5: Intra-agent communication

| Capability and acceptance | Src | Ph |
|---|---|---|
| **Primitives.**<br>• `ask`: synchronous, depth ≤ 2.<br>• `message`: asynchronous, ≤ 6 rounds.<br>• `mention`: by exact handle.<br>• `meeting`: framing, openings, 1–4 debate rounds, synthesis.<br>• `whisper` and `broadcast`. | BB, NEW | M |
| **Perspective projection.** Bounded to a 6k-token "conversation so far", plus a rolling summary and prompt caching. Rooms carry only guest-safe context, never private memory. | BB, PG | M |
| **RoomDO.** Participants are agents, the owner, observers and guests. Observer sockets hibernate. `join` upgrades an observer to a speaker. *Provider sockets are open only while the owner's mic is live.* | PG, NEW | M |
| **The floor arbiter.** Priority: owner 0 > moderator 1 > raised hand 2 > speaking order 3. Per-speaker generations and `next: continue \| user \| end`. Each agent gets 90 s per round. *Barge-in ≤ 300 ms: hold-to-talk cuts the speaker, and raise-hand yields at the end of the sentence.* | PG, NEW | M |
| **Voice on demand.** The first audio observer triggers a catch-up of ≤ 20 s, then the live tail. A skip line is inserted when voicing falls more than 20 s or 8 lines behind. Voicing stops when the last observer leaves, and a daily cap limits voiced seconds. *First voiced line at p50 ≤ 2.5 s. No line is ever voiced without an observer.* | PG, NEW | M |
| **Pacing.** Only meetings are paced, and paced turns use the fast tier. | NEW | M |
| **Minutes.** Minutes → action items → plan diff. Manual in the MVP, automatic in v1. | NEW | M, 1 |
| **One effect writer.** Tool calls with side effects that start in a room go through the ProjectDO ledger. The RoomDO only appends `message` and `speech.line`. | NEW | M |

### P6: Projects with plans

| Capability and acceptance | Src | Ph |
|---|---|---|
| **The project record.** Objective, scope, criteria, autonomy, budget and cap behaviour. A **client tag** that sets the isolation scope. Team, plan and room. R2 folders `inbox/ artifacts/ apps/ notes/`. | BB, NEW | M |
| **The plan card.** DAG, owners and reviewers, reuse versus hire, forecast, decisions expected, and evidence per criterion. | BB, NEW | M |
| **The Inbox.** Needs you · Updates · Resolved. Copy leads with a verb, and decisions carry structured payloads. A step may have several questions pending. | BB | M |
| **Deliverables.** Each keeps its lineage (coworker, step, context cards, reviewer, evidence) and its versions, across 10 artifact kinds. Door plates show each project's next action on the Floor and in the Directory. | BB, OC | M |
| **Closing a project.** The retrospective is distilled into the Handbook, and runs and replays are archived. **Client portals** are front doors scoped to one project. | BB, PG | 1 |

### P7 and P8: Providers and multimodal

Specified in §8 and §7.

**Rules:**
- *No provider or modality ships without per-model rates and a passing canary.*
- Model names appear only in the desk inspector [OC].

**Language scope:**
- **MVP:** voice and exact lip sync are **English-first**. Text works in any language the model supports.
- **v1:** voice adds Spanish, French, German and Portuguese, with language-tagged STT and TTS and viseme tables built from TTS alignment.
- **Other languages:** lip sync falls back to the spectrum and energy tiers. These are language-agnostic, so the result is honest but approximate.

### P9: Context & memory

| Capability and acceptance | Src | Ph |
|---|---|---|
| **ContextItem.** `{id, kind: file\|capture\|memory\|connector\|artifact\|kpi, scope: workspace\|client\|project\|room\|agent, provenance, visibility, asOf, tokens, costEstimate}`. Items are upserted, consumed, retired and archived. *Every turn shows the chips it used.* Where a card is dropped sets its scope, and the Chief of Staff routes each item to one step. | OC, NEW | M |
| **The Handbook.** Markdown projections of the D1 graph: `company.md`, `client-<id>.md`, `project-<id>.md` and `agent-<id>.md`. Entities are keyed by `name\|type` and merge on rename. Edits sync both ways. Deletes are tombstones with Undo. | BB, OC, NEW | M |
| **Recall.** BM25 (k1 1.2, b 0.75) and cosine similarity (floor 0.25), combined with reciprocal-rank fusion (k 60). At most 4 items and 1,200 characters, with a 3 s embedding timeout. A "memory used" chip is labelled by retriever. Runs on D1 and Vectorize. | OC | M |
| **Brief budgets.** Profile 6k, files 20k, facts 7k, summaries 3k, recent 6k. The project bundle holds at most 20 decisions and 25 artifacts. Everything is labelled *reference data, not instructions*. | PG, BB | M |
| **Isolation.** Memory is scoped per client and per project. Recall across clients needs the owner's permission. Each coworker has its own memory permissions. | NEW | M |
| **Connectors.** Graph sync with provenance and `asOf`, plus KPI items. The MVP reads HubSpot only. | NEW | M, 1 |
| **Search over artifacts, runs and replays.** "Find where we decided X" works within a project (M), and "Why did we…?" across the workspace (1). Vectors are tagged with their model and checked for dimension. A RunDO re-embeds them when the model changes. | BB, OC, NEW | M, 1 |
| **Reflection and distillation.** Reflection arrives as a weekly Inbox diff (1). Every session ends with distillation (M). | BB, PG | M, 1 |

### P10: Tools, connectors, MCP, apps

| Capability and acceptance | Src | Ph |
|---|---|---|
| **MCP.** OC client core: Streamable HTTP, legacy SSE, an SSRF check on every hop, and schema normalisation. BB version negotiation (`2025-11-25` → `2025-03-26`). New: OAuth 2.1 with PKCE and a server-side vault. Resources, prompts and stdio through the Companion come in v1. | OC, BB, NEW | M |
| **Connectors.** HubSpot in the MVP. v1 adds QuickBooks, Xero, Calendly, Notion, Asana, Canva, monday.com, Shopify, Meta Ads, and Google Workspace once Google verification is done. *Every connector starts read-only, and write scopes are requested as a raised hand at first need.* | BB, NEW | M, 1 |
| **Governed actions.** `email.send` through a transactional email provider on the workspace's verified domain (M). Calendar, CRM writes and publish (1). Pay (2). All run through effects. | NEW | M–2 |
| **Web search with citations.** Provider-native search, normalised. The citations count as evidence. | OC, BB | M |
| **Hygiene.** MCP, search and delegate outputs are taint-wrapped. The output envelope stays valid JSON above 200k characters. A tainted turn needs approval, even for tier-0 changes. | BB | M |
| **Self-extension.** The `system` tool has three tiers: 0, inert drafts, free; 1, anything that runs or reaches out, asks first; 2, principal, grants, secrets, money and identity, unreachable. Budgets are 3 changes per turn, 12 per hour and 40 per day. Secret-shaped input is refused. Every change is audited and can be undone. | BB | M |
| **Documents.** DOCX, XLSX and PPTX, rendered in a RunDO. Sanitised Markdown with `action:` buttons. | NEW, OC | M |
| **Apps.** An opaque-origin sandbox with `connect-src 'none'`, BB SDK permissions, PG sketch ‖ full builds, and `REPORTER` self-repair (at most 2 rounds). | BB, PG | 1 |
| **CLI coworkers.** Claude Code and Codex, through the Companion, with the MCP relay. *Work never moves silently from a local model to the cloud.* | BB | 1 |

### P11: Navigation & UX

| Capability and acceptance | Src | Ph |
|---|---|---|
| **Surfaces.** Talk (the Chief of Staff's thread, plus a Chief of Staff bubble on every screen), Floor, Room, Desk stage, Inbox, Projects, Activity rail, Replay, Handbook and Settings. Front doors come in v1. | all | M |
| **The Floor.** Desks grouped by project pod, plus an Everyday row, door plates, hand-off edges and lamps. *Every action is also reachable from the Directory.* Semantic zoom (Building → Floor → Room → Desk) comes in v1. | BB, NEW | M, 1 |
| **Simpler modes.** "Just tell me", still-portrait and Text Floor. | BB, NEW | M |
| **Keyboard.**<br>• **L** listen, **W** whisper, hold **Space** to take the floor, **H** Inbox.<br>• Arrow keys move between desks.<br>• A command palette. | NEW | M |
| **Walkie-talkie** as a mobile web app: hold to talk, audio-only patch-in and Media Session controls. Push and a background mic come in v1. | OC, NEW | M, 1 |
| **Accessibility.**<br>• 44 px targets.<br>• No horizontal scroll at 375 px.<br>• Text scales to 200%.<br>• Light and dark themes.<br>• Captions are always on in rooms.<br>• Colour is never the only signal. | OC, PG, NEW | M |
| **OC product rules.**<br>• No model chrome.<br>• Controls are hidden when unavailable, not disabled.<br>• Errors name the missing key.<br>• Failure is stated in a sentence.<br>*5 of 6 owners answer "what needs you?" within 10 s.* | OC, NEW | M |

### P12 and P13: Governance and business

See §9 and §10.

**First-hour onboarding:**
1. Sign in with Google and pick a pack.
2. Meet your Chief of Staff: choose its face, voice and name. Its first greeting is spoken and recorded.
3. Talk about the business, and add your website and some files. These become `company.md` cards for you to approve.
4. Delegate one of three suggested starter tasks.
5. Set guardrails: Brief time, interruption budget, monthly cap and recording consent.

Connectors come afterwards, read-only at first.

*Acceptance:*
- *No model is called on empty input.*
- *80% of new users accept a first deliverable within 60 min, before any OAuth.*

### P14: Infrastructure

| Capability and acceptance | Src | Ph |
|---|---|---|
| **Topology.** Workers, plus four Durable Object classes: `WorkspaceDO`, `ProjectDO` (including Everyday), `RoomDO` and `RunDO`. There is no AgentDO. Storage: D1 holds records, R2 holds artifacts and audio, DO SQLite holds hot state, Vectorize holds vectors, and Queues handle fan-out. Each client has one hibernating Workspace socket. | BB, PG, NEW | M |
| **Ledgers.** One per project and one per workspace. The workspace ledger records routes, asks outside projects, Briefs and the kill switch. Both roll up to D1. The frequency rule applies, and blobs are stored as R2 pointers. | BB, OC, NEW | M |
| **BB host rebuild** (large effort, high risk). One DO per project, with an alarm tick. `fetch` and storage are injected, not patched globally. Name keys become stable ids through `plan.js` and `transcriptToMessages`. The failing refine test is fixed. | BB | P0–M |
| **Voicing.** Idempotent `voice(lineId)`, cached in R2. The client runs the playback pipeline. *The RoomDO never streams TTS frames.* | PG | M |
| **UI stack** (T1). TypeScript, Vite/esbuild and a keyed-reconciliation framework for the shell. The avatar and audio engine is framework-free. | — | M |
| **Test and ship.**<br>• A Mock provider and a fake cloud.<br>• A Wrangler harness with provider and Stripe stubs, including adversarial tool calls.<br>• Architecture guards: no keys in web code, no voice cloning.<br>• Preflight and log hygiene.<br>• Fake-media Playwright tests.<br>• `verify:live` canaries.<br>• Chaos and load tests. | PG, BB, OC | M |
| **Observability.** Traces and cost per route, turn and tool. *Metering is reconciled against provider invoices.* | NEW | M |
| **Companion.** BB's bridge, paired through the Workspace, with its sandbox chain and per-plan pinning. | BB | 1 |

---

## 7. Multimodal matrix

**How every modality works.** Each one is a pipeline with a route (inline or a background job), a cost class, and an output. The output is either a context card or an artifact.

**Gemini.** Gemini model ids come from live discovery. No reference uses Gemini (confirmed by grep), so every Gemini entry below is **[NEW]**.

| Modality | In/Out | Providers and models (MVP → later) | Where it appears | Ph |
|---|---|---|---|---|
| **Text and reasoning** | in/out | **Anthropic** `claude-opus-5`, `claude-sonnet-5`<br>**OpenAI** `gpt-5.6-sol`, `gpt-5.6-luna`<br>**xAI** `grok-4.6`, `grok-4.20-non-reasoning`<br>Gemini, OpenAI-compatible, local, Mock | Every turn | M |
| **Web search with citations** | tool | Anthropic `web_search_20260209`; OpenAI `web_search`; xAI `web_search` and `x_search`; Gemini grounding. The OC normaliser makes their citations uniform. | Research steps. Citations count as evidence. | M |
| **Speech to text (batch)** | in | OpenAI `gpt-transcribe` with a rolling prompt; xAI `/stt`; browser fallback | Dictation into the composer (never auto-sent), voice notes, audio files | M |
| **Speech to text (streaming)** | in | xAI WebSocket `/stt` (`endpointing=450`, `smart_turn=0.7`) feeding `TurnAssembler`. OpenAI and Gemini Live in v1. | 1:1 desk voice, taking the floor, walkie-talkie, front doors | M |
| **Realtime voice front** | in/out | xAI `grok-voice-think-fast-2.0`, held server-side. Then, each after its canary passes: OpenAI `gpt-live-1` and `gpt-realtime-2`, and Gemini Live. | Talking to the Chief of Staff, Brief barge-in, escalations | M, 1 |
| **Text to speech** | out | xAI `/tts` (26 voices, expressive tags) plus WebSocket TTS with timestamps (revived); OpenAI `gpt-4o-mini-tts`; Gemini TTS (v1); browser fallback | Coworker voices, voiced lines, Brief, replay, handoff cards | M |
| **Lip sync and faces** | out | PG fusion driver and strip-warp renderer; MediaPipe landmarks | Every face | M |
| **Vision** | in | Anthropic, OpenAI, xAI and Gemini vision models behind OC's honest vision gate | Files, camera, screen, receipts | M |
| **Camera and screen** | in | Snapshots, frame differencing, `SingleFlight`, a truthful privacy dot | Show and Share. Meetings in v1 (frames go to the addressed coworker only). | M, 1 |
| **Image generation and editing** | out | OpenAI `gpt-image-2`; xAI `grok-imagine-image-2.0` with identity-preserving edits; Gemini (v1) | Portraits, designs, mock-ups | M |
| **Video generation** | out | xAI `grok-imagine-video-1.5` as a RunDO job; Gemini (v1) | Launch cuts and social clips | M (flagged) |
| **Video understanding** | in | Up to 12 key frames taken on the client, sent as a vision turn. Gemini native video input in v1. | Uploaded clips, recorded calls | M |
| **Embeddings** | internal | OpenAI `text-embedding-3-small`; Workers AI `bge-base-en-v1.5` (no key needed); Gemini; Ollama `nomic-embed-text`; Mock | Recall chips, "find where we decided", "Why did we…?" | M |
| **Documents in** | in | DOCX, XLSX, PDF, CSV/TSV and JSON read on the client (OC) or on the server with `unpdf` and `mammoth` (PG). OCR of scans and PPTX in v1. | Drop anywhere; onboarding | M |
| **Documents out** | out | DOCX, XLSX and PPTX rendered in a RunDO; Markdown; sandboxed apps (v1) | Deliverables | M |
| **Folder context** | in | File System Access with ignore rules and diff re-sync; Companion watchers | Project inputs | 1 |
| **Replay export** | out | Transcript plus stitched WAV. MP4 of the faces in v2. | Shared replays | M, 2 |

---

## 8. Provider fabric

### 8.1 Providers

| Provider | Adapter / dialect | Capabilities | Ph | From |
|---|---|---|---|---|
| **Anthropic** | Messages API (`tool_use`), adaptive thinking, server tools | Chat, reasoning, vision, tools, search | M | BB, OC |
| **OpenAI** | Responses API (`function_call`) with completion enforcement; audio, image and embeddings endpoints; Realtime and Live (v1) | Everything | M | BB, OC, PG |
| **xAI** | Responses API for chat. WebSocket realtime, STT and TTS. Images with edits. Video. | All except embeddings | M | BB, OC, PG |
| **Google Gemini** | A new native dialect, the fourth. It may start on Gemini's OpenAI-compatible surface only after a canary proves tool-calling parity. | Chat, vision including video, embeddings, image, TTS, Live, video | M: chat, vision, embeddings<br>v1: the rest | NEW |
| **OpenAI-compatible cloud** | `tool_calls` by base URL and key. Covers Mistral, DeepSeek, Groq, OpenRouter, Together, Fireworks and others, with capability detection per model. | Chat and tools; vision and embeddings where offered | M | BB + NEW |
| **Azure OpenAI** | Responses or compatible API, with deployment mapping | As OpenAI | 1 | NEW |
| **AWS Bedrock** · **Google Vertex** | Converse API · Vertex endpoints | Chat, embeddings, partner models | 2 | NEW |
| **Cloudflare Workers AI** | `env.AI.run` | Keyless embeddings. Speech and image models are being evaluated as fallbacks. | M | BB |
| **Local**: Ollama, LM Studio, llama.cpp, vLLM | NDJSON or `/v1` compatible, with a dynamic catalog and capability detection | Chat, tools, vision, embeddings | M: reachable by URL<br>v1: localhost via the Companion | BB, OC |
| **Claude Code** · **Codex** CLIs | Companion adapters: stream-JSON, session resume, `StructuredOutput`, MCP relay | Coding coworkers | 1 | BB |
| **Mock** | Keyless, schema-aware and deterministic | Everything | M | BB |

### 8.2 The registry

One `models` package combines two sources (T4): the **OC registry shape** and the **BB adapters**.

**What the registry holds:**
- **Capability flags** per model (chat, streaming, vision, tools, search, embeddings, transcription, speech, image, video, realtime), plus the context window, reasoning controls and a latency class (`realtime`, `fast` or `reason`).
- **Preference orders** per capability, enforced by `requireProvider` and `assertProviderSupports`. Errors name the missing key.
- **One file of model ids.** Live discovery flags drift. Conflicts are settled with one spelling per id, `*_BASE_URL` overrides, and xAI chat on `/responses`.
- **Rates.** `{input, output, cached}` per token, plus audio, image, video and realtime units. They are compared weekly with provider pricing. *A model without rates cannot be selected under a dollar budget.*

**One agent loop.** It speaks four tool-calling dialects: Anthropic `tool_use`, Responses `function_call`, compatible `tool_calls`, and Gemini. It keeps these BB behaviours:
- parallel tool calls;
- no third identical failure;
- reservation hooks before and after each model call;
- partial output on error.

### 8.3 Per-persona model policy

```json
"modelPolicy": {
  "reason": { "prefer": ["anthropic/claude-opus-5"], "fallback": ["openai/gpt-5.6-sol", "gemini/*"] },
  "fast":   { "prefer": ["openai/gpt-5.6-luna", "xai/grok-4.20-non-reasoning"] },
  "voice":  { "provider": "xai", "voice": "ara", "fallbacks": [{ "provider": "openai", "voice": "marin" }] },
  "excludeFamilies": [], "localOnly": false,
  "budget": { "perTurnUsd": 0.25, "dailyUsd": 6 } }
```

**How a model is selected.** The registry checks, in order:
1. capability;
2. the policy's preference order;
3. that a key is present;
4. that work never moves from local to cloud [BB];
5. budget headroom;
6. latency class;
7. price.

The choice and its reason are logged as `route.model {chosen, reason, skipped[]}`.

**Which tier does what:**
- **Planners** get the strongest reasoner.
- **Room routing, paced turns and 1:1 voice** use the **fast** tier.
- **The sceptic** lists the lead's model family in `excludeFamilies`.

### 8.4 Voices, keys, cost, canaries

**Voices**
- Catalogs load live from each provider and are validated [PG] and drift-tested [OC].
- Each coworker's voice is unique in the workspace.
- Each voice has a descriptor and one mapped fallback per provider, auditioned at hire, so a coworker still sounds like itself after a provider switch [NEW].
- **No voice cloning.**

**Bring your own key (BYOK)**
- Keys live in the Workspace vault, write-only, and never reach the browser.
- With BYOK, model and voice spend goes to the owner's provider bill. Usage then covers only hosted presence and storage.
- Budgets are reserved in the ledger and carried on the `AbortSignal`.

**Canaries**
- `verify:live` runs on every deploy, for every provider and modality: chat, tools, schema, vision, search, image, a TTS → STT round trip, TTS timing, embeddings and realtime.
- A failing canary demotes that provider, and the next Brief says so in one line.

---

## 9. Trust, safety & governance

### 9.1 One gate, five layers

```
offer        persona + role scoped; re-checked at dispatch                     [PG]
 → grant     Once · This task · This project · 24 hours · Standing (bounded)    [BB]
  → policy   endpoint policy table + rate class; protected by default          [OC]
   → effect  effect(key, intent) → receipt(key, result); reconcile on crash     [BB, wired NEW]
    → audit  model calls, tool calls, egress, which frame went to which provider [NEW]
```

### 9.2 The autonomy dial

The dial is set per **action class**. It has four positions, and each position compiles to BB grant kinds and scopes:
- **Ask:** ask before working.
- **Propose:** do the work and hold the effect for approval.
- **Act & report:** the effect happens and shows up in the Brief, with undo where possible.
- **Act quietly:** the effect happens and is only logged.

| Action class | Default | Ceiling after promotion | Never |
|---|---|---|---|
| Research, analysis, internal drafts | Act & report | Act quietly | — |
| Internal writes (CRM notes, tasks, docs) | Propose | Act & report | — |
| External send (email, DM, reply) | Ask | Act & report within a **bounded** standing grant | Act quietly; unbounded standing |
| Publish (social, site) | Propose | Act & report within a bounded standing grant | Act quietly |
| Spend (orders, refunds, ads). *Available from v2 only.* | Ask | Propose up to a per-transaction cap; a bounded standing grant in v2 | Act quietly; approval by voice alone |
| Identity and access | **Always Ask** | — | Any delegation |
| Self-modification (coworkers, instructions, automations) | Tier-0 drafts need no approval; tier 1 is Ask | — | Standing or task grants (BB `NO_STANDING`) |

### 9.3 Grants and voice approvals

**Grant kinds:**
- **Once**
- **This task**
- **This project**
- **24 hours**
- **Standing (bounded)**

**Bounded standing grants.** A standing grant must name all six bounds:
- the tool;
- the recipient class;
- an amount cap;
- the asset library;
- a count per period;
- a window of 30 days or less, renewable in the Weekly Review.

**Grant fixes.** Grant buttons show only the kinds the capability allows, and provider-side MCP never runs with `require_approval:'never'`. Both fix BB defects.

**Voice approvals.** Voice alone grants only **Once** or **This task**, and only when all three hold:
- the item is under the workspace **voice cap**, which defaults to $250, 25 recipients and no pricing terms;
- a spoken read-back has confirmed it;
- it involves no standing grant, no money and no identity change.

Anything else needs an on-screen tap, and in walkie-talkie mode it waits in the Inbox.

### 9.4 Track record, promotion and demotion

- **Counters.** For each coworker and action class, over rolling 30- and 90-day windows, the system counts actions proposed, approved as-is, edited (with edit distance), declined, reversed and complained about.
- **Promotion.** When a class reaches the pack's threshold, the Chief of Staff files a **promotion proposal**. The default threshold is at least 20 proposals, at least 90% approved as-is, and no reversals in 30 days. The proposal is itself a decision: it names its bounds and must be confirmed with a tap.
- **Demotion.** Any reversal or complaint **drops the class one step automatically**, and the next Brief explains why.
- **Résumé.** The desk card shows the record, for example "22 of 24 posts as-is".

### 9.5 Money you can predict

- **Before work: rates and forecasts.** Every model has rates. Forecasts are shown as ranges, published once spike data exists. The accuracy target is ±35% in the MVP and ±25% in v1.
- **At approval: reservations.** Approving a plan reserves the upper bound. Spend is also reserved per run, step, day and workspace.
- **At the cap: stop or ask.** Each project chooses whether hitting its cap **stops** work or **raises a hand**.
- **On overrun: a concrete ask.** For example: *"Northwind is at $22 of $22; one more revision needs about $4. Raise by $6?"*
- **Always in dollars.** Unknown cost is never shown as zero.
- **Voice is metered.** A Chief of Staff voice minute is priced as a realtime session plus the brain's tokens.

### 9.6 Effects, receipts, evidence and honesty

**Effects**
- Every real-world action writes `effect(key, intent)` before it runs and `receipt(key, result)` after.
- A pending effect is **reconciled against the provider's record, never blindly replayed**.

**Receipts** record the action, target, payload hash, approver or grant, time, provider response and undo path. If there is no undo, the receipt says so, for example "No undo: email cannot be recalled".

**Workspace changes** go through BB's `system` tool, with audit and Undo.

**No claim without proof**
- An output filter blocks "sent", "booked", "paid" or "published" unless the text cites a receipt id [PG → NEW].
- The evidence contract applies (P4).
- Unsourced numbers get an **"unverified"** badge.
- Business facts carry `asOf`.
- The sceptic uses a different model family from the lead.
- `repairPlan` reopens false completions.
- Briefs and demos state only what a receipt, citation or metric supports. For example, they never say "the client opened it twice".

### 9.7 Interruptions

- **Budget.** A proactivity dial allows 0, 6 or 30 unprompted pings per day, each filtered by an LLM judge [BB].
- **Urgency ladder:** digest → Inbox → push → live. Every step up needs the judge's "matters now" and room in the budget.
- **Quiet hours.** Only an owner-defined *always wake me* class can break them, for example statutory deadlines.
- **Handoff card.** Whenever the owner is pulled into a live room, a 15-second spoken card covers who, what, why now, the recommendation and the options.

### 9.8 Consent, disclosure and likeness

**Recording.** Each member consents before their voice is stored, and an indicator shows while recording. Without consent, their lines are stored as text and shown as captions.

**Capture.** Consent is given per coworker. A truthful privacy dot shows during capture, and the destination of every frame is audited.

**Guests.** Consent is versioned. Transcripts are kept only with consent, for 90 days by default.

**Disclosure.**
- A permanent **"AI coworker"** badge appears on every surface a non-owner sees, on every tier.
- Coworkers disclose that they are AI when asked or when someone seems confused [PG].
- Coworker email carries a disclosure line by default.

**Likeness.**
- Coworkers use generated faces only.
- **Owner likeness (v1).** The owner may give the Chief of Staff or a front door their own face. This requires PG's likeness consent, keeps the badge, and uses a catalog voice.
- Anyone else's likeness requires that person's own signed-in consent (v2).
- **No voice cloning, ever.**

**Whispers.** Only the owner sees them, and they are locked in replay. Each carries a `quietly` or `attribute` policy. Staff and guests never see them.

### 9.9 Isolation, identity, secrets and retention

**Isolation**
- Client and project scopes are the default. Recall across clients needs permission, and memory permissions are set per coworker.
- MCP, search and delegate outputs are taint-wrapped, and a tainted turn needs approval.
- Local-only mode runs through the Companion (v1).

**Identity and secrets**
- Sign-in uses Google OAuth with PKCE and hashed 30-day sessions. Roles are owner, staff (v1) and guest [PG].
- Secrets sit in a write-only vault in the WorkspaceDO. Input that looks like a secret is refused [BB].
- OC's policy table protects every endpoint by default.
- PG's rate limiter with refunds is extended to count dollars.
- Log-hygiene tests, a preflight check and architecture guards back all of this.

**Retention**
- Replays: by tier.
- Guest transcripts: 90 days.
- Raw capture frames: 24 hours, unless pinned. Their descriptions are kept.

### 9.10 Everyone stop, and audit

**Everyone stop.** A WorkspaceDO flag, checked at every job claim and heartbeat. When the owner sets it:
- every live job is fenced within 30 s;
- in-flight calls are aborted;
- every speaker's generation is bumped;
- pending effects are held.

Resuming requires an on-screen confirmation.

**The audit log.** One append-only log records:
- model calls, with cost;
- tool calls;
- egress, per frame and provider;
- decisions, grants, effects and receipts;
- workspace changes.

Business-tier owners can export it.

---

## 10. Packaging & business model

### 10.1 Principles

1. **Humans pay for seats. Coworkers are not seats.** Plans cap *active* coworkers, and retired coworkers are free.
2. **One usage balance, in dollars, covers every modality.** There are no credits.
3. **Voice costs money only when someone listens.**
4. **Every tier can finish the loop**, including approved, governed sends.
5. **Agencies can remove Headcount branding.** The AI-coworker badge cannot be removed.
6. **Billing follows calibrated metering.** Stripe self-serve opens only after metered cost has matched provider invoices within ±5% for four consecutive weeks.

### 10.2 Tiers

Prices are illustrative and will be calibrated after the spikes. The tiers take effect at public launch (v1). Until then, the MVP runs on design-partner plans.

| | **Solo** | **Team** | **Business** |
|---|---|---|---|
| **Price** | $49/mo | $199/mo | $799/mo |
| **Human seats** | Owner | Owner + 2 (+$29 each) | Owner + 9, SSO |
| **Active coworkers** | 6 | 20 | 60 |
| **Active projects** | 3 | Unlimited | Unlimited |
| **Included usage** | $20 | $100 | $400 |
| **Governed actions** | Email send with approval (Once, This task) | + bounded standing grants; calendar, CRM, publish | + audit export, custom retention |
| **Front doors** | 1 | 10 | Unlimited |
| **Headcount branding** on client-facing surfaces | Shown | Removable | Removable, on your own domain |
| **Replay retention** | 30 days | 1 year | Custom |
| **BYOK · Companion** | BYOK only | Both | Both |

### 10.3 What usage buys

Usage is charged at the provider's list rate times a published margin.

| Item | Unit | Notes |
|---|---|---|
| Model tokens | Per call | Reserved before the call |
| Hiring a coworker | Once, about $0.08 | Covers the portrait, landmarks and voice audition |
| Voiced lines and listen-in | Per voiced second | Replaying a cached line is free |
| Chief of Staff voice | Per minute | Realtime session plus brain tokens |
| Images and video | Per image, per second of video | |
| Front-door guest minutes | Per minute | Capped per link and per day |
| Storage | Per GB-month above the tier's allowance | |

### 10.4 Industry packs

A pack is BB's template JSON with these additions: `face`, `voice`, `modelPolicy`, `frontDoors[]` and `golden[]`. Packs apply idempotently, and each is published through the golden-evaluation gate.

| Pack | Coworkers (*sceptic in italics*) | Connectors | Automations | Front door | Ph |
|---|---|---|---|---|---|
| **Agency** | Account strategist, performance analyst, copywriter, deck designer, *"the client's CFO"* | HubSpot (MVP); Canva, Notion, Asana (v1) | Brief, Weekly Review, client pulse | "Talk to your account team" | M |
| **Practice** | Intake, close coordinator, reviewer, client liaison, *"the auditor"* | QuickBooks, Xero, Calendly | Month-end checklist, deadline radar | "Book a discovery call" | 1 |
| **E-commerce** | Merchandiser, ads analyst, operations, content maker, *"the returning customer"* | Shopify, Meta Ads, HubSpot | Sales line in the Brief, low-stock watch | "Product concierge" | 1 |
| **Home services** | Lead concierge, scheduler, listing writer, *"the first-time buyer"* | Calendly, HubSpot | New-lead reply in under 5 minutes | "Book a visit" | 2 |
| **Software studio** | CLI builder, reviewer, tester, *"the on-call engineer"* | GitHub, DeepWiki | Nightly test run | "Ask about the release" | 2 |

### 10.5 Go-to-market

- **The wedge:** boutique agencies with 2–25 people.
- **The hero demo:** 90 seconds with no cuts, **ending on the delivered deck**.
- **A keyless demo office:** it runs on the Mock provider with a seeded showcase coworker [BB + PG], so visitors can walk the Floor before signing up.
- **Reach and partners:** shared replays and front doors spread the product, and consultancies build vertical packs.

---

## 11. Roadmap

### 11.1 Phase 0: spikes and pre-port fixes

Phase 0 runs for four weeks, with the spikes in parallel. **It gates the build:** until all five spikes pass, the MVP builds foundations only.

| Spike | Pass criteria |
|---|---|
| **S1. Durable ProjectDO** | A 6-step Mock plan survives eviction, laptop sleep and a deploy restart in the middle of a `forEach` send to a fake email sink. *Zero duplicate receipts. It resumes within 60 s. Everyone stop fences all jobs within 30 s.* |
| **S2. RoomDO fan-out** | 4 agents, the owner and 2 observers. *First voiced line at p50 ≤ 2.5 s. Barge-in within 300 ms. Nothing is voiced without an observer. Provider sockets close while the owner's mic is idle.* |
| **S3. Faces** | *1 hero face, 3 tiles and 12 tokens on one AudioContext: 60 fps on an M-class laptop, 30 fps on an iPhone 13.* |
| **S4. Voice front** | xAI realtime in front of a fast brain. *Acknowledgement at p50 ≤ 1.5 s. Answer at p50 ≤ 3 s. The cascade fallback's first audio at p50 ≤ 2.5 s.* |
| **S5. Lip-sync truth** | *Landmark write-back is validated. Timestamped TTS is revived. The first-delta and early-drain bugs are fixed. The alignment canary passes.* |

**Pre-port fixes (matrix §1.6):**

| Source | Defect | Fix in Headcount |
|---|---|---|
| **BB** | Barge-in was fake. | Real barge-in: stop playing audio sources and send `response.cancel`. |
| **BB** | Models had no price rates, so cost budgets broke. | Every model gets rates. |
| **BB** | One Durable Object ran the whole deployment, with no keep-alive. | One Durable Object per project, with an alarm keep-alive. |
| **BB** | The lead could not message running projects (`bizbot.js:29`). | Fixed. |
| **BB** | Records were keyed by name. | Stable ids. |
| **BB** | The failing refine test blocked `predeploy`. | Test fixed. |
| **OC** | Voice and chat ran as two separate brains. | One brain. |
| **OC** | The background override threw an error (`orchestrator.ts:496`). | Fixed. |
| **PG** | The timestamped TTS path was unreachable. | Revived. |
| **PG** | The first audio deltas were dropped, and lip sync drained early. | Both fixed. |
| **PG** | The brain was hard-wired to xAI. | Removed; the brain can run on any provider. |

### 11.2 MVP: "The first staffed project"

**Size.** About 16 weeks after Phase 0, or roughly 70 engineer-weeks with 5 engineers.

**Audience.** A design-partner beta with about 20 agencies.

**It proves:** one sentence becomes a visible, audible, staffed project. That project delivers a reviewed deliverable and one real send, exactly once, decided from the Brief or the Inbox.

**In:** everything tagged **M** in §6–§8. The headline items:
- the xAI voice front, with a cascade fallback;
- Staff it, with the Agency pack;
- evidence and forecasts;
- the autonomy dial (Ask, Propose, Act & report) and Everyone stop;
- one exactly-once `email.send`;
- the Floor and Directory, and 1:1 voice with any coworker;
- listen-in to one room at a time, take the floor, text whispers and replay;
- the Brief, the Inbox and the Weekly Review;
- the Handbook, with client isolation and read access to HubSpot;
- six providers plus Mock;
- flagged video;
- office documents;
- the walkie-talkie web app;
- metering. Stripe comes at MVP exit, once metering is calibrated.

**Out, deliberately:**
- front doors;
- money movement;
- standing grants and promotions;
- the Companion, CLI coworkers and local models on localhost;
- semantic zoom, Rewind, room tone and spatial audio;
- voice whispers and automatic minutes-to-tasks;
- Azure, Bedrock and Vertex;
- Gemini Live and OpenAI Live or Realtime;
- the marketplace;
- staff seats;
- a native mobile shell;
- non-English voice.

**Exit:**
- §5.1–5.5, the send mechanism in §5.7 and the Review in §5.9 all pass on real providers.
- Every MVP gate in §12 is met.

### 11.3 v1: "Open the doors" (about 5 months after the MVP)

- **Reach:** front doors with Inbox escalation, client portals, and an owner-likeness door. The Practice and E-commerce packs.
- **Action:**
  - Ten more connectors, headed by QuickBooks, Xero, Calendly and Google Workspace (P10).
  - Calendar, CRM and publish actions.
  - Bounded standing grants and promotions.
  - Business triggers.
  - `when` branches and playbooks.
- **Providers:** Gemini Live, OpenAI Live and Realtime, the remaining Gemini modalities, and Azure OpenAI.
- **The Companion:** local models, CLI coworkers and stdio MCP.
- **Mobile:** a native shell.
- **Presence:** semantic zoom, a picture-in-picture speaker, the mixer, voice whispers, automatic minutes-to-tasks and screen share in meetings.
- **Memory:** workspace-wide "Why did we…?", metric evidence and reflection.
- **People:** staff seats and roles, the hire interview and four more languages.

### 11.4 v2: "Scale the office"

- **Work and staffing:**
  - Money movement under bounded grants.
  - Human staff as plan assignees.
  - Run-to-run comparison.
  - Cross-project dependencies.
- **Providers:** Bedrock and Vertex.
- **Faces and replay:**
  - A v2 renderer with gaze and expressions.
  - Room-tone earcons and Rewind.
  - MP4 export.
- **Ecosystem:**
  - The Home services and Software studio packs.
  - A pack marketplace.
  - A white-label API with webhooks.
- **Likeness:** staff likeness, with each person's own consent.

### 11.5 Never

- Voice cloning.
- Unbounded standing grants for send, publish or pay.
- Voicing a room with no listener.
- Agents running in the browser tab.
- Local work moving silently to paid cloud.
- Engagement minutes as success targets.
- Claims about recipient behaviour that no receipt can back.

---

## 12. Success metrics

**North star:** accepted deliverables per active workspace per week, together with decisions resolved.

**Counter-metric:** owner minutes per accepted deliverable. Lower is better.

### Outcomes and trust

| Metric | MVP gate | v1 target |
|---|---|---|
| Sign-ups accepting a first deliverable within 60 min | 80% | 85% |
| Approved plans reaching an accepted deliverable with at most 1 revision | 50% | 65% |
| Decisions resolved from the Brief or the Inbox, rather than live | 60% | 70% |
| Brief listen-through in week 4 | 70% | 75% |
| Design partners retained at week 8 | 80% | — |
| **Must stay at zero:**<br>• duplicate effects<br>• effects without a grant<br>• action claims without a receipt<br>• presence frames without a cause<br>• silently zero costs | 0 | 0 |
| Forecast accuracy | ±35% on 20 golden projects | ±25% on 80% of projects |
| Metering compared with provider invoices | ±5% | ±3% |

### Speed and clarity

| Metric | MVP gate | v1 target |
|---|---|---|
| Chief of Staff acknowledgement, p50 | ≤ 1.5 s | ≤ 1.2 s |
| Chief of Staff answer, p50 | ≤ 3 s | ≤ 2.5 s |
| 1:1 coworker first audio, p50 | ≤ 2.5 s | ≤ 2 s |
| First voiced line when listening in, p50 | ≤ 2.5 s | ≤ 2 s |
| Barge-in | ≤ 300 ms | ≤ 250 ms |
| Staffed pod visible, p50 / p95 | < 45 s / < 90 s | same |
| "What needs you?" answered within 10 s | 5 of 6 owners | 9 of 10 owners |

**Diagnostics, never targets:** rooms listened to, times the owner took the floor, whispers sent, time spent on the Floor, and replays shared. Time the owner spends is a cost unless it replaces reading.

---

## 13. Risks, mitigations & open questions

| Risk | Why it is real | Mitigation |
|---|---|---|
| **Durable execution and exactly-once effects** | BB's host had no keep-alive and its effects were unwired. Rebuilding it is a large, high-risk port. | The S1 chaos spike gates the build. BB's ledger tests are ported. Effects are reconciled, and each project has a single writer. |
| **Unproven realtime voice** | OC's transports never ran live, and PG's OpenAI Live path is only partly built. | Start on PG's tested xAI path, keep the cascade fallback, and put a canary in front of every new transport. |
| **Many faces on phones** | PG's stack was sized for 1–6 faces. | Level-of-detail tiers, a shared scheduler, and spike S3. |
| **Voice and token cost** | Voicing, realtime minutes and growing room context all add up. | Voice only on demand, daily caps on voiced seconds, a 6k-token context bound with a rolling summary, the fast tier for paced turns, and reservations. |
| **"It's a gimmick", or over-trust in a confident face** | People read authority into faces. | Outcome metrics; faces used as status UI; "nothing faked"; a sceptic from another model family; the "unverified" badge; still-portrait mode. |
| **Prompt injection reaching real actions** | Connectors and captures feed agents that can send. | Taint wrapping, approval required for tainted turns, no unbounded sends, receipts, and an egress audit. |
| **Leaks between clients** | Agencies and practices serve many clients. | Client scopes by default, memory permissions per coworker, and a local-only mode. |
| **Noise and sprawl** | Many agents each think they matter, and "hire in a sentence" invites more of them. | The interruption budget, the judge and at most three touchpoints. Coworkers are reused first and capped per tier. |
| **A spatial UI slower than a list** | Metaphor interfaces often lose to lists. | Directory parity, "Just tell me" mode and the 10-second test. |
| **Connectors, mobile and drift** | Gmail needs Google verification. iOS limits background audio. Model catalogs are maintained by hand. | Start with HubSpot and a transactional email provider. Ship a native shell in v1. Use discovery, weekly rate diffs and canaries. |
| **Law on disclosure, recording and likeness** | The rules vary by jurisdiction. | The badge is always shown. Consent is required throughout. Legal review happens before front doors ship. |
| **An overloaded WorkspaceDO** | Presence fan-out shares an object with the vault and billing. | Relay presence through Queues, and split it into its own object if socket p95 exceeds 200 ms. |
| **The name** | "Headcount" is a common HR term. | Run a trademark and search check before launch, with a fallback shortlist. |

**Open questions**

1. **Name.** Can we clear the trademark and domain for *Headcount*, and what is the fallback shortlist?
2. **Email disclosure.** Should coworker email carry a mandatory disclosure footer, or wording the owner controls? This needs review by jurisdiction.
3. **Voice cap.** Should voice approvals be limited by a fixed dollar-and-recipient cap, or by a risk score from the judge?
4. **Time-back baselines.** Before the owner calibrates, should estimates come from pack defaults or a short onboarding survey?
5. **Gemini.** Does its OpenAI-compatible surface match the native dialect on tool calling?
6. **Owner-likeness door.** Is it worth the legal risk in v1, or should it wait for v2?
7. **Human staff on the Floor (v2).** How should human assignees appear?
8. **Capture retention.** Is 24 hours right for raw capture frames in regulated packs?

---

## Appendix A: Blend map

The top reference features and where each lands in Headcount.

- **Maturity:** s = solid, p = partial.
- **Phase:** P0 = pre-port fix (§11.1), M = MVP, 1 = v1.

| # | Reference feature | Src | Lands as | Ph |
|---|---|---|---|---|
| 1 | Virtual lead with a routing brief (`routerBot`, `routingBrief`) | BB s | The Chief of Staff's per-turn build, now including project members | M |
| 2 | Simple-mode one-question delegation; `materializeProject` | BB s | Delegate in one sentence → Staff it | M |
| 3 | Team assembly with a sceptic and a spread of providers | BB s | Staff it, reusing existing coworkers first; the sceptic uses a different model family | M |
| 4 | `executePlan`: clusters, review/revise, finisher and QA | BB s | The ProjectDO plan engine with JSON verdicts | M |
| 5 | Completion enforcement and `repairPlan` | BB s | Evidence-backed completion | M |
| 6 | Ledger: leases, fences, outbox, reservations, `effect`/`receipt` | BB p | The ProjectDO ledger, with effects wired and reconciled | M |
| 7 | `InputRequired` Inbox decision | BB s | Raised hands and the Inbox | M |
| 8 | `approveAction` graded grants | BB s | The grant ladder and the autonomy dial | M |
| 9 | Bounded self-extension through the `system` tool | BB s | The Chief of Staff's admin powers, with Undo | M |
| 10 | Proactivity dial, annoyance budget and judge | BB s | The interruption budget and urgency ladder | M |
| 11 | `ask_bot`, `message_bot`, @mentions | BB s | `ask`, `message` and `mention` by exact handle | M |
| 12 | The `/discuss` meeting protocol | BB s | Meetings and the Weekly Review | M |
| 13 | `transcriptToMessages` perspective projection | BB s | Each agent's bounded view of a room; whispers | M |
| 14 | Activity bus, team graph and replay scrubber | BB s | The FloorProjector, the Floor and replay | M |
| 15 | Verb-first `goalBoard` | BB s | Door plates, Brief ranking and Inbox copy | M |
| 16 | Markdown memory; reflection offered as a proposal | BB s | Handbook projections; reflection diffs | M, 1 |
| 17 | Triggers (schedule, page watch, reflect) | BB s/p | The Brief and Review in the owner's timezone | M |
| 18 | Provider adapters and a unified event protocol | BB s | The `models` package | M |
| 19 | Mock provider | BB s | A keyless demo office, dry runs and end-to-end tests | M |
| 20 | CLI coworkers with MCP relay | BB s | Engineer coworkers through the Companion | 1 |
| 21 | `catalog-store` golden-evaluation publishing | BB p | Playbooks and `AGENT.md`, now with a UI | 1 |
| 22 | Templates | BB s | Packs with faces, voices and a sceptic | M |
| 23 | `verify:live` canaries | BB s | A canary per provider and modality, including TTS timing | M |
| 24 | Server-owned brain with no model chrome; "I started it" semantics; SSE frames | OC s | One brain; model names only in the inspector; the turn protocol | M |
| 25 | Routing and summary tables | OC s | The route table with executors, checked in CI (fixes `:496`) | M |
| 26 | Task store, Pending tray and deliver-to-origin | OC s | The Activity rail | M |
| 27 | Registry and three-dialect agent loop | OC s | The provider registry with rates; a four-dialect loop | M |
| 28 | `ContextCard` / `ContextBus` | OC s | Context cards with scope and `asOf` | M |
| 29 | Graph memory with BM25, vector and RRF recall | OC s | The Handbook graph in D1 and Vectorize | M |
| 30 | Camera, screen, file and folder capture | OC s | Show and Share, drop anywhere, frame differencing | M, 1 |
| 31 | MCP client with a per-hop SSRF check; policy table; preflight | OC s | The MCP layer (adding OAuth 2.1); perimeter and CI | M |
| 32 | Video job; web-search normaliser | OC s | Video generation as a RunDO; search results as citations | M |
| 33 | `update_persona` | OC p | Appearance and voice edits as tier-0 drafts | 1 |
| 34 | Landmarks, fusion driver and strip-warp; OC `captureTap` | PG, OC s | Faces at every level of detail, fed by the mixer | M |
| 35 | `ConversationDO`: generations, role-scoped tools, consent | PG s | The RoomDO and the gate's offer layer | M |
| 36 | Voice front, brain back; `TurnAssembler`, `SentenceChunker` | PG p/s | The voice seam: xAI first, Live in v1 | M |
| 37 | `inventCast`, `assignVoice` and portrait prefixes | PG s | Casting inside Staff it | M |
| 38 | Instructions as lines, `distill`, "Learned" chips; budgeted brief | PG s | The coworker entity; training by talking; context budgets | M |
| 39 | Group engine with exact replay | PG s | Voice on demand, replay and the Brief | M |
| 40 | `BuilderDO` with sketch ‖ full; canvas `REPORTER` self-repair | PG s | RunDO with a fast first version; project apps | M, 1 |
| 41 | Personagram links (hashed tokens, consent, QR codes) | PG s | Front doors and portals | 1 |
| 42 | Interviewer; draft → approve; likeness consent | PG s | Onboarding cards; the owner-likeness door | M, 1 |
| 43 | OAuth PKCE, rate limits with refunds, Stripe; Wrangler harness and guards | PG s | Identity, metering, billing; CI | M |
| 44 | No-action-claims rule; `handoff` field | PG s/p | A receipt check; real front-door escalation | M, 1 |
| 45 | Timestamped TTS (currently unreachable) | PG p | Exact alignment for voiced lines | P0 |

---

## Appendix B: Judge must-fix resolution index

Each item is tagged with the judge who raised it: **O** (owner value), **F** (feasibility) or **C** (brief coverage).

| Resolved in | Must-fixes |
|---|---|
| **§3.2–3.3, §12** | Lead with outcomes, using a north-star metric and a counter-metric (O). At most three touchpoints, and a Brief of five minutes or less (O). A written single-agent contract (C). Restore OC's product rules (C). |
| **§4** | About eight owner nouns and no jargon (O). |
| **§5.1, P1–P2** | Staff before hiring, with a tier cap (O). Every spawned coworker gets a voice, a portrait, a placeholder and a badge (C). Latency targets split into acknowledgement vs answer (F). |
| **§5.2–5.4, P5** | Listen-in within about 2.5 s, catch-up within 20 s, skip to live (O). Barge-in within 300 ms: hold-to-talk vs raise hand (O, F). Strict voice on demand, with no murmur (F). A single writer for effects (F). Bounded room context, using the fast tier (F). A 1:1 voice path to any coworker (C). |
| **P3** | Avatars stay optional and honest (O, F). No gaze or gestures (F, C). Place the landmark job (F). Revive PG's lip-sync paths (F). |
| **§5.6, §7, P10** | Frames go to the addressed agent only (F). Web search (C). An early video path (C). MVP connectors from BB's catalog, plus transactional email (F). |
| **P9, §5.9** | Isolate clients (O). Mechanise business context (C). Make embeddings visible to the owner (C). |
| **§8** | Define "all providers", including OpenAI-compatible clouds (C). Voice starts on the xAI path, not OpenAI Live (F). Rates before any budget UI (O, F). Declare the language scope (C, in P7/P8). |
| **§9** | Safe voice approvals (O, F). Bounded promotions with automatic demotion (O). No claim without a receipt (O). Recording and whisper consent (O). Credible dollars-first forecasts (O, F). A likeness decision (C). |
| **§10** | Every tier finishes the loop; branding is removable (O). Stripe only after metering is calibrated (F). Voice minutes priced as realtime plus brain (F). |
| **§11** | A narrow MVP (O, F). Spikes gate the build, with corrected targets (F, C). Rebuild the BB host (F). Carry the inherited defect fixes (C). Exactly-once effects in the MVP (C). Value before OAuth (O, in P13). Mobile audio (F, also §13). |
| **P14, §4.3** | A workspace ledger (F). Voice by line id, with idle sockets closed (F). |
