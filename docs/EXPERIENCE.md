# Headcount: Experience Design

> **Status.** v1.0, 28 September 2026. Companion to the binding `docs/PRODUCT.md`; vocabulary follows its §4 exactly.
>
> **Tags.** [BB] biz-bot · [OC] oncloudnine · [PG] personagram-ai · [NEW] white space. **Phases** follow PRODUCT §11 (**MVP**, **v1**, **v2**); untagged items ship in the MVP.
>
> **Cast** (PRODUCT §5). **Dana** (Brightline agency): Chief of Staff Morgan; Juno, Marcus, Lena, Walt (the sceptic), Pax. **Luis** (e-commerce): Rosa; Kit, Bea, Sol, Otto. **Priya** (bookkeeping): Wren; Hale.
>
> **Scope.** How the owner perceives, navigates and controls Headcount; `ARCHITECTURE.md` specifies the mechanisms. In UI copy a coworker's portrait is its **face**.

---

## 1. Experience principles

PRODUCT §3.3 says what Headcount believes. These twelve rules say how every screen, sound and face honours it, each with a test.

| # | Principle | The rule | Test |
|---|---|---|---|
| X1 | **Ten seconds to "what needs me"** | The Inbox count (raised hands only, never updates) sits in the same place on every screen. **H** opens it. "What needs me?" gets at most three sentences. | 5 of 6 owners answer within 10 s |
| X2 | **One front door, every door open** | The Chief of Staff bubble is on every screen; every desk is one Enter away. Every side conversation returns to the Chief of Staff as one line, every scope change as a plan diff. [BB][NEW] | Every desk talk produces a Talk summary line |
| X3 | **Faces show the ledger, not a mood** | Faces, lamps, edges and door plates render only FloorProjector frames with a recent cause. No ambient "busy" loops: an idle office looks idle. [NEW] | Bus replay: no non-idle frame without `cause.seq` |
| X4 | **Summary before stream, silence by default** | Audio plays only after a gesture, a join or a scheduled Brief. Rooms, replays and Briefs open with ≤ 20 s of summary. Everything plays at 1–2×. [PG][NEW] | No autoplay path in the route map |
| X5 | **The owner always has the floor** | Owner speech ducks agents in ~120 ms and stops them in ≤ 300 ms. A failed voice turn never loses typed text. [PG] | Barge-in p50 ≤ 300 ms |
| X6 | **Every status carries a verb** | Door plates, Inbox cards, Brief items and desk labels lead with a verb and name the next action's owner. [BB `goalBoard`] | Copy lint |
| X7 | **Where you drop it is who sees it** | The drop target sets scope; the card says so and is removable until used. [OC][NEW] | Every card shows scope, source, `asOf` |
| X8 | **Hide what can't work; say why once** | Unavailable controls are absent, not greyed. An error is one sentence naming the missing key, connector or cap and the fix. [OC] | No disabled controls in e2e snapshots |
| X9 | **Proof sits on the surface** | Claims carry a citation, artifact, receipt, dated metric or owner answer, or an "unverified" badge. "Sent" never renders without a receipt chip. [BB][PG → NEW] | Zero action claims without receipts |
| X10 | **Dollars are always in view** | Forecast ranges on plan cards, the reservation at approval, spend against cap on every project header. Unknown cost reads "unknown", never $0. [NEW] | No silently zero cost |
| X11 | **Parity everywhere** | The Directory does everything the Floor does; every voiced line is captioned; every state has a glyph and a label, not just a colour. [OC][PG] | Directory e2e mirrors the Floor's |
| X12 | **Talk first, configure later** | The first hour is a conversation; settings default from the pack; no model is called on empty input. [PG] | First deliverable before any OAuth |

---

## 2. Information architecture and navigation

### 2.1 The map

```
 ┌── every screen: Chief of Staff bubble · Inbox count · Activity rail · Everyone stop ──────────┐
 │  TALK ─────── the Chief of Staff's thread (text · voice · file · camera · screen)             │
 │  FLOOR ⇄ DIRECTORY ── pod (door plate) ──► ROOM ──► MEETING STAGE ──► REPLAY                  │
 │        └── desk ──────────────────────────► DESK STAGE ── Profile ── Studio                    │
 │  PROJECTS ─► PROJECT: Overview · Plan · Runs · Deliverables · Automations · Team ─► ROOM       │
 │  INBOX: Needs you · Updates · Resolved ─► decision ─► DESK STAGE (handoff card) | PLAN DIFF    │
 │  HANDBOOK: Company · Clients · Projects · Coworkers · Standing rules · Graph · Search          │
 │  SETTINGS: Autonomy & grants · Money · Attention · Connectors & keys · Skills & playbooks ·    │
 │            Apps · Voices & faces · Privacy & consent · Members · Front doors · Audit          │
 │  BRIEF PLAYER · WEEKLY REVIEW (replays with chapters)                                          │
 └────────────────────────────────────────────────────────────────────────────────────────────────┘
   GUEST (no owner chrome): FRONT DOOR /d/{token} · SHARED REPLAY /r/{token} · CLIENT PORTAL (v1)
```

Three levels of commitment, each one gesture from the last: **glance** (Floor, Inbox count, door plates), **check in** (desk stage, listen in, replay), **act** (approve, take the floor, whisper, edit the plan). **Just tell me** mode collapses the map to Talk, Inbox and Projects [BB Simple mode].

### 2.2 Global chrome

| Element | Placement | Behaviour |
|---|---|---|
| **Navigation** | Left rail ≥ 1024 px; icon rail 768–1023; bottom tabs < 768 (Talk · Floor · Inbox · Projects · More) | The Inbox badge counts raised hands only, so it can reach zero |
| **Top bar** | Workspace and client filter, ⌘K palette, month usage ("$41 of $300"), **Everyone stop** | The palette navigates and opens; it never approves |
| **Chief of Staff bubble** | Bottom right; 56 px desktop, 76 px phone, with a state ring [OC presence scaling] | **Tap**: Talk opens as a sheet with a "Viewing: Northwind plan" card attached. **Hold**: push-to-talk. **Drop**: the Chief of Staff routes the file. |
| **Activity rail** | Right, collapsible; bottom sheet on phones [OC Pending tray] | One row per job: project, coworker, running sentence, elapsed, progress, **Stop**. Opens itself only for owner-started work; finished rows sweep after 2 min; failures stay until dismissed. |
| **Now-playing bar** | Under the top bar while audio plays | Source, speaker, speed, captions, **Leave**. Listening survives navigation; v1 adds a floating picture-in-picture face. |

### 2.3 Moving between surfaces

| From | Gesture | To |
|---|---|---|
| Anywhere | **H** / **⌘K** + a name | Inbox / any desk, room, project, deliverable or Handbook page |
| Anywhere | Hold **Space** (outside text fields) or the bubble | Push-to-talk to the Chief of Staff; in a joined room it takes the floor |
| Floor | Arrows, **Enter**, **L** | Move between desks; walk up to a desk stage; listen to a pod's room in place |
| Floor | Click a hand-off edge | The room's replay at that line |
| Inbox card | **Ask why** | The asker's desk stage with the handoff card loaded |
| Talk | Answer to "Why did we…?" | The replay at the cited 40 seconds |
| Anywhere | **Esc** | One level out: desk → Floor, meeting → room → Floor |

**Semantic zoom (v1)**: pinch or ⌘-scroll moves Building → Floor → Room → Desk; each level is a URL [NEW]. **State is preserved**: views stay mounted so switching never interrupts a stream, and drafts persist per thread [BB].

### 2.4 Deep links

Paths use stable ids, never names [BB lesson], and carry ids only, so a notification payload or forwarded URL leaks no content.

| Path | Opens |
|---|---|
| `/talk/{threadId}#seq-{n}` | The Chief of Staff thread at a turn |
| `/floor?pod={projectId}`, `/directory` | The Floor centred on a pod; the Directory |
| `/desk/{coworkerId}[/profile][?decision={id}]` | Desk stage; profile; stage with a handoff card |
| `/p/{projectId}/{overview\|plan\|runs\|deliverables\|automations\|team}` | A project tab (`?step=`, `?run=`, `?v=` select within it) |
| `/room/{projectId}[/meeting/{meetingId}]` | Room; live meeting |
| `/replay/{meetingId}?t=41&ch=3`, `/brief/{date}`, `/review/{isoWeek}` | Exact replay, Brief, Weekly Review |
| `/inbox[/{decisionId}]`, `/handbook/{page}`, `/settings/{section}` | Inbox, Handbook, Settings |
| `/d/{token}` · `/r/{token}` | Guest front door (v1) · shared replay |

A resolved link still renders a sentence ("Resolved by you at 09:12 · Approve once · receipt rcpt_8841"). `?listen=1` lands with **Listen** focused, never autoplaying (X4).

---

## 3. Surfaces

### 3.1 Talk: the Chief of Staff console

**Purpose.** The one front door to delegate, ask, steer and be briefed: one thread, one brain, whether typed, spoken or in a meeting [OC turn protocol; PG voice front, brain back].

```
┌ Talk ─────────────────────────────────────────────────────────┬ Context ─────────────┐
│ [face] Morgan · Chief of Staff · Listening…     [Hands-free]  │ Used in the last turn│
│───────────────────────────────────────────────────────────────│ ▣ Northwind RFP.pdf  │
│ You    Northwind invited us to pitch… Build the proposal.     │   project · 09:57    │
│ Morgan What budget did they hint at? Are you presenting?      │ ▣ company.md         │
│        route: project · 2+ disciplines, deliverable, due Thu  │ Memory used          │
│ You    40 to 60k. Me.                                          │ ▸ "Northwind's CMO…" │
│   ✓ Staffed Northwind: 3 reused, 1 hired (Pax)                │   keyword + vector   │
│   ┌ PLAN · Northwind spring pitch ─── $14–$22 · Wed 11:00 ┐   │                      │
│   │ Research → Positioning → Concepts → Deck → Budget → QA│   │                      │
│   │ 1 decision expected · at $22 it raises a hand [Review]│   │                      │
│   └───────────────────────────────────────────────────────┘   │                      │
│ Morgan You talked to Lena (2 min). Three budget tiers, change │                      │
│        accepted, brand guide shared.                          │                      │
├───────────────────────────────────────────────────────────────┤                      │
│ [▣ Photo · 6 bags torn ×]  Message Morgan, or hold Space…     │                      │
│                                  [Show] [Share] [Mic] [↑]     │                      │
└───────────────────────────────────────────────────────────────┴──────────────────────┘
```

**Content.**
- **Owner turns**, typed or transcribed; spoken ones replay in the owner's voice only with recording consent (PRODUCT §9.8).
- **Chief of Staff turns**, each with a collapsed **route line** that expands to the tools used [OC route table; NEW reason].
- **Tool steps**, one sentence each, spinner to check ("Staffing Northwind…" → "Staffed Northwind: 3 reused, 1 hired") [OC `TOOL_SUMMARY_TABLE`].
- **Cards**: plan card, plan diff, deliverable, receipt chip, mirrored decisions, and "I started it" lines saying where results will land [OC].
- **Side-conversation summaries** after every desk talk or joined meeting [PG `distill`].
- **Context column**: the cards and memories the last turn used, with scope, source and `asOf`; "memory used" is labelled by retriever [OC].

**States.** Idle · Listening (live waveform) · Acknowledging (≤ 1.5 s p50: "On it.") · Answering (≤ 3 s p50) · Backgrounded ("Started. It's in the Activity rail and will land here.") · Reconnecting ("Your message is still here") [PG].

**Actions.** Type; hold to talk; **Hands-free**; dictate into the composer, never auto-sent [OC]; drop files; **Show** (camera) and **Share** (screen); `@Juno` asks a coworker through the Chief of Staff and the answer returns here; **/** quick actions: *Brief me*, *What needs me?*, *Convene…*, *Everyone stop*.

**Empty.** The Chief of Staff's recorded greeting, three starter tasks from the pack and the Handbook, and "Tell me about the business". **Errors.** One sentence, said once: "Video needs an xAI key. Add one in Settings → Connectors & keys." Controls that cannot work are absent [OC].

### 3.2 The Floor and the Directory

**Purpose.** See the whole staff at a glance and walk up to anyone. The Floor *is* the monitoring UI (PRODUCT §3.1).

```
┌ Floor ─────────────────────────── [Floor | Directory] ── Inbox 2 ── $41 of $300 ── Stop ┐
│ ┌ MORGAN · Chief of Staff ──────┐  ┌ NORTHWIND · spring pitch ────────────────────────┐ │
│ │ [tile] Brief tomorrow at 7:30 │  │ Approve the budget tiers (you) · $9 of $22 · Wed │ │
│ └───────────────────────────────┘  │ In session: positioning · 3 · no listeners  [L]  │ │
│ ┌ HARBOR PET · renewal ─────────┐  │ [Juno]      [Walt]      [Lena]      [Pax]        │ │
│ │ Review the renewal deck (you) │  │ thinking…   listening   listening   Reading 14   │ │
│ │ [Marcus] (hand) (lamp)        │  │                                     outdoor-     │ │
│ └───────────────────────────────┘  │                                     retail reports│ │
│ ┌ EVERYDAY ─────────────────────┐  └──────────────────────────────────────────────────┘ │
│ │ Nothing open                  │  ┌ NORDIC OAT · Approve Juno's follow-up (you) ─────┐ │
│ └───────────────────────────────┘  │ [Juno, outlined]                                 │ │
│                                    └──────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

**Desk tile.** A face at Tile or Token level (§4.5); name and role; one **status sentence**, verb-first, ≤ 48 characters, from the route table's running copy; a résumé chip on hover or focus ("31 deliverables accepted"); and up to two persistent badges, the **raised-hand glyph** and the **Night Shift lamp** [OC copy table; BB `graph.js` halos; NEW].

**Pod.** One project, headed by its **door plate**: client tag, the next action and its owner ("Approve the budget tiers (you)"), spend against cap, deadline and room status ("In session: positioning · Juno, Walt, Lena · no listeners") [BB `goalBoard`]. **Hand-off edges** arc sender → receiver for their 1.2 s dwell with a label chip ("Pax → Juno: competitor grid"); a faint edge persists while an `ask` awaits its reply. A coworker on several projects keeps **one desk**, in the pod of its active step, and appears as an outlined token in the others [NEW].

**Layout** is automatic: the Chief of Staff top left; pods ordered by *needs you*, then deadline, then activity; Everyday last. Owners can pin and drag pods, and positions persist. Beyond six pods on a laptop, the rest collapse into "More projects".

**States.**
- **Quiet**: "Quiet. Nothing needs you. 2 lamps lit overnight." Only blinks move.
- **Everyone stopped**: faces still and desaturated under "Everyone stopped at 14:02 · 4 jobs fenced, 1 email held · **Review and resume**".
- **Presence lost**: tiles freeze to tokens: "Presence paused, reconnecting. Work continues in the cloud." Stale data never animates.
- **Constrained device**: tiles demote to tokens (§4.5); **Text Floor** is one toggle away.

**Actions.** Arrows, **Enter**, **L**, **Esc**. Click a lamp for **While you were away** (what ran, when, receipts). Click an edge for the replay at that line. Drop a file on a desk (that coworker only) or a door plate (the project).

**The Directory** is the same data as a tree of pods and desks. Rows read "Juno · Copy lead · Northwind · Thinking about the slow-outdoors line · waiting on you", with every Floor verb as a button. It sorts by Needs you, Active or Name, and is the default on phones and for screen readers.

**Empty.** The pack's coworkers idle in Everyday: "Your staff is here. Delegate something and watch a project staff up." plus three starters.

### 3.3 Desk stage, coworker profile and studio

**The desk stage** opens on walking up to a coworker (Enter on the Floor, a Directory row, or a handoff card).

```
┌ Lena · Deck designer · Northwind ─────────────────────────────── [Profile] [Esc] ┐
│ ┌────────────────┐  Current step: Deck (4 of 6) · reviewer Walt · due Tue          │
│ │  hero face     │  Holding: [▣ Brand guide · Lena only ×] [▣ Harbor case · team]  │
│ │  1024 px       │  ─────────────────────────────────────────────────────────────  │
│ └────────────────┘  You   Can the budget slide show three tiers?                  │
│ Speaking            Lena  Yes. That changes what Walt reviews and adds about      │
│ 18 decks accepted ·       forty minutes. I'll send it to Morgan as a change.      │
│ 2 edited · 0 reversed ┌ PLAN DIFF · Budget +1 reviewer · +$3 · +40 min ─────────┐  │
│ Learned: "Northwind   │ [Accept]  [Decline]  [Discuss with Morgan]              │  │
│  avoids stock photos" └──────────────────────────────────────────────────────────┘  │
│ [Hold Space to talk]  Message Lena…                                          [↑]   │
└────────────────────────────────────────────────────────────────────────────────────┘
```

- The face lifts to Hero while the status line keeps showing the real state: Lena can be *working* while you talk.
- She answers from her own fast tier, tools and voice; first audio ≤ 2.5 s p50 [PG + NEW].
- Plan, criteria, budget or deadline changes come back as an inline **plan diff**, because a coworker cannot write them directly: the single-agent contract [NEW].
- Files dropped here are scoped to this coworker. Leaving posts a summary line to Talk. "Learned: …" chips show for 6 s when she edits her own instructions or memory [PG].

**Profile** (a drawer on the stage):

| Block | Content | Editable |
|---|---|---|
| **Identity** | PG's 9 fields: name, headline, identity, personality, expertise, stories, preferences, boundaries, handoff rule | Yes |
| **Role and skills** | Role, skills, projects, a *sceptic* badge where it applies | Yes |
| **Instructions** | One rule per line with who added it and when; "Learned" lines flagged; ≤ 12k characters | Yes, or by talking [PG] |
| **Autonomy** | The dial per action class, its ceiling, grants in force | Links to Settings |
| **Track record** | Per action class, 30 and 90 days: proposed, approved as-is, edited, declined, reversed | Read-only [BB `buildAudit`] |
| **Desk inspector** | Model policy tiers *with model names*, voice provider and fallbacks, spend today, last 20 route decisions | Read-only; **the only place model names appear** [OC] |
| **Memory** | Readable scopes; link to `agent-<id>.md` | Yes |
| **Lifecycle** (v1) | Export `AGENT.md`; **Retire** keeps the track record | — |

**Studio.**
- **MVP**: the owner creates the Chief of Staff at onboarding (generate, upload or pick a face; choose a voice from previews; name it). Staff it casts every hire automatically [PG `inventCast`, `assignVoice`].
- **v1**: a **hire interview**, one question at a time and never asking for secrets [PG interviewer]; **appearance edits** through a strict schema and identity-preserving image edit, shown side by side as a tier-0 draft with **Keep** / **Discard** [OC `update_persona`, PG, BB]; a **voice audition grid** where taken voices read "Walt's voice" and choosing one offers a swap [PG cast editor], speed 0.85–1.15. There is no voice upload: Headcount never clones voices.
- **Errors**: a painting portrait shows a procedural bust, "Painting Pax…" [OC]; missing landmarks render mouth-only or still; a demoted voice provider plays the mapped fallback, noted in the inspector.

### 3.4 Room view

**Purpose.** A project's persistent channel and stage. Agents talk here in text at machine speed; meetings happen here; the wall holds what the team shares.

```
┌ Northwind room ── Approve the budget tiers (you) ── Quiet ──────── [Listen L] [Convene] ┐
│ Seats: [Juno] [Walt] [Lena] [Pax] [you: observer]                                        │
│─────────────────────────────────────────────────┬──────── Room wall ────────────────────│
│ 11:02 Pax → Juno  hand-off: competitor grid v2  │ [Competitor grid v2 · artifact]        │
│ 11:05 Walt        verdict: changes · 2 findings │ [Brand guide · Northwind team]         │
│ 11:06 Lena        Rendering the deck skeleton…  │ [Plan: step 2 of 6 · Positioning]      │
│ 11:20 Meeting started: positioning · Morgan     │  Drop files here for the whole team    │
│ Message the room…                          [↑] │                                        │
└─────────────────────────────────────────────────┴────────────────────────────────────────┘
```

- **Transcript**: messages, hand-offs, tool steps, and JSON verdicts as sentences linking to their evidence [BB].
- **Wall**: deliverables, shared cards and the live plan step; dropping here scopes to the project.
- **States**: quiet · in session, unvoiced ("no listeners") · listening (paced) · joined · ended (minutes card).
- **Actions**: **Listen** (L), **Join**, **Convene** (the Chief of Staff sets an agenda and attendees), post to the room (enters every member's view), open a replay.
- **Empty**: "Northwind's room. The team talks here; listen any time." Everyday's room hosts one-off meetings.

### 3.5 Meeting stage

A moderated session in a room, chaired by the Chief of Staff: framing, openings, 1–4 debate rounds, synthesis [BB `/discuss`, PG group stage].

```
┌ Northwind · Positioning · 11 min · Paced ───────────────────── ● Listening  [Leave] ┐
│ Catch-up · Morgan · 18 s ▸ Juno wants "the slow outdoors"; Walt asks how it sells  │
│                            jackets.                                                │
│       [Juno tile] turned →   ┌──────────────┐   ← turned [Lena tile]   [Pax token]  │
│                              │ WALT · hero  │                                      │
│                              └──────────────┘                                      │
│ WALT  Brand love doesn't move their Q2 number. Show me sell-through.               │
│ Agenda  Framing ✓ · Openings ✓ · Debate 2 of 3 ● · Synthesis                       │
│ Floor   Walt (speaking, 0:41 of 1:30) → Juno → Lena                                │
│ [Hold Space: take the floor]  [Raise hand]  [Whisper W]  [CC]  [Minutes]           │
└────────────────────────────────────────────────────────────────────────────────────┘
```

- **Choreography**: the speaker lifts to Hero and lip-syncs; others dim to 0.55 as Tiles or Tokens, heads turned toward the speaker [PG seat lift; NEW yaw].
- **Floor line**: the queue, with each agent's 90 s round budget.
- **Unvoiced**: with no listener, text only, with "Voicing starts when you listen."
- **Skip line**: > 20 s or 8 lines behind shows "Skipped 8 lines: they've moved on to budget tiers."
- **Minutes**: MVP, select lines → **Make these tasks** → plan diff; v1, automatic.
- **Errors**: an unvoiceable line plays as a caption marked "(not voiced)"; the moderator politely cuts an agent over budget.

### 3.6 Project workspace

```
┌ Northwind · spring pitch · client: Northwind Outdoor · Running · Autonomy: Propose ─┐
│ Due Wed 11:00 · $9 spent of $22 reserved (forecast $14–$22) · 1 decision waiting    │
│ [Approve the budget tiers]      Room ▸      Replay ▸                                │
│ Overview | Plan | Runs | Deliverables | Automations | Team                          │
│─────────────────────────────────────────────────────────────────────────────────────│
│ ✓ 12-slide deck in the house template ...... artifact: Northwind_deck_v3.pptx       │
│ ◐ Every market claim cited ................. 11 of 14 cited · 3 unverified          │
│ ○ Budget ties to the rate card ............. owner answer pending                   │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

| Tab | Shows | Key actions |
|---|---|---|
| **Overview** | Objective; criteria → evidence (linked, partial, missing, unverified); open decisions; active steps and owners; recent activity in plain words | The primary verb: *Approve the plan*, *Resume*, *Open the result*, *Raise budget* [BB] |
| **Plan** | The DAG; step cards with lead, co-owners, reviewers, criteria, estimated human hours, status and verdict; plan-diff history with stale approvals flagged | Edit a step → plan diff with a new forecast; **Pause**, **Rescope**, **Reassign** (`steer_project`) |
| **Runs** | Each run's timeline, cost, receipts and final state (done, failed, stopped, partial, interrupted, stale) [BB `runs.js`] | **Retry step**, **Stop**, **Open result**; dry run on Mock (v1) |
| **Deliverables** | All artifacts (10 kinds) with versions and lineage | **Accept**, **Request changes**, **Send** (a governed effect), **Pin to wall** |
| **Automations** | Triggers as sentences ("Weekdays 08:00 → Marcus refreshes the Harbor dashboard → Brief"), last and next fire, gate | **Run now**, **Pause**, **Edit** (tier-1: asks first). Schedule and page watch in the MVP; business triggers v1. |
| **Team** | Members, roles, résumé chips; a "different model family" badge on the sceptic, without model names | Add or remove a member → plan diff |

**Empty**: before approval, Overview shows only the plan card. **Errors**: a failed step shows its readable failure, its saved draft ("saved draft · incomplete") and the recovery options in §6.8 [BB].

### 3.7 Inbox

Needs you · Updates · Resolved [BB]. List mode on desktops; **Inbox sitting** mode (one card at a time) for the 12:30 nudge and phones.

```
┌ Needs you · 3 · About 4 min ────────────────────────────────────── [Start sitting] ┐
│ [Marcus] Send: the Harbor renewal deck, with a pricing option, to CMO and CFO      │
│ Harbor Pet · asked 06:52 · why now: renewal call on Thursday                       │
│ Recommends a flat retainer plus an 8% kicker above 3.2 ROAS. Walt signed off.      │
│ Evidence [model.xlsx] [verdict: approve] · Effect: 2 emails · no undo              │
│ Needs your screen: client pricing terms                                            │
│ [Approve once] [This task] [Change…] [Hold] [Ask why]                  About 1 min │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

- **Anatomy**: verb-first title; asker, project and **why now**; recommendation; evidence chips; the effect and its undo path; the time it takes. Grant buttons show **only** the kinds the capability allows [BB fix].
- **Kinds**: plan approval; effect approval (send, publish); question; budget raise ("Northwind is at $22 of $22; one more revision needs about $4. Raise by $6?"); plan diff; connector write scope; Handbook diff; promotion proposal (v1); front-door escalation (v1).
- **Keyboard**: **J/K** move; number keys press visible grant buttons in order; **C** change; **A** ask why. No key approves by default.
- **Voice**: "Approve once" works only within the voice cap and after a read-back; anything else gets "That needs your screen" (PRODUCT §9.3).
- **Stale**: "This changed since Marcus asked. Review the new version." Cards resolved elsewhere (say, in the Brief) move to Resolved with their receipt.
- **Empty**: "Nothing needs you. Next Brief at 7:30."

### 3.8 Handbook

What your staff knows, all editable as Markdown (PRODUCT §4.2).

```
┌ Handbook ────────────┬ company.md ──────────────────────────────────┬ Graph ───────────┐
│ Company              │ ## How we price                               │ Harbor Pet       │
│ Clients ▾            │ Retainers start at $8k a month. ⓘ             │  ├ CMO: Ana R.   │
│   Harbor Pet         │   source: rate-card.pdf · asOf Sep 2          │  └ ROAS 3.4      │
│   Northwind Outdoor  │ Never promise weekend turnaround. ⓘ           │   HubSpot ·      │
│ Projects · Coworkers │ ┌ PROPOSED · from Marcus's 1:1 ──────────────┐ │   asOf 02:10     │
│ Standing rules       │ │ + Renewals default to a kicker structure   │ │                  │
│ Search: "decided…"   │ │ [Approve] [Edit] [Discard]                 │ │                  │
└──────────────────────┴───────────────────────────────────────────────┴──────────────────┘
```

- **Pages**: `company.md`, `client-<id>.md`, `project-<id>.md`, `agent-<id>.md`, projected from the graph; edits sync both ways [BB, OC].
- **Provenance**: every line's ⓘ shows source, `asOf` and author; connector facts show their sync time.
- **Proposals**: onboarding cards, "Learned" facts and (v1) weekly reflection arrive as diffs to approve [PG draft → approve; BB reflection].
- **Isolation**: client pages carry their client tag; recall across clients raises a hand. **Deletes** are tombstones with **Undo**.
- **Search**: "Find where we decided X" per project (MVP) and workspace-wide (v1); results can open a replay.
- **Empty**: "Tell Morgan about the business, or drop in your website." **Stale**: "HubSpot last synced 3 days ago · Reconnect".

### 3.9 Connectors, skills and apps

| Area | Layout, states and actions | Empty / error | Phase |
|---|---|---|---|
| **Connectors & keys** | Catalog cards with a state pill: *Not connected · Read-only · Read + write · Needs sign-in · Error*. **Connect** runs OAuth 2.1 with PKCE; **Test connection** lists the tools found [BB]. Write scopes come later, as a raised hand at first need. A per-coworker access matrix. BYOK keys are write-only fields showing name and status only; **Add the key later** is first-class [BB]. | "No tools connected. Your staff can still research, write and design." / "HubSpot rejected the sign-in. Reconnect to resume Marcus's refresh." | MVP: HubSpot, email send; v1 the rest |
| **Skills & playbooks** | Skills with "when to use" lines. Playbooks move *Draft → Evaluated (9 of 10 golden) → Approved → Published v3 → Rollback* [BB `catalog-store`]. | "Evaluation failed 3 of 10 golden cases. Open the failures." | Skills MVP; playbooks v1 |
| **Apps** | Project apps with permissions, **Open**, **Pin to wall**, repair history | "This app stopped after two repair attempts. The last working version is still available." | v1 |
| **Companion** | QR pairing; capability pills (local models, CLI coworkers, shell, files, browser); a "Stays on this machine" badge [BB bridge] | "Companion offline. Local-only coworkers are paused; nothing moved to the cloud." | v1 |

### 3.10 Settings: administration and governance

| Section | Holds |
|---|---|
| **Autonomy & grants** | Action class × {default, ceiling, never} (PRODUCT §9.2); per-coworker overrides; active grants with their six bounds, expiry and **Revoke**, which says what stops ("Juno's scheduled posts stop from the next run") |
| **Money** | Monthly cap; usage by project, coworker and modality; forecast accuracy; the voice-approval cap ($250 · 25 recipients · no pricing terms); BYOK split |
| **Attention** | Brief time and timezone, Inbox nudge, Weekly Review slot, interruption budget (0 · 6 · 30), quiet hours, *always wake me* classes, opt-in Evening Wrap and month-end Review |
| **Voices & faces** | The workspace voice roster (uniqueness enforced), fallbacks per provider, portrait style for new hires |
| **Privacy & consent** | Recording consent per member, capture consent per coworker, retention (guest transcripts 90 days, raw frames 24 h), default whisper policy |
| **Members** (v1) | Staff seats and roles; **room visibility** [NEW]: *Open* to staff or *Closed* (payroll) |
| **Audit** | One filterable log: model calls with cost, tool calls, egress per frame and provider, decisions, grants, effects, receipts, workspace changes with **Undo** [BB]; export on Business |
| **Providers** | Plain-language canary status per provider ("xAI voice · passed 07:00"); a demoted provider shows the Brief's one-line reason. Provider names only. |
| **Everyone stop** | Current state; **Resume** needs an on-screen confirmation listing what will restart |

### 3.11 Front doors (v1)

**Owner side.** Created from a project or a coworker, the editor asks for the coworker, purpose, audience and desired outcome; a greeting; approved knowledge with a **What a guest can learn** preview; tools (default: *request a callback* only); consent wording; limits (minutes per session and per day); branding by tier; expiry [PG brief]. **Preview as guest** runs the real door in a sandbox session; **Publish** is explicit. The share dialog offers a locally generated QR code, Copy, the OS share sheet, **Make a new link** and **Turn off** [PG]. The door list shows live sessions, summarised transcripts and escalations.

**Guest side** (`/d/{token}`), PG's guest stage:

```
┌──────────────────────── (blurred ambient copy of the portrait) ──────────┐
│                       AI coworker · Brightline                            │
│                         ┌──────────────────┐                              │
│                         │  Marcus · hero   │                              │
│                         └──────────────────┘                              │
│  Marcus · Performance analyst             Listening to you · 08:42 left   │
│  "…the kicker only applies above 3.2 ROAS (slide 6)."                     │
│  [Mute] [Interrupt] [CC] [End]            or type…                   [↑]  │
└───────────────────────────────────────────────────────────────────────────┘
```

- **Entry**: **Start with voice** or **Use text**; optional transcript consent with optional name and email.
- **Status line**: "Connecting your voice… → Listening to you → Thinking about that… → Speaking"; a recovery panel offers "Retry microphone" or "Continue in text". It fits one phone screen with controls clear of the face.
- **Escalation**: "That's Dana's call. I'll get it to her tonight." A callback card follows, and a raised hand lands in Dana's Inbox with transcript and summary [PG `handoff` → NEW].
- **Revoked**: "This link is no longer active." Revoking ends live sessions.
- **Client portals (v1)** add a project's approved deliverables and replays, without whispers or internal verdicts.

---

## 4. Avatar behaviour spec

### 4.1 What a face can do in the MVP

PG's renderer (landmarks → fusion driver → Canvas2D strip warp) supports mouth visemes with jaw, lips and teeth; blinks; brow micro-raises; and head sway, which Headcount extends to small yaw (±12°) and pitch (±6°). It has **no eye movement, arms or expression palette**. So the raised hand is a glyph beside the face, "looking toward" is a head yaw, and no emotion is shown (PRODUCT P3 renderer honesty) [PG, NEW].

### 4.2 States

The brief's "waiting" state is the **raised hand**.

| State | Ph | Driven by | Face | Tile chrome · label | Ends on |
|---|---|---|---|---|---|
| **Idle** | MVP | No open job or turn | Blink every 3–8 s, idle sway [PG] | Neutral ring · "Idle" or the last delivery | Any event below |
| **Thinking** | MVP | Turn started, model call has produced no output yet | Slower blinks, head up 4° | "thinking…" [BB] · "Thinking about {topic}" | First output or tool call (dwell ≥ 600 ms) |
| **Working** | MVP | `tool.start` or a job heartbeat | Head down 6° (reading), sway damped | Tool glyph · route running copy [OC]: "Reading 14 outdoor-retail reports" | `tool.end` or job end |
| **Listening** | MVP | Another participant's line plays in its room, or the owner speaks to it | Mouth at rest, head turned to the speaker | Dimmed 0.55 in meetings · "Listening to Walt" | Speaker changes |
| **Speaking** | MVP | Its own audio playing on this client (playback start/end, generation) | Full fusion lip sync [PG] | Seat lifts, ring glows · live caption | Playback end or barge-in |
| **Handing off** | MVP | `handoff` or `ask` sent | Head turned to the target desk | Edge animates to target · "Handing the grid to Juno" | Dwell 1.2 s |
| **Raised hand** | MVP | `decision.opened` with it as asker | Brow raise held | **Hand glyph**, slow pulse (static in reduced motion) · "Waiting on you: approve 2 emails" | `decision.resolved` |
| **Blocked** | MVP | Step failed after retries; cap hit with *stop*; missing connector or key; Everyone stop | Still | Amber ring, reason glyph · "Blocked: HubSpot needs sign-in" | Unblocked |
| **Attending** | v1 | Owner opens its desk stage | Head to centre, one brow lift | Ring brightens · "With you" | Owner leaves |
| **Receiving** | v1 | Target of a hand-off | Head lifts briefly | Incoming dashed edge · "Picking up the grid" | Its first turn |
| **Delivered** | v1 | Step completes with an artifact | Brief brightening | Chip flies to the room wall · "Delivered: competitor grid" | Dwell 2 s |
| **Away** | v1 | Paused or out of budget | Desaturated still | Dimmed · "Paused until the budget resets" | Resumed |

### 4.3 Resolution rules

- **One animated state per face**, by priority: speaking > raised hand > blocked > listening > handing off > receiving > delivered > working > thinking > attending > idle > away (PRODUCT P3's order, extended with the v1 states).
- **Up to two persistent badges** survive state changes: the hand glyph and the Night Shift lamp. A coworker can be *speaking* in a meeting with its hand still up.
- **Dwell**: thinking 600 ms, handing off 1.2 s, delivered 2 s; every other state ≥ 300 ms, so tiles never flicker.
- **Freshness**: a frame is emitted within 2 s of its cause. A long state stays shown only while refreshing events arrive (model stream, tool progress, the 30 s job heartbeat). After 60 s with none, the face stills and the label reads "Last activity 1 min ago" [NEW; Appendix A].
- **Mouths move only when audio plays on this client.** In an unvoiced meeting, the floor-holder shows a "has the floor" chip and a caption snippet instead.

```json
{ "type": "presence", "agentId": "cw_pax", "projectId": "pj_northwind", "roomId": "rm_northwind",
  "state": "working", "label": "Reading 14 outdoor-retail reports", "badges": ["lamp"],
  "cause": { "type": "tool.start", "seq": 4812, "at": "2026-10-05T12:14:20Z" }, "dwellMs": 300 }
```

### 4.4 Gaze, orientation and expression

**MVP.** Orientation is a head yaw of up to ±12°, eased over 400 ms, toward the meeting speaker, toward the owner's seat when the owner takes the floor, and toward the target desk while handing off. Expression is limited to brows (onset raises; a held raise with a raised hand), blink rate and head pitch.

**v2.** A new renderer (WebGL, Live2D or Rive) behind the same `sample(now)` contract adds true eye gaze and a small palette driven **only by events**, never by reading the owner's face or voice: *attentive* (the owner is speaking to it), *concerned* (it returned `changes` as reviewer, or is blocked), *pleased* (its deliverable accepted as-is, 1.5 s), a *sceptical* resting variant for sceptics, and *neutral* otherwise.

### 4.5 Level of detail

| Tier | Rendering | Who gets it | Limit |
|---|---|---|---|
| **Hero** | 1024 px, full fusion driver | The desk you are at; the current speaker in the room you hear; the Chief of Staff in Talk | 1 |
| **Tile** | 256 px, same renderer, shared scheduler | Visible coworkers speaking, raising a hand, handing off or attending, in that priority | 3 animated |
| **Token** | Still portrait, state ring, glyph | Everyone else; everything off-screen (paused by `IntersectionObserver`) | None |

One rAF scheduler drives every face; one `AudioContext`, created on the first gesture, gives each agent an analyser tap [OC `captureTap`, PG]. Budget: 1 hero, 3 tiles and 12 tokens at 60 fps on a laptop and 30 fps on an iPhone 13 (spike S3). Two seconds over budget demotes the lowest-priority tile to a token.

### 4.6 Reduced motion and other modes

- **Reduced motion** (OS or in-app): sway, blinks, brow raises, edge animation and camera easing are off; hand-off edges become text lines ("Pax → Juno: competitor grid"). **Lip sync stays on** as functional feedback, with its own switch [OC, PG].
- **Still-portrait mode**: every face is a Token; the speaker gets a ring and a caption.
- **Text Floor**: initials, no faces, no audio; same data and verbs.
- **Honesty**: the hiring placeholder is a labelled sketch; coworker faces are always generated; every surface a non-owner sees carries the AI badge.

---

## 5. Voice and audio interaction

### 5.1 Four microphone modes

| Mode | Where | Gesture | Mic open | Goes to |
|---|---|---|---|---|
| **Push-to-talk** | Desktop, any screen | Hold **Space** (outside text) or the bubble; release to send | While held | The Chief of Staff; at a desk, that coworker; in a joined room, the room |
| **Hands-free** | Talk, desk stage, Brief player | Toggle **Hands-free** | Continuous, gated by local voice detection; the provider socket opens only on detected speech; off after 2 min of silence or when the tab hides | As above, **except rooms**: there the mic is always push-to-talk, so a cough never takes the floor |
| **Walkie-talkie** | Phone web app | Hold the big button | While held | The Chief of Staff, or the patched-in room |
| **Dictation** | Any composer | The composer's mic | Until tapped again | Composer text, never auto-sent [OC] |

A red dot and "Mic on" show in the top bar whenever any mic is live, driven by the actual track state [OC truthful privacy dot].

### 5.2 Talking to the Chief of Staff

```
 t = 0        speech ends; TurnAssembler closes the turn after a 1.2–1.5 s gap [PG]
 ≤ 1.5 s p50  acknowledgement in Morgan's voice ("On it.") from the realtime front
 ≤ 3 s p50    the fast brain's answer, in sentence chunks (first clause ≥ 60 characters) [PG]
   or         "Started. Pax will have a first grid in about three minutes." → background
```

- A turn needing a reasoning model or more than two tools goes to the background after one sentence; results arrive once, in the thread that asked [OC].
- **Voice approvals** (PRODUCT §9.3): Morgan reads the action back ("Sending Juno's follow-up to Kirsten at Nordic Oat, once.") and the receipt chip appears. Standing grants, money, identity and anything over the voice cap get "That needs your screen. It's first in your Inbox."
- **Everyone stop** works by voice; resuming always needs the screen.

### 5.3 Barge-in

1. Local voice detection hears the owner; all agent audio **ducks 18 dB within ~120 ms**.
2. The claim is confirmed after 300 ms of speech or one recognised word. The server bumps the speaker's **generation**, clients drop stale audio, and the speaker is silent within **300 ms** of onset.
3. A false start (no words within 600 ms) releases the duck, and audio continues.
4. The interrupted line is marked "interrupted" in captions and replay [OC].

In the Brief, barge-in pauses the recording and hands the turn to the live voice front; **Carry on** resumes.

### 5.4 Listening in

1. **L** or **Listen** on a pod, door plate or room makes the owner an **observer**; the Now-playing bar appears.
2. The Chief of Staff speaks a **catch-up** of ≤ 20 s from the room's ledger since the last visit.
3. The **live tail** plays in each coworker's own voice, voiced once, three lines ahead, and cached [PG].
4. The meeting becomes **paced**: the next turn is written while the current line plays. Work outside meetings never slows (PRODUCT principle 8).
5. Falling > 20 s or 8 lines behind inserts a **skip line** back to live.
6. **Leave** stops voicing within one line; the meeting returns to machine speed.

**MVP limits**: one room audible at a time; opening a desk 1:1 pauses listening after the current line; the room header shows "Voiced today: 14 of 30 min", and at the cap voicing stops with one sentence while captions continue.

### 5.5 Joining and taking the floor

- **Join** upgrades observer to participant: a seat appears and the moderator says "Dana's joined."
- **Hold Space to take the floor.** Priority 0 cuts the speaker (§5.3) and every head turns to the owner's seat. Speech is transcribed and assembled into a turn [PG `TurnAssembler`]; the moderator fills the 2–4 s gap ("Juno, that one's for you.").
- **Raise hand** queues the owner next but lets the speaker finish the sentence; a "You're next" chip shows.
- If the owner's point changes scope, the coworker says so and a plan diff appears on the stage.

| Priority | Who | Behaviour |
|---|---|---|
| 0 | Owner | Hold-to-talk preempts; raise hand yields at sentence end |
| 1 | Chief of Staff (moderator) | Frames, fills gaps, cuts overruns, synthesizes |
| 2 | Coworker with a raised hand | Next after the moderator |
| 3 | Speaking order | 90 s per agent per round; `next: continue \| user \| end` |

### 5.6 Whispering

Select a seat, press **W**, type, and choose **Quietly** (use it, don't quote it; the default) or **Attribute** (may say it came from the owner). The note enters only that coworker's view of the room; it is never voiced, never shown to staff or guests, and sits behind a lock in the owner's replay. **Voice whispers (v1)**: hold **W** and speak; the note is transcribed privately [BB `transcriptToMessages` + NEW].

### 5.7 Mixer (v1)

**Solo**, **Mute** and **Duck** per room and per coworker, plus a master voice level; owner speech always ducks everything. Spatial panning by desk and room-tone earcons are v2.

### 5.8 Captions

Always on in rooms, the Brief and replays: one live line with the speaker's name, colour and glyph, where partial text appends and final text replaces [PG `CaptionBuffer`]; **CC** opens the full transcript (`role="log"`). The owner's speech is captioned too. Captions scale to 200% and can sit at the top on phones to keep the face clear.

### 5.9 Replay

Every meeting, Brief and Weekly Review is an **exact replay**: stored line audio plus a participant snapshot, so faces move exactly as they did [PG].
- Chapters per agenda item or project; 1–2×; **skip** by voice or key; **[ ]** between lines.
- **Ask while replaying**: speaking pauses it, Morgan answers live, then it resumes (PRODUCT §5.9).
- Never-voiced lines are voiced on first replay, then cached. Whispers stay owner-only behind a lock; the owner's voice replays only with consent.
- **Export**: transcript plus WAV (MVP), MP4 (v2). **Share** creates `/r/{token}` without whispers or verdicts, AI badge on.

### 5.10 The Brief player

Lock-screen metadata ("Brief · 4 min 10 s · 2 need you"), chapters per item, 1–2×, **Shorter** and **Skip** feedback, and **Talk back** (hold on a phone, or hands-free). Voice decisions appear as receipt chips; anything needing a screen goes to the top of the Inbox. A quiet day's whole Brief: "Quiet night. Nothing needs you."

---

## 6. Key user journeys

### 6.1 Onboarding and the business-context interview (Dana, day 1)

Before signing up, Dana walks the **keyless demo office** (Mock provider, seeded showcase coworker) [BB + PG].

1. **Sign in with Google; pick the Agency pack** (2 min). The Floor appears with the pack's coworkers idle in Everyday.
2. **Meet the Chief of Staff** (3 min). Dana chooses a face (three generated options, upload, or pack), a voice from previews, and the name Morgan. Morgan's greeting is **spoken and recorded as turn 1** [PG lesson].
3. **The interview** (15 min, voice or text). One question at a time, never re-asked, never asking for passwords or identifiers [PG interviewer]. "Learned" chips stack beside Morgan ("Learned: 7 retainers, mostly consumer brands"). She pastes brightline.co (fetched safely [BB]) and drops a rate card and two proposals. Each fact becomes a **card to approve** in a draft `company.md` [PG draft → approve]. Continue with nothing entered gets "Tell me one thing about the business, or drop in a file", with no model call.
4. **First delegation** (20 min). Morgan offers three starters built from what it learned ("Draft a renewal one-pager for Harbor Pet from the proposal you dropped in"). Dana picks one; a pod forms; she approves the plan; a deliverable lands before any OAuth.
5. **Guardrails** (5 min): Brief time (7:30), interruption budget (6), monthly cap, recording consent.
6. **Then** connectors, read-only: "Connect HubSpot so Marcus can read client KPIs."

**Success**: 80% accept a first deliverable within 60 minutes.

### 6.2 Delegate an outcome (Luis, Talk, desktop)

1. Luis types *"Get the Guji launch kit ready for Thursday: product copy, 6 images, a 15-second cut, and the pre-order email"* and drops Thursday's photos; six image cards appear and sharpen as descriptions land [OC upsert].
2. Rosa acknowledges within 1.5 s and asks at most two questions: *"Which photos are hero-worthy? Should Bea send the email or hold it?"* Luis: *"2 and 5. Hold it."*
3. The route line reads "route: project · three disciplines, deliverables, a deadline." *"Staffing it now."*
4. The pod forms on the Floor: Sol, Otto and Kit slide in with résumé chips; the pack's sceptic ("the returning customer") appears; the plan card explains "No hire: everyone needed is on staff."
5. The plan card lands in Talk and as a raised hand on Rosa's desk (§6.3).

### 6.3 Approve a plan (Luis, 2 minutes)

```
┌ PLAN · Guji launch kit ───────────────────────────────────────── Forecast $6–$11 ┐
│ Team    Reuse: Sol (lead), Otto (review), Kit (pricing) · Sceptic: "the returning │
│         customer" (another model family) · Hire: none                             │
│ Steps   1 Copy ── 2 Images ─┬─ 4 Email draft (held) ── 5 QA                       │
│                   3 Video ──┘                                                      │
│ Proof   Copy follows the style guide (artifact) · Prices match Shopify (metric,    │
│         asOf) · Video ≤ 15 s (artifact)                                            │
│ Time    Ready Wed 16:00 · about 9–12 human-equivalent hours · 1 decision           │
│ At cap  ( ) stop   (•) raise a hand               [Approve] [Change…] [Ask Rosa]   │
└────────────────────────────────────────────────────────────────────────────────────┘
```

1. Luis drags Kit off step 5 and adds Bea as email reviewer. The card re-forecasts ($7–$12) and marks the change as a plan diff.
2. **Approve** binds to this plan version and reserves the upper bound ($12); the usage meter updates.
3. Rosa: *"Started. Sol will have first copy in about four minutes."* The Activity rail fills and desks change state.
4. Every later scope change arrives as a plan diff and marks the approvals it touches as stale.

### 6.4 Listen in and join a meeting (Dana)

1. The Northwind door plate reads "In session: positioning · no listeners." Dana presses **L**.
2. Within 2.5 s Morgan's 18-second catch-up starts; the stage opens in the side panel and the Now-playing bar appears.
3. Walt's line plays at Hero size; Juno and Lena turn toward him; captions run.
4. To steer Walt privately: select his seat, **W**, type, leave it **Quietly**.
5. To redirect everyone: hold **Space**. Juno ducks in ~120 ms, stops by 300 ms, and heads turn to Dana's seat. Juno replies and sends a plan diff; Dana accepts it on the stage.
6. **Esc**: voicing stops within a line and the meeting runs on at machine speed; Morgan's thread gets a one-line summary.

**Failure**: a line fails to voice → it plays as a caption marked "(not voiced)", and the next line voices normally.

### 6.5 Review deliverables (Dana, Wednesday 10:40)

1. The Brief said the deck is ready; the Inbox holds "Review: Northwind proposal deck v3".
2. **Open** shows the viewer: a slide strip; a lineage rail (Lena made it in step 4 from these cards; Walt reviewed, *approve* with one note); the evidence checklist with 2 claims badged **unverified**.
3. She taps one ("Sell-through lift 18%: no source found") and asks Pax from the viewer: *"Find a source or cut it."* That is a request within the step, not a plan change.
4. She edits slide 7's headline inline; Lena's track record logs it as "edited", with edit distance.
5. With evidence complete, **Accept** turns criteria green, adds to résumés and closes the step. (**Request changes** would open a revision-direction box [BB].)
6. **Send** is an effect, so it raises a hand showing recipients and "no undo". She approves **Once**; the receipt chip appears: "Sent · rcpt_9310 · 10:52".

### 6.6 Set up an automation (Dana)

1. In Talk: *"Every Monday at 8, have Marcus refresh Harbor's HubSpot numbers and put the headline in my Brief. Tell me if ROAS drops below 3."*
2. Morgan drafts a card: "Mondays 08:00 (America/Chicago) → Marcus refreshes Harbor from HubSpot → one line in the Brief · alert if ROAS < 3.0". Creating an automation is tier 1, so it asks first [BB `system` tool].
3. The card offers **Dry run** (v1, free on Mock) and **Create**. Created, it appears in Harbor's Automations tab with its next fire time.
4. Monday 08:00: if Dana is offline, Marcus's lamp lights (Night Shift); the run records a receipt of the sync; the Brief says "Harbor: ROAS 3.4 as of 08:02 (HubSpot)."
5. When ROAS dips to 2.9, the edge-triggered check fires once [BB watch semantics]; the judge rates it "matters now", so it becomes an Inbox card and spends one of today's pings.

### 6.7 Open a customer-facing front door (Dana, v1)

1. From Harbor: **New front door** → Marcus; purpose "Questions about this proposal"; audience "Harbor's CMO and CFO"; outcome "Clarify pricing, route requests to Dana".
2. **Knowledge**: she ticks the proposal, two case studies and the pricing FAQ. The preview shows what a guest can learn and what they never can: "other clients, internal verdicts, Marcus's memory".
3. **Tools**: *request a callback* only. **Consent**: transcripts kept only with consent, 90 days. **Limits**: 20 min a session, 60 a day.
4. **Preview as guest** on her phone: she asks *"Can you do 7%?"* and hears the escalation line.
5. **Publish** (explicit); the share dialog gives her the QR code and link for her email.
6. Thursday 23:10 the CMO talks to Marcus; Friday's Brief carries the escalation; Dana approves Morgan's follow-up project from the Inbox. **Turn off** would end any live session.

### 6.8 Recover from a failed run (Luis)

1. Sol's 15-second cut fails twice; the second attempt hits the 20-minute video ceiling. Sol's desk turns **Blocked**: "Blocked: video render failed twice."
2. The Activity rail row persists: "Guji cut: the video service timed out twice. $0.40 spent on the attempts."
3. The deadline is tomorrow, so Rosa files an Inbox card rather than a push: "Choose: **Retry tonight** · **Use the storyboard as a still ad** · **Drop the video** (forecast −$3)". Sibling steps keep running [BB `InputRequired`].
4. **Retry tonight**: it runs at 02:00 with Sol's lamp lit; the Brief says "Guji cut delivered at 02:14", artifact attached.
5. **Mid-send restart**: the rail reads "Paused 9 of 23 sends while the office restarted · checking the email provider · resumed at 10 · 23 of 23 sent, no duplicates." No owner action (PRODUCT §5.7).
6. **Expired connector**: "Blocked: HubSpot needs sign-in"; the card's one button, **Reconnect**, runs OAuth and resumes the step.
7. **Everyone stop** fences every job within 30 s and holds pending effects; resuming needs an on-screen confirmation.

---

## 7. Multimodal input and output

### 7.1 Input

| Modality | Entry points | What the owner sees | Scope and privacy | Ph |
|---|---|---|---|---|
| **Files** (PDF, DOCX, XLSX, CSV/TSV, JSON, text, images, audio) | Drop anywhere (full-window veil), paste, attach | A card per file with progress, then a summary; audio becomes a transcript | Drop target (§7.2) | MVP |
| **Folder** | "Add a folder" in a project | A tree showing skip reasons ("inside node_modules"), a token-budget footer, a re-sync diff ("3 added, 1 changed") [OC] | Project; only ticked files leave the device | v1 |
| **Camera (Show)** | **Show**; phone camera | Self-view (mirrored for the owner only); cadence 5/10/30/60 s or **Now**; frames become cards that upgrade when described [OC] | Truthful privacy dot; raw frames kept 24 h unless pinned; consent per coworker | MVP |
| **Screen (Share)** | **Share** | The same strip; frames are differenced so only changes are sent [NEW] | In meetings (v1) only the addressed coworker gets frames; others get one description | MVP; meetings v1 |
| **Dictation** | Any composer's mic | Interim text above the input; lands in the composer, never auto-sent [OC] | The thread's | MVP |
| **Video in** | Drop a clip | Up to 12 key frames extracted on the device, as a filmstrip card | As files | MVP |

### 7.2 The drop target is the scope

| Dropped on | Scope | Card reads |
|---|---|---|
| Talk or the Chief of Staff bubble | The Chief of Staff routes it to one step | "Brand guide · Morgan will route" |
| A desk (Floor or desk stage) | That coworker only | "Brand guide · Lena only" |
| A room wall or door plate | The project team | "Brand guide · Northwind team" |
| A project's Deliverables tab | Project inputs (`inbox/`) | "Brand guide · Northwind files" |
| The Handbook | Workspace or client, after approval | "Brand guide · Brightline (pending)" |

Cards show kind, scope, source, `asOf` and, for large items, estimated cost; each is removable until used, and every agent turn lists the cards it used.

### 7.3 Output

| Kind | How it arrives | Viewer | Ph |
|---|---|---|---|
| **Documents** (PPTX, DOCX, XLSX, Markdown) | A background render, rough version first where possible [PG sketch ‖ full] | Slide strip or pages, lineage rail, evidence checklist, versions, download; Markdown with `action:` buttons (Approve, Ask Marcus) [OC] | MVP |
| **Images** | A grid of variants; identity-preserving edits for portraits [PG] | Compare, pick, edit, pin to wall | MVP |
| **Video** | A storyboard frame in ~20 s, the clip in ~2 min, progress in the Activity rail | Player with captions; still extraction | MVP (flagged) |
| **Apps** | A first version in ~20 s; the full one *offered* ("Play the full version"), never swapped under your hands; bounded, visible self-repair [PG] | Sandboxed panel, no network; pin to wall | v1 |
| **Audio briefings** | The Brief, and **Explain it to me** on any deliverable: a ≤ 90 s spoken walkthrough by its maker, voiced on request [NEW] | Brief player; replay | MVP |

Every deliverable carries lineage (coworker, step, cards, reviewer, evidence) and versions, and is delivered once, to the thread that asked [OC].

---

## 8. Notifications, proactivity and the attention budget

### 8.1 The budget

Owner attention is spent in three default places: the Brief, the Inbox sitting and the Weekly Review (PRODUCT §3.2). Anything else must earn an interruption:
- **Interruption budget**: 0, 6 or 30 unprompted pings a day, each filtered by an LLM judge ("does this matter now?") [BB].
- **Urgency ladder**: digest → Inbox → push → live; each step up needs the judge's "matters now" and budget left.
- **Quiet hours**: only *always wake me* classes (statutory deadlines) break them.
- **Handoff card**: whenever the owner is pulled in live, 15 s spoken and shown: who, what, why now, recommendation, options.

### 8.2 Channels

| Channel | Used for | Never for | Ph |
|---|---|---|---|
| **Brief** | Everything since the last Brief, ranked by who needs the owner, deadline, dollars | Anything that cannot cite an event | MVP |
| **Inbox card** | Decisions and requested results (Updates are uncounted) | Status noise | MVP |
| **In-app toast** | A requested result landing while the owner is elsewhere, with **Open** [OC] | Unrequested news | MVP |
| **Desktop notification** | A raised hand that climbed the ladder, only while the tab is hidden, de-duplicated by tag [BB `notify.js`] | Updates | MVP |
| **Mobile push** | Rung 3 of the ladder | Updates, promotions, Handbook diffs | v1 |
| **Live** (handoff card on a desk stage) | Rung 4: needed in a room now | Anything that can wait | MVP |

### 8.3 Copy and batching

- Every notification leads with a verb, names asker and stake, and gives the time it takes: "Approve: Hale's price for Lotus Kitchen · signs today · about 1 min".
- Raised hands within 15 minutes of an Inbox sitting wait for it. A second ping about the same item is never sent; it escalates or waits.
- **Not this again** on any ping becomes a standing-rule proposal that teaches the judge.

### 8.4 Visible proactivity

Unprompted, Morgan may add one "worth knowing" line to the Brief and (v1) propose promotions, playbooks from repeated plans, and weekly Handbook diffs. It never starts paid work, sends anything or changes autonomy without a decision. Settings shows "Pings today: 2 of 6"; the Weekly Review reports pings used and **owner minutes per accepted deliverable** (the counter-metric), so noise has a number.

---

## 9. Mobile, accessibility and internationalization

### 9.1 Mobile

The MVP phone experience is a web app; the native shell (push, background mic) is v1.

```
┌─────────────────────────────┐
│ Brightline   Inbox 2  Stop  │
│ [face] Morgan · listening   │  76 px bubble, grows while speaking [OC]
│ Patch in:                   │
│  ● Northwind · Walt         │  one tap = audio-only listening
│  ○ Harbor · quiet           │
│      ┌─────────────────┐    │
│      │  HOLD TO TALK   │    │  walkie-talkie
│      └─────────────────┘    │
│ Talk · Floor · Inbox · More │
└─────────────────────────────┘
```

- **Walkie-talkie**: hold to talk to the Chief of Staff. "Patch me into Northwind" plays the room audio-only, with lock-screen metadata ("Northwind · Walt speaking") and controls mapped to mute and leave. Decisions over the voice cap wait in the Inbox.
- The **Floor opens as the Directory**; a desk opens a one-screen stage with the face on top and controls clear of it [PG].
- **Inbox sitting** is a card stack; swipe means only *Later*, never approve; grant buttons ≥ 44 px.
- The **Brief** plays from the lock screen at 1–2×. No horizontal scroll at 375 px; safe areas respected [OC].

### 9.2 Accessibility

| Need | Provision |
|---|---|
| **Screen readers** | The Directory is the primary structure: rows read "name, role, state, label". `aria-live="polite"` announces only raised hands and meeting speaker changes, at most one per 5 s. Plan DAGs have a list view. |
| **Keyboard** | Arrows, **Enter**, **Esc**, **L** listen, **W** whisper, hold **Space** take the floor, **R** raise hand, **H** Inbox, **⌘K**, **[ ]** replay lines, **J/K** Inbox, numbers for grants. **?** lists all; all remappable. |
| **Deaf and hard of hearing** | Captions always on in rooms, Brief and replays; CC transcript; every earcon has a visual flash; walkie-talkie has text equivalents |
| **Low vision** | 200% text without loss; state never by colour alone; a high-contrast theme; no meaning carried only by a face |
| **Motion, speech** | Reduced motion per §4.6; anything you can say, you can type |
| **Cognitive load** | **Just tell me** mode; still-portrait mode; one decision per card in a sitting |
| **Targets** | ≥ 44 px; no emoji in chrome; focus rings always visible [OC] |

### 9.3 Internationalization

- **Text**: any language the model supports; externalized UI strings; locale-aware dates, numbers and times; every schedule in the workspace timezone [T18].
- **Voice**: English first in the MVP. v1 adds Spanish, French, German and Portuguese with language-tagged STT and TTS and viseme tables from TTS alignment. Other languages lip-sync from the spectrum and energy tiers, honest but approximate, and the desk inspector says so.
- **Per coworker**: voice language is part of the voice profile; in v1 a front door greets in the guest's browser language when the coworker has that voice.
- **Layout**: right-to-left mirrors navigation and the Floor's reading order, not the faces.
- **Money** is priced in US dollars (PRODUCT §10); a display currency is an open question.

---

## 10. Visual and sonic identity direction

### 10.1 The idea: "a well-run office, lit by the work"

Headcount should feel like a calm, capable office seen through glass, not a sci-fi control room. Light comes from work: a desk lamp for the Night Shift, a warm ring around a speaker, a raised hand. When nothing happens, nothing glows. Four owned motifs: the **lamp**, the **hand**, the **door plate** and the **receipt**.

### 10.2 Colour and theme tokens

| Token | Light ("day") | Dark ("night shift") | Used for |
|---|---|---|---|
| `--surface` | #F7F5F0 (paper) | #111316 | Background |
| `--panel` | #FFFFFF | #1A1D22 | Cards, stages |
| `--ink` / `--muted` | #1C1E21 / #6B6F76 | #ECEAE4 / #9BA0A8 | Text, secondary text |
| `--lamp` | #E8A33D | #F2B450 | Night Shift, speaker ring, primary action |
| `--hand` | #3D6FE8 | #7EA2FF | Raised hands, "needs you" |
| `--blocked` | #C2410C | #F08A4B | Blocked, errors |
| `--proof` | #2F7D4F | #6CC08E | Linked evidence, receipts |
| `--unverified` | #8A6D00 | #E0C050 | The "unverified" badge |

Light and dark follow the system by default [OC]; BB and PG were dark-only. Guest stages keep PG's glass-and-prism look, where the face dominates.

### 10.3 State language

Each state has a ring colour, a glyph and words. Glyphs: hand (raised hand), lamp (Night Shift), dots (thinking), book (working), arrow (handing off), triangle (blocked), waveform (speaking), ear (listening), check (delivered), reused in the Directory, captions and notifications.

### 10.4 Type and layout

One humanist sans for UI (Inter, as PG, or an equivalent with tabular figures) and a readable serif for long-form deliverable previews and Handbook pages. Money always uses tabular figures and "$". An 8 px grid; 24 px radius on stages, 12 px on cards. On any stage, the face gets the most space.

### 10.5 Portraits: "one staff photo shoot"

Every face in a workspace shares a house style, so the office reads as one company: 3:4; a front-facing single adult with the face unobstructed and lips relaxed and closed, so it warps cleanly [PG prefix]; the same soft key light for everyone; a neutral backdrop in the pack's tone; clothes varied by role. Casting is diverse by default. No real likeness except the v1 owner-likeness door, with consent. Scepticism is a badge, not a scowl.

### 10.6 Motion

Nothing moves without a cause (X3). State change 200 ms; head yaw 400 ms; hero lift 250 ms; hand-off arc 1.2 s; a calm ease-out. Idle faces loop nothing beyond blinks and sway. Reduced motion removes everything but lip sync.

### 10.7 Sound

- **Voices are the brand.** Unique per workspace; cast so roles are recognisable by ear (the sceptic dry and lower, the Chief of Staff warm and mid-paced); speed 0.85–1.15; expressive tags (pause, laugh, soft) used sparingly and never on Brief decisions [PG]. No voice cloning, ever.
- **Earcons (MVP)**, minimal and optional, each with a visual equivalent: a two-note rising chime for a raised hand (only when the ladder allows); a soft paper tick for a receipt; a short click on patching in or leaving; a 1.2 s lamp-switch sting to open the Brief and a single low tone to close it.
- **Loudness**: voices normalized to one level so no coworker is louder than another; earcons 12 dB below speech; owner speech ducks everything by 18 dB.
- **v2**: room tone (a quiet texture following each room's event rate) and spatial panning by desk.

### 10.8 Copy voice

Plain, short, verb-first. No model names, no exclamation marks. A failure is one sentence with its fix. Money in dollars, with ranges. The AI badge text is fixed: "AI coworker · {Business}".

---

## Appendix A: Questions this design raises for PRODUCT.md

1. **Push in the MVP.** The urgency ladder (MVP mechanism, §5.7, §9.7) includes push; P11 puts push in v1. Assumed here: MVP rung 3 is a desktop notification; mobile push is v1.
2. **Barge-in from a locked phone.** §5.5 (MVP) has Dana interrupt the Brief by voice while driving, but the background mic is v1 and iOS web cannot hold a locked mic. Assumed here: MVP barge-in needs the screen on.
3. **The 2-second cause rule for long states.** *Thinking* can last 18 s. Read here as "emitted within 2 s of its cause, refreshed by heartbeats"; faces still after 60 s without one.
4. **"Raise hand" names two things**: a coworker's pending decision and the owner's meeting control (§5.3). Consider renaming the owner's control **Ask for the floor**.
5. **Coworkers on several projects**: PRODUCT is silent on desk placement. Chosen here: one desk in the active step's pod, outlined tokens elsewhere.
6. **Listening while navigating (MVP)**: picture-in-picture is v1; this design adds an audio-only Now-playing bar. Confirm scope.
7. **Hands-free mode** is not in PRODUCT; limited here to Talk, desk stages and the Brief, never rooms.
8. **Everyone stop by voice** is allowed here; resuming still needs the screen.
9. **Display currency** for owners outside the US.
