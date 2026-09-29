# Staff photo shoot: art direction

One editorial portrait direction for the whole Headcount cast: the 12 leads, the 164 catalog coworkers and every coworker a lead spawns later. It implements owner directive D3 ("Modern, hip knowledge workers", "Dark by default, everywhere") without breaking the lip-sync renderer.

- **Who each person is:** [`renames.json`](renames.json) (new name, handle, age range, look, accent and rim-light colour for all 176 people).
- **Renderer contract:** `taxonomy.json` → `portrait_conventions` (prefix, rules, expression edits, landmarks, LOD tiers). This document tightens it and never relaxes it. If the two disagree, the renderer rules win.

---

## 1. The idea

**The whole staff of a top design studio, shot on one afternoon, on one set, with one light.** Everyone looks like a sharp, relaxed, contemporary knowledge worker: well cut, never costumed, never corporate stock. The faces sit on a near-black interface, so the set is dark and each person carries their own accent as a soft coloured rim of light, the same accent the UI uses for their desk, ring and captions.

The portraits have to work at three sizes: Hero (1024 px, lip-synced), Tile (256 px) and Token (a 32–64 px still). Keep silhouettes simple and faces bright, so a person still reads at thumbnail size.

## 2. Non-negotiables: the lip-sync renderer

The renderer warps the resting portrait's mouth strip and animates blinks and brows from face landmarks that are detected once. Anything that hides or moves the mouth, jaw or eyes breaks the warp. These rules come from `portrait_conventions.rules` and cannot be waived.

1. **The prompt starts with this prefix, verbatim, including the trailing space:**
   `A single adult, front-facing portrait, unobstructed face, relaxed closed lips, head and shoulders, natural facial proportions, no text. `
2. **One adult,** front-facing, eyes to camera, head level (no tilt or turn), shoulders square.
3. **Lips closed and relaxed.** No smile with teeth, no parted lips, no pursed or pressed lips.
4. **Mouth, jawline and chin fully visible.** Beards and moustaches are trimmed clear of the lips. Nothing covers the mouth or chin: no hair, scarf, collar, mask, microphone or hand.
5. **No hands, props or other people** anywhere near the face.
6. **Eyes visible.** No sunglasses and no tinted or mirrored lenses. Glasses have clear, glare-free lenses, and a fringe stops at or above the brow line.
7. **Plain, uncluttered background.** No text, logos, watermarks or frames.
8. **3:4 vertical frame,** head and shoulders, face about 35–45% of the image height, and photographic realism.
9. **Head coverings are welcome** (hijab, turban, kufi, embroidered cap, headwrap, beanie) as long as the face contour, mouth and chin stay clear.
10. **Cultural rule:** never generate moko, tā moko or other genealogical or sacred markings. Show heritage through lore and everyday adornment, such as the pounamu pendant in `renames.json`.

## 3. The set: backdrop, light, lens and grade

| | Direction | Why |
|---|---|---|
| **Backdrop** | Deep charcoal seamless paper: about `#17191D` behind the head, falling to about `#0C0D0F` at the edges. It is matte and plain, with no texture, props, bokeh or banding. | It matches the dark UI (`--surface #111316`), so a portrait looks lit from within the page rather than pasted onto it. |
| **Key light** | One large soft source (a big octabox) just off the camera axis and slightly above eye level. It lights the **whole face evenly**, with a gentle fill from the other side about one stop under. | Landmark detection and the mouth warp need an evenly lit face. There must be no hard nose shadow on the upper lip and no dark jaw edge. |
| **Rim light** | Two soft strip lights behind the subject, **tinted with the person's accent** (`rim_light` in `renames.json`). They trace the hair and the tops of the shoulders. The accent colour stays on the edges and **never falls on the front of the face or the lips**. | It gives the one-accent-per-agent glow of D3, separates dark hair and dark clothing from the dark backdrop, and keeps skin and lip colour true. |
| **Lens and camera** | An 85 mm portrait look at eye level, with sharp focus on the eyes and mouth and a gently soft background. The head is centred with a little headroom. | This is the existing convention. It gives a flattering perspective, and the landmark geometry stays consistent across the cast. |
| **Grade** | Cinematic but true to life. Whites are neutral, the filmic contrast is gentle, and skin texture stays: pores, freckles, laugh lines, vitiligo, grey hair. There is no beauty smoothing, no teal-and-orange grade, no neon and no crushed shadows. | Faces are the status UI. People should read as people, not renders. |
| **Exposure** | Expose for the skin. Deep skin tones keep full detail and warmth against the dark set, and the rim light does the separating. | A dark set must never underexpose darker skin. |

## 4. Wardrobe, hair and styling

**The brief:** dressed for a Tuesday at a studio that ships good work. Modern creative-professional clothes, one idea per outfit and one signature detail per person. It is neither a costume, a uniform, a suit-and-tie stock photo nor streetwear cosplay.

- **Wardrobe vocabulary.** Tailored or oversized blazers over tees and fine knits; relaxed suits worn with a knit or an open collar; fine-gauge merino, mock-necks and knit polos; camp-collar, band-collar and mandarin-collar shirts; crisp oversized poplin; chore coats, field jackets, technical shells, quilted vests and utility overshirts; cropped bombers; denim and cord in considered colours.
- **Colour.** Most outfits sit in neutrals: black, charcoal, stone, cream, navy, olive and camel. About a third of the cast wears one saturated piece, such as a cobalt blazer, a marigold shirt or a scarlet suit. The accent lives mainly in the **light**. Clothing can echo it now and then, but the cast must not look colour-coded.
- **Hair.** Contemporary cuts and colours: blunt and sharp bobs, shags and lobs, pixies, undercuts, wolf cuts, textured crops, fades with line-ups, high-tops, locs, twists, box braids, afros, sleek buns and ponytails, and silver worn with intent. Now and then there is a bleach or colour moment (copper tips, a pink streak, platinum). Long hair is **tucked behind the ears or falls behind the shoulders** so the jaw and chin stay clear.
- **Eyewear.** About a third of the cast wears glasses: black or tortoiseshell acetate, crystal-clear frames, thin titanium or gold wire, rimless, round or geometric. Every pair has clear lenses, and the frames sit above the cheekbones.
- **Jewellery and details.** Small and deliberate: huggie hoops, studs, ear cuffs, a nose stud, a fine chain, a collar pin, a pocket square. Ear piercings and nose studs are fine. **No septum rings or lip or labret piercings**, because they sit on the warp strip.
- **Heritage and faith dress.** Hijabs, turbans, kufis, embroidered caps, headwraps, a kandura and a pounamu pendant are worn as everyday dress and styled as contemporary as the rest of the outfit. They are never exoticised or turned into costume.
- **Disability, described matter-of-factly.** Behind-the-ear hearing aids (3 people), vitiligo (2) and a wheelchair user (1; the top of the backrest is just visible behind the shoulders) appear as they are. They are never hidden and never framed as "despite".
- **Age.** Most of the cast is 24–44, and 26 people (14.8%) are 45–54, mostly principals and leads. Age shows as natural texture and grey, never as temperament: a 50-year-old can be the playful one, and a 27-year-old can be the sceptic.

## 5. Presence and expression

- **Resting portrait:** confident, relaxed and open, with the look of someone about to say something useful. The lips are closed and soft, and a little warmth shows in the eyes. The posture is upright, with the shoulders square to the camera.
- **Presence words** in the prompt come from the person's personality (for example wry, grounded, bright, unhurried, exacting or warm). They never come from heritage, gender or age.
- **Expression states** (`thinking`, `delighted`, `concerned`) are still derived from the approved resting portrait with `portrait_conventions.edit_prefix`. They change only the brows, eyes and cheeks, never the head pose or chin. `delighted` is a closed-lip smile. When a new look drops a detail that an edit instruction mentions (for example "eyes amused over the half-moon glasses"), rewrite that instruction to match the new look.

## 6. Prompt template

The portrait prompt is one string, in `prompt_order`:

```text
A single adult, front-facing portrait, unobstructed face, relaxed closed lips, head and shoulders, natural facial proportions, no text. A {heritage} {woman|man|person} in {her|his|their} {early|mid|late} {decade} with a {presence} presence. {Skin tone and undertone}, {one complexion detail}. {Hair from look, plus "tucked behind the ears" or "clear of the jaw" when long}{; head covering, clear of the face contour, mouth and chin}. {Facial hair, trimmed so the lips stay fully visible | omit}. {Eyewear with clear, glare-free lenses | No eyewear}; {accessories from look}. {Attire from look}. Calm, attentive, quietly confident expression, lips closed and relaxed, eyes to camera, head level, shoulders square. Editorial staff portrait on a deep charcoal seamless studio backdrop fading to near-black, plain and uncluttered, with a soft {rim_light} rim light tracing the hair and shoulders, never falling on the face. Large soft key light that lights the whole face evenly, gentle fill, no hard shadows across the mouth or jaw; eye-level camera, 85mm portrait look, 3:4 vertical frame, sharp focus on the eyes and mouth, natural skin texture, cinematic but true-to-life color.
```

| Slot | Source |
|---|---|
| `{heritage}`, pronoun words | `renames.json` `heritage` and `pronouns`. For `they/them`, write "person" and "their", and let the look carry the presentation. |
| `{decade}` | `new_age_range`: 24–27 → mid-twenties, 25–29 → late twenties, 30–34 → early thirties, 35–39 → late thirties, 40–44 → early forties, 45–49 → late forties, 50–54 → early fifties |
| `{presence}` | One or two words from the persona's `personality` |
| Skin and complexion | The current `avatar.appearance.skin_tone` and `complexion_details`. Drop age details that no longer fit, such as "deep forehead lines" on someone now 35. |
| Hair, eyewear, accessories, attire | Split the `look` sentence into these slots, word for word where possible |
| `{rim_light}` | `renames.json` `rim_light`, a colour name plus hex, for example `crimson (#C92C49)` |

Also update `avatar.appearance` (hair, eyewear, accessories and attire, plus `procedural` hair and brow colours for the CSS fallback) and `alt_text`, for example "…against a dark charcoal backdrop with a crimson rim light." For leads, update `avatar.signature_look` to match.

### Worked examples

**Sunny Baek** (lead-straight-shooter):
> A single adult, front-facing portrait, unobstructed face, relaxed closed lips, head and shoulders, natural facial proportions, no text. A Korean-American woman in her late thirties with a direct, warm presence. Light skin with warm undertones, a clear natural complexion. A razor-sharp black bob ending just below the jaw, the jawline and chin fully clear. Thin black rectangular frames with clear, glare-free lenses; one fine silver chain. A crisp white oversized poplin shirt worn open at the collar. Calm, attentive, quietly confident expression, lips closed and relaxed, eyes to camera, head level, shoulders square. Editorial staff portrait on a deep charcoal seamless studio backdrop fading to near-black, plain and uncluttered, with a soft crimson (#C92C49) rim light tracing the hair and shoulders, never falling on the face. Large soft key light that lights the whole face evenly, gentle fill, no hard shadows across the mouth or jaw; eye-level camera, 85mm portrait look, 3:4 vertical frame, sharp focus on the eyes and mouth, natural skin texture, cinematic but true-to-life color.

**Liban Warsame** (head-of-analytics; head covering and beard):
> A single adult, … no text. A Somali man in his early forties with a calm, exacting presence. Deep brown skin with cool undertones, a smooth even complexion. Close-cropped black hair under a white knitted kufi that sits above the brow line, clear of the face contour. A trimmed black beard shaped close and kept fully clear of the lips. No eyewear. A black oversized blazer over a stone mock-neck knit. Calm, attentive, … with a soft deep sky-blue (#307486) rim light … true-to-life color.

**Nayra Choque** (home-services-operator; wheelchair user):
> A single adult, … no text. An Aymara Bolivian woman in her early forties with a practical, upbeat presence. Warm medium-brown skin with golden undertones, faint laugh lines. Shoulder-length straight black hair with grey streaks, tucked behind her ears. No eyewear; small silver studs. Seated upright in her wheelchair, the top of its black backrest just visible behind her shoulders; a navy technical polo under a cropped rust puffer vest. Calm, attentive, … with a soft sky-blue (#2E86AB) rim light … true-to-life color.

## 7. Do and don't

**Do**
- Start every portrait prompt with the prefix, verbatim.
- Use the same backdrop, light, lens, crop and grade for all 176 people. The cast should look like one shoot.
- Keep one adult, front-facing, eyes to camera, head level and shoulders square.
- Keep the lips closed and relaxed, with warmth in the eyes, not in the mouth.
- Keep the mouth, jaw and chin clear: long hair tucked back, beards trimmed clear of the lips, collars below the jaw.
- Give glasses clear, glare-free lenses, and keep any fringe at or above the brows.
- Light the face evenly and put the accent in the rim light only.
- Expose for the skin and keep texture: freckles, vitiligo, laugh lines, grey.
- Render head coverings, heritage adornment and disability aids exactly as `look` states them.
- Give each person one signature detail (a pin, a pocket square, a streak of colour, a collar), and keep it the same through every expression edit.

**Don't**
- Sunglasses, tinted or mirrored lenses, or lens glare.
- Hands, props (mugs, laptops, pens, phones), headphones, earbuds, microphones, lanyards or badges.
- Anything over the mouth or chin: scarves pulled up, turtlenecks over the jaw, masks, hair across the face, hoods up, hat brims or a beanie over the brows.
- A smile with teeth, parted lips, a head tilt or turn, a three-quarter pose or looking away.
- Text, logos, brand marks, slogans, lettered tees, watermarks, frames, office backdrops, bokeh lights or neon.
- Septum rings, lip or labret piercings, or face gems near the mouth.
- Coloured light on the face or lips, beauty-filter skin, a plastic sheen, crushed shadows or a teal-and-orange grade.
- Costume or caricature. Never moko, tā moko or other sacred markings. Never a real person, celebrity or brand.
- Age as temperament ("grumpy older man", "bubbly young woman").

**The landing page** reuses these portraits as the real coworker faces, per D3. Generated marketing scenes may use the same dark set and accent glow. They must not show invented customers, testimonials, logos or metrics, and people shown as coworkers carry the "AI coworker" framing.

## 8. Applying the re-cast

**Status:** steps 1–3 and 6 were applied in catalog 2.0.0 (28 September 2026), and `renames.json` stays as the record of every old and new name. Steps 4 (expressions) and 5 (portrait regeneration) belong to their own stages. Record ids never change, so references by id (recipes, formation, `pairs_well_with`, R2 portrait keys) survive. Names, however, appear in prose across about 96 files. Apply the plan in one pass:

1. **`taxonomy.json`** (the source of truth for names). For every lead and coworker, set `name`, `handle` and `age_range` from `renames.json`, and set `look_hint` from `look`. Keep `pronouns`, `heritage`, `seniority` and `title`. Bump `catalog_version` by a major version (renames). Regenerate `stats`, and add a `rebalancing_log` entry. Update `portrait_conventions.prompt_order` so its background and lighting lines match §3 and §6. The prefix and rules stay unchanged.
2. **Records** (`personas/*.json`, `leads/*.json`). Set `name`, `handle` and `age_range`. Set `avatar.accent_color`: 55 accents are lifted to at least 3:1 on the dark panel, with the same hue, and `old_accent_color` allows a revert. Rebuild `avatar.portrait_prompt` with §6, and update `appearance`, `alt_text`, `expression_palette` and, for leads, `signature_look`. Replace old full names and first names in every text field (backstory, intro lines, welcome, instructions, origin moments). Act on each `lore_note` (37 of them): the new age is younger, so rewrite phrases such as "four decades" or "retired" and keep the story.
3. **Name mentions elsewhere.** `teams/*.json`, `formation.json`, `leads/match-quiz.json`, `README.md`, `FORMATION.md`, `index.json`, `packages/catalog/generated/*` (regenerate), tests in `packages/*` and `apps/*`, `apps/web/src/components/Face.tsx`, `docs/EXPERIENCE.md` and `docs/dev/*`. PRODUCT.md §5 has its own story cast (Dana, Morgan, Juno…) that the new names deliberately avoid. Leave `catalog/reviews/*.md` as history, or annotate it.
4. **Expressions.** `catalog/expressions/**` and `packages/expressions/**` belong to the living-workforce work. Hand them this file, because their lines embed names.
5. **Portraits.** R2 keys are `portraits/<personaId>`, so the old faces persist. Regenerate with `pnpm portraits:generate --all --force` after step 2. Landmarks are re-detected per portrait version. Review each face against §7 and the checklist below before it is approved.
6. **Validate.** Run `node catalog/scripts/validate.mjs`, the catalog tests and a check that every first name is unique, is not a voice id and is not one of the docs' story names.

### Approving a portrait

Image models drop details that come late in a prompt and age people who have grey hair. Check every new portrait against this list, and regenerate (`pnpm portraits:generate --only <id> --force`, then `node scripts/landmarks-precompute.mjs --only <id>`) until it passes:

- [ ] **Signature detail present.** Vitiligo, a wheelchair backrest, a hearing aid, a head covering, a streak of colour: whatever `look` names is clearly visible. Put it in the sentence right after the prefix, with plain words ("clearly visible vitiligo: distinct pale patches at the left temple and around the left eye").
- [ ] **Apparent age within the range.** The face reads as the person's `new_age_range`, not older. Say the age outright ("looks about 46, youthful for her age") and describe grey as a style, not as age.
- [ ] **Renderer rules.** Prefix verbatim; lips closed; mouth, jaw and chin clear; eyes visible; one adult, square to camera (§2).
- [ ] **The set.** Charcoal seamless, the rim light in the person's accent (never on the face), even key light (§3).
- [ ] **Presence.** Relaxed and open, with warmth in the eyes: a colleague about to say something useful, not an ID photo (§5).

Re-checked on 28 September 2026 after the Inc 0.6 review: Paolo Bautista (vitiligo, grey temples), Nayra Choque (wheelchair), Amara Okafor, Esi Mensah and Jonas Brandt (apparent age) were regenerated with the detail moved up front.

### Casting rules `renames.json` satisfies

- 176 entries: 12 leads and 164 coworkers. Pronouns are unchanged (80 she/her, 77 he/him, 19 they/them) and all 144 heritages are kept.
- Every first name is unique, compared with accents stripped. None reuses a current first name, equals a voice id (all 51 in `taxonomy.voices`), or is Dana, Luis, Priya or Morgan. None is a PRODUCT.md story name (Juno, Marcus, Lena, Walt, Pax, Rosa, Kit, Bea, Sol, Otto, Wren, Hale). Look-alike first names were removed, so @mentions and speech recognition stay unambiguous.
- Each handle is the ASCII-folded, lowercased first name (`Joëlle` → `joelle`, `Óskar` → `oskar`), and all handles are unique.
- Ages: 32 in 24–29, 46 in 30–34, 42 in 35–39, 30 in 40–44 and 26 in 45–54 (14.8%). Under-30 and 45-plus shares are balanced across the pronoun groups.
- Look features are spread across pronoun groups. Glasses appear on about a third of each group. Dyed hair, piercings and tattoos are not concentrated on they/them people.
- Accents are unique within each department and reach at least 3:1 against the dark `--panel` (`#1A1D22`).
