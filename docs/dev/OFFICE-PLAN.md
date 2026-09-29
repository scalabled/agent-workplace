# The Office: design and build plan (Inc 0.7)

> **Status.** v1.1, 29 September 2026: Phase 1 is built and polished against the design review
> ([`screens/office/REVIEW.md`](screens/office/REVIEW.md); all 25 fixes are in, §9). The Phase 2 checklist is §6.
> v1.0 was 28 September. Owner request: *"add an interactive conference room or desk mode to show workers
> arranged in a floor plan of office chairs so it looks like an office with windows and a skyline and typical office
> things"*. Binding inputs: OWNER-DIRECTIVES D3 ("The Floor looks like a real office", dark by default, minimal) and
> D5 (living workforce); MVP-PLAN Inc 0.7; EXPERIENCE §3.2, §3.4, §3.5, §4, §9.2, §10; ARCHITECTURE §3.5, §7, §9;
> CONTRACTS §4.10 (FaceView); LIVING-WORKFORCE §8–9; `catalog/taxonomy.json`.
>
> **Two phases.** **Phase 1** (now, in parallel with Inc 0.5) builds `packages/office` (framework-agnostic scene,
> layout, art, conference stage, tests, dev harness), `scripts/office-art.mjs` and the skyline art in
> `apps/web/public/office/`. **Phase 2** (after Inc 0.5 lands) mounts it on the Floor route and wires it to the
> living layer, the audio engine and a room endpoint (§6).
>
> **Layout sketch** (generated from the §3 rules, schematic, not final art):
> [`screens/office/layout-sketch.png`](screens/office/layout-sketch.png) · [`.svg`](screens/office/layout-sketch.svg)

---

## 0. The office on one page

The Floor gets a second view beside the Directory: **the Office**, one open-plan tower floor at night, seen from above
at a gentle angle, with the city behind floor-to-ceiling glass. Every coworker sits at a desk in their department's
**neighbourhood**; the Chief of Staff has the corner office; two glass **conference rooms**, a coffee bar, a lounge and
a library sit in the middle. Faces float above the chairs as live badges and are the status UI (D3). Pan and zoom like a
map, rest on a desk for a passing-by line (D5), click to chat. Walk into a conference room, invite people to the
table, and talk to the room: they answer in turn, in their own voices, with captions.

| Decision | Choice | Why (short) |
|---|---|---|
| Camera | **Orthographic 3/4 top-down**, 55° elevation, looking north; no rotation | Legible plan for 165 labelled seats; arrow keys map to the grid; upright text; one drawing per asset (§1.1) |
| Rendering | **SVG plate** in one CSS-transformed layer + **screen-space HTML overlay** for faces, labels and bubbles; the sky is a screen-space raster layer behind | 60 fps pan/zoom on the compositor, crisp faces at every zoom, theme by CSS tokens, accessible buttons (§5.1) |
| Skyline | Generated **night / dusk / day** panoramas picked by the owner's local time, subtle parallax, CSS twinkle; a **procedural vector skyline** when no art or keys exist | Owner asked for it; keyless-first rule (§1.3) |
| Light | Four sources only: **skyline**, **pendants** (ambient), **monitors** (work, in the person's accent), **desk lamps** (Night Shift) | "A well-run office, lit by the work"; an idle office looks idle (X3) (§1.2) |
| Layout | Deterministic from the catalog: **8 × 3 grid of 96 × 80 u cells** (1 u = 10 cm): 18 department neighbourhoods, 2 conference rooms, the Chief's office, 3 amenity cells | Calm, orderly, stable seats; the same cells become project pods in Inc 1 (§3) |
| Faces | FaceView through a host **`faceFactory`**; `packages/office` has **no dependencies** | No coupling, no `pnpm install` during the concurrent build (§5.4) |
| Budget | ≤ 3 animated tiles + 1 hero; ≤ 96 mounted faces; 176 still tokens pan/zoom at 60 fps; zero rAF when still | EXPERIENCE §4.5, ARCHITECTURE §9.4 (§3.8) |
| Accessibility | Roving-tabindex seat buttons, full keyboard map, reduced motion, a skip link to the **Directory**, which stays the screen-reader and phone default | X11 parity, §9.2 (§4.7) |

---

## 1. Art direction

### 1.1 Camera and projection: orthographic 3/4 top-down

A fixed orthographic camera tilted to **55° elevation**, facing north. World point `(x, y, z)` in u projects to
`(x, y·0.82 − z·0.57)` (sin 55°, cos 55°), then the camera applies pan and zoom. Floors read as a plan, slightly
foreshortened; furniture shows its top and its south face; walls rise toward the viewer's top edge.

Isometric was considered and rejected:

- **Legibility.** 165 seats with names and status sentences need upright, aligned labels. Isometric rows run diagonally,
  labels fight the grid, and badges overlap along the diagonals at overview zoom.
- **Keyboard.** Arrow keys must move along benches and across aisles (§4.3). In isometric, "up" is ambiguous.
- **Windows and skyline.** With a north-facing camera the whole north façade is one continuous window band with the
  city behind it, and the east and west glazing frames the plate. Isometric shows two half-walls and hides the others.
- **Art cost and consistency.** One view per asset (plus chair orientations), easy seat maths, simple hit-testing,
  and a plan that later doubles as the Inc 1 pod map.

The **conference stage** (§2.4) is a separate, closer composition at a lower angle (the owner's seat at the near end
of the table), not the same camera zoomed in.

### 1.2 The look: a tower floor at night, lit by the work

- **Composition.** The plate floats in front of the city as an architectural cut-away. The south edge shows the slab
  in section (a dark band with a hairline highlight), there is no ceiling, and the sky is visible above the north glass
  and beyond the east and west glazing. At fit zoom on a laptop the floor fills the lower ~55 % of the view and the
  skyline the upper ~45 %. That is the hero shot.
- **Materials.** Polished dark concrete floor; neighbourhood carpets a few percent lighter, tinted by district; walnut
  desk tops on black steel; felt bench screens; charcoal fabric chairs; glass rooms with a faint top-edge highlight;
  brushed metal; matte ceramic pots; deep desaturated greens. Flat shapes with two or three tonal steps and hairline
  top-edge highlights (the app's "hairline and faint top highlight" surface language). No outlines, no textures
  louder than 3 % contrast, **no SVG filters** (shadows and glows are gradient shapes).
- **Light model (X3: nothing glows without a cause).**
  1. **Skyline**: the backdrop plus a soft window-light gradient on the floor along the north edge, coloured by the
     variant (night: cool city glow; dusk: amber-violet; day: cool daylight).
  2. **Pendants**: dim warm pools over the conference tables, the coffee bar island and the lounge. They are ambient
     and never signal status.
  3. **Monitors**: dark by default. A monitor lights **in its owner's accent** while that coworker is *working* or
     *thinking*, with a small light spill on the desk ("lit by the work").
  4. **Desk lamps**: the lamp motif sits on every desk, off by default. A lamp lights with a warm pool only for the
     **Night Shift** badge (`badges: ['lamp']`, ARCHITECTURE §3.5).

  An idle office at night is the skyline, the pendants and quiet desks. Work makes it glow.
- **Accents.** Per-person accents appear on the badge ring hairline, the name-plate pip and the monitor glow, adapted
  for dark with the app's `nightAccent` (OKLCH L ≈ 0.76, C ≤ 0.16) through `options.accentFor`. District carpet tints
  are neutral, not accents.
- **Motif set** (EXPERIENCE §10.1): the **lamp** (Night Shift), the **hand** (raised hand glyph and a blue floor halo),
  the **door plate** (neighbourhood heads, room doors, the Chief's door, and table tent cards in the conference stage),
  the **receipt** (not in the office; untouched).
- **Tone.** Calm, adult, architectural-visualization clean. Think a design studio's night-time floor plan, not a game.
  No thick outlines, bouncy characters, emoji, speech-bubble clip art or cartoon proportions. (Department icons in
  the taxonomy are emoji; the office never shows them. It uses door plates with words.)

### 1.3 The skyline

**Variants and time.** `timeOfDay: 'auto'` reads the owner's local clock (`new Date()`) and re-checks every 5 min:

| Variant | Local time | Notes |
|---|---|---|
| `night` | 19:30 – 05:30 | Default art direction; lit windows twinkle; red aviation beacons on the tallest roofs |
| `dusk` | 05:30 – 07:30 and 17:30 – 19:30 | Also used for dawn: blue hour, a low amber-violet band |
| `day` | 07:30 – 17:30 | Overcast, desaturated; shown at 72 % brightness under a glass tint in the dark theme so the UI stays dark |

A change crossfades over 2 s (instant with reduced motion). An override exists (`setTimeOfDay`); Phase 2 can add a
⌘K command ("Office sky: Night"). Later, sunrise and sunset can come from the workspace's location if the Handbook
knows it.

**Parallax and life.** The sky layer is sized to the viewport × 1.3 (overscan) and moves at **0.12×** the camera pan
and **0.25×** the zoom change, which gives depth without motion sickness. Twinkle is **pure CSS**: up to 60
2–3 px dots placed on real lit windows (from the art manifest), each animating opacity between 1 and 0.35 over
5–11 s with seeded delays; at most 3 beacons fade in and out over 2.4 s (lit about 12 % of the time, never a hard
1 Hz blink). After 30 s without pointer or key input the scene sets `data-calm` and the sky holds still (WCAG 2.2.2);
any input resumes it. No JS loop. Reduced motion disables parallax, twinkle and beacons.

**The floor line.** The sky exists only above the plate's north floor line. Below it, beside and under the plate, is
`--o-void`: a veil that fades in over 40 px from 12 px above the line and moves by `transform` only (`--o-sky-cut` on
`.hc-o-sky` carries the line's screen y). The floor sits on the 30th floor, not at water level. The floor
reflections (`.hc-o-refl`) stay as the window's light.

**Keyless fallback.** `art/skyline-fallback.ts` draws a procedural vector skyline: three silhouette layers of seeded
towers, window dots at 8–15 % density, a variant gradient and, at night, a thin moon. It is used when the manifest or
image is missing, in tests and in the dev harness, and it renders in < 5 ms. The office never depends on generated art.

**Art pipeline: `scripts/office-art.mjs`** (modelled on `scripts/marketing-images.mjs`):

- Calls `POST /api/media/image {prompt, aspect, key, provider?}` on the running worker (default
  `http://127.0.0.1:8787`). The worker holds the keys and the script never sees them. Nine assets, worker keys
  `office-<key>`: the three skylines (`skyline-night|dusk|day`, 16:9), two **conference-stage backdrops**
  (`conference-night|dusk`, 16:9: a closer, softly focused view through the Skyline room's far glass, §2.4), the
  **Garden room's living wall** (`conference-garden`, 16:9: a softly focused wall of moss and ferns in a dim meeting
  room at night, walnut slats at the edges, a warm pendant above; no lights are extracted) and three **wall art** pieces (`art-1..3`, 1:1: full-bleed abstract compositions in the muted brand spectrum; the office draws
  the frame).
- **Provider**: `openai` (gpt-image-2) by default, because its 16:9 source is 1536 × 1024 against xai's 1280 × 720;
  `--provider xai` overrides.
- **Budget**: at most 8 generations per run (`--budget`), from the shared `PORTRAIT_DAILY_LIMIT`; retries via
  `--only <key> --force --note "<fix>"`, at most 2 per asset. It stops on 429 or 503 and prints `remainingToday`.
  Idempotent (existing files are skipped), and a lock in the OS temp directory refuses an overlapping run. Flags:
  `--only` (keys or aliases `night`, `dusk`, `day`, `skylines`, `conference`, `art`), `--force`, `--provider`,
  `--note`, `--reprocess` (re-encode the stored R2 originals, no generation), `--horizon <key>=<0-1>`, `--budget`,
  `--concurrency`, `--dry-run`, `--list`, `--worker`.
- **Post-processing** (ffmpeg + cwebp, like the marketing script): backdrops at 1920 × 1080 (a 1536 source upscaled
  1.25×, never more), art at 1024; `<key>.webp` (q 72, ≤ 450 KB) + `<key>-1280.webp` (art `-512`) + a JPEG fallback
  `<key>.jpg` + an LQIP data URI (32 × 18; art 16 × 16). Backdrops only: **horizon** = for skylines the waterline
  (the darkest clear valley of the smoothed row luminance in 45–88 %, else the strongest step), for conference views
  the distant horizon (the brightest band of city glow); `--horizon <key>=<0-1>` overrides and is kept in the
  manifest (`horizonSource: "manual"`) until that image is regenerated (day and conference-dusk carry one).
  **glow** = mean colour of the band above it; **lights** = isolated local maxima on a 640 px copy (above the
  waterline for skylines, the whole city for conference views; L > 0.75 with a 9 × 9 mean < 0.35, relaxed for dim
  images), ≤ 400 by contrast, Poisson-disc thinned (1.2 % of the width) to ≤ 60 `{x, y, r, warm}` (x, y in 0–1; r a
  dot radius in CSS px); **beacons** (night only) = ≤ 4 saturated red roof-edge maxima `{x, y}` found on a 1280 px
  copy. Day has neither. The engine only reads the manifest; only this script writes it (merging, never replacing).
- **Manifest** `apps/web/public/office/manifest.json` (paths relative to the manifest, i.e. `assetsBase`):
  `{version, note, variants: {night|dusk|day: Entry}, conference: {night|dusk: Entry, garden: Entry}, art: Entry[]}` with
  `Entry = {key, kind, timeOfDay?, slot?, view?, alt, files: [{file, type, width, height, bytes}], file, fallback, srcset: [{width, file}], lqip, width, height, horizon?, horizonSource?, glow?, lights?, beacons?, provider, model, generatedAt}`.
  Review sheet: [`screens/office/art-contact-sheet.jpg`](screens/office/art-contact-sheet.jpg).
- **Prompts** (each < 1500 characters; the script holds the exact text, including the conference and art prompts;
  the skyline intent is):
  - *Style.* "Wide cinematic photograph of a fictional modern city skyline seen from the 30th floor of an office tower
    across a wide river. No real landmarks, no recognisable real city, no text, letters, signs, logos, billboards or
    brand marks anywhere, no people. Horizon at 58 % of the frame height; the lower 30 % is dark water and embankment
    with reflections; mid-rise and tall towers of varied heights spread evenly across the full width, no single
    dominant tower in the centre; the top 30 % is open sky with no birds or aircraft. Calm, premium, true-to-life
    colour, fine detail, slight atmospheric haze, 35 mm lens at eye level, no window frames, no glass reflections, no
    interior."
  - *Night.* "Deep blue-black night. Thousands of small warm and cool lit office windows, sparse enough to read as
    individual points; a few red aviation lights on the tallest roofs; a soft city glow on the horizon; still dark
    water with long light reflections. Rich blacks, restrained contrast, no neon, no moon in frame."
  - *Dusk.* "Blue hour, twenty minutes after sunset: a soft amber-to-violet band low in the sky fading to deep blue
    above; towers mostly silhouetted with the first office windows lit; calm water reflecting the gradient. Muted,
    elegant, not saturated."
  - *Day.* "Overcast late morning, soft diffuse daylight, muted blue-grey sky with gentle cloud texture, towers in cool
    greys and glass, low contrast, desaturated, calm. It will be shown darkened behind a dark interface, so avoid bright
    white areas and harsh sun."
- **Honesty** (D3): a fictional city, no brands. `alt` text describes the scene. The images are decorative
  (`alt=""` in the DOM, since the office region already has a label); the manifest keeps the description for docs.

### 1.4 Palette tokens

The office injects one `<style id="hc-office-style">` (the same pattern as FaceView's `hc-face-style`). It reads the
app tokens (`--surface`, `--panel`, `--ink`, `--muted`, `--line`, `--lamp`, `--hand`, `--blocked`, `--state-*`,
`--dur-*`, `--ease-out`) with fallbacks, and defines its own under `.hc-office[data-theme]`:

| Token | Dark (night shift) | Light (day paper) | Use |
|---|---|---|---|
| `--o-void` | `#07080a` | `#e9e6df` | Beyond the plate and below the slab |
| `--o-floor` | `#121418` | `#f1eee8` | Polished concrete |
| `--o-carpet-lead / build / grow / run` | `#181613` / `#13161b` / `#171419` / `#131816` | `#ebe6dc` / `#e4e8ec` / `#ebe5ea` / `#e3e9e4` | District carpets (≤ 4 % from the floor) |
| `--o-wall`, `--o-wall-top` | `#1a1d22`, `#2a2e35` | `#dcd8d0`, `#c9c4ba` | Walls, columns, slab section |
| `--o-glass`, `--o-glass-edge` | `rgba(170,200,255,.07)`, `rgba(200,220,255,.22)` | `rgba(80,110,160,.08)`, `rgba(60,90,140,.28)` | Room glass and the window band |
| `--o-wood`, `--o-wood-hi` | `#43322a`, `#57432f` | `#c49a72`, `#d8b48e` | Desk tops, tables, shelves |
| `--o-metal`, `--o-metal-hi` | `#2d3137`, `#58606b` | `#8f949b`, `#b4b8be` | Legs, espresso machine, lamps |
| `--o-fabric` (`-hi`, `-lo`), `--o-mesh` | `#353b45` (`#4b525e`, `#23272e`), `#3b424d` | `#5b5f66` (`#71767e`, `#474b51`), `#666b73` | Chairs: mesh backs are ≥ 1.6:1 against every dark carpet, so the chairs read at L1 |
| `--o-felt` | `#2b2630` | `#8a7f8f` | Sofa and bench screens |
| `--o-plant`, `--o-plant-hi`, `--o-pot` | `#2d4a3b`, `#4b7560`, `#2a2d33` | `#4f7d62`, `#77a88a`, `#d6d1c8` | Plants |
| `--o-screen-off` | `#0c0e11` | `#2a2d33` | Monitors when off |
| `--o-lamp-light` | `var(--lamp)` at 22 % → 0 | `var(--lamp)` at 14 % → 0 | Night Shift pools |
| `--o-pendant-light` | `#ffd9a0` at 10 % → 0 | `#ffd9a0` at 6 % → 0 | Ambient pools |
| `--o-notes` | `#c9b458 #6aa8ff #e38b7a #7fd1b9` at 70 % | same at 85 % | Sticky notes and book spines |

Every SVG fill is `var(--o-…)`, so a theme switch restyles the plate without rebuilding it.

### 1.5 The vector asset library (`packages/office/src/art/symbols.ts`)

Each asset is an SVG `<symbol id="hc-o-…">` drawn for the §1.1 projection (top face + south face). The plate uses
`<use>` references. Variants are seeded per seat, so the office looks lived-in but is identical on every load.

| Asset | Where | Details and states |
|---|---|---|
| `desk` (16 × 8 u) | Every seat | Walnut top, steel legs; monitor with a thin bezel and stand; keyboard hint; seeded clutter variant (mug, notebook, succulent, none) |
| `monitor-glow` (light layer) | Every desk | Off; *working/thinking* → accent screen + spill; transition 200 ms |
| `desk-lamp` | Every desk | Articulated arm lamp (the lamp motif); lit → warm shade + floor pool (Night Shift only) |
| `chair-{n,s,e,w}` | Every seat | Ergonomic mesh back (from the front, behind and the side), 5-star base visible under the seat, a 0.25 u hairline on the back's top edge (desk tops get one too); occupied = pulled out with a seeded ±4° turn; empty = pushed in |
| `bench-screen` | Benches | Felt privacy screen between facing desks |
| `plant-monstera`, `plant-snake`, `plant-fiddle`, `plant-desk`, `plant-pothos` | Neighbourhood heads, commons, rooms, café, reception | Split-leaf silhouette; upright blades; tree with round leaves; small succulent; trailing (shelves) |
| `coffee-bar` | Café cell | L-counter with an **espresso machine** (chrome, two cups), grinder, sink, fridge, pastry dome; island with 4 stools; under-counter light strip (ambient) |
| `water-cooler` | Café, library | Blue-tinted bottle, cup dispenser |
| `whiteboard` | Neighbourhood heads (alternate), rooms | Mobile board with 5–9 seeded **sticky notes** and marker scribble strokes (no legible text) |
| `shelf-low`, `shelf-tall` | Commons, library, Chief's office | Book tops and spines in `--o-notes` tones; a plant or object on some shelves |
| `printer` | Library cell | Copier with a paper tray and a recycling bin |
| `sofa`, `armchair`, `rug-{a,b}`, `coffee-table`, `floor-lamp` | Lounge, Chief's office, commons nooks | Felt 3-seater; geometric rug; magazines on the table |
| `pendant` | Rooms, café, lounge | Round shade seen from above plus its ambient light pool |
| `wall-clock` | Core wall face | **Shows the owner's local time**; hands update once a minute (no second hand) |
| `art-{1..4}` | Core and room wall faces | Framed abstract compositions from the brand spectrum at low saturation |
| `phone-booth` | Library cell (×4) | Glass front, felt interior, stool, small lamp; free in Inc 0.7 (later: a coworker on a call) |
| `door-plate` | Neighbourhood heads, room doors, the Chief's door | The motif: a small plaque. Its **text is HTML** in the label layer (crisp at every zoom) |
| `conf-table-10`, `conf-table-8` | Skyline room, Garden room | Long rounded walnut table, speakerphone puck in the centre (lit while the room is listening), wall screen |
| `exec-desk` | Chief's office | L-desk with a lamp, 2 guest chairs, sofa, rug, shelf, fiddle-leaf fig |
| `plant-wall` | Garden room | Moss and fern wall along the room's west side |
| `reception` | South strip | Low counter, a long bench, two large planters, entrance mat |
| `column`, `window-bay`, `mullion`, `slab-section` | Structure | Columns at cell corners along aisles. North glass 40 u high (`WINDOW_Z`): a 2.5 u transom, a 1.2 u sill, a cool tint fading 7 % → 2 % downward, and 0.8 u mullions every 12 u with a 0.2 u highlight on the west edge. East and west façades: a 3 u strip with 1 u mullion ticks every 12 u and an inner highlight, so the side walls read at fit |

A **gallery page** in the dev harness renders every symbol on the real floor tone in dark and light, with the
states lit and unlit. Its screenshots go to `docs/dev/screens/office/gallery-{dark,light}.png` for owner review
before the scene work finishes.

### 1.6 Motion

Motion follows EXPERIENCE §10.6: nothing moves without a cause. State changes take 200 ms, badge lifts 250 ms, and the
monitor and lamp fade 200 ms. Camera flights take 600 ms ease-in-out, zoom steps 250 ms. Walking badges move at
260 u/s, 0.6–1.6 s per walk, staggered 120 ms. The sky crossfades over 2 s. Skyline twinkle is the only continuous
ambient motion, and it is off with reduced motion. There are no idle loops, steam, swaying plants or fake typing.

---

## 2. People

### 2.1 The desk badge

A seat shows a **badge** floating over its chair, anchored by a small contact shadow on the chair so it reads as
"this person sits here":

```
      ╭──────╮      face (FaceSlot from faceFactory; FaceView draws the state ring and glyph)
      │ face │ ✋   raised hand: FaceView's glyph beside the face + a blue floor halo under the chair
    ╭─╰──────╯─╮    shoulders: 1.3 × the face wide, a muted accent, tucked under the chin (the chair back shows above)
   ● Juno Park       name plate under the shoulders: state pip + name (L1: first name; L2: "Juno P.", full from 7.4 px/u)
   Reading 14 reports   status sentence (L2, non-idle only, verb-first, ≤ 48 characters, up to two lines)
      ▭ chair
```

| Level | Zoom (px per u) | Badge | Text | Faces mounted |
|---|---|---|---|---|
| **L0 Plan** | < 2.2 | People seen from above (shoulders in a muted accent, head, hair) with the light layer's halos (hand = blue, speaking = lamp) | Neighbourhood, room and amenity names (≥ 11 px, long names ellipsized to the cell); hover or focus shows the full name on a plate | None (FaceSlots are released 2 s after entering L0) |
| **L1 Neighbourhood** | 2.2 – 4.5 | Face token, clamp(24, 5.2 u × zoom, 32) px, with shoulders | First name from zoom 3.0, never clipped (plate up to the desk pitch − 6 px; full on hover) | Visible seats + 25 % margin |
| **L2 Desk** | > 4.5 | Face token, clamp(40, 6.2 u × zoom, 58) px, with shoulders | "Juno P.", full name from 7.4 px/u; status sentence when not idle (two lines) | Visible seats + 25 % margin |

Transitions use ±8 % hysteresis so levels never thrash. Badge screen size is `clamp(min, k u × zoom, max)` per level,
so faces never balloon at maximum zoom and, at L1, the chair back and its star base stay visible around the badge. The badge anchor lifts 6 u × 0.57 above the chair for north-side seats and
3 u for south-side seats, so a badge never covers the monitor its owner faces.

### 2.2 States on the floor

| State (PresenceState) | Face (FaceView) | Seat and desk | L0 dot |
|---|---|---|---|
| `idle` | Blink and sway only when it is a tile; still token otherwise | Monitor off, chair relaxed | Accent dot |
| `thinking` | Thinking pose; dots glyph on tokens | Monitor on in accent (dim) | Dot + faint ring |
| `working` | Head down; book glyph on tokens | Monitor on in accent + spill | Dot + faint ring |
| `listening` | Listening pose | Unchanged | Unchanged |
| `speaking` | Lip sync (tile at a desk, hero on the stage); lamp ring | Badge lifts 4 px, scale 1.15, warm halo | Lamp halo |
| `raised_hand` | Hand glyph beside the face (FaceView) | Blue floor halo under the chair | **Blue dot with glyph** (static with reduced motion) |
| `blocked` *(Inc 1)* | Still, amber ring | Triangle glyph on the name plate | Amber dot |
| `away` *(v1)* | Desaturated | Chair pushed in | Dimmed |
| Badge `lamp` (Night Shift) | Unchanged | **Desk lamp lit** with a warm pool | Warm pip |

The name-plate pip carries the state in the app's `--state-*` language, so working and thinking read on a token too:
working is a lamp dot with a 2 px lamp ring (35 %), thinking a hollow muted ring, raised hand and listening the hand
blue, speaking the lamp, idle the accent. Monitor spill on north-side seats (whose badge sits in front of the lit desk)
is wider and doubled, so it shows either side of the badge.

The office only shows what `setPresence` and `setSpeaking` report. In Inc 0/0.5 that means the Chief's real presence,
desk quick-chat *thinking* claims and client-local *speaking*. Everyone else is honestly idle (X3).

### 2.3 The Chief of Staff

- Sits in the **corner office** (NE cell, windows on two sides) at an executive desk **facing the viewer**. It is the
  only desk oriented toward the camera, so the Chief is always findable.
- The badge is 1.35× a desk badge. The Chief's door plate reads name, "Chief of Staff" and the status sentence
  ("Available" when idle, else the presence label, e.g. "Looking into supplier prices").
- The desk lamp shows the Chief's Night Shift. Their monitor glows while a job runs (`activeJobs` > 0) or they think.
- **Home** focuses the Chief. Click → `onOpen(chiefId)` (the host opens Talk). Rest → passing-by status line, as the
  Directory's Chief card does today.
- The Chief can be invited into a conference room and walks there like anyone else.

### 2.4 Conference seating: the stage

Entering a room swaps the floor for a **stage**: a closer composition from the owner's seat at the near end of the
table, looking along it. In the Skyline room the far wall is glass with the city behind (the same variant, scaled up
and blurred slightly by the art, not by a filter). In the Garden room it is the plant wall with glass onto the dimmed
office.

```
┌ Skyline room · Talking with 4 · 03:12 ─────────────── [Invite I] [CC] [Leave Esc] ┐
│                         ░░░ city skyline through the far glass ░░░                 │
│                               ╭────╮  (far head seat)                              │
│                ╭────╮         │ Sam│         ╭────╮                                │
│                │Juno│╲  ▭ tent card ▭      ╱│Walt│      far seats smaller           │
│          ╭─────╮     ╲──────────────────╱   ╭─────╮                                │
│          │Lena │ ▭    │    T A B L E     │ ▭ │ Pax │     near seats larger          │
│          ╰─────╯      ╲                  ╱   ╰─────╯                               │
│   Floor: Walt → Juno → Lena                                                        │
│   WALT  Brand love doesn't move their Q2 number. Show me sell-through.   ← caption │
│   ┌ dock (host): Hold Space to talk · Message the room…                    [↑] ┐   │
│   └ You ───────────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────────────────┘
```

- **Seats.** Skyline room 10 (4 per side + both ends, the near end is the owner); Garden room 8. Participants fill
  from the far end, alternating left and right. **The table follows the party, not the room**: it is drawn for
  max(5, people + 1) seats, and a small party sits from the near end at a roomier pitch with the table ending just
  behind its farthest pair, so five guests sit round a short table in the lower half of the frame with the city above
  instead of lining a runway. The room's size only limits the picker. Seat scale follows true depth: far 0.62 → near
  0.96 of a 132 px base (clamped to the viewport).
- **Seated, not floating.** Each occupied seat gets a dark radial scrim (55 %, 1.7 × the face) that lifts the face off
  the skyline, and a chair back and accent-tinted shoulders drawn behind it, painted before the table so its long
  edge tucks them in; the torso fades out toward the floor. Empty seats between people show chairs pushed in, faint
  (35 %) with a hairline top edge; none are drawn beyond the last person.
- **Facing the table.** Portraits are frontal, so orientation is suggested honestly (EXPERIENCE §4.1): each badge tilts
  up to 10° (`rotateY`) toward the table centre. While someone speaks, every listener tilts toward the speaker. While
  the owner speaks, everyone tilts toward the **You** seat. Reduced motion: no tilt.
- **Speaking highlight.** The speaker lifts to **hero** (scale 1.18, lamp ring glow), their **tent card** (a door plate
  with name and title) lights, and the table pendant's warm pool slides toward their seat (400 ms). Listeners' faces
  dim by brightness (0.62, saturation 0.85), never by opacity, so far faces do not melt into the city lights
  (EXPERIENCE §3.5); tent cards never dim. The person generating the next reply shows *thinking*.
- **Tent cards** stand just under their owner's chin (clear of the speaking lift), a quarter of a face toward the table
  centre, with the name at ≥ 11 px and the title at ≥ 10 px at any depth.
- **Backdrops.** The Skyline room looks through its far glass (mullions, sill, transom) at `conference-night|dusk`;
  the Garden room at the generated living wall `conference-garden`, with the vector wall when keyless.
- **Captions.** Always available (X11). A two-line caption bar above the dock shows the speaker's name in their accent
  and the live text (word reveal from TTS alignment). Text-only lines get a separate **NOT VOICED** tag (10 px caps,
  muted) beside the name, never inside the spoken text. **CC** hides and shows it; the
  full log is the host's (Phase 2).
- **Floor line.** "Floor: Walt → Juno → Lena" as mini tokens (from `setFloorQueue`).
- **Narrow screens** (< 900 px): the stage becomes a stack with the speaker as hero on top, the others as a row of
  tokens, then captions and the dock.

### 2.5 Animation budget

The scene asks faces for tiers; FaceView's scheduler enforces the caps too (`maxAnimatedTiles: 3`).

- **Desk mode, tiles (≤ 3), by priority:** speaking > the seat being dragged > hovered > keyboard-focused > has a
  bubble. Everyone else is a token.
- **Stage:** 1 **hero** (the speaker, or the last speaker for 2 s) plus ≤ 3 tiles (next in the floor queue, previous
  speaker, hovered). Everyone else is a token.
- Tier changes are debounced by 150 ms so a pointer sweep across a bench does not churn tiers.

---

## 3. Layout

### 3.1 The floor plate (default template)

1 u = 10 cm. Cells are 96 × 80 u, aisles 16 u between columns, a 24 u **boulevard** under the window row and an 18 u
aisle between the lower rows. There are 14 u of window clearance on the north, a 34 u reception strip on the south,
and glazing on N, E and W. The plate is **88 m × 33 m** (880 × 330 u).

```
 N ═══════════════════ floor-to-ceiling glass · city skyline ════════════════════════════════
 ║ [Skyline room] [Data]      [Engineering] [Design]  [Product]  [Core crew] [Strategy] [CHIEF] ║
 ║ ─────────────────────────────────── boulevard ──────────────────────────────────────────── ║
 ║ [Research]     [IT & sec]  [Content]     [Coffee bar] [Lounge] [Marketing] [Sales]  [CS]    ║
 ║ ──────────────────────────────────────── aisle ──────────────────────────────────────────── ║
 ║ [Industry]     [People]    [Legal]       [Garden rm]  [Library] [Finance] [Operations] [E-com]║
 └──────────────────────────── reception · entrance (south cut-away) ─────────────────────────┘
```

The middle two columns are the **town square**: coffee bar and lounge, with the Garden room and library below them.
Glass rooms take the NW and NE corners (two window walls each). Verified by the prototype: 18 neighbourhoods,
164 seats + the Chief, 24 spare desks.

### 3.2 Districts and fill order

Neighbourhood cells fill in a serpentine order that starts next to the Chief's office: row 1 east→west, row 2
west→east, row 3 east→west. Departments fill in `DISTRICT_ORDER`:

| District | Departments (in order) | Carpet |
|---|---|---|
| **Lead** | strategy-leadership, core-crew | warm |
| **Build** | product, design-creative, engineering, data-analytics, research-insights, it-security-automation | cool slate |
| **Grow** | content-comms-pr, marketing-growth, sales-partnerships, customer-success-support, ecommerce-retail | plum |
| **Run** | operations-supply-chain, finance-accounting, legal-compliance, people-culture, industry-specialists | green-grey |

Unknown group ids are appended in input order (district `run`). The coffee bar ends up between makers and sellers.

### 3.3 A neighbourhood (one cell)

- **Benches.** Two benches stacked north and south, each with desks on both sides facing a felt screen. The columns
  per bench side are `k = ceil(n / 4)`: n 7–8 → 2, 9–12 → 3, 13–16 → 4. Desk pitch 16 u; bench depth 35 u (chair zone
  9 + desk 8 + screen 1 + desk 8 + chair zone 9). North-side seats face south (toward the viewer); south-side seats face
  north.
- **Seat order.** Members sorted by seniority (principal, lead, senior, specialist), then catalog order. They are dealt
  round-robin across the four bench sides, west to east, so benches fill evenly and spare desks collect at the east
  ends.
- **Head** (west 18 u): the **door plate** (department name + headcount; project next action in Inc 1), a mobile
  whiteboard with sticky notes or a low bookshelf (alternating by cell index), and a tall plant (monstera or fiddle-leaf,
  seeded).
- **Commons** (the east remainder): ≥ 30 u → a nook (two armchairs, side table, floor lamp, rug); 12–30 u → a low shelf
  with snake plants; < 12 u → one plant.
- **Groups larger than 16** span two adjacent cells (the next free cell in fill order that is horizontally adjacent,
  else the template grows; §3.7).

### 3.4 Rooms and amenities

| Cell | Contents |
|---|---|
| **Skyline room** (NW) | 10-seat table, wall screen, speakerphone puck, 2 pendants, whiteboard, fiddle-leaf fig; glass on E and S, door on S with a door plate ("Skyline room · Free" / "Talking with Juno, Walt and 2 others") |
| **Chief of Staff's office** (NE) | Executive desk facing south, lamp, 2 guest chairs, sofa and rug, tall shelf, fiddle-leaf fig, framed art; glass on W and S; door plate with name and status |
| **Coffee bar** (r2 c4) | Coffee bar (espresso machine, grinder, sink, fridge), island with 4 stools, water cooler, pendants, high table |
| **Lounge** (r2 c5) | Rug, sofa, 2 armchairs, coffee table, floor lamp, monstera, wall clock and art on the core wall face |
| **Garden room** (r3 c4) | 8-seat table, plant wall, pendants; glass on N, E and S; door on N |
| **Library & print** (r3 c5) | Two tall shelves back to back, a reading chair, printer station, 4 glass-fronted phone booths (shelf desk, stool and lamp visible) along the south |
| **Reception** (south strip) | Counter, bench, planters; the camera's "start" point for Walk to |

### 3.5 Plan data (`planOffice` output)

```ts
interface OfficePlan {
  version: 1;
  bounds: { w: number; h: number };                     // u
  cells: { id: string; row: number; col: number; x: number; y: number; w: number; h: number;
           role: 'pod' | 'room' | 'chief' | 'amenity'; amenity?: 'cafe' | 'lounge' | 'library' }[];
  zones: { id: string; groupId: string; name: string; district: District; cellIds: string[];
           rect: Rect; plate: Point /* door plate anchor */ }[];
  seats: OfficeSeat[];                                  // desks + the Chief's chair
  rooms: { id: string; name: string; view: 'skyline' | 'garden'; rect: Rect; door: Point;
           seats: { id: string; x: number; y: number; facing: Facing }[] }[];
  props: { symbol: string; x: number; y: number; variant?: number; layer: 'floor' | 'furniture' | 'wall' }[];
  walk: { nodes: { id: string; x: number; y: number }[]; edges: [string, string][] };   // aisle graph for walks
  nav: Record<string /* seatId */, { left?: string; right?: string; up?: string; down?: string;
                                     prevZone?: string; nextZone?: string }>;
  hash: string;                                         // stable content hash (tests, caching)
}
interface OfficeSeat { id: string; personId: string | null; zoneId: string; kind: 'desk' | 'chief';
  x: number; y: number;                                 // chair centre, u (plan coordinates)
  facing: 'n' | 's' | 'e' | 'w'; desk: Rect; badge: Point /* projected anchor offset included */ }
```

`nav` is precomputed. Left and right follow the same bench side. Up and down cross the screen to the facing seat, then
to the nearest seat (by x) in the next bench or row, crossing aisles and skipping rooms. `prevZone` and `nextZone`
follow the fill order.

### 3.6 Determinism and stability

- `planOffice` is pure: the same people, groups, lead and rooms give byte-identical JSON (`hash`). Seeds come from
  FNV-1a of ids (mulberry32), never from `Math.random` or time.
- Seat ids are `seat:<zoneId>:<bench>:<side>:<col>`, so a person keeps their seat unless their group's membership
  changes. Adding one person to a department never moves anyone in another department.
- The chosen lead sits in the Chief's office. The other 11 catalog leads are not staff and do not appear.

### 3.7 Scaling to project pods (Inc 1) and growth

- The same cells host **project pods**: `groups` becomes `[...activeProjects, ...departments]` with `kind: 'project'`.
  Projects take the window-row cells nearest the Chief, ordered as EXPERIENCE §3.2 orders pods: needs you, then
  deadline, then activity. A coworker keeps **one desk**, in the pod of its active step. Elsewhere it appears as an
  **outlined token** on a spare desk. Departments hold everyone not on a project ("Everyday").
- When membership changes, people **walk** to their new desks along the aisle graph (FLIP; instant with reduced motion).
- More groups than cells: the template adds two columns (6 cells) on the west per step. The skyline and glazing
  stretch with it. Door plates become the pod door plates of EXPERIENCE §3.2 (next action and owner, spend against cap,
  room status).

### 3.8 Performance budget

| Item | Budget |
|---|---|
| `planOffice` for 176 people | < 5 ms |
| Plate SVG build + first paint (after the catalog loads) | < 30 ms build, < 150 ms to first paint; sky LQIP immediately, image async |
| Plate DOM | ≤ 2,500 SVG nodes (mostly `<use>`); no filters, no masks, no per-frame SVG edits |
| Overlay DOM | ≤ 200 badge elements (176 people + rooms), labels ≤ 40 |
| Mounted faces | ≤ 96 FaceSlots (visible + 25 % margin, LRU release after 10 s off-screen); none at L0 |
| Animated faces | ≤ 3 tiles + 1 hero (§2.5) |
| Pan/zoom | **60 fps** on an M-class laptop (Chrome, Safari) with all **176** people as still tokens; ≤ 4 ms main-thread work per frame during gestures (the perf probe uses 164 + 12 synthetic people) |
| Idle | **Zero** office rAF when nothing moves; twinkle is CSS; faces idle via FaceView's scheduler |
| Sky | ≤ 450 KB per variant; only the active variant is loaded, the next one is preloaded 10 min before its switch |

---

## 4. Interactions

### 4.1 Camera

- **Pan**: drag the floor (pointer capture; a click is < 5 px and < 350 ms), two-finger trackpad scroll, touch drag.
- **Zoom**: pinch (trackpad `wheel` with `ctrlKey`, Safari `gesture*`, two touch pointers), mouse wheel (notched:
  `deltaMode` LINE, or repeated |Δy| ≥ 40 with Δx = 0) around the pointer, **+ / − / fit** buttons, the `+`, `-` and `0`
  keys, and double-click on the floor (×2 at the point, 250 ms).
- **Bounds**: zoom from *fit* (plate + 6 % margin) to 9 px/u. The pan keeps ≥ 30 % of the plate in view and
  rubber-bands beyond (resistance 0.35, spring back 280 ms).
- **Inertia**: velocity from the last 100 ms of samples; decay τ = 325 ms; stops below 0.01 px/ms. None with reduced
  motion.
- **First view**: *fit* on the first visit (the hero shot). After that the camera is restored per session from
  `sessionStorage` (wrapped in try/catch).

### 4.2 Pointer

- **Hover → passing-by** (LIVING-WORKFORCE §8.1): the office runs the same dwell rule as `createDwell`. The pointer
  rests ≥ 600 ms below 0.3 px/ms → `onHover(id, {phase: 'dwell', via: 'pointer'})`. Keyboard focus held 900 ms →
  `{via: 'keyboard'}` (bubble only). A touch tap on a face → `enter` + `dwell` with `via: 'touch'`, and no open.
  `enter` fires immediately (the face wakes to a tile); `onHoverEnd` fires on leave. Camera motion counts as pointer
  motion, so no dwell fires during a pan or under inertia. Hover is desk-mode only.
- **Click a seat** → `onOpen(id, {via: 'click'})`: the host opens that coworker's quick chat (Phase 2: the replyable
  bubble with its field focused). The Chief → Talk. Click an empty desk → nothing.
- **Click a room** (or its door plate "Enter") → enter it. Click an amenity → fly there.
- **Drag a badge to a room** → invite. The drag starts after 6 px on a badge; touch needs a 400 ms long-press, since
  touch drag pans. Rooms light their glass in the lamp colour while a drag is over them. A drop elsewhere springs the
  badge back to its seat.

### 4.3 Keyboard

The scene is one tab stop (roving tabindex over seat buttons). It enters on the last focused seat, else the Chief.
The camera follows focus with the smallest pan that keeps the seat inside a 15 % inset.

The office root is focusable (`tabIndex = -1`, never a tab stop) and takes focus on a click on the floor, so the map
works after a click. With `keyTarget: 'document'` (Phase 2, while the Office is the active view) it listens on the
whole page; typing in fields, and keys aimed at other buttons, menus and dialogs, are left alone. Arrows and Enter
act on a focused seat; `[` `]`, PageUp/PageDown and Home also work from the floor.

| Key | Desk mode | Stage |
|---|---|---|
| ← → ↑ ↓ | Move between seats via `nav` | Move between participants |
| `[` `]` or PageUp/PageDown | Previous / next neighbourhood | — |
| Home | Focus the Chief of Staff | — |
| Enter | `onOpen` (quick chat) | `onOpen` for that participant (`mode: 'conference'`) |
| `I` | Invite the focused person… (room menu) | Open the invite picker |
| `G` | Walk to… (rooms, amenities, neighbourhoods) | — |
| `/` | Find a person (type-ahead; Enter flies there) | Find a participant |
| `+` `-` `0` `F` | Zoom in, out, fit, zoom to the focused seat | — |
| `C` | — | Captions on/off |
| Esc | Close the bubble → clear focus → nothing | Close the picker → **Leave the room** |
| `R`, hold Space, `L` | Reserved for the host (reply, push-to-talk, listen) and never intercepted | Same |

### 4.4 Walk to, find, mini-map

- **Walk to** (HUD menu and `G`): Skyline room, Garden room, Chief of Staff's office, Coffee bar, Lounge, Library, and
  every neighbourhood by name. The camera flies there (600 ms; instant with reduced motion). Rooms are entered.
- **Find** (`/`): type-ahead over names, titles and departments. Matches stay bright, others dim to 0.4; Enter flies to
  the first match and focuses it. Phase 2 binds this to the Floor's existing search box.
- **Mini-map** (optional, on by default ≥ 1024 px and shown only above 1.6× fit zoom): a 176 × 66 px SVG thumbnail of
  the cells with the viewport rectangle. Click or drag it to move.

### 4.5 Conference room mode

1. **Enter.** Click a room, choose it in Walk to, press the HUD toggle **Conference** (the last room, else Skyline),
   or call `enterRoom(roomId, participants)`. The camera flies to the room (600 ms), the room's glass fades, the stage
   crossfades in (250 ms), and `onEnterRoom(roomId, participants)` fires. Reduced motion swaps instantly.
2. **Invite.** Use the **picker**: a searchable list grouped by department, with face tokens, checkboxes and "Invite 3".
   Or drag desk badges onto the room (desk mode), or use `I` on a focused seat. `onInvite(roomId, ids, {via})` fires; the
   office seats them unless the handler returns `false`. In desk mode invitees **walk** from their desks along the
   aisles into the room (their desk chairs stay pulled out and their name plates read "In the Skyline room"). On the
   stage they arrive from the door side (slide 24 px + fade, 300 ms). The room holds at most its seat count; the
   picker says "The Skyline room seats 9 besides you" and stops there.
3. **Talk to the room.** The host mounts its composer and push-to-talk in `scene.dock()`. The standalone fallback is a
   text field that calls `onTalkToRoom(roomId, text)`. The host drives `setSpeaking`, `setPresence` (thinking),
   `showCaption` and `setFloorQueue`; the stage renders them (§2.4).
4. **Leave.** Esc, the **Leave** button, the HUD **Desks** toggle or `leaveRoom()`. Participants walk back to their
   desks and `onLeaveRoom(roomId, participants)` fires. In Inc 0.7 a meeting exists only while the owner is in the
   room, so leaving ends it (Inc 2 rooms persist as RoomDO meetings). Dismissing one participant: their stage badge
   has a "Back to desk" action → `seat(id, null)`.

### 4.6 Toggles

- **Desks ↔ Conference**: a two-option segmented control centred in the office HUD (`setMode`). Conference with no
  room chosen enters the Skyline room.
- **Office ↔ Directory**: in the **host's** Floor header, beside Ambience (§6.2). The office's skip link calls
  `onRequestDirectory`.

### 4.7 Reduced motion, alternative modes, screen readers

- **Reduced motion** (OS or `setReducedMotion(true)`): no inertia, flights, walks, parallax, twinkle, tilt, lifts or
  crossfades. Positions and states change instantly. **Lip sync stays on** (EXPERIENCE §4.6).
- **Still-portrait mode** (host setting): the host's faceFactory returns still tokens only, and the speaker still gets
  the ring and caption. **Text Floor**: `faceFactory` omitted → initials badges.
- **Focus and targets**: focus rings are ink (2 px void + 2 px ink), never the speaking amber. Plan-zoom seat targets
  are at least 24 px (WCAG 2.5.8; 44 px on coarse pointers) and at least 44 px from L1.
- **Screen readers**: the scene is `role="region"` with `aria-label="Office floor plan"` and
  `aria-roledescription="office"`. The first focusable element is a skip link, "Use the Directory (list view)". Seat
  buttons read "Juno Park, Copy lead, Marketing and growth, thinking: {label}" (the group is dropped when it repeats the
  title: "Eddie Ramos, Chief of Staff, …"). The office has **no live regions**:
  announcements stay with the host under EXPERIENCE §9.2 rules. The Directory remains the primary structure for
  screen readers (X11).

### 4.8 Mobile

Below 768 px the Floor opens as the Directory (EXPERIENCE §9.1). The Office is one toggle away: touch pan, pinch
zoom, long-press to drag, no zoom buttons, no mini-map, the stacked stage (§2.4) and a compact HUD. Targets are
≥ 44 px (badges get a 44 px invisible hit area at every level).

Below 640 px the HUD is one row: Desks | Conference on the left, Walk to and a Find icon (it expands into the field)
on the right. The office opens on the Chief's neighbourhood at 2.4 px/u with the north floor line a third of the way
down, so the floor fills about two thirds of the screen and people are faces, not dots; the sky is framed for that
opening view. `0` and the fit button still show the whole floor.

---

## 5. Tech

### 5.1 Rendering architecture

```
host element (.hc-office, position:relative, overflow:hidden, touch-action:none)
├─ sky        screen-space: <img srcset> (cover, overscan 1.3) + ≤60 CSS twinkle dots; parallax transform
├─ world      ONE div with transform: translate3d(tx,ty,0) scale(z)   ← the camera (1 style write per frame)
│  ├─ plate   static SVG built once from OfficePlan: floor, carpets, walls, glass, furniture <use>, props
│  └─ light   small SVG: monitor glows, lamp pools, halos, pendant pools (class/opacity toggles only)
├─ labels     screen-space HTML: door plates, neighbourhood and room names (crisp text)
├─ people     screen-space HTML: seat <button>s with FaceSlot elements and name plates
├─ bubbles    screen-space HTML: office bubbles and host anchors
├─ stage      conference composition (hidden in desk mode): table SVG, seat badges, tent cards, captions, dock
└─ hud        zoom buttons, Desks|Conference, Walk to, mini-map, picker
```

- **Why this split.** CSS transforms on one composited layer pan and zoom the whole plate on the GPU. Re-rendering an
  SVG `viewBox` per frame would re-rasterise ~2,000 nodes. Faces and text live in screen space, so they stay crisp and
  FaceView measures real pixel sizes.
- **Crispness.** During a gesture `world` has `will-change: transform`. On settle (no camera change for 120 ms) the
  scene removes it, so the browser re-rasterises the plate at the final scale. If the scaled plate would exceed
  8,192 px on a side (Safari layer limits), the scene switches to **crop mode**: it sets the SVG `viewBox` to the
  visible region + 50 % margin on settle only.
- **Overlay positioning.** Visible items come from a uniform grid index (64 u cells). Each frame writes
  `transform: translate3d(sx, sy, 0) scale(k)` for visible badges, labels and anchors, where `k` is the ratio of the
  live zoom to the zoom at the last settle. On settle, badge `width`/`height` are set to the exact pixel size and `k`
  returns to 1, so FaceView's `ResizeObserver` redraws sharp. Off-screen items get `visibility: hidden`. Reads are
  batched before writes; there is no layout thrash.
- **One office loop.** A single rAF loop runs only while something moves: camera, inertia, flights, walks, stage
  tweens. It stops by itself. The face loop remains FaceView's scheduler (ARCHITECTURE §9.4); the office never draws
  faces.

### 5.2 Package layout and constraints

```
packages/office/
  package.json            name "@headcount/office", exports {".": "./src/index.ts"}, no dependencies
  tsconfig.json           extends ../../tsconfig.base.json, lib ES2023 + DOM + DOM.Iterable
  vitest.config.ts        environment happy-dom (picked up by the root vitest projects glob)
  src/
    index.ts  types.ts  strings.ts  rng.ts  time.ts
    plan/     plan.ts (planOffice) · districts.ts · pods.ts · rooms.ts · nav.ts · walk.ts (A* on the aisle graph)
    scene/    scene.ts (createOfficeScene) · camera.ts (pure maths) · input.ts (pointer, wheel, keys) · lod.ts
              · tiers.ts · dwell.ts · layers/{sky,plate,light,labels,people,bubbles,hud,minimap}.ts
    stage/    stage.ts · perspective.ts · picker.ts · captions.ts
    art/      symbols.ts · palette.ts · props.ts · skyline.ts (manifest, variants) · skyline-fallback.ts
    a11y/     roving.ts · labels.ts
    styles.ts (injects <style id="hc-office-style">)
  dev/        index.html · main.ts · gallery.html · perf.mjs · vite.config.mjs
```

- **No runtime dependencies**, not even `@headcount/protocol`. Types are declared locally and are structurally
  compatible (`PresenceState` is a superset of protocol's). No workspace install is needed during Phase 1. Phase 2 adds
  `"@headcount/office": "workspace:*"` to `apps/web` and runs `pnpm install` once.
- Browser-only (DOM), TypeScript strict, `import type`, extensionless relative imports, colocated
  `src/**/*.test.ts` (CONTRACTS §3). Strings are externalised in `strings.ts` (`labels` option) for i18n. Right-to-left mirrors
  HUD placement, not the plan.

### 5.3 Public API (`@headcount/office`)

```ts
export type PresenceState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'working' | 'raised_hand' | 'blocked' | 'away';
export type PresenceBadge = 'hand' | 'lamp';
export type FaceTier = 'hero' | 'tile' | 'token';
export type OfficeMode = 'desks' | 'conference';
export type TimeOfDay = 'night' | 'dusk' | 'day';
export type OfficeTheme = 'dark' | 'light';
export type HoverVia = 'pointer' | 'keyboard' | 'touch';
export type District = 'lead' | 'build' | 'grow' | 'run';

export interface OfficePerson {
  id: string;                 // opaque; apps/web passes agent ids ('cw_<personaId>', 'cw_chief')
  name: string;
  title: string;
  groupId: string;            // department id now; project pod id in Inc 1
  accent: string;             // '#RRGGBB' catalog accent; adapted per theme via options.accentFor
  seniority?: 'specialist' | 'senior' | 'lead' | 'principal';
}
export interface OfficeGroup { id: string; name: string; kind?: 'department' | 'project' | 'everyday'; district?: District }
export interface OfficeRoomSpec { id: string; name: string; seats: number /* includes the owner's seat */; view: 'skyline' | 'garden' }

/** A face the host builds (FaceView in apps/web). The office sizes and positions `el`; the host fills it. */
export interface FaceSlot {
  el: HTMLElement;
  setTier(tier: FaceTier): void;                          // the host also attaches its MouthSampler when tier !== 'token'
  setState?(state: PresenceState, label?: string): void;
  destroy(): void;
  drawsChrome?: boolean;   // true (FaceView): the office drops its state rings on that seat (data-host-chrome) and keeps
                           // only the outer hover, focus and speaking halo, so there is one ring
}
export type FaceFactory = (personId: string, tier: FaceTier) => FaceSlot;

export interface OfficeCallbacks {
  onHover?(personId: string, info: { phase: 'enter' | 'dwell'; via: HoverVia }): void;
  onHoverEnd?(personId: string, info: { via: HoverVia }): void;
  onOpen?(personId: string, info: { via: 'click' | 'keyboard'; mode: OfficeMode; roomId: string | null }): void;
  onFocusChange?(personId: string | null): void;         // the desk the owner is "at" (hovered or focused)
  onEnterRoom?(roomId: string, participants: string[]): void;
  onInvite?(roomId: string, personIds: string[], info: { via: 'picker' | 'drag' | 'keyboard' }): void | boolean; // false = refuse
  onLeaveRoom?(roomId: string, participants: string[]): void;
  onTalkToRoom?(roomId: string, text: string): void;      // standalone dock only (the host's own dock replaces it)
  onModeChange?(mode: OfficeMode, roomId: string | null): void;
  onViewportChange?(v: { personIds: string[]; roomIds: string[]; zoom: number; lod: 0 | 1 | 2 }): void; // ≤ 2 per second
  onRequestDirectory?(): void;
}

export interface OfficeOptions extends OfficeCallbacks {
  people: OfficePerson[];
  groups: OfficeGroup[];
  leadId: string;                                         // the Chief of Staff's person id (must be in people)
  rooms?: OfficeRoomSpec[];                               // default DEFAULT_ROOMS
  theme?: OfficeTheme;                                    // default 'dark'
  timeOfDay?: TimeOfDay | 'auto';                         // default 'auto'
  faceFactory?: FaceFactory;                              // default: initials badges
  accentFor?: (hex: string, theme: OfficeTheme) => string; // default: identity
  assetsBase?: string | null;                             // default '/office/'; null forces the vector skyline and walls
  reducedMotion?: boolean | null;                         // null/undefined follows prefers-reduced-motion
  initialCamera?: 'fit' | { x: number; y: number; zoom: number }; // 'fit' = the hero shot (phones: the Chief's neighbourhood)
  labels?: Partial<OfficeStrings>;
  now?: () => Date;                                       // tests
  cameraKey?: string | null;                              // sessionStorage key for the camera; default 'hc.office.camera'; null = off
  keyTarget?: 'scene' | 'document';                       // default 'scene'; 'document' = the Floor route with the Office active
}

export interface OfficeState {
  mode: OfficeMode; roomId: string | null;
  participants: string[];                                 // at the table of the room the owner is in ([] in desk mode)
  rooms: Record<string, string[]>;                        // who sits in each room, owner there or not (desk mode: waiting)
  camera: { x: number; y: number; zoom: number }; lod: 0 | 1 | 2;
  focusedId: string | null; hoveredId: string | null; timeOfDay: TimeOfDay;
}

export interface OfficeScene {
  readonly el: HTMLElement;
  setPeople(people: OfficePerson[], groups?: OfficeGroup[], leadId?: string): void;   // re-plan; moved people walk
  setPresence(personId: string, state: PresenceState, opts?: { label?: string; badges?: PresenceBadge[] }): void;
  setSpeaking(personId: string, speaking: boolean): void;                             // client-local; outranks presence
  showBubble(personId: string, text: string, opts?: { ttlMs?: number; to?: string }): void;
  hideBubble(personId: string): void;
  anchor(personId: string): { el: HTMLElement; release(): void };                     // host renders its own bubble here
  showCaption(personId: string | null, text: string, opts?: { final?: boolean; voiced?: boolean }): void;
  setFloorQueue(personIds: string[]): void;
  focus(personId: string, opts?: { animate?: boolean; zoom?: 'keep' | 'desk' }): void;
  walkTo(target: string): void;             // a room id, 'chief', 'cafe', 'lounge', 'library', 'reception' or a group id
  zoomTo(level: 'fit' | 'neighbourhood' | 'desk' | number, at?: { x: number; y: number }): void;
  setMode(mode: OfficeMode, roomId?: string): void;
  enterRoom(roomId: string, participants?: string[]): void;
  seat(personId: string, roomId: string | null): void;                                // null = back to the desk
  leaveRoom(): void;
  dock(): HTMLElement;                                                                // stage slot for the host composer
  setTheme(theme: OfficeTheme): void;
  setTimeOfDay(tod: TimeOfDay | 'auto'): void;
  setReducedMotion(value: boolean | null): void;
  getState(): OfficeState;
  destroy(): void;                                        // removes DOM, listeners, the style tag (if last scene), FaceSlots
}

export function createOfficeScene(host: HTMLElement, options: OfficeOptions): OfficeScene;
export function planOffice(input: { people: OfficePerson[]; groups: OfficeGroup[]; leadId: string; rooms?: OfficeRoomSpec[] }): OfficePlan;
export function timeOfDayAt(date: Date): TimeOfDay;
export const DEFAULT_ROOMS: readonly OfficeRoomSpec[];   // [{id:'skyline', name:'Skyline room', seats:10, view:'skyline'}, {id:'garden', name:'Garden room', seats:8, view:'garden'}]
export const DISTRICT_ORDER: readonly string[];
export const DEFAULT_STRINGS: OfficeStrings;              // includes waitingIn(names) → "Nina, Nuria and 3 others · waiting for you"
export function hitTest(plan: OfficePlan, projected: Point): Hit;   // a seat, room, amenity or zone at a projected point, else null
export { project, unproject, toScreen, fromScreen } /* projection */; export { fitCamera, cameraBounds, clampCamera, zoomAround } /* camera */;
export type { OfficePlan, OfficeSeat, PlanRoom, PlanZone, PlanCell, OfficeStrings, OfficeManifest };
```

Semantics worth pinning down:

- `setPresence` and `setSpeaking` are idempotent and cheap (class and attribute writes). The scene forwards state to
  `FaceSlot.setState`.
- `showBubble` implements the LIVING-WORKFORCE §8.2 bubble rules: TTL 4 s + 60 ms per character, max 9 s, held while
  hovered and for 3 s after, two lines. With `to`, the scene draws a 1.2 s hand-off arc and a "Pax → Juno" chip (a text
  line with reduced motion). Phase 2 uses `anchor()` for the replyable FloorBubble instead.
- Unknown person ids are ignored with one `console.warn` per id. Calls after `destroy()` are no-ops.

### 5.4 FaceView through `faceFactory` (Phase 2 host code, `apps/web`)

```ts
const faceFactory: FaceFactory = (agentId, tier) => {
  const subject = subjectFor(agentId);                    // persona or lead → {id, name, accent, appearance}
  const el = document.createElement('div');
  el.className = 'office-face';                           // explicit size + border-radius come from the office
  const view = new FaceView({ tier, name: subject.name, onLandmarks: (lm) => saveLandmarks(subject.id, lm) });
  view.setAppearanceFallback({ appearance: subject.appearance, accent: subject.accent, name: subject.name });
  view.mount(el);                                         // ResizeObserver re-measures once the office attaches el
  void portraitFor(subject.id).then((info) => info && view.setPortrait(info));
  const unregister = registerFace(agentId, { cue: (c) => view.cue(c), setExpressionBias: (b) => view.setExpressionBias(b) });
  return {
    el,
    drawsChrome: true,                                    // FaceView draws the ring and glyph; the office keeps only halos
    setTier: (t) => { view.setTier(t); view.attachSampler(t === 'token' ? null : audio().sampler(agentId)); },
    setState: (s, label) => view.setState(s, presenceText(subject, s, label)),
    destroy: () => { unregister(); view.destroy(); },
  };
};
```

FaceView keeps its own chrome (ring and glyph), so the office uses the app's one state language. The office adds only
seat-level signals: halo, monitor, lamp and name plate. `packages/office` never imports `@headcount/avatar`. The
initials fallback mirrors the `hc-face` ring classes, so both look alike.

### 5.5 Testing and the dev harness

- **Unit (Vitest, happy-dom)**:
  - `planOffice`: determinism (hash); all 164 + Chief seated; no overlapping desks; the Chief in the Chief's cell;
    unknown groups appended; > 16 members span two cells; one added person moves no one outside their group.
  - `nav`: every seat reachable; arrow semantics.
  - `camera`: bounds, zoom-around-point invariance, inertia with a fake clock.
  - `timeOfDayAt`: the boundaries.
  - `lod`: hysteresis.
  - `tiers`: ≤ 3 tiles and priority order.
  - `dwell`: 600 ms and 0.3 px/ms; keyboard 900 ms; a camera move resets it.
  - Scene API: presence toggles monitor, lamp and halo classes; bubble TTL; enter, invite, seat and leave fire
    callbacks in order; `onInvite → false` springs back; `destroy` leaves no DOM, listeners or timers.
- **Dev harness** (`packages/office/dev`, no `apps/web` edits): run with
  `node apps/web/node_modules/vite/bin/vite.js --config packages/office/dev/vite.config.mjs` on **:5870**
  (`publicDir` = `apps/web/public`, `fs.allow` = the repo root). It loads people from
  `packages/catalog/generated/slim.js`. `?faces=avatar` imports FaceView from `packages/avatar/src` by path with
  `detectLandmarks: false`, and portraits come through a proxy to the owner's worker that **forwards GET only**
  (`bypass` returns `false` → 404 for any other method), so the harness can never write. `?faces=initials` is the
  default. The harness has controls for presence, speaking, bubbles, the time of day, the theme, reduced motion and a
  scripted roundtable.
- **Screens**: `docs/dev/screens/office/`: desk L0/L1/L2 (dark, light), night/dusk/day, the conference stage (speaker
  and captions), reduced motion, 375 px, and the asset gallery.
- **Perf probe** (`dev/perf.mjs`, Playwright on the harness): scripted pan + zoom for 3 s with 176 people; p95 frame
  ≤ 18 ms, mounted faces ≤ 96, animated tiers ≤ 3, and zero rAF callbacks for 2 s when idle.
- **a11y**: axe on the harness (no violations); the tab order enters at the skip link, then the seat group.

---

## 6. Phase 2: integration checklist (after Inc 0.5 lands)

In order. Each item names the file, the call and the test that proves it. Paths are in `apps/web/src` unless stated.
The office's contract is §5.3; everything below is host code.

### 6.1 Preconditions

- [ ] Inc 0.5 is merged: `living/` (`livingHover`, `livingBargeIn`, `useDesk`'s `activeDesk`, `captions.bubbles`,
  `faces.registerFace`), `components/FloorBubble.tsx` (`openReply`, `closeReply`, `replyingAgent`), the desk quick chat
  `POST /api/desk/:personaId/say` (`apps/worker/src/desk/routes.ts`) and Ambience.
- [ ] Phase 1 is accepted from [`screens/office/`](screens/office/) (§9).
- [ ] `apps/web/package.json`: add `"@headcount/office": "workspace:*"`, then run `pnpm install` once. The package has
  no dependencies, so nothing else moves. The art is already served from `apps/web/public/office/` and is only
  requested by the office chunk (`/office/manifest.json`, then one skyline variant).

### 6.2 The Floor route: Office | Directory

- [ ] `routes/Floor.tsx`: an **Office | Directory** segmented control in the header beside `<AmbienceControl/>`. A
  `floorView` signal (`'office' | 'directory'`) persisted in `localStorage['hc.floor.view']` (wrapped in try/catch).
  Deep links: `?view=office|directory`, `&room=skyline|garden` (→ `scene.enterRoom(room)`), `&focus=<personaId>`
  (→ `scene.focus(coworkerAgentId(id), {zoom: 'desk'})`).
- [ ] Default: `'office'` when `matchMedia('(min-width: 900px) and (pointer: fine)')` matches, else `'directory'`.
  The office's skip link calls `onRequestDirectory` → `floorView = 'directory'` and focus the Directory heading.
- [ ] New lazy chunk `routes/floor/OfficeView.tsx` (through `lazy.ts`), so Directory users never load the office or
  its art. It mounts `createOfficeScene(host, options)` in an effect over a ref, keeps the scene in a ref, and calls
  `scene.destroy()` on unmount. The host box is `position: relative` and fills the route below the header.
- [ ] Options:
  - `people`: the Chief `{id: CHIEF_ID, name: chiefName, title: 'Chief of Staff', groupId: 'chief', accent:
    currentLead.avatar.accent_color, seniority: 'principal'}` plus the 164 slim personas as
    `{id: coworkerAgentId(p.id), name, title, groupId: p.department, accent: p.avatar.accent_color, seniority}`.
  - `groups`: the catalog departments. `leadId: CHIEF_ID`.
  - `accentFor`: `lib/accent`'s `accentFor`; `theme`: the resolved theme (an effect calls `scene.setTheme`).
  - `faceFactory`: §5.4, returning `drawsChrome: true` so there is one ring (FaceView's).
  - `keyTarget: 'document'`: the Office is the active view, so `G`, `/`, `[ ]`, `+ − 0`, `Home` work at once. The
    Floor's own `useReplyKey` (R) keeps working: the office never intercepts R, Space or L.
  - `assetsBase` default (`/office/`), `cameraKey` default, `timeOfDay: 'auto'`.
- [ ] In Office view hide the Directory's search and department tools (the office HUD has Find and Walk to), or
  route them: the department filter → `scene.walkTo(departmentId)`; the search box → the office's Find (a later,
  additive `setFind(query)` if the owner wants one box).
- [ ] Settings: reduced motion → `scene.setReducedMotion(v)`; still-portrait mode → the factory returns still tokens
  (the speaker keeps the ring and caption); Text Floor → omit `faceFactory` (initials badges).
- [ ] Unit test (`routes/floor/OfficeView.test.tsx`, happy-dom): mounts with 165 `.hc-o-seat` buttons, destroys on
  unmount (no `.hc-office`, no `#hc-office-style`), and the view persists in localStorage.

### 6.3 Desk mode: passing by and quick chat

- [ ] `onHover(id, {phase, via})` → `livingHover(id, phase, via)`; `onHoverEnd(id, {via})` → `livingHover(id, 'leave',
  via)`. The office already runs `useDesk`'s thresholds (600 ms below 0.3 px/ms, keyboard 900 ms, a touch tap), so do
  not wrap it in `useDesk`.
- [ ] `onFocusChange(id)` → `activeDesk.value = id`, so R replies to the desk the owner is at, as in the Directory.
- [ ] Bubbles: for each agent in `bubbles.value` (`living/captions`) that has a seat, portal
  `<FloorBubble agentId first hovered onOpenDesk deskLabel/>` into `scene.anchor(agentId).el` and `release()` the
  anchor when the bubble goes. `hovered` comes from a signal fed by `onHover`/`onHoverEnd`. The anchor sits at the
  top of the face; FloorBubble's above/below measurement uses it as the card. The office's own `showBubble` is for
  the harness only.
- [ ] `onOpen(id, {via})`: a coworker → `openReply(id)` (the bubble's field focused; quick chat over
  `POST /api/desk/:personaId/say`), with "Open desk" in the bubble → `navigate(paths.coworker(personaId))`. The Chief
  → `navigate(paths.talk)`.
- [ ] Presence: an effect over the store's `presence` signal → `scene.setPresence(agentId, shown.state, {label,
  badges})` from `presenceFor(agentId)`; the Chief from `chiefPresence` (a running job shows as *working* with its
  label, and `badges: ['lamp']` for Night Shift). The calls are idempotent and cheap.
- [ ] Speaking: `audio().onSpeakingChange((id, on) => scene.setSpeaking(id, on))`; unsubscribe on unmount.
- [ ] Viewer op (`living/viewer.ts`): `onViewportChange({personIds, roomIds, zoom, lod})` → the op sender with
  `surface: 'floor'`, or `'room'` while `scene.getState().mode === 'conference'`, plus the visible agent ids for the
  side-talk gate. Add an optional `office: {mode, roomId, visible}` to `ViewerInput` so `stageOf()` can say `'room'`.
- [ ] Rooms before the owner arrives: `scene.getState().rooms` is the source for any host UI; the door plate already
  says "… · waiting for you" (X3).

### 6.4 Conference roundtable: backend

- [ ] Protocol (protocol owner, `packages/protocol`): `TalkSurface` (`ext/expressions.ts`) gains `'room'`; add
  `RoomSayRequest {text, opId, participants: AgentId[], via: 'text' | 'voice'}` and
  `RoomSayAccepted {accepted: true, opId, turnId, order: AgentId[]}`; an optional `roomId` on `talk.owner`,
  `talk.delta`, `talk.done` and `talk.cancelled`. `ExprSurface` already has `'room'`.
- [ ] Worker route `POST /api/rooms/:roomId/say` (new `apps/worker/src/rooms/routes.ts`, registered beside `deskSay`
  in `apps/worker/src/index.ts`): validate like `desk/routes.ts` (text length, known agent ids, ≤ 9 participants,
  `roomId` in `skyline | garden`), then `WorkspaceDO.roomSay(roomId, body)` → **202** `RoomSayAccepted`.
- [ ] `WorkspaceDO.roomSay()`, the Inc 0.7 slice of the Inc 2 RoomDO (`rooms/room-do.ts` stays a stub):
  - **Floor control.** Exact first-name @mentions go first. Otherwise at most **3 responders** per owner turn, ranked
    by being addressed by name, then the relevance of the persona's title and skills to the text (a keyword score
    from the full catalog), then seat order from the owner's left, rotated so no one always goes first. The Chief,
    when present, adds one wrap-up line only if at least 2 others spoke. The owner always has priority: a new owner
    message or push-to-talk bumps the room `gen`, cancels the running turn and drops the queue
    (`talk.cancelled {reason: 'owner'}`).
  - **Turns.** Sequential fast-tier turns reusing the A11 desk turn (persona prompt, no tools, at most 2 spoken
    sentences, the same honesty guard). Each turn sees a **room projection**: the last 12 room lines, others' lines as
    `[Juno (Copy lead)]: …` (ARCHITECTURE §7.2). Frames are `talk.*` with `surface: 'room'`, `roomId`, `agentId`,
    `turnId`. Room lines never enter a coworker's 1:1 desk history or Talk. The server runs at machine speed; the
    client paces playback.
  - **Limits.** Each turn counts against `CHAT_DAILY_LIMIT`; at most 12 room turns a minute.
  - Not recommended: faking the roundtable through `/api/desk/:id/say` with a stuffed prompt (it writes room context
    into 1:1 histories and has no shared floor control).
- [ ] Worker tests (Mock provider, `apps/worker/src/rooms/rooms.test.ts`): @mention order; at most 3 responders; the
  Chief's wrap-up only after 2; an owner message mid-turn cancels and drops the queue; the same `opId` is idempotent;
  429 at the limit; room lines absent from `/api/desk` history.

### 6.5 Conference roundtable: UI

- [ ] A room session store (`room/session.ts`): `{roomId, participants, lines[], turnId}`. `onEnterRoom(roomId, ids)`
  opens it; `onInvite` and `seat()` update `participants`; `onLeaveRoom(roomId, ids)` closes it and posts one summary
  line to Talk (X2) when anything was said. A meeting exists only while the owner is in the room (Inc 0.7).
- [ ] `scene.dock()` → render `<RoomComposer/>` into it: "Message the room…", hold Space to talk (the existing
  `voice/ptt.ts` with the room as the target), Esc on an empty field → `scene.leaveRoom()`. Send →
  `POST /api/rooms/:roomId/say` with `participants: scene.getState().participants`.
- [ ] Frames with `surface: 'room'`: the 202's `order` → `scene.setFloorQueue(order)` (it shrinks as each speaker
  finishes); `scene.setPresence(nextId, 'thinking')` while that turn generates; `talk.delta` →
  `scene.showCaption(agentId, text)`; the owner's own line → `scene.showCaption(null, text)`.
- [ ] Voice, *writer ‖ voicer ‖ player* (ARCHITECTURE §7.6): each completed line → `/api/speech/tts` in the persona's
  voice with alignment (at most 2 lines ahead) → the audio engine with `speakerId = agentId`; `onSpeakingChange` then
  drives `scene.setSpeaking` (the stage lifts the speaker to hero; the factory attaches `audio().sampler(agentId)`
  when the tier is not a token). Captions follow the alignment. Keyless: `showCaption(id, text, {voiced: false})`
  (the NOT VOICED tag).
- [ ] Reflexes (D5): while a responder is *thinking*, the living layer may play one short filler or backchannel from
  them at −4 dB (the existing reflex path, Ambience rules). Listeners already tilt toward the speaker.
- [ ] Barge-in: a new owner message or push-to-talk while someone speaks → `livingBargeIn(agentId)`, stop playback,
  `scene.setFloorQueue([])`, `scene.setSpeaking(id, false)`.

### 6.6 End-to-end tests to add (`e2e/office.spec.ts`, Mock provider)

1. At 1440 × 900 with a fine pointer the Floor opens as the Office with 165 `.hc-o-seat` buttons; the toggle persists
   across a reload; `?view=directory` shows `.cw-grid .cw-card`; the skip link switches to the Directory.
2. Keys at load (`keyTarget: 'document'`): `G` opens Walk to (`.hc-o-walk` visible), `/` focuses Find, `Home` focuses
   the Chief, arrows move along a bench, Enter on the Chief navigates to Talk.
3. Hover a desk 700 ms → a `.floor-bubble` inside `.hc-o-anchor`, and `data-face-cue="look_up"` on its face.
4. Click a face → the reply field is focused; send → the Mock reply appears in the bubble.
5. A quick chat's *thinking* claim lights the desk (`.hc-o-sl[data-mon]`) and sets `data-state` on the seat.
6. Walk to the Skyline room → the stage; `I` → the picker → invite 2 → two `.hc-o-sseat`; send "What do you
   think?" → two Mock replies appear as captions in order, each speaker `[data-speaking]`; a second owner message
   cancels the rest; Esc leaves → after 2 s no `.hc-o-seat[data-room]`; one summary line in Talk.
7. Drag a badge onto the Garden room in desk mode → the door plate reads "… · waiting for you".
8. Reduced motion: no transitions (computed durations 0) and the camera jumps.
9. Phone (375 × 812): the Floor opens as the Directory; toggled to the Office, the HUD is one row with the Find icon.
10. `e2e/screens.spec.ts` gains `office-night` and `office-stage`.

### 6.7 Order of work and demo

1. §6.1–6.3: the Office view, the toggle and desk-mode wiring (hover, bubbles, quick chat, presence, speaking).
2. §6.4: the room endpoint and protocol additions (worker and protocol owners), with its worker tests.
3. §6.5: the stage wiring (dock, roundtable, voice, captions, barge-in).
4. §6.6 and the screens; then the owner demo: *open the Floor at night → rest on a desk (look-up + line) → click to
   chat → walk to the Skyline room → invite three → ask a question → hear three answers with captions → barge in →
   leave.*

---

## 7. Phase 1 work packages (this build, allowed paths only)

| # | Package | Output | Acceptance |
|---|---|---|---|
| P1 | **Plan** | `plan/**`, `rng.ts`, `time.ts`, tests | Deterministic; the §5.5 plan tests pass; matches the sketch |
| P2 | **Art library** | `art/symbols.ts`, `palette.ts`, `props.ts`, `skyline-fallback.ts`, `dev/gallery.html`, gallery screens | Every §1.5 asset in dark and light with states; the owner signs off on the gallery screens |
| P3 | **Skyline art** | `scripts/office-art.mjs`, `apps/web/public/office/{manifest.json, skyline-*, conference-*, art-*}` | Three skyline variants, two conference backdrops and the Garden room's living wall, three art pieces; ≤ 2 retries each; lights and beacons extracted; falls back cleanly when missing |
| P4 | **Scene** | `scene/**`, `a11y/**`, `styles.ts`, `index.ts` | 60 fps probe, LOD, dwell, keyboard map, walk to, mini-map, reduced motion, zero idle rAF |
| P5 | **Stage** | `stage/**` | Enter, invite (picker and drag), walks, seat, speaking highlight, captions, floor line, leave, narrow layout |
| P6 | **Harness + screens** | `dev/**`, `docs/dev/screens/office/**` | All §5.5 screens; perf probe and axe results recorded |

P1 and P2 run in parallel. P4 needs P1 (and uses the fallback skyline until P3 lands). P5 needs P4.

---

## 8. Risks and open questions

- **Safari large layers.** The crop-mode fallback (§5.1) covers it; the perf probe runs on WebKit too.
- **Face memory.** Each token is a small canvas; the 96-slot cap and LRU release bound it. If the probe shows pressure,
  tokens can become `<img>` stills from a 64 px sprite (ARCHITECTURE §9.1 plans `.token.webp`). That would be an
  avatar-owner change.
- **Directional gaze.** The stage fakes "turn toward the speaker" with badge tilt. A true yaw target on FaceView
  (`lookToward(x)`) would be an additive request to the avatar owner.
- **Owner's local time.** Uses the browser clock. The server-side `tzOffsetMin` in the viewer op already exists if
  the Brief or rooms need it.
- **Art review loop.** The skyline and asset gallery are the most taste-sensitive parts. Show the gallery and one
  night frame to the owner before building the stage.
- **Room semantics before Inc 2.** In 0.7 a meeting lives only while the owner is in the room. Say so in the stage
  empty state: "Invite people to the table. They answer when you talk to the room."

---

## 9. Phase 1 as built (29 September 2026)

`packages/office` is built, tested and polished against the design review
([`screens/office/REVIEW.md`](screens/office/REVIEW.md)). No runtime dependencies. `apps/web` is unchanged; Phase 2
mounts it (§6). The public API is §5.3.

- **Code.** `src/plan/**` (planOffice, nav, walks, hit-testing), `src/art/**` (symbols, palette, plate, light, bodies,
  skyline manifest and vector fallback), `src/scene/**` (createOfficeScene, camera, LOD and tiers, dwell, sky, HUD,
  faces), `src/stage/**` (conference stage, perspective, invite picker), `src/styles.ts`, `src/index.ts`.
- **Tests.** 56 Vitest tests (happy-dom), run with `npx vitest run packages/office` from the repo root: plan
  determinism and seating, nav, walks, projection, hit-testing, camera fit, bounds, rubber band, zoom-around-point,
  inertia and flights (log zoom, straight screen path), LOD hysteresis, face sizes, tiers, dwell, time of day, stage
  geometry (party-sized table, tent cards with their owners), and the scene API (presence lights, bubble TTL, enter,
  invite, refuse, seat, leave, capacity, faceFactory release, host chrome, floor-click focus, `keyTarget:
  'document'`, the Chief's label, "waiting for you" and `getState().rooms`, the NOT VOICED tag, calm after 30 s,
  destroy with no DOM, style tag or timers left).
- **Demo** (`packages/office/demo`): the real catalog, catalog portraits as token faces through a proxy that forwards
  only `GET`/`HEAD /api/portraits*`, and a panel for the time of day, bubbles, rooms, the roundtable, theme and
  reduced motion. It routes keys with `keyTarget: 'document'` (`?keys=scene` for the default). Run
  `node apps/web/node_modules/vite/bin/vite.js --config packages/office/demo/vite.config.mjs` (port 5870).
  `node packages/office/demo/check.mjs` runs 37 checks with real input, including the review's probes (keys at load
  and after a floor click, the sky cut, beacons, 24 px targets, 11 px labels, the Chief's label, the app font, the L0
  name plate, the ink focus ring, amenity plates at L1) and the perf probe (pan at 3.2 px/u with 96 faces: p95
  16.7 ms). `node packages/office/demo/shoot.mjs` writes the screens.
- **Art.** Nine assets in `apps/web/public/office/` (the Garden room's living wall is new:
  `node scripts/office-art.mjs --budget 1 --only conference-garden`, one generation, gpt-image-2).
  [`art-contact-sheet.jpg`](screens/office/art-contact-sheet.jpg).

**The review's 25 fixes**, all applied (numbers as in REVIEW.md):

| # | Fix | Where |
|---|---|---|
| 1 | The sky stops at the north floor line; the void is beside and under the plate | `scene/sky.ts` (a transform-positioned `--o-void` veil; `--o-sky-cut`), `styles.ts` |
| 2 | North glass 40 u with transom, sill, tint and 0.8 u mullions; 3 u east and west façades | `art/symbols.ts` `windowBand()`, `sideGlazing()` |
| 3 | Dark palette lifted; hairline top edges on chair backs and desk tops; mesh backs ≥ 1.6:1 | `art/palette.ts`, `art/symbols.ts` |
| 4 | Shoulders under every face; L1 faces clamp(24, 5.2 u × zoom, 32) | `scene/scene.ts` (`.hc-o-seat__body`), `scene/lod.ts`, `styles.ts` |
| 5 | The table follows the party; faint pushed-in chairs only between people | `stage/stage.ts` (`tableSeatsFor`), `stage/perspective.ts` |
| 6 | Chair back, shoulders and a scrim per seat, tucked under the table edge; listeners dim by brightness | `stage/stage.ts`, `styles.ts` |
| 7 | A photographic Garden room wall, vector when keyless | `scripts/office-art.mjs`, `manifest.conference.garden`, `stage/stage.ts` |
| 8 | The keyboard map works after load and after a floor click; `keyTarget` | `scene/scene.ts`, `types.ts` |
| 9–11 | L0 name plate, unclipped first names, two-line status lines | `styles.ts`, `scene/scene.ts` (48-character cap) |
| 12–13 | Amenity plates in their cells and from L1; labels ≥ 11 px, ellipsized only at L0 | `scene/scene.ts`, `styles.ts` |
| 14–15 | Ink focus rings; 24 px (44 px coarse) plan-zoom targets | `styles.ts` |
| 16 | `FaceSlot.drawsChrome` → `data-host-chrome`, one ring | `types.ts`, `scene/scene.ts`, `stage/stage.ts`, `styles.ts` |
| 17 | `--font-sans` first | `styles.ts` |
| 18 | The pip carries state; brighter north-side monitor spill | `styles.ts`, `art/light.ts` |
| 19 | Tent cards ≥ 11/10 px, never dimmed, a quarter face from their owner | `stage/perspective.ts`, `styles.ts` |
| 20 | Phones: one HUD row, Find icon, the Chief's neighbourhood at 2.4 px/u | `scene/hud.ts`, `scene/scene.ts`, `styles.ts` |
| 21 | Flights: log zoom, the target on a straight screen line | `scene/camera.ts` `flightCamera()` |
| 22 | ≤ 3 slow beacons; calm after 30 s without input | `scene/sky.ts`, `scene/scene.ts`, `styles.ts` |
| 23 | NOT VOICED as a tag beside the name | `stage/stage.ts`, `strings.ts` |
| 24 | The Chief's label says Chief of Staff once | `strings.ts` `seatLabel` |
| 25 | "… · waiting for you" in desk mode; `getState().rooms` | `strings.ts` `waitingIn`, `scene/scene.ts`, `types.ts` |

Where the build differs from the review's wording, and why:

- **Fix 1: a veil, not a mask.** `mask-image` on the panorama driven by a per-frame `--o-sky-cut` re-rasterised the
  whole sky every frame (pan p95 33 ms with 96 faces). A `--o-void` gradient layer moved by `transform` gives the same
  picture at p95 16.7 ms. `--o-sky-cut` is still set, in screen px.
- **Fix 5: the table also gets shorter.** Sizing the seat count alone still put five guests at the two ends of a
  full-length table. A small party now sits from the near end at a roomier pitch and the table ends just behind its
  farthest pair, under the same camera, so the meeting fills the lower half with the city above.
- **Fix 19: cards hang from the chin.** `card.x` is the seat plus a quarter face toward the centre, as asked; `card.y`
  is just under the chin (the card's top edge), so the speaking lift (1.18) never covers the name.
- **Fix 8: arrows still need a seat.** Arrows and Enter act only when a seat has focus, so page scrolling keeps
  working with `keyTarget: 'document'`; `[ ]`, PageUp/PageDown and Home work from the floor.
- **Fix 20: the narrow anchor is a camera.** Phones open on a dedicated camera (2.4 px/u, the Chief's neighbourhood,
  the floor line at 33 % of the height), and the sky is framed for that camera so the waterline sits in the glass.
- **Also fixed in the pass:** people who walk into view while the camera is still get their faces at once (before,
  they waited for the next camera settle, so an invitee could sit faceless); phone booths have glass fronts; the
  desk-mode HUD has a 72 px scrim; daytime window light reaches the first bench (`--o-window-a` 0.3); the phone Find
  field is opaque when open.

**Screens** (`screens/office/`, all `.jpg` at 2×; the review's "before" set is in `screens/office/review/`):

| Screen | Shows |
|---|---|
| `desk-wide-night`, `tod-night`, `tod-dusk`, `tod-day`, `fit-1280x720`, `fit-1920x1080` | The hero shot: the floor on the 30th floor, the glass wall, labels ≥ 11 px |
| `desk-zoomed`, `desk-close`, `chief-office`, `library`, `walking`, `conference-walk` | L1 and L2: chairs, shoulders, state pips, two-line status, amenity plates, "waiting for you" |
| `hover-bubble`, `hover-l0` | Passing-by bubble at L1; the full-name plate at plan zoom |
| `a11y-focus-l0`, `a11y-focus-desk`, `walkto-menu`, `find-sam`, `find-sam-enter` | Ink focus rings; `G` and `/` after a floor click |
| `conference-5`, `conference-garden`, `conference-picker`, `mobile-375-conference` | The stage: a party-sized table, seated people, tent cards, NOT VOICED, the picker, the phone stack |
| `mobile-375`, `mobile-375-find` | The phone opening view and the expanding Find |
| `desk-light`, `fallback-skyline`, `demo-panel` | Light theme, the keyless vector city, the harness panel |

Earlier decisions that still hold:

- **L0 shows people from above**, not accent dots: shoulders in a muted accent, hair and head, drawn in world space.
- **Neighbourhood signs** sit in the aisle under each neighbourhood: small text at L0 and a door plate from L1.
- **Plate size** is about 3,300 SVG nodes (repeated assets are `<use>`), over the 2,500 target, at no frame cost.
  Chrome does not match descendant selectors inside `<use>` shadow trees, so fill classes are single prefixed classes
  (`hco-*`) and themes travel through the inherited `--o-*` tokens.
- **`enterRoom(room, ids)`** seats the ids without calling `onInvite` (the host chose them); `onInvite` fires only for
  invites made in the office (picker, drag, `I`).
- **Not built in Phase 1:** the asset gallery page (§1.5; the screens cover the assets in place), crop mode for very
  large Safari layers (§5.1), preloading the next sky variant 10 min before it switches (§3.8), and a depth-of-field
  blur on the sky at L2 (the review's optional note).
