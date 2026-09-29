// Vite plugin: `virtual:headcount-landing`, the small slice of data the public landing page needs.
//
// The landing shows real coworkers (names, faces, taglines) but must stay light: the slim catalog bundle is
// ~230 kB gzip, so this plugin reads the generated bundle at build/dev time and emits only the 12 leads and a
// few coworkers per department (~15 kB gzip), plus the marketing image manifest. Names always come from the
// catalog (they change; nothing here hard-codes one). In dev the module is rebuilt when either file changes.
import { readFile, stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import type { Plugin, ViteDevServer } from 'vite';

const ID = 'virtual:headcount-landing';
const RESOLVED = `\0${ID}`;
/** Coworkers per department offered to the portrait wall (it curates 18 of them at runtime, portraits first). */
const PER_DEPARTMENT = 3;
const TEASER_CHARS = 240;

export interface LandingDataOptions {
  /** packages/catalog/generated/slim.js */
  catalog: string;
  /** packages/catalog/generated/full.js (default: next to `catalog`): only for the coworkers' age ranges, which the slim bundle leaves out. */
  full?: string;
  /** apps/web/public/marketing/manifest.json */
  manifest: string;
  /** apps/web/public/marketing/voices/manifest.json (pre-voiced lead samples; optional) */
  voices?: string;
}

type Json = Record<string, unknown>;

/** First sentences of a backstory, up to about `max` characters (never cut mid-sentence). */
export function teaser(text: string, max = TEASER_CHARS): string {
  const sentences = text.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [text];
  let out = '';
  for (const s of sentences) {
    if (out && out.length + s.length > max) break;
    out += s;
  }
  return out.trim();
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

async function loadCatalog(file: string): Promise<Json> {
  // Cache-bust by mtime: the dev server re-imports after the catalog bundle is rebuilt.
  const { mtimeMs } = await stat(file);
  const mod = (await import(`${pathToFileURL(file).href}?v=${Math.round(mtimeMs)}`)) as { default: Json };
  return mod.default;
}

async function loadVoices(file: string | undefined): Promise<Record<string, Json>> {
  if (!file) return {};
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, Json>) : {};
  } catch {
    return {}; // no pre-voiced samples: "Hear …" needs a speech provider
  }
}

async function loadManifest(file: string): Promise<Json[]> {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as unknown;
    return Array.isArray(parsed) ? (parsed as Json[]) : [];
  } catch {
    return []; // no marketing images yet: the page falls back to gradients
  }
}

/** Age range per persona id, from the full bundle (the landing leads with the younger half of the cast). */
async function loadAges(file: string): Promise<Map<string, string>> {
  try {
    const full = await loadCatalog(file);
    return new Map(((full.personas as Json[]) ?? []).map((p) => [p.id as string, (p.age_range as string) ?? '']));
  } catch {
    return new Map();
  }
}

export async function buildLandingData(opts: LandingDataOptions) {
  const c = await loadCatalog(opts.catalog);
  const ages = await loadAges(opts.full ?? opts.catalog.replace(/slim\.js$/, 'full.js'));
  const leads = (c.leads as Json[]).map((l) => {
    const voice = l.voice as Json;
    const avatar = l.avatar as Json;
    return {
      id: l.id as string,
      name: l.name as string,
      first: firstName(l.name as string),
      pronouns: l.pronouns as string,
      age: (l.age_range as string) ?? '',
      archetype: l.archetype as string,
      tagline: l.tagline as string,
      teaser: teaser(l.backstory as string),
      bestFor: ((l.best_for_owners_who as string[]) ?? []).slice(0, 2),
      accent: avatar.accent_color as string,
      appearance: avatar.appearance as Json,
      voice: {
        openai: voice.openai_tts as string,
        xai: voice.xai_tts as string,
        speed: voice.speed as number,
        ...(voice.tts_instructions ? { instructions: voice.tts_instructions as string } : {}),
      },
    };
  });
  const personas = new Map((c.personas as Json[]).map((p) => [p.id as string, p]));
  const departments = c.departments as Json[];
  const coworkers: Json[] = [];
  for (const d of departments) {
    for (const id of ((d.personaIds as string[]) ?? []).slice(0, PER_DEPARTMENT)) {
      const p = personas.get(id);
      if (!p) continue;
      const avatar = p.avatar as Json;
      coworkers.push({ id, name: p.name, first: firstName(p.name as string), pronouns: p.pronouns ?? '', age: ages.get(id) ?? '', title: p.title, department: d.name, accent: avatar.accent_color, appearance: avatar.appearance });
    }
  }
  const quiz = c.matchQuiz as Json | undefined;
  const preview = (quiz?.try_before_choosing as Json | undefined)?.voice_preview_line as string | undefined;
  const images: Record<string, Json> = {};
  for (const img of await loadManifest(opts.manifest)) if (typeof img.key === 'string') images[img.key] = img;
  const leadIds = new Set(leads.map((l) => l.id));
  // The lip-sync timing stays in the manifest file (fetched on the first ▶): the page carries only what to play.
  const voiceSamples = Object.fromEntries(
    Object.entries(await loadVoices(opts.voices))
      .filter(([id, v]) => leadIds.has(id) && Array.isArray(v.chunks) && v.chunks.length > 0)
      .map(([id, v]) => [id, { ...v, chunks: (v.chunks as Json[]).map(({ alignment: _timing, ...c }) => c) }]),
  );
  return {
    leads,
    coworkers,
    counts: { leads: leads.length, coworkers: personas.size, departments: departments.length },
    voicePreview: preview ?? null,
    images,
    voiceSamples,
  };
}

export function landingData(opts: LandingDataOptions): Plugin {
  return {
    name: 'headcount-landing-data',
    resolveId: (id) => (id === ID ? RESOLVED : undefined),
    async load(id) {
      if (id !== RESOLVED) return undefined;
      const data = await buildLandingData(opts);
      return Object.entries(data)
        .map(([k, v]) => `export const ${k} = ${JSON.stringify(v)};`)
        .join('\n');
    },
    configureServer(s: ViteDevServer) {
      const watched = [opts.catalog, opts.manifest, ...(opts.voices ? [opts.voices] : [])];
      s.watcher.add(watched);
      s.watcher.on('change', (file) => {
        if (!watched.includes(file)) return;
        const mod = s.moduleGraph.getModuleById(RESOLVED);
        if (mod) s.moduleGraph.invalidateModule(mod);
        s.ws.send({ type: 'full-reload' });
      });
    },
    // The landing's LCP image, preloaded only on "/" (index.html's inline script reads this).
    async transformIndexHtml(html) {
      const hero = (await loadManifest(opts.manifest)).find((img) => img.key === 'hero');
      const set = Array.isArray(hero?.srcset) ? (hero.srcset as { width: number; file: string }[]).map((s) => `${s.file} ${s.width}w`).join(', ') : '';
      return html.replace('__HEADCOUNT_HERO_SRCSET__', set).replace('__HEADCOUNT_HERO__', typeof hero?.file === 'string' ? hero.file : '');
    },
  };
}
