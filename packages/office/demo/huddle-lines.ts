// The demo's small-talk provider: the real huddle engine of @headcount/expressions (pickExchange over the live
// catalog/expressions/huddles/** content), wired as Phase 2 wires it. Everything is loaded
// lazily and by path (the office package keeps no dependencies); any failure falls back to the sample.
//
// Opening stays light (the review's startup fix): personality blends come straight from the catalog bundle's
// signature packs (a precomputed field, no compile); the expressions catalog is compiled without its line text (the
// huddle engine needs only archetypes, laugh styles, never_says and the context vocabulary: ~10 ms instead of ~400);
// and the huddles compile in idle time after the office opens, or on the first line if that comes sooner. Huddle
// recency persists in localStorage['hc.expr.huddles.v1'] (a pick is recorded when its first line is seen), so a reload
// never replays the same opening joke.
import type { ArchetypeName, HuddleLineRequest, HuddleScript } from '../src/index';

/** The slice of the expressions API the demo uses (typed locally: the office package does not depend on it). */
interface ExprApi {
  compileCatalogLenient(input: unknown): { catalog: unknown };
  compileHuddlesLenient(packs: readonly unknown[], catalog: unknown): { huddles: { version: string; exchanges: readonly unknown[] }; dropped: readonly { id: string; reason: string }[] };
  buildAgentIndex(catalog: unknown, profile: unknown): { baseline: unknown; blend: Record<string, number> };
  pickExchange(h: unknown, req: unknown, recency: unknown): unknown | null;
  huddleScriptOf(pick: unknown): HuddleScript & { data: unknown };
  createHuddleRecency(snapshot?: unknown): { record(pick: unknown, now: number, dayKey: string): void; snapshot(): unknown };
}

export interface DemoPersonality {
  id: string;
  personaId: string;
  name: string;
  department: string;
  isChief: boolean;
  sliders: Record<string, number>;
  traits: string[];
  roles: string[];
  seniority?: string;
  pairsWellWith: string[];
  tensionWith: string[];
  voice: { openai?: string; xai?: string; speed?: number };
}

export interface HuddleEngine {
  lines(req: HuddleLineRequest): HuddleScript | null;
  /** Record a pick once a line of it was seen (visible-only talk consumes nothing else). */
  shown(exchangeId: string, at: number): void;
  blendOf(id: string): Readonly<Partial<Record<ArchetypeName, number>>> | undefined;
  /** One step of compiling (idle time): the catalog, then the huddles. True once both are ready. */
  warm(): boolean;
  source: string;
  exchanges: number;
  dropped: number;
}

const RECENCY_KEY = 'hc.expr.huddles.v1';
const dayKeyOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

type Input = { packs: { intents: Record<string, unknown> }[]; signatures: { packs: { persona_id: string; archetypes?: Record<string, number> }[] }[]; archetypes: { lead_blends?: Record<string, Record<string, number>> } };

/** The catalog without its line text: everything the huddle engine reads, compiled in a few ms. */
function lightInput(input: Input): unknown {
  return {
    ...input,
    packs: input.packs.map((p) => ({ ...p, intents: Object.fromEntries(Object.entries(p.intents).map(([k, v]) => [k, Array.isArray(v) ? v.slice(0, 1) : v])) })),
    signatures: input.signatures.map((f) => ({ ...f, packs: f.packs.map((p) => ({ ...p, lines: {}, catchphrases: [] })) })),
  };
}

export async function loadHuddleEngine(people: readonly DemoPersonality[], chiefName: string): Promise<HuddleEngine | null> {
  try {
    const mods = import.meta.glob('../../expressions/src/index.ts');
    const load = Object.values(mods)[0];
    if (!load) return null;
    const x = (await load()) as unknown as ExprApi;
    if (typeof x.compileHuddlesLenient !== 'function' || typeof x.pickExchange !== 'function' || typeof x.huddleScriptOf !== 'function') return null;
    const bundles = import.meta.glob('../../expressions/generated/expressions.json', { import: 'default' });
    const loadBundle = Object.values(bundles)[0];
    if (!loadBundle) return null;
    const bundle = (await loadBundle()) as { input: Input; huddles?: { packs: unknown[] } };
    // The live content first (it may be newer than the bundle), else the bundle's compiled packs.
    const packMods = import.meta.glob('../../../catalog/expressions/huddles/*.json', { import: 'default' });
    let packs = (await Promise.all(Object.values(packMods).map((f) => f().catch(() => null)))).filter((p): p is { kind: string; exchanges: unknown[] } => !!p && (p as { kind?: string }).kind === 'huddle_pack');
    let source = 'catalog/expressions/huddles';
    if (!packs.length && bundle.huddles?.packs?.length) {
      packs = bundle.huddles.packs as { kind: string; exchanges: unknown[] }[];
      source = 'bundle.huddles';
    }
    if (!packs.length) return null;

    // Blends: the signature pack's archetypes (a precomputed catalog field), else the lead's blend.
    const blends = new Map<string, Record<string, number>>();
    for (const f of bundle.input.signatures) for (const p of f.packs) if (p.archetypes) blends.set(p.persona_id, p.archetypes);
    for (const [id, b] of Object.entries(bundle.input.archetypes.lead_blends ?? {})) if (!blends.has(id)) blends.set(id, b);

    let catalogOnly: unknown = null;
    let compiled: { catalog: unknown; huddles: ReturnType<ExprApi['compileHuddlesLenient']>['huddles']; dropped: number } | null = null;
    const catalogOf = () => (catalogOnly ??= x.compileCatalogLenient(lightInput(bundle.input)).catalog);
    const ensure = () => {
      if (!compiled) {
        const catalog = catalogOf();
        const r = x.compileHuddlesLenient(packs, catalog);
        compiled = { catalog, huddles: r.huddles, dropped: r.dropped.length };
      }
      return compiled;
    };
    const byId = new Map(people.map((p) => [p.id, p]));
    const indexes = new Map<string, ReturnType<ExprApi['buildAgentIndex']>>();
    const indexOf = (id: string) => {
      let ix = indexes.get(id);
      if (ix) return ix;
      const p = byId.get(id);
      if (!p) return null;
      ix = x.buildAgentIndex(ensure().catalog, {
        agentId: p.id,
        personaId: p.personaId,
        firstName: p.name.split(/\s+/)[0],
        personality: { sliders: p.sliders, traits: p.traits, roles: p.roles, ...(p.seniority ? { seniority: p.seniority } : {}), ...(p.isChief ? { leadId: p.personaId } : {}) },
        voice: p.voice,
        ...(p.isChief ? { teamRole: 'chief' } : {}),
      });
      indexes.set(id, ix);
      return ix;
    };

    // Recency that survives a reload (Phase 2 syncs it through the workspace so the daily caps hold across devices).
    let snapshot: unknown;
    try {
      const raw = localStorage.getItem(RECENCY_KEY);
      snapshot = raw ? JSON.parse(raw) : undefined;
    } catch {
      snapshot = undefined;
    }
    const recency = x.createHuddleRecency(snapshot);
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    const save = () => {
      if (saveTimer) return;
      saveTimer = setTimeout(() => {
        saveTimer = null;
        try {
          localStorage.setItem(RECENCY_KEY, JSON.stringify(recency.snapshot()));
        } catch {
          /* storage unavailable: recency lives for this page only */
        }
      }, 400);
    };

    const picks = new Map<string, unknown>();
    const count = packs.reduce((n, p) => n + (Array.isArray(p.exchanges) ? p.exchanges.length : 0), 0);
    return {
      source,
      exchanges: count,
      get dropped() {
        return compiled?.dropped ?? 0;
      },
      warm() {
        try {
          if (!catalogOnly) {
            catalogOf();
            return false;
          }
          ensure();
        } catch (err) {
          console.warn('[office demo] huddle engine failed to compile', err);
        }
        return true;
      },
      blendOf(id) {
        const p = byId.get(id);
        return (blends.get(p?.personaId ?? id) as Partial<Record<ArchetypeName, number>> | undefined) ?? undefined;
      },
      lines(req) {
        const participants = req.participants
          .map((id) => {
            const p = byId.get(id);
            const ix = indexOf(id);
            if (!p || !ix) return null;
            return {
              agentId: id,
              firstName: p.name.split(/\s+/)[0],
              index: ix,
              mood: ix.baseline,
              department: p.department,
              teamRoles: p.roles,
              isChief: p.isChief,
              pairsWellWith: p.pairsWellWith,
              tensionWith: p.tensionWith,
              ...(req.hostId === id ? { atDesk: true } : {}),
            };
          })
          .filter((p) => !!p);
        if (participants.length < 2) return null;
        const at = req.at;
        const pick = x.pickExchange(
          ensure().huddles,
          {
            huddleId: req.huddleId,
            spot: req.spot.kind,
            participants,
            now: { epochMs: at.getTime(), localHour: at.getHours(), weekday: at.getDay() },
            ambience: req.ambience,
            provider: 'mock',
            maxLines: req.maxLines,
            contexts: req.contexts,
            chiefName,
            // The demo has no ledger: grounded exchanges (wins, welcomes, projects) never play here (H1).
            grounding: null,
            seed: req.seed,
            ...(req.previous?.length ? { avoid: new Set(req.previous) } : {}),
          },
          recency,
        );
        if (!pick) return null;
        const script = x.huddleScriptOf(pick);
        picks.set(script.exchangeId, pick);
        return script;
      },
      shown(exchangeId, at) {
        const pick = picks.get(exchangeId);
        if (!pick) return;
        picks.delete(exchangeId);
        recency.record(pick, at, dayKeyOf(new Date(at)));
        save();
      },
    };
  } catch (err) {
    console.warn('[office demo] huddle engine unavailable; using the built-in sample', err);
    return null;
  }
}
