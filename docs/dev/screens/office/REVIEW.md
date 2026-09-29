# Office view: design review (Inc 0.7, Phase 1)

> 29 September 2026. Reviewer: design director pass over `packages/office` and its demo, with the generated art in
> `apps/web/public/office/` wired through the demo config (`publicDir` = `apps/web/public`, `assetsBase` = `/office/`).
> Demo served on `:5877`; portraits via read-only `GET /api/portraits*` to the owner's worker. Nothing committed.
> Fresh screens: [`review/`](review/). Unit tests 46/46 and `demo/check.mjs` 25/25 pass against this build.
>
> **Resolved (29 September 2026).** All 25 fixes below are applied; see
> [OFFICE-PLAN §9](../../OFFICE-PLAN.md#9-phase-1-as-built-29-september-2026) for where each landed and the few places
> the build differs from the wording (fix 1 uses a transform-positioned veil instead of a mask, for frame time). The
> screens in this folder are the after set; [`review/`](review/) keeps the before set. Unit tests 56/56, `check.mjs` 37/37.

## Verdict

**Close, not yet "instantly a real office".** The parts are premium: the generated night skyline is excellent, the
conference room through floor-to-ceiling glass is the strongest single frame, the HUD and picker match Headcount's dark
UI, performance is solid (60 fps with 176 people) and the keyboard and reduced-motion work is thorough.

What stops the instant read is the **seam between the photo and the plan**, and **value contrast in the dark theme**:

1. **The floor floats on the river.** The sky photo runs down past the plate's east, west and south edges, so the
   office sits at water level, not on the 30th floor (`desk-wide-night`, `chief-office`, `conference-walk`). The east
   and west glazing is 1.2 u drawn edge-on and is invisible.
2. **The north glass reads as a railing.** The window band is about 26 px tall at fit, and the sky carries on above
   its top rail. It looks like a balcony fence, not a glass wall (`desk-close`, `hover-bubble`).
3. **The office chairs disappear in dark.** Chairs and furniture sit within about 1.15:1 of the floor. The same view in
   the light theme (`desk-light`) reads as an office at a glance, with mesh chairs, desks and monitors. In dark, at the
   neighbourhood zoom people use most, it reads as a grid of portrait coins.
4. **People are floating heads.** From L1 up, the top-down bodies are hidden and a 26–58 px face covers the chair. On
   the conference stage, faces are medallions hanging in the skyline with no shoulders or chair, and five guests at a
   ten-seat "runway" table leave the lower 60 % of the frame to wood and tombstone-like empty chairs (`conference-5`,
   `conference-garden`).

Fix those four and the owner's sentence ("a floor plan of office chairs… windows and a skyline and typical office
things") is met on first sight. The typical office things are all there and are good at close zoom: the coffee bar
with its espresso machine and island, the lounge, whiteboards with sticky notes, bookshelves, lamps, the library,
printer and phone booths.

## Scorecard

| Question | Grade | Evidence |
|---|---|---|
| Reads instantly as a premium office at night | **B−** | Skyline A. Floor at fit reads as a plan in front of a photo; at L2 (`webkit-max-zoom`) it is a convincing office |
| Windows and skyline | **B** | Art is first-rate; the window band is too thin and the sky leaks below the floor line |
| Office chairs, desks, typical things | **B** | All present; chairs invisible in dark at L1; phone booths read as purple cabinets |
| Cohesion with the dark UI | **A−** | HUD, picker, bubbles and captions match; font token and double-ring issues for Phase 2 (fixes 16, 17) |
| Cohesion with the photoreal portraits | **B−** | Desk mode fine (faces are the status UI); the stage floats faces over the photo with no bodies |
| Names and states legible | **C+** | First names clipped at L1, status lines clipped to about 15 characters at L2, L0 hover plate empty, working vs idle nearly invisible on tokens |
| Motion | **B+** | Calm, CSS-only sky life, no idle rAF; flights interpolate zoom linearly; beacons blink hard at 1 Hz |
| Performance | **A** | 60 fps pan and zoom at L0/L1/L2 with 176 people in Chromium and WebKit; 0 idle rAF |
| Accessibility | **B** | Skip link, roving seats, reduced motion and a modal picker are right; shortcuts are dead until a seat has focus; focus ring uses the speaking colour; 18 px targets at L0 |

## What to keep

- The night, dusk and day skylines with their twinkle and beacon extraction; the fictional city with no landmarks is right.
- Composition at fit: the skyline takes the top ~45 %, the floor ~55 %.
- "Lit by the work" at L0: glowing monitors, lamp pools and blue hand halos make activity readable at a glance.
- Warm pendants over the coffee bar, lounge and tables; walnut, felt and plants; the wall clock and framed art.
- Door plates in the aisles, the Skyline-room glass with reflections, the Chief's corner office.
- The conference-night backdrop with mullions, the speakerphone puck, the caption bar with the speaker's accent, the
  floor queue and the stacked phone stage (`mobile-375-conference`).
- The picker (`conference-picker`): grouped, searchable, with a capacity line. It is clean.
- The engineering: one transformed layer, screen-space faces, zero idle rAF, reduced motion that is complete.

## Measurements

Headless Chromium 1440 × 900 at 2×, 164 catalog people + the Chief + 11 synthetic = **176 seats**, continuous drag for
3 s then inertia (`scratchpad` probe, same method as `demo/check.mjs`).

| Scenario | 1× CPU | 4× CPU throttle |
|---|---|---|
| Pan at fit (L0, 0 faces) | 60 fps, p95 16.8 ms | 57.7 fps, p95 16.8 ms, 8 / 225 frames > 20 ms |
| Pan at 3.2 px/u (L1, 96 faces mounted) | 60 fps, p95 16.8 ms | 54.9 fps, p95 33.3 ms, 20 / 216 > 20 ms |
| Pan at 6 px/u (L2, 96 faces) | 60 fps, p95 16.8 ms | 56.2 fps, p95 33.3 ms, 15 / 220 > 20 ms |
| Wheel zoom in and out (24 notches) | 60 fps | 59.5 fps |
| rAF callbacks while idle (2 s) | 0 | 0 |
| WebKit, pan at L1 | 60.1 fps, p95 21 ms | — |

- No long animation frames were recorded. WebKit renders the plate crisply at the 9 px/u maximum zoom
  (`webkit-max-zoom`), so crop mode (§5.1) is not urgent. Real Safari on a Retina GPU should still be checked once.
- DOM: 9,048 elements in `.hc-office` (plate SVG 3,270 with 878 `<use>`, L0 bodies 963, people layer 1,485). That is
  over the §3.8 budget (2,500 + 200) but costs no frames. Leave it.
- Motion: flights settle in 600 ms (fit: 430 ms), zoom buttons step ×1.6, a 180 px flick glides a further ~530 px
  (τ 325 ms), and five invitees take about 3 s to walk from their desks and sit in the Skyline room.

## Accessibility results

- Tab order: the skip link ("Use the Directory (list view)", visible on focus) → the seat group (one stop) → Desks,
  Conference, Walk to, Find, zoom. ✓
- Arrows move along benches, `F` zooms to the focused seat, keyboard dwell opens the passing-by bubble. ✓
- OS reduced motion: 0 animated sky elements, flights are instant, 0 elements with transitions. ✓ (Motion on: 60
  twinkles and 4 beacons.)
- The picker is `role=dialog` with `aria-modal`; HUD controls are named; the find box is a combobox. ✓
- Problems: fixes 8, 9, 13, 14, 15 and 24 below.

## Fixes, ranked (problem → precise fix)

**P0: the instant read**

1. **The floor floats on the river.** Below the north floor line the sky photo continues beside and under the plate,
   so the office sits at water level. → In `scene/sky.ts` `layout()`, compute the screen y of the plate's north floor
   line (`anchorY` projected through the camera) and write it to `--o-sky-cut` on `.hc-o-sky`. In `styles.ts`, add
   `mask-image:linear-gradient(to bottom,#000 calc(var(--o-sky-cut) - 12px),transparent calc(var(--o-sky-cut) + 28px))`
   to `.hc-o-sky__pan`, so everything below the floor line and beside the plate is `--o-void`. Keep the floor
   reflections (`.hc-o-refl`) as the window's light.
2. **The north glass reads as a railing.** → In `art/symbols.ts`, raise `WINDOW_Z` from 30 to 40. In `windowBand()`,
   add a 2.5 u transom in `wt` at the top edge, a 1.2 u sill in `mu` at the floor, and a tint gradient over the band
   (`rgba(160,190,240,.07)` → `.02` downward). Widen the mullions to 0.8 at every 12 u, with a 0.2 `ge` highlight on
   their west edge. Replace `sideGlazing()`'s 1.2 u strip with a 3 u façade (mullion ticks every 12 u at 1 u wide, a
   `ge` hairline on the inside) so the east and west walls exist at fit.
3. **The furniture is value-flat in dark; the chairs vanish.** → `art/palette.ts` DARK: `--o-floor:#121418`,
   `--o-fabric:#353b45`, `--o-fabric-hi:#4b525e`, `--o-fabric-lo:#23272e`, `--o-mesh:#3b424d`,
   `--o-metal-hi:#58606b`, `--o-wood:#43322a`, `--o-wood-hi:#57432f`. In `symbols.ts`, add a 0.25 u `hair`
   top-edge line to the chair backs and desk tops. Target at least 1.6:1 luminance between chair and carpet, and check
   `desk-zoomed` against `desk-light`.
4. **People float as heads from L1 up, covering their chairs.** → Ground each badge in its chair. Add
   `.hc-o-seat__body` to the seat markup in `scene/scene.ts`: a rounded-top shoulders shape `1.3 × fsx` wide and
   `0.45 × fsx` tall, `top: fsx × .36`, fill `color-mix(in srgb,var(--acc) 38%,#262a31)` with a `.06` white top edge,
   drawn behind the face. Lower the L1 face clamp to `clamp(24px, 5.2u × zoom, 32px)` so the chair back and the star
   base show above and below the badge.
5. **The conference stage is a runway.** Five guests sit in the top 40 %, and near empty chairs render as huge dark
   slabs. → In `stage/stage.ts:635`, pass the party size, not the room size:
   `stageGeometry(w, h, Math.max(5, participants.length + 1), …)`, so the table length follows the meeting. Keep
   `room.capacity` for the picker's limit. Draw pushed-in chairs only between occupied seats, at `.35` opacity with a
   `.1` white top edge instead of solid `url(#hc-o-chair)` silhouettes.
6. **Stage faces hang in the skyline.** They have no shoulders or chair, and dimmed far faces go translucent and melt
   into the city lights. → In `stage.ts`, emit a chair back and an accent-tinted shoulders path per occupied seat into
   the table SVG, clipped by the table's near edge. Add a radial scrim behind each face (`rgba(4,6,10,.55)` at
   `1.7 × size`). Replace `.hc-o-stage[data-speaking] .hc-o-sseat:not([data-speaking]){opacity:.55}` (styles.ts:263)
   with `filter:brightness(.62) saturate(.85)` on the face only.
7. **The Garden room backdrop reads as leaf-print wallpaper** next to the photographic Skyline room. → Add a
   `conference-garden` asset to `scripts/office-art.mjs` (16:9: "softly focused living wall of moss and ferns in a dim
   office meeting room at night, walnut slat frame at the edges, warm pendant light from above, no people, text or
   logos"; `--budget 1 --only conference-garden`). Write it to `manifest.conference.garden` and use it in `stage.ts`,
   with the vector wall as the keyless fallback.
8. **The keyboard map is dead after load and after clicking the floor.** The root is not focusable and `keydown` is
   bound to it. The probe pressed `G` and `/` at load and after a floor click, and nothing opened. → In
   `scene/scene.ts`, set `root.tabIndex = -1`, and in the floor `pointerdown` handler (not on the HUD) call
   `root.focus({ preventScroll: true })`. Add `OfficeOptions.keyTarget?: 'scene' | 'document'` so that in Phase 2 the
   Floor route can route `G`, `/`, `[`, `]`, `+`, `-` and `0` while the Office is the active view.

**P1: legibility, cohesion and integration**

9. **The L0 hover and focus name plate is empty.** At fit the pitch is 24 px, so `.hc-o-seat__name`'s
   `max-width: calc(var(--pitch) - 22px)` is 2 px. The probe measured a 24 × 16 plate with no text. → In `styles.ts`,
   add `.hc-office[data-lod="0"] .hc-o-seat:is([data-hover],:focus-visible) .hc-o-seat__name{max-width:none}` and
   `…__name::after{content:attr(data-full)}` there.
10. **First names are clipped at L1** ("Valen…", "Kenn…", "Taten…", "Mous…", "Chris…"). → `.hc-o-seat__name{max-width:calc(var(--pitch,96px) - 6px)}`,
    plate padding `0 6px 0 4px`, gap 3px. On `[data-hover]` and `:focus-visible`, set `max-width:none` and
    `z-index:2` so the full name shows over its neighbours.
11. **Status lines are clipped to about 15 characters at L2** ("Sketching the la…", "Thinking it throu…"). →
    `.hc-o-seat__sub{white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;max-width:calc(var(--pitch) - 6px);text-align:center;line-height:1.25}`.
    Keep status copy at 48 characters or fewer, the §2.1 cap (the demo's longest line is 49).
12. **Amenity labels collide, are faint, and vanish.** "COFFEE BAR" sits on the Garden room's plant wall, "LIBRARY"
    sits under two planters, both are at opacity .55 (about 2.4:1), and all of them are `display:none` from L1. → In
    `scene/scene.ts:350`, anchor café, lounge and library inside their cell's top-left (`{x: r.x + 3, y: Y(r.y + 4)}`).
    Remove `.hc-o-label--place .hc-o-label__in{opacity:.55}` and the L1 `display:none` (styles.ts:73–75), and render
    them from L1 as the same door plate as the neighbourhoods.
13. **Neighbourhood labels are too small at fit:** 9.97 px computed at 1440 × 900, about 8 px at 1280 × 720. →
    Clamp `.hc-o-label__in` to `font-size:max(11px, …)` and ellipsize long names only at L0.
14. **The focus ring uses the speaking colour** (`--o-halo-speak`), so a focused seat looks like it is speaking. →
    Change `.hc-o-seat:focus-visible .hc-o-seat__ring`, the L0 `__hit` rule and `.hc-o-sseat__face:focus-visible` to
    `0 0 0 2px var(--o-void), 0 0 0 4px var(--ink,#eeece7)`, and keep lamp amber for speaking only.
15. **Targets at L0 are 18 px** (WCAG 2.5.8 asks for at least 24 px; the plan says 44 px). → `.hc-office[data-lod="0"] .hc-o-seat__hit{width:max(24px,var(--hit));height:max(24px,var(--hit))}`
    and `@media (pointer:coarse){… max(44px,var(--hit))}`.
16. **Phase 2 will draw a double ring.** The office draws `.hc-o-seat__ring` state rings, and FaceView draws its own
    `hc-face__ring` on `setState` (CONTRACTS FaceView). → Add `FaceSlot.drawsChrome?: boolean`. When it is true, set
    `data-host-chrome` on the seat and drop the state `box-shadow`s on `.hc-o-seat__ring`, keeping only the outer
    hover, focus and speaking halo.
17. **The font token does not match the app.** `styles.ts:11` uses `var(--font-ui, Inter, …)`, but the app defines
    `--font-sans: 'Inter Variable', …`, so inside the app the office falls back to system-ui. → Use
    `var(--font-sans,'Inter Variable',Inter,ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif)`.
18. **Working and thinking are nearly invisible on L1 tokens.** The only difference from idle is a
    `rgba(255,255,255,.07)` 3 px ring, and north-side badges hide their own monitor glow. → Make the name-plate pip
    carry state, matching the app's `--state-*`: working = a `--lamp` dot with a 2 px `--lamp` 35 % ring; thinking =
    `--muted` with a hollow centre; idle = the accent dot (today's). Raise the monitor spill opacity on north-side
    seats so it shows beside the badge.
19. **Tent cards are illegible and drift from their owners:** 9–10 px text, dimmed with the seat to about 55 %, and
    Nuria's card sits 140 px from Nuria. → Set the name to at least 11 px and the title to at least 10 px, exclude the
    card from the non-speaker dim (fix 6), and anchor `card.x` in `stage/perspective.ts` to `seat.x + 0.25 × size`
    toward the table centre.

**P2: polish**

20. **Mobile fit wastes the screen.** The HUD wraps to two rows (about 170 px), the sky takes about 45 %, people are
    dots, and the Find placeholder is cut off (`mobile-375`). → Below 640 px: collapse Find into an icon button that
    expands, put Walk to on the Desks|Conference row, pass a narrow `anchorY` so the floor fills at least 65 %, and
    open at 2.4 px/u centred on the Chief's neighbourhood.
21. **Flights interpolate zoom linearly** (walkTo café: zoom 1.51 → 1.98 at 45 % of the time → 3.52 at 78 %), so the
    last third lurches. → In `scene/camera.ts`, interpolate `log(zoom)` and move the target's screen position along a
    straight line (solve the pan from the eased zoom), keeping 600 ms `--ease-in-out`.
22. **The beacons blink hard at 1 Hz** (`steps(1,end)`, forever). That is the most attention-grabbing rate in
    peripheral vision, and WCAG 2.2.2 applies. → `hc-o-beacon`: a 2.4 s period, an ease-in-out fade 0.9 → 0.08 with
    about 12 % time lit, at most 3 beacons. Pause twinkle and beacons (`data-calm`) after 30 s without input, and
    resume on pointer or key.
23. **"(not voiced)" is appended to the spoken line** in the same style (`stage.ts:577`). → Render it as a separate
    `<span class="hc-o-cap__tag">not voiced</span>` (10 px caps, `--muted`, 8 px left margin) outside the caption
    text.
24. **The Chief's seat label says "Chief of Staff" twice** ("Eddie Ramos, Chief of Staff, Chief of Staff, …"). → In
    `strings.ts:100` `seatLabel`, drop `group` when it equals `title` (case-insensitive).
25. **The door plate claims a meeting that is not happening.** After `seat(id, 'skyline')` in desk mode, the Skyline
    door reads "Talking with Nina, Nuria and 3 others" while the owner is not there, and `getState().participants` is
    `[]` (X3: nothing claims activity that isn't real). → In desk mode, show "Nina, Nuria and 3 others · waiting for
    you" (a new `S.waitingIn` string) and expose the seated ids as `getState().rooms[roomId]`.

**Minor notes (not ranked):** add a 72 px top scrim (`--o-void` 60 % → 0) behind the desk-mode HUD so it does not sit
on faces. At L2 on 2× screens the 1920 px sky is visibly upscaled; a deliberate `blur(1px)` on the sky image above sky
scale 1.4 reads as depth of field instead of low resolution. Day and night floors are lit identically; raise
`--o-window-a` for day to about .3 so daylight reaches the first bench. The phone booths (library) read as purple
cabinets; give them a glass front (`gl` + `ge` edge) with the stool and lamp visible.

## Screens (`review/`)

| File | Shows |
|---|---|
| `desk-wide-night.jpg`, `tod-night/dusk/day.jpg` | Fit hero at 1440 × 900 in the three variants |
| `fit-1280x720.jpg`, `fit-1920x1080.jpg` | Fit at other laptop sizes (label size, fix 13) |
| `desk-zoomed.jpg`, `walking.jpg` | L1 at neighbourhood zoom (fixes 3, 4, 10); invitees walking |
| `desk-close.jpg`, `webkit-max-zoom.jpg` | L2 with window band (fix 2) and status lines (fix 11); WebKit at 9 px/u |
| `hover-bubble.jpg`, `hover-l0.jpg` | Passing-by bubble at L1 and at L0 |
| `chief-office.jpg`, `library.jpg` | Corner office and river at floor level (fix 1); library, booths and reception |
| `conference-5.jpg`, `conference-garden.jpg`, `conference-picker.jpg`, `conference-walk.jpg` | Stage (fixes 5–7, 19), picker, desk-mode room |
| `mobile-375.jpg`, `mobile-375-conference.jpg` | Phone floor (fix 20) and stacked stage |
| `desk-light.jpg`, `fallback-skyline.jpg`, `webkit-fit.jpg`, `demo-panel.jpg` | Light theme reference, keyless vector city, WebKit fit, harness panel |
| `a11y-skip-link.jpg`, `a11y-focus-l0.jpg`, `a11y-focus-desk.jpg` | Skip link, L0 focus with the empty plate (fix 9), L2 focus ring (fix 14) |
| `walkto-menu.jpg`, `find-sam.jpg`, `find-sam-enter.jpg` | `G` and `/` after a floor click: nothing opens (fix 8) |
