# Increment 0.5 · The living workforce

The office now reacts like people who are paying attention. The Chief of Staff nods in your pauses while you hold to
talk, laughs at a joke in their own style, answers "thanks", "hi" and "bye" at once without a model call, fills a slow
answer with a short "let me think" instead of silence, and waits for their own sentence to end when you interrupt
with a question. A running job is felt at Talk: a short, true progress line, a "that went the way it should" right
before the job-done announcement, and a face that brightens. On the Floor, rest the pointer on a desk and the face
looks up with a short line in that coworker's own voice; press **R** to chat in place. Every sound is captioned, and
one control (Ambience) sets how much of this happens.

Binding inputs: [OWNER-DIRECTIVES](../OWNER-DIRECTIVES.md) D5 (living workforce), D2, D3;
[LIVING-WORKFORCE](../LIVING-WORKFORCE.md) (the spec); [INC05-PLAN](INC05-PLAN.md) (the build plan and its §8
narrowings); contracts in [CONTRACTS.md](CONTRACTS.md) §7 and §8 (one voice per workspace).

---

## 1. Run it

Nothing new to install: `pnpm install` builds the expression bundle (`packages/expressions/generated/`), and `pnpm dev`
rebuilds it when `catalog/expressions/**` changes. Open Talk once: the Chief of Staff's lines are pre-voiced in the
background (about 15 s on xAI for P0, then P1).

| Mode | Command | Reflex voice | Pre-voicing | Mouth |
|---|---|---|---|---|
| Your keys | `pnpm dev` | pre-voiced clips in each agent's own voice (xAI, else OpenAI); lines with live slots render on first use | the Chief's P0 then P1 when Talk opens; coworkers on first hover | xAI alignment; OpenAI text timing |
| Voice path, no keys | `pnpm dev --mock --mock-media` | Mock clips (silent, with timing: the mouth moves) | instant | alignment |
| Keyless | `pnpm dev --mock` or `--local` | the browser voice for verbal lines; laughs are a smile | none | text-timed |
| Voice off | any | none: captions, bubbles and faces | as above | — |

## 2. What is alive now

**Talk.**
- **Owner-directed reflexes** always play, whatever the Ambience: an acknowledgement ("Copy. On it.") on a request or a
  steer, a thinking filler when no answer has started after 0.7 s by voice (client; 1.8 s after an acknowledgement or
  a reaction) or 1.2 s (server safety net), a "one sec" bubble in text after 2.5 s or the Chief's usual first-token
  time + 400 ms when that is later (≤ 6 s; server net 4 s; shown at least 0.9 s), and phatic replies ("Anytime.",
  "Hey. Good to see you.", "Talk soon.") that are the whole answer: saved as a reply, no model call, no chat count,
  voiced like any answer when voice is on (a second "hi" inside the greeting's cooldown included). A phatic reply
  sent while the previous answer still speaks waits for it to finish, and never cuts that answer's text.
- **No filler where it does not belong**: a sincere "are you an AI?" gets no reflex at all, distress gets sympathy
  only, a joke gets the laugh or the smile (never "let me think"), and a filler never follows the turn's own
  acknowledgement. Enthusiastic fillers ("Ooh, a puzzle") need a question or a request and never answer a complaint
  or come within 30 minutes of distress. The Chief's P0 pre-voices every thinking filler, so they rotate.
- **Reactions**: a laugh (≤ 65% of the time, else a smile) or surprise, concern, sympathy, delight at the end of a
  voice turn (their clips decode right after P0), or when the model opens with a hidden `⟦react:…⟧` hint; typed turns
  get the face, captioned in the reaction style ("(smiles)"). The model is told what the office already said and
  never opens with its own "Ha," or "On it —" (a stream filter drops one if it does).
- **Backchannels**: while you hold to talk, a pause of 350 ms–1 s after 2.5 s of talking gets a nod and, sometimes, a
  soft "mm-hm" that stops the moment you resume. Nothing else ever sounds while your mic is live.
- **Sending while they speak** (X5 amended): typing never stops the voice. A stop or steer cue, or more than 8 s left,
  ends the reply at the sentence playing (within 4 s, even inside a long synthesised chunk) and a short "got it" plays
  before the new answer; 2.5–8 s left finishes it with "hold that thought" and "all yours". A typed follow-up never
  cuts the reply's text: it finishes writing (≤ 6 s) and stays whole on screen, and the next answer sees it. Only a
  short stop ("stop", "wait, cancel") or speaking over it cuts the text too. Esc, a tap on the face and holding to
  talk still stop the voice at once.
- **Work, felt, never faked**: `acknowledge` after a delegation, one progress line after a checkpoint (never over a
  reply; then a 2-minute cooldown), `oops` on a retried step, a celebration right before the job-done announcement
  (the announcement's voice waits for it), a wince when a job fails, a glance when you write while a job runs, and a
  mood that moves only on real events (your thanks or frustration, a job done, failed or retried). The Chief may
  mention a running job in a few words, never as a reason to wait.
- **Captions**: every voiced line shows in the live caption line under the Chief's name ("Eddie: Ha. You got me.",
  reactions in italics), at phone width on an opaque ground and up to two lines; a line whose voice renders at runtime
  (a progress line) is captioned at the glance. Text-mode fillers show as a small bubble under the face that gives way
  when the answer starts. A hello after a break shows as a caption when audio is not armed yet.
- **Nothing on a timer**: the Chief never says goodbye because the owner went quiet (they may be reading); a goodbye
  follows only the owner's own farewell or leaving the app.
- **One voice per workspace** (§8): with `/app` open in several tabs, windows or devices, only the tab you last used
  speaks; the others keep the text, captions and faces and show **Speaking on another tab · Play here**.

**Floor.**
- The Chief of Staff's card is pinned above the Directory (state ring, what they are doing, jobs running).
- Rest the pointer on a desk for 600 ms (keyboard focus 900 ms: bubble only, never voice): the face looks up and a
  bubble says a short, true line in that coworker's voice: a hello once a week ("Hi, I'm Jip, change management."),
  otherwise a beat about their craft ("Grandma refused a microwave for twenty years. Resistance is human."). Idle
  desks do not ask for work (a line that offers availability is capped to one per 10 minutes, Floor-wide). One Floor
  line per 20 s (Lively), so a sweep across a row gets one line and a row of look-ups. A hover voice that renders after
  the pointer left is not played (the bubble stays), and a card's profile loads on the dwell, not as the pointer
  crosses it. The Floor opens at the top (Back returns to where you were).
- **Reply** (click or **R**) chats in place: the coworker answers in at most two sentences, in character, in their
  own voice, and never claims or promises work (they are on no project yet; a guard rewrites any sentence that
  does). "thanks" gets their own catalog reply. After three exchanges the bubble offers their profile, which shows the
  same side-thread. Nothing of it enters Talk or the Chief's memory.
- The Directory row carries the last line for screen readers (never announced live): only Floor-meaningful lines
  (hellos, passing-by, progress), never a filler or an acknowledgement.

**Honesty** (checked by tests): grounded slots only (a line whose slot has no real value is never picked; the owner
has no name setting yet, so no line uses it); no work claimed without a real event; `juggling` only on real voice
contention; laughs never after distress, frustration or errors; nothing on page load; replayed history never speaks.

## 3. Tuning the Ambience

**Where:** the Floor header control (icon + current value) or ⌘K → "Ambience: Quiet / Lively / Buzzing". It is a
workspace setting (`PUT /api/workspace {ambience}`), default **Lively**.

| | Quiet | Lively (default) | Buzzing |
|---|---|---|---|
| Acknowledgements, fillers, phatic replies, juggling | voiced | voiced | voiced |
| Laughs, surprise, backchannels | face only | voiced | voiced, backchannel × 1.2 |
| Progress, celebration and oops lines at Talk | face only | voiced | voiced |
| A hello when you open Talk after a break (not a reply) | face only | voiced | voiced |
| Passing-by on the Floor | look-up only | bubble + soft voice, 20 s Floor gap, 10 min per desk | shorter gaps between hellos (8 s, 4 min) |
| Visible bubbles | 0 | 1 | 2 |

- **Quiet hours** (owner-local 22:00–07:00, a constant until the interruption-budget settings exist) behave like
  Quiet for ambient chatter; owner-initiated exchanges keep their reflexes, and a hover on a desk is one: it gets its
  bubble and the look-up, without a voice. The Ambience chip reads **Quiet hours** then, and its menu offers **Lively
  anyway** for the rest of the night (kept in this browser until 07:00). Dev builds can override it for a demo:
  `__headcount.living.setQuietHours(false)` in the console.
- **Reduced motion** keeps every caption and bubble and drops the gestures (faces change expression statically).
- **Voice off** keeps captions, bubbles and faces.
- The numbers themselves (probabilities, gaps, cooldowns, TTLs, gains) live in `catalog/expressions/intents.json`
  (`intents[].timing`, `defaults`, `ambience`); a change there is picked up by `pnpm dev` (the bundle rebuilds and
  both apps reload; a `pnpm dev` started before this increment needs one restart to watch those files).
- **Limits** (`apps/worker/.dev.vars`, restart after a change): `EXPR_CLIP_DAILY_LIMIT` (600 clip renders per UTC day,
  pre-voicing and runtime lines together; Mock is free), `EXPR_RENDER_PER_MIN` (30), `EXPR_PREVOICE_MAX_CLIPS` (300
  per run, ceiling 600). When the day's budget is spent, reflexes fall back to bubbles and faces.

## 4. Pre-voicing

- **Automatic**: opening Talk pre-voices the Chief's P0 (acknowledgements, fillers, backchannels, laughs, phatic
  replies, greetings, sign-offs, juggling; top 6 per intent, and every thinking filler, about 50 more clips per lead)
  then P1 (the rest of the owner-directed intents, passing-by, celebrate, oops, back-with-you). P0 decodes at once,
  then the reactions (sympathy, concern, delight, surprise, encouragement, apology); decoded P0 clips are the last to
  leave memory (48 MB of decoded audio), and Cache Storage keeps about a thousand clips, least recently used out
  first. Idempotent: a finished run with no failures and the same planned clips (voice, catalog, the Chief's name) is
  reused; a run with failed items is planned again and renders only what is missing. A catalog edit changes the
  catalog version: the next Talk open re-records the stored clips (no TTS) and renders only the changed lines.
  Coworkers render on first hover (the bubble shows at once; the voice follows in about a second the first time).
- **Clips are content-addressed** (voice + text), stored once in R2 and in the browser's Cache Storage, and shared by
  every agent with the same voice and line. A lead's clips are the ones `cw_chief` uses when that lead is chosen under
  its own name (a renamed Chief's lines with its name are workspace clips and render again).
- **The whole office** (on a running worker, clip endpoints only):

```sh
node packages/expressions/scripts/prevoice-office.mjs --dry-run            # counts, no TTS, no budget
node packages/expressions/scripts/prevoice-office.mjs --reserve 200        # render, leave 200 of today's budget
node packages/expressions/scripts/prevoice-office.mjs --p0-per-intent 2 --lead-extras none --per-intent 2   # the top of each list first
# --worker http://127.0.0.1:8787  --leads all|lead-…,lead-…  --coworkers 24  --per-intent 6  --max 1500
```

  It plans the 12 leads as they would be as Chief of Staff (`cw_<leadId>`: P0 plus the slot-free `back_with_you`,
  `celebrate`, `oops` and `micro_status` lines) and the 24 most staffed coworkers (by recipe compositions: the
  `passing_by` and `greeting` lines an unstaffed coworker can say), stops at the daily budget, and skips what is
  already stored on the next run.

**Run on the owner's server (28 September 2026, xAI).** The full plan is 36 agents, **1,399 clips** (≈ 38.8 min of
audio), under the 1,500 cap. The worker's default `EXPR_CLIP_DAILY_LIMIT` (600) allows only part of it per UTC day, and
the owner's own session needs budget too (choosing a lead pre-voices its Chief, about 185 renders), so the first pass
rendered the top of every list: **388 clips, 0 failures** (12 leads × the top 2 lines per P0 intent, 18–28 each, and
24 coworkers × 4: the top 2 passing-by and greeting lines), ≈ 12 min of audio, leaving 212 renders for the owner
today. The remaining ≈ 1,011 clips: run `prevoice-office.mjs --reserve 200` on the next two days, or raise
`EXPR_CLIP_DAILY_LIMIT` and restart. The owner had not chosen a lead yet, so no `cw_chief` clips were made.

**Cost.** The xAI TTS rate is not in the repository. At OpenAI `gpt-4o-mini-tts`'s published rate (about $0.015 a
minute of audio) the first pass is about $0.20 and the full plan about $0.60; at a pessimistic $0.05 a minute, $0.60
and $2. Clips are rendered once and kept.

## 5. Verified

**After the feel and correctness review (29 September 2026):** `pnpm typecheck` green; `pnpm test` 83 files, 972
tests (new: `content-feel.test.ts` — filler tone and ask lints, listener-sound and goodbye lints, idle desks that do
not solicit, and the filler-rotation sim bar for every lead; `runner-feel.test.ts`; the worker's `expr/feel.test.ts`;
the audio boundary cut; clip-store P0 pinning and Cache Storage trim; quiet hours and "Lively anyway"; reply
ordering in the store); `pnpm build` (the living runtime 107 kB, 39 kB gzip; the worker 7.99 MB, 1.79 MB gzip);
`pnpm e2e` 49 passed, 1 skipped (screens) (new in `living-voice.spec.ts`: a sincere "are you an AI?" gets no reflex and distress gets a
voiced sympathy and no filler; a spoken request is covered once and never repeats its words). Screenshots refreshed
on the fixer's own Mock instance (`--mock --mock-media`, ports 5187/8891; Frankie as the lead): `02`–`06`, `07`
(the Floor opened from Talk, at the top), `08`, `12`, and new `21-typed-joke-smiles`, `22-quiet-hours`,
`23-phone-live-caption`, `24-quiet-hours-hover`. The keyed-voice shots (`13`, `14`, `16`–`20`) are the integrator's
from 28 September.

Before the review:

- `pnpm typecheck` and `pnpm test` (75 files, 870 tests) green for every package of this increment; the 185
  expression-engine tests included. The parallel Inc 0.7 `packages/office` work in progress fails its own typecheck
  and one test file at the time of writing; it is not part of this increment.
- `pnpm build` (the living runtime is a lazy 102 kB chunk, 37 kB gzip; the worker bundle 7.9 MB, 1.8 MB gzip).
- `pnpm e2e`: 47 passed (screens skipped). New: `e2e/living.spec.ts` (keyless) — passing-by with look-up, an honest
  line, R to reply in place, an in-character "thanks" from that persona's own lines, Talk untouched; Ambience Quiet
  from ⌘K (look-up only, replies still come); "thanks" as a reflex reply within 1 s; a slow answer's filler that gives
  way to the answer and none for a fast one; a typed joke gets a smile, never a voiced laugh; reduced motion.
  `e2e/living-voice.spec.ts` (Mock media, a fake mic that pauses like a person) — P0 pre-voiced on Talk; a voiced,
  captioned filler that never overlaps the answer; a laugh by voice (or a smile when the draw says no) never over the
  owner; a nod in a real pause, any "mm-hm" only inside the pause; Quiet keeps a voiced "thanks" and silences the
  Floor; a job at Talk: voiced acknowledgement with a moving mouth, a progress line, the celebration before the
  announcement, mood `job.done`. `voice.spec.ts` now checks the amended X5 (a stop cue ends at the sentence, Esc at
  once).
- **A real session** on the integrator's own keyed stack (Anthropic chat, xAI voices, OpenAI STT; macOS `say`
  recordings as the microphone). Timeline and screenshots below.

### Reflex timeline (keyed, lead Eddie Ramos)

Times are from the owner's action. "voiced" = the first sample heard.

| When | Owner | What the office did |
|---|---|---|
| Talk opens | — | P0 pre-voiced in 16 s, P1 continues in the background |
| +0.2 s | types "Hi there!" | reflex reply, no model call; voiced in 30 ms from its frame, captioned |
| +2.5 s | types a question | "Let me number this out." as a bubble under the face (server safety net); the answer's voice at +4.9 s; the bubble clears on the first word |
| — | types a joke while the long answer still speaks | no reflex over an answer (by design) |
| +0.1 s … +3.8 s | types "thanks!" 1.5 s into a 5 s answer | smile at once; "Pleasure." voiced right after the answer ends (fix 1 below), captioned |
| +0.1 s | types "hi again" | "Hey. Good to see you." voiced in 31 ms, no second introduction (fix 2) |
| +0.6 / +0.8 / +1.8 s | rests on a desk | look-up; bubble "Hi! I'm Emilio. No team yet — pick me?"; his voice (first hover renders) |
| +0.6 s | rests on the next desk within 20 s | look-up only (one Floor line per gap) |
| +2.1 s | replies "What do you do here, in two sentences?" | Jip answers in character in the bubble and in his voice, no work claimed |
| +0.02 / +0.9 s | "thanks!" | "Oh, stop. My pleasure." (text / voice) |
| +2.7 s into the hold | holds to talk: "Ha ha. The printer is haunted again." | nod in the pause (the "mm-hm" lost its draw); release → transcript → smile and "Ha. You got me." voiced 222 ms after the turn, captioned; the filler yields to the answer's first word |
| +5.2 s, +10.6 s | a 10.8 s turn with a pause | a nod in each pause; nothing voiced over the owner; "Let me number this out." voiced 1.2 s after the turn; the answer at +3.2 s; the model started a job |
| +0.7 s | holds to talk: "Could you look into three packaging suppliers…" while the job runs | glance at the work, look-up, nod; filler at +1.2 s; "Copy. On it." as the steer is queued; the answer folds it into the running job |
| job done (69 s) | stays at Talk | smile, mood `job.done`; "Mm. That's very satisfying." voiced 0.96 s after `job.done`, then the announcement (it waited for the lead-in) |

Screenshots: [`screens/inc05/`](screens/inc05/) — `01-welcome` · `02-talk-ready` · `03-hello-reflex` (the live
caption) · `04-answer-streaming` (the text filler bubble) · `05-answer-done` · `06-thanks-reflex` · `07-floor` (the
Chief's card) · `08-passing-by` · `09`/`10`/`11-side-thread-*` · `12-ambience-control` · `13-joke-by-voice`
("Eddie: Ha. You got me.") · `14-job-by-voice` · `16-job-done-celebrate` · `17-announcement` ·
`18-thanks-after-answer` · `19-side-thread-long-answer` · `20-side-thread-thanks-no-echo` · after the review:
`21-typed-joke-smiles` · `22-quiet-hours` · `23-phone-live-caption` · `24-quiet-hours-hover` (and `02`–`08`, `12`
retaken on a Mock instance).

## 6. Integration changes (for reviewers)

- **Pipeline:** `pnpm expressions:build` in `postinstall`, `build`, `test`, `typecheck`, `e2e`, `e2e:screens` and at
  `pnpm dev` start (rebuilt on `catalog/expressions/**` changes); the build writes only when the bundle changed, so a
  running `pnpm dev` does not reload for nothing.
- **Lead previews** (`cw_<leadId>`) in the expression routes, for speculative pre-voicing; `prevoice-office.mjs`.
- **Fixes from the keyed session:**
  1. A phatic reply ("thanks") sent while the previous answer still spoke was dropped by the audio engine (a reflex
     never starts over an answer): it now waits for that answer, like the next answer would, with the face at once.
  2. "hi" right after Talk's opening introduction was answered with a second "Hi, I'm Eddie": the Chief's phatic
     greeting no longer uses first-meeting lines (Talk always opens with the lead's own introduction).
  3. A typed "thanks" with voice on was answered in silence while every other typed answer is spoken: phatic replies
     are now voiced like any answer when voice is on (the tab that sent the turn decides, so a late viewer update
     cannot mute it).
  4. The job-done celebration was always dropped: the announcement's voice started first, and the lead-in waited for
     it. The announcement now waits for the lead-in (≤ 3.2 s), a queued-but-silent answer no longer counts as a busy
     voice, and a progress line still sounding gives way to it.
  5. A text filler bubble stayed up after the answer started: the runner clears it on the turn's first token.
  6. A long side-thread answer was cut at four lines: it scrolls inside the bubble now; a coworker's reflex reply no
     longer shows twice in the bubble.
- **Fixes from the feel and correctness review** (36 findings: 36 fixed, 3 of them with one named part left as a
  known gap in §7, none rejected):
  - *Feel.* The server's safety-net filler reads the owner's cues: none on a sincere "are you an AI?", distress or a
    joke, none after the turn's acknowledgement, and the client drops any server filler a silent, distress-only,
    acknowledged or still-sounding turn does not want (`runner.playServerSay`). A text just said in any intent is not
    said again for the next four picks (`recent_text_hard_exclude`), and the same intent excludes its last four. The
    Chief pre-voices every thinking filler with P0 (a sim bar: no filler more than twice in 30 minutes, every lead).
    Upbeat and evaluative fillers (191 lines across leads, packs and personas) forbid a negative tone and the distress
    lock and need a question or a request (new contexts `owner_asks`, `after_distress`); presupposing lines were
    reworded ("what could ship by Friday"), and a lint test keeps it so. Reactions (P1) decode after P0, and their
    length limits now fit real clips (sympathy, concern, delight 2.8 s; a 40-character line was always "too long"
    at 1.8 s), so sympathy and concern are voiced. The prompt says what the office already voiced and forbids an opening "Ha", "Ooh" or
    "On it"; a stream filter drops one; replies vary their first word, offer more work rarely and never after a
    joke, and never give the owner the lead's own lore. A typed follow-up never cuts the reply still writing, and the
    voice now stops at the sentence playing (≤ 4 s) with a short "got it". Idle desks: 110 persona hellos lost the
    "No … yet." template and are said once a week; 220 new craft beats; 24 archetype lines rewritten; every line that
    offers availability is flagged `solicits` (lint). No goodbye after five quiet minutes; "don't miss me" lines went.
    Holding fillers get room (`max_ms` 3000; thinking 2600) and fall back to a bubble; decoded P0 is kept in memory
    first. The live caption is legible at phone width. Faces: a larger smile with a squint, a held look-up brow, and a
    reaction the thinking look-up never covers; a typed joke is captioned "(smiles)". Quiet hours: a hover still gets
    its bubble, the chip says "Quiet hours" and offers "Lively anyway". The Floor opens at the top. The text filler
    waits for the Chief's usual first token and shows ≥ 0.9 s; progress lines are captioned at the glance; a hover
    voice that arrives after the pointer left is dropped; the job-done celebration plays right before its
    announcement (the announcement's speech renders during it); listener sounds lost "!" and upbeat words; Buzzing
    says what it does; a hello before audio is armed is shown and counts; the Directory's "said" line skips fillers.
  - *Correctness.* Only a backchannel sounds while the mic is live (the audio port drops the rest). A pre-voice run
    with failed items is never reused, and `alreadyCached` reports real counts; the fingerprint covers the planned
    clips (a renamed Chief is a new plan). The quick-chat guard straightens curly apostrophes and catches "I can pull
    that together", "I'll have it on your desk". A phatic "thanks" never aborts the answer being written. The clip
    budget fails closed on a D1 error. A repeat "hi" inside its cooldown is voiced. A lead change clears the old
    mood and palette on the client, and palettes decay with the mood (recomputed every 60 s and on presence).
    `expr.recent` sends only the last 30 minutes, and waits for the catalog compile instead of blocking the object.
    The Chief is never a first meeting on the client either. Profiles load on the dwell, not on pointer-enter. Cache
    Storage is trimmed (LRU, about 1,000 clips) and older `hc-expr-*` caches are deleted.
- **Tests adjusted to the increment:** Floor specs scope to Directory cards (the Chief's card is a card too); the
  reload spec counts Talk turns only (Floor quick-chats replay into side-threads); the voice barge-in spec follows the
  amended X5; the frame recorder hooks the store once (the dev hook object is re-assigned when the runtime loads).
- Dev hook: `window.__headcount.audio` (the engine) for e2e probes; `window.__headcount.voice` (`clientId()`, `owner()`,
  `here()`) for voice ownership (§8).

## 7. Known gaps

- **Pre-voicing on the owner's server is a first pass** (388 of 1,399 clips) because of the 600-a-day clip budget; see
  §4 for the command that finishes it. The review fixes changed catalog content (fillers, listener sounds, unstaffed
  lines), so the catalog version moved: the next Talk open re-records the Chief's stored clips without TTS and renders
  about 50 more (every thinking filler) plus the few changed lines; `prevoice-office.mjs` re-records the office the
  same way and renders the new unstaffed beats (two per coworker with a signature).
- **The model is told what the office already said by kind, not word for word**: the prompt is built before the
  tab's own reflex plays, so the turn note says "a laugh" or "an acknowledgement already played" from the owner's
  cues, and a stream filter drops a leading "Ha,", "Ooh," or "On it —". A reflex the server sends later in the turn
  (the safety-net filler) is known only to that filter.
- **Distress lock**: for 30 minutes after distress, fillers stay but only calm ones (upbeat and evaluative lines
  forbid `after_distress`); a sincere "are you an AI?" and the distress turn itself get no filler at all.
- **The celebration does not yet prefer a line that names the job**: it now plays right before the announcement
  (whose speech renders during it), so the referent follows at once, but lines with `{artifact}` are not favoured.
- **A typed follow-up waits for the reply still being written** (≤ 6 s) before its own answer starts; a short "got
  it" covers the wait. Only a short stop ("stop", "wait, cancel") or speaking over the reply cuts its text.
- **Backchannel voices are rare**: the nod always comes, but the "mm-hm" plays at most 60% of the time and only from
  decoded clips; right after a reload few are decoded yet. Listener sounds no longer carry "!" or upbeat words (they
  are timed by the owner's pauses and cannot hear a complaint).
- **A coworker's first hover renders their voice at runtime** (about a second after the bubble) unless the office was
  pre-voiced; if the pointer has left by then the voice is dropped and the bubble stays. Rendering on pointer-enter
  was not adopted: every card crossed would spend a paid render.
- Side-talk between coworkers stays engine-only (Inc 1 has the events), so Buzzing only shortens the gaps between
  hellos; no `deferral`; no owner-name setting; OpenAI clips use text timing (no voiced-segment alignment); no
  backchannels in keyless dictation mode; quiet hours are owner-local 22:00–07:00 (the "Lively anyway" override lasts
  the night, per browser) and "Caption reactions" is a constant; the 2.9 MB bundle is not compressed in local dev.

## 8. One voice per workspace (29 September 2026)

**The owner's report:** "I am hearing duplicate responses spoken out loud." The owner had `/app` open in their browser
while the in-app Browser pane had `/app` open too.

### Root causes

1. **No voice coordination between clients.** Every open `/app` tab with voice on voiced every Chief answer
   (`startChiefVoice` had no tab rule), every job announcement, every Floor quick-chat reply, and, in every visible
   tab at Talk, every progress line and celebration (the event-reflex rule picked tabs by stage, not one tab). Measured
   on a Mock + mock-media instance with two tabs, before the fix: the delegation answer, the progress line, the
   celebration and the job-done announcement were each voiced in both tabs; only owner-turn reflexes ("hi") were
   voiced once.
2. **Hot updates doubled the living runtime (dev).** Vite re-evaluates every module between an edited file and the
   nearest component boundary but disposes only the boundary. `living/index.ts` sits in that chain for any edit under
   `living/`, `voice/` or `store/`, so each such save booted a second reflex runner beside the first, both subscribed
   to the same store: every server `reflex.say` (fillers, acknowledgements, progress lines, celebrations, phatic
   replies) then played twice until a reload. The owner's `pnpm dev` hot-reloads every save the parallel workflows
   make, so this compounded the first cause. (Found in Vite's HMR client, which calls `dispose` only for the accepting
   module, and in the boot path, which had no teardown for an earlier runtime; the dev log shows these partial
   updates, never a full reload.) The runtime and the audio engine are now handed over on a hot update (`lib/hot.ts`);
   after two hot updates on the fixer's instance: one engine, each reflex once.

**Single-tab audit (no other duplicates).** On the fixer's own Mock + mock-media instance with one client, counting
every engine `speak` chunk, prepared-clip play, browser-voice reflex and TTS request per line: "hi", "thanks", a slow
question typed and by voice (filler + answer), a joke by voice (laugh), a delegation by voice (acknowledgement), a
steer (acknowledgement), the progress line, the job done (celebration + announcement), a failed job (announcement),
a passing-by line and a side-thread reply, a reload mid-answer, Talk → Floor → Talk, and two hot updates: every line
voiced exactly once, no TTS request twice. A reload never re-speaks: replayed frames are applied `live: false`.

### The rule

Only one client speaks at a time: the **voice owner**, the tab of the most recent owner interaction (a talk send,
push-to-talk, a steer, a desk reply, any real click or key press in `/app`, or switching back to that tab or window).
The other tabs keep the thread, captions, bubbles and faces, and show one small chip, **Speaking on another tab · Play
here**, in the Talk and Floor headers; pressing it (or anything else in that tab) moves the voice there, and the tab
that had it goes quiet at once. A click, a key press or coming back counts only in a page that is on screen and has
focus: an agent driving the in-app Browser pane (its input is trusted and focuses the page, but the pane reports
`hidden`) never moves the voice.

- **Reload** keeps the voice (the tab keeps its client id), and so does a worker restart (every socket closed: the
  tab that spoke gets the same 5 s grace while the tabs reconnect). A wake from hibernation keeps the voice where it
  was (who speaks is stored). **Closing** the tab with the voice hands proactive speech (announcements, progress lines,
  reflexes) to the most recently active remaining tab after 5 s, and that tab voices, once, the job announcements that
  arrived during those 5 s (no tab voiced them); with no tab left, nothing speaks. A tab that only opens never takes
  the voice (alone on the workspace, it has it at once).
- **Same browser** hand-offs are immediate (BroadcastChannel; the tab that had the voice goes quiet and answers at
  once). Another device goes quiet when the server's `voice.owner` reaches it (one round trip): until its claim is
  echoed, the claiming tab leaves any line that starts meanwhile to that device. A message that was streaming when the
  voice moved is never picked up in the middle: the new owner speaks from the next message on.
- Barge-in (Esc, a tap on the face, holding to talk), push-to-talk and "sending while they speak" work as before in
  the tab with the voice; the same gesture in another tab first takes the voice.
- The landing page never speaks.
- Contracts: [CONTRACTS.md](CONTRACTS.md) §8 (client id, `ready.data.voice`, `voice.owner`, `voice.claim`, the
  `clientId` on talk, steer and desk requests).

**After this change, reload each open `/app` tab once:** a runtime booted before the hot-update handover existed
cannot be found and disposed by it, so a long-open tab may still hold a second one.

### Verified

- `pnpm typecheck` green (all packages, `packages/office` included at the time of writing); `pnpm test` 86 files,
  1001 tests (new: `apps/worker/src/workspace/voice.test.ts` — owner tracking, claim echoes, the reload grace, the
  fallback to the most recently active client, nobody when no client is left, hibernation re-check, a restarted
  object that does not hand the voice to the first tab back, HTTP claims on
  talk, steer and desk, the owner's view for event reflexes; `apps/web/src/voice/owner.test.ts` — claims and echoes,
  settle timeout, legacy servers, the landing page, trusted non-modifier gestures only, the BroadcastChannel hand-off,
  client ids across reloads and copied tabs, Chief voice gating and going quiet on hand-off;
  `apps/web/src/lib/hot.test.ts` — the runtime, engine and client id across a simulated hot update; a runtime test
  that a tab without the voice plays no reflex); `pnpm build` green.
- `pnpm e2e`: 53 passed, 1 skipped (screens); the `living-voice` project again on the final state: 12 passed. New
  `e2e/one-voice.spec.ts` (project `living-voice`): two browser
  contexts on one workspace (only the tab with the voice plays each line, the other keeps the text and shows the chip;
  "Play here" and any click take the voice); closing the owner's tab hands the job-done announcement to the other
  tab, voiced once; two tabs of one browser hand over at once mid-answer and nothing is said twice; one tab: every
  path of the audit above plays each line exactly once and a reload never says anything again.

**Verification round (same day).** Fixed after an independent check:
- **A wake from hibernation muted the tab left behind.** The restart grace went to the stored owner on every new
  object, including wakes that kept their sockets, and nothing re-checked when it ended: after the owner's tab closed,
  every 25 s ping woke a fresh object that named the closed tab again, and a lone tab on a cold workspace never got the
  voice. Now the grace is given only when no socket is left (a real restart), always with a re-check at its end, and
  who speaks is stored (`voice_published`). Live on wrangler dev (a Node client pair, 80 s idle): before, the remaining
  tab was muted from the first ping on (57 of 70 s); after, it kept the voice with no re-announcement, and a cold
  single tab had it at once.
- **Announcements during the 5 s grace were voiced nowhere**: the fallback now carries `unvoicedAfter` and the new
  owner voices them once (new e2e below).
- **Agent clicks in the in-app Browser pane took the voice**: measured in the pane, automated input is trusted and
  focuses the page, but the page reports `hidden`; claims now need a page on screen with focus. Live: clicks and
  typing in a pane tab of `/app` never moved the voice from the other client.
- **Cross-device overlap**: a line that starts before the claim is echoed stays with the old device.
- **Switching back to a tab** (tab strip or window) now takes the voice, so progress lines and celebrations are voiced
  when the owner looks at Talk in another tab.

Checks: `pnpm typecheck` green; `pnpm test` 93 files, 1099 tests (new: hibernation wakes keep the fallback, a cold lone
tab, the restart grace for the tab that spoke, `unvoicedAfter`; hidden or unfocused pages never claim, coming back
claims and opening does not, unsettled claims and the same-browser yield, the grace catch-up once and never for old
news; a reaction before the echo stays captions-only); `pnpm build` green; `pnpm e2e` 53 passed, 1 skipped, then
`one-voice.spec.ts` with the new test (the owner's tab closes as the write-up starts; the announcement lands in the
grace and is voiced once by the other tab) 15 of 15 with `--repeat-each 3`.

**A reply that ended while the socket was down (fixed).** When the owner feed dropped mid-answer and came back after
the reply finished, the reply's `talk.message` and `talk.done` arrived as history (`live: false`) and the voices
ignored them: the reply's speech stream stayed open, and every later line of the Chief's in that tab (job
announcements, and the progress lines and celebrations that wait for a free voice) queued behind it until a barge-in or
a typed message (sending while the Chief speaks stops the reply at its sentence). Reproduced with a page script on a
Mock + mock-media instance: the announcement never played and `activity('cw_chief')` stayed
`{conversation: true, streamOpen: true}`. Now an end that is not voiced (replayed, or voice turned off meanwhile)
still ends what streamed in that tab, where it is: the sentences already cut play, an unfinished last one is dropped,
nothing new is said. The same holds for a worker restart mid-answer (the recovered `talk.done` names no message: the
reply is found by its turn), for Floor quick-chat replies, and in the living runtime (a replayed end of a turn this tab
saw live closes that turn in the runner silently, so no "still working on it" or "I'm all yours" follows it). One voice
per workspace and the fallback catch-up are unchanged; replayed history still never speaks. Checks: `pnpm typecheck`
green; `pnpm test` 94 files, 1115 tests (new: `apps/web/src/voice/replayed-end.test.ts`, the speaker's `endHere`, the
runtime and the runner closing a replayed turn silently, the chunker and speech stream dropping an unfinished last
sentence, the engine queue moving on once such a stream ends); the page script again: the announcement plays and the
engine is idle; `living-voice` e2e 14 passed, with a new `one-voice.spec.ts` test that drops the real socket
mid-answer (half-open, then closed after the answer finished) and checks the job-done announcement is voiced after the
reconnect (it failed without the fix).

**A socket that came back while the answer still streamed (fixed, same day).** Found when that fix was checked; an
older gap of the same kind. Deltas are never replayed, so what streamed while the socket was down was lost, and the
live deltas after the reconnect were appended to the same open utterance with a hole in the middle: the chunker joined
the two halves into one garbled sentence (a page script: "And the secWant the details?"; the new e2e before the fix:
"… brand?". I Add a provider key or start Ollama for real ones."). The live `talk.message` could not repair it (its
text is added only when it starts with what streamed). Now every new `ready` ends whatever is still streaming in that
tab (Chief replies and Floor quick-chat replies, `AgentSpeaker.endStreaming`) the same way as a replayed end: the
sentences already cut play, an unfinished last one is dropped, and later deltas and the live end of that message are
ignored. The rest shows as text. A reply that starts after the reconnect is voiced in full. Replayed history still
never speaks, and the grace catch-up is unchanged (still voiced once when the voice falls to this tab on a `ready`).
Checks: `pnpm typecheck` green; `pnpm test` 94 files, 1120 tests (new: the socket coming back mid-reply for the Chief
and on the Floor, a reply after the reconnect, a reconnect with nothing streaming next to the catch-up, and
`endStreaming` in the speaker); a new `one-voice.spec.ts` test replays the frames a page gets when its socket comes
back mid-answer (`ready` at its cursor, the late deltas with the middle ones lost, then the live end) and checks that
only the first sentence is voiced and the job-done announcement follows (it failed without the fix with the garbled
sentence above); `living-voice` e2e 15 passed on the final state. On two earlier full runs three other tests failed
once each and passed alone on rerun: push-to-talk and a two-tab send each timed out waiting for a frame, and the one-tab
audit drew the same acknowledgement clip twice, 27 s apart. None of them touches the reconnect path.

### Known gaps

- **A socket that comes back mid-answer** ends that answer's voice where it was, even if no delta was lost
  meanwhile (deltas carry no position, so a hole cannot be detected). The rest shows as text only.
- **A reload mid-answer** voices the rest of that answer from the first words that arrive after the tab reconnects
  (never what was already said), which can start mid-sentence.
- **Cross-device hand-off** waits for the server's `voice.owner` (one round trip): a line that starts within that
  round trip is voiced by the old device until the word reaches it, then stops; the new device shows it without
  voicing it.
- **A page that reports `hidden` while on screen** (some embedded webviews) takes the voice with Play here or an owner
  action (talk, steer, desk reply), not with a click. An in-app Browser pane that is on screen and reports `visible`
  with focus counts an agent's clicks as the owner's; one click in the owner's tab takes the voice back.
- A tab opened within 5 s after the voice owner's tab closed stays silent until its first gesture or the end of that
  grace. Lines that arrive while the owner's tab reloads are replayed, not voiced (only a close is caught up), and
  progress lines and celebrations from that grace are not caught up (old news by then).
- Hovering a desk in a tab without the voice shows the passing-by bubble without voice until a click there; event
  reflexes (progress line, celebration) are voiced only by the tab with the voice while it shows Talk.
- Seen during the audit, not a duplicate and not changed here: a "thanks" typed while the "hi" reply still plays is
  dropped by the one-reflex-at-a-time queue (TTL).
