# Ninth Floor

**Walk into your company. It's already working.**

> Concept B. Angle: experience first, "a living office you can walk into".
> Provenance tags: **[BB]** biz-bot, **[OC]** oncloudnine, **[PG]** personagram-ai, **[NEW]** white space that no reference covers.
> Evidence base: `docs/research/capability-matrix.md` and the nine slice reports. Tension numbers (T1–T18) refer to §5 of the matrix.

---

## 1. The pitch

Ninth Floor is an agent workplace laid out as an office. The owner talks to one **Chief of Staff**, who hires, seats and directs a staff of AI coworkers. Each coworker has a face, a voice, a desk and a job.

Everything the engine does has a place and a visible form. A delegation is a **pass** that flies between desks, a plan is a **wall** in a project room, a pending decision is a **raised hand**, and a meeting is a **room with a door** you can open. You can take in the whole company at a glance, hear any part of it on demand, and step in anywhere to listen, whisper or take the floor.

The name nods to Cloud Nine and to its lineage: oncloudnine's senses, biz-bot's brain and personagram's faces, one floor up.

---

## 2. The big idea

Chat logs hide AI work until it is finished. Dashboards show it only as abstractions. Ninth Floor makes the work **legible by giving it a body**. Three principles hold the design together.

**1. Everything that happens has a place, and nothing is faked.**
- The Floor is a *projection of the event bus*, not a decoration. A pure reducer, the **FloorProjector**, folds BB activity events (`turn, route, ask, handoff, tool, decision, idle`), OC task frames and PG session events (`speaking`, `interrupted`, `thinking`) into per-agent **presence frames**.
- If the engine is quiet, the office is quiet: no fake typing, no idle animation pretending to be work. This is BB's "the transcript is the source of truth", carried into space.

**2. Silent by default, audible on demand.**
- Agents talk to each other in text at machine speed [BB].
- When you listen at a door, that room's **RoomDO** voices the live tail of the conversation in each speaker's own voice, and your Chief of Staff speaks a short catch-up first. The pipeline comes from [PG]; voicing on demand is [NEW] (T8).
- *Meetings slow down to human pace for you. Work never does.*

**3. One front door, and every other door open.**
- You direct the company through one lead [BB].
- You can still walk up to anyone. Anything you say at a desk is logged where the lead can see it.
- If what you said changes a project's scope, the coworker raises it with the lead, and you see the change as a **plan diff** before it takes effect. You get full access without two people steering the same project.

---

## 3. Target owner

**Primary: an owner-operator of a 2–25 person business** who already delegates to people and wants to delegate to agents the same way.

**Running example: Dana Okafor, Driftline Coffee Roasters.**
- Nine staff. Revenue comes from direct-to-consumer subscriptions and wholesale to cafés.
- The business runs on Shopify, QuickBooks, HubSpot and Google Workspace.
- Every morning Dana walks the roastery floor, and she can tell by sound when the roaster is off. She wants the same feel for her agent staff.

**Her jobs to be done:**
1. "Tell me what's happening in ten seconds."
2. "Let me hand this off and trust that it's moving."
3. "Let me check in without micromanaging."
4. "Only ask me to decide what only I can decide."

**Secondary users:** human staff with seats (after the MVP), and customers who come in through **Lobby doors** [PG]. **Not for:** developers who want an IDE, or enterprises that want business-process modelling.

---

## 4. Core concepts and vocabulary

| Term | Meaning | Builds on |
|---|---|---|
| **The Floor** | The spatial office: a top-down floorplan of rooms and desks with live avatar tiles. It is the home screen. | BB team graph → spatial [NEW] |
| **Chief of Staff** ("the lead") | The one agent you direct, derived from your profile and house rules and undeletable. Sits at the **Front Desk**; follows you as the **Shoulder** bubble. | BB `routerBot`/`routingBrief`, PG voice-front/brain-back, OC turn protocol |
| **Coworker** | A persona with a stable id, a role, skills, a tool grant, a model policy, a unique voice and a face rig. | PG doppelganger + `inventCast`, BB layering |
| **Desk** | A coworker's home tile: avatar, status line ("Pulling Q3 café invoices"), lamp, any raised hand. | OC `TOOL_SUMMARY_TABLE` copy, BB activity labels |
| **Project Room** | One per project, with a **Door Plate**, **Plan Wall** (the DAG), **Pinboard** (artifacts) and **Tape**. | BB project, plan and channel per team |
| **Pass** | A delegation or hand-off shown as a pulse between desks, dashed while in flight. | BB `ask_bot`/`message_bot`, graph pulses |
| **Raised Hand** | An open Inbox decision, shown on the avatar and queued in the **Hands** tray. | BB `InputRequired`, decisions and grants |
| **Meeting** | A structured session in a room, with floor control, captions and a tape. | BB `/discuss` + PG group stage |
| **Listen-in** | Opening audio on a room or desk. Text-native chatter is voiced on demand. | PG writer ‖ voicer ‖ player; T8 [NEW] |
| **Whisper** | A private note from the owner to one agent during a meeting. | [NEW] |
| **Take the Floor** | Speaking in a meeting. The floor arbiter yields to the owner first. | PG `next:"user"`; arbiter [NEW] |
| **Tape** | A room's replayable record: lines, passes, tool steps, decisions and stored audio. | PG exact replay, BB replay scrubber |
| **Rewind** | A floor-wide time-lapse of a period, built from the durable event bus. | BB `?since` + `replaySteps` [NEW at floor scale] |
| **Night Shift** | Background runs that keep going after you leave. Their desk lamps stay lit. | PG alarm DO pattern, BB ledger |
| **Walkie-talkie** | Mobile mode: hold to talk to the lead, and patch into rooms as audio. | PG/OC voice [NEW mode] |
| **Knock Budget** | The daily limit on unprompted interruptions. | BB annoyance budget (0/6/30) + LLM judge |
| **Lobby Door** | A purpose-scoped link that lets a customer talk to one coworker in guest mode. | PG Personagrams, hashed links |

---

## 5. The Floor: places, zoom, faces and sound

### 5.1 Places

| Place | What lives there | Builds on |
|---|---|---|
| **Front Desk** | The Chief of Staff. You arrive here, and the daily brief is spoken here. | BB Bizbot, PG private-avatar stage |
| **Project Rooms** | One per active project, with team desks inside; created when a project is materialised, moved to **Records** when it closes. | BB `materializeProject`, `archiveFinal` |
| **Bench** | Standalone specialists who are not on a project. The lead can pull them in for a single `ask`. | BB non-project agents; fixes `bizbot.js:29` [NEW] |
| **Mailroom** | Automations and triggers (schedules, watched pages, inbound email, webhooks, CRM stage changes); each slot lights up when it fires. | BB triggers; business triggers [NEW] |
| **Library** | Company memory. It holds the **Handbook** (`company.md`), per-project and per-agent memory files and the knowledge graph. | OC graph + recall, BB Markdown memory |
| **Workshop** | Coworkers running through the paired Desktop Companion: Claude Code and Codex CLIs, local Ollama models, shell and browser. | BB bridge, CLI adapters, relay |
| **Lobby** | Guest doors to coworkers, with an inbox for consented transcripts. | PG Personagrams |
| **Records** | Archived rooms with their tapes, deliverables and retrospectives. | BB run archive, PG replay links |

**Layout is automatic.** The Front Desk sits at the top centre and project rooms fill the perimeter by recent activity, so a company of 3 or of 30 lays itself out. Owners can drag rooms; positions persist in `WorkspaceDO`.

### 5.2 Semantic zoom

| Level | You see | Typical action |
|---|---|---|
| **Building** | Rooms as tiles with an activity heat, a Door Plate (verb-first next action [BB `goalBoard`]), raised-hand count and spend today | "Where is attention needed?" |
| **Floor** | Desks with avatar tiles, passes in flight and lamps | "Who is doing what?" |
| **Room** | The meeting stage (PG group stage), the Plan Wall, the Pinboard and captions | Listen, whisper, take the floor |
| **Desk** | One coworker at hero size, their thread, the context chips they hold, and the current step | Talk one-to-one, give files, answer a hand |

Clicking or tapping a desk **walks you up to it**. The camera eases in, the tile becomes the hero renderer, and the side panel opens that agent's thread (the BB per-conversation view, which stays mounted). The agent looks up: its presence becomes `attending`, and it goes on working.

### 5.3 How many faces move at once

Level of detail keeps a 30-desk floor cheap (T10) [NEW on top of PG]:

| Tier | Renderer | When | Cost |
|---|---|---|---|
| **Hero** | PG `FaceLipSync` strip-warp at `maxSide` 1024 | The desk you are at, or the current speaker in a room you are in | Full |
| **Tile** | The same renderer at `maxSide` 256 on a **shared rAF scheduler** | Speaking or attending agents on screen, at most 3 at once | About 1/16 of the pixels |
| **Token** | Static portrait with a coloured state ring and a glyph. OC-style procedural bust as an option. | Everyone else, all off-screen desks (paused by `IntersectionObserver`) | Close to zero |

One app-wide `AudioContext` feeds a mixer bus with a per-agent `AnalyserNode` tap, so each face lip-syncs from its own stream, sourced in OC's `captureTap` order (`captureStream()` first). Every generated portrait passes through a **landmark job** at creation, so viewers do not each re-detect faces (a PG gap).

### 5.4 Sound

**Room tone [NEW].** Each room has a quiet synthesised texture whose density follows its event rate: soft ticks for tool calls, a paper sound when an artifact lands, a short whoosh for a pass. It is Web Audio earcons driven by the bus, not speech, so it costs no TTS. This is how you "hear your company working" for free. It is on at low volume on desktop, off on mobile, and silent during quiet hours.

**Spatial audio [NEW].** A `StereoPannerNode` per desk places voices by where the desk sits relative to your focus, so while you listen to one room a neighbouring meeting murmurs at −18 dB on your left. The **Mixer** lets you solo, mute or duck any room or agent. Every earcon also has a visual flash, so sound is never the only signal.

---

## 6. Avatar states

**Legibility rule: one state per agent at a time, derived only from real events.** The FloorProjector applies a priority order and minimum dwell times so tiles do not flicker.

| State | Triggered by | Face (supported by the renderer) | Tile chrome | Text equivalent |
|---|---|---|---|---|
| **Away** | Outside working hours, paused, or out of budget | Desaturated still | Dimmed | "Away until 8:00" |
| **Idle** | No active run | Blink every 3–8 s, idle sway (PG idle loop) | Neutral ring | "Idle" |
| **Attending** | The owner walks up | Head eases to centre, one brow lift | Ring brightens | "Priya is with you" |
| **Listening** | Someone is speaking in its room | Mouth at REST, sway damped | Tilt toward the speaker's seat | "Listening to Jules" |
| **Thinking** | A model turn is in flight with no output yet | Slower blinks, slight upward tilt | "thinking…" label [BB] | "Thinking about pricing tiers" |
| **Working** | A tool is running | Downward "reading" tilt | Tool glyph burst [BB] and a status line from the OC summary table | "Searching supplier prices" |
| **Speaking** | This agent's audio is playing | Full fusion-driver lip sync [PG] | Seat lifts and glows while the others dim to 0.55 [PG] | Live caption line |
| **Handing off** | `ask` or `handoff` event | Head turns toward the target desk | Pass animates along the edge | "Handing the café shortlist to Jules" |
| **Receiving** | Target of a pass | Looks up | Incoming dashed edge | "Picking up the hand-off…" [BB] |
| **Waiting on you** | An Inbox decision is open | Brow raise held | **Hand glyph rises** beside the portrait, gentle pulse | "Theo is waiting: approve sending 340 emails" |
| **Blocked** | Error, budget cap or missing connector | Still | Amber ring and a reason glyph | "Blocked: QuickBooks needs sign-in" |
| **Delivered** | A plan step completes with an artifact | Brief glow | The artifact card flies to the Pinboard | "Delivered: café target list (CSV)" |

**Priority, highest first:** speaking > waiting on you > blocked > listening > handing off > receiving > working > thinking > attending > idle > away.

**Dwell times:** thinking holds for at least 600 ms, handing off for at least 1.2 s, and delivered for 2 s.

**Being honest about the renderer.** PG's renderer supports mouth, blink, brows and head sway, with **no arms and no eye movement**. So the raised hand is a UI glyph beside the face, and "looks toward" is a head yaw built from the sway transform. True gaze and expression palettes are a v2 renderer item [NEW]; the `sample(now)` driver contract lets a WebGL, Live2D or Rive rig replace the renderer later [PG].

A presence frame on the Workspace socket looks like this (one socket per client for the whole Floor, with hibernation):

```json
{ "type": "presence", "agentId": "ag_priya", "roomId": "rm_wholesale", "projectId": "pj_q4_wholesale",
  "state": "handing_off", "target": "ag_jules", "label": "Handing the café shortlist to Jules",
  "cause": { "type": "handoff", "seq": 4812 }, "dwellMs": 1200, "at": "2026-10-06T09:14:22Z" }
```

---

## 7. Room mechanics: floor control, pacing, voice on demand, whispers, tape

These all live in **RoomDO**. It is PG's `ConversationDO` promoted to hold many participants of these types: `agent`, `owner`, `observer`, `guest` (T5).

**Floor arbiter [NEW].**
- A speaking queue of `{speaker, priority, generation}` entries. Priorities: owner 0, Chief of Staff as moderator 1, agents with a raised hand in the meeting 2, the BB `discussionPlan` speaking order 3.
- When the owner's mic detects speech, the claim goes through. PG's client barge-in rule applies: RMS above 0.055 for more than 45 worklet blocks, with a 900 ms debounce.
- A successful claim **bumps the current speaker's generation**, and clients drop audio from the stale generation [PG].
- The moderator then passes `next: continue | user | end` [PG].
- Each agent has a **speaking budget** of 90 s per round, so a verbose coworker cannot monopolise a meeting.

**Pacing modes [NEW].** *Fast*: no audio listener, so turns run back to back at model speed. *Paced*: at least one audio listener or a seated owner; the next turn is generated while the current line plays, voiced three lines ahead (PG look-ahead) and released when it ends. Only **meetings** are ever paced; hand-offs and asks during normal work never slow down.

**Voice on demand and skip-to-live [NEW, on PG's pipeline].**
1. When the first audio observer attaches, the lead speaks a **catch-up** of at most 15 s, generated from the tape since your last visit.
2. The live tail is then voiced line by line in each speaker's voice, with expressive tags [PG]. Audio is stored under `rooms/{roomId}/lines/{lineId}` in R2 for replay.
3. If the voiced tail falls more than 20 s or 8 lines behind the live edge, the lead inserts a **skip line** ("They've moved on. Priya accepted the 12-bag minimum; now it's delivery days.") and jumps ahead.

**Whisper [NEW].** The owner selects a seat and sends a text or voice note. It is added **only to that agent's perspective projection** as `[Private note from the owner]`, extending BB's `transcriptToMessages`. A use policy travels with it: `quietly` (act on it, don't quote it) or `attribute` (you may say it came from the owner). Whispers sit on the owner's tape behind a lock icon.

**Captions.** One live caption line per room with the speaker's name and colour, plus the full transcript in the **CC drawer** (`role="log"`), using PG's `CaptionBuffer` semantics (deltas append, finals replace). The owner's speech goes through PG's `TurnAssembler`, so a pause does not split a sentence into two turns.

**Tape.** Every room records ordered events: lines, passes, tool steps, decisions and whispers (owner-only). Lines that were never voiced can be **voiced on replay** and are then cached. The scrubber has ▶ and a ● Live chip [BB]; a shared replay link reproduces the meeting exactly [PG].

```json
{ "type": "floor", "roomId": "rm_wholesale", "action": "claim", "by": "owner", "priority": 0,
  "preempts": { "agentId": "ag_jules", "generation": 37 } }
{ "type": "whisper", "roomId": "rm_wholesale", "to": "ag_priya", "use": "quietly",
  "text": "Minimum order stays at 12 bags.", "visibility": ["owner", "ag_priya"] }
```

---

## 8. Signature experiences

### 8.1 7:42 a.m.: the walk-in

Dana opens her laptop at the roastery counter. The Floor fades up.
- Two desk lamps are still lit from the **Night Shift**: Omar's green-coffee reorder analysis finished at 3:10, and Kit's label variations are halfway through rendering.
- Her Chief of Staff, **Mara**, looks up from the Front Desk: "Morning, Dana. Three things overnight."
- Mara speaks a 40-second brief, synthesised from each `ProjectDO`'s state in BB's verb-first `goalBoard` phrasing and delivered through voice front / brain back [PG]: Omar recommends reordering the Huila lot before Friday's price change, Kit has four label options pinned in the Rebrand room, and Theo has a raised hand.
- Across the Floor, one desk shows a hand glyph. The Door Plates read "Approve: send the October win-back email" and "Review: 4 label options".

Dana says "Show me Theo," and the camera walks her there. Nothing was invented to fill time: on a quiet night, Mara says "Quiet night. Nothing needs you."

*Built on:* BB `routingBrief` and `goalBoard`, PG memory-aware greeting and voice-front/brain-back, PG alarm-driven jobs, OC deliver-to-origin. The **Night Shift** lamps are [NEW].

### 8.2 Delegate by voice, and watch the room build itself

Dana says: "We need a wholesale push to Portland cafés before Q4. Keep it under $400."

Mara answers in one sentence ("I'm putting a team together; you'll get a plan to approve in a minute"). This is OC's "I started it" semantics. Then a new room assembles on the Floor edge:
1. Five desks slide in as silhouettes.
2. BB `assembleTeam` casts the team with an enum-constrained schema, one designated sceptic and a spread of providers: **Jules** (wholesale sales), **Priya** (finance), **Theo** (email), **Kit** (design) and **Wren** (the sceptic).
3. PG `inventCast` gives each one a unique voice and a warpable portrait. The faces paint in over about 20 seconds while the landmark job runs.
4. The Plan Wall fills with a 6-task DAG with clusters of lead, co-owners and reviewers [BB].
5. Mara's hand rises, showing the forecast cost ($212, based on per-model `rates` [NEW]) and the two tasks that will need Dana's approval.

Dana taps **Approve plan**. The room's lamps come on.

### 8.3 Listening at the door

Mid-morning, Dana passes the Wholesale room at Floor zoom.
- Its Door Plate reads "In session: pricing tiers (Jules, Priya, Wren) · no listeners". She hears its room tone thicken.
- She clicks **Listen**. Mara speaks in her ear: "Twelve minutes in. Priya wants a 15% wholesale discount at 12 bags; Wren thinks cafés won't commit to 12."
- The live tail starts. Wren's voice, a dry alto on Dana's left, says: "Two of the three cafés on our list order under ten bags a month."
- Captions roll. The meeting switches to **paced** mode, so turns now arrive at speaking speed.

Dana selects Priya's seat and types a **whisper**: "Minimum order stays at 12; offer free delivery instead." The whisper is marked `quietly`.

On her next turn, Priya says: "Counter-proposal: hold 12 bags, and we absorb delivery inside the metro." Wren concedes. The other agents' contexts never contain the whisper.

### 8.4 Taking the floor

The pricing discussion reaches synthesis (BB `/discuss` phases: framing, opening, debate, synthesis). Dana holds **Space** and says: "Before you close, what does Eastside Espresso actually pay us today?"

1. The arbiter preempts Jules mid-sentence: his generation is bumped and his audio stops within about 300 ms.
2. All three faces switch to **listening** and turn toward her owner tile. The moderator routes the question.
3. Priya checks QuickBooks through MCP [BB/OC] and answers aloud; the tool call shows as one line: "Checked Eastside's last 6 invoices."
4. Afterwards Mara turns the synthesis into **minutes**: 3 action items become plan tasks through BB plan repair, each landing on the right desk as a pass [NEW].

### 8.5 A hand goes up

Theo has a 340-recipient win-back email ready. Sending is a real-world action, so BB's hard refusal becomes **approval-required plus an exactly-once effect** via the BB ledger `effect`/`receipt` pair, wired up [NEW] (T15). Theo's hand rises and Dana's phone buzzes; the interruption counts against the Knock Budget, and the LLM judge rated it as mattering [BB].

Dana walks up to Theo's desk. He explains in two spoken sentences, and the card shows a preview of the first email, the recipient segment and the grant options: once, this task, this session, 24 h, standing [BB]. Dana says "Approve once." Standing grants and anything involving money need an on-screen tap after a spoken read-back [NEW], so a misheard voice command never becomes a standing permission.

The send runs once. Its receipt appears on the Pinboard, and Theo's tile shows **Delivered: 340 sent, 0 failed**. Personagram's rule "never claim a real-world action" holds [PG]: Theo cannot say "sent" until the receipt exists.

### 8.6 Walkie-talkie from the delivery van

At 2 p.m. Dana is driving wholesale samples across town. On her phone, Ninth Floor is one screen: Mara's face as a 76 px bubble that grows while she speaks [OC presence scaling], a large **hold-to-talk** button, a Hands badge showing 1, and a **Patch in** list of live rooms.

Dana holds the button: "What's blocking the Portland push?" Mara: "Kit's sell sheet is waiting on your logo choice. Everything else is moving."

"Patch me into Wholesale." The room plays as audio only, with Media Session metadata ("Wholesale · Jules speaking") on the lock screen and lock-screen controls mapped to mute and leave.

"Tell Jules to move the Eastside tasting to Thursday." It goes as a `message_bot` through the lead, and Mara confirms it back.

The mic is push-to-talk, never always-on. A 1:1 lead session with no observers is the one case where browser-direct realtime is allowed, as a latency optimisation (T5).

### 8.7 Show, don't type

Back at the roastery, Dana holds her phone camera up to a competitor's retail bag on the shelf and says: "Kit, how does ours compare?"
- The frame becomes a **ContextCard** [OC]. Its vision description arrives a moment later and upgrades the card in place (upsert).
- On desktop she drags a supplier PDF onto **Priya's desk**. That scopes the file to Priya alone. Dropping it on the **Rebrand room wall** would share it with the project instead, and dropping it on **Mara** lets the lead decide where it goes.

This makes OC's `ContextCard` `scope` visible: *the drop target is the scope* [NEW]. Every agent turn shows the chips it used, including recalled memories with provenance labels such as `keyword + vector` [OC]. Kit answers at hero size and pins two generated mock-ups to the Pinboard (image generation via the registry [OC/BB], identity-preserving edit [PG]).

### 8.8 Rewind the day

At 6:30 p.m. Dana drags the Floor's time slider back to 8:00 and presses play. The day replays in 90 seconds: rooms brighten and dim, passes arc between desks, hands rise and fall, and the Portland room assembles itself.

She clicks one pass, Priya to Jules at 11:04. The replay pauses and opens the Wholesale tape at that line. She presses ▶ and hears the exchange, voiced on replay and cached from then on.

**How it works.** Rewind is BB's `replaySteps` and durable event bus (`?since`) applied to the whole Floor, and the tape is PG's exact replay. **Export** produces a transcript, a stitched WAV [PG] and, later, an MP4 of the avatars [NEW].

---

## 9. Feature set by pillar

| Pillar | Ninth Floor delivers | Builds on |
|---|---|---|
| **Lead orchestrator** | Chief of Staff rebuilt each turn from the owner's profile and house rules. Delegates, creates projects, speaks the daily brief. New lead tools: `steer_project`, `pause_project`, `convene_meeting`, `escalate`. One brain for text, voice and meetings. | BB `routerBot`, `routingBrief`, `materializeProject`; OC routing tables, "I started it"; PG voice front / brain back (T6); steering [NEW] |
| **Personas** | Unified schema: identity, role, skills, tool grants, model policy, voice `{provider, voiceId, speed}`, face rig, hours, budget. Instructions as lines; train by talking; distillation after meetings; voice unique per project. | PG `PersonaProfile`, `distill`, cast editor; BB layering, sceptic, `AGENT.md` golden-eval publish; OC `update_persona` |
| **Interactive avatars** | Hero, tile and token LOD; shared scheduler; one AudioContext mixer with per-agent taps; 12 presence states; landmark job; spatial panning. | PG landmarks → fusion driver → strip-warp; OC `captureTap`, presence scaling; BB activity bus; LOD and states [NEW] |
| **Workflow orchestration** | The Plan Wall shows the live DAG (work → review → revise, JSON verdicts, repair). Durable runs continue overnight. The Activity rail shows jobs; Mailroom triggers use the owner's timezone. | BB `executePlan`, ledger, triggers; PG `BuilderDO` → `RunDO`; OC task store and tray (T12, T18) |
| **Intra-agent comms** | Passes as bus events; meetings with real per-agent turns; floor arbiter; paced and fast modes; whispers; minutes → tasks. | BB `ask_bot`, `message_bot`, `/discuss`, `transcriptToMessages`; PG voicer pipeline, `next`; arbiter, whisper [NEW] (T7, T9) |
| **Projects with plans** | Room per project: Door Plate, Plan Wall, Pinboard, Tape, automations. Portfolio at Building zoom. Retrospective to the Library on close. | BB project model, `goalBoard`, artifacts; PG D1/R2 layout; retrospectives [NEW] |
| **All LLM providers** | One registry: Anthropic, OpenAI, xAI, **Gemini** [NEW], Ollama, OpenAI-compatible, Workers AI, Claude Code and Codex CLIs, Mock. Per-persona model policy and `rates`. Model names hidden on the Floor, shown in the desk inspector. | OC registry + BB adapters (T4); OC "no model chrome"; `rates` and discovery [NEW] |
| **Multimodal** | Streaming STT; per-agent chunked TTS with expressive tags; realtime voice for the lead; vision on camera, screen and files; image generation and edit; video generation on a room "screen"; video key-frame understanding; embeddings; file and folder ingestion. | OC capture, `FileProcessor`, video job; PG streaming STT, TTS tags, `SentenceChunker`, image edit; BB key frames, embeddings |
| **Context and memory** | Server-side graph with hybrid recall; Markdown projection per scope (`company.md`, `project-<id>.md`); reflection as a Hands decision; budgeted briefs; visible chips. | OC memory package; BB memory files and reflection; PG `fit()` and distillation (T13) |
| **Tools, MCP, apps** | MCP connectors with OAuth 2.1 [NEW]; agent-built dashboards pinned on room walls; bounded self-extension with Undo. | OC MCP + BB catalog; BB apps SDK + PG canvas and repair; BB `system` tool (T17) |
| **Trust and governance** | Role-scoped tools, then grants at call time, then endpoint policy. Voice approvals limited to "once" and "task". Door policies; tape retention; "Lights out" kill switch. | PG role-scoped dispatch; BB grants, taint, audit, Undo; OC policy table, privacy dot (T15); limits [NEW] |
| **Business and infrastructure** | Industry packs seed faces, voices and teams; onboarding writes `company.md`; Lobby doors; metering. `WorkspaceDO`, `ProjectDO`, `RoomDO`, `RunDO`; D1, R2, Vectorize. | BB templates + Mock; PG interviewer, Stripe, links, topology, harness; OC preflight (T2, T3, T16) |

**Door policies [NEW].** *Glass* (anyone with Floor access can listen), *Closed* (owner only, e.g. payroll) and *Lobby* (guest-facing). A Closed room still shows lamps and hands, but has no Listen button for staff.

---

## 10. Accessibility and fallbacks

**The Floor is never the only way in.** Every spatial action has a list equivalent and a keyboard shortcut.

| Need | Fallback |
|---|---|
| **Screen reader** | The **Directory** view: a tree of Rooms → Desks, each row reading name, state and label ("Priya, working: Pulling Q3 invoices") with the same verbs. `aria-live="polite"` announces only raised hands and meeting speaker changes, rate-limited. |
| **Keyboard** | Arrows move between desks; **Enter** walks up, **L** listens, **W** whispers, hold **Space** to take the floor, **H** opens Hands, **[ / ]** scrub the tape, **Esc** zooms out. |
| **Deaf / hard of hearing** | Captions are always on in rooms, with a name prefix and colour for each speaker. The CC transcript drawer is available. Every earcon has a visual flash. |
| **Reduced motion** | Passes become text lines ("Priya → Jules: café shortlist"). Portraits are static but keep functional lip sync [OC/PG rule], which can also be switched off. |
| **Low vision** | Layout holds at 200% text scaling [PG readability layer]. A state is never shown by colour alone: there is always a glyph and a text label. |
| **Cognitive load** | **Quiet Floor** hides passes and room tone. **Just tell me** reduces the product to the lead, Hands and projects (BB Simple mode). |
| **Weak device or network** | **Text Floor**: initials instead of faces, no audio, same data. The walkie-talkie mode works as audio only. |
| **Speech** | Anything you can say, you can type. Desktop dictation fills the composer and is not auto-sent [OC]. |

---

## 11. What makes it compelling

1. **Ten-second comprehension.** Door Plates, lamps and hands answer "what needs me?" before you read a word, and spatial memory helps: finance is in the corner room.
2. **Presence you can trust.** Every animation is backed by an event and every "done" by a receipt. The office never performs busyness, which is what makes it calming rather than a gimmick.
3. **Checking in without micromanaging.** You listen at a door; the work only slows down when you are *in* the meeting.
4. **One relationship, not twenty.** Mara is the only one you manage. Everyone else is reachable but optional, and the Shoulder bubble keeps the lead one sentence away on every screen.
5. **Emotional ownership.** Faces look up when you arrive, the Night Shift keeps its lamps on, and the brief greets you by name. Owners think of their business as a place; this makes the AI side of it one too.

---

## 12. Risks and mitigations

| Risk | Why it is real | Mitigation |
|---|---|---|
| **The spatial UI is slower than a list** | Metaphor UIs often lose to lists for repeated tasks. | Directory parity, command palette, "Just tell me" mode, and a measured 10 s comprehension target (§13). |
| **Too many faces for the GPU** | PG's stack is sized for 1–6 faces, and each face runs its own rAF loop (pg2 §7). | Hero/tile/token LOD, at most 3 animated tiles, a shared scheduler, off-screen pausing. A 12-tile spike runs before anything else is built. |
| **Voice-on-demand cost** | TTS for every line of chatter adds up. PG caps TTS at 3,000 calls per owner per day. | Voice only when someone listens, catch-up summaries, skip-to-live, a TTS-minutes budget per workspace, cached lines. |
| **Voice lags behind machine speed** | Agents write faster than anyone can speak. | Paced mode for meetings only, skip lines for work chatter, and the live edge always visible in captions. |
| **Uncanny or misleading faces** | Photoreal fictional people imply feelings and abilities they lack. | Permanent "AI coworker" badge [PG], stylised procedural option [OC], no real likeness without consent [PG], event-derived states only. |
| **Too many interruptions** | Twelve agents can each think they matter. | Knock Budget with an LLM judge [BB], urgency grades, quiet hours, and routine hands batched into the morning brief. |
| **Hidden influence through whispers** | Private notes shape meeting outcomes. | Whispers stay on the owner's tape with a per-whisper `quietly`/`attribute` policy; never visible to guests. |
| **Mobile audio limits** | iOS PWAs restrict background audio and AudioContexts. | Media Session, one context created in a gesture, push as fallback, native shell after the MVP. |
| **Inherited defects** | Matrix §1.6: BB fake barge-in, PG dropped first deltas and early viseme drain, OC voice never tested live. | Fix before porting; add avatar-timing canaries to BB-style `verify:live`. |
| **Ambient capture privacy** | Camera and screen feeds reach model providers. | OC's truthful privacy dot, consent per agent for capture, and a unified audit of which frame went to which provider [NEW]. |

---

## 13. MVP slice

**Goal:** prove the loop "delegate → see it move → listen in → decide", for one owner on one Floor.

**Build these spikes first**, because they carry the largest net-new risk (matrix §6.2):
1. **12 desks at tile or token tier plus 1 hero** at 60 fps on a mid-range laptop and 30 fps on an iPhone 13.
2. **RoomDO fan-out**: 3 observers with voice on demand, where the first voiced line plays within 2.5 s of pressing Listen.
3. **Floor arbiter barge-in**: the agent's audio stops within 300 ms of the owner starting to speak.

| In the MVP | Deferred |
|---|---|
| One workspace and one owner (PG OAuth), the Chief of Staff plus up to 6 coworkers, 1–2 projects | Staff seats and RBAC, guests and Lobby doors, billing |
| 2D DOM/SVG Floor at Floor and Room zoom, Directory parity, keyboard navigation | Building zoom, Rewind time-lapse, room tone, spatial audio |
| 7 states: idle, thinking, working, speaking, handing off, waiting on you, blocked | Gaze, expressions, attending and receiving animations |
| Lead in text and push-to-talk voice (voice front / brain back), reasoning through the registry (Anthropic, OpenAI, xAI, Mock) | Gemini, live discovery, CLI coworkers and the Workshop |
| BB plan engine in `ProjectDO`, plan approval as a raised hand, grants for "once" and "task" | Standing grants by voice, exactly-once external sends (spike only) |
| `RoomDO` with listen-in, catch-up, captions, per-room tape replay; `/discuss` meetings with take-the-floor; text whispers | Voice whispers, minutes → tasks, MP4 export |
| File drop onto a desk or room (scoped cards), camera and screen snapshot to the lead, image generation, embeddings over project docs | Video generation, folder sync, ambient capture |
| Mobile walkie-talkie: hold to talk to the lead, a Hands list, audio-only patch-in | Lock-screen controls, native shell |

**Exit criteria:** in moderated sessions, 5 of 6 owners answer "what needs you right now?" within 10 s of opening the Floor; listen-in reaches first audio in under 2.5 s at p50; median TTS cost per active owner per day stays under a target set from spike data; and zero presence frames lack a cause (a test replays a recorded bus and asserts every frame has a `cause.seq`).

**The first demo, end to end:** Dana says "We need a wholesale push," watches the room assemble, approves the plan from Mara's raised hand, listens in on the pricing debate, whispers a constraint, and hears Priya use it. That takes three minutes, and it is the whole product in miniature.
