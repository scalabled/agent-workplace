# Judge scorecard: feasibility and reuse leverage

> **Lens.** How realistically each concept can be built on biz-bot **[BB]**, oncloudnine **[OC]** and personagram-ai **[PG]**, with every reuse claim checked against the research. Also: architectural soundness (latency, the cost of many avatars and voices, Durable Object topology), how realistic each MVP is, and risk.
> **Evidence base.** `docs/research/capability-matrix.md` (§1.6 corrections, §5 tensions T1–T18, §6 reuse plan with effort bands), the three `00-overview.md` reports, and targeted reads of `pg1`, `pg2`, `bb1`, `bb2`, `oc1` and `oc2`.
> **Concepts judged.** A *Righthand* (owner-first), B *Ninth Floor* (living office), C *Mainspring* (systems-first), D *Headcount* (category-defining).

---

## 0. Verdict

| Rank | Concept | Score (1–10) | One line under this lens |
|---|---|---|---|
| 1 | **C: Mainspring** | **8** | The soundest architecture. It makes the right cost decisions (no per-agent DO, the frequency rule), starts realtime voice on the one stack that has been tested end to end, and runs the correct spikes first. Its MVP is still optimistic, and it promises gaze the renderer cannot draw. |
| 2 | A: Righthand | 7 | Best cost posture and a real fallback for unproven realtime voice. Its signature layer (Rhythm, dial, Deck) sits on mature BB parts. The MVP is very broad and depends on connectors the references don't have. |
| 3 | B: Ninth Floor | 6.5 | Most honest about what the avatar stack can do, and the best meeting-pacing design. But it puts the largest net-new build (the spatial Floor) at the centre of the MVP and defers the riskiest backend mechanism (exactly-once effects). |
| 4 | D: Headcount | 5.5 | Best phasing and the only unit-economics hypothesis. It also has the largest MVP, misapplies several pieces of research evidence, and sets spike targets that measure the wrong thing or cannot be met. |

**Winner under this lens: C (Mainspring)**, with grafts from A, B and D (§6).

---

## 1. What does not separate the concepts

All four adopt the capability matrix's recommended architecture almost word for word:
- four DO classes: `WorkspaceDO`, `ProjectDO`, `RoomDO` and `RunDO` (T2);
- a server-mediated RoomDO for voice (T5);
- voice front, brain back (T6);
- coworkers speak through their own text turn plus TTS (T7);
- agent chatter is text-native and voiced only on demand (T8);
- meetings use real per-agent turns under a moderator (T9);
- the PG face stack with level of detail (T10/T11);
- BB's plan engine, with the OC registry on top of BB adapters (T4, T12).

So the scores turn on four things:
1. **How much MVP scope each concept stacks on the three L/High ports.** These are matrix §6 #7 (ledger/`ProjectDO`), #11 (`RoomDO`) and #12 (voice client).
2. **Whether net-new work is gated** behind spikes.
3. **Whether the research is cited accurately.**
4. **Concept-specific architecture choices** that change latency or cost.

---

## 2. Reuse claims checked against the research

| # | Claim | Where | What the research says | Verdict |
|---|---|---|---|---|
| 1 | "PG measured about 1.2 s" supports a Chief of Staff first-audio target of p50 < 1.5 s | D §10 | PG's ~1.2 s is the **xAI realtime model answering by itself** on a fresh socket per turn. The same path through a reasoning model took ~18 s (pg1 §2.5; PG overview §2.9). Voice front / brain back exists only on OpenAI Live, which is *partial* (PG §3.3). | **Misapplied.** It holds for acknowledgement audio, not for a substantive answer from the brain. |
| 2 | "biz-bot's plan engine (237 unit tests)" and "oncloudnine's orchestrator and capture (840 … tests)" as the unfair advantage | D §2 | 237 is BB's **whole** app and worker suite: 235 pass and 2 fail. One failure is refine drift that blocks `predeploy` (BB overview header, §6.7). The plan engine has 16 execution tests and 7 checkpoint tests. OC's cloud providers have never run against a paid key (OC overview §1). | **Overstated.** |
| 3 | Timestamped TTS gives exact visemes, as a "why now" | D §2, §5.2 (also C §4.5, A §8 as a revive) | The timestamped path is **unreachable** in PG (`conversation.ts:652` returns before `:661`, matrix §1.6). | This is a revive task (S–M) that needs a canary. A and C frame it that way; D presents it as already proven. |
| 4 | "Realtime voice supports delegation (PG's OpenAI Live path)" | D §2; the voice-front design in A, B and D | The OpenAI Live path is partial: the SDP flow is not mocked end to end, and the brain still needs `XAI_API_KEY` (matrix §1.6). The OC transports never ran live. | **Unproven.** Only C (§9) starts on PG's tested xAI path. |
| 5 | Gaze toward the speaker, faces turning, nods, an animated raised hand | C §4.1 ("gaze turns to the speaker"), C §7 P3; D §5.2 ("the other faces turn toward it"), §5.3 ("Lena's head gives a small nod"), §5.4 ("small animation") | PG's renderer does mouth, blink, brows and head sway only. It has **no eye movement and no arms** (B §6; matrix P3 lists gaze as white space). | **Not reusable.** It needs new renderer work, or UI chrome instead (B's approach). |
| 6 | Spike: "8 lip-synced faces … ≥30 fps, <35% CPU on iPhone 13" | D §10 | PG is sized for 1–6 faces (pg2 §7). The floor arbiter every concept adopts means **one speaking face per audible room**. | **Wrong target.** It measures a case the product never produces, and may fail for no product reason. |
| 7 | Spike: "barge-in cut in <150 ms" | D §10 | PG detects barge-in at RMS > 0.055 for > 45 worklet blocks (PG §5.1 #14). At 128-frame render quanta and 48 kHz, detection alone takes about 120 ms, before any network hop. | **Not achievable as stated.** B's ≤ 300 ms, with local ducking at detection, is realistic. |
| 8 | "The RoomDO voices the live tail through writer ‖ voicer ‖ player" | A §5.3, B §7, C §4.5, D §5.2 | PG's pipeline runs **in the client** (`web/groups.ts` `Engine`). The server only exposes per-line `voice` and `audio` endpoints, and `group-voice` is capped at 3,000 calls a day (pg2 §2.15, pg1 rate limits). | **Adapt, not adopt.** Where voicing runs matters (§4.3). |
| 9 | "PG caps TTS at 3,000 calls per owner per day"; barge-in constants 0.055 / 45 blocks / 900 ms | B §12, §7 | pg1 lists `group-voice 3000`. PG §5.1 #14 confirms the constants. | **Correct.** |
| 10 | "A landmark job runs for every generated portrait" | all four | PG detects landmarks **in the browser** with MediaPipe. Cast portraits are saved without landmarks, and no client writes landmarks back (PG §5.1). | **Net-new, and the concepts don't say where it runs** (see must-fix). |
| 11 | MVP connectors: Gmail and Google Workspace (A §13); Shopify, Meta Ads, 3PL portal (A §2, §5.5); an "email connector" (C §6.5) | A, C | BB's catalog has 11 servers and none of these. OAuth for MCP is docs-only (matrix P10). | **Net-new.** Gmail scopes also need Google's OAuth app verification, which is outside our control. |
| 12 | Adopting `executePlan` | all four | `executePlan` is pure and takes an injected `runTurn`, so it is low risk (bb2 §2.15). Its **host** is L/High (matrix #7): `RuntimeDO` is one per deployment, has no keep-alive, patches `fetch` and `localStorage` globally, and keys identity by bot *name* throughout `plan.js` members and `transcriptToMessages` (BB §5.5, bb1 §7). | Accurate for the scheduler, **understated for the host.** A, C and D spike it; B defers effects. |
| 13 | "16 execution and 7 checkpoint tests" | C §4.3 | Matrix §6 rank 5 gives the same numbers. | **Correct.** |
| 14 | Rates "discovered where providers expose pricing" | A §7.3 | No reference has `rates`. | Treat rates as hand-maintained data checked by a canary. |
| 15 | Meeting turns read the whole room through perspective projection | A, B, C, D | `transcriptToMessages` has "no token-aware truncation beyond the 500-entry log cap" (BB §5.2). | **A hidden cost.** Input tokens grow quadratically in long-lived team rooms. |

---

## 3. Per-concept scorecards

**How the MVP sizes were estimated.** Each MVP's in-scope items were mapped to matrix §6 rows, counting S ≈ 1, S–M ≈ 1.5, M ≈ 2 and L ≈ 5 engineer-weeks. Named net-new items were sized the same way. The totals are rough and only the ordering matters. For reference, all four MVPs include all three L/High ports.

| | A | B | C | D |
|---|---|---|---|---|
| Rough MVP size | ≈ 70 eng-weeks | ≈ 58 eng-weeks | ≈ 66 eng-weeks | ≈ 75 eng-weeks |
| Timeline claimed | none | none | "about 12 weeks, small team" | 4 weeks of spikes, then a 12-week MVP |
| Spikes gate the build | yes (4, well aimed) | yes (3, well aimed) | yes (2, in weeks 1–2) | yes (3, two targets mis-specified) |
| Exactly-once effect in MVP | yes (Gmail) | **no** (spike only) | yes (one email `send`) | yes (one email send) |
| Realtime path | one provider plus a cascade fallback | push-to-talk voice front / brain back | **PG xAI path** (tested) | voice front / brain back (unspecified provider) |

### C: Mainspring (score 8)

**Strengths**
- **No `AgentDO`** (§4.4). A coworker is a loop configuration plus rows, so "spawning six specialists writes six rows and six presence events". The number of DOs grows with projects and live rooms, not with headcount. This is the right cost model for "hire a team in a sentence".
- **The frequency rule** (§4.1): "nothing faster than a sentence goes in the ledger". Visemes, audio frames and token deltas are streamed but never persisted. A spoken line is stored once as `speech.line {audioKey, alignment}`. This bounds DO SQLite writes and makes replay exact and cheap.
- **It starts realtime on PG's xAI path**, "tested end to end", and gates every other transport behind canaries (§9). That is the only honest choice given matrix §1.6.
- **Durable execution is taken seriously** (§4.4, §6.5, §10):
  - effects are reconciled, never blindly replayed;
  - leases are fenced;
  - the kill switch is checked at every claim and heartbeat;
  - the exit criterion is "a forced DO restart duplicates no email".
  This is the stage-2 risk the matrix names.
- **The routing table carries an executor and CI enforces it** (§4.2). This fixes OC's `orchestrator.ts:496` bug. `route` and `route.model` events record the reason for each choice, so explainability comes for free.
- **Calibrated targets.** `verify:live` includes a TTS → STT round trip (§4.6). Forecasts must land within ±35% on 20 golden projects (§10).
- **A disciplined out-of-scope list** (§10): the Companion, video, whispers, doors, Stripe (metering only) and the full Floor.

**Weaknesses**
- **There is a ledger per project, but nothing at workspace level.** Chief of Staff routes, `ask`s to Bench agents, briefs, the kill switch and cross-project "why did we…?" queries (§6.7) all need a workspace log plus D1 roll-ups. "Roll up to D1" (§4.1) is underspecified.
- **Gaze and "gaze drifts"** (§4.1, §7 P3) assume renderer capabilities that do not exist (claim 5).
- **The spike targets the wrong case.** "12 desk tiles and 3 speaking seats at 60 fps on a mid-range phone" (§10) is the wrong axis, because only one seat speaks at a time. 60 fps on a phone is also aggressive; 30 fps is realistic.
- **"About 12 weeks for a small team" is optimistic.** The MVP is roughly 66 engineer-weeks. It includes all three L/High ports and an L-sized server-side memory port (company graph plus hybrid recall), plus new OAuth. Five engineers over about five months is more plausible.
- **The evidence contract** (§4.3) adds a completion gate that can stall a step when an evidence source is missing. In the MVP, keep the `owner_answer` fallback and limit evidence types to citation, artifact and receipt.
- **Who runs meeting turns is not stated.** It is unclear whether coworkers' meeting turns execute in the RoomDO or the ProjectDO, and who is the single writer for effects raised in a meeting.

### A: Righthand (score 7)

**Strengths**
- **The best cost posture.** Design law 3 and §9 set the rules: "audio never plays unless the owner asked for it", "cheap by default, rich on focus", and in the MVP only **one room is audible at a time** (§13).
- **An explicit cascade fallback** (§12, §13). Walkie-talkie mode (STT → brain → TTS) removes the dependency on unproven realtime voice and is cheaper per minute.
- **The signature layer stands on mature parts.** Rhythm (§4) is built from BB triggers, `goalBoard`, BB `?since` replay and PG replay. The Morning Brief is composed by a trigger at 7:10 (§5.1), so it can be pre-rendered rather than generated live.
- **The autonomy dial compiles to BB grant kinds and scopes** (§7.1). The track record is a set of counters over decision outcomes. Both are high value and low risk.
- **Well-aimed spikes** (§13):
  - 12 tiles plus 1 stage;
  - 1 observer and 4 agents, with each line voiced within 2 s;
  - a ProjectDO surviving laptop sleep with an exactly-once email;
  - realtime voice on two providers with barge-in.
- **A list-first MVP Floor** with static portraits and a speaking ring. The PG renderer runs only on the stage.

**Weaknesses**
- **The MVP is very broad** (§13), roughly 70 engineer-weeks with no timeline. It includes:
  - four chat providers, including a new Gemini adapter;
  - rates and forecasts;
  - Google Workspace and HubSpot over new OAuth 2.1 with a vault;
  - an exactly-once Gmail send;
  - Stripe with credits and metering;
  - the Time-back report and a Friday Review replay;
  - listen in, whisper and take the floor;
  - the onboarding interview and the graph.
- **Its connectors are not in the references** (claim 11). Gmail verification adds a schedule risk outside the team's control.
- **A standing spend grant can be given by voice.** In §5.1 the owner can say "allow reorders under $7k from this supplier for 30 days". A misheard command could create a standing money permission.
- **The car scenario is unaddressed.** A Morning Brief in the car with barge-in needs background audio and a microphone on mobile. PG and OC have no push channel ("polling everywhere", PG §7), and iOS PWA audio is limited (B §12). A does not address this.
- **The forecast target is aggressive.** Within ±25% on 80% of engagements (§13 success) is hard with no historical token data.

### B: Ninth Floor (score 6.5)

**Strengths**
- **It is honest about the renderer** (§6). The raised hand is a UI glyph and "looks toward" is head yaw from the sway transform. Gaze and expressions are v2 work behind `sample(now)`. This is the only concept that checked what PG can actually draw.
- **A concrete level-of-detail table** (§5.3):
  - hero at 1024 px;
  - tiles at 256 px, with **at most 3 animated at once**;
  - static tokens for everyone else;
  - one AudioContext;
  - a landmark job when each portrait is created.
- **Pacing modes and skip-to-live** (§7). Meetings run at speaking pace only while someone is listening. If voicing falls more than 20 s or 8 lines behind, the lead inserts a "skip line" and jumps ahead. This bounds both latency and TTS cost: "Meetings slow down to human pace for you. Work never does."
- **The FloorProjector is testable** (§2, §6, §13). It is a pure reducer with priorities and minimum dwell times, every frame carries a `cause.seq`, and a test replays a recorded bus to check this.
- **One Workspace socket per client**, with hibernation (§6).
- **Voice approvals are limited to "once" and "task"** (§8.5). Standing grants and anything involving money need an on-screen tap after a spoken read-back.
- **Realistic spike targets** (§13): first voiced line under 2.5 s at p50, barge-in under 300 ms, 60 fps on a laptop and 30 fps on an iPhone 13. The room tone uses Web Audio earcons, so it costs no TTS (§5.4).
- **The smallest backend MVP** (§13): billing, guests, Gemini, exactly-once sends, Rewind and spatial audio are all deferred.

**Weaknesses**
- **The spatial Floor is both the home screen and the MVP centrepiece.** Matrix #25 rates it L/Med and net-new. It brings semantic zoom, a "walk up" camera, automatic layout, drag-to-persist positions and full Directory parity. That is the highest UI build risk and the highest product risk, and §12 itself concedes spatial UIs can be slower than lists.
- **Spatial audio contradicts voice on demand.** "A neighbouring meeting murmurs at −18 dB" (§5.4) means voicing rooms nobody chose to hear, which breaks T8 and B's own cost story.
- **The MVP proves presence but not action.** Exactly-once effects are a spike only (§13), so the hardest backend mechanism is still unproven at MVP exit.
- **The WorkspaceDO does too much.** It carries presence fan-out, layout, the vault and billing in one single-threaded object.
- **Talking at a desk needs an unscoped detector.** "What you said changes a project's scope → a plan diff" (§2) requires a scope-change detector that nobody has scoped.

### D: Headcount (score 5.5)

**Strengths**
- **The best roadmap framing** (§10). It has Phase 0 spikes over four weeks and an explicit "out, deliberately" list: doors, whispers, video, the Companion, CLI coworkers, the marketplace and **any money movement**.
- **The stand-up is the one place PG director mode is used** (§5.5). One script is written from real state and voiced per coworker. That is maximum PG reuse at a predictable cost.
- **A procedural OC bust holds the desk until the portrait lands** (§5.1), which hides image-generation latency.
- **The only unit-economics hypothesis** (§8): credits priced from per-model `rates`, bring-your-own-key, and "you pay for voice only when someone listens".
- **The sceptic runs on a different model family** (§6), which costs nothing extra through the registry.

**Weaknesses**
- **The largest MVP**, at roughly 75 engineer-weeks in 12 calendar weeks (§10 Phase 1). It includes:
  - a realtime-voice Chief of Staff;
  - "Staff it" with faces;
  - Floor pods plus a stage per coworker;
  - rooms with walk-in, take the floor, catch me up and replay links;
  - the stand-up and screen share;
  - the onboarding interview and recall;
  - four providers plus Gemini, all with rates;
  - one governed send;
  - Stripe Solo and Team with credits and budgets.
- **Evidence is overstated or misapplied** (claims 1–4).
- **Two spike targets are mis-specified**: 8 simultaneous lip-syncs, and a barge-in cut under 150 ms (claims 6–7).
- **It relies on face behaviours the renderer lacks** (claim 5).
- **Screen share costs scale with the room** (§5.7). One card per frame goes to every participant's perspective, so vision cost multiplies by the number of participants.
- **The credit prices are unvalidated.** "Chief of Staff realtime minute ≈ 10 credits" ignores that voice front / brain back bills both a realtime session and brain tokens.
- **Billing ships before metering is proven.**

---

## 4. Architecture assessment across the concepts

### 4.1 Latency budget

| Path | Realistic budget | Concepts |
|---|---|---|
| Chief of Staff acknowledgement ("I started it") | ~1–1.5 s on the xAI realtime path. PG measured 1.2 s. | All four are fine. |
| Chief of Staff substantive spoken answer | With a fast non-reasoning brain, ~1.5–3 s: PG measured ~0.5 s time to first token, the first clause is released early (≥ 60 chars), then the TTS first chunk plays. With a reasoning brain it is ~18 s (PG), so that work **must** go to the background. | No concept states this split. D's metric conflates the two. |
| Listen-in, first voiced line | 1.5–2.5 s: a fast-model catch-up, then the first TTS chunk. | A (2 s), B (2.5 s at p50) and C (3 s) are all plausible. |
| Owner takes the floor → agent reply | ~2.5–6 s. That is STT endpointing (450 ms), plus the `TurnAssembler` gap (1.2–1.5 s), plus the agent's turn (0.5–1 s, or +1–3 s with an MCP call), plus the first TTS chunk. | **No concept budgets this.** The moderator needs filler lines. |
| Barge-in stop | ~120 ms of detection, with local ducking immediately, then the server bumps the generation over one round trip, for 200–300 ms in total. | B is right. D's < 150 ms is not achievable. |
| Paced meeting turns | Each turn needs time to first token ≲ 2 s, so meeting turns must use the persona's *fast* tier. The `reason` tier in C §4.6 (for example `claude-opus-5`) would stall a paced room. | Not stated anywhere. |

### 4.2 Cost of many avatars and voices

- **Rendering is client-only, so it adds no server cost. What limits it is client CPU and GPU.**
  - A speaking PG face costs about (warp rows ÷ 2 px) × 8 `drawImage` calls per frame.
  - Each 1024 px offscreen canvas uses about 4 MB (pg2 §7).
  - Because of the arbiter, one hero, at most 3 animated tiles and static tokens is enough (the A/B level-of-detail scheme).
- **Voice is the main variable cost.** All four concepts keep chatter as text and voice it only on demand. The largest cost lines are:
  1. **The Chief of Staff's realtime minutes.** The realtime session and the brain's tokens are both billed.
  2. **Meeting turns.** Perspective projection resends the whole room each turn, with no token-aware truncation (claim 15). Bound this with PG's "conversation so far ≤ 6k" budget, a rolling summary and prompt caching.
  3. **Screen and camera frames multiplied by participants** (D §5.7). Route each frame to the addressed agent instead (C §4.8, "the CoS routes items").
- **The cheapest voice is pre-rendered.** Briefs and stand-ups (A §5.1, D §5.5) need one script, one TTS pass and one cache entry in R2, and are replayable at no extra cost.

### 4.3 Durable Object topology (consensus plus fixes)

| Object | Holds | Fixes the concepts need |
|---|---|---|
| **WorkspaceDO** (per org) | Vault, billing, quotas, door tokens, kill switch, timezone triggers | Add a **workspace event log** for Chief of Staff routes and non-project work (C's gap). If load grows, move the presence fan-out off the object that holds billing and the vault (B's gap). |
| **ProjectDO** (per project) | Plan engine, ledger, event bus, **single writer for effects** | Rebuild the BB host: one DO per project, an alarm tick while jobs are live, injected `fetch` and storage, stable ids (claim 12). |
| **RoomDO** (per live room) | Owner and observer sockets (Hibernation API), floor arbiter, per-speaker generations, the owner's STT socket | Open provider sockets **only while the owner's mic is live**, because an open outbound provider socket keeps the object resident. Meeting turns may run here, but any tool call with a side effect goes through the ProjectDO ledger. The RoomDO appends `message` and `speech.line` events to that ledger. |
| **RunDO** (per long job) | Renders, builds, CLI steps | PG `BuilderDO`, as the matrix recommends. |
| ~~AgentDO~~ | none | **Coworkers are rows** (C §4.4). |

**Where voicing runs.** Keep PG's split. The server exposes an idempotent `voice(lineId)` that runs TTS once and caches the result in R2, keyed by line and voice. Voicing is requested only while at least one audio observer is attached. Every observer and every replay reuses the same cached audio. The RoomDO never streams TTS audio frames itself.

---

## 5. Why C wins under this lens

C is the only concept whose defining choices *reduce* build risk and running cost:
- coworkers are configurations, not DOs;
- sentence-level persistence bounds ledger volume;
- realtime voice starts on the one tested stack;
- the MVP's exit criteria are chaos-tested, with "no duplicate email" and "no silent zero cost".

A is a close second. Its product layer (Rhythm, dial, Deck) is the cheapest compelling surface on mature BB parts, but its MVP carries too much net-new integration work (connectors, OAuth, billing). B has the best engineering *details* (renderer honesty, pacing, the projector) wrapped around the riskiest *centrepiece* (the spatial Floor). D has the right phasing but the largest MVP and the least accurate evidence.

---

## 6. Ideas the final product must graft in

1. **[C] No `AgentDO`: a coworker is a loop configuration row.** DO count then scales with projects and rooms, not headcount, and spawning stays cheap.
2. **[C] The frequency rule and `speech.line {audioKey, alignment}`.** This bounds ledger writes and makes replay exact and free.
3. **[C] Realtime starts on PG's xAI path**; every other transport stays behind `verify:live` canaries, including a TTS → STT round trip. **[A]** A cascade walkie-talkie fallback (STT → fast brain → TTS) sits behind the same voice-front seam.
4. **[C] Durable-execution discipline.** Effects are reconciled and never replayed, leases are fenced, the kill switch is checked at every claim and heartbeat, and a deploy-restart chaos test must pass.
5. **[C] The routing table as data**, with running and finished copy plus an executor enforced by CI, and `route` and `route.model` events that record the reason.
6. **[B] Renderer honesty.** The raised hand is a glyph and "looks toward" is head yaw. Gaze and expressions are v2 work behind `sample(now)`.
7. **[B] The FloorProjector**: a pure reducer with priorities, dwell times and `cause.seq` on every frame, tested by replaying a recorded bus. Add **[C]** "every non-idle face is backed by an event from the last 2 s".
8. **[B] Pacing modes (fast or paced) and skip-to-live** when voicing falls more than 20 s or 8 lines behind.
9. **[B] Level-of-detail tiers.** Hero, at most 3 animated 256 px tiles, and static tokens, on one AudioContext and one Workspace socket per client with hibernation.
10. **[B+C] Voice approvals are limited to "once" and "task".** Standing grants and money require an on-screen tap, and send or pay grants are never standing.
11. **[A+D] Pre-rendered spoken briefs and stand-ups** in PG director mode, generated from real state by a trigger and cached in R2.
12. **[A] One audible room at a time in the MVP**, with a catch-up of at most 20 s before the live stream.
13. **[D] Phase-0 spikes gate the build**, with an explicit "out, deliberately" list: no money movement, doors or Companion in the MVP.
14. **[D+A] Credits on per-model rates**, with bring-your-own-key, voice billed only when someone listens, and listen-in minutes and voiced lines metered.
15. **[D] A procedural OC bust as a placeholder** while the portrait and its landmarks land.
16. **[A] The autonomy dial per action class**, compiled to BB grant kinds, with track-record counters and automatic demotion on reversal.
17. **[B] "The drop target is the scope"** for ContextCards, a zero-cost mapping onto OC's `scope` field.

---

## 7. Must-fix problems the final spec must avoid or solve

1. **Split the voice latency targets.** One target is for *acknowledgement audio* (~1.2 s on the xAI realtime path). The other is for the *substantive answer*, from a fast non-reasoning brain. Reasoning work always goes to the background. Don't cite PG's 1.2 s for brain-backed answers.
2. **Don't make OpenAI Live voice front / brain back the MVP transport.** It is partial, its SDP flow is not mocked, and its brain is hard-wired to xAI. The OC transports have never run live.
3. **Budget renderer work or use UI chrome.** Gaze, nods, gestures and "faces turn toward the speaker" are not in PG's renderer.
4. **Fix the avatar spike targets.** Test one speaking face per audible room, at most 3 animated tiles and a static wall, at 60 fps on a laptop and 30 fps on an iPhone 13. Don't test 8 simultaneous lip-syncs or 60 fps on phones.
5. **Set the barge-in target to ≤ 300 ms**, with immediate client-side ducking on detection. The < 150 ms target is not achievable with PG's detector.
6. **Enforce voice on demand strictly.** Never voice a room without an audio observer; drop B's −18 dB "murmur" or render it from earcons. Cap voiced seconds per workspace per day.
7. **Add a workspace-level event log.** It holds Chief of Staff routes, non-project asks, briefs and the kill switch, with a D1 roll-up for cross-project "why" queries. Per-project ledgers alone are not enough.
8. **Budget the BB engine host as a rebuild (L/High).** That means per-project DOs, an alarm keep-alive, injected `fetch` and storage, and a migration from name keys to stable ids through `plan.js` members and `transcriptToMessages`. Fix the failing refine test that blocks `predeploy`.
9. **Name one writer for effects.** Meeting turns in the RoomDO must send side-effecting tools through the ProjectDO ledger.
10. **Bound meeting and room context per turn** (PG's ≤ 6k budget, a rolling summary and prompt caching). Paced meeting turns use the persona's fast tier.
11. **Don't route every captured frame to every participant.** Route screen and camera frames to the addressed agent and coalesce them.
12. **Say where the "landmark job" runs.** Either the first viewer computes landmarks and writes them back, validated by `landmarks.ts`, or a server-side browser job does it. PG today re-detects landmarks for every viewer.
13. **Choose MVP connectors from BB's existing 11-server catalog** (for example HubSpot or QuickBooks). Use a fake email sink in the spike, and a transactional email provider for the one governed send. OAuth for MCP is net-new, and Gmail needs Google verification.
14. **Rates, forecasts and credit prices are unvalidated.** Publish them only after spike data exists. Forecasts are ranges, with a target of ±35%. Price the Chief of Staff's voice minute as a realtime session *plus* brain tokens.
15. **Plan for mobile audio.** Create one AudioContext inside a user gesture, use Media Session, and treat push and background mic/audio as native-shell work. PG and OC have no push channel.
16. **Revive and canary the dormant or buggy PG paths before claiming exact lip sync.** That is the timestamped TTS path, the dropped first delta and the early drain.
17. **Close outbound provider sockets whenever the owner's mic is idle.** An open socket keeps a RoomDO resident. PG's socket-per-turn pattern suits rooms.

---

## 8. Build order that fits the evidence

1. **Phase 0: spikes, about 4 weeks, run in parallel.**
   - A ProjectDO chaos test with exactly-once delivery to a fake sink.
   - A RoomDO with 4 agents, the owner and 2 observers: voice on demand in ≤ 2.5 s and barge-in in ≤ 300 ms.
   - One hero, 3 tiles and 12 tokens on one AudioContext.
   - An xAI realtime front with a fast brain, plus the cascade fallback.
   - Landmark write-back.
2. **Phase 1: the work engine.** A keyless text Chief of Staff (Mock provider), the plan engine in a ProjectDO, the Inbox and grants, one governed effect, rates and metering, and the kill switch.
3. **Phase 2: presence.** A desk grid or list with FloorProjector states, a stage, rooms with listen-in, take the floor and replay, and pre-rendered briefs and stand-ups.
4. **Phase 3: context and reach.** The server-side graph and recall, MCP with OAuth from the BB catalog, Gemini (chat via an OpenAI-compatible surface first, after checking tool-calling parity; Live later), and Stripe once metering has been calibrated.
5. **Phase 4: the rest.** The spatial Floor, whispers, guest doors, the Companion and CLI coworkers, and video.
