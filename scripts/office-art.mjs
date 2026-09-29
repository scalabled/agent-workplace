#!/usr/bin/env node
// node scripts/office-art.mjs: generates the Office view's photographic backdrops and wall art through the running
// worker (POST /api/media/image; the worker holds the provider keys, this script never sees them), then writes
// optimized copies and a manifest to apps/web/public/office/ for @headcount/office (docs/dev/OFFICE-PLAN.md §1.3).
// This script owns apps/web/public/office/; the office engine only READS manifest.json, it never writes it.
//
// Assets (worker keys `office-<key>`; each one shows a fictional place with no text, logos, landmarks or people):
//   skyline-night · skyline-dusk · skyline-day   the city behind the floor plate's north window band (16:9)
//   conference-night · conference-dusk           the view through the Skyline room's far glass on the stage (16:9)
//   conference-garden                            the Garden room's living wall behind its table on the stage (16:9)
//   art-1 · art-2 · art-3                        abstract wall art, full-bleed and unframed (the office draws the frame) (1:1)
//
// Files per asset: <key>.webp (full: backdrops at native width, lanczos upscaled at most 1.25× to 1920; art 1024;
//   ≤ 450 KB) · <key>-<w>.webp (small: 1280 for 16:9, 512 for 1:1) · <key>.jpg (fallback) · a tiny LQIP data URI.
//
// manifest.json (paths are RELATIVE to the manifest, i.e. to the engine's assetsBase, default /office/):
//   { version: 1, note,
//     variants:   { night|dusk|day: Entry },    ← the floor skyline, as OFFICE-PLAN §1.3 specifies
//     conference: { night|dusk: Entry,          ← the Skyline room's stage backdrop by time of day
//                   garden: Entry },            ← the Garden room's stage backdrop (its living wall)
//     art:        Entry[] }                     ← square wall art
//   Entry: { key, kind, timeOfDay?, alt, files: [{file, type, width, height, bytes}], file, fallback,
//            srcset: [{width, file}], lqip, width, height, provider, model, generatedAt,
//            and for backdrops: horizon, glow, lights, beacons }
//   horizon (fraction of the height): for skylines the waterline at the base of the towers; for conference views the
//   distant horizon where the towers meet the sky · glow: mean colour of the band just above it (the window light) ·
//   lights: ≤ 60 lit windows {x, y, r, warm} (x, y fractions of the width and height; r a dot radius in CSS px, 1 or
//   1.5) for the CSS twinkle · beacons: ≤ 4 red roof lights {x, y}, night only. The day skyline and the garden wall
//   have no lights.
//
// Idempotent: an asset whose three files already exist is skipped unless --force, so a second run costs nothing.
// When its files exist but its manifest entry is missing, the entry is rebuilt from the local files (no generation).
// The manifest is merged, never replaced: it is re-read just before writing, only the processed entries change, and
// unknown fields and sections are kept.
//
// Budget: each generation counts against the worker's daily image limit (PORTRAIT_DAILY_LIMIT, shared with
// portraits). The script stops on 429 or 503, refuses to start more than --budget generations (default 8) in one
// run, and prints the images left today. One run at a time: a lock in the OS temp directory refuses an
// overlapping run (two runs would generate the same missing assets twice).
//
// Options: --worker <url> (default http://127.0.0.1:8787) · --only <key|alias>[,…] (keys above; aliases night, dusk,
//          day = skyline-*, skylines, conference, garden, art) · --force · --provider openai|xai (override the per-asset
//          choice; openai returns 1536 × 1024, xai 1280 × 720) · --note "<text>" (extra direction for a retry) ·
//          --reprocess (re-encode the stored originals, no generation) · --horizon night=0.69[,<key>=<0-1>]
//          (override the measured waterline) · --budget <n> · --concurrency <n> (default 3) · --dry-run · --list
// Needs ffmpeg, ffprobe and cwebp on the PATH (brew install ffmpeg webp). No npm dependencies.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'apps/web/public/office');
const manifestPath = join(outDir, 'manifest.json');
const MANIFEST_VERSION = 1;
const MANIFEST_NOTE =
  'Written only by scripts/office-art.mjs; the office engine reads it and never writes it. File paths are relative to this manifest (the engine assetsBase, default /office/). ' +
  'A fictional city: no text, logos, landmarks or people. Images are decorative (alt="" in the DOM); alt describes them for docs. ' +
  'lights: x, y are fractions of the width and height, r is a dot radius in CSS px.';

// ── art direction ──────────────────────────────────────────────────────────────────────────────────────────────
const NO_MARKS =
  'No real landmarks and no recognisable real city. Absolutely no text, letters, numbers, signs, logos, billboards, ' +
  'screens, watermarks or brand marks anywhere, no illuminated signs, LED strips or crown logos on any building, and no people.';

const SKYLINE_STYLE =
  'Wide cinematic photograph of a fictional modern city skyline seen from the 30th floor of an office tower across a wide river. ' +
  `${NO_MARKS} ` +
  'Horizon at 58% of the frame height; the lower 30% is dark water and embankment with reflections; a long low bridge with a row of small lights crosses the river toward one side. ' +
  'Mid-rise and tall modern towers of varied heights spread evenly across the full width, no single dominant tower in the centre, similar density at the left and right edges so the image can be cropped anywhere; ' +
  'the top 30% is open sky with no birds or aircraft. Calm, premium, true-to-life colour, fine detail, slight atmospheric haze, level camera with no tilt, ' +
  'no window frames, no glass reflections, no interior.';

const CONFERENCE_STYLE =
  'Wide cinematic photograph looking straight out through the floor-to-ceiling glass of a high-floor meeting room at a fictional modern city: ' +
  'closer and larger than a distant panorama, towers fill the middle band from edge to edge, the nearest buildings slightly out of focus and distant lit windows melting into soft bokeh ' +
  '(shallow depth of field, focus on the middle distance). The upper quarter is sky; the lower third is darker rooftops and the street canyon far below, fading toward black. ' +
  `${NO_MARKS} No furniture, no table, no window frames or mullions, no reflections, no interior. Calm, premium, restrained contrast, true-to-life colour, slight haze.`;

const GARDEN_STYLE =
  'Wide cinematic interior photograph, straight-on and level, of a softly focused living wall filling the frame edge to edge in a dim office meeting room at night: ' +
  'dense layered ferns, cushion moss and trailing leaves in deep greens with a few fresh lime highlights, framed at the far left and right edges by thin vertical walnut slats; ' +
  'warm pendant light from above grazes the top of the wall and falls off softly into shadow toward the bottom; shallow depth of field, calm, premium, restrained contrast, true-to-life colour. ' +
  'No people, no furniture, no table, no window, no sky, no text, letters, numbers, signs, logos, screens or brand marks.';

const ART_STYLE =
  'A square piece of contemporary abstract fine art, photographed perfectly flat and straight-on so the artwork fills the entire canvas edge to edge: ' +
  'no frame, no mat, no wall, no border, no shadow, no room. Muted, low-saturation colours on a deep warm charcoal ground so it sits quietly on a dark office wall; ' +
  'subtle paper grain, calm, sophisticated, gallery quality, generous negative space. ' +
  'Absolutely no text, letters, numbers, signatures, monograms, logos, symbols, faces, figures or recognisable objects.';

const NIGHT =
  'Deep blue-black night. Thousands of small warm and cool lit office windows, sparse enough to read as individual points; a few red aviation lights on the tallest roofs; ' +
  'a soft city glow on the horizon; still dark water with long light reflections. Rich blacks, restrained contrast, no neon, no moon in frame.';
const DUSK =
  'Blue hour, twenty minutes after sunset: a soft amber-to-violet band low in the sky fading to deep blue above; towers mostly silhouetted with the first office windows lit; ' +
  'calm water reflecting the gradient. Muted, elegant, not saturated.';
const DAY =
  'Overcast late morning, soft diffuse daylight, muted blue-grey sky with gentle cloud texture, towers in cool greys and glass, low contrast, desaturated, calm. ' +
  'It will be shown darkened behind a dark interface, so avoid bright white areas and harsh sun.';

/** The nine assets. openai (gpt-image-2) is the default: its 16:9 source is 1536 × 1024 against xai's 1280 × 720. */
export const SPECS = [
  {
    key: 'skyline-night', kind: 'skyline', timeOfDay: 'night', aspect: '16:9', provider: 'openai', style: SKYLINE_STYLE, prompt: NIGHT,
    alt: 'A fictional modern city at night seen from a high office floor across a dark river: towers with scattered warm and cool lit windows, a few red roof beacons, a lit bridge and long reflections on the water.',
  },
  {
    key: 'skyline-dusk', kind: 'skyline', timeOfDay: 'dusk', aspect: '16:9', provider: 'openai', style: SKYLINE_STYLE, prompt: DUSK,
    alt: 'A fictional modern city at blue hour seen from a high office floor across a river: silhouetted towers with the first windows lit under a low amber-to-violet band of sky.',
  },
  {
    key: 'skyline-day', kind: 'skyline', timeOfDay: 'day', aspect: '16:9', provider: 'openai', style: SKYLINE_STYLE, prompt: DAY,
    alt: 'A fictional modern city on an overcast morning seen from a high office floor across a river: grey glass towers under a soft blue-grey sky.',
  },
  {
    key: 'conference-night', kind: 'conference', timeOfDay: 'night', aspect: '16:9', provider: 'openai', style: CONFERENCE_STYLE,
    prompt: 'Deep blue-black night: thousands of warm and cool lit office windows, a few red aviation lights on the tallest roofs, a soft city glow on the horizon. Rich blacks, no neon, no moon.',
    alt: 'A close, softly focused view of a fictional city at night through a meeting room window: lit office towers melting into warm and cool bokeh.',
  },
  {
    key: 'conference-dusk', kind: 'conference', timeOfDay: 'dusk', aspect: '16:9', provider: 'openai', style: CONFERENCE_STYLE,
    prompt: 'Blue hour just after sunset: a soft amber-to-violet band low in the sky fading to deep blue above, towers mostly silhouetted with the first windows lit. Muted and elegant, not saturated.',
    alt: 'A close, softly focused view of a fictional city at blue hour through a meeting room window: silhouetted towers with the first lit windows under an amber-to-violet sky.',
  },
  {
    key: 'conference-garden', kind: 'conference', slot: 'garden', view: 'garden', aspect: '16:9', provider: 'openai', style: GARDEN_STYLE,
    prompt: 'A softly focused living wall of moss and ferns in a dim office meeting room at night, a walnut slat frame, warm pendant light from above. No people, text or logos.',
    alt: 'A softly focused living wall of moss and ferns in a dim meeting room at night, framed by walnut slats and lit from above by a warm pendant.',
  },
  {
    key: 'art-1', kind: 'art', aspect: '1:1', provider: 'openai', style: ART_STYLE,
    prompt: 'Geometric abstraction in the manner of a mid-century screenprint: a few overlapping circles and half-circles with softly printed edges in muted honey amber, dusty terracotta and deep teal, balanced asymmetrically with one small sage dot.',
    alt: 'Abstract print: overlapping circles and half-circles in muted amber, terracotta and deep teal on charcoal.',
  },
  {
    key: 'art-2', kind: 'art', aspect: '1:1', provider: 'openai', style: ART_STYLE,
    prompt: 'Colour-field painting: three large soft-edged rectangles stacked vertically, deep indigo, dusty slate blue and a narrow band of glowing warm amber near the lower third, built from thin translucent layers so the edges breathe.',
    alt: 'Abstract colour-field painting: soft-edged bands of indigo, slate blue and a narrow amber glow on charcoal.',
  },
  {
    key: 'art-3', kind: 'art', aspect: '1:1', provider: 'openai', style: ART_STYLE,
    prompt: 'Quiet constructivist composition: thin vertical bars, one large thin arc and a few small rectangles in a muted spectrum of teal, soft violet, dusty rose, amber and sage, precisely spaced like an architectural rhythm; flat inks with fine risograph grain.',
    alt: 'Abstract composition: thin vertical bars, an arc and small rectangles in muted teal, violet, rose, amber and sage on charcoal.',
  },
];

const ALIASES = {
  night: ['skyline-night'],
  dusk: ['skyline-dusk'],
  day: ['skyline-day'],
  skylines: ['skyline-night', 'skyline-dusk', 'skyline-day'],
  conference: ['conference-night', 'conference-dusk', 'conference-garden'],
  garden: ['conference-garden'],
  art: ['art-1', 'art-2', 'art-3'],
};

const TARGET = {
  '16:9': { ratio: 16 / 9, maxW: 1920, small: 1280, lqip: [32, 18] },
  '1:1': { ratio: 1, maxW: 1024, small: 512, lqip: [16, 16] },
};
const MAX_UPSCALE = 1.25;
const WEBP_QUALITY = 72;
const WEBP_MAX_BYTES = 450 * 1024;
const JPEG_MAX_BYTES = 600 * 1024;
const ANALYSIS_WIDTH = 640;

// ── arguments ──────────────────────────────────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const has = (name) => args.includes(name);
const values = (name) =>
  args
    .flatMap((a, i) => (a === name && args[i + 1] !== undefined && !args[i + 1].startsWith('--') ? [args[i + 1]] : a.startsWith(`${name}=`) ? [a.slice(name.length + 1)] : []))
    .map((s) => s.trim())
    .filter(Boolean);
const keyOf = (name) => (ALIASES[name] ? ALIASES[name] : SPECS.some((s) => s.key === name) ? [name] : null);

if (has('--help') || has('-h')) {
  console.log(`Usage: node scripts/office-art.mjs [--only <key|alias>,…] [--force] [--provider openai|xai] [--note "<text>"] [--reprocess] [--horizon night=0.69] [--budget <n>] [--concurrency <n>] [--dry-run] [--list] [--worker <url>]
Keys: ${SPECS.map((s) => s.key).join(', ')}
Aliases: ${Object.keys(ALIASES).join(', ')}`);
  process.exit(0);
}
if (has('--list')) {
  for (const s of SPECS) console.log(`${s.key.padEnd(17)} ${s.aspect.padEnd(5)} ${s.provider.padEnd(7)} ${s.alt}`);
  process.exit(0);
}

const worker = (values('--worker')[0] ?? 'http://127.0.0.1:8787').replace(/\/+$/, '');
const onlyNames = values('--only').flatMap((v) => v.split(',')).map((s) => s.trim()).filter(Boolean);
const force = has('--force');
const reprocess = has('--reprocess');
const dryRun = has('--dry-run');
const providerOverride = values('--provider')[0];
const note = values('--note')[0] ?? '';
const concurrency = Number(values('--concurrency')[0] ?? 3);
const budget = Number(values('--budget')[0] ?? 8);
if (providerOverride && !['openai', 'xai'].includes(providerOverride)) {
  console.error('--provider must be openai or xai.');
  process.exit(1);
}
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) {
  console.error('--concurrency must be a whole number from 1 to 8.');
  process.exit(1);
}
if (!Number.isInteger(budget) || budget < 0) {
  console.error('--budget must be a whole number of generations.');
  process.exit(1);
}
const unknown = onlyNames.filter((n) => !keyOf(n));
if (unknown.length) {
  console.error(`Unknown key ${unknown.join(', ')}. Keys: ${SPECS.map((s) => s.key).join(', ')}; aliases: ${Object.keys(ALIASES).join(', ')}`);
  process.exit(1);
}
const horizonOverride = {};
for (const pair of values('--horizon').flatMap((v) => v.split(','))) {
  const [name, raw] = pair.split('=').map((s) => s?.trim());
  const keys = name ? keyOf(name) : null;
  const value = Number(raw);
  if (!keys || !(value > 0 && value < 1)) {
    console.error(`--horizon takes <key>=<fraction>, for example night=0.69 (got "${pair}").`);
    process.exit(1);
  }
  for (const k of keys) horizonOverride[k] = value;
}

const only = new Set(onlyNames.flatMap(keyOf));
const workerKey = (spec) => `office-${spec.key}`;
const promptFor = (spec) => [spec.prompt, note, spec.style].filter(Boolean).join(' ');
const selected = SPECS.filter((s) => !only.size || only.has(s.key));
for (const spec of selected) {
  const length = promptFor(spec).length;
  if (length > 1500) {
    console.error(`The ${spec.key} prompt is ${length} characters; the worker takes at most 1500. Shorten it or the note.`);
    process.exit(1);
  }
}
if (dryRun) {
  for (const spec of selected) console.log(`── ${spec.key} → ${workerKey(spec)} (${spec.aspect}, ${providerOverride ?? spec.provider}, ${promptFor(spec).length} chars)\n${promptFor(spec)}\n`);
  process.exit(0);
}

for (const tool of ['ffmpeg', 'ffprobe', 'cwebp']) {
  if (spawnSync(tool, ['-version'], { stdio: 'ignore' }).error) {
    console.error(`${tool} is not on the PATH (brew install ffmpeg webp).`);
    process.exit(1);
  }
}

// ── image helpers ──────────────────────────────────────────────────────────────────────────────────────────────
function run(cmd, argv) {
  const r = spawnSync(cmd, argv, { maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`${cmd} failed: ${String(r.stderr || r.stdout || '').trim().split('\n').slice(-3).join(' ')}`);
  return r.stdout;
}

function dimensions(file) {
  const out = String(run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', file])).trim();
  const [w, h] = out.split('x').map(Number);
  return { w, h };
}

const even = (n) => n - (n % 2);
const round = (n, d = 4) => Math.round(n * 10 ** d) / 10 ** d;
const hex = (r, g, b) => `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;

/** The centered crop of `src` at the spec's aspect. */
function cropFor(src, spec) {
  const { ratio } = TARGET[spec.aspect];
  let cw = src.w;
  let ch = Math.round(cw / ratio);
  if (ch > src.h) {
    ch = src.h;
    cw = Math.round(ch * ratio);
  }
  return { w: cw, h: ch };
}

/** A lossless master at `width` from the centered crop. */
function master(source, spec, work, crop, width) {
  const w = even(width);
  const h = even(Math.round(w / TARGET[spec.aspect].ratio));
  const out = join(work, `${spec.key}-${w}.png`);
  run('ffmpeg', ['-y', '-v', 'error', '-i', source, '-vf', `crop=${crop.w}:${crop.h}:(iw-${crop.w})/2:(ih-${crop.h})/2,scale=${w}:${h}:flags=lanczos`, '-frames:v', '1', out]);
  return { file: out, width: w, height: h };
}

function webpAt(png, out, maxBytes) {
  let quality = WEBP_QUALITY;
  let bytes = Infinity;
  while (quality >= 50) {
    run('cwebp', ['-quiet', '-q', String(quality), '-m', '6', '-sharp_yuv', '-metadata', 'none', png, '-o', out]);
    bytes = statSync(out).size;
    if (bytes <= maxBytes) break;
    quality -= 6;
  }
  return { bytes, quality };
}

function jpegAt(png, out) {
  let q = 3;
  let bytes = Infinity;
  while (q <= 10) {
    run('ffmpeg', ['-y', '-v', 'error', '-i', png, '-q:v', String(q), '-pix_fmt', 'yuvj420p', '-map_metadata', '-1', out]);
    bytes = statSync(out).size;
    if (bytes <= JPEG_MAX_BYTES) break;
    q++;
  }
  return { bytes, q };
}

function lqip(image, spec, work) {
  const [w, h] = TARGET[spec.aspect].lqip;
  const small = join(work, `${spec.key}-lqip.png`);
  const out = join(work, `${spec.key}-lqip.webp`);
  run('ffmpeg', ['-y', '-v', 'error', '-i', image, '-vf', `scale=${w}:${h}:flags=area`, '-frames:v', '1', small]);
  run('cwebp', ['-quiet', '-q', '50', '-metadata', 'none', small, '-o', out]);
  return `data:image/webp;base64,${readFileSync(out).toString('base64')}`;
}

/** RGB bytes of the image scaled to `w` × `h` (area filter). */
function pixels(image, w, h) {
  return run('ffmpeg', ['-v', 'error', '-i', image, '-vf', `scale=${w}:${h}:flags=area`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
}

/** Hue in degrees (0–360) and HSV saturation (0–1) of an RGB triple. */
function hueSat(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (!d) return { hue: 0, sat: 0 };
  let hue;
  if (max === r) hue = 60 * (((g - b) / d) % 6);
  else if (max === g) hue = 60 * ((b - r) / d + 2);
  else hue = 60 * ((r - g) / d + 4);
  return { hue: (hue + 360) % 360, sat: d / max };
}

/**
 * Backdrop analysis on a 640 px copy (OFFICE-PLAN §1.3).
 * - horizon: the waterline, i.e. the dark shore band between the lit city and its reflections: the most prominent
 *   valley of the smoothed row luminance in 45–88 % of the height; without a clear valley, the strongest step.
 * - glow: the mean colour of the band just above the horizon.
 * - lights: isolated bright local maxima above the horizon (L > 0.75 with a 9 × 9 mean < 0.35, relaxed for dim
 *   images), ≤ 400 candidates by contrast, thinned by a Poisson disc of 1.2 % of the width to ≤ 60.
 * - beacons: small saturated red (hue < 22° or > 345°) maxima well above the waterline with darker sky above,
 *   ≤ 4 and 4 % of the width apart. Sodium street lamps (orange) and the shore are excluded.
 */
function analyze(image, spec, width, height, override) {
  const W = ANALYSIS_WIDTH;
  const H = even(Math.round((W * height) / width));
  const rgb = pixels(image, W, H);
  const L = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) L[i] = (0.2126 * rgb[i * 3] + 0.7152 * rgb[i * 3 + 1] + 0.0722 * rgb[i * 3 + 2]) / 255;

  const rows = new Float64Array(H);
  for (let y = 0; y < H; y++) {
    let s = 0;
    for (let x = 0; x < W; x++) s += L[y * W + x];
    rows[y] = s / W;
  }
  const r5 = Math.max(2, Math.round(H * 0.012));
  const smooth = Array.from(rows, (_, y) => {
    let s = 0;
    let n = 0;
    for (let k = -r5; k <= r5; k++) if (y + k >= 0 && y + k < H) (s += rows[y + k]), n++;
    return s / n;
  });
  // Skyline: the waterline is the darkest clear valley (prominence ≥ 0.02 within ±6 % of the height) in 45–88 %.
  // Conference (no water): the distant horizon, taken as the brightest band of city glow in 12–70 % (right at night;
  // at dusk the bright sky sits above it, so the dusk view carries a manual --horizon).
  const strongestStep = (from, to) => {
    const k = Math.max(3, Math.round(H * 0.017));
    let best = -1;
    let at = Math.round(H * 0.6);
    for (let y = from; y <= to; y++) {
      const step = Math.abs(smooth[Math.max(0, y - k)] - smooth[Math.min(H - 1, y + k)]);
      if (step > best) (best = step), (at = y);
    }
    return at;
  };
  let horizonY;
  if (spec.kind === 'conference') {
    horizonY = Math.round(H * 0.12);
    for (let y = horizonY; y <= Math.round(H * 0.7); y++) if (smooth[y] > smooth[horizonY]) horizonY = y;
  }
  else {
    const reach = Math.round(H * 0.06);
    let valleyY = -1;
    for (let y = Math.round(H * 0.45); y <= Math.round(H * 0.88); y++) {
      const v = smooth[y];
      let left = 0;
      let right = 0;
      let isMin = true;
      for (let k = 1; k <= reach; k++) {
        if (y - k >= 0) left = Math.max(left, smooth[y - k]);
        if (y + k < H) right = Math.max(right, smooth[y + k]);
        if (k <= r5 && ((y - k >= 0 && smooth[y - k] < v) || (y + k < H && smooth[y + k] < v))) isMin = false;
      }
      if (isMin && Math.min(left, right) - v >= 0.02 && (valleyY < 0 || v < smooth[valleyY])) valleyY = y;
    }
    horizonY = valleyY >= 0 ? valleyY : strongestStep(Math.round(H * 0.45), Math.round(H * 0.88));
  }
  if (override) horizonY = Math.round(override * H);

  const band = Math.max(2, Math.round(H * 0.06));
  let gr = 0;
  let gg = 0;
  let gb = 0;
  let gn = 0;
  for (let y = Math.max(0, horizonY - band); y < horizonY; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      gr += rgb[i];
      gg += rgb[i + 1];
      gb += rgb[i + 2];
      gn++;
    }
  }
  const result = { horizon: round(horizonY / H, 3), glow: gn ? hex(gr / gn, gg / gn, gb / gn) : '#10141a', lights: [], beacons: [] };
  if (spec.timeOfDay === 'day' || spec.view === 'garden') return result;

  // Summed-area table for neighbourhood means.
  const S = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let rowSum = 0;
    for (let x = 0; x < W; x++) {
      rowSum += L[y * W + x];
      S[(y + 1) * (W + 1) + x + 1] = S[y * (W + 1) + x + 1] + rowSum;
    }
  }
  const boxMean = (x0, y0, x1, y1) => {
    x0 = Math.max(0, x0);
    y0 = Math.max(0, y0);
    x1 = Math.min(W, x1);
    y1 = Math.min(H, y1);
    if (x1 <= x0 || y1 <= y0) return 0;
    return (S[y1 * (W + 1) + x1] - S[y0 * (W + 1) + x1] - S[y1 * (W + 1) + x0] + S[y0 * (W + 1) + x0]) / ((x1 - x0) * (y1 - y0));
  };
  const mean9 = (x, y) => boxMean(x - 4, y - 4, x + 5, y + 5);
  const isPeak = (arr, x, y) => {
    const v = arr[y * W + x];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && arr[(y + dy) * W + x + dx] > v) return false;
    return true;
  };
  const yTop = 2;
  const yBottom = spec.kind === 'conference' ? Math.round(H * 0.95) : Math.max(yTop + 1, horizonY - Math.round(H * 0.015));

  // Red aviation beacons, on a finer 1280 px grid (the dots average away at 640 px): saturated red maxima (hue < 20°
  // or > 340°, which excludes orange sodium lamps and warm windows) at least 10 % of the height above the waterline,
  // with dark sky just above them (a roof edge). The highest win, 4 % of the width apart.
  const BW = Math.min(1280, even(width));
  const BH = even(Math.round((BW * height) / width));
  const brgb = BW === W ? rgb : pixels(image, BW, BH);
  const score = new Float32Array(BW * BH);
  const bl = new Float32Array(BW * BH);
  for (let i = 0; i < BW * BH; i++) {
    const r = brgb[i * 3];
    const g = brgb[i * 3 + 1];
    const b = brgb[i * 3 + 2];
    bl[i] = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    const { hue, sat } = hueSat(r, g, b);
    score[i] = r > 100 && sat > 0.33 && (hue < 20 || hue > 340) ? (r / 255) * sat : 0;
  }
  const bMean = (x0, y0, x1, y1) => {
    let s = 0;
    let n = 0;
    for (let y = Math.max(0, y0); y < Math.min(BH, y1); y++) for (let x = Math.max(0, x0); x < Math.min(BW, x1); x++) (s += bl[y * BW + x]), n++;
    return n ? s / n : 1;
  };
  // Night only (OFFICE-PLAN §1.3): at dusk, warm windows against the orange sky read as red.
  const beaconFloor = spec.timeOfDay !== 'night' ? 0 : spec.kind === 'conference' ? Math.round(BH * 0.9) : Math.round(((horizonY - H * 0.1) / H) * BH);
  const beaconCands = [];
  for (let y = 12; y < beaconFloor; y++) {
    for (let x = 2; x < BW - 2; x++) {
      const v = score[y * BW + x];
      if (!v) continue;
      let peak = true;
      for (let dy = -2; dy <= 2 && peak; dy++) for (let dx = -2; dx <= 2; dx++) if ((dx || dy) && score[(y + dy) * BW + x + dx] > v) (peak = false);
      if (!peak) continue;
      if (bMean(x - 3, y - 10, x + 4, y - 4) > 0.18) continue;
      beaconCands.push({ x, y, v });
    }
  }
  beaconCands.sort((a, b) => a.y - b.y || b.v - a.v);
  const beacons = [];
  for (const c of beaconCands) {
    if (beacons.length >= 4) break;
    if (beacons.every((b) => Math.abs(b.x - c.x) >= BW * 0.04)) beacons.push(c);
  }
  const beaconAt = beacons.map((b) => ({ x: ((b.x + 0.5) / BW) * W, y: ((b.y + 0.5) / BH) * H, bx: (b.x + 0.5) / BW, by: (b.y + 0.5) / BH }));

  // Twinkle lights, relaxing the threshold when a dim image has too few.
  let cands = [];
  for (const threshold of [0.75, 0.62, 0.5]) {
    cands = [];
    for (let y = yTop; y < yBottom; y++) {
      for (let x = 2; x < W - 2; x++) {
        const v = L[y * W + x];
        if (v < threshold || !isPeak(L, x, y)) continue;
        const m = mean9(x, y);
        if (m >= 0.35) continue;
        if (beaconAt.some((b) => Math.hypot(b.x - x, b.y - y) < 3)) continue;
        cands.push({ x, y, v, contrast: v - m });
      }
    }
    if (cands.length >= 40) break;
  }
  cands.sort((a, b) => b.contrast - a.contrast);
  cands = cands.slice(0, 400);
  const minDist = W * 0.012;
  const kept = [];
  for (const c of cands) {
    if (kept.length >= 60) break;
    if (kept.every((l) => Math.hypot(l.x - c.x, l.y - c.y) >= minDist)) kept.push(c);
  }
  result.lights = kept
    .map((c) => {
      const i = (c.y * W + c.x) * 3;
      return { x: round((c.x + 0.5) / W), y: round((c.y + 0.5) / H), r: c.v > 0.9 ? 1.5 : 1, warm: rgb[i] >= rgb[i + 2] };
    })
    .sort((a, b) => a.x - b.x);
  result.beacons = beaconAt.map((b) => ({ x: round(b.bx), y: round(b.by) })).sort((a, b) => a.x - b.x);
  return result;
}

const fileNames = (spec) => ({ full: `${spec.key}.webp`, small: `${spec.key}-${TARGET[spec.aspect].small}.webp`, jpg: `${spec.key}.jpg` });
const filesExist = (spec) => Object.values(fileNames(spec)).every((f) => existsSync(join(outDir, f)));

/** Encode the full and small WebP, the JPEG fallback and the LQIP from a generated source; analyze backdrops. */
function optimize(source, spec, work, regenerated) {
  const t = TARGET[spec.aspect];
  const src = dimensions(source);
  const crop = cropFor(src, spec);
  const fullW = even(Math.min(t.maxW, Math.round(crop.w * MAX_UPSCALE)));
  const smallW = Math.min(t.small, fullW);
  const names = fileNames(spec);
  const full = master(source, spec, work, crop, fullW);
  const small = master(source, spec, work, crop, smallW);
  const jpg = jpegAt(full.file, join(outDir, names.jpg));
  const webp = webpAt(full.file, join(outDir, names.full), Math.min(WEBP_MAX_BYTES, jpg.bytes));
  const webpSmall = webpAt(small.file, join(outDir, names.small), WEBP_MAX_BYTES);
  return {
    source: src,
    quality: { webp: webp.quality, jpg: jpg.q },
    ...describe(spec, work, full.file, { full: { ...full, bytes: webp.bytes }, small: { ...small, bytes: webpSmall.bytes }, jpg: { ...full, bytes: jpg.bytes } }, regenerated),
  };
}

/**
 * A manual horizon: this run's --horizon, else one set by an earlier --horizon (horizonSource "manual" in the
 * manifest), which is kept until the image is regenerated.
 */
function horizonFor(spec, regenerated) {
  if (horizonOverride[spec.key] !== undefined) return horizonOverride[spec.key];
  const prev = existing.get(spec.key);
  return !regenerated && prev?.horizonSource === 'manual' && typeof prev.horizon === 'number' ? prev.horizon : undefined;
}

/** The manifest fields for an asset from its encoded files (`analysisImage` is a full-size copy). */
function describe(spec, work, analysisImage, enc, regenerated = false) {
  const names = fileNames(spec);
  const manual = horizonFor(spec, regenerated);
  const analysis = spec.kind === 'art' ? null : { ...analyze(analysisImage, spec, enc.full.width, enc.full.height, manual), horizonSource: manual === undefined ? 'measured' : 'manual' };
  return {
    width: enc.full.width,
    height: enc.full.height,
    files: [
      { file: names.full, type: 'image/webp', width: enc.full.width, height: enc.full.height, bytes: enc.full.bytes },
      { file: names.small, type: 'image/webp', width: enc.small.width, height: enc.small.height, bytes: enc.small.bytes },
      { file: names.jpg, type: 'image/jpeg', width: enc.jpg.width, height: enc.jpg.height, bytes: enc.jpg.bytes },
    ],
    file: names.full,
    fallback: names.jpg,
    srcset: [
      { width: enc.small.width, file: names.small },
      { width: enc.full.width, file: names.full },
    ].filter((s, i, all) => all.findIndex((o) => o.width === s.width) === i),
    lqip: lqip(analysisImage, spec, work),
    analysis,
  };
}

/** Rebuild an entry from files already on disk (no generation, no worker). */
function reindex(spec, work) {
  const names = fileNames(spec);
  const info = (f) => ({ ...dimensions(join(outDir, f)), bytes: statSync(join(outDir, f)).size });
  const full = info(names.full);
  const small = info(names.small);
  const jpg = info(names.jpg);
  const d = describe(spec, work, join(outDir, names.jpg), {
    full: { width: full.w, height: full.h, bytes: full.bytes },
    small: { width: small.w, height: small.h, bytes: small.bytes },
    jpg: { width: jpg.w, height: jpg.h, bytes: jpg.bytes },
  });
  return { source: { w: full.w, h: full.h }, quality: { webp: '?', jpg: '?' }, ...d };
}

// ── manifest (merge, never replace) ────────────────────────────────────────────────────────────────────────────
function readManifestRaw() {
  try {
    const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
    return m && typeof m === 'object' && !Array.isArray(m) ? m : {};
  } catch {
    return {};
  }
}

/** Existing entries by asset key, from either this script's shape or the earlier skyline-only shape. */
function entriesOf(m) {
  const map = new Map();
  for (const [tod, e] of Object.entries(m.variants ?? {})) if (e && typeof e === 'object') map.set(e.key ?? `skyline-${tod}`, e);
  for (const [slot, e] of Object.entries(m.conference ?? {})) if (e && typeof e === 'object') map.set(e.key ?? `conference-${slot}`, e);
  for (const e of Array.isArray(m.art) ? m.art : []) if (e?.key) map.set(e.key, e);
  return map;
}

/** Re-read the manifest, merge the updated entries into it (keeping unknown fields and sections) and write it atomically. */
function mergeManifest(updates) {
  const current = readManifestRaw();
  const entries = entriesOf(current);
  // An unknown value (null: e.g. provenance a local rebuild cannot recover) never overwrites a known one.
  const known = (entry) => Object.fromEntries(Object.entries(entry).filter(([, v]) => v !== null && v !== undefined));
  for (const [key, entry] of updates) entries.set(key, { ...(entries.get(key) ?? {}), ...known(entry) });
  const order = new Map(SPECS.map((s, i) => [s.key, i]));
  const kindOf = (key, e) => e.kind ?? SPECS.find((s) => s.key === key)?.kind;
  const todOf = (key, e) => e.timeOfDay ?? SPECS.find((s) => s.key === key)?.timeOfDay;
  // The conference section is keyed by time of day for the Skyline room and by room for the Garden room.
  const slotOf = (key, e) => e.slot ?? SPECS.find((s) => s.key === key)?.slot ?? todOf(key, e);
  const sorted = [...entries.entries()].sort((a, b) => (order.get(a[0]) ?? 99) - (order.get(b[0]) ?? 99));
  const next = {
    ...current,
    version: MANIFEST_VERSION,
    note: MANIFEST_NOTE,
    variants: { ...(current.variants ?? {}) },
    conference: { ...(current.conference ?? {}) },
    art: [],
  };
  for (const [key, e] of sorted) {
    const kind = kindOf(key, e);
    if (kind === 'skyline') next.variants[todOf(key, e)] = e;
    else if (kind === 'conference') next.conference[slotOf(key, e)] = e;
    else if (kind === 'art') next.art.push(e);
  }
  // Stable section order: night, dusk, day.
  const SLOT_ORDER = ['night', 'dusk', 'day', 'garden'];
  const byTod = (obj) => Object.fromEntries(Object.entries(obj).sort((a, b) => SLOT_ORDER.indexOf(a[0]) - SLOT_ORDER.indexOf(b[0])));
  next.variants = byTod(next.variants);
  next.conference = byTod(next.conference);
  const tmp = `${manifestPath}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`);
  renameSync(tmp, manifestPath);
  return sorted.length;
}

// ── go ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// One run at a time: two overlapping runs would both generate the same missing assets (spending the budget twice)
// and overwrite each other's files. A lock left by a run that died is taken over.
const lockPath = join(tmpdir(), 'headcount-office-art.lock');
function takeLock() {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
      process.on('exit', () => {
        try {
          if (readFileSync(lockPath, 'utf8') === String(process.pid)) rmSync(lockPath, { force: true });
        } catch {
          /* already gone */
        }
      });
      return;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      const pid = Number(readFileSync(lockPath, 'utf8'));
      let alive = false;
      try {
        alive = Number.isInteger(pid) && pid > 0 && process.kill(pid, 0);
      } catch (e) {
        alive = e.code === 'EPERM';
      }
      if (alive) {
        console.error(`Another office-art run (pid ${pid}) is in progress. Wait for it to finish, then run this again.`);
        process.exit(1);
      }
      rmSync(lockPath, { force: true });
    }
  }
  console.error(`Could not take the run lock at ${lockPath}.`);
  process.exit(1);
}
takeLock();
mkdirSync(outDir, { recursive: true });
const work = mkdtempSync(join(tmpdir(), 'headcount-office-art-'));
const existing = entriesOf(readManifestRaw());
const updates = new Map();

const entryFor = (spec, o, meta) => ({
  key: spec.key,
  kind: spec.kind,
  ...(spec.timeOfDay ? { timeOfDay: spec.timeOfDay } : {}),
  ...(spec.slot ? { slot: spec.slot } : {}),
  ...(spec.view ? { view: spec.view } : {}),
  alt: spec.alt,
  files: o.files,
  file: o.file,
  fallback: o.fallback,
  srcset: o.srcset,
  lqip: o.lqip,
  width: o.width,
  height: o.height,
  ...(o.analysis ?? {}),
  provider: meta.provider ?? null,
  model: meta.model ?? null,
  generatedAt: meta.generatedAt ?? null,
});

// 1. Idempotency: files on disk mean the asset is done. Rebuild a missing entry locally; skip the rest.
const todo = [];
let skipped = 0;
for (const spec of selected) {
  if (force || reprocess || !filesExist(spec)) {
    todo.push(spec);
    continue;
  }
  const prev = existing.get(spec.key);
  const needsEntry = !prev || !prev.files || (prev.kind !== 'art' && prev.horizon === undefined);
  const horizonChanged = horizonOverride[spec.key] !== undefined && prev?.horizon !== round(horizonOverride[spec.key], 3);
  if (needsEntry || horizonChanged) {
    const o = reindex(spec, work);
    updates.set(spec.key, entryFor(spec, o, { provider: prev?.provider, model: prev?.model, generatedAt: prev?.generatedAt }));
    console.log(`${spec.key.padEnd(17)} files exist; ${needsEntry ? 'rebuilt its manifest entry' : 'updated its horizon'} locally (no generation)`);
  } else skipped++;
}
if (skipped) console.log(`${skipped} asset${skipped === 1 ? '' : 's'} already exist (use --force to regenerate, --reprocess to re-encode).`);
if (!todo.length) {
  if (updates.size) console.log(`Manifest: ${mergeManifest(updates)} assets in ${manifestPath.slice(root.length + 1)}`);
  rmSync(work, { recursive: true, force: true });
  process.exit(0);
}
if (!reprocess && todo.length > budget) {
  console.error(`Refusing to generate ${todo.length} images; this run's budget is ${budget} (--budget <n> to raise it).`);
  rmSync(work, { recursive: true, force: true });
  process.exit(1);
}

try {
  const res = await fetch(`${worker}/api/capabilities`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`capabilities ${res.status}`);
  const caps = await res.json();
  if (!reprocess && !caps.modalities?.image?.available) {
    const keys = caps.modalities?.image?.missingKeys ?? [];
    console.error(`Images need a provider. Add ${keys.length ? keys.join(' or ') : 'OPENAI_API_KEY or XAI_API_KEY'} to apps/worker/.dev.vars, then restart pnpm dev. The office uses its vector skyline until then.`);
    process.exit(1);
  }
} catch (err) {
  console.error(`The worker is not reachable at ${worker} (${err.message}). Start it with pnpm dev. The office uses its vector skyline until then.`);
  process.exit(1);
}

let stopped = null;
let failed = 0;
let generated = 0;
let remainingToday;
async function one(spec) {
  const provider = providerOverride ?? spec.provider;
  const started = Date.now();
  const key = workerKey(spec);
  let meta;
  if (reprocess) {
    const head = await fetch(`${worker}/api/media/${key}`, { method: 'HEAD' });
    if (!head.ok) throw new Error(`no stored original (${head.status}); generate it first`);
    const prev = existing.get(spec.key);
    meta = { url: `/api/media/${key}`, provider: prev?.provider ?? null, model: prev?.model ?? null, generatedAt: prev?.generatedAt ?? null };
    // Stored originals do not carry their provider; infer it from the source size when the manifest lost it.
    const version = head.headers.get('x-media-version') ?? '';
    const stamp = parseInt(version.split('-')[0], 36);
    if (!meta.generatedAt && Number.isFinite(stamp) && stamp > 1.6e12) meta.generatedAt = new Date(stamp).toISOString();
    meta.inferProvider = !meta.provider;
  } else {
    const res = await fetch(`${worker}/api/media/image`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key, aspect: spec.aspect, provider, prompt: promptFor(spec) }),
      signal: AbortSignal.timeout(300_000),
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 429 || res.status === 503) {
      stopped ??= body.error?.message ?? `the worker answered ${res.status}`;
      throw new Error(stopped);
    }
    if (!res.ok) throw new Error(body.error?.message ?? `the worker answered ${res.status}`);
    generated++;
    meta = { ...body, generatedAt: new Date().toISOString() };
    if (typeof body.remainingToday === 'number') remainingToday = Math.min(remainingToday ?? Infinity, body.remainingToday);
  }
  const img = await fetch(`${worker}${meta.url}`);
  if (!img.ok) throw new Error(`GET ${meta.url} answered ${img.status}`);
  const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[img.headers.get('content-type')] ?? 'bin';
  const source = join(work, `${spec.key}-source.${ext}`);
  writeFileSync(source, Buffer.from(await img.arrayBuffer()));
  const o = optimize(source, spec, work, !reprocess);
  if (meta.inferProvider) {
    const openai = (o.source.w === 1536 && o.source.h === 1024) || (o.source.w === 1024 && (o.source.h === 1024 || o.source.h === 1536));
    meta.provider = openai ? 'openai' : 'xai';
    meta.model = openai ? 'gpt-image-2' : 'grok-imagine-image-2.0';
  }
  updates.set(spec.key, entryFor(spec, o, meta));
  const [full, small, jpg] = o.files;
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  const extra = o.analysis ? ` · horizon ${o.analysis.horizon} · glow ${o.analysis.glow} · ${o.analysis.lights.length} lights · ${o.analysis.beacons.length} beacons` : '';
  console.log(
    `${spec.key.padEnd(17)} ${reprocess ? 'reprocessed' : `generated by ${meta.provider}/${meta.model}`} in ${secs} s · source ${o.source.w}×${o.source.h} → ${o.width}×${o.height} · ` +
      `webp ${Math.round(full.bytes / 1024)} KB (q${o.quality.webp}) + ${small.width}w ${Math.round(small.bytes / 1024)} KB · jpg ${Math.round(jpg.bytes / 1024)} KB${extra}` +
      `${meta.remainingToday !== undefined ? ` · ${meta.remainingToday} images left today` : ''}`,
  );
}

console.log(`${reprocess ? 'Re-encoding' : 'Generating'} ${todo.length} asset${todo.length === 1 ? '' : 's'} via ${worker}${note ? ` (note: ${note})` : ''}`);
const queue = [...todo];
await Promise.all(
  Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length && !stopped) {
      const spec = queue.shift();
      try {
        await one(spec);
      } catch (err) {
        failed++;
        console.log(`${spec.key.padEnd(17)} failed: ${err.message}`);
      }
    }
  }),
);

const count = mergeManifest(updates);
rmSync(work, { recursive: true, force: true });
console.log(
  `Manifest: ${count} asset${count === 1 ? '' : 's'} in ${manifestPath.slice(root.length + 1)}` +
    `${reprocess ? '' : ` · ${generated} generation${generated === 1 ? '' : 's'} this run`}${remainingToday !== undefined ? ` · ${remainingToday} images left today` : ''}${stopped ? ` · stopped: ${stopped}` : ''}`,
);
process.exit(failed || stopped ? 1 : 0);
