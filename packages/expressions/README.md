# @headcount/expressions — the reflex engine

The fastest of the three speeds of thought (docs/LIVING-WORKFORCE.md, owner directive D5). It picks
pre-authored, pre-voiced micro-utterances such as backchannels, fillers, laughs, reactions, hellos,
juggling notices, side-talk and work quips. Each pick takes well under a millisecond and makes no model
call. Every pick is grounded in live state, avoids repetition, is weighted by mood, and is gated by
Ambience and budgets.

- **Pure and isomorphic.** It is ES2023 TypeScript with no DOM, no Node APIs and no I/O. It runs in the browser for the `ReflexRunner` and in Workers for the WorkspaceDO and ProjectDO. The one exception is `src/testing.ts`, which is test support only.
- **No runtime dependencies.** It uses type-only imports from `@headcount/protocol` (`Alignment`, `PresenceState`, `StreamId`, `VoiceRef`). SHA-256, UTF-8 and the RNG are implemented locally. It uses WebCrypto when available and produces the same bytes either way.
- **Deterministic (L7).** The same catalog, seed, state, mood and recency always give the same pick. Seeds follow `agentId | intent | cause`, where the cause is a `turnId`, a `stream:seq` or `hover:<agent>:<minute>`.
- **Exports TypeScript source**, following the repo convention (`"exports": {".": "./src/index.ts", "./testing": "./src/testing.ts"}`). There is no `dist/` build. The §11.2 declaration block is implemented exactly by `src/types.ts`, `src/vocab.ts` and the modules listed below.

## Layout

| File | What it holds |
|---|---|
| `src/vocab.ts` | Id unions, `MAILBOX_PRIORITY`, `MOOD_DELTAS`, `MOOD_HALF_LIFE_MS`, id lists, `GLOBAL_NEVER_SAYS` |
| `src/types.ts` | Every §11.2 interface (catalog shapes, grounding, runner ports, frame data) |
| `src/catalog.ts` | `compileCatalog`, `ExpressionCatalogError`, `deriveBlend`, `resolveBlend`, `buildAgentIndex` (+ `compileCatalogLenient`, `catalogVersion`, `sliderStatsOf`) |
| `src/state.ts` | `resolveSlots`, `deriveContexts`, `sanitizeGist`, `etaPhrase` |
| `src/select.ts` | `selectLine`, `scoreLine`, `fillLine` (+ `renderUtterance`, `validateFills`, `recordUtterance`, `ownerDayKey`) |
| `src/markup.ts` | `speakable`, `readable` (a port of PG `groups.ts`, byte-identical to the validator), OpenAI mapping |
| `src/delivery.ts` | `toDelivery`, `clipKey`, `fillKeyOf` (+ `voiceKeyOf`) |
| `src/recency.ts`, `src/hash.ts` | `createRecencyMemory`, `seededRng` (xmur3 → mulberry32), SHA-256, base32 |
| `src/mood.ts` | `baselineMood`, `reactivityOf`, `createMoodState`, `moodAt`, `applyMoodEvent`, `ownerFacing`, `moodChanged`, `expressionBias` |
| `src/affect.ts` | `sniffOwnerText`, `parseReactHint`, `reactionFor` (+ `maybeReactHintPrefix` for streaming) |
| `src/gate.ts` | `createChatterBudget`, `createTimingGate` (+ `reflexProbability`, `budgetClassFor`, `faceCueFor`) |
| `src/actor.ts` | `createMailboxes`, `mergeAttention`, `contentionFor` |
| `src/sidetalk.ts` | `proposeSideTalk` (+ `sideTalkText`) |
| `src/events.ts` | Additive: `planServerReflex`, `reflexIntentFor`, `moodEventFor` for WorkspaceDO event reflexes and phatic replies |
| `src/prevoice.ts` | `planPrevoice` |
| `src/frames.ts` | Frame-data builders: `reflexSayData`, `sideTalkLineData`, `moodChangedData`, `attentionChangedData`, `clipUrl` |
| `src/runner.ts` | `createReflexRunner`, the client reflex scheduler (ports only) |
| `src/testing.ts` | Fixture catalog, profiles, `makeState`, fake clock and ports, `createRunnerHarness` (`@headcount/expressions/testing`) |
| `scripts/build-expressions.mjs` | `catalog/expressions/**` → `generated/expressions.json` + `generated/report.json` |

## Content and the bundle

```sh
node packages/expressions/scripts/build-expressions.mjs          # writes generated/ (git-ignored)
node packages/expressions/scripts/build-expressions.mjs --check  # exit 1 if any line was dropped or file skipped
```

- **Loading.** `scripts/load-expressions.mjs` reads `intents.json` and `archetypes.json`. It then classifies every other JSON file under `catalog/expressions/` by its `kind` (`archetype_pack` or `signature_file`), so `packs/`, `signatures/`, `personas/` and `leads.json` all work. Unparsable files are skipped and reported. It also computes live slider statistics over `catalog/personas` and `catalog/leads`, exactly as the validator does.
- **Compiling.** The script runs the real TypeScript engine through Node's type stripping, so it needs no build step. On Node 22.17 it re-executes itself with `--experimental-strip-types`. `compileCatalogLenient` drops any line or signature pack the engine rejects and lists it in `report.json`, so half-written content never breaks the app. Only file-level problems exit 1.
- **Output.** The bundle is `{kind:'expression_bundle', version, input}`. `compileCatalog(bundle.input)` is strict and reproduces `version` (`e1_…`, a content hash that does not depend on file order). Use `version` as the ETag of `/api/expr/catalog`.
- **Size and cost.** With today's content (12 archetype packs, 174 signature packs, about 17.9k lines), the bundle is about 2.5 MB of JSON. It compiles in about 300 ms cold and about 150 ms warm on an M-class laptop. Selection takes about 0.1 ms per pick and `buildAgentIndex` about 1 ms.
  - Compile once per Worker isolate.
  - In the browser, compile once after load, off the critical path (for example in `requestIdleCallback`).
  - Serve the bundle gzip-compressed and cache it immutably.
  - If the web shell needs less, a per-agent slice holding only the blended packs and the agent's own signature is a small follow-up.

`compileCatalog` enforces the runtime half of `catalog/scripts/validate-expressions.mjs`:

- line ids;
- slots equal to placeholders and allowed by the intent;
- `readable(tags.xai) === text`, known and balanced tags, no `[cough]` or `[yawn]`;
- `max_chars`;
- contexts from the vocabulary;
- the honesty lints: completion claims (H2), embodiment (H6) and side-talk that names the owner (H4);
- each persona's own `never_says`.

## Worker integration (E3, WorkspaceDO and routes)

| Route or duty | Engine calls |
|---|---|
| `GET /api/expr/catalog` | Serve `generated/expressions.json` with `ETag: version`. On load, `compileCatalog(bundle.input)` once per isolate. |
| `GET /api/expr/agents/:id` | `resolveBlend`, `buildAgentIndex` (`baseline`, `reactivity`, `laugh`), the stored `ClipManifest`, `moodAt(state, now)`, the merged `AttentionView` |
| `POST /api/expr/render` | `renderUtterance(index, lineId, fills)`. It accepts `<id>`, `<id>~prefix`, `<id>~tail` and `<id>~gist`, and rejects unknown lines and invalid fills (`validateFills`). Then call `toDelivery(u, voice, provider)` and `clipKey(delivery)`, which is idempotent. |
| `POST /api/expr/prevoice` | `planPrevoice(index, catalog, provider, {owner_name, chief_name, self_name, coworkers, projects}, {tiers})`. It yields `PrevoiceItem[]`, each with a `delivery`, a `clipKey` and a `scope` (`shared` goes under `expr/clips/`, `workspace` under `ws/<ws>/expr/`). Render each unique `clipKey` once. The manifest key is `` `${lineId}\|${fillKey}` ``. For the Chief of Staff, pass `allLinesFor` with the conversation intents. |
| Phatic closure (§3.3) | Call `sniffOwnerText(text, catalog.lexicon)`. When `cues.phatic` is set, call `planServerReflex({intent:'gratitude_reply' \| 'greeting' \| 'sign_off', exchange, turnId, …})`. Persist `talk.message{kind:'reflex', text: frame.caption}` and emit `reflex.say`. Do not call the brain. |
| Deferral | `planServerReflex({intent:'deferral', turnId, state: {…, attention: {etaMs}}})` |
| Event reflexes | For each work event, call `moodEventFor(kind, verdict)` and `applyMoodEvent`, then `reflexIntentFor(kind)` and `planServerReflex`. It returns `no_viewer` unless a viewer is at that agent's stage. |
| Mood | Keep one `MoodState` per agent (`createMoodState(agentId, index.baseline, index.reactivity, now)`) and fold events with `applyMoodEvent` (pass `{sceptic: true}` for the team's sceptic). Emit `mood.changed` via `moodChangedData` when `moodChanged(...)` is true, or at most every 10 s. |
| Attention | Merge claims per agent with `mergeAttention(agentId, claims, now)` and emit `attention.changed` via `attentionChangedData(view)`. Add a one-line attention context to the talk prompt. |
| Side-talk (from Inc 1) | ProjectDO calls `proposeSideTalk(event, ctx)`. The WorkspaceDO gate checks the viewer's `visibleProjectIds` and `budget.canSpend('chatter', now)`, then `spend`s and emits `sideTalkLineData(proposal, line, {voice, clip})` per line. |
| Reaction hint | Buffer the reply head while `maybeReactHintPrefix(head)` is true, then `parseReactHint(head)`, forward `hint` in the first-token event, and stream `rest`. |
| `expr.recent` socket op | Use one `createRecencyMemory()` per workspace. Call `merge()` on the client's snapshot, and send `snapshot()` or its line ids back on reconnect. |
| Mailboxes | Use `createMailboxes<T>()` for host queues: owner > floor > coworker > work > ambient, `coalesceKey` means latest wins, and TTL drops stale items. |

The server-side gate is `createTimingGate(catalog, createChatterBudget(catalog.ambience, ambience))`. Keep one gate per member session, so per-turn and cooldown state is shared with the client's picks through the recency snapshot.

## Web integration (E4, `src/living/runtime.ts`)

Create one runner per tab after the catalog loads: `createReflexRunner(deps)`.

- **Ports.**
  - `audio` (`ReflexAudioPort`) goes over `@headcount/audio`. `play()` gets a decoded `PreparedClip` on the `reflex` bus (owner-directed) or the `ambient` bus (side-talk). A `juggling` line arrives with priority 1 while the agent's reply is still playing; insert it at the next sentence boundary.
  - `face` (`ReflexFacePort`) goes over `FaceView`. Use the interim CSS gesture class and parameter mapping until `cue()` and `setExpressionBias()` exist.
  - `captions` (`ReflexCaptionPort`) covers the Talk caption line (`reaction` style), Floor bubbles (`bubble`, replyable for passing-by) and side-talk bubbles (`sidetalk`, carrying a `threadId` and `toAgentId`).
  - `clips` (`ClipStore`) wraps Cache Storage `hc-expr-v1` and a decoded LRU. `get()` must be synchronous for decoded clips. The runner calls `prefetch(keys, 'p1')` when the pointer enters a desk tile.
- **Other deps.** Provide `index`, `state`, `mood` and `attention` from the event stream. `render()` calls `POST /api/expr/render`. `clock` should return `Date.now()`, and `schedule` should use `setTimeout` and return a cancel function.
- **Hooks.**
  - Talk: send or push-to-talk release calls `ownerTurn({…, cues: sniffOwnerText(text, catalog.lexicon)})`. The first `talk.delta` calls `conversation({kind:'first_token', hint})`, the first TTS chunk calls `first_chunk`, TTS progress calls `speaking`, and `talk.done` calls `done`. A background hand-off calls `backgrounded`.
  - Microphone VAD calls `ownerSpeech` with `start`, `pause` (and `pauseMs`), `resume` and `end`.
  - The Floor tile calls `hover(agentId, 'enter' | 'dwell' | 'leave', via)`. Dwell comes after 600 ms below 0.3 px/ms, after 900 ms of keyboard focus, or on a touch tap.
  - Stage open and close call `stage`. Barge-in calls `bargeIn`. Socket frames call `frame`. Settings call `setSettings`. Everyone stop calls `stopAll('everyone_stop')`; resume on the screen with `stopAll('reset')`.
- **Additive setting.** `ReflexSettings.approvalInProgress?: boolean` is the one field added to the §11.2 declarations. Set it from the voice approval read-back until confirmation, and the runner plays nothing, not even a face cue (§1.4.7, H9).
- **Building an `AgentExpressionProfile` from the catalog.**
  - Persona: `personality.sliders`, `personality.traits`, `roles: persona.team_roles`, `seniority`, `voice: personaVoiceRef(p)` (from `@headcount/catalog`), and `teamRole` from the current team.
  - Lead: `personality.sliders` and `traits`, `leadId: lead.id`, `voice: leadVoiceRef(lead)`, and `teamRole: 'chief'`.
  - Put the owner-facing name in `firstName`.
- **Grounding state.** Build `GroundingState` from presence, the run ledger and history. Note that `now.weekday` uses the JS convention (0 is Sunday) and `now.localHour` is owner-local.

## Protocol (E5)

The five ephemeral frames use the data shapes `ReflexSayData`, `ReflexFaceData`, `SideTalkLineData`, `MoodChangedData` and `AttentionChangedData`, collected in `ExpressionFrame`. They are declared here as §11.2 specifies. The integrator can mirror them in `packages/protocol/src/ext/expressions.ts` and add them to `FrameDataMap`. `isExpressionFrame(x)` is a runtime guard.

## Keyless modes

- **`mock`:** clips are expected from the worker's synthetic renderer (P0 on hire). If no clip is decoded, reflex-grade lines fall back to a face cue.
- **`browser`:** `planPrevoice` returns `[]`, verbal lines use `speakText`, and nonverbal lines (laughs) are face-only.

## Tests

```sh
npx vitest run --project expressions                          # 154 tests, about 3 s
node_modules/.bin/tsc -p packages/expressions/tsconfig.json --noEmit       # isomorphic source (no DOM, no Node types)
node_modules/.bin/tsc -p packages/expressions/tsconfig.test.json --noEmit  # tests + scripts
```

- **Unit tests** cover every module: selection determinism and goldens, grounding (a progress line never plays without state), anti-repetition, `never_says`, splits, clip keys against node crypto, mood fold and decay bounds, the sniffer, gates and budgets per Ambience, mailboxes, attention and side-talk.
- **`runner.test.ts`** drives the client runner on a fake clock with fake ports. It covers backchannels only inside pauses, the ack → filler → holding → deferral timeline, hinted reactions, phatic replies, distress, sincere-AI silence, juggling and back-with-you, Floor passing-by, Quiet and keyboard behaviour, side-talk voicing, stage greetings and one voice at a time.
- **`sim.test.ts`** is the §10.2 simulation harness: a scripted 30-minute workday at each Ambience. It asserts zero ungrounded fills, no audio over the owner (≤ 150 ms), juggling only with contention, no laughs after distress, chatter within budget, wasted fillers under 15% and determinism.
- **`content.test.ts`** runs the live `catalog/expressions/**` through the engine. It checks that no lines are dropped, that every pack yields grounded core picks, that selection takes under 2 ms per pick (typically about 0.1 ms), and that the build bundle compiles strictly to the same version.
- **`content-fuzz.test.ts`** makes 1,000 seeded picks from the live content across every lead and persona, all 33 intents and random fake states (sparse, full and adversarial, with markup, URLs and secrets in slot values). It asserts zero leaks: no unfilled placeholder or markup in captions, bubbles or TTS input; every fill equals what `resolveSlots` gets from the state; required contexts hold; side-talk never names the owner; and no pick exceeds its intent's `max_ms`.

## Notes for the integrator

- `package.json` declares `@headcount/protocol` as a `devDependency` (types only). The lockfile needs a `pnpm install`. Until then, both tsconfigs map it with `paths`.
- Consider running `build-expressions.mjs` from the root `catalog:build` or `postinstall`, so `generated/expressions.json` exists wherever the worker imports it.
- `catalog/scripts/validate-expressions.mjs` finds files by `kind` like the engine's loader (`packs/`, `personas/`, `leads.json`, `signatures/`) and accepts both catchphrase id forms. On top of the engine's runtime checks, it lints progress and result words ("done", "finished", "%", "halfway"…) that no slot, cause or context grounds, flags exact duplicate texts within a pack, and warns on lines whose `estimateMs` exceeds the intent's `max_ms`, because selection never picks those without a shorter clip. Keep its `estimateMs` port and `GLOBAL_NEVER_SAYS` copy in sync with `src/lines.ts` and `src/vocab.ts`.
