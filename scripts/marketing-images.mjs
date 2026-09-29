#!/usr/bin/env node
// node scripts/marketing-images.mjs — generates the landing page's art-directed images through the running worker
// (POST /api/media/image; the worker holds the provider keys, this script never sees them), then writes optimized
// copies to apps/web/public/marketing/: <key>.webp (≤ 400 KB, lighter than its JPEG) + <key>.jpg fallback, smaller
// <key>-<width>.webp copies for srcset, and manifest.json [{key, file, fallback, alt, aspect, width, height, bytes,
// srcset: [{width, file}], provider, model}]. Owned by media.
//
// Rules for every image: dark, premium, slightly futuristic; no text, no logos, no real brands, no recognizable
// real people. Images share the worker's daily image budget (PORTRAIT_DAILY_LIMIT) with portraits.
//
// Options: --worker <url> (default http://127.0.0.1:8787) · --only <key>[,<key>] · --force (regenerate even when
//          the files exist) · --provider openai|xai (override the per-image choice) · --note "<text>" (extra art
//          direction appended to the prompt, for a retry) · --reprocess (re-optimize the stored R2 originals, no
//          generation) · --concurrency <n> (default 3) · --dry-run (print prompts) · --list
// Needs ffmpeg (crop and scale, JPEG) and cwebp (WebP) on the PATH.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'apps/web/public/marketing');
const manifestPath = join(outDir, 'manifest.json');

const STYLE = [
  'Art direction: dark, premium, slightly futuristic editorial imagery for a modern software landing page.',
  'Rich deep blacks and charcoal, luminous accents in teal, violet and warm amber, soft bloom and subtle glow,',
  'cinematic lighting, fine film grain, high detail, clean and calm, generous dark negative space.',
  'Absolutely no text, letters, numbers, words, captions, logos, watermarks, signatures, brand marks or interface labels anywhere.',
  'No real brands and no recognizable real people or celebrities.',
].join(' ');

/** The seven landing images. `provider`: openai (gpt-image-2) for illustrative/graphic, xai for photographic. */
export const SPECS = [
  {
    key: 'hero',
    aspect: '16:9',
    provider: 'xai',
    alt: 'A glowing modern studio office at night, seen through glass, with a small team of knowledge workers softly lit in teal, violet and amber.',
    prompt:
      'Wide cinematic photograph: a luminous late-evening modern creative studio office seen from outside through a floor-to-ceiling glass wall with faint reflections. ' +
      'Inside, a small diverse team of modern knowledge workers (varied genders and heritages, contemporary smart-casual style) appear as soft-focus silhouettes and gently rim-lit figures, ' +
      'some standing beside tall glowing vertical portrait screens; each person is edged by a different glowing accent rim light (teal, violet, amber). ' +
      'Warm pendant lights, plants, concrete and walnut textures, distant city-light bokeh. Faces are out of focus and not identifiable. ' +
      'Deep blacks, calm premium mood, the left third of the frame is darker and emptier for a headline.',
  },
  {
    key: 'floor',
    aspect: '16:9',
    provider: 'openai',
    alt: 'An abstract isometric office floor floating in darkness, each desk glowing in its own accent color and linked by thin light paths.',
    prompt:
      'Elegant isometric 3D render of an abstract spatial office floor seen from above at a gentle angle, floating in a deep black void. ' +
      'Clusters of minimalist desks, lounge corners and glass meeting pods; each desk glows softly in its own accent color (teal, violet, amber, soft rose, sky blue). ' +
      'Thin light paths connect the desks like circuit traces; at some desks a small glowing disc marks a person (abstract tokens, no faces, no figures). ' +
      'Glass partitions with subtle reflections, depth of field fading toward the edges, clean architectural-visualization style, cinematic.',
  },
  {
    key: 'meeting',
    aspect: '16:9',
    provider: 'xai',
    alt: 'A ring of floating portrait frames of modern professionals in a dark space, joined by threads of light like a meeting in progress.',
    prompt:
      'A ring of seven floating vertical portrait frames arranged in a gentle circle in a dark void, seen at a slight angle from above. ' +
      'Each frame holds a softly lit head-and-shoulders photograph of a different fictional modern professional (diverse genders, ages and heritages, contemporary creative-studio style, ' +
      'natural relaxed expressions, facing the viewer), and each frame has a thin glowing border in its own accent color (teal, violet, amber, rose, sky blue). ' +
      'Fine threads of light connect every frame through a softly glowing center point, like a meeting in progress. ' +
      'Natural, well-proportioned faces, photographic portraits, cinematic, premium, deep blacks.',
  },
  {
    key: 'voice',
    aspect: '4:3',
    provider: 'openai',
    alt: 'Luminous sound waves flowing across a dark background and turning into the outline of a face.',
    prompt:
      'Abstract luminous sound waves flowing from left to right across a pure black background: many fine glowing lines in teal and violet that gradually bend, ' +
      'gather and converge into the elegant contour of a human face in three-quarter profile, drawn only by lines of light (no photographic face, no skin, no eyes detail). ' +
      'Subtle amber highlights, drifting particles, soft bloom. Minimal, premium, generous negative space.',
  },
  {
    key: 'context',
    aspect: '4:3',
    provider: 'openai',
    alt: 'Documents, charts and photos floating in the dark and dissolving into a glowing network of connected knowledge.',
    prompt:
      'Blank documents, simple bar and line charts, sticky notes and small landscape photographs float in a dark space on the left, and gently dissolve into streams of glowing particles ' +
      'that flow right into an elegant knowledge graph of connected luminous nodes and edges. The pages carry only abstract gray bars and blocks instead of writing; nothing is legible. ' +
      'Teal and violet glow with amber accents, deep blacks, cinematic depth of field, 3D render quality.',
  },
  {
    key: 'trust',
    aspect: '4:3',
    provider: 'openai',
    alt: 'A calm glowing seal with a check mark beside a minimal receipt card and a small raised-hand glyph.',
    prompt:
      'A minimal, calm composition on a deep black background: a softly glowing circular seal made of fine concentric rings of light with a precise geometric check mark at its center; ' +
      'beside it a slim floating frosted-glass receipt card showing only abstract horizontal light bars (no writing); and a small elegant raised-hand glyph drawn in a single luminous amber line. ' +
      'Precise, quiet and trustworthy, lots of negative space, subtle teal and violet glow, soft glassmorphism, 3D render quality.',
  },
  {
    key: 'providers',
    aspect: '16:9',
    provider: 'openai',
    alt: 'A constellation of distinct glowing nodes joined by light filaments into one bright core.',
    prompt:
      'A constellation of six distinct glowing nodes floating in a dark void: a teal orb, a violet prism, an amber ring, a rose crystal, a sky-blue sphere and a pearl-white cube, ' +
      'each with its own soft halo. Fine light filaments join them and converge into one bright central core with a gentle bloom. ' +
      'Abstract, elegant, cinematic, 3D render quality, deep blacks, generous negative space, no stars forming shapes or symbols.',
  },
];

const TARGET = { '16:9': { w: 1920, ratio: 16 / 9 }, '4:3': { w: 1600, ratio: 4 / 3 }, '1:1': { w: 1200, ratio: 1 }, '3:4': { w: 1200, ratio: 3 / 4 } };
const WEBP_MAX_BYTES = 400 * 1024;
const JPEG_MAX_BYTES = 600 * 1024;

const args = process.argv.slice(2);
const has = (name) => args.includes(name);
const values = (name) =>
  args
    .flatMap((a, i) => (a === name && args[i + 1] !== undefined && !args[i + 1].startsWith('--') ? [args[i + 1]] : a.startsWith(`${name}=`) ? [a.slice(name.length + 1)] : []))
    .map((s) => s.trim())
    .filter(Boolean);

if (has('--help') || has('-h')) {
  console.log(`Usage: node scripts/marketing-images.mjs [--only <key,key>] [--force] [--provider openai|xai] [--note "<text>"] [--reprocess] [--concurrency <n>] [--dry-run] [--list] [--worker <url>]
Keys: ${SPECS.map((s) => s.key).join(', ')}`);
  process.exit(0);
}
if (has('--list')) {
  for (const s of SPECS) console.log(`${s.key.padEnd(10)} ${s.aspect.padEnd(5)} ${s.provider.padEnd(7)} ${s.alt}`);
  process.exit(0);
}

const worker = (values('--worker')[0] ?? 'http://127.0.0.1:8787').replace(/\/+$/, '');
const only = values('--only').flatMap((v) => v.split(',')).map((s) => s.trim()).filter(Boolean);
const force = has('--force');
const reprocess = has('--reprocess');
const dryRun = has('--dry-run');
const providerOverride = values('--provider')[0];
const note = values('--note')[0] ?? '';
const concurrency = Number(values('--concurrency')[0] ?? 3);
if (providerOverride && !['openai', 'xai'].includes(providerOverride)) {
  console.error('--provider must be openai or xai.');
  process.exit(1);
}
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 7) {
  console.error('--concurrency must be a whole number from 1 to 7.');
  process.exit(1);
}
const unknown = only.filter((k) => !SPECS.some((s) => s.key === k));
if (unknown.length) {
  console.error(`Unknown key ${unknown.join(', ')}. Keys: ${SPECS.map((s) => s.key).join(', ')}`);
  process.exit(1);
}

const promptFor = (spec) => [spec.prompt, note, STYLE].filter(Boolean).join(' ');
const selected = SPECS.filter((s) => !only.length || only.includes(s.key));
for (const spec of selected) {
  const length = promptFor(spec).length;
  if (length > 1500) {
    console.error(`The ${spec.key} prompt is ${length} characters; the worker takes at most 1500. Shorten it or the note.`);
    process.exit(1);
  }
}
if (dryRun) {
  for (const spec of selected) console.log(`── ${spec.key} (${spec.aspect}, ${providerOverride ?? spec.provider}, ${promptFor(spec).length} chars)\n${promptFor(spec)}\n`);
  process.exit(0);
}

for (const tool of ['ffmpeg', 'ffprobe', 'cwebp']) {
  if (spawnSync(tool, ['-version'], { stdio: 'ignore' }).error) {
    console.error(`${tool} is not on the PATH (brew install ffmpeg webp).`);
    process.exit(1);
  }
}

function run(cmd, argv) {
  const r = spawnSync(cmd, argv, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${cmd} failed: ${(r.stderr || r.stdout || '').trim().split('\n').slice(-3).join(' ')}`);
  return r.stdout;
}

function dimensions(file) {
  const out = run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', file]).trim();
  const [w, h] = out.split('x').map(Number);
  return { w, h };
}

/** Responsive widths for `srcset` (each at most the full width); the full width is always included. */
const SRCSET_WIDTHS = [640, 1024, 1600];
/** WebP quality: tuned so each WebP is smaller than its JPEG (photographic art compresses well at 70–76). */
const WEBP_QUALITY = 74;

/**
 * Center-crop to the exact aspect and scale down (never up) to the target width; then encode the full width as
 * WebP (≤ 400 KB, never larger than its JPEG) and a JPEG fallback, plus smaller WebP widths for `srcset`.
 */
function optimize(source, spec, work) {
  const { ratio, w: maxW } = TARGET[spec.aspect];
  const src = dimensions(source);
  let cw = src.w;
  let ch = Math.round(cw / ratio);
  if (ch > src.h) {
    ch = src.h;
    cw = Math.round(ch * ratio);
  }
  const even = (n) => n - (n % 2);
  const master = (w) => {
    const h = even(Math.round(w / ratio));
    const out = join(work, `${spec.key}-${w}.png`);
    run('ffmpeg', ['-y', '-v', 'error', '-i', source, '-vf', `crop=${cw}:${ch}:(iw-${cw})/2:(ih-${ch})/2,scale=${w}:${h}:flags=lanczos`, '-frames:v', '1', out]);
    return { file: out, height: h };
  };
  const webpAt = (png, out, maxBytes) => {
    let quality = WEBP_QUALITY;
    let bytes = Infinity;
    while (quality >= 56) {
      run('cwebp', ['-quiet', '-q', String(quality), '-m', '6', '-sharp_yuv', '-metadata', 'none', png, '-o', out]);
      bytes = statSync(out).size;
      if (bytes <= maxBytes) break;
      quality -= 6;
    }
    return { bytes, quality };
  };
  let width = even(Math.min(maxW, cw));
  const webp = join(outDir, `${spec.key}.webp`);
  const jpg = join(outDir, `${spec.key}.jpg`);
  for (;;) {
    const full = master(width);
    let q = 3;
    let jpgBytes = Infinity;
    while (q <= 9) {
      run('ffmpeg', ['-y', '-v', 'error', '-i', full.file, '-q:v', String(q), '-pix_fmt', 'yuvj420p', '-map_metadata', '-1', jpg]);
      jpgBytes = statSync(jpg).size;
      if (jpgBytes <= JPEG_MAX_BYTES) break;
      q++;
    }
    // The WebP exists to be lighter than the JPEG: cap it at the JPEG's size (and 400 KB).
    const w = webpAt(full.file, webp, Math.min(WEBP_MAX_BYTES, jpgBytes));
    if (w.bytes > WEBP_MAX_BYTES) {
      width = even(Math.round(width * 0.85));
      continue;
    }
    const srcset = [];
    for (const sw of SRCSET_WIDTHS.filter((x) => x < width)) {
      const file = `${spec.key}-${sw}.webp`;
      webpAt(master(sw).file, join(outDir, file), WEBP_MAX_BYTES);
      srcset.push({ width: sw, file: `/marketing/${file}` });
    }
    srcset.push({ width, file: `/marketing/${spec.key}.webp` });
    return { width, height: full.height, webpBytes: w.bytes, jpgBytes, webpQuality: w.quality, source: src, srcset };
  }
}

async function request(path, init) {
  const res = await fetch(`${worker}${path}`, init);
  return res;
}

function readManifest() {
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ── go ─────────────────────────────────────────────────────────────────────────────────────────────────────
try {
  const res = await request('/api/capabilities', { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`capabilities ${res.status}`);
  const caps = await res.json();
  if (!reprocess && !caps.modalities?.image?.available) {
    const keys = caps.modalities?.image?.missingKeys ?? [];
    console.error(`Images need a provider. Add ${keys.length ? keys.join(' or ') : 'OPENAI_API_KEY or XAI_API_KEY'} to apps/worker/.dev.vars, then restart pnpm dev.`);
    process.exit(1);
  }
} catch (err) {
  console.error(`The worker is not reachable at ${worker} (${err.message}). Start it with pnpm dev.`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
const work = mkdtempSync(join(tmpdir(), 'headcount-marketing-'));
const manifest = new Map(readManifest().map((e) => [e.key, e]));
const todo = selected.filter((s) => force || reprocess || !(manifest.has(s.key) && existsSync(join(outDir, `${s.key}.webp`)) && existsSync(join(outDir, `${s.key}.jpg`))));
const skipped = selected.length - todo.length;
if (skipped) console.log(`${skipped} image${skipped === 1 ? '' : 's'} already exist (use --force to regenerate).`);
if (!todo.length) {
  rmSync(work, { recursive: true, force: true });
  process.exit(0);
}

let stopped = null;
let failed = 0;
async function one(spec) {
  const provider = providerOverride ?? spec.provider;
  const started = Date.now();
  let meta;
  if (reprocess) {
    const head = await request(`/api/media/${spec.key}`, { method: 'HEAD' });
    if (!head.ok) throw new Error(`no stored original (${head.status}); generate it first`);
    meta = { url: `/api/media/${spec.key}`, provider: manifest.get(spec.key)?.provider ?? null, model: manifest.get(spec.key)?.model ?? null };
  } else {
    const res = await request('/api/media/image', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: spec.key, aspect: spec.aspect, provider, prompt: promptFor(spec) }),
      signal: AbortSignal.timeout(300_000),
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 429 || res.status === 503) {
      stopped ??= body.error?.message ?? `the worker answered ${res.status}`;
      throw new Error(stopped);
    }
    if (!res.ok) throw new Error(body.error?.message ?? `the worker answered ${res.status}`);
    meta = body;
  }
  const img = await request(meta.url);
  if (!img.ok) throw new Error(`GET ${meta.url} answered ${img.status}`);
  const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[img.headers.get('content-type')] ?? 'bin';
  const source = join(work, `${spec.key}-source.${ext}`);
  writeFileSync(source, Buffer.from(await img.arrayBuffer()));
  const o = optimize(source, spec, work);
  manifest.set(spec.key, {
    key: spec.key,
    file: `/marketing/${spec.key}.webp`,
    fallback: `/marketing/${spec.key}.jpg`,
    alt: spec.alt,
    aspect: spec.aspect,
    width: o.width,
    height: o.height,
    bytes: o.webpBytes,
    srcset: o.srcset,
    provider: meta.provider ?? null,
    model: meta.model ?? null,
  });
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `${spec.key.padEnd(10)} ${reprocess ? 'reprocessed' : `generated by ${meta.provider}/${meta.model}`} in ${secs} s · source ${o.source.w}×${o.source.h} → ${o.width}×${o.height} · ` +
      `webp ${Math.round(o.webpBytes / 1024)} KB (q${o.webpQuality}) · jpg ${Math.round(o.jpgBytes / 1024)} KB${meta.remainingToday !== undefined ? ` · ${meta.remainingToday} images left today` : ''}`,
  );
}

console.log(`${reprocess ? 'Re-optimizing' : 'Generating'} ${todo.length} image${todo.length === 1 ? '' : 's'} via ${worker}${note ? ` (note: ${note})` : ''}`);
const queue = [...todo];
await Promise.all(
  Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length && !stopped) {
      const spec = queue.shift();
      try {
        await one(spec);
      } catch (err) {
        failed++;
        console.log(`${spec.key.padEnd(10)} failed: ${err.message}`);
      }
    }
  }),
);

const order = new Map(SPECS.map((s, i) => [s.key, i]));
const entries = [...manifest.values()].filter((e) => order.has(e.key)).sort((a, b) => order.get(a.key) - order.get(b.key));
writeFileSync(manifestPath, `${JSON.stringify(entries, null, 2)}\n`);
rmSync(work, { recursive: true, force: true });
console.log(`Manifest: ${entries.length} image${entries.length === 1 ? '' : 's'} in ${manifestPath.slice(root.length + 1)}${stopped ? ` · stopped: ${stopped}` : ''}`);
process.exit(failed || stopped ? 1 : 0);
