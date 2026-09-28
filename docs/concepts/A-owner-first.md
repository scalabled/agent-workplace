# Righthand

**One chief of staff. A whole staff behind them. Your day back.**

> Concept A, owner-first. It builds on the owner's three reference projects: biz-bot **[BB]**, oncloudnine **[OC]** and personagram-ai **[PG]**. **[NEW]** marks white space none of them covers. T-numbers refer to the tensions in `docs/research/capability-matrix.md` §5.

---

## 1. The big idea

Small-business owners don't want to manage AI agents. They want what a good chief of staff gives an executive: one person who knows the business, turns a sentence of intent into work, gets the right people moving, and comes back only with what needs the owner. That means decisions, not status updates.

Righthand is that chief of staff, plus the staff behind them.

- **One point of contact.** The owner talks or types to one lead agent, their *Righthand*. It is rebuilt on every turn from the business's House Book and a live brief of the staff and engagements [BB `routerBot`/`routingBrief`].
- **Intent becomes an engagement.** The Righthand turns intent into *Engagements*: projects with a reviewed plan [BB].
- **A cast, not a bot.** It casts coworkers who each have a distinct face, voice and specialty [PG `inventCast`, BB `assemble`].
- **Work continues without the laptop.** Engagements run durably in the cloud while the laptop sleeps [BB plan engine hosted in PG-style Durable Objects].
- **Everything folds into the owner's week.** Results come back through a rhythm the owner already keeps: a spoken morning brief, a deck of decisions and a Friday review.

The product is organised around the owner's **attention**, the scarcest resource in a 5–50 person business. Three design laws follow.

1. **Decisions, not dashboards.** Everything the staff does resolves into a decision to make, an outcome to look at, or nothing because it's handled. The product never shows a status without a next verb [BB `goalBoard`].
2. **Trust is earned per action, not granted per agent.** Autonomy grows from a measured track record, and every real-world effect carries a receipt [BB grants + NEW track record + wired BB `effect`/`receipt`].
3. **Faces and voices exist to save time.** A raised hand shows who needs you from across the Floor. A spoken brief runs the business from the car. Listening in at 1.5× replaces reading a 40-message thread. Audio never plays unless the owner asked for it.

---

## 2. Target owners

| | **Dana**, agency founder | **Luis**, e-commerce operator | **Priya**, professional services |
|---|---|---|---|
| **Business** | 14-person brand and content agency, 9 retainers | Direct-to-consumer coffee on Shopify, $2.4M/yr, 3 staff and a third-party logistics (3PL) partner | 6-person bookkeeping and tax practice, 80 clients |
| **Hires AI staff for** | Proposals, weekly client reports, content calendars, pitch prep, competitor watch | Reorder planning, launch kits (copy, images, video), support drafts, weekly ads and P&L, supplier email | Intake and engagement letters, document chasing, close-prep checklists, deadline radar, client explainers |
| **Systems (MCP)** | Google Workspace, HubSpot, Asana, Canva | Shopify, Gmail, QuickBooks, Meta Ads, 3PL portal | QuickBooks/Xero, Gmail, Calendly, document portal |
| **Biggest fear** | Off-brand work reaching a client | Money moving wrongly (purchase orders, refunds, ads) | A confidentiality breach or a missed statutory deadline |
| **A win looks like** | A proposal out in a day, not a week | A launch without the 11 pm scramble | Every client's close done by the 5th |

The owners differ most in what they will let go of. Righthand doesn't choose an autonomy level for them. It measures, proposes, and lets each owner move their own dial (§7).

---

## 3. Core concepts and vocabulary

| Term | Meaning | Builds on |
|---|---|---|
| **Righthand** | The lead agent. One per workspace, named and styled by the owner, undeletable, rebuilt each turn from the House Book plus the live roster and engagements. The same agent in text, realtime voice and meetings. | [BB] `routerBot`, `routingBrief`; [PG] voice-front/brain-back; [NEW] one brain across modes (T6) |
| **House Book** | The business's context: `company.md` (offer, customers, voice, rules), a knowledge graph of customers, products, people and KPIs, and standing rules. Editable as Markdown; every recall shows as a chip. | [BB] Principal, Markdown memory; [OC] graph, hybrid recall, ContextCard; [NEW] connector-fed business graph |
| **Coworker** | A persona with role, skills, tools, model policy, budget, voice, face and track record. It speaks in the house voice and differs by specialty. | [PG] doppelganger, `assignVoice`; [BB] Principal/instance layering |
| **Engagement** | A project: objective, success criteria, team, reviewed plan (a DAG), spend envelope, autonomy, deliverables and a room. | [BB] project model, `executePlan` |
| **Rhythm** | The owner's recurring touchpoints (Brief, Deck, Wrap, Friday Review, Month-end Board) in the owner's timezone. | [BB] triggers; [NEW] owner rhythm, T18 |
| **Raised hand** | A pending decision: a gesture on the coworker's avatar plus a card in the Deck. | [BB] `InputRequired`, Inbox; [NEW] gesture |
| **Decision Deck** | Pending decisions batched for one sitting, cleared by tap, keyboard or voice. | [BB] decision cards, graded grants; [NEW] batching, voice |
| **Autonomy dial** | Four positions (Ask, Propose, Act & report, Act quietly), set per action class. | [BB] grant kinds and scopes; [NEW] per-class dial |
| **Track record** | Per coworker and action class: approved as-is, edited, declined, reversed. Drives promotion and demotion. | [BB] `buildAudit`; [NEW] trust ledger |
| **Spend envelope** | Budget per engagement, day and workspace, forecast before approval and reserved before each call. | [BB] ledger reservations; [NEW] per-model `rates` |
| **Receipt** | Proof of an external effect, with idempotency key, approver and undo path. | [BB] `effect`/`receipt` (unwired) → [NEW] wired |
| **The Floor** | A spatial office: desks with live avatar tiles, a room per engagement, edges for delegations in flight. Any desk opens a 1:1. A list view is always available. | [BB] team graph; [PG] stage; [NEW] spatial office |
| **Listen in · Whisper · Take the floor** | Hear a room voiced live; send a private note to one agent; interrupt and speak. | [PG] group engine, `next:user`; [BB] `transcriptToMessages`; [NEW] observers, arbiter |
| **Guest door** | A purpose-scoped link where a customer talks to one coworker. | [PG] Personagram links, consent |
| **Business pack** | An industry starter: personas with faces and voices, playbooks, connectors, and rhythm and autonomy defaults. | [BB] templates; [PG] casting, onboarding |
| **Playbook** | A recurring workflow promoted from a successful engagement. It must pass golden evaluations before running on a schedule. | [BB] `catalog-store.js` golden-eval gate |

---

## 4. The owner's rhythm

Righthand runs on the owner's clock. Each ritual is a trigger in the owner's `WorkspaceDO`, fired by Durable Object alarms in the owner's timezone [BB triggers, T18] and gated by the interruption budget [BB proactivity dial, annoyance budget].

| When | Ritual | Modality | What the owner does | Output |
|---|---|---|---|---|
| 7:30 | **Morning Brief** | Spoken 3–5 min (audio file or live voice) plus cards | Listens, interrupts, decides by voice | Decisions, delegations, today's plan |
| Anytime | **Delegate** | Voice, text, screen, camera or file | One sentence of intent | An engagement with plan and forecast |
| 12:30, 16:30 | **Decision Deck** | Card stack (mobile) or keyboard | Clears 5–15 cards in under 5 min | Grants, answers, approvals |
| When warranted | **Escalation** | Push, then a live 1:1 | Joins for ~60 seconds | Unblocked work |
| 18:00 | **Evening Wrap** | One screen, optional 60-s audio | Skims | Tomorrow's queue |
| Fri 15:00 | **Friday Review** | Replayable meeting | Listens live or later, approves next week | Minutes → tasks; Time-back report |
| Month start | **Month-end Board** | Document and short meeting | Reviews KPIs, spend, promotions | Budget and autonomy changes |

The loop closes by design: Brief → delegations → background work → Deck → Wrap → the next Brief. Every Brief opens with what changed since the last one, replayed from each engagement's event bus with `?since` [BB].

---

## 5. Signature experiences

### 5.1 The 7:40 Brief (Luis, driving to the roastery)

Luis's phone plays Rosa, his Righthand: "Morning. Three things need you, two are handled, one's a heads-up. First, Kit wants to reorder the Ethiopia Guji: 40 bags from Tadesse, $6,120, arriving the 22nd. That covers the launch at current sell-through plus 20%. Approve?"

Luis cuts in: "What's the sell-through based on?" Rosa stops mid-sentence; generation-tagged cancel drops her stale audio [PG]. She answers from the Shopify card Kit used ("last 28 days, 1.8 bags a day"), then offers: "Approve once, allow reorders under $7k from this supplier for 30 days, or hold?"

"Approve. Just this one." A receipt appears: purchase-order draft sent to Tadesse via Gmail, idempotency key, approver Luis, 7:41.

**How it works.** A trigger composes the Brief at 7:10. It replays event buses since the last Brief, pulls connector changes, and ranks items by needs-the-owner, deadline and money at stake, each phrased verb-first [BB `goalBoard`]. The voice session is voice-front/brain-back: a realtime model handles turn-taking and barge-in, while every answer and tool call goes to the server brain and streams back as sentence chunks [PG `SentenceChunker`, T6]. A voice decision creates the same structured grant as a tap [BB grants].

```json
{ "type": "brief_item", "rank": 1, "kind": "approval", "from": "kit",
  "engagement": "eng_launch_coldbrew", "verb": "Approve reorder",
  "stake": {"usd": 6120},
  "evidence": ["card:shopify_sellthrough_28d", "card:sol_launch_forecast"],
  "options": ["approve_once", "grant:30d:supplier=tadesse:max_usd=7000", "hold"] }
```

### 5.2 One sentence, one engagement (Dana, between calls)

Dana: "Northwind invited us to pitch their spring campaign. Deadline Thursday. Build the proposal." Theo, her Righthand, asks at most two questions ("Budget range? Anyone from our side leading?"), following BB's Simple-mode delegation rule.

Forty seconds later Theo shows an Engagement card:
- **Criteria.** A 12-slide deck and one-page budget in the house template, reviewed by Dana Wednesday 4 pm.
- **Team.** Marcus (strategist), Juno (copy), Pax (research) and Ines, the sceptic who "speaks for the client who isn't in the room" [BB `assemble`]. Each has a distinct face and voice [PG `inventCast`/`assignVoice`].
- **Plan.** A six-task DAG with an owner and reviewer per task [BB plan].
- **Forecast.** *$18–31, done Wednesday 11 am, one decision expected from you (pricing tier)* [NEW, from per-model rates].

Dana says "go." Theo confirms in one sentence [OC "I started it"]. A rough competitor grid appears within three minutes and is replaced by the full version when ready [PG sketch-then-full].

### 5.3 Walk the Floor, listen in, whisper (Dana, at lunch)

Dana opens the Floor. Pax's tile shows *thinking*, an eyes-down loop driven by `turn` and `tool` events [BB activity bus]. Juno's ring pulses as she hands off to Marcus, and the edge between them animates [BB team graph]. The Northwind room glows: Marcus, Juno and Ines are debating [BB `/discuss`].

She clicks in. Theo gives a 20-second spoken catch-up ("They agree on 'slow mornings'; Ines thinks the budget tier is too high"), then the live tail plays in their voices. The agents converse in text at full speed; the RoomDO voices only what an observer hears, three lines ahead, and stores it for replay [T8; PG writer ‖ voicer ‖ player]. Only the speaker's face lip-syncs [PG group stage].

Dana whispers to Ines: "Push for the mid tier with a pilot." The note enters only Ines's view of the transcript as `[Private note from Dana]` [BB `transcriptToMessages` + NEW whisper]. Then Dana taps **Take the floor**; the arbiter lets the current sentence finish and yields [NEW owner-priority arbiter; PG `next:user`]. "Mid tier, eight-week pilot, and put the Hartwell case study on slide 4." The minutes update and the decision is recorded.

On her way out she opens Pax's desk for a quick 1:1. A distilled summary goes to Theo afterwards, so the Righthand never loses the thread [PG `distill`].

### 5.4 The raised hand and the urgency ladder (Priya, month-end)

Hale, Priya's intake coworker, is drafting an engagement letter for a restaurant that wants monthly payroll, which is outside the standard package. Hale's avatar raises its hand, and a card joins the Deck: "Price monthly payroll for Lotus Kitchen? I suggest $180/month, based on two comparable clients" [BB `InputRequired` + NEW gesture].

The client's deadline is today and Priya is in back-to-back calls, so the **urgency ladder** (digest → Deck → push → live) escalates [NEW]. Wren, her Righthand, runs the judge check ("matters now") [BB `judge()`] and sends one push within the day's budget [BB annoyance budget]. Priya taps it between calls and lands in a live stage with Hale [PG immersive stage], who opens with a 15-second **handoff card**, spoken and shown: who, what, why now, recommendation, options [NEW].

"Do $195, and add it to the standard menu." Forty-five seconds. The letter goes out only after Priya approves the send, because her dial has client-facing external send on *Ask*.

### 5.5 Show, don't type (Luis, at the roastery)

Luis points his camera at a damaged pallet and a 3PL receiving slip: "Figure out what happened and get it fixed." The frames become ContextCards that appear at once and upgrade when their vision descriptions land; the privacy dot is truthful [OC ContextCard, capture pipeline]. Rosa routes the cards, not just a task, to two coworkers [NEW]:
- **Kit (operations)** matches the slip against the 3PL portal via MCP, finds 6 damaged bags, drafts a claim with photos, and raises a hand only for the send.
- **Bea (customer care)** maps the affected pre-orders and drafts delay notes to 11 customers: one decision, one receipt per email.

Later Luis shares his screen on Meta Ads Manager: "Why did cost per acquisition jump yesterday?" Frames are sampled with differencing and single-flight vision calls [OC `SingleFlight` + NEW differencing]. Otto (finance and ads) answers with a chart.

### 5.6 Friday Review on the commute (Dana)

At 3 pm Friday the Review room convenes. Theo chairs, each engagement lead speaks for 60–90 seconds from their own context, and Ines challenges one thing per engagement. This is BB's `/discuss` protocol with real per-agent turns under a lead moderator (T9). Dana is with a client.

At 6:10 pm she plays the replay in the car at 1.5×, with a chapter per engagement [PG exact replay + NEW chapters]. At "Northwind" she says "skip". At "Hartwell retainer" she asks, "Why is this over budget?"; the replay pauses, Theo answers live, and it resumes. Action items become next week's tasks [NEW]. The **Time-back report** closes it: "31 tasks done, about 26 hours saved, $214 spent, 9 decisions, median 3 hours to resolve."

### 5.7 Earning autonomy (Luis, week 6)

At the Month-end Board, Rosa proposes: "Sol drafted 24 Instagram posts in five weeks. You approved 22 as-is, lightly edited 2, reversed none. Let Sol publish posts that use approved photos and no discounts without asking? You'd see them in the Wrap and could pull any within an hour."

The proposal comes from Sol's track record [NEW over BB `buildAudit`], scoped as a bounded standing grant (`publish:instagram`, `assets:approved_library`, `no_discount_codes`) [BB grant scopes], and is itself a decision. Luis agrees. Two weeks later a post links a sold-out product and Luis pulls it. The reversal automatically moves Sol's `publish` class back to *Propose*, and Rosa reports why in the next Brief [NEW].

### 5.8 The guest door (Priya)

The "Book a discovery call" button on Priya's site opens a **guest door** to Hale: his face and voice, a permanent AI badge, and a narrow brief (explain services, collect details, book via Calendly) [PG purpose-scoped links, disclosure, consent]. Hale has no tool except booking and no client memory [PG role-scoped tools re-checked at dispatch]. A consented transcript lands in the Deck: "New lead: Lotus Kitchen, 14 staff, wants payroll plus books." That's how 5.4 began.

---

## 6. Onboarding: the first hour

**Targets:** a first real outcome within 60 minutes, and a House Book good enough that tomorrow's first Brief is useful.

1. **Sign in, pick a pack** (2 min). Google OAuth [PG]. Agency, Store, Practice or General seeds personas with faces and voices, playbooks, suggested connectors, and rhythm and autonomy defaults [BB templates + PG casting].
2. **Meet your Righthand** (3 min). Pick a face (generate, upload or choose), voice and name. Generated portraits use PG's warp-friendly prefix plus a landmark job; voices are validated against the provider catalogue [PG]. The greeting is spoken and recorded as the first turn [PG lesson 4.6].
3. **Tell me about the business** (15 min). A spoken or typed interview with PG's discipline: one question at a time, never re-ask, never request passwords or financial identifiers, with live "What I've learned" chips. Meanwhile the owner pastes the website URL (SSRF-safe fetch [BB]) and drops in price sheets, past proposals or a brand guide [OC `FileProcessor`, PG `unpdf`/`mammoth`]. The result is a draft `company.md` and first graph entities, each a card to approve or edit [OC extraction, PG draft → approve, NEW business graph].
4. **Connect tools** (10 min). OAuth 2.1 with tokens in a server-side vault [NEW; OAuth is docs-only in BB]. Connectors start read-only; write scopes are requested at first need, as a Deck card.
5. **Rhythm and guardrails** (5 min). Brief time and timezone, interruption budget (default *quiet*, 6 pings/day [BB]), a monthly spend cap, and the pack's dial presets (Practice: external send on *Ask*; Store: small reorders on *Propose*).
6. **First delegation, live** (20 min). The Righthand proposes three starters drawn from what it just learned ("Draft follow-ups for the three pending proposals you mentioned") [BB starters; NEW]. The owner picks one and watches the Floor fill.

Throughout, no model is called on empty input [PG intake guards], and everything learned stays editable as Markdown [BB].

---

## 7. How trust is earned

### 7.1 The autonomy dial

Autonomy is set per **action class**, because the owner's risk tolerance is about *what* happens, not *who* does it.

| Action class | Ask | Propose | Act & report | Act quietly |
|---|---|---|---|---|
| Research, analysis, internal drafts | allowed | allowed | **default** | allowed |
| Internal writes (CRM notes, tasks, docs) | allowed | **default** | allowed | allowed |
| External send (email, DM, customer reply) | **default** | allowed | after promotion | never |
| Publish (social, site, listing) | allowed | **default** | after promotion | never |
| Spend (purchase orders, refunds, ads) | **default** | up to a cap | up to a cap, after promotion | never |
| Identity & access (logins, connectors, grants) | **always** | never | never | never |

*Ask*: ask before working. *Propose*: do the work, hold the effect for approval. *Act & report*: the effect happens and shows in the Wrap, with undo where possible. *Act quietly*: logged only.

Each position compiles to BB grant kinds (once, task, session, hours, standing) and scopes such as tool, recipient, amount and domain [BB `approveAction` → `findGrant`]. The offering layer removes tools a persona may never use [PG role-scoped offering, T15]. Money and sending, which BB refuses by construction, become approval-gated and exactly-once.

### 7.2 Track record, promotion and demotion

Every approval outcome is recorded per coworker and action class:

```json
{ "coworker": "sol", "class": "publish:instagram", "window_days": 35,
  "proposed": 24, "approved_as_is": 22, "edited": 2,
  "declined": 0, "reversed": 0, "median_edit_distance": 0.04 }
```

When a class crosses the pack's threshold (for example ≥20 proposals, ≥90% as-is, no reversals in 30 days), the Righthand files a **promotion proposal** with explicit scope bounds. Any reversal or complaint demotes the class one step automatically and is reported in the next Brief. Each desk card shows the record ("Sol: 22 of 24 posts as-is"): a résumé built from receipts [NEW over BB `buildAudit`].

### 7.3 Money you can predict

- **Rates for every model**: `{input, output, cached, audio_sec, image, video_sec}`, discovered where providers expose pricing and hand-maintained otherwise [NEW; BB's missing `rates` break its budgets].
- **Forecast before approval**: plan tasks × historical tokens per activity type × rates, shown as a range [NEW].
- **Reservation before every call** against engagement, day and workspace envelopes, settled on actual usage; unknown cost is never counted as free [BB ledger].
- **Overrun raises a hand**: "Northwind is at $31 of $31; one more revision needs about $6. Raise by $10?" [BB budget decision].
- **Voice is metered** like tokens: listen-in minutes and voiced lines [NEW; PG's `usage_events` is never written].

### 7.4 Receipts, undo and the stop button

Every external effect runs through a ledger effect with an idempotency key, so a retry can't send two emails or two purchase orders [BB `effect`/`receipt`, NEW wiring]. A receipt stores action, target, payload hash, approver or grant, time, provider response and undo path; where none exists (a sent email), it says so. The Righthand's changes to the workspace itself (new coworkers, instructions, automations) go through BB's tiered `system` tool with audit and Undo.

Interruptions are rationed by the proactivity dial, the daily ping budget and a judge model [BB], plus the urgency ladder and quiet hours that only "always wake me" items can break (Priya's statutory deadlines). **Everyone stop** pauses all engagements, aborts in-flight calls through their AbortSignals and holds every effect [NEW; OC deadline-on-signal].

---

## 8. Feature set by pillar

| Pillar | What Righthand ships | Provenance |
|---|---|---|
| **P1 Lead orchestrator** | Righthand rebuilt each turn; one identity across text, voice and meetings; routing table `{route, taskKind, costClass, approvalRequired, runningText, finishedText, executor}` checked by CI; lead tools `post_to_engagement`, `steer`, `pause`, `rescope`, `convene`, `escalate`, `brief`. | [BB] `routerBot`, `materializeProject`; [OC] routing tables; [PG] voice-front/brain-back; [NEW] steering running work (fixes `bizbot.js:29`) |
| **P2 Personas** | One schema: identity, role, skills, tools, model policy, voice `{provider, voiceId, speed, fallbacks}`, face rig, expressions, hours, budget, track record. Hire by interview or auto-cast with a sceptic and unique voices; export as `AGENT.md`. | [PG] doppelganger, `inventCast`, `distill`; [BB] layering, `assemble`; [NEW] track record |
| **P3 Avatars** | Portrait lip sync on stage; Floor tiles at lower detail (256-px renderer on a shared scheduler, or static portrait plus speaking ring); face states from run events: listening, thinking, tool use, speaking, raised hand, handing off, blocked. | [PG] landmarks → fusion driver → strip-warp; [OC] `captureTap`, reduced motion; [BB] activity bus; [NEW] states, gesture, mixer |
| **P4 Workflow** | DAG plans with lead, co-owners and reviewers; work → review → revise with JSON verdicts; ProjectDO per engagement, RunDO per long job; business triggers (inbound email, form, payment, CRM stage, webhook); playbooks after golden evaluation. | [BB] `executePlan`, ledger, triggers, catalog; [PG] `BuilderDO` alarms; [OC] task store; [NEW] business triggers |
| **P5 Intra-agent comms** | `delegate`, `handoff`, `escalate` bus events; a room per engagement with per-agent transcript perspective; moderated meetings; listen in, whisper, take the floor; minutes → tasks. | [BB] `ask_bot`, `message_bot`, `/discuss`; [PG] stage, replay; [NEW] RoomDO observers, arbiter |
| **P6 Projects with plans** | Engagements with plan, envelope, autonomy, deliverables, room, journal and audit; a portfolio board with verb-first next actions; results delivered to their origin; client portals via guest doors. | [BB] project model, `goalBoard`; [OC] deliver-to-origin; [PG] share links; [NEW] portfolio |
| **P7 All LLM providers** | One registry: Anthropic, OpenAI, xAI, Gemini, Workers AI; Ollama and OpenAI-compatible servers via the Companion; Claude Code and Codex CLIs as engineer coworkers; Mock. Capability flags, preference orders, rates, discovery, per-persona model policy. | [OC] registry, three-dialect loop; [BB] adapters, CLI providers, Mock; [NEW] Gemini, rates |
| **P8 Multimodal** | Text; batch and streaming STT; per-coworker TTS with expressive tags and timings; server-mediated realtime for the Righthand (OpenAI, xAI, Gemini Live); vision on files, camera and screen; image generation and editing; video generation as jobs; embeddings; document, spreadsheet and deck output. | [OC] capture, media services; [PG] ConversationDO, TTS tags; [BB] embeddings, doc skills; [NEW] Gemini Live |
| **P9 Context & memory** | House Book in D1 plus Vectorize with keyword + vector + rank-fusion recall shown as chips; Markdown projections per workspace, engagement and coworker; reflection as diffs; distillation after every session; scoped memory permissions. | [OC] graph, recall; [BB] Markdown, reflection; [PG] budgeted briefs, distillation; [NEW] permissions |
| **P10 Tools / MCP / apps** | MCP over HTTP, SSE and stdio (Companion) with OAuth 2.1 and a vault; per-persona tool grants; sandboxed, self-repairing agent-built apps; governed send, publish and spend tools. | [OC] MCP client; [BB] catalog, `system` tool, apps SDK; [PG] canvas repair; [NEW] OAuth, effects |
| **P11 Navigation & UX** | Four surfaces: Talk, Floor (with list view), Deck, Engagements. A stage to join any agent, picture-in-picture speaker, audio mixer, command palette, mobile walkie-talkie mode. | [PG] stage, captions; [OC] chat surface, accessibility; [BB] Simple/Full modes; [NEW] Floor, mixer |
| **P12 Trust & governance** | Dial, track records, grants, receipts, envelopes; one audit log across model calls, tools and data egress; taint wrapping for MCP, search and delegated output; kill switch; retention. | [BB] grants, audit, taint; [PG] OAuth, scoped tools; [OC] policy table, SSRF; [NEW] dial, unified audit |
| **P13 Business** | Packs, guest doors, Stripe seats plus usage credits, metering, Time-back report, seats for human staff. | [PG] Stripe, onboarding; [BB] templates; [NEW] metering, ROI |
| **P14 Infrastructure** | Workers with WorkspaceDO, ProjectDO, RoomDO, RunDO, plus D1, R2, Vectorize and Queues; optional Companion; Mock-first tests, Wrangler harness with provider stubs, live canaries including TTS timing and multi-avatar load. | [PG] topology, harness; [BB] engine, Mock; [OC] preflight; [NEW] Queues, load tests |

---

## 9. Voice and avatars earn their place

1. **Audio only when asked for.** Nothing plays unless the owner pressed play, joined, or scheduled it. Agent traffic is text, voiced only when someone listens [T8].
2. **Summary before stream.** Joining a room starts with a catch-up of at most 20 seconds; replays open with chapters.
3. **Speed controls everywhere.** Briefs and replays at 1×–2×; each voice's own speed stays within 0.85–1.15 so it sounds natural [PG].
4. **Faces carry state.** A raised hand, eyes down while working, or a glance toward the coworker being handed off to tells the owner at a glance what a list needs scanning for [BB activity events → NEW face states].
5. **One voice at a time, owner first.** A floor arbiter per room; one AudioContext with per-agent analyser taps and ducking [NEW]; the owner's voice always wins [PG generation counters].
6. **Cheap by default, rich on focus.** The full lip-sync renderer runs only on the focused stage and for the current speaker [T10].
7. **Recognisable by ear.** Voices are unique per workspace [PG], with mapped fallbacks per provider so a coworker still sounds like themselves after a switch [NEW].
8. **Honest.** Guest doors always show an AI badge [PG]. Coworkers never claim an action without a receipt behind it [PG no-action-claims rule → NEW receipt check].

---

## 10. Outcomes and artifacts

| Dana (agency) | Luis (e-commerce) | Priya (practice) |
|---|---|---|
| Proposal decks (PPTX) with budget sheets | Launch kit: product copy, 12 images, a 15-second video, emails | Engagement letters from templates |
| Weekly client reports | Reorder plans and purchase orders, with receipts | Month-end close checklists with chase emails |
| Content calendars with drafted posts | Support replies and refund proposals | A deadline radar across 80 clients |
| Competitor-watch digests | Weekly P&L and ads dashboard (sandboxed app) | Plain-English client explainers, written and spoken |

Every artifact keeps its lineage: which coworker made it, from which plan step, with which context cards, reviewed by whom [BB artifact registry + OC chips]. Results return to where they were asked for: the Talk thread, the Deck or the Brief [OC deliver-to-origin].

The weekly **Time-back report** sums task-level time estimates from pack baselines, calibrated by the owner ("a first-draft proposal takes us 3 hours"). It reports hours saved, dollars spent, dollars per hour saved, decisions and their median latency, and promotions and demotions. It is the owner's reason to keep paying and the Righthand's evidence for what to delegate next [NEW].

---

## 11. What makes it compelling

- **It fits the week the owner already has.** Brief, triage, review, in the car, between calls and on Friday afternoon. Not another app to babysit.
- **One relationship, many hands.** The owner manages one chief of staff who knows the business, yet nothing is hidden: any desk can be visited, any room heard, any agent joined.
- **Delegation without anxiety.** Forecasts before, envelopes during, receipts after, and autonomy that grows only from evidence. Each owner's fear is answered by a mechanism, not a promise.
- **Listening beats reading.** A 90-second replay at 1.5× replaces a thread; a raised hand replaces a notification scroll.
- **The business gets smarter.** Sessions are distilled into the House Book, and successful engagements become playbooks after golden evaluation [BB]. The owner can read exactly what the Righthand knows.
- **No lock-in.** The best model per role, local models via the Companion when data must stay in the building, and no single voice vendor.

---

## 12. Risks and mitigations

| Risk | Why it's real | Mitigation |
|---|---|---|
| Voice and avatar costs spiral | TTS per line, realtime minutes, many tiles | Voice on demand, metered listen-in, low-detail tiles, spend envelopes [T8, T10] |
| Realtime voice is unproven | OC's transports never ran live; PG's OpenAI Live path isn't mocked end to end | Spike first; live canaries per provider; walkie-talkie fallback (STT → brain → TTS) |
| A wrong real-world action | Sent emails, orders and refunds can't be undone | *Ask* by default; exactly-once effects; receipts; promotion only from a record; kill switch |
| Notification fatigue | Many agents, many questions | Interruption budget, judge gate, Deck batching, urgency ladder |
| The Brief becomes noise | Owners stop listening by week two | Rank by owner-need, deadline and money; 5-minute cap; "skip"/"shorter" feedback; track listen-through |
| Uncanny or distracting avatars | Photoreal warping of generated faces | Warp-friendly prefix and landmark job [PG]; stylised option; reduced motion; small faces unless focused |
| Leaks between clients | Agencies and practices serve many clients | Per-engagement memory scopes, per-coworker permissions, taint wrapping, egress audit, local-model option |
| Agents claim work they didn't do | "Done" when it isn't | BB completion enforcement and `repairPlan`; no claim without a receipt; sceptic reviewer |
| Forecasts miss | New providers and activities | Ranges, not points; forecast-vs-actual at Month-end Board |

---

## 13. MVP slice

**Goal:** prove the owner's loop (delegate → durable work → decide in the Deck → hear the Brief) for one pack, with faces and voices that save time and real sends only behind approval.

**In:**
- **Pack:** Agency only; the Righthand plus 5 coworkers; 3 playbooks (proposal, weekly client report, content calendar).
- **Righthand:** text, plus realtime voice from one provider behind the voice-front/brain-back seam, with an STT → brain → TTS fallback. Tools: `delegate`, `steer`, `pause`, `convene`, `brief`.
- **Providers:** chat on Anthropic, OpenAI, xAI and Gemini, plus Mock, all with rates; one embeddings provider with Workers AI as fallback.
- **Engagements:** the BB plan engine in a ProjectDO with alarm keep-alive and JSON verdicts; reviewer and sceptic per team; RunDO for long jobs; cost forecasts.
- **Rhythm and Deck:** Morning Brief (audio and cards) with voice decisions, Evening Wrap, Friday Review as a replayable meeting; graded grants.
- **Floor:** list-first desk tiles (static portrait, speaking ring, raised hand, thinking); one stage with the PG renderer; listen in to one room at a time; whisper; take the floor.
- **House Book:** onboarding interview, files and URL; `company.md`, graph, recall chips.
- **Connectors:** Google Workspace (Gmail drafts, send only with approval; Calendar; Drive) and HubSpot (read, write notes), with OAuth and a vault.
- **Trust:** dial with Ask, Propose and Act & report; receipts and idempotency on email; kill switch; audit; track records shown (promotion manual).
- **Business:** Stripe with one plan plus usage credits; metering of tokens, audio seconds and renders; Time-back report v1.

**Next:** Store and Practice packs, guest doors, video generation, the full spatial Floor, automatic promotions, more business triggers, the Companion (local models, CLI coworkers, stdio MCP), a golden-evaluation UI and human staff seats.

**Spike before building:**
1. Realtime voice-front/brain-back live on two providers, with barge-in.
2. A RoomDO with 1 owner observer and 4 agents, voicing the live tail within 2 seconds of each line.
3. 12 tiles plus 1 stage at 60 fps on a mid-range laptop and an iPhone, sharing one AudioContext.
4. A ProjectDO running a 6-task plan through laptop sleep, with an exactly-once email effect.

**Success measures:** 80% of sign-ups reach a first outcome in under 60 minutes; at least 60% of decisions are resolved from the Brief or Deck; Brief listen-through is at least 70% in week 4; forecasts land within ±25% of actual on 80% of engagements; zero duplicate external effects.
