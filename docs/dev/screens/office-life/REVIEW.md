# Office life: UX, game-feel and comedy review

> 29 September 2026. Reviewer: UX research, game feel and comedy editing pass over office life as built
> ([OFFICE-LIFE §8](../../OFFICE-LIFE.md#8-the-life-engine-as-built-29-september-2026)): `packages/office/src/life/**`,
> the scene's life UI, the huddle engine (`packages/expressions/src/huddle.ts`) and all 412 exchanges in
> `catalog/expressions/huddles/**`. The demo ran on `:5877` with life on and the real huddle engine wired
> ("Small talk: 412 exchanges from catalog/expressions/huddles"). Portraits came through the demo's GET-only proxy.
> Nothing was changed in code or content, and nothing was committed. Evidence frames are in [`review/`](review/).
>
> **Owner request (verbatim):** *"the new office layout mode should be fully autonomous - the agents move around
> automatically and even talk near the water cooler. It adds more liveliness to the whole thing. We want this to feel
> familiar and meaningful, not arduous and unusable - please ensure the user experience is delightful!"*

## Verdict

**Well-built plumbing, but the feeling isn't there yet: the office is too quiet to notice.** Everything the rules ask
for works. Movement is honest, real work overrides breaks within about 7 s, walking is smooth, huddles form and turn to
each other, and Join greets you by name. Reduced motion and Pause behave, and the content is warm and mostly clean.

The owner will still open the Office and not see the thing they asked for:

1. **The water cooler hardly talks.** With the camera held on the café at L1 in Lively for 140 s, one exchange of three
   lines played. Over 5.5 minutes a bubble was on screen in **3 %** of frames at Lively, **6 %** at Buzzing, and
   **0 %** at night. By the plan's own numbers, the cooler and coffee bar hold a huddle only **28 %** of working hours
   at Lively.
2. **Most breaks are lonely.** At Buzzing, 20 people were away from their desks but only one huddle was running. You
   see people standing alone at windows, benches and the cooler. The office reads as scattered, not social.
3. **Zoomed out, you see no life at all.** The default camera is fit. There, people are 4 px dots, talk never runs, and
   the first walker showed up 28 s after opening because the opening nudge never fires.
4. **Following, clicking and autopilot fight life.** Follow freezes the person you follow, because focus holds them in
   the aisle. Talk bubbles swallow clicks meant for people underneath. Autopilot parks on a raised hand for minutes.

The fixes are mostly tuning and small scene changes, not a redesign. Ranked fixes are at the end.

## How I watched

The demo clock was pinned (`day=2026-09-29`), with frames captured about every 2.8 s at 1440×900, bubbles logged by a
MutationObserver, and life state sampled with every frame. Four 5.5-minute sessions ran side by side. Interaction,
reduced-motion, phone and performance probes ran separately.

| Session | Camera | Walkers on the floor (avg / max) | Walker in view (% of frames) | Huddles on the floor (avg / max) | Talk bubble on screen (% of frames) | Lines seen |
|---|---|---|---|---|---|---|
| Lively 10:36 | fit 60 s → café L1 140 s → L1 → autopilot 120 s | 0.77 / 4 | 29 % | 0.78 / 2 (0 for 136 s straight) | 3 % | 3 |
| Buzzing 10:36 | fit → café L1 → two neighbourhoods | 1.45 / 4 | 59 % | 0.38 / 1 | 6 % | 6 |
| Quiet 10:36 | fit → café L1 → L1 | 0.53 / 2 | 40 % | 0.58 / 1 | 0 % (silent by design) | 0 |
| Lively 23:10 | fit → north glass L1 → fit | 0.79 / 3 | 42 % | 0.19 / 1 | 0 % | 0 |

The plan statistics were computed from `life.plan()` over 09:00–18:00 at a one-minute step:

| | Quiet | Lively | Buzzing |
|---|---|---|---|
| Huddles per day | 155 | 420 | 604 |
| Share that are desk drop-bys | 48 % | **60 %** | 55 % |
| Sizes (2 / 3 / 4 people) | 155 / 0 / 0 | **399 / 21 / 0** | 580 / 24 / 0 |
| Concurrent huddles, whole floor (avg; % of minutes with none) | 0.46; 64 % | 0.96; **41 %** | 1.45; 23 % |
| Cooler or coffee bar holds a huddle | 18 % of minutes | **28 %** | 33 % |
| Walkers on the floor (avg; % of minutes with none) | 0.82; 43 % | 1.38; 25 % | 2.02; 14 % |

## What works (keep it)

- **Honest movement.** Setting a person at the cooler to `working` gives 1.5 s of hysteresis, a brisk walk of about
  5.5 s, then their desk with the monitor lit, while the huddle carries on with the two left. `thinking` never moves
  anyone. Nobody uses booths or rooms. Life never lights a lamp.
- **Walking feels good.** A tracked walk at L1 (378 samples over 8.2 s) had no speed spikes: eased start and stop,
  rounded corners, facing that follows the path ([`15-walk-frames`](review/15-walk-frames.jpg)). No sliding and no
  stampedes, and walkers stayed within the caps the whole time.
- **Tuning in at L0 is the best moment in the feature.** Press **H** at fit, and the cooler huddle gets a ring while its
  card shows the live lines ([`11-H-at-fit-card`](review/11-H-at-fit-card.jpg)). Hovering the ring opens the card in
  about 416 ms. **Join** brings "Oh, hi Dana!" and turns the card into a tidy group chat
  ([`12-joined-chat`](review/12-joined-chat.jpg)).
- **Clicking a clear walker** opens them in 4 ms and eases them to a stop, and **F** shows "Following Bartek · Esc".
- **Reduced motion** (from the OS or `?rm=1`) fades people between places, at most one fade at a time, with no walking.
  The popover says "Off with reduced motion". **Pause** works.
- **Night is beautiful** ([`13-night-l1`](review/13-night-l1.jpg)). The light theme at Buzzing is the most readable
  "office" frame of all ([`03-buzzing-solo-breaks`](review/03-buzzing-solo-breaks.jpg)).
- **Performance on this machine.** Pan p95 is 16.7 ms at fit, L1 and L2 at every Ambience, with no page errors in any
  session. With no walker in view, the page requests no animation frames.
- **Content honesty is mostly clean.** No line mentions the owner. Embodiment appears only as counterfactuals, there is
  no weather and no fake work, and every debate ends friendly.

## Findings

### 1. Alive? Barely, and only if you hunt for it

- **Talk is the owner's headline ask, and it's the rarest thing on screen.** Lively allows one exchange per huddle
  (`LIFE_CAPS.lively.exchangesPerHuddle = 1`), and a huddle talks only at L1+ while in view. So a 2–4 minute huddle
  talks for about 15 s and then stands silent. Across the whole floor there are about 0.96 huddles at a time, and 60 %
  of them are desk drop-bys. Put together, a viewer framed on the café sees roughly one short exchange every few
  minutes ([`02-lively-cafe-l1-2min`](review/02-lively-cafe-l1-2min.jpg): 13 frames over 2 minutes, one bubble).
- **Groups are nearly always pairs.** `sizeFor` draws 3–4 people 45 % of the time. But partners must be within 12 s of
  walking, most chosen spots hold only 2 (drop-bys, windows, island stools), and 4 is allowed only at anchors. The
  result is 95 % pairs and zero huddles of 4 at Lively. The lively clusters that make an office feel social never
  happen.
- **Solo breaks outnumber huddles about 20 to 1** at peak ([`03-buzzing-solo-breaks`](review/03-buzzing-solo-breaks.jpg)):
  lone people at the north glass, the benches, the lounge and the cooler. The rule that two solo breaks never stand
  side by side keeps things legible, but it makes the floor lonelier.
- **Zoomed out, life is invisible** ([`01-fit-life-invisible`](review/01-fit-life-invisible.jpg)). Fit is the default,
  and there walkers are 4 px dots. The "first ten seconds" nudge (`nudge()`) returns early whenever anyone *away* is in
  view, which at fit is always, so nothing moves for about 25 s.
- **Night is static.** No huddle and no window pair came into view in 5 minutes at 23:10. It's calm, but nothing says
  "night crew".

### 2. Familiar? The habits exist, but nothing tells you about them

The Amara, Emilio and Hira crew gathers at the café cooler at 10:36 on every load, which is the familiar anchor
working. But the card calls it only "Water cooler · Amara, Emilio, Hira". Nothing tells the owner it's a daily habit.
On top of that, every reload replays the same first joke ("Race you back to the desks?" / "It'd be a draw." / laughs):
it was the first exchange in four separate sessions, because the demo keeps huddle recency in memory only. Familiar
people and places are good; a familiar punchline is not.

### 3. Meaningful and honest: mostly yes, with four leaks

- **Sad-mood lines play on good days.** Nineteen "support" exchanges have a negative mood fit, for example hd-a.060
  "Rough stretch? / A bit.", hd-a.072 "you don't have to carry it alone" and hd-a.067 "That means a lot today". Mood fit
  is only a soft score (about 0.45 against a neutral mood), so in a 5-day simulation with baseline moods they were
  **22 of 540 picks (4 %)**. They claim a hard day that no event backs. They also make the owner feel they're
  overworking the team, which the anti-patterns table rules out as guilt and pressure.
- **Lines that can be checked and are false.** "The café's all ours." (hd-a.156) and "The cooler's all ours."
  (hd-a.160) play at a busy café. "On break for four seconds now." (hd-b.001) is a number. "Midnight espresso?"
  (hd-a.043) was served at 22:xx.
- **The pill says "away".** "2 huddles · 12 away" reads as unavailable in every chat app. That contradicts D2 and the
  design's own rule that away from the desk means available.
- **The demo's hover line claims work for people on a break.** Hovering Bartek mid-break showed "Rewriting the pricing
  page so it reads plainly." ([`07-follow-held-in-aisle`](review/07-follow-held-in-aisle.jpg)). The demo's line list is
  random, but Phase 2 must not repeat this: passing-by lines for someone on a break have to be about availability.
- **Grounding is only partly exercised.** The demo passes `grounding: null`, so wins and welcomes never play and the
  planner takes no events (§8.5). Those paths are untested in the live picture.

### 4. Legible? Mostly, but bubbles collide with people

- **Bubbles cover faces (rule O5).** Of the frames with a talk bubble on screen, the bubble overlapped someone else's
  face in 1 of 3 at Lively and 4 of 7 at Buzzing. Amara's line slid left over Kenza and Bartek at the island
  ([`04-bubble-covers-faces`](review/04-bubble-covers-faces.jpg)). Placement avoids groupmates and the open card, but
  not bystanders.
- **Laughs show up as speech bubbles.** A full bubble with a name header reading "(laughs softly)"
  ([`05-laugh-as-bubble`](review/05-laugh-as-bubble.jpg)) works like a sitcom laugh track, and 33 % of served exchanges
  carry one. In the joined card, "(laughs)" can even be the first line shown, cut off from its joke.
- **Desk drop-bys crowd the desk.** The visitor stands on the host's name plate and on the neighbourhood label, and the
  card title "At a desk · Jasleen, Nayra" doesn't say whose desk
  ([`09-dropby-crowding`](review/09-dropby-crowding.jpg)).
- **Name plates collide and duplicate.** At the island stools the plates overlap ("Kenza" and "Bartek" read as
  "Kenzaartek"). At L2 the ghost plate "Bartek · nearby" sits right under Bartek himself.

### 5. Effortless? Watching is easy; the interactions trip over holds and overlays

- **Follow freezes the person.** Focusing someone holds them (claim 1), so pressing F leaves the camera following a
  person frozen in the boulevard. After 24 s Bartek was still "held" at a point in the aisle
  ([`07-follow-held-in-aisle`](review/07-follow-held-in-aisle.jpg)).
- **Bubbles swallow clicks.** `.hc-o-bubble__in` has `pointer-events:auto`. A reply bubble lingering after Leave
  covered a walker, and clicking the walker did nothing ([`06-bubble-hides-walker`](review/06-bubble-hides-walker.jpg)).
- **Join doesn't put you in the chat.** After a pointer Join, focus stays on `body`, so the owner has to click the field
  before typing.
- **Autopilot parks on raised hands.** It flew to "Aino · Waiting on you" (score 100) and held there for 110+ s,
  ignoring a huddle that started meanwhile ([`08-autopilot-parked-on-hand`](review/08-autopilot-parked-on-hand.jpg)).
  Raised hands can last hours in the real app.
- **The What's happening items offer only "Follow".** That includes a raised hand at a desk and a standing huddle
  ([`10-popover-follow-only`](review/10-popover-follow-only.jpg)). Nothing previews what anyone is saying.
- **Phones.** The pill is an unlabeled 31 px dot, and its sheet opens on top of an open huddle card, so two overlays
  stack ([`14-phone-popover`](review/14-phone-popover.jpg)). Tapping a huddle does open its card, which works well.

### 6. Performance: smooth on a fast Mac, heavy to start, and costly on slower CPUs

| Probe | Result |
|---|---|
| Pan with life, 1× CPU (fit / L1 café / L2 at Buzzing; L1 at Lively) | p95 16.7 ms everywhere; Lively L1 p99 33 ms (3 janky frames) against 2 with life off |
| Idle with walkers in view, 4× CPU, Buzzing L1 | p95 **33 ms**, 44 of 254 frames over 25 ms (life off: p95 16.8 ms) |
| Idle at fit, 4× CPU, Buzzing | 77 of 220 frames janky: walking L0 bodies repaint the plate (the walker layer is not built, §8.5) |
| Pan at L1, 4× CPU, Buzzing | p95 33 ms, 28 janky frames (life off: p95 16.8 ms, 15 janky) |
| Time to ready | **1,190 ms** with life and the huddle engine vs 257 ms without life (591 ms with `lines=sample`) |
| Long tasks at open | 281 ms + 146 ms (4× CPU: **1,209 ms + 608 ms**). About 320 ms of that is eager `blendOf` → `buildAgentIndex` for all 165 people plus compiling; about 106 ms is `planDay` |
| Ambience change (replan) | 55–85 ms, blocking (the §7.1 budget is 15 ms) |
| Phone 375 px, 4× CPU, L1 | pan p95 16.7 ms, fine |

### 7. Content read (all 412 exchanges, plus 70 served with the real cast)

**Tone.** Warm, clever and on-brand. The self-aware humour is the signature and it lands: "I don't commute. I load." /
"I fade in, very elegantly." · "Nice to see a face that isn't on a monitor." / "Technically, mine is always on a
monitor." · "I walked here frame by frame." / "The pathfinding does love a corner." · "Do the plants know we're
software?" / "Let them have this." The debates are affectionate and always resolve.

**Problems, by how often you'd notice them:**

- **Laugh-track cadence.** 265 of 412 exchanges end on a beat: 131 laughs, 91 smiles and 43 nods. The joker often
  laughs at their own line.
- **Fortune-cookie craft talk.** A large share of the craft and tools lines use the "X is a Y" aphorism shape, and
  "promise" alone appears 11 times ("A grid is a promise…", "A subject line is a promise…"). Read ten in a row and it
  sounds like LinkedIn.
- **Therapy-poster cluster.** hd-a.060–078 and hd-b.154–163 ("Be kind to yourself today", "Some hours are uphill") are
  wellness platitudes. When they play without a real low mood, they are dishonest as well as cringe (see §3).
- **Chief flattery.** "Eddie has the calmest walk on the floor. Very in charge." and "Good captain. Quiet deck." read as
  sucking up to the boss.
- **Dead content.** Seven `phone_booth` exchanges (hd-b.178, 184–187, 191, 200) can never play, because booths are for
  real calls only and hold one person.
- **Exhaustion.** In a 5-day simulation where every planned huddle is seen (the "open on a second screen" case), the
  engine served 197, 196, 81, 48 and then 18 exchanges per day. From midweek on, most huddles go silent. Even on day
  one, 907 of the week's 1,220 silent picks were desk drop-bys, which have only 66 exchanges.

**Honesty check.** No owner references, no ungrounded completion claims and no weather. Embodiment appears only as
counterfactuals, which honours amendment A2. The leaks are the four listed in §3 (the sad-mood lines and the false
claims).

## Fixes (ranked; problem → precise fix)

**P0: deliver the ask (liveliness and water-cooler talk)**

1. **Talk is too rare.** At Lively, allow `exchangesPerHuddle` 3 (Buzzing 4) with a 20–40 s gap while the huddle is at
   L1+ in view. Raise Lively `linesPerMin` from 6 to 10 and `burst` from 4 to 6. Framing a quiet huddle should start an
   exchange within 1.5 s. Target: at L1 on the café, a bubble on screen ≥ 25 % of the time between 10:00 and 17:00.
2. **The cooler and coffee bar are empty 72 % of the day.** In `planDay`, after anchors and crews, fill the gaps at the
   café cooler and counter with ad-hoc huddles. Target occupancy 09:30–17:30: ≥ 65 % at Lively, ≥ 80 % at Buzzing,
   30 % (silent) at Quiet. Use about 3× the ad-hoc rate at social spots.
3. **Huddles are 95 % pairs.** For social spots, relax the partner walk limit from 12 s to 20 s. When the size draw is
   3 or more, choose among spots with `huddle ≥ 3`. Allow 4 outside anchors at Lively for the café and the lounge sofa.
   Crew huddles should bring every crew member who is present.
4. **Lonely solo breaks.** Raise the huddle share of breaks from `0.15 + 0.45 s` to `0.35 + 0.45 s`. When two solo
   breaks overlap at one spot for ≥ 30 s, merge them into a pair huddle (turn, nod, talk rules apply) instead of keeping
   them apart. Allow at most one solo break at a time at the cooler or counter.
5. **60 % of huddles are desk drop-bys, and most are silent.** Cut the visit probability from `0.12 s` to `0.05 s` and
   exclude `desk_dropby` from ad-hoc spot choice unless the initiator's sociability is ≥ 0.6. Title drop-bys
   `atDesk(host)` · "Nayra visiting". Place the visitor at the desk end on the aisle side, never over the host's plate
   or the neighbourhood label.
6. **Nothing is visible at fit.** When life is on, open at L1 framed on the liveliest neighbourhood (or the last camera
   the owner used). At L0, draw walkers as 7 px accent dots with a 2 s fading trail. Pulse the huddle glyph in the
   speaker's accent while a line runs. Put the nearest huddle's latest line in the pill's tooltip.
7. **The opening nudge never fires.** In `nudge()`, test "nobody *walking* in view" (`!r.arrived`) instead of "anyone
   away in view". Also skip the settle beat for a huddle already in view, so it talks within 2 s of opening.

**P1: interaction bugs**

8. **Follow freezes its target.** `follow(id)` should clear that person's `focus` and `hover` holds (keeping `bubble`
   only while a chat is open), mark them as followed rather than held, and resume a walk that was stopped. Test: follow
   a walker, they reach their spot, and the camera arrives with them.
9. **Stranded in the aisle.** When a hold ends on someone stopped mid-walk, resume the walk. While held, step 6 u to
   the lane edge so others can pass.
10. **Talk bubbles swallow clicks.** Set `.hc-o-bubble--talk .hc-o-bubble__in{pointer-events:none}`, or route a click
    on a talk bubble to the huddle card. Owner reply bubbles should expire within 4 s after Leave.
11. **Bubbles cover bystanders' faces.** In bubble placement, treat every visible face rect as an obstacle, not only
    groupmates'. Try above, then above-left or above-right, then below, then beside. As a last resort, cap the width
    at 200 px above the group's top-most face.
12. **Laughs as speech bubbles.** Render laughs as a muted caption chip beside the laugher (no header, no tail,
    ≤ 1.2 s) plus the smile cue, outside the bubble caps. In the card, append the laugh to the previous line
    ("… a draw. · Emilio laughs") so it never stands alone.
13. **Join leaves focus on the page.** On Join (pointer or Enter), focus `.hc-o-hcard__input` once the greeting has
    rendered. Keep **R** for returning to the field later.
14. **Autopilot parks on raised hands.** Show a raised-hand moment once per state change, hold it for ≤ 10 s, then
    score it −100 until the state changes. Prefer a huddle that is mid-exchange, and hold for its remaining turns.
15. **"Away" in the pill.** Use `pill` "2 huddles · 12 on a break". With no huddles, drop the zero and show
    "12 on a break". At night, show "Night floor · 3 at the windows".
16. **Popover actions don't fit.** Give each moment kind its own primary action: raised hand → **Talk**, huddle →
    **Listen** (plus **Join**), walker → **Follow**. Show the huddle's latest line as the item's second line.
17. **The same joke on every reload.** Persist huddle recency (`snapshot()` → `localStorage['hc.expr.huddles.v1']`) in
    the demo too, as §7.3 item 7 specifies for Phase 2. Record on the first visible line. Sync it through the workspace
    later, so the floor-wide daily cap holds across devices.
18. **Phone overlays.** Opening the pill sheet should close the huddle card, and vice versa. Give the dot an accessible
    name ("What's happening: 2 huddles") and a 44 px hit area.

**P1: content**

19. **Sad-mood lines on good days.** In `pickExchange`, hard-gate exchanges with `mood.valence ≤ −0.2` to
    `mean.valence < −0.1` coming from real events, and cap them at one per floor per day. Rewrite half of the
    hd-a.060–078 and hd-b.154–163 set as light self-aware lines ("Stuck?" / "Politely stuck. The cooler's helping.").
20. **False, checkable claims.** Add a director context `spot_empty` (no one else at the spot) and require it on
    hd-a.156 and hd-a.160. Change "four seconds" to "a few seconds" (hd-b.001). Gate "Midnight" to 23:00–01:00 or
    reword it (hd-a.043). Add a lint for digits and number words in ungrounded lines.
21. **Dead phone-booth content.** Change the `spots` of hd-b.178, 184–187, 191 and 200 to library or lounge. Make the
    validator reject `phone_booth` in huddle exchanges.
22. **Laugh track and aphorism fatigue.** Cap laugh endings at ≤ 20 % by turning about 60 laughs into smiles or no
    beat. Have the listener laugh, not the joker. In the next content round, rewrite about 60 "X is a Y" craft and
    tools lines as real back-and-forth: a question, a disagreement, a callback ("Still naming the fern?").
23. **Library runs dry for second-screen viewers.** When the pool is empty, allow any exchange the current participants
    haven't heard in 14 days (raise the floor-wide weekly cap for ungrounded exchanges from 2 to 4). Change habituation
    to "about one exchange every 3 minutes" rather than skipping half. Commission +200 cooler and coffee-bar exchanges
    and +60 drop-by exchanges.
24. **Chief flattery.** Replace hd-b.165 and hd-b.166 with light lines, for example "Eddie's floor walk is basically a
    screensaver." / "A very reassuring screensaver."

**P2: performance**

25. **Startup freeze.** Render the floor first. Take blends from a precomputed field in the catalog bundle, or compute
    them in `requestIdleCallback` chunks. Compile huddles on the first `lines()` call. Run `planDay` in idle slices or a
    worker. Target: life adds < 50 ms of long tasks at open.
26. **Replan hitch.** Replan (Ambience, people, midnight) in idle slices and apply the result at `now + 30 s`, as
    specified. Target: ≤ 15 ms per slice.
27. **Slow-CPU frame cost.** Build the `.hc-o-walkers` layer (§2.6, still unbuilt): walking L0 bodies on their own
    composited layer with transform-only updates, walker updates capped at 30 Hz at L0, and no gait bob at L0. Target:
    4× CPU idle p95 ≤ 20 ms with walkers in view.

**P2: polish and meaning**

28. **Plates collide and duplicate.** Space the island stool slots ≥ 16 u apart, or alternate plate sides. Hide a ghost
    plate when its person is within 60 u of their desk. Fade the neighbourhood label to 40 % while a walker crosses it.
29. **Passing-by lines for people on a break (Phase 2 honesty).** When `life.whereIs(id).state` is `break`, `huddle` or
    `walking`, the hover or passing-by line must be about availability ("Just stretching my legs. What's up?") and never
    a work status. Fix the demo's `onHover` the same way.
30. **Habits aren't discoverable.** Give anchor and crew huddles a card subtitle ("Their usual 10:40 at the cooler") and
    a matching popover line, so the owner learns the rhythms that make the floor feel familiar.

## Evidence ([`review/`](review/))

| File | Shows |
|---|---|
| `01-fit-life-invisible` | The default fit view at 10:37: 4 px bodies, huddle glyphs only |
| `02-lively-cafe-l1-2min` | 13 frames across 2 minutes at the café at L1, Lively: one bubble, then silence |
| `03-buzzing-solo-breaks` | Light theme, Buzzing: 20 away, one huddle, lone people everywhere |
| `04-bubble-covers-faces`, `05-laugh-as-bubble` | Amara's line and "(laughs softly)" covering Kenza and Bartek |
| `06-bubble-hides-walker` | A lingering reply bubble over a walker, which ate the click |
| `07-follow-held-in-aisle` | "Following Bartek": held in the boulevard for 24 s; a work-claiming hover line on a break |
| `08-autopilot-parked-on-hand` | Autopilot framing a raised hand at the Core crew desks for 110+ s |
| `09-dropby-crowding` | A drop-by visitor on the host's plate and the neighbourhood label; "At a desk" card |
| `10-popover-follow-only` | What's happening: Follow for every item |
| `11-H-at-fit-card` | H at fit: the ring and the live card (the best moment) |
| `12-joined-chat` | The joined chat: greeting by name, "You", a reply |
| `13-night-l1` | 23:12 at the north glass: beautiful and static |
| `14-phone-popover` | Phone: the popover sheet over an open huddle card |
| `15-walk-frames` | A walk at L1 in 126 ms steps: smooth, eased, keep-right |

Probe scripts (not committed) lived in the session scratchpad: `watch.mjs` (long watch with a bubble log), `interact.mjs`,
`a11y.mjs`, `perf.mjs` (rAF frame times, 1× and 4× CPU), `planstats.mjs` and `picks.mjs` (5-day engine simulation).
