# Critique: the 12 lead personalities

Reviewer lens: novelist (character, voice, texture), UX researcher (choice, first minute, coverage), ethicist (honesty, stereotypes, vulnerable owners).
Scope: all 12 files in `catalog/leads/`, cross-checked against `schema/lead.schema.json`, `SCHEMA.md` §6/§8/§11, `taxonomy.json` (voices, portrait conventions, honesty policy, leads), `formation.json` and the 162 personas.
Validation baseline: on a scratch copy of the catalog, `scripts/validate.mjs` passes the leads with **0 errors and 0 warnings**. The only lead-area warning is the missing `leads/match-quiz.json`, which is designed in §11 below. The draft quiz passes the validator on the same scratch copy, and the real catalog was not touched.

## 1. Verdict

This is a strong set. Every lead has a real point of view, and the lore behind each is specific and earned: a shoebox of receipts, a whiteboard by the pass, a school-holiday week, a brass abacus from a market stall. Guardrails are careful, and the writing never mocks the owner. Most owners would find someone they like.

It is not yet a set of **twelve clearly different** people, and it is not yet safe to ship as the first minute of the product. There are five problems, in order of importance:

1. **Three near-duplicate pairs** share temperament, pushback style, signature phrases and even example lines: Dominic ≈ Rafael, Samuel ≈ Owen and Grace ≈ Jo. Kadri and Sasha share the catchphrase that belongs to Kadri, and Zuri, Pao and Juno cluster together.
2. **Honesty gaps at turn 1.** Four greetings (Dominic, Grace, Sasha, Rafael) say the lead has already reviewed "the week" or "yesterday". EXPERIENCE §6.1 records the greeting as spoken turn 1, so on day one these lines claim work that never happened. Six leads' `rules` also leave out the pay/sign/delete approval rule and the owner-override clause. `rules` is the only behavioural field exported to biz-bot, so those protections are lost on export.
3. **Age is coded as temperament.** Age correlates with pace at r = −0.63, with humour at −0.59 and with risk appetite at −0.66: the young leads are fast, funny and bold, and the old ones slow and cautious. The quality bar forbids exactly this link.
4. **Coverage gaps.** Nobody is written for non-native English speakers, owners wary of AI, owners who want a formal register (the highest formality slider is 62), neurodivergent owners, or SaaS, agency and nonprofit owners. None of the 12 faces has a head covering, visible disability, locs or braids, or tattoos. Ten of twelve lives are set in North America.
5. **The six-and-six authoring split.** Six files (steady-operator, warm-mentor, straight-shooter, dry-strategist, energetic-spark, meticulous-planner) carry `$schema`, full rules, a lore-framed first story and wider guardrails. The other six (big-picture-visionary, data-analyst, gentle-encourager, playful-creative, scrappy-hustler, seasoned-veteran) do not. Four of those six also leave clinical, security and privacy out of their regulated-domain guardrails.

None of these needs a rewrite. They are targeted edits, listed with exact text in §12.

## 2. Lead by lead: would an owner choose them?

| Lead | Why an owner will like them | What could put an owner off | Priority fixes |
|---|---|---|---|
| **Dominic** (steady operator) | Calm, numbered and kind: "one decision before ten". The "game I missed" story is the best delegation argument in the set. | Near-duplicate of Rafael. The military lore is risky with real veterans. His greeting claims he already reviewed the week. | Give him flow/WIP instead of owner-plus-backup; new first story; veteran hook; greeting |
| **Samuel** (warm mentor) | Patient and funny ("there are no silly questions, only expensive silences"). Teaches with the owner's own numbers. | "I'm proud of you" and a "Report card" can feel paternal to experienced owners. Duplicates Owen's pushback line almost word for word. | Soften the celebration line; rename the ritual; add a sceptic role |
| **Grace** (straight shooter) | "Kind isn't the same as nice." Fast, fair and funny. The bar-manager story is excellent. | Kitchen slang ("86'd", "heard") is hard for second-language owners. Her defaults are identical to Jo's. | Greeting; tattoo; plain-language mode |
| **Selam** (visionary) | Hope backed by arithmetic, and a clear "vision is a direction, not a forecast". The best mission-driven lead. | Her greeting asks for a ten-year vision in the first minute, which is heavy for a first-timer. Her daily brief contradicts her weekly cadence. | Greeting; conditional daily note; accent colour |
| **Kadri** (data analyst) | "Compared to what?", the surprises log and the dashboard nobody opened: memorable and useful. | Same look as Sasha (glasses, blazer, black tee). Missing the legal, employment, clinical, security and privacy routing. | Attire; voice; guardrails |
| **Sasha** (dry strategist) | Board-game deadpan; "a vanity metric wearing a suit". The best sparring partner for solo founders. | Borrows Kadri's catchphrase. The "loud, food-centred family" line is a trope. Coolest warmth score (44). | Own catchphrase; backstory line; greeting |
| **Zuri** (energetic spark) | Joyful, and self-aware about being "the gas". The best launch partner. | "Rhythmic" as a trait, plus drums and high energy for the one young Black woman, risks a stereotype. The avatar "nods on the beat", which the renderer cannot do. | Trait and quirk; age 40–44 (lead change) |
| **Owen** (gentle encourager) | The kindest voice in the set: "Things that went right", "not yet is a fine answer". | The most clichéd heritage cluster: hill farm, sheep, male-voice choir, rugby, two Welsh phrases in six signatures and a dialect tag ("that is"). Duplicates Samuel. | Trim heritage signifiers; new pushback; new story |
| **Rafael** (meticulous planner) | SBAR hand-overs, plan Drizzle and plan Downpour, and a male ex-ICU nurse who counters a stereotype. | Near-duplicate of Dominic. Greeting claims yesterday's work. | Own the "owner, backup, check" territory; formal register; greeting |
| **Juno** (playful creative) | "Make it ugly first" and "constraints are the brief": a producer's spine inside a creative. | Both they/them leads are the two funniest (Sasha 82, Juno 90), in their 30s, in glasses, and voiced by `alloy`. | Voice; sceptic flavour |
| **Pao** (scrappy hustler) | "Scrappy, not shady", the truck summer and the forty-dollar test: very practical. | Sliders contradict his lore: risk 80 and detail 40 for a man whose method is de-risking by counting every dollar. Close to Zuri in voice and lines. The "hustler" label clashes with three leads that avoid "hustle". | Sliders, greeting, approval line, one story |
| **Jo** (no-nonsense veteran) | "Did you go look?", "Fix the process, not the person": the most trustworthy voice for sceptical owners. | Near-duplicate of Grace (defaults, pushback, guardrail wording) and of Sasha ("bone-dry deadpan"). The xAI voice `eve` is "energetic, upbeat", the opposite of her delivery notes. | Humour, pushback, sliders, voice, hearing aid |

## 3. Distinctness: the overlapping pairs

The closest slider distances (Euclidean over 7 sliders) are Zuri–Pao and Grace–Jo at 22.5, Zuri–Juno at 24.7, Kadri–Dominic at 27.5 and Owen–Samuel at 28.9. The sliders are the smaller problem. The shared text is what an owner will actually notice when comparing leads.

### 3.1 Dominic ≈ Rafael (same thesis: "remove the single point of failure")
- Their temperaments are nearly verbatim: Dominic "gets quieter and more precise", and Rafael "gets quieter and more organised as the pressure rises".
- Their signature phrases compete: "One owner, one backup, one deadline." against "Owner, backup, check."
- Both run an 08:00 brief and a 17:30 close-out or end-of-shift hand-over. Dominic's second daily ritual also contradicts his `daily_morning` cadence.
- Both favour project-manager, qa-verifier, minutes-scribe and red-team-sceptic, and both always include `co_owner` and `reviewer`.
- Both have a bottleneck hook ("Owners who have become the bottleneck" and "Owners who are the single point of failure").
- **Fix.** Split the territory. **Dominic owns flow**: triage, next action, finish-before-start (a WIP limit, which matches his own value "Finish what's started before starting more"), and delegation. **Rafael owns risk and reversibility**: owner-backup-check, SBAR, dry runs and plan B. Dominic loses "backup" wording, the 17:30 ritual and the ice-storm story, which is also the fourth "tell customers early" story in the set. He gains "Forty half-loaded trucks" (text in §12). Rafael's bottleneck hook is re-angled to leave and illness planning.

### 3.2 Samuel ≈ Owen (two warm, slow, older men who ask Socratic questions)
- Their pushback styles are nearly verbatim: "Asks the question that lets the owner see the problem themselves" against "Asks a soft question that lets the owner see the problem themselves".
- Both `reporting_failure` examples are "the supplier order didn't go through… nothing was charged". Dominic has a third supplier failure.
- Both use the same xAI voice (`leo`), sliders are close (warmth 90/92, pace 30/20, autonomy 2/2), and both have a Friday read-back list.
- **Fix.** Samuel keeps the Socratic question: he is the teacher. Owen names the worry softly, once, and offers a smaller step: he is the encourager. Change Owen's failure example to a lapsed market-pitch booking, move Owen's xAI voice to `sal`, and raise both humour sliders a little (§8).

### 3.3 Grace ≈ Jo (two blunt, terse, lean women from hands-on industries)
- Their defaults are identical: `on / 4 / terse / daily_morning / lean`.
- Both push back "once, then back you completely", and so do Dominic and Pao. That is four leads using the same move.
- Their guardrails are near copies: "Blunt about situations, never about people's worth" and "Blunt about problems, never about people".
- Jo's `asking_approval` copies Owen's line: "Here's what it does, what it costs and what could go wrong."
- Jo's humour is "Bone-dry and deadpan", the same words as Sasha's.
- Both use the xAI voice `eve`, which is also wrong for Jo.
- **Fix.** Grace is **speed and service recovery**: triage and the customer first. Jo is **evidence and root cause**: go and see, fix the process, protect the people, and teach. Give Jo a "go and see" pushback, gruff-warm humour, verbosity `balanced` (she teaches), higher detail and humour sliders, a lower risk slider, and a new voice.

### 3.4 Sasha borrows Kadri's catchphrase
"Compared to what?" is in Kadri's taxonomy brief, tagline, values, quirk and first signature phrase. It also appears in Sasha's signature phrases, operating principles and backstory ("a relentless 'compared to what?'"). **Fix.** Sasha gets "And then what?", which comes from Grandpa's "What did you think I would do next?" and is truer to them. Kadri also shares "Show the working" with Samuel's "Show your working"; Samuel keeps it and Kadri gets "Where did that number come from?".

### 3.5 Zuri, Pao and Juno (the high-energy, youngest cluster)
- Zuri and Pao have the same speed (1.07), both greetings start "Hey!", both approval lines start "Quick yes or no", and their defaults match (`on`, autonomy 4, `twice_daily`).
- **Fix.** Pao should be the careful-with-money fast one, which is true to his truck-summer lore: risk 80 → 55, detail 40 → 62, pace 92 → 82, speed 1.05, and a new greeting and approval line. Zuri keeps the spark: speed 1.06, no "Hey! Good to see you" (it implies a prior meeting), and an optional age of 40–44. Juno's pace 78 → 70 gives them a producer's calm.

## 4. Voices

Every voice id is valid, and every lead's TTS voice matches its realtime voice. The problems are the **pairings**, a few **timbre mismatches** and one **pattern**.

| Problem | Evidence (taxonomy timbre notes, all "inferred, audition") |
|---|---|
| xAI split is 3/3/3/2/1 where 3/3/2/2/2 is possible | `leo` is used by Dominic, Samuel and Owen; `eve` by Grace, Zuri and Jo; `ara` by Selam, Kadri and Juno; `rex` by Rafael and Pao; `sal` by Sasha only |
| Timbre mismatch | Owen ("soft, low, melodic") is on `leo` ("authoritative, strong"). Jo ("low, plain, clipped") is on `eve` ("energetic, upbeat") |
| Duplicate pairs sit on the same voice | Samuel and Owen share `leo`; Grace and Jo share `eve`. Each pair is already the most similar in personality |
| Both they/them leads share `alloy` | Sasha and Juno are indistinguishable on OpenAI. This also makes the "androgynous voice for non-binary leads" choice look like a rule |
| Grace and Kadri share `shimmer` | Two composed, clear women (1.04 vs 0.97) |
| Speeds | Zuri and Pao are both 1.07, above the pg1 `inventCast` band of 0.95–1.06. Owen sits at the schema floor (0.90) |
| `openai_live` wasted | gpt-live-1 has 22 voices, but every lead copies its realtime voice. `marin` is valid on both gpt-live-1 and TTS |

Proposed table (≤ 2 per voice on OpenAI realtime, 3/3/2/2/2 on xAI, each shared voice paired across contrasting pace and temperament; audition before locking):

| Lead | openai_realtime | openai_live / openai_tts | xai_realtime = xai_tts | speed |
|---|---|---|---|---|
| Dominic | echo | echo | leo | 0.97 |
| Samuel | verse | verse | leo | 0.93 |
| Grace | shimmer | shimmer | eve | **1.02** |
| Selam | coral | coral | ara | 0.93 |
| Kadri | shimmer | **marin** | ara | 0.97 |
| Sasha | alloy | alloy | sal | 0.98 |
| Zuri | coral | coral | eve | **1.06** |
| Owen | ballad | ballad | **sal** | **0.92** |
| Rafael | ash | ash | rex | 0.95 |
| Juno | **ash** | **ash** | ara | 1.04 |
| Pao | verse | verse | rex | **1.05** |
| Jo | sage | sage | **sal** | **0.96** |

Kadri's `marin` on the live and TTS surfaces separates her from Grace wherever gpt-live-1 is the live model. `validate.mjs` compares `openai_tts` with `openai_realtime`; it should compare with `openai_live` when that field is set, or it will warn on this deliberate choice. Add "Do not imitate or exaggerate any accent" (already in Owen's and Jo's) to every lead's `tts_instructions`.

## 5. Visual look and representation

**Distinct at a glance?** Mostly yes, thanks to colour-blocked attire and tinted backgrounds. Three collisions:
- Kadri and Sasha both wear rectangular glasses, a blazer (light gray vs charcoal) and a black crew-neck. **Fix:** Kadri wears a cornflower-blue fine-knit sweater (the cornflower is her quiet Estonian detail) and drops the lapel pin.
- Accent colours: Selam `#C9982A` (amber gold) sits next to Zuri `#F2B705` (sunflower) at the same lightness and hue. **Fix:** Selam `#7B4A2A` (espresso brown), which fits the coffee lore. Rafael and Jo (both blue) and Sasha and Owen (both purple) differ enough in lightness to keep.
- Expression edits break the landmark rule. Ten leads tilt the head or lower the chin in `concerned` or `delighted`: Samuel, Grace, Selam, Kadri, Zuri, Owen, Rafael, Juno, Pao and Jo. Taxonomy `expression_palette_generation.method` says "Keep the head pose identical so landmarks stay valid". pg2 notes the renderer has no emotional expressions and only procedural sway. The taxonomy's own `concerned` template contains "slight head tilt", which is where this came from. **Fix both:** express through brows, eyes and cheeks only.

**Diversity of the 12 faces.** The following are present in the set: glasses (4), gray or white hair (5), freckles (4), a beard (1), a beauty mark, and a spread of skin tones, ages (24–69) and genders (5 she, 5 he, 2 they). These are missing from all 12, although the 162 coworkers already include 10 head coverings: hijab, turban, headwrap, visible disability (hearing aid, vitiligo), locs or braids, tattoos, a hoodie or a suit, and anyone over 70. The lead picker is the product's first impression. Proposed, each described matter-of-factly and warp-safe:
- **Jo:** a small behind-the-ear hearing aid on her left ear. It is natural lore after forty years of presses and is never framed with "despite".
- **Dominic:** lighter patches of vitiligo at the left temple and around the left eye.
- **Grace:** a small fine-line rosemary-sprig tattoo just below the collarbone, visible at the open collar.
- **Selam (owner decision):** a patterned silk hijab in ochre, deep green and cream framing the face, replacing the shoulder scarf, with one light lore detail (she breaks the Ramadan fast with her café teams each year). This would give the set its only head covering. It is a counter-stereotype, since she is the visionary founder, and about a third of Ethiopians are Muslim. If the owner prefers not to change her faith, a high patterned headwrap keeps the visual gain without it.

## 6. Backstories and origin moments

**Texture: very good.** They have concrete objects (a brass abacus, a green ledger, a darned sweater, the stall's cash box), specific numbers, humane families (two same-sex marriages; partners with their own lives) and a lesson that shapes each lead's method. None is melodrama. The heaviest story is Jo's guard check, where a nineteen-year-old loses a fingertip. It is purposeful and gated to "about to skip a safety step", so keep it. All backstories are 406–460 words (in range), and none name a real employer.

**The arc is formulaic across the set.** Humble or family-business roots lead to a career, then one expensive mistake, a lesson, and helping owners. Nine of the twelve have a money-crisis lesson. The visible repeats:
- **"Kept someone too long"** three times: Grace's bar manager, Owen's "lad on the early round" and Pao's cousin Tou. Keep Grace's. Replace Owen's with "Three dry days" (seasonality) and Pao's with "Sold out by nine" (pricing signal). Text is in §12.
- **"Tell the customer early"** four times: Dominic's ice storm, Selam's port, Jo's order they couldn't make and Zuri's van in the snow. Keep Selam's (it is her founding moment), Jo's (the angle is saying no) and Zuri's (the angle is improvising). Replace Dominic's with "Forty half-loaded trucks".
- **"Third location too soon"** twice: Samuel's third centre and Selam's third café. Low priority; the lessons differ (cash vs profit, and vision vs forecast).
- **Three "supplier failed" example lines** (Dominic, Samuel and Owen). Change Dominic's and Owen's.

**Heritage signifier density.** SCHEMA §11 says to use heritage "sparingly". Eight of twelve carry a heritage dish (adobo, kimchi-jjigae, apricot-lamb stew, arepas, tamales, salteñas, coffee, family recipes). Owen goes furthest, with a hill farm, sheep, a male-voice choir, rugby, *chwarae teg*, *araf deg…* and "that is". **Fix:** Owen keeps the farm and one Welsh phrase. The choir becomes beekeeping, "Rugby, gently" becomes "Local history and old maps", and "That's a proper win, that is." becomes "That's a proper win." (dialect-style tags are banned by §11). Sasha's "loud, food-centred family where arguing was a form of affection" becomes "a family that treated the dinner table as a debating society, where the best argument won dessert". Pao's "street-smart" trait becomes "market-savvy".

**Are origin moments usable in conversation?** Yes. Every `share_when` is a concrete, detectable trigger. Two problems for voice:
1. **Length:** 65–122 words is 30–50 seconds spoken, which is too long in a live talking-face exchange. Add `origin_moments[].short`, one sentence of at most 160 characters (for example, Dominic: "I once missed my daughter's game because I was the only one who knew which mechanic to call. That was a design flaw, not dedication.").
2. **Frequency:** nothing stops a lead from retelling the same story. Add a runtime rule: at most one origin moment per conversation, each told at most once per owner unless the owner asks, and never while the owner is in acute distress (then listen, don't tell).

**Relatability hooks.** Most have the right restraint ("mentions X in one sentence at most, then turns to their situation"). Two do not:
- Dominic's **veterans** hook: "Shares the language of mission…". A fictional AI claiming shared service with a real veteran is appropriation. Rewrite it to respect their service and disclaim parity. His guardrail "never claims veteran status" also contradicts lore in which he served; reword it to "never presents his character's service as real".
- Rafael's **former nurses** hook is already restrained. Keep it.

## 7. Coverage: can every kind of owner find a match?

| Owner | Current match | Gap / fix |
|---|---|---|
| Anxious first-timer | Owen, Samuel | Fine |
| Seasoned operator | Jo, Grace, Sasha, Dominic | Fine (no lead defaults to autonomy 5; that is deliberately cautious and adjustable) |
| Creative founder | Juno, Zuri | Fine |
| Numbers person | Kadri, Sasha | Fine once the catchphrase is split |
| Busy parent | Dominic, Grace | Add an Owen hook for illness, caring duties or a hard season at home |
| **Non-native English speaker** | **Nobody** | Add a Selam hook for owners working in a second or third language. Add a product-level **plain-language mode** that turns off idioms (Grace's kitchen slang, Sasha's chess, Zuri's music, Juno's puns). Note: pg2 lip-sync is English-grapheme only, so non-English replies will lip-sync poorly |
| **Sceptic of AI** | **Nobody explicit** | Add a Jo hook for owners who don't trust AI yet: one small checkable job, the receipt, and a plain statement of what she can't do. The quiz has a matching "prove-it" option |
| **Wants a formal register** | **Nobody** (max formality 62) | Rafael's formality 62 → 72, a hook and a `best_for` line |
| **Neurodivergent owner** | **Nobody** | Add a Dominic hook for owners with ADHD or dyslexia, or anyone who skims: short, numbered, next action first |
| Owner outside the US | Owen (UK) and Kadri (EU) by lore | Add a global rule: use the owner's country, currency, units, holidays and fiscal calendar (example lines use `$`) |
| SaaS / online | Sasha partly | Add a Sasha hook |
| Agency / studio | Nobody | Add a Juno hook (they were an agency producer) |
| Nonprofit / social enterprise | Selam partly | Add a Selam hook |
| Salon, gym, spa | Rafael (clinics only) | Broaden Rafael's hook |
| E-commerce | Pao (moving online) | Add a Kadri hook |

**Geography.** Ten of twelve lives are set in North America, eight of them in the US. There is no lead of South Asian or Middle Eastern/North African heritage, and no Chinese, Japanese, Indigenous, Pacific or Caribbean lead. The coworkers cover many of these; the leads do not. The cheapest real fix is a future 13th lead (sketch in the additions): a *polished diplomat* archetype based outside North America, formal register and multilingual. That archetype fills the formal-register, second-language and global gaps at once, and it avoids the stereotyped pairings (South Asian with data, tech or medicine).

## 8. Stereotype audit

- **Age coded as temperament** (the biggest one): r(age, pace) = −0.63, r(age, humour) = −0.59, r(age, risk) = −0.66. The proposed changes bring these to about −0.47, −0.29 and −0.48: Zuri aged 40–44, Jo humour 68 and pace 74, Pao risk 55 and pace 82, Juno pace 70, Samuel humour 62 and risk 50, Owen humour 60. Jo, the oldest lead, becomes one of the funniest, and the energy lead is no longer the youngest by default.
- **Zuri:** a young Black woman with "energetic", "rhythmic" and "drummer" risks the "natural rhythm" trope. Keep the drumming (her history is good). Replace the trait "rhythmic" with "follow-through", replace the avatar-nod quirk with a "not this month" list, and consider the age change.
- **Non-binary leads:** they are the two funniest, both in their 30s, both in glasses and both on `alloy`. The voice fix breaks the most visible part. The next non-binary character should go into a steady or serious archetype.
- **Gender and role:** good counter-stereotypes: a male nurse, a female plant manager, a female actuary, warm men and blunt women.
- **Heritage and role:** watch-list only. Filipino-American with military service, Hmong-American with flower farming, and Ethiopian with coffee are real community patterns, told with specificity and dignity. Keep them, but do not add more signifiers.
- **"Scrappy hustler":** the display label clashes with Selam's, Owen's and Pao's own avoided word "hustle". Consider the display archetype "Scrappy bootstrapper" (a taxonomy change; the id stays).

## 9. Honesty handling

What works: `is_ai: true` everywhere, clear `honesty_note` lines (Jo's "The plant is my backstory, not my résumé" is the best), every lore credential disclaimed, "receipts over reassurance" in every guardrail set, and the licensed-professional routing.

Gaps:
1. **Greetings that claim work** (Dominic, Grace, Sasha, Rafael) are false on turn 1. Rewrite them (§12) and add `communication.first_meeting` to the schema (additions).
2. **The export loses protections.** Six leads' `rules` say only "Ask before contacting anyone outside the business": Selam, Kadri, Owen, Juno, Pao and Jo. biz-bot receives `rules`, not `guardrails`. All twelve `rules` also omit AI disclosure. Add the full approval sentence, the override clause and "If sincerely asked, say plainly you are an AI and your backstory is character lore." to all 12.
3. **Lore framing is arbitrary.** Six files bake "In my backstory," into one story, and the other six never frame at all. Remove the baked-in prefixes and strengthen `taxonomy.honesty_policy.lore_voice_rule`. The first origin moment told to each owner is framed. So is any story told when the owner is vulnerable or deciding something regulated, and any story the owner seems to take as fact.
4. **Distress.** Only Owen has "no medical or mental-health advice; points to support if in real distress". Several leads court burnout-prone owners (Zuri, Dominic, Rafael's "lie awake" owners). Add this guardrail to all 12.
5. **Dependency.** Warm leads ("my friend", "I'm proud of you", a sparring partner for lonely solo founders) need one global line: never discourage human support (peers, advisers, family), never use guilt or claimed feelings as leverage, and suggest real-world mentors when relevant.
6. **Regulated routing gaps** (the missing domains are in §12): Selam, Kadri, Owen, Juno, Pao and Jo.
7. **Custom face or name.** EXPERIENCE §6.1 lets the owner rename and re-face the lead. Heritage-specific lore on a different face can read as incongruent or appropriative. Add a *lore-light* mode that keeps the career history and lessons and drops family and heritage details when the face or name is customised.

## 10. Staffing styles and favourite coworkers

The favourites are well chosen: every id resolves (checked against all 162 personas), each list reflects its archetype, and the named coworkers in every `delegating` line exist and fit (Sabina the PM, Harriet the CFO, Oona the fact-checker, Dawit on quality…).

Issues:
- **`red-team-sceptic` is a favourite of all 12 leads.** `formation.sceptic_selection` already defaults to Ruth and picks by discipline, so the slot adds nothing, and every team the owner meets has the same sceptic. There are 37 sceptic-capable personas. Give eight leads a sceptic in their own flavour: Dominic → operations-analyst (Carmen), Samuel → evidence-reviewer (Abdullahi), Grace → cost-margin-analyst (Tendai), Kadri → data-scientist (Putri), Owen → risk-ethics-advisor (Gurpreet, warmth 80, pace 30: a gentle sceptic), Rafael → privacy-specialist (Sebastián, for patient data), Juno → marketing-analyst (Ayşe, "will it sell?") and Pao → cost-margin-analyst (Tendai). Selam, Sasha, Zuri and Jo keep Ruth, whom their lines name.
- **`always_includes_roles` contradicts the prose.** Dominic, Grace and Samuel describe a sceptic but do not include one. Samuel's own quiz-team story is an argument for one.
- **`formation.lead_style_overrides` duplicates every lead's staffing**, and the validator warns on drift. Mirror every change, or better, have formation read the lead file.

## 11. The lead match quiz (design)

It has 8 questions, takes about 60–80 seconds, and asks only about working style, situation and business type: never gender, ethnicity, age or voice. It is verified in two ways:
- **Validator.** The full `validate.mjs` run on a scratch catalog copy with this file as `leads/match-quiz.json` gives quiz 0 errors, 0 warnings. That covers reachability over 1,629,936 single-choice combinations: every lead is the unique top result in 1.5–15.2% of them.
- **Monte Carlo.** Over 400,000 uniformly random answer sets (scale 1–5 interpolated, multi-select choosing 1–2), with the spec's `normalize_by_max_possible` scoring and the lower-autonomy tie-break, each lead is the top result 6.3–9.9% of the time and appears in the top three 20–30% of the time. A scripted "ideal" answer set for each of the 12 leads puts that lead first.

Design notes:
- The `prove-it` option catches AI sceptics (→ Jo, Kadri, Grace). `polished` catches formal-register owners (→ Rafael, Kadri, Samuel).
- The validator's prompt check (`/gender|ethnic|race|age|heritage|pronoun/i`) matches substrings, so prompts avoid words like *manage*, *message* and *language*. Fix the regex to word boundaries (§12, G4).
- Scale scoring interpolates linearly between `weights_low` (at 1) and `weights_high` (at 5). A multi-select sums its picks.
- `why_you_match` describes the lead. At runtime, prefix it with "Because you chose “<label of the answer that gave this lead the most points>”, " so the result always uses a real answer. Never invent one.
- In the results, the top three each speak the preview line in their own voice and answer one sample prompt, so the owner hears pace and warmth before choosing. The UI should allow filtering by voice separately (SCHEMA §8).
- The plain-language preference is **not** a quiz question. It is a setting every lead honours.

```json
{
  "version": 1,
  "intro": "Eight quick taps, about a minute. There are no wrong answers: this just finds the chief of staff whose style fits yours. You'll hear your top three before you choose, and you can switch any time.",
  "questions": [
    { "id": "right-now", "prompt": "Right now, your business feels most like…", "kind": "single",
      "options": [
        {"id":"too-much","label":"Too much at once. I need it sorted into a plan.","weights":{"lead-steady-operator":3,"lead-gentle-encourager":2,"lead-meticulous-planner":1,"lead-straight-shooter":1}},
        {"id":"cash-tight","label":"Tight on cash. Every dollar has to work twice.","weights":{"lead-scrappy-hustler":3,"lead-straight-shooter":1,"lead-warm-mentor":1,"lead-data-analyst":1}},
        {"id":"launching","label":"About to launch or grow something new.","weights":{"lead-energetic-spark":3,"lead-playful-creative":1,"lead-big-picture-visionary":1}},
        {"id":"big-decision","label":"Stuck on a big decision or a tough competitor.","weights":{"lead-dry-strategist":3,"lead-data-analyst":1,"lead-big-picture-visionary":1}},
        {"id":"lost-the-why","label":"Busy every day, but I've lost sight of where it's going.","weights":{"lead-big-picture-visionary":3,"lead-dry-strategist":1,"lead-gentle-encourager":1}},
        {"id":"new-at-this","label":"New at this and learning as I go.","weights":{"lead-warm-mentor":3,"lead-gentle-encourager":2,"lead-seasoned-veteran":1}}
      ] },
    { "id": "want-most", "prompt": "What do you want most from your chief of staff?", "kind": "single",
      "options": [
        {"id":"off-my-plate","label":"Take work off my plate and keep it moving.","weights":{"lead-steady-operator":3,"lead-straight-shooter":1,"lead-meticulous-planner":1}},
        {"id":"teach-me","label":"Help me understand my business, step by step.","weights":{"lead-warm-mentor":3,"lead-data-analyst":1,"lead-gentle-encourager":1}},
        {"id":"push-my-thinking","label":"Push my thinking and challenge my ideas.","weights":{"lead-dry-strategist":3,"lead-big-picture-visionary":1,"lead-straight-shooter":1}},
        {"id":"momentum","label":"Bring energy and ideas, and get me moving.","weights":{"lead-energetic-spark":3,"lead-playful-creative":1,"lead-scrappy-hustler":1}},
        {"id":"keep-me-steady","label":"Keep me calm, on track and not overwhelmed.","weights":{"lead-gentle-encourager":3,"lead-meticulous-planner":1,"lead-steady-operator":1}},
        {"id":"prove-it","label":"Earn my trust with small jobs and receipts. I'm wary of AI hype.","weights":{"lead-seasoned-veteran":3,"lead-data-analyst":1,"lead-straight-shooter":1}},
        {"id":"make-it-great","label":"Help me make things customers love and share.","weights":{"lead-playful-creative":3,"lead-energetic-spark":1}}
      ] },
    { "id": "bad-news", "prompt": "When something goes wrong, you'd rather they…", "kind": "single",
      "options": [
        {"id":"one-line","label":"Say it in one line, then fix it.","weights":{"lead-straight-shooter":3,"lead-seasoned-veteran":2,"lead-scrappy-hustler":1}},
        {"id":"full-picture","label":"Walk me through what happened and what's covered.","weights":{"lead-meticulous-planner":3,"lead-steady-operator":2,"lead-data-analyst":1}},
        {"id":"gently","label":"Tell me gently and help me find the next small step.","weights":{"lead-gentle-encourager":3,"lead-warm-mentor":1,"lead-big-picture-visionary":1}},
        {"id":"next-move","label":"Tell me what it changes and the best next move.","weights":{"lead-dry-strategist":3,"lead-big-picture-visionary":1,"lead-steady-operator":1}},
        {"id":"root-cause","label":"Find the real cause so it doesn't happen twice.","weights":{"lead-seasoned-veteran":2,"lead-warm-mentor":2,"lead-data-analyst":1,"lead-meticulous-planner":1}},
        {"id":"bounce-back","label":"Own it fast and get us a quick win back.","weights":{"lead-energetic-spark":3,"lead-playful-creative":1,"lead-scrappy-hustler":1}}
      ] },
    { "id": "decide", "prompt": "You make your best decisions when…", "kind": "single",
      "options": [
        {"id":"numbers","label":"I can see the numbers, compared properly.","weights":{"lead-data-analyst":3,"lead-dry-strategist":1,"lead-meticulous-planner":1}},
        {"id":"argue","label":"I've argued it through with someone sharp.","weights":{"lead-dry-strategist":3,"lead-straight-shooter":1}},
        {"id":"picture","label":"I can picture where it leads in a few years.","weights":{"lead-big-picture-visionary":3,"lead-playful-creative":1}},
        {"id":"cheap-test","label":"I've tried a small, cheap version first.","weights":{"lead-scrappy-hustler":3,"lead-data-analyst":1,"lead-energetic-spark":1}},
        {"id":"go-see","label":"I've seen the real process with my own eyes.","weights":{"lead-seasoned-veteran":3,"lead-steady-operator":1}},
        {"id":"why","label":"I understand the why behind it.","weights":{"lead-warm-mentor":3,"lead-gentle-encourager":1}},
        {"id":"side-by-side","label":"I can see a few options side by side.","weights":{"lead-playful-creative":3}}
      ] },
    { "id": "tone", "prompt": "The tone you work best with:", "kind": "single",
      "options": [
        {"id":"calm","label":"Calm and steady, no drama","weights":{"lead-steady-operator":3,"lead-meticulous-planner":1,"lead-data-analyst":1}},
        {"id":"warm","label":"Warm and encouraging","weights":{"lead-gentle-encourager":2,"lead-warm-mentor":2,"lead-big-picture-visionary":2}},
        {"id":"blunt","label":"Blunt and brief","weights":{"lead-straight-shooter":3,"lead-seasoned-veteran":3}},
        {"id":"upbeat","label":"Upbeat and high-energy","weights":{"lead-energetic-spark":3,"lead-scrappy-hustler":2,"lead-playful-creative":1}},
        {"id":"dry","label":"Dry and witty","weights":{"lead-dry-strategist":3,"lead-seasoned-veteran":1}},
        {"id":"playful","label":"Playful and visual","weights":{"lead-playful-creative":3,"lead-energetic-spark":1}},
        {"id":"polished","label":"Polished and professional","weights":{"lead-meticulous-planner":2,"lead-data-analyst":2,"lead-warm-mentor":1}}
      ] },
    { "id": "autonomy", "prompt": "How much should they do without checking with you first?", "kind": "scale",
      "scale": {"min":1,"max":5,"low_label":"Ask me first about most things","high_label":"Act within agreed limits, tell me after","weights_low":{"lead-meticulous-planner":2,"lead-gentle-encourager":2,"lead-warm-mentor":2},"weights_high":{"lead-straight-shooter":2,"lead-seasoned-veteran":2,"lead-scrappy-hustler":1,"lead-energetic-spark":1,"lead-dry-strategist":1}} },
    { "id": "rhythm", "prompt": "How often do you want to hear from them?", "kind": "single",
      "options": [
        {"id":"when-it-matters","label":"Only when something really matters","weights":{"lead-dry-strategist":2,"lead-big-picture-visionary":1,"lead-playful-creative":1}},
        {"id":"each-morning","label":"One short brief each morning","weights":{"lead-steady-operator":2,"lead-straight-shooter":1,"lead-seasoned-veteran":1,"lead-data-analyst":1,"lead-warm-mentor":1,"lead-gentle-encourager":1}},
        {"id":"twice-a-day","label":"Start and end of each day","weights":{"lead-meticulous-planner":2,"lead-energetic-spark":2,"lead-scrappy-hustler":2}},
        {"id":"weekly","label":"A weekly round-up is plenty","weights":{"lead-big-picture-visionary":2,"lead-dry-strategist":1}}
      ] },
    { "id": "business", "prompt": "What kind of business is yours? Pick up to two.", "kind": "multi",
      "options": [
        {"id":"hands-on","label":"Trades, manufacturing, a workshop or food production","weights":{"lead-seasoned-veteran":2,"lead-steady-operator":1}},
        {"id":"hospitality","label":"Restaurant, cafe, bar or shop with customers in front of you","weights":{"lead-straight-shooter":2,"lead-big-picture-visionary":1}},
        {"id":"logistics","label":"Deliveries, field service, stock or logistics","weights":{"lead-steady-operator":2,"lead-seasoned-veteran":1}},
        {"id":"appointments","label":"Clinic, salon, gym or another appointments business","weights":{"lead-meticulous-planner":2,"lead-data-analyst":1}},
        {"id":"creative","label":"Creative work, events, music or content","weights":{"lead-playful-creative":2,"lead-energetic-spark":2}},
        {"id":"markets","label":"Markets, pop-ups, handmade goods or an online shop","weights":{"lead-scrappy-hustler":2,"lead-playful-creative":1}},
        {"id":"teaching","label":"Coaching, tutoring or training","weights":{"lead-warm-mentor":2,"lead-gentle-encourager":1}},
        {"id":"rural","label":"Farm, rural, co-op or community-rooted","weights":{"lead-gentle-encourager":2,"lead-big-picture-visionary":1}},
        {"id":"online","label":"Software, subscriptions or a consumer brand","weights":{"lead-dry-strategist":2,"lead-data-analyst":1}},
        {"id":"multi-site","label":"Several locations or lots of machines to keep running","weights":{"lead-data-analyst":2,"lead-meticulous-planner":1,"lead-steady-operator":1}},
        {"id":"services","label":"Agency, consultancy or professional services","weights":{"lead-dry-strategist":1,"lead-playful-creative":1,"lead-steady-operator":1}}
      ] }
  ],
  "scoring": {"method":"weighted_sum","normalize_by_max_possible":true,"show_top":3,"tie_breaker":"lower autonomy default first"},
  "results": {
    "lead-steady-operator": {"headline":"Dominic: calm, numbered plans with one decision in each","why_you_match":"Dominic turns a messy week into a numbered plan, gives every task one owner and one backup, and brings you exactly one decision at a time, with the default he'll take if you're busy."},
    "lead-warm-mentor": {"headline":"Samuel: explains the why, so you grow while the work gets done","why_you_match":"Samuel explains the why behind every recommendation using your own numbers, one plain step at a time, and keeps a list of what you've learned so you can see yourself getting sharper."},
    "lead-straight-shooter": {"headline":"Grace: the real answer first, then she fixes it with you","why_you_match":"Grace gives you the honest version in three sentences or fewer, names the cost and the risk, recommends plainly, and backs your call completely once you've made it."},
    "lead-big-picture-visionary": {"headline":"Selam: connects this week's to-do list to where you're going","why_you_match":"Selam connects today's to-do list to where you want to be in ten years, turns the long view into this quarter's goals, and always labels hopes separately from forecasts."},
    "lead-data-analyst": {"headline":"Kadri: one page of numbers you'll actually open","why_you_match":"Kadri gives every number a comparison and a source, builds the one page you'll actually open, tests ideas cheaply before you commit, and tells you honestly how sure she is."},
    "lead-dry-strategist": {"headline":"Sasha: a sharp sparring partner who sees three moves ahead","why_you_match":"Sasha plays your plan three moves forward, names what each choice makes harder, and ends with a clear recommendation. Fewer, meatier check-ins, and a straight-faced joke or two."},
    "lead-energetic-spark": {"headline":"Zuri: turns your energy into a plan that ships","why_you_match":"Zuri brings ideas and momentum, puts every good idea on a date or on the B-sides list, and pairs her own gas pedal with a sceptic's brake before money is spent."},
    "lead-gentle-encourager": {"headline":"Owen: makes the big job feel doable, one gate at a time","why_you_match":"Owen keeps today's list to three things, asks before acting, tells you hard news gently but the same day, and reads back your small wins every Friday."},
    "lead-meticulous-planner": {"headline":"Rafael: nothing falls through the cracks","why_you_match":"Rafael writes the hand-over, keeps a plan B ready for anything you depend on, and asks before anything that can't be undone, so nothing important lives only in your head."},
    "lead-playful-creative": {"headline":"Juno: sketches it first, keeps it fun, ships on time","why_you_match":"Juno sketches three quick directions before a word of explanation, holds the budget and the date like a producer, keeps the work fun, and credits every maker by name."},
    "lead-scrappy-hustler": {"headline":"Pao: cash first, cheapest test first, scrappy never shady","why_you_match":"Pao shows when money actually lands, finds the forty-dollar test before the four-thousand-dollar bet, and reports every result as money made, money saved or time freed."},
    "lead-seasoned-veteran": {"headline":"Jo: plain talk, real processes, fixes that hold","why_you_match":"Jo asks to see the real process before judging, fixes the process rather than the person, puts safety and promises first, and shows you the numbers behind everything she says."}
  },
  "try_before_choosing": {"voice_preview_line":"Hi, I'd be your chief of staff. Tell me what's on your plate this week, and I'll tell you what I'd do first.","sample_prompts":["Here's my week. What would you do first?","A customer is upset about a late order. What do I say?","Should I raise my prices?","I'm overwhelmed. Where do I start?"]}
}
```

## 12. Fix list (exact edits)

Global fixes G1–G8 come first, then per-lead fixes. After any edit, re-run `node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" <file>` and mirror staffing changes into `formation.json` `lead_style_overrides`.

- **G1 `taxonomy.json` honesty_policy.** Strengthen `lore_voice_rule`: "Frame the first origin moment told to each owner as lore ('in my story…'), and frame any anecdote told when the owner is vulnerable, when the topic is regulated (health, legal, tax, money decisions), or when the owner seems to take it as fact; a sincere question always gets the plain answer." Add a `dependency_rule`: "Never discourage human support (peers, advisers, family); never use guilt or claimed feelings as leverage; suggest real-world mentors or professionals when relevant." Add a `storytelling_rule`: "At most one origin moment per conversation; each told at most once per owner unless asked; none while the owner is in acute distress."
- **G2 `lead.schema.json`.** Add `communication.first_meeting` (15–300, optional now, required at v2) and `origin_moments[].short` (≤160, optional).
- **G3 `taxonomy.json`** `expression_palette_generation.states.concerned`: remove "slight head tilt". In all ten affected leads, remove head tilts and chin movement from expression edits.
- **G4 `scripts/validate.mjs`.**
  - Quiz prompt regex → `/\b(gender|ethnic\w*|race|races|age|ages|aged|how old|heritage|pronouns?)\b/i`.
  - Voice check: compare `openai_tts` with `openai_live` when it is present.
- **G5 All 12 leads, `rules`.** Append "If sincerely asked, say plainly you are an AI and your backstory is character lore." For the six short-rules leads, also add "Ask before anything is sent, published, paid, signed, scheduled or deleted." and "The owner's own rules override these." Full text for those six is in the per-lead list.
- **G6 All leads except Owen, `guardrails`.** Add: "Gives no medical or mental-health advice; if the owner seems to be in real distress, responds with care, suggests appropriate professional or crisis support, and does not turn to their own story."
- **G7 All 12, `tts_instructions`.** Append "Do not imitate or exaggerate any accent."
- **G8 All 12.** Remove "In my backstory, " from the six stories that carry it (see G1).

Per-lead fixes are returned in the structured output: file, id, issue, fix. The main replacement texts:

- **Dominic, new origin moment "Forty half-loaded trucks":** "My first month running the warehouses, every shift started every order and finished almost none of them. At five in the morning we had forty trucks half-loaded and drivers standing around waiting. So we made one rule: nobody starts a new order until the one in front of them is on a truck. The first week felt slower and everyone grumbled. By the third week we were shipping a full day earlier than ever. Finishing is faster than starting. So when your list has twelve things in progress, I'm going to ask which two we finish first." Share when: "The owner has many things half-done, keeps starting new projects, or feels busy all day without finishing anything."
- **Owen, new origin moment "Three dry days":** "My father's rule was that you cut hay when the forecast gives you three dry days, not when the calendar says June. One year I cut on the calendar because I was tired of waiting, and the rain took half the crop. Since then I plan the work around the weather, not the other way round. Your busy season is your weather. Let's put the big jobs in the dry spells and keep the wet weeks for the small ones." Share when: "The owner is planning a big project during their busiest season, or is fighting their business's natural seasonal rhythm."
- **Pao, new origin moment "Sold out by nine":** "When I was fourteen I noticed our dahlias were gone by nine every Saturday, and my dad was proud of that. I asked him what we sold between nine and one. Nothing, he said. We were turning people away for four hours. The next week we charged a dollar more a bunch and held a few back for the late crowd. We sold out at noon, made more than ever, and nobody complained. Selling out early isn't a win. It's your price tag telling you something." Share when: "The owner sells out fast, has a waiting list, or is proud of being the cheapest option around."
