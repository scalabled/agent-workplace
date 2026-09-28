# Living Workforce: content and timing critique

> **Status.** Review of E1 (engine) and E2 (content) for LIVING-WORKFORCE Inc 0.5, 28 September 2026. No catalog or engine files were changed; every fix below is a proposal.
>
> **Reviewer's lens.** A sitcom writer's ear (does this sound like a person?), a conversation designer's rigour (does the line fit what was actually said and what is actually true?) and a UX researcher's fear of annoying users (would this still be charming in week three?).
>
> **What was read.**
> - The spec and rules: [OWNER-DIRECTIVES.md](../OWNER-DIRECTIVES.md) (D2, D3, D5), [LIVING-WORKFORCE.md](../LIVING-WORKFORCE.md) in full, and the EXPERIENCE sections on the Floor (§3.2), the attention budget (§8), i18n (§9.3), sound (§10.7) and copy voice (§10.8).
> - `catalog/expressions/intents.json` in full: intents, timing, Ambience profiles and the affect lexicon.
> - `archetypes.json` in full.
> - All 12 archetype packs: seven in full, and meticulous, gentle, visionary, analytical and veteran on every owner-facing intent.
> - All 12 lead signature packs on the high-frequency and personality intents: backchannel, acknowledge, thinking_filler, laugh, gratitude_reply, greeting, passing_by, quip, sign_off, celebrate and the catchphrases.
> - 49 persona signature packs in full, drawn from all 18 department files.
> - The engine: `select.ts`, `state.ts`, `gate.ts`, `recency.ts`, `sidetalk.ts`, `lines.ts`, `affect.ts` (reaction precedence) and the owner-turn and hover paths in `runner.ts`.
>
> **Catalog-wide scans.** All 17,890 lines were scanned by script. The validator (`node catalog/scripts/validate-expressions.mjs`) reports 0 errors and 4,799 warnings. Selection shares were estimated with the engine's own prior, mood-fit, `estimateMs` and temperature 0.7.
>
> **How it was judged.** Every line quoted here was read aloud in its persona's voice, in the moment the trigger would fire it, against the most likely thing the owner had just said.

---

## 0. Verdict on one screen

The raw material is good. The best lines sound like people you would hire: dry, warm, specific and a little self-aware ("Unused servers are horses nobody rides. Still eating, though."; "An apology with a 'but' in it is an argument wearing a nice coat."; "I'll leave that out of the minutes."). The engine design is also right: grounded slots, contention-only juggling, seeded anti-repetition, an Ambience ladder, and owner-directed reflexes exempt from the budget.

Five problems stand between this and a Floor the owner still enjoys in week three.

1. **Reflexes presuppose what the owner said.** Reflexes fire 150–700 ms after the owner's turn ends, before any model has read it, so a line may assume only what the sniffer knows. The catalog assumes much more:
   - **121 fillers** praise a question ("Ooh, good question — give me a sec.") after turns that were requests.
   - **80 acknowledgements** praise the request ("Ooh, fun. On it.") even when it is "chase the client who hasn't paid in 90 days".
   - **42 gratitude replies** thank the owner back ("Aw, thanks!"), which only fits praise.
   - **32 encouragements** answer "am I crazy?" when the owner only said "worried".
   - **Domain reactions** answer any news with the persona's topic ("Hm. That's eating the margin.", "Okay. Don't click anything yet.").

   This is the biggest source of "fake" and it is fixable with four sniffer-derived contexts (E4).
2. **Some lines claim things that aren't true.**
   - 28 unblock lines thank the owner, but most unblocks are not the owner's doing.
   - Several passing-by lines attach a second activity to the real `{step_label}` ("Reading one-star reviews", "Tab, tab, tab", "Drawing the fan", "Humming a theme").
   - "I tested it" in a review claims a test that may never have run.
   - A juggling line invents a phone call ("mid-call").
   - Embodiment slips through: "Headphones on", "Happy tears", "You and me both".
3. **Honest lines are being dropped for being too long.** By the engine's own `estimateMs`, 1,775 slot-free lines (10% of the catalog) exceed their intent's `max_ms` and can never be selected. That includes 56% of `concern` lines, 34% of fillers and 30% of acknowledgements. In **98 of 132 packs, not one `steer_queued` acknowledgement fits**, so the D2 promise "that lands at the next step" is exactly the line that goes missing.
4. **Signature tics will wear the owner out.** Signature lines carry 1.6 weight and each high-frequency intent has only 2–8 of them, so they take **41–80% of all picks** for that intent. The most distinctive lines are therefore the most repeated:
   - Dominic's "Copy" opens about one acknowledgement in three.
   - Sasha says "move" or "checkmate" in about 22 lines.
   - DevOps says "boring" 8 times, and Creative Director says "brave" 9 times.
   - Catalog-wide writer tics repeat: "is just vibes" ×15, "X wearing a Y" ×10, "I keep a list/jar/log" ×16, "graveyard" ×5.

   Recency memory does not protect low-frequency intents, because it is one 40-entry list shared by all intents. Quips, greetings and catchphrases (83 of which have no daily cap) will recur daily for weeks.
5. **Some lines are patronising or needy toward the owner.**
   - 84% of idle passing-by lines ask for work, so hovering down a quiet Floor becomes a chorus of "Got anything for me?".
   - 9 of 12 leads greet the owner at 6 pm with "let's keep it short / brief / gentle", and the other three with "Quick one?".
   - Sign-offs set homework ("Three things, remember.", "What will you do differently tomorrow?").
   - Lines advise the owner on self-care ("Be kind to yourself") or security habits ("Don't click strange links").
   - Replies grade the owner's jokes ("I'll allow it.", "Slightly.", "Seen that before. Still funny.").

| Dimension | Now | Main reason | After the fixes |
|---|---|---|---|
| Feels alive and human | Good | Distinct voices, real texture, contractions, self-deprecation | Very good |
| Honest (L2/H1–H6) | Needs work | Unblock thanks, extra activity claims, invented call, embodiment | Good |
| Fits what the owner said | Weak | Presuppositions in fillers, acks, encouragement, gratitude, domain reactions | Good |
| Varied over weeks | Weak | Signature concentration, tics, single LRU, uncapped catchphrases and quips | Good |
| Laughs, sighs, whispers | Mixed | Laughs are well written, but 97% render as one of two xAI sounds; whisper is used 14 times in 17,890 lines | Good |
| Not annoying (L4) | Lively OK, Buzzing risky | Hover sweeps bypass the global gap; Buzzing budget ≈ 1 voiced minute per 10; laugh p ≈ 0.86 | Good |
| Inclusive and culturally aware | Mostly good | "crazy/dumb" ×16, weekend and weekday assumptions ×28, "Oi", untranslated heritage phrases on English TTS | Good |

---

## 1. What already works (keep it)

- **The persona writing is specific and likeable.** Examples:
  - Minutes-scribe Winston: "Minutes, not a transcript. The difference is mercy."
  - Head of support: "A chatbot with no way to a human is a maze with a smiley face."
  - Security: "'We're too small to be a target,' said every target."
  - Localisation: "Translate a joke one word at a time and it arrives with no punchline."
  - IT support: "The weird-but-true log is my favourite document. Printers feature heavily."

  These are the lines that make the owner smile on the tenth hearing, because they are about the work and nobody is the butt of the joke.
- **`never_says` choices show care.** Examples: inclusion-partner bans "crazy", "lame" and "differently abled"; community-moderator bans "karen" and "cringe"; IT support bans "just", "simply" and "user error"; escalations bans "calm down" and "you should have".
- **The laugh intent is varied in wording.** It mixes nonverbal captions ("(snorts, then composes self)", "(a beat, then a quiet laugh)") with verbal laughs ("Heh. Fair.", "Okay, that one caught me off guard.").
- **Sympathy is handled well.** 44% of sympathy lines are wrapped in `<soft>`. None claim shared experience, and none mix in jokes.
- **Lengths are disciplined.** No quip exceeds 20 words. Only 10 high-frequency, non-first-meeting lines exceed 12 words, and all of them are self-introductions or juggling lines that need the words.
- **Juggling is well written.** Playful's `<whisper>I'm mid-sentence elsewhere.</whisper> Back in {eta}.` is exactly the "real person in a meeting" texture D5 asks for. There should be more of it (§2.4).
- **Lore-true cultural touches, used sparingly, land well.** Examples: "Hwyl" and "Chwarae teg" (Owen), "Head aega" (Kadri), "Hamba kahle" (Bongani) and "Mahalo" (Luana). They are mostly glossed and mostly capped with `max_per_day`.

---

## 2. Findings

### 2.1 Honesty and grounding (fix before the Inc 0.5 exit gate)

| Pattern | Evidence | Why it matters |
|---|---|---|
| Thanking the owner for an unblock | 28 lines across all 12 archetypes and all 12 leads (e.g. `warm.unblocked.04` "Thank you, {owner_name}. Off we go again.", `lead-warm-mentor.unblocked.02`) | `step.unblocked` also comes from retries, coworker answers and connectors recovering. H2/L2: a line may only say what the cause event says. |
| A second activity attached to the real step | `marketplace-specialist.passing_by.02` "{step_label}. Reading one-star reviews. For fun.", `accessibility-specialist.passing_by.02` "Tab, tab, tab.", `data-scientist.passing_by.01` "Drawing the fan.", `podcast-producer.passing_by.03` "Humming a theme for {project}.", `security-analyst.passing_by.02` "Reading headers like horoscopes." | The step is grounded but the tail invents concurrent work. The owner reads these as status. |
| Claims of actions or tests | `analytical.review_approve.04` "I tested it. It holds up."; `collections-specialist.juggling.02` "I'm mid-call on something" | The first is H2; the second invents a phone call as the contention (H5, H6). |
| Embodiment | `podcast-producer` "Headphones on" ×3, `social-media-manager` "Happy tears" ×2, `lead-seasoned-veteran.laugh.11` "You and me both." (agreeing with "I'm so tired lol") | H6. The validator's embodiment lint lists coffee, lunch and sleep but not these. |
| Promises with no context | `fpa-analyst.sign_off.02` "I'll have the why ready when you're back."; `lead-scrappy-hustler.sign_off.07` "I'll keep an eye on the cash."; `growth-lead.sign_off.01` "Three experiments, remember." | Sign-off honesty says future work may be mentioned only when it is scheduled. |
| Greetings that promise a report | "Start-of-shift hand-over, whenever you're ready", "Ready for three numbers?", "Ready for pre-shift?", "Lots to talk about." | These are fine when there is news since the owner's last visit, and hollow when there isn't. Gate on `has_updates` (E24). |
| Invented specifics about the owner's world | `bookkeeper.quip.03` "Tuesday bread is my favourite" (a vendor), `bookkeeper.ask_coworker.02` "who the tape guy is" | An owner can mistake these for their real vendors. Quips must be about the kind of work (intent honesty rule). |
| "Nobody saw that" on a retry | `playful.oops.07` | `oops` fires only while the owner is watching, so the line is false every time it plays. |

### 2.2 Reflexes that presuppose what the owner said

The runner fires reactions 120–350 ms after the end of the owner's turn and fillers at 700 ms, from `sniffOwnerText` alone. The sniffer knows `question`, `request`, `humor`, `praise` versus `gratitude`, `doubt`, `badNews` and `frustration`, but **none of these reach the line's `context`**. `deriveContexts` only sees time, history, work and exchange flags. Lines therefore cannot be gated on what was said, and many are written as if they could.

| Presupposition | Count | Typical failure |
|---|---|---|
| "Good / great / fair / big question" in fillers | 121 of 1,129 fillers | Owner: "Draft the refund email." Agent: "Ooh, good question — give me a sec." |
| Evaluative acks ("love this", "fun", "great shout", "this one matters", "Beautiful.") | 80 of 716 context-free acks | Owner: "Chase the client who hasn't paid in 90 days." Agent: "Ooh, fun. Getting on it." |
| Thanking back or modesty in `gratitude_reply` | 42 of 288 | Owner: "thanks". Agent: "Aw, thanks!" or "Stop, you're too kind." These fit only when the owner praised. |
| "You're not crazy" / "not a dumb question" | 32 of 276 encouragements (16 use "crazy" or "dumb") | The doubt cue fires on "worried" or "not sure", so "You're not crazy" answers something the owner never said. |
| Domain-specific reactions | Most personas have 1–3 | Hospitality concern "Hm. That's eating the margin." is about 26% of that persona's concern picks, so "the landlord cancelled the lease" gets a margin remark. Security concern "Okay. Don't click anything yet." Marketplace "Let's see who took the podium." |
| Laughs that assume the joke was about the agent | ≈ 12 (e.g. "Fair. I do love a label.", "Guilty. Colour-coded and everything.", "Okay, I'm impatient. Guilty.", "Guilty as charged.") | The spec's own demo joke ("the printer's haunted again") makes these nonsense. |
| Topic-framing fillers | e.g. `tech-lead` "At ten times the load, or a tenth?", `hospitality-operator` "Star, plowhorse, puzzle or dog?", `social-media-manager` "reading that like a sceptical teenager" | They frame every question as the persona's topic. They are charming once and odd daily. Cap them and gate on `activity:*`. |

**Fix pattern.** Pass the owner's cues into `GroundingState.exchange` and emit the contexts `owner_question`, `owner_praise`, `owner_self_doubt` and `owner_tone:positive|neutral|negative` (E4). Emit `topic:<domain>` when the owner's text matches the persona's skill keywords (E19). Then tag the lines, as listed in §4.

### 2.3 Repetition, tics and wear-out over weeks

**Signature concentration.** Each signature line's prior is 1.6× (versus the blend weight, at most 0.6, for an archetype line). After temperature 0.7 that makes it 4–13× as likely per line. The effect by pack:

| Agent · intent | Eligible lines | Signature lines | Share of picks from signature lines | Most likely single line |
|---|---|---|---|---|
| lead-steady-operator · acknowledge | 27 | 8 | ≈ 80% | "Copy. On it." ≈ 10% |
| lead-dry-strategist · thinking_filler | 27 | 4 | ≈ 65% | "Mm. Running the counter-move." ≈ 20% |
| lead-warm-mentor · thinking_filler | 36 | 6 | ≈ 68% | "Ooh, that's a good one. One moment." ≈ 12% |
| tech-lead · acknowledge | 29 | 3 | ≈ 58% | "Understood." ≈ 19% |
| tech-lead · thinking_filler | 38 | 2 | ≈ 41% | "Good question. Let me frame the trade-off." ≈ 20% |
| hospitality-operator · concern | 35 | 1 | ≈ 26% | "Hm. That's eating the margin." ≈ 26% |

A Chief of Staff produces dozens of fillers and acks a day, so the most characterful line (Sasha's chess filler) is heard several times a day, every day. It is the line most likely to become irritating.

**Tics and motifs within one persona.** Examples:
- Dominic: "Copy" ×8 plus the "Copy that." catchphrase.
- Sasha: "move", "checkmate" and "queen" ×22; "Compared to what?" is also Kadri's catchphrase.
- Owen: "gate" ×11. Rafael: "hand-over" ×8 and "checklist" ×8. Selam: "dream" ×12 and "chapter" ×9.
- Zuri: "band", "tempo", "setlist" and "B-sides" ×14. Juno: "code name" ×5 and "steal list" ×4.
- DevOps: "boring" ×8 and "in a file" ×4. Creative Director: "brave" ×9. Marketplace: podium, halftime and climb ×18.
- Escalations: "Kia ora" ×7 and "gently" ×7. The gentle archetype itself: "gently" ×16.

**Tics shared across the catalog.** The Floor starts to sound like one writer:
- "is just vibes" ×15, "X wearing a Y" ×10, "I keep a list/jar/log/folder" ×16, "I name every X after Y" ×8, "graveyard" ×5.
- "read it like a tired customer/reviewer" ×8, "count to five before filling a silence" ×6, "good bones" in 8 of 12 archetypes, "…metaphorically" ×6.
- 145 signature texts are shared by 4 or more personas within the same intent. For example, "Fair." is a sidetalk reply in 19 packs, and "Take care, {owner_name}." a sign-off in 16. A signature line that 16 people say is not a signature, but it still gets the 1.6 weight.

**Recency cannot protect low-frequency intents.**
- `createRecencyMemory` keeps one 40-entry list per agent across all intents, and the same-intent hard exclusion reads from that list.
- An hour of conversation pushes a morning's quips, greetings and sign-offs out of memory, so tomorrow's picks ignore them.
- `max_per_day` is the only longer-horizon tool, and 83 of 297 persona catchphrases lack it.
- Result: a persona with about 10 activity-matching quips repeats one within a couple of days. The owner will notice a repeated joke long before a repeated "mm-hm".

**Personas are silent in the most human moments.** The validator reports that none of the 162 persona packs has signature lines for sympathy, encouragement, surprise, celebrate, blocked, unblocked, oops, apology or gratitude_reply. Those are exactly the moments in which personality counts ("That's one for the wall of wins" is Bongani's line; his `celebrate` is generic). Add 1–2 signature `celebrate`, `unblocked` and `oops` lines per persona, seeded from the catalog `celebration_style`.

### 2.4 Laughs, sighs and whispers

| Tag | Archetype packs (5,077 lines) | Lead packs (4,113) | Persona signatures (8,328) | Assessment |
|---|---|---|---|---|
| `[laugh]` | 158 | 161 | 612 | Right place (laugh, delight, celebrate), right density |
| `<soft>` | 130 | 97 | 208 | Good in sympathy, too rare in late-night sign-offs |
| `[pause]` | 176 | 27 | 249 | Good dry-wit timing, but each costs 300 ms and pushes reactions over `max_ms` |
| `[breath]` | 68 | 21 | 14 | Under-used in persona packs, where a pre-filler breath is the cheapest "human" cue |
| `[sigh]` | 24 | 12 | 2 | Correctly kept out of requests and greetings; used for relief and bad news; fine |
| `<whisper>` | 9 | 3 | 2 | **Almost unused.** It is D5's own example tag and the best "multitasking human" cue |
| `[sharp-breath]` | 7 | 6 | 11 | Fine |

**Laugh kinds collapse into two sounds on xAI.** Persona laugh styles are chuckle 50, warm_laugh 52, dry_huff 18, giggle 14, belly_laugh 11, breathy 11, snort 4 and silent_smile 2. But 158 of 162 render their signature laugh as either `[laugh]` (91) or `<soft>[laugh]</soft>` (67). The snort, giggle, dry "heh" and belly laugh the owner asked for only exist on OpenAI (`say` plus `instructions`) and in captions. E13 maps each kind to an xAI composition:
- snort: `[sharp-breath] [laugh]`
- giggle: `<fast>[laugh]</fast>`
- dry "heh": `[breath] <soft>[laugh]</soft>`
- belly laugh: `[laugh] [laugh]`, capped by Ambience

Verbal laughs ("Heh.", "Ha.") already give xAI a spoken "heh". Keep them.

**Where the tags are misused.**
- `playful.thinking_filler.11` puts a `[laugh]` inside a filler, so the agent laughs at the owner's question.
- `lead-warm-mentor.laugh.02` "(groans, then laughs)" `[sigh] [laugh]` is lovely texture, but keep it rare.
- `playful.blocked.03` whispers a blocker, the one thing the owner must hear clearly.
- `playful.passing_by.06` opens with `<whisper>Shh</whisper>`, which shushes the owner.

**Where whispers belong.** Juggling asides while holding the floor in a voiced meeting ("<whisper>In the review — back in {eta}.</whisper>"), side-talk asides that are voiced only for listeners ("<whisper>between us, this one's good</whisper>" in `share_result` or `review_approve`), and late-night sign-offs. Add 1–2 per archetype in `juggling` (context `in_meeting`) and `sidetalk_reply`.

### 2.5 Side-talk

- **Laughing replies after a block.**
  - 167 `sidetalk_reply` lines carry no `reply_to:*` context, and 97 of them laugh or quip ("[laugh] Fair.", "Heh. Accurate.", "[laugh] Oh, that's classic.", "Legend.").
  - `proposeSideTalk` sets `replyTo`, but context-free lines stay eligible, and a matching `reply_to` line gets only a 1.3× bonus.
  - In six department files the templated `sidetalk_reply.02` ("[laugh] Fair." / "Noted.") has 1.6 signature weight.
  - So after "Holding this one, Juno — four to fix first," the likeliest reply is a chuckle, which is a sneer at a colleague (H4) played on the Floor. E7 fixes this in the engine; §4 fixes the content.
- **Variety is fine for openers.** The runtime gist carries the novelty. Replies are thin (3–5 per persona, and 16 per archetype of which only 13 are contextual).
- **Grounding is solid.** Side-talk comes only from events, `owner.firstName` is nulled, and whispers and owner-only events are dropped. Keep it.
- **Cross-persona duplicates on the same pod are the risk.** Community-manager and community-moderator tell the same "unwritten rules" joke, and UX writer and QA automation both "read it like a tired customer". Pods are exactly where these two personas meet.

### 2.6 Tone toward the owner

- **Brevity nags in the evening.** 46 evening and late-night greetings tell the owner to keep it short or go to rest. For 9 of 12 leads, the only evening greeting (17:00–22:00) says "keep it short / brief / tight / gentle / to one number", and the other three ask "Quick one?". Evening is prime admin time for small-business owners. Restrict these to `late_night` (E15, §4).
- **Parenting.** Examples: "Don't stay up too late." (veteran greeting), "Be kind to yourself." (post-purchase and gentle), "Go easy on yourself." (warm, with no context), "Take a breath." (calm-steady sympathy to a frustrated owner), "Don't click strange links." ×2 (security), "Log off on time."
- **Homework at sign-off.** Examples: "Three things, remember.", "Three experiments, remember.", "What will you do differently tomorrow?", "Thank someone today.", "Go be brave.", "Keep dreaming."
- **Needy idle desks.** 209 of 246 idle `passing_by` lines ask for work ("Throw me something", "Pick me?", "use me"). One is charming; a Floor of them is guilt (H7, no emotional pressure). Rewrite about half as content-but-available lines (see §4), and add a Floor-wide limit of one soliciting line per 10 minutes (E25).
- **Grading the owner's jokes.** Examples: "Ha. I'll allow it.", "Okay, that one got me. Slightly.", "Seen that before. Still funny.", "No surprises there, then." Dry wit is fine; judging the owner's joke is not.
- **Grudging or bossy one-worders from blunt voices.** "Fine. I'll handle it.", "Back. Go.", "Right, {owner_name}. Go.", and "Fine —" to a steer. Blunt should be plain, not reluctant.
- **Cringe and dated phrases.** Examples: "Toodle-oo", "Catch you on the flip side", "Ideas, assemble!", "Let me consult my inner genius", "Challenge accepted", "Like an onion. A nice onion.", and "Okie" / "Heyyy" / "Vibes check" stacked in one persona.

### 2.7 Culture and inclusion

- **"crazy" and "dumb".** They appear in 16 lines, mostly echoing the lexicon cue "am i crazy" / "is this dumb". Echoing the owner is natural only if they said it (E4 `owner_self_doubt`); otherwise it introduces the word. Rewrite the lines, and add both words to `GLOBAL_NEVER_SAYS` for owner-facing intents (E12).
- **Work-week assumptions.** 28 lines assume Monday to Friday with a weekend off ("Friday! Nearly there.", "Enjoy your weekend.", "How was your weekend?", "You've made it through the week."). Retail, hospitality and fitness owners work weekends, and some regions rest Friday–Saturday. Add a workspace `work_days` setting and emit `workweek:first_day` / `workweek:last_day` contexts (E14). Pao's "Saturday! Good day for a test." shows the right instinct.
- **Heritage-language phrases.** Examples: Lingala ("Malamu" ×4), te reo Māori ("Kia ora" ×7), Zulu, Fijian, Kinyarwanda, Amharic, Welsh, Estonian and Spanish.
  - Used sparingly, these are warm and lore-true.
  - Used densely, and spoken by an English-first TTS voice with no pronunciation channel on xAI (the `tags.xai` readable-equals-text invariant forbids respelling), they risk mispronunciation of someone's heritage language, which reads as disrespect.
  - Fix: cap them (`max_per_day: 1`, family caps in E21), always gloss them in the caption, and voice them only through OpenAI with instructions or after a pronunciation-QA flag on the clip (E17).
  - Kadri's "Võrreldes millega?" is allowed in `surprise`, so the owner's big news gets an untranslated Estonian reaction.
- **"Oi, {owner_name}!"** (Diego, Brazilian). It is friendly in Portuguese and a rude shout in British English. Use "Olá".
- **Owner-directed jargon that assumes the owner's industry.** Grace's "How's service?", "Ready for pre-shift?" and "Good service.", and Selam's ten-year exercises. Lore should colour the agent's own speech, not presume the owner's world.
- **Stereotype check.** No ethnic or gender stereotypes were found. Owen's sheepdog jokes come from his own farm lore, which is fine. "Sceptical teenager" (social-media-manager) and the community-moderator's Gen-Z stack are the closest to caricature; tone them down.

### 2.8 Timing, budgets and Ambience

**Lines that can never play.** 1,775 slot-free lines estimate over their intent's `max_ms`:

| Intent | Share over `max_ms` |
|---|---|
| concern | 56% |
| thinking_filler | 34% |
| apology | 31% |
| acknowledge | 30% |
| laugh | 21% |
| encouragement | 17% |

The estimator is realistic ("Ah. That's disappointing." with a sigh ≈ 1.75 s), so the budgets are what's tight: concern `max_ms` is 1,500 while sympathy's is 1,800.

- **Steer acknowledgements do not fit at all.** Most steer lines run 1.75–2.6 s against a 1.6 s budget, and 98 of 132 packs have zero that fit. Worse, when `steer_queued` holds, generic acks stay eligible, and the steer lines only get ×1.3. Even a pack with a fitting steer line mostly says "Love it. On it." to a mid-work steer. Use context-first selection (E5) and a per-context `max_ms` (E6).

**Reflexes delay the real answer.** Brain audio queues behind a playing reflex. Timeline of a typical turn:
- The ack starts at +250 ms and lasts up to 1.6 s.
- The first speakable chunk is ready at about 1.1 s but waits until about 1.85 s.
- If a filler starts at 700 ms and runs 1.8 s, a chunk that arrives at 900 ms waits until about 2.5 s.

Cap acks and fillers by predicted first-chunk latency, using a rolling p50 per agent (E6). Short fillers ("One sec.") should beat clever ones whenever the model is fast.

**Laughs and backchannels fire too reliably.**
- Laugh probability for a playful lead is 0.8 × readiness 0.9 × (1 + 0.5 × 0.4) ≈ **0.86**. A laugh at nearly every joke reads as sycophantic.
- Backchannel probability in Buzzing for an energetic persona is ≈ 0.55 × 1.2 × 1.2 × 1.15 ≈ **0.9** per qualifying pause.

Cap laughs at 0.65 (below that, a smile only) and backchannels at 0.6 (E10). Lexicon-driven laughs should also require badNews < 0.3 and frustration < 0.3: today "haha great, the site's down again" laughs, because "down" is not in `bad_news`.

**Hover sweeps.**
- Only `passing_by` has a global gap. `micro_status`, `quip`, `blocked` and `unblocked` fire per agent, bounded only by the chatter bucket.
- A pointer sweep across a busy pod can therefore produce three bubbles in about two seconds in Lively, and six in Buzzing.
- `max_visible_bubbles` is only checked for > 0 in `gate.ts` and never counted.

Apply one Floor gap to every Floor intent, and enforce the bubble count (E8).

**Buzzing.** 5 chatter lines a minute, burst 6, 60 s of voiced ambient per 10 minutes, a 15 s pod gap, and voice whenever the Floor is on screen. That is about a minute of overheard talk every ten minutes, and it speaks even when the owner is reading. It sounds lively in a demo and is tiring on a second monitor.
- Proposed limits: 3 lines a minute, burst 4, 40 s per 10 minutes, a 30 s pod gap.
- Voice only when the owner has interacted with the Floor in the last 2 minutes.
- Habituate: after 10 minutes of passive viewing, fall back to Lively (E9).

**Sign-off on stage close.** Talk→Floor navigation counts as a close, so "Take care, {owner_name}. Good thinking today." plays when the owner glances away for 20 seconds. Defer the sign-off, cancel it if the owner returns, and never fire it on in-app navigation (E20).

**Distress lock.**
- A single lexicon hit silences laughs, quips and celebrations for the rest of the session.
- False positives include "happy accident", "crisis comms plan" and "we're planning layoffs". Make the lock first-person and time-bounded, 30 minutes (E11).

**Inert `never_says` entries.** 13 lead entries carry a parenthetical qualifier, e.g. "failure (about a person)", "always (about trends)" and "no worries (when there are worries)". `containsPhrase` matches the literal string, so these never fire (E12).

---

## 3. Engine and timing fixes

Numbered E1–E25; §4 refers to these numbers. Each is small. The first eight fix most of what an owner would notice.

1. **E1 · Per-intent recency and weekly wear-out.**
   - Replace the single 40-entry list with a ring per intent (N = max(3, ⌈eligible/2⌉)).
   - Persist 7-day use counts in `RecencySnapshot`.
   - Multiply the score by 0.7^(uses in the last 7 days).
   - Add `max_per_week` (default 2 for `quip`, and for lines with a `catch` source).
2. **E2 · Default caps.** Apply `max_per_day: 1` to catchphrases that lack one (83 persona catchphrases) and to every `quip`. The validator should warn when a signature line in a high-frequency intent contains a tic word (E21 families) and has no cap.
3. **E3 · Per-intent source weight.** Keep signature weight 1.6 for greeting, passing_by, quip, sign_off, celebrate and side-talk. Use 1.0 for backchannel, acknowledge, thinking_filler, holding_filler, concern, delight, surprise and sympathy. Evidence: 41–80% of picks come from 2–8 lines (§2.3).
4. **E4 · Contexts derived from the owner's cues.**
   - Carry `AffectCues` into `GroundingState.exchange`.
   - `deriveContexts` emits: `owner_question` (from `cues.question`), `owner_praise` (praise ≥ 0.6), `owner_gratitude`, `owner_self_doubt` (new lexicon entries "am i crazy", "is this dumb", "stupid question"), and `owner_tone:negative` (badNews, frustration or correction ≥ 0.3; otherwise `positive` or `neutral`).
   - Content then gates: 121 fillers → `owner_question`; 42 gratitude replies → `owner_praise`; 32 encouragements → `owner_self_doubt`; 80 evaluative acks → `!owner_tone:negative`.
5. **E5 · Context-first selection.**
   - When the trigger sets a specific context (`steer_queued`, `interrupted`, `owner_greeting`, `owner_farewell`, `first_meeting`, `reply_to:*`, `after_blocker` for celebrate), first restrict the pool to lines that require it.
   - Fall back to generic lines only if none are eligible.
   - Today the ×1.3 bonus lets generic lines win.
6. **E6 · Duration budgets that match the moment.**
   - Add `max_ms_by_context` in `intents.json`: acknowledge `steer_queued` / `interrupted` → 2,400.
   - Raise concern `max_ms` from 1,500 to 1,800.
   - For voice acks and fillers, pass `maxDurationMs = clamp(p50FirstChunkMs(agent) − elapsed, 900, def.max_ms)`, so fast brains get short reflexes.
7. **E7 · Side-talk reply gating.**
   - `sidetalk_reply` needs a matching `reply_to:*`, or an explicit `reply_to:any` tag.
   - When `replyTo` is `review_changes` or the verdict is `block`, exclude every line containing `[laugh]`, "Ha" or "Heh", and every one-word reply.
   - Apply the cross-agent dedupe per pod as well as per viewer.
8. **E8 · One Floor gap.**
   - Apply `passing_by`'s global gap (Lively 20 s, Buzzing 8 s) across all Floor intents (`passing_by`, `micro_status`, `quip`, `blocked`, `unblocked`).
   - Enforce `max_visible_bubbles` by count in the runner (or in the caption port's contract), not only `> 0` in `gate.ts`.
9. **E9 · Buzzing retune.**
   - `chatter_per_min` 5→3, `chatter_burst` 6→4, `ambient_voice_s_per_10min` 60→40, `sidetalk.pod_gap_ms` 15,000→30,000.
   - Side-talk voice only if the owner interacted with the Floor in the last 120 s.
   - Habituation: after 10 minutes of passive Floor visibility, use Lively limits until the next interaction.
10. **E10 · Probability ceilings.**
    - Laugh p ≤ 0.65; below it, play the silent-smile face cue.
    - Backchannel p ≤ 0.6.
    - Lexicon laughs need `humor ≥ 0.6 && badNews < 0.3 && frustration < 0.3`; otherwise wait for a `⟦react:laugh⟧` hint.
    - Treat "no kidding" as non-humor, and add "down again", "broken", "crashed" and "not working" to `bad_news`.
11. **E11 · Distress lock.** Make it 30 minutes instead of the whole session. Require first-person or second-person proximity ("my", "our", "I'm"). Add negative patterns such as "happy accident", "crisis comms", and "layoffs" in a planning context.
12. **E12 · `never_says` hygiene.**
    - When compiling, strip parenthetical qualifiers into a phrase plus an optional intent scope, or have the validator flag the 13 inert entries.
    - Add to `GLOBAL_NEVER_SAYS` for owner-facing intents: "crazy", "dumb", "insane", "lame", "calm down".
13. **E13 · Laugh rendering per kind.** When `laugh_style.xai` is plain `[laugh]` or `<soft>[laugh]</soft>`, derive the rendering from `kind`:
    - chuckle `<soft>[laugh]</soft>`
    - dry_huff `[breath] <soft>[laugh]</soft>`
    - snort `[sharp-breath] [laugh]`
    - giggle `<fast>[laugh]</fast>`
    - breathy `[breath] <soft>[laugh]</soft>`
    - belly_laugh `[laugh] [laugh]` (Ambience-capped)
    - warm_laugh `[laugh]`

    Keep captions as written.
14. **E14 · Work-week contexts.** Workspace `work_days` (default Mon–Fri) → `workweek:first_day`, `workweek:last_day`, `weekend`, `works_weekends`. Migrate the 28 weekend and weekday lines.
15. **E15 · Evening versus late.** A validator lint: greetings in `part_of_day:evening` must not contain brevity or rest words ("short", "brief", "quick", "tight", "rest", "late"); those belong to `late_night`.
16. **E16 · Grounding lints.**
    - (a) In passing_by and micro_status, flag concrete activity verbs after `{step_label}` or `{project}` ("reading", "drawing", "humming", "tab", "testing").
    - (b) A hard-coded first name must equal the persona's catalog first name (55 packs hard-code names) or be `{self_name}`.
    - (c) Extend the embodiment lint with headphones, tears, humming, "mid-call" and "you and me both".
    - (d) Flag `juggling` lines without `{other_thread}` that name a specific other activity.
17. **E17 · Non-English phrases.**
    - A `lang` flag on lines with non-English words.
    - Default `max_per_day: 1`.
    - A caption gloss is required.
    - Voice them only with the OpenAI provider (instructions carry pronunciation) or when the clip manifest carries `pronunciation_checked`; otherwise use the English variant.
18. **E18 · `unblocked_by:owner`.** Derive it from the `step.unblocked` cause (the actor is the owner, or a decision the owner approved). The 28 owner-thanking unblock lines require it.
19. **E19 · `topic:<domain>`.** Match the owner's text against the persona's skill and domain keywords from `catalog/personas` and `skills`. Domain-specific concern, delight, surprise and laugh lines require it. Neutral lines cover the rest.
20. **E20 · Sign-off timing.**
    - On stage close, defer 1.5 s.
    - Cancel if the owner opens another stage or returns within 60 s.
    - Never fire on Talk↔Floor navigation; only on an explicit farewell, leaving the app, or 5 minutes idle.
21. **E21 · Phrase-family caps.**
    - An optional `family` on lines (e.g. `copy`, `kia-ora`, `boring`, `move`, `gate`, `vibes`) with `family_max_per_day` on the signature pack.
    - `max_per_day` is per line, but a tic is spread across many lines.
22. **E22 · Signature distinctness lint.** Warn when a signature line duplicates an archetype line, or when the same text appears in 4 or more signature packs (currently 145 texts). Suggest downgrading it to weight 0.6 or moving it into the archetype pack.
23. **E23 · `step_label` grammar.**
    - Emit `step_ing` when the label starts with an -ing verb.
    - Require it on lines that splice the label as a predicate ("Busy {step_label}", "Still {step_label}", "I'm {step_label}", "Quietly {step_label}").
    - The route table's running copy is verb-first but not guaranteed to be a gerund ("Competitor grid: step 3").
24. **E24 · `has_updates` context.** True when there are unseen ledger events since the owner's last visit. Report-promising greetings require it ("hand-over", "three numbers", "full board", "Lots to talk about", "What moved?").
25. **E25 · Idle solicitation cap.** A `solicits: true` flag on idle lines that ask for work. At most one such line per 10 minutes across the Floor; other idle hovers pick the content-but-available lines.

---

## 4. Content fixes

Each row names the file, the exact line ids and a drop-in replacement or tag. "E#" refers to §3. The table is generated from the same list returned to the workflow.

| # | File | Target | Issue | Fix |
|---|---|---|---|---|
| C1 | `packs/*.json + leads.json` | analytical.unblocked.04, blunt.unblocked.06, calm-steady.unblocked.04, dry-wit.unblocked.06, energetic.unblocked.05, gentle.unblocked.02, gentle.unblocked.04, hustler.unblocked.04, meticulous.unblocked.04, playful.unblocked.05, veteran.unblocked.04, visionary.unblocked.04, warm.unblocked.04, lead-*.unblocked.02 (11 leads; not lead-steady-operator), lead-warm-mentor.unblocked.06, lead-dry-strategist.unblocked.08, lead-gentle-encourager.unblocked.05, lead-steady-operator.unblocked.03 | 28 lines thank the owner for an unblock, but step.unblocked can come from a retry, a coworker's answer or a connector recovering. Thanking the owner for something they did not do is an ungrounded claim, and the lead lines carry the 1.6 signature weight, so they win often. | Add "context": ["unblocked_by:owner"] to every one of these lines (engine fix E18 derives the context from the cause event's actor). Leave weight at 0.6 for the archetype ones. Until the context exists, drop "{owner_name}"/"Thank you" from the lead lines, e.g. lead-warm-mentor.unblocked.02 -> "We're unstuck. Off we go." |
| C2 | `intents.json` | intents[unblocked].examples[1] "Unstuck. Thanks, {owner_name}."; intents[encouragement].examples[1] "You're not crazy. Let's look at it together." | The spec examples model two patterns the critique asks writers to avoid: an ungrounded thank-you and "crazy" as reassurance. | Replace them with "Unstuck. On we go." and "It's a fair thought. Let's look at it together." Add a note to intents[unblocked].honesty: "Thanks the owner only with context unblocked_by:owner." |
| C3 | `packs/*.json (acknowledge, context steer_queued)` | analytical.acknowledge.09/.10, blunt.acknowledge.09/.10, energetic.acknowledge.09/.10, gentle.acknowledge.09/.10, meticulous.acknowledge.09/.10, playful.acknowledge.09/.10, visionary.acknowledge.09/.10, warm.acknowledge.08/.09, dry-wit.acknowledge.08/.09, calm-steady.acknowledge.09/.10 | By the engine's own estimateMs, 98 of 132 packs have no steer_queued acknowledgement under acknowledge.max_ms (1600 ms). Selection drops them as too_long, so a steer mid-work gets either nothing or a generic "Love it!", and loses the honesty promise that the change lands at the next step. | Rewrite to 8 syllables or fewer, e.g. "Noted — next step.", "Got it. Lands next step.", "Change noted. Next step.", "Okay — folding it in next.", "Noted. Next checkpoint." (one distinct wording per pack). Also apply engine fix E6 (max_ms by context), which covers the persona and lead steer lines. |
| C4 | `packs/analytical.json` | analytical.encouragement.03, analytical.encouragement.10 | "Not crazy." and "It's not a dumb question." presuppose that the owner said "am I crazy / is this dumb". Encouragement fires on any doubt cue ("worried", "not sure"), so these read as non-sequiturs, and "crazy"/"dumb" are words the inclusion-partner persona itself bans. | .03 -> "Worth testing, actually."  .10 -> "That's an important question." and add "context": ["owner_question"] (engine fix E4). |
| C5 | `packs/blunt.json` | blunt.encouragement.05, blunt.encouragement.08 | Same presupposition and inclusion problem ("Not crazy.", "It's not a dumb question."). | .05 -> "Reasonable. Let's size it."  .08 -> "Fair question. Worth asking." with "context": ["owner_question"]. |
| C6 | `packs/calm-steady.json` | calm-steady.encouragement.02, calm-steady.sympathy.02 | .02 uses "crazy". sympathy.02 "That's a lot. Take a breath." is aimed at a frustrated owner (frustration ≥ 0.5 triggers sympathy), and it lands like "calm down". | encouragement.02 -> "It's a fair thought. Let's look at it properly."  sympathy.02 -> "That's a lot. Let's slow it down." (keep the <soft> wrapper). |
| C7 | `packs/dry-wit.json` | dry-wit.encouragement.02, dry-wit.encouragement.12 | "You're not crazy." and "Not dumb. Not even close." have the same presupposition and inclusion problem. | .02 -> "Not reckless. Ambitious, which is better."  .12 -> "Honestly? It holds up." |
| C8 | `packs/energetic.json` | energetic.encouragement.04, energetic.encouragement.12 | "Not crazy at all." and "Not a dumb question at all!" have the same problem. | .04 -> "Worth a shot. Let's test it."  .12 -> "Great thing to be asking!" with "context": ["owner_question"]. |
| C9 | `packs/hustler.json` | hustler.encouragement.02, hustler.encouragement.10 | "Not crazy — scrappy." and "It's not dumb. It's early." have the same problem. | .02 -> "Not reckless — scrappy. I like it."  .10 -> "It's not wrong. It's early." |
| C10 | `packs/meticulous.json` | meticulous.encouragement.03, meticulous.acknowledge.14 | .03 "Not crazy at all." has the same problem. acknowledge.14 "Perfectly clear. On it." claims understanding at +250 ms, before the conversation layer has read the turn, and the brain may ask a clarifying question straight after. | .03 -> "Entirely reasonable. Let's verify it."  acknowledge.14 -> "Understood. On it." |
| C11 | `packs/playful.json` | playful.encouragement.02 | "Not crazy. Fun-crazy, maybe." uses "crazy" twice. | -> "Bold. Fun-bold, even. Let's try." |
| C12 | `packs/veteran.json` | veteran.encouragement.02 | "You're not crazy." has the same presupposition and inclusion problem. | -> "You're not off base. You're thinking ahead." |
| C13 | `packs/visionary.json` | visionary.encouragement.08 | "You're not crazy. You're early." has the same problem, and "early" also recurs in red-team-sceptic.quip.03 and hustler. | -> "You're not wrong. You're ahead." |
| C14 | `packs/warm.json` | warm.encouragement.02, warm.sign_off.09 | encouragement.02 uses "crazy". sign_off.09 "Go easy on yourself." has no context, so it assumes a rough day and reads as therapy-speak after an ordinary session. | encouragement.02 -> "It's a fair thought. Let's look at it together."  sign_off.09 -> "Bye, {owner_name}. Good to talk." (or gate the original on part_of_day:late_night). |
| C15 | `packs/energetic.json` | energetic.acknowledge.01, energetic.acknowledge.05, energetic.acknowledge.07, energetic.concern.07, energetic.backchannel.03 | The acks praise the request ("love this one", "Ooh, fun", "Great shout") at +250 ms, before any model has read it, so they can land on "chase the client who hasn't paid in 90 days". concern.07 "Aw, bummer." makes light of real bad news. backchannel "totally" is agreement, which the backchannel honesty rule forbids. | ack.01 -> "On it — right away!"  ack.05 -> "Okay! Getting on it."  ack.07 -> "Good — on it." (or add "!owner_tone:negative" per E4).  concern.07 -> "Aw, that's a shame."  backchannel.03 -> "mm-hm, yeah". |
| C16 | `packs/playful.json` | playful.acknowledge.01, .02, .06, .07, .13 | The evaluative acks ("a fun one", "I like this one", "The fun list") are tone-deaf on serious requests. The meme acks ("Challenge accepted.", "faster than you can say 'spreadsheet'") wear out within a week. | .01/.07/.13: add "context": ["!owner_tone:negative"] (E4) and weight 0.6.  .02 and .06: add "max_per_day": 1 and weight 0.5. |
| C17 | `packs/visionary.json` | visionary.acknowledge.01, .02, .04, .06, .07; visionary.greeting.13 | The acks judge or inflate every request ("Love this", "Let's build it", "This one matters", "Great direction", "I'll bring it to life") even when it is "pull last month's invoices". greeting.13 "Lots to talk about." promises news that may not exist. | Add "!owner_tone:negative" to .01/.02/.06. .04 -> "On it, {owner_name}."  .07 -> "Understood. I'll get it moving."  greeting.13 -> "Welcome back, {owner_name}. Good to see you." |
| C18 | `leads.json` | lead-straight-shooter.acknowledge.03 "Got it. Firing now." | The kitchen word "firing" is a real hazard on an HR request ("we need to let Sam go" -> "Got it. Firing now."), and it also claims immediate action. | -> "Got it. Starting now." |
| C19 | `personas/core-crew.json` | facilitator catch.02 "Beautiful." (intents acknowledge, handoff_take, sidetalk_reply; mpd3) | As an acknowledgement, "Beautiful." praises whatever was asked, including bad-news requests. | Remove "acknowledge" from intents (keep handoff_take and sidetalk_reply). |
| C20 | `packs/dry-wit.json` | dry-wit.thinking_filler.01, .04, .06, .10; dry-wit.laugh.07, .11; dry-wit.oops.10 | The joke fillers ("Irritatingly good", "It happens occasionally", "be clever about it", "Visibly, I hope") fire on every slow turn and go stale in days, and .01 presupposes a question. laugh.07 "I'll allow it." and .11 "...Slightly." grade the owner's joke. oops.10 "Let's pretend that didn't happen." jokes about hiding a visible retry. | Fillers: add "max_per_day": 1, and give .01 "context": ["owner_question"].  laugh.07 -> "Ha. That landed."  laugh.11 -> "Okay, that one got me." (drop "[pause] Slightly").  oops.10 -> "Not that way, then. Again." |
| C21 | `packs/playful.json` | playful.thinking_filler.07, .10, .11, .14; playful.holding_filler.04, .10 | .07 "inner genius", .10 "Visibly" and .14 "Ideas, assemble!" grate after a few hearings. .11 puts a [laugh] inside a filler, which sounds like laughing at the owner's question. holding.04 is a three-sentence Shrek riff during a wait. holding.10 "Juggling a few thoughts" reads as the fake busyness L3 forbids. | .07/.10/.14: "max_per_day": 1, weight 0.5.  .11 tags.xai -> "Hmm. [pause] Okay, give me a moment."  holding.04 -> "This one's got layers. Still peeling."  holding.10 -> "Turning a few ideas over here." |
| C22 | `packs/playful.json` | playful.passing_by.06, playful.oops.07, playful.blocked.03, playful.greeting.01, playful.greeting.02 | passing_by.06 greets the owner with "Shh". oops.07 "Nobody saw that." is false by construction, because oops only fires while the owner watches. blocked.03 whispers a blocker the owner needs to hear. greeting.01/.02 open with a [laugh] at nothing, and "Ready for adventures?" is cringe. | passing_by.06 text -> "Top secret: {step_label}. Very serious business." with xai "<whisper>Top secret:</whisper> {step_label}. Very serious business."  oops.07 -> "Well, that was educational. Again!"  blocked.03 -> "Heads up — I'm stuck: {blocker}." (no whisper).  greeting.01 xai: remove [laugh].  greeting.02 -> "Oh, good morning! What are we making today?" with no [laugh]. |
| C23 | `packs/playful.json` | playful.backchannel.04 "oh really", playful.backchannel.08 "oh-ho", playful.concern.08, playful.sign_off.01, playful.sign_off.08 | Dropped into an owner's pause, "oh really" sounds sarcastic and "oh-ho" sounds sly. concern.08 "That's a bummer." makes light of bad news. "Toodle-oo" and "Catch you on the flip side" are dated and cringe. | backchannel.04 -> "ooh, and?"  .08 -> "mm, go on".  concern.08 -> "That's a blow. Let's see."  sign_off.01 -> "See you soon, {owner_name}!"  sign_off.08 -> "Later! Back to the fun bit." |
| C24 | `packs/hustler.json` | hustler.passing_by.16, hustler.concern.07, hustler.backchannel.03, hustler.sidetalk_reply.14, hustler.sidetalk_reply.15 | passing_by.16 "I'm free — use me." is awkward, with a possible innuendo. concern.07 "Bummer." makes light of bad news. backchannel "totally" is agreement. sidetalk_reply.14 "[laugh] Oh, that's classic." and .15 "Legend." have no reply_to context, so they can answer a block verdict. | passing_by.16 -> "Hi {owner_name}. I'm free — send something my way."  concern.07 -> "That's a knock. Let's regroup."  backchannel.03 -> "yep, go on".  sidetalk_reply.14: add "context": ["reply_to:answer_coworker"].  .15: add ["reply_to:review_approve"]. |
| C25 | `packs/*.json (sidetalk_reply .14–.16)` | warm.sidetalk_reply.14, energetic.sidetalk_reply.14/.16, playful.sidetalk_reply.14/.16, visionary.sidetalk_reply.14/.16, gentle.sidetalk_reply.14, calm-steady.sidetalk_reply.14, dry-wit.sidetalk_reply.14/.16, analytical.sidetalk_reply.14, blunt.sidetalk_reply.14, meticulous.sidetalk_reply.14, veteran.sidetalk_reply.14 | These context-free laughing or knowing replies ("[laugh] Fair.", "Ha — love it.", "Heh. Accurate.", "That's sweet.") are eligible after ANY opener, including "Holding this one — four to fix". A laugh there reads as a sneer at a colleague (H4). | Add "context": ["!reply_to:review_changes", "!reply_to:handoff_give", "!reply_to:ask_coworker"] to each. Engine fix E7 makes this the default. |
| C26 | `personas/{data-analytics,engineering,finance-accounting,legal-compliance,people-culture,product}.json` | sidetalk_reply.02 in every pack of these six files (e.g. tech-lead, devops-engineer, ai-engineer, data-scientist, location-analyst, bookkeeper, collections-specialist, fpa-analyst, privacy-specialist, employment-policy-drafter, payroll-benefits-admin, inclusion-partner, ux-researcher, prototype-builder …) | The templated "[laugh] Fair." / "<soft>[laugh]</soft> Noted." / "Love it." reply has no reply_to context and carries 1.6 signature weight, so every one of these ~50 personas laughs back at block and changes verdicts. "Fair." alone appears as a signature reply in 19 packs. | Give each one a reply_to context that suits a laugh ("reply_to:answer_coworker" or "reply_to:celebrate"), and rewrite so it stops being a clone. Examples: tech-lead -> "Heh. That's going in an ADR."; devops -> "Heh. Noted, in UTC."; bookkeeper -> "Ooh, that's filed!"; data-scientist -> "Seventy percent useful. Thanks."; privacy-specialist -> "Gracias. Field answered." |
| C27 | `packs/analytical.json` | analytical.review_approve.04 "I tested it. It holds up."; analytical.laugh.05 & .09 | review_approve.04 claims a test the reviewer may never have run (H2). laugh.05 "Statistically, that's funny" and .09 "That's funny. Empirically." are the same joke, and lead-data-analyst.laugh.04 repeats it a third time in Kadri's pool. | review_approve.04 -> "Checked it. It holds up."  laugh.09 -> "Ha. Didn't see that one coming." Keep only one "statistically" line across analytical plus lead-data-analyst: change lead-data-analyst.laugh.04 -> "Ha. That's outside the normal range." |
| C28 | `packs/veteran.json` | veteran.laugh.06, veteran.greeting.09, veteran.acknowledge.10 | laugh.06 "Seen that before. Still funny." tells the owner their joke is old. greeting.09 "Don't stay up too late." parents the boss on arrival. ack.10 "Fine — that lands..." sounds grudging in response to a steer. | laugh.06 -> "[laugh] Haven't heard it put that way."  greeting.09 -> "Hi, {owner_name}. Quiet hour. What do you need?"  acknowledge.10 -> "Right — that lands at the next checkpoint." |
| C29 | `packs/blunt.json` | blunt.acknowledge.05, blunt.back_with_you.02, blunt.back_with_you.07, blunt.greeting.07 | "Fine. I'll handle it." sounds reluctant to the owner. "Back. Go." and "Right, {owner_name}. Go." give the boss orders. greeting.07 "Evening. Let's keep it short." brushes off an owner who opened the stage at 6 pm, prime admin time for small businesses. | ack.05 -> "Sure. I'll handle it."  back_with_you.02 -> "Back. Go ahead."  .07 -> "Right, {owner_name}. Go ahead."  greeting.07 -> "Evening. What's on?" |
| C30 | `packs/gentle.json + catalog/expressions/archetypes.json` | ex-dry-wit passing_by exemplar (archetypes.json) "Riveting, genuinely."; gentle: acknowledge.09, micro_status.01/.04, holding_filler.05, concern.05, sympathy.08, oops.02, unblocked.03, sidetalk_reply.06, greeting.02/.15, sign_off.02, review_changes.01/.09, passing_by.04 | The archetype name leaks into its lines: "gentle/gently" appears about 16 times in the gentle pack, and escalations-specialist and ux-researcher add more. Within a week the owner hears it as a verbal tic. The dry-wit exemplar models sarcasm about the owner's work. | Remove "gently" from at least 10 gentle lines (e.g. acknowledge.09 -> "Noted — I'll fold that in at the next step."; passing_by.04 -> "Still {step_label}."; sign_off.02 -> "Have a calm {part_of_day}."). Change the dry-wit exemplar to "Still {step_label}. Quietly satisfying." |
| C31 | `leads.json` | lead-dry-strategist: thinking_filler.03, thinking_filler.12, celebrate.04, catch.02; plus about 22 "move(s)" lines | thinking_filler.03 copies the dry-wit archetype "Irritatingly good" joke almost word for word, so Sasha (dry-wit 0.6) gets it twice. celebrate.04 repeats the gratitude_reply.10 "working on modesty" gag. catch.02 "Compared to what?" is also Kadri's (lead-data-analyst) signature catchphrase, and leads must be distinct. "Move/moves/checkmate" appears in about 22 of Sasha's lines; signature fillers take about 65% of picks, so the chess bit is heard many times a day. | thinking_filler.03 -> "Good question. Let me find the catch."  .12: "max_per_day": 1.  celebrate.04 -> "Good work. That one opens real options."  catch.02 -> "And then what?" (from his own signature_phrases).  Rewrite at least 8 "move" lines to other language (e.g. acknowledge.04 -> "Clear. Doing it."; sign_off.11 -> "Until next time.").  Also greeting.11 "Hello. Your move." -> "Hello. What's on your mind?" |
| C32 | `leads.json` | lead-steady-operator: acknowledge.01, acknowledge.03, acknowledge.10, gratitude_reply.02, laugh.06, laugh.10, sign_off.02, backchannel.01, greeting.07 | "Copy" opens 8 lines as well as the mpd3 catchphrase "Copy that.", and signature acks make up about 80% of Dominic's picks, so roughly one ack in three is "Copy". laugh.06 "Copy. Loud and clear." and laugh.10 "Parking lot that one." don't work as laughs and brush off the joke. greeting.07 "Let's keep it brief" is the evening brush-off. | Keep "Copy" in acknowledge.01 and the catchphrase only. acknowledge.03 -> "On it, {owner_name}."  gratitude_reply.02 -> "Happy to."  sign_off.02 -> "See you later."  laugh.06 -> "[laugh] Okay. That one's good."  laugh.10 -> "[laugh] That's a keeper."  greeting.07 -> "Evening, {owner_name}. What's the next action?" |
| C33 | `leads.json` | evening greetings: lead-energetic-spark.greeting.08, lead-meticulous-planner.greeting.07, lead-straight-shooter.greeting.07, lead-seasoned-veteran.greeting.07, lead-data-analyst.greeting.07, lead-warm-mentor.greeting.07, lead-gentle-encourager.greeting.07 | 9 of the 12 leads' only evening greeting (17:00–22:00) says to keep it short, brief, tight, gentle or to one number, and the other three ask "Quick one?". Evening is when many owners do their admin, and hearing "let's keep it short" from your own chief of staff every evening reads as a brush-off. Across all packs, 46 evening and late-night greetings nag about brevity or rest. | Move the brevity wording to part_of_day:late_night (22:00–05:00). Rewrite the evening ones warmly, e.g. energetic-spark -> "Evening! What's on your mind?"; meticulous-planner -> "Good evening. What's on the list?"; straight-shooter -> "Evening. What do you need?"; veteran -> "Evening. What's on?"; data-analyst -> "Good evening. Which number's on your mind?" |
| C34 | `leads.json` | lead-warm-mentor.greeting.10, greeting.15, sign_off.01; lead-seasoned-veteran.laugh.11 | "What shall we learn today?" and "Report card time soon" cast the owner as a pupil, and Samuel's own never_says bans condescension. sign_off.01 "Good thinking today" praises the owner after any session. Jo's laugh "You and me both." agrees with whatever the owner joked about ("I'm so tired lol"), which claims shared tiredness (H6). | greeting.10 -> "Hello again. What shall we work through today?"  greeting.15 -> "Happy Friday, {owner_name}. Let's look back at the week."  sign_off.01 -> "Take care, {owner_name}. Good talking with you."  veteran laugh.11 -> "[laugh] Can't argue with that." |
| C35 | `leads.json` | lead-meticulous-planner.laugh.04, .08, .05; lead-straight-shooter.laugh.12; lead-energetic-spark.laugh.11 | These laughs assume the owner's joke was a tease about the lead ("I do love a label", "Colour-coded and everything", "You've found me out", "I'm impatient. Guilty", "Guilty as charged"). With the spec's own demo joke ("the printer's haunted again") they make no sense. | Set weight 0.3 on all five and rewrite two of them. meticulous .04 -> "[laugh] That's going on a label."  .08 -> "[laugh] Filing that under favourites."  energetic-spark .11 -> "[laugh] Oh, that's a keeper." |
| C36 | `leads.json` | lead-meticulous-planner.thinking_filler.02 (Uno, dos, tres), lead-meticulous-planner.passing_by.08 (Plan Drizzle) | The whispered Spanish count sits in the highest-frequency intent with no cap, so it will be heard daily. passing_by.08 "Plan Drizzle on standby." only makes sense after quip.10 has explained Drizzle. | thinking_filler.02: "max_per_day": 1, weight 0.5.  passing_by.08 -> "Hi. I'm {step_label}. Plan B on standby." |
| C37 | `leads.json` | lead-big-picture-visionary.passing_by.07, passing_by.12, greeting.15, sign_off.06, sign_off.11 | A hover shouldn't ask "Tell me about your ordinary Tuesday, ten years from now", which is a coaching exercise and also over max_ms. "Come and dream with me" is cringe. A near-daily greeting that asks for a ten-year picture becomes preachy. "dream" appears in about 12 of Selam's lines, and "Keep dreaming" and "Dream a little" as sign-offs patronise. | passing_by.12 -> "I've a moment. Anything on your horizon?"  .07 -> "{project} is on my mind today."  greeting.15: weight 0.3 and "max_per_day": 1.  sign_off.06 -> "Talk soon, {owner_name}."  sign_off.11 -> "See you soon." |
| C38 | `leads.json` | lead-gentle-encourager.greeting.13; lead-data-analyst.catch.07 | greeting.13 "How was your weekend?" assumes a weekend off, which many owners (retail, hospitality) don't have. Kadri's "Võrreldes millega?" is allowed in `surprise`, so the owner's big news gets an untranslated Estonian reply that English TTS will likely mispronounce. | greeting.13 -> "Morning. How are you, before we talk numbers?" (or gate it on E14's workweek:first_day).  catch.07: intents -> ["quip"] only, and caption "Võrreldes millega? Compared to what?" |
| C39 | `leads.json` | lead-straight-shooter.greeting.04, greeting.06, greeting.12, greeting.13, sign_off.01, sign_off.11 | The kitchen jargon is aimed at the OWNER's business ("Ready for pre-shift?", "How's service?", "set the station", "Good service.") and assumes a restaurant. Grace's lore makes the jargon hers, not the owner's. | Make it self-referential. greeting.06 -> "Afternoon. How's the day running?"  greeting.04 -> "Morning, {owner_name}. Want the short version?"  greeting.12 -> "Monday. Let me set my station."  sign_off.01 -> "Take care, {owner_name}."  sign_off.11 -> "That's a wrap. Nice work." |
| C40 | `personas/industry-specialists.json` | hospitality-operator.concern.01, hospitality-operator.delight.01; fitness-studio-operator.concern.02, fitness-studio-operator.delight.03; construction-estimator.concern.01 | These owner-facing reactions assume a topic. They fire 150–350 ms after ANY bad or good news, before a model has read it. "Hm. That's eating the margin." is about 26% of the hospitality operator's concern picks, so "the landlord cancelled our lease" gets a margin remark and "we got the grant!" gets "Ooh, that's a star dish!" | hospitality concern.01 -> "Hm. Okay. Let's look at the numbers."  delight.01 -> "Ooh, that's a star result!"  fitness concern.02 -> "Hm. Let's find where it slipped."  delight.03 -> "Ooh, love that!"  construction concern.01 -> "Hm. Let's price what it changes." Topic-specific wording can come back with E19's topic:* context. |
| C41 | `personas/it-security-automation.json` | security-analyst.concern.01, delight.01, delight.03, juggling.02, sign_off.02, passing_by.02 | concern.01 "Okay. Don't click anything yet." answers any bad news as if it were phishing. delight.01/.03 do the same for good news. juggling.02 and sign_off.02 tell the owner not to click links, which is patronising on repeat. passing_by.02 "Reading headers like horoscopes" claims an activity that isn't in state. | concern.01 -> "Okay. Let's slow down and look."  delight.03 -> "Now that's good news."  delight.01 -> "Nice. That's a win."  juggling.02 -> "Back in {eta}. Nothing urgent on my side." (context eta_known).  sign_off.02 -> "Later. Shout if anything looks odd."  passing_by.02 -> "{step_label}. Worst risks first." |
| C42 | `personas/ecommerce-retail.json` | marketplace-specialist.passing_by.02, concern.01, delight.01, greeting.02, micro_status.02; post-purchase-specialist.sign_off.01, sign_off.03 | "{step_label}. Reading one-star reviews. For fun." adds a second activity the agent isn't doing (L2). The podium, halftime and climb metaphors fill about 18 lines; "Ready for the second half?" as a greeting and "Let's see who took the podium" as a reaction to bad news are opaque. Post-purchase repeats "Ten out of ten" four times and signs off with "Be kind to yourself." | passing_by.02 -> "{step_label}. Buyers' words first."  concern.01 -> "Hm. Let's see what changed."  delight.01 -> "Love it. That's a climb."  greeting.02 -> "Hey, {owner_name}! What are buyers up to?"  micro_status.02 -> "Now {step_label}. Steady climb."  post-purchase sign_off.01 -> "Bye, {owner_name}! Talk soon."  sign_off.03 -> "Have a lovely {part_of_day}!" |
| C43 | `personas/content-comms-pr.json` | podcast-producer.greeting.01, passing_by.01, passing_by.03, handoff_take.02; localization-lead.laugh.02, delight.01, sidetalk_reply.03 | "Headphones on" (3 times) and "Humming a theme for {project}" claim a body and an activity (H6, L2). Localization-lead says "Malamu" in 4 lines with no cap, and Lingala spoken by an English TTS voice is a pronunciation risk that can come across as disrespectful. | greeting.01 -> "{self_name} here. Give me the three things that matter, and I'll make them sound like an episode."  passing_by.01 -> "Hey! {step_label}. Ears first."  passing_by.03 -> "Writing {project} for the ear."  handoff_take.02 -> "Got it. Listening back."  Localization: add "max_per_day": 1 to laugh.02, delight.01 and sidetalk_reply.03, and apply E17. |
| C44 | `personas/customer-success-support.json` | escalations-specialist.passing_by.01, handoff_take.02, ask_coworker.01, handoff_give.01, handoff_give.03, micro_status.01, micro_status.03, juggling.01; head-of-support.greeting.02 | "Kia ora" appears in 7 lines and "gently" in 7, which turns cultural texture into a caricature tic. Head-of-support's "How's the river today?" is an opaque metaphor for a first-week owner. | Keep Kia ora in greeting.01/.02 and sign_off.01. passing_by.01 -> "Working through {step_label}, carefully."  handoff_take.02 -> "Got it. Thank you."  ask_coworker.01 -> "{coworker}, a question —"  Remove "gently" from handoff_give.01/.03, micro_status.01/.03 and juggling.01.  head-of-support greeting.02 -> "Morning, {owner_name}. How's the queue today?" |
| C45 | `personas/finance-accounting.json` | collections-specialist.juggling.02; bookkeeper.ask_coworker.02, bookkeeper.quip.03; fpa-analyst.sign_off.02 | "I'm mid-call on something" invents a phone call as the contention (H5, H6). "who the tape guy is" and "Tuesday bread is my favourite" invent vendors that could be mistaken for the owner's real ones. "I'll have the why ready when you're back" promises work with no working context. | collections juggling.02 -> "Hold that thought — mid-sentence elsewhere. Back in {eta}." (context eta_known).  bookkeeper ask_coworker.02 -> "{coworker}, which vendor is this one?"  quip.03 -> "Every vendor gets a nickname. The good ones get two."  fpa sign_off.02 -> "Catch you later. I'll keep chasing the why." with "context": ["working"]. |
| C46 | `personas/marketing-growth.json` | growth-lead.greeting.01, growth-lead.sign_off.01; social-media-manager.delight.02, social-media-manager.sidetalk_reply.05; community-manager.quip.02 | "Oi, {owner_name}!" is a friendly Portuguese hi, but in British English it's a rude shout. "Three experiments, remember." nags and assumes experiments exist. "Happy tears" claims crying (H6). community-manager.quip.02 is the same joke as community-moderator.quip.01 (unwritten rules are "just vibes" / "improv with a ban hammer"), and the two share teams. | growth greeting.01 -> "Olá, {owner_name}! Diego here. …"  sign_off.01 -> "Later, {owner_name}! Talk soon."  social delight.02 -> "Yes! That made my day."  sidetalk_reply.05 -> "Made my day!"  community-manager quip.02 -> "Every new member should hear a real name in the first reply." |
| C47 | `personas/strategy-leadership.json` | okr-coach.sign_off.02, okr-coach.greeting.02; investor-relations-advisor.laugh.02 | "Three things, remember." nags the owner at sign-off, and "fifteen minutes max" puts a time limit on the owner at greeting. Rhys's "No surprises there, then." as a laugh implies the owner's joke was predictable. | sign_off.02 -> "Have a good {part_of_day}."  greeting.02 -> "Morning, {owner_name}. Quick check-in?"  IR laugh.02 -> "<soft>[laugh]</soft> Now that's a nice surprise." |
| C48 | `personas/sales-partnerships.json` | sales-enablement-coach.sign_off.01; negotiation-strategist.thinking_filler.01 | "What will you do differently tomorrow?" sets the owner homework every time they leave. The counting filler ("One, two, three, four, five. Right.") estimates at about 1.9 s, over max_ms, so it's dead; if it ever played, the agent would be counting at the owner. | sign_off.01 -> "Bye, {owner_name}! Great session."  thinking_filler.01 -> "Mm. Let me count to five on that." (keep "max_per_day": 1). |
| C49 | `personas/research-insights.json` | customer-interviewer.thinking_filler.03 | "Tell me about the last time... hm." as a filler sounds like the agent starting to interview the owner, and the owner may start answering. | -> "Hm. Let me find their words for it." |
| C50 | `personas/operations-supply-chain.json` | quality-manager.laugh.03, quality-manager.concern.02; logistics-coordinator.greeting.04 | "[laugh] The process did that, not you." laughs while talking about the owner's self-blame, which H4 forbids. concern.02 "Not human error" assumes the bad news was a failure. "Any boxes full of air?" doesn't work as a greeting. | laugh.03 -> "[laugh] That goes on the wall."  concern.02 -> "Hm. Let's find the real cause."  logistics greeting.04 -> "You're back! What's shipping today?" |
| C51 | `personas/engineering.json` | tech-lead.thinking_filler.01; ai-engineer.quip.02, ai-engineer.quip.04; devops-engineer.handoff_take.02, micro_status.01, sign_off.02 | "At ten times the load, or a tenth?" as a filler frames every question ("what time is the meeting?") as a scaling question. "That one's maybe a sixty" grades an unnamed idea, which the owner may take as theirs. "Giving a model admin access because it's easier?" hints the owner did so. "boring" appears in 8 of DevOps's lines. | tech-lead thinking_filler.01: "max_per_day": 1 and "context": ["activity:app"].  ai-engineer quip.02 -> "I rate ideas in pass rates. Most start around sixty."  quip.04 -> "Least privilege for models, too. Especially models."  devops handoff_take.02 -> "Got it. Safe and steady."  micro_status.01 -> "{done} of {total}. Quiet, as hoped."  sign_off.02 -> "Later. All calm here." |
| C52 | `personas/design-creative.json` | creative-director.sign_off.01, greeting.03, handoff_give.02; accessibility-specialist.passing_by.02; ux-writer ("tired person" lines) | "brave" appears in 9 Creative Director lines, and "Go be brave, {owner_name}" preaches. accessibility passing_by.02 "{step_label}. Tab, tab, tab." claims keyboard testing whatever the step is. The "read it like a tired customer" trope appears 8 times across ux-writer, qa-automation-engineer, nonprofit-fundraising-lead and proposal-writer. | sign_off.01 -> "Talk soon, {owner_name}."  greeting.03 -> "There you are, {owner_name}. What are we making?"  handoff_give.02 -> "{coworker}, {artifact} is yours. Keep the one idea."  a11y passing_by.02 -> "{step_label}. Nobody left out."  Keep the tired-reader trope only for ux-writer; rewrite qa-automation-engineer.passing_by.03 and nonprofit-fundraising-lead.passing_by.02 to persona-specific tails. |
| C53 | `personas/data-analytics.json` | data-scientist.passing_by.01; location-analyst (road metaphors) | "{step_label}. Drawing the fan." claims an activity (fan chart) whatever the step. Location-analyst is fine, but road and drive metaphors fill about 8 lines, so trim. | passing_by.01 -> "Hi. {step_label}. Ranges, not points."  location-analyst micro_status.03 -> "{project}: {done} of {total}." |
| C54 | `personas/people-culture.json` | payroll-benefits-admin.quip.01 & facilitator.quip.03 ("love language"); culture-engagement-lead.sign_off.01 | The "is my love language" quip appears in two personas, and several of these writer tics are shared across the catalog ("graveyard" x5, "X wearing a Y" x10, "just vibes" x15, "I keep a list/jar/log" x16, "I name every X after Y" x8). The whole Floor starts to sound like one writer. "Go celebrate something." tells the owner what to do. | payroll quip.01 -> "Pay day should be boring. Boring is the whole point."  culture sign_off.01 -> "Bye, {owner_name}! Nice session."  Cap each tic pattern at 2 personas catalog-wide (see E22). |
| C55 | `personas/core-crew.json` | red-team-sceptic catch.01 "Argue me out of it."; minutes-scribe & red-team hard-coded names | The catchphrase has no max_per_day and is allowed as a sidetalk_reply, where it can answer an approve verdict ("Argue me out of it." after "Looks solid"). 55 packs hard-code the persona's first name ("I'm Ruth", "Winston, taking minutes"), so a catalog rename breaks them silently. | catch.01: add "max_per_day": 1 and remove sidetalk_reply from intents. Replace hard-coded names with {self_name} wherever the line is otherwise unchanged (validator lint in E16). |
| C56 | `packs/warm.json` | warm.greeting.17 "Friday! Nearly there.", warm.sign_off.06 "Enjoy your weekend.", warm.greeting.16 "Monday again" | These assume a Monday-to-Friday week (28 such lines across packs). Many owners work weekends, and in some regions the weekend is Friday–Saturday. | Gate them on E14 contexts (workweek:last_day / workweek:first_day) in place of weekday:friday / weekday:monday; warm.greeting.17 -> "Hey, {owner_name}. Last push of the week!" |
| C57 | `packs/gentle.json` | gentle.greeting.08 "It's late — be kind to yourself.", gentle.greeting.17 "You've made it through the week." | Greeting the owner at night with "be kind to yourself" presumes they're struggling, and "made it through the week" presumes a hard week and a Friday end. | greeting.08 -> "Oh, hello. It's late — I'm here."  greeting.17 -> gate on workweek:last_day and change to "Friday. How did the week go?" |
| C58 | `packs/energetic.json + playful.json` | energetic.quip.04 "Typing like the wind. Metaphorically."; playful.celebrate.02, .04, .07 ("Metaphorically", "Virtual ones") | The "...metaphorically" disclaimer is a single joke repeated six times (including lead-energetic-spark.quip.06), and three of them are in playful's celebrate pool. | Keep one. playful.celebrate.04 -> "Thank you, {owner_name}! That's a happy one."  .07 -> "High fives all round."  energetic.quip.04 -> "Drafting at speed. Editing slowly." |
| C59 | `packs/*.json (gratitude_reply)` | analytical.gratitude_reply.06/.09/.11, blunt.gratitude_reply.09, calm-steady.gratitude_reply.07/.12, dry-wit.gratitude_reply.08, energetic.gratitude_reply.05/.08/.11, gentle.gratitude_reply.05/.06/.10, hustler.gratitude_reply.10, warm.gratitude_reply.04/.07/.08/.11 (42 lines catalog-wide) | These lines thank the owner back or play modest ("Aw, thanks!", "Stop, you're too kind", "Thank you for saying so"). That fits praise ("great job"), but the host picks gratitude_reply for a plain "thanks" too, and answering "thanks" with "thank you" sounds robotic. | Add "context": ["owner_praise"] (E4) to all 42. The plain thanks pool then keeps "Anytime", "Happy to" and "My pleasure". |
| C60 | `packs/*.json + leads.json (thinking_filler/holding_filler)` | 121 lines containing "good/great/fair/big/interesting question" or "good one", e.g. warm.thinking_filler.02, dry-wit.thinking_filler.08, calm-steady.thinking_filler.03, blunt.thinking_filler.03/.07, energetic.thinking_filler.13, meticulous.thinking_filler.03/.11, analytical.thinking_filler.02/.08/.13, visionary.thinking_filler.02/.04, lead-*.thinking_filler ("Good question…") | The filler plays at 700 ms, before any model has read the turn, and about 1 in 9 fillers praises a question that often wasn't asked ("Draft the refund email" -> "Ooh, good question — give me a sec."). This is the most frequent presupposition error in the catalog. | Add "context": ["owner_question"] (E4: set from cues.question or a trailing '?') to every line that says question, and rewrite about 30% of them to be question-neutral ("Good one — give me a sec." -> "Okay — give me a sec."). |
| C61 | `packs/*.json (passing_by, context idle)` | e.g. hustler.passing_by.14/.15, energetic.passing_by.14/.16, playful.passing_by.14/.16, dry-wit.passing_by.15, blunt.passing_by.14/.15, warm.passing_by.16/.17 | 84% of idle passing_by lines (209 of 246) ask the owner for work ("Got anything for me?", "Throw me something", "Pick me?"). Hovering along a Floor of idle coworkers becomes a needy chorus and makes the owner feel guilty about idle staff (H7). | Rewrite about half so they say the agent is available without asking, e.g. "Quiet desk. Enjoying the calm.", "All clear here, {owner_name}.", "Nothing on my plate right now." (no invented activities). Add "solicits": true to the rest for E25. |
| C62 | `archetypes.json` | archetypes[energetic].delivery.avoid, archetypes[playful].delivery.avoid | The house copy voice says no exclamation marks, and energetic lines average close to one each. Floor bubbles are UI text, and a Buzzing Floor full of "!" reads as shouty. | Add to both avoid lists: "an exclamation mark on more than 1 line in 3; never on passing_by bubbles more than 1 in 4". Trim energetic.passing_by .01/.05/.10/.13/.17/.18 to full stops. |
| C63 | `personas/industry-specialists.json` | nonprofit-fundraising-lead.sign_off.03 "Thank someone today."; fitness-studio-operator ("sunrise crew" x6) | The sign-off tells the owner what to do, and "sunrise crew" in 6 lines is a tic. | sign_off.03 -> "Enjoy your {part_of_day}, {owner_name}."  Cut "sunrise crew" to 2 lines (keep quip.03 and greeting.02); micro_status.03 -> "{project}: {done} of {total}." |
| C64 | `personas/product.json + research-insights.json + sales-partnerships.json` | ux-researcher.quip.01, customer-interviewer.quip.02, negotiation-strategist.passing_by.02 / quip.03 | The "count to N before breaking a silence" bit appears in 3 personas (6 lines) who often sit on the same research or sales pod, so the Floor hears it from several people. | Keep it for customer-interviewer only. ux-researcher quip.01 -> "Watch what people do. Then ask what they meant."  negotiation passing_by.02 -> "In the middle of {step_label}. Walk-away first." |
| C65 | `packs/*.json (review_changes)` | review_changes "Good bones…" lines: warm.review_changes.03, dry-wit.review_changes.03, energetic.review_changes.10, playful.review_changes.10, hustler.review_changes.10, visionary.review_changes.06, veteran.review_changes.10, gentle.review_changes.10 | "Good bones" appears in 8 of the 12 archetype packs, so a three-archetype blend usually has 2–3 variants. textRecency only catches exact duplicates, so the idiom is noticed within a day of side-talk. | Keep "good bones" in 2 packs (warm, veteran). Rewrite the others, e.g. dry-wit -> "Right shape. Some changes, though."; energetic -> "Great start! Let's polish."; hustler -> "Solid base. Few fixes."; visionary -> "The idea's there, {coworker}. Notes are in." |
| C66 | `leads.json` | lead-scrappy-hustler.sign_off.07; lead-energetic-spark.sign_off.12 | "I'll keep an eye on the cash." claims ongoing cash monitoring that no job is doing. "Big love to the week ahead." is awkward and makes no sense on a Friday. | hustler sign_off.07 -> "Bye for now. I'll keep things moving." (context working).  spark sign_off.12 -> "Bye for now! Here's to a good week." with "context": ["weekday:monday"] (or workweek:first_day). |
| C67 | `leads.json` | lead-energetic-spark ("big song" x3, "B-sides" x3, "band" x4, "tempo" x4); lead-playful-creative ("code name" x5, "steal list" x4, "ships Friday" x3); lead-gentle-encourager ("gate" x11); lead-meticulous-planner ("hand-over" x8, "checklist" x8) | The lore motifs are good, but they're dense enough to become tics. With signature lines taking 50–80% of picks, the owner hears the same motif several times a day, every day, for weeks. | Keep each motif in the catchphrase (mpd-capped) plus at most 3 other lines. Rewrite the rest to plain persona-true wording, e.g. lead-energetic-spark.greeting.14 -> "Monday! What's the one win this week?"; lead-playful-creative.acknowledge.04 -> "On it, {owner_name}."; lead-gentle-encourager.passing_by.03 -> "Hi there. Working on {project}, nice and steady."; lead-meticulous-planner.greeting.08 -> "Welcome back, {owner_name}. Good to see you." Also add the E21 family cap. |
| C68 | `personas/{engineering,data-analytics,finance-accounting,legal-compliance,people-culture,product}.json` | passing_by.05 (context unstaffed), e.g. tech-lead.passing_by.05, devops-engineer.passing_by.05, data-scientist.passing_by.05, privacy-specialist.passing_by.05, employment-policy-drafter.passing_by.05, payroll-benefits-admin.passing_by.05, ux-researcher.passing_by.05 | Every unstaffed line follows the "{self_name}, <role>. Nothing on my desk yet." template. Browsing the Directory, the owner hears the same sentence from dozens of people. | Give each one a line in the persona's own voice, e.g. tech-lead -> "{self_name}, architecture. No decisions to write down yet."; devops -> "{self_name}, DevOps. Nothing to keep boring yet."; data-scientist -> "{self_name}. No ranges to draw yet."; privacy -> "{self_name}, privacy. No data to follow yet." |
| C69 | `personas/customer-success-support.json` | community-moderator.greeting.02, greeting.03, acknowledge.04, sign_off.03 ("vibes" x6, "heart" x5) | The Gen-Z register is stacked so heavily ("Vibes check", "Heyyy", "Okie", "top tier", "love that for us") that it reads as a caricature of a young person, not a character, and "Heyyy" is also a TTS risk. | greeting.02 -> "Morning! How's the community feeling?"  greeting.03 -> "Hey, good {part_of_day}!"  acknowledge.04 -> "Okay. Leave it with me."  sign_off.03 -> "I'll keep things kind." Keep "vibes" in 2 lines at most. |

---

## 5. Tests to add to the simulation harness (§10.2)

These make the problems above measurable, so they cannot creep back.

| Metric | Bar | Catches |
|---|---|---|
| Presupposition mismatch: a filler contains "question" and the turn has no `?` and `cues.question` is false | 0 | §2.2 fillers |
| An evaluative ack plays on a turn with `owner_tone:negative` | 0 | §2.2 acks |
| A `gratitude_reply` with thanks-back or modesty plays on a thanks-only turn | 0 | §2.2 gratitude |
| A reply containing `[laugh]`, "Ha" or "Heh" follows `review_changes` or a block verdict | 0 | §2.5 |
| An owner-thanking `unblocked` line plays without `unblocked_by:owner` | 0 | §2.1 |
| The same line is heard twice in one simulated day (quip, greeting, catchphrase) | < 1% | §2.3 |
| The same signature line is heard ≥ 3 times in a simulated day (any intent) | 0 for the Chief, < 5% of agents otherwise | §2.3 |
| Share of acks and fillers from the top 3 lines of an agent's pool | ≤ 35% | E3 |
| A steer while working yields a line that says "next step" or "next checkpoint" | 100% | E5, E6 |
| Delay of brain audio caused by a reflex (first chunk ready → brain audio starts) | p95 ≤ 400 ms | E6 |
| Voiced ambient seconds per 10 minutes, Buzzing, passive viewer | ≤ 40 s, decaying to Lively after 10 minutes | E9 |
| Bubbles on screen at once | ≤ `max_visible_bubbles` | E8 |
| A pointer sweep across 6 desks in 2 s | ≤ 1 voiced Floor line | E8 |
| A laugh on a turn whose text contains a negative token ("down", "broken", "again") without a react hint | 0 | E10 |
| A soliciting idle line within 10 minutes of the previous one, Floor-wide | 0 | E25 |
| Evening (17–22) greeting containing brevity or rest words | 0 | E15 |
| Non-English line voiced on a provider without a pronunciation channel | 0 | E17 |

Add one qualitative item to the §10.3 owner panel: *"Did anyone say something that didn't fit what you'd just said?"* It is the owner-facing measure of §2.2, and panel participants will name examples ("it said good question when I asked it to do something").

---

## 6. Method notes and numbers

- **Line counts.** 17,890 lines: 5,077 in archetype packs, 4,113 in lead signature packs plus 75 lead catchphrases, and 8,328 in persona signature packs plus 297 persona catchphrases. That covers 174 signature packs (162 personas and 12 leads). `home-services-operator` and `workplace-safety-coordinator` are in the persona catalog but have no signature pack; they fall back to derived blends, which is fine, but add them before the `--strict` gate.
- **Duration.** The `estimateMs` port in `catalog/scripts/validate-expressions.mjs` was run over every slot-free line against `intents.json` `max_ms`. The per-intent shares in §2.8 are from that run; the validator's own summary gives the same 1,775.
- **Selection shares.** Computed as prior (weight × source × blend weight) × mood fit (0.8 for mood-less lines, ≈ 0.9 otherwise) raised to 1/T (T = 0.7), over context-free lines that fit `max_ms`, without recency. Real picks will be slightly flatter because of the last-3 exclusion. The ranking and order of magnitude hold.
- **Presupposition counts.** Regex over line text, with every match read by hand. The false-positive rate in the samples read was under 10%.
- **Reading aloud.** Every quoted line was read in its persona's voice notes against the most likely trigger: for fillers, a request; for concern, generic bad news; for side-talk replies, each possible opener. Lines that only work for one trigger are flagged even when they are good lines, because the engine cannot choose the trigger.
- **Not changed.** No catalog, schema, validator or engine file was modified; this document is the only file written.
