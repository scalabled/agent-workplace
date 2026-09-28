// Pre-voicing plans (§7): which lines to render once in an agent's own voice, with which fills, in which
// tier and storage scope. The renderer dedupes by clipKey (the same voice + text renders once).
import { clipKey, fillKeyOf, toDelivery } from './delivery';
import { catalogInternalsOf } from './internal';
import { prefixLineOf, utteranceFor } from './select';
import type { AgentIndex, CommonFills, CompiledCatalog, CompiledLine, PrevoiceItem, SlotValues } from './types';
import type { IntentId, PrevoiceTier, SlotId, TtsProvider } from './vocab';

type Tier = Exclude<PrevoiceTier, 'runtime'>;

const DEFAULT_PER_INTENT: Readonly<Record<Tier, number>> = { p0: 6, p1: 8, p2: 4 };
const MAX_COMBOS_PER_LINE = 24;
/** Fills that contain workspace data and therefore live under `ws/<ws>/expr/` (H8). */
const WORKSPACE_SLOTS = new Set<SlotId>(['owner_name', 'chief_name', 'coworker', 'project', 'client', 'step_label', 'artifact', 'other_thread', 'blocker', 'gist']);
const NUMERIC_ORDER: Readonly<Record<string, number>> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

function valuesFor(slot: SlotId, fills: CommonFills, catalog: CompiledCatalog): string[] | null {
  const def = catalogInternalsOf(catalog).slots[slot];
  switch (def?.prevoice) {
    case 'fixed': {
      const v = slot === 'owner_name' ? fills.owner_name : slot === 'chief_name' ? fills.chief_name : fills.self_name;
      return v ? [v] : null;
    }
    case 'finite':
      return def.domain?.length ? [...def.domain] : null;
    case 'team': {
      const list = slot === 'coworker' ? fills.coworkers : slot === 'project' ? fills.projects : undefined;
      return list?.length ? [...list] : null;
    }
    default:
      return null; // runtime slots are never pre-voiced (only split prefixes are)
  }
}

function combos(line: CompiledLine, fills: CommonFills, catalog: CompiledCatalog): SlotValues[] | null {
  let out: SlotValues[] = [{}];
  for (const slot of line.slots) {
    const values = valuesFor(slot, fills, catalog);
    if (!values) return null;
    const next: SlotValues[] = [];
    for (const base of out) for (const v of values) next.push({ ...base, [slot]: v });
    out = next.filter((f) => !(f.done && f.total && (NUMERIC_ORDER[f.done] ?? 0) > (NUMERIC_ORDER[f.total] ?? 0)));
    if (out.length > MAX_COMBOS_PER_LINE * 4) out = out.slice(0, MAX_COMBOS_PER_LINE * 4);
  }
  return out.slice(0, MAX_COMBOS_PER_LINE);
}

/** The tier a line is pre-voiced in, or null when it is rendered at runtime only. */
function tierOf(intentTier: PrevoiceTier, line: CompiledLine, runtimeSlots: readonly SlotId[]): Tier | null {
  if (runtimeSlots.length) return 'p1'; // its split prefix (§7.5) is a P1 clip
  if (intentTier === 'runtime') return line.slots.length ? null : 'p1'; // slot-free lines of runtime intents
  return intentTier;
}

/**
 * The pre-voice plan for one agent (§7.1): P0 at hire (reflex ready), P1 in the background, P2 lazily.
 * Top `perIntent` lines by prior per intent (every line for `allLinesFor`, e.g. the Chief of Staff's
 * conversation intents), every value of finite slots, fixed names, current teammates and projects, and
 * the prefixes of lines with runtime slots. Browser voices are never pre-voiced.
 */
export async function planPrevoice(
  index: AgentIndex, catalog: CompiledCatalog, provider: TtsProvider, fills: CommonFills,
  opts?: { tiers?: readonly Tier[]; perIntent?: number; maxClips?: number; allLinesFor?: readonly IntentId[] },
): Promise<PrevoiceItem[]> {
  if (provider === 'browser') return [];
  const tiers = new Set<Tier>(opts?.tiers ?? ['p0', 'p1', 'p2']);
  const maxClips = Math.max(1, opts?.maxClips ?? 400);
  const allFor = new Set(opts?.allLinesFor ?? []);
  const slotDefs = catalogInternalsOf(catalog).slots;
  const items: PrevoiceItem[] = [];
  const pairs = new Set<string>();
  const keys = new Set<string>();

  for (const tier of ['p0', 'p1', 'p2'] as const) {
    if (!tiers.has(tier)) continue;
    for (const def of catalog.intents.values()) {
      const limit = allFor.has(def.id) ? Number.POSITIVE_INFINITY : opts?.perIntent ?? DEFAULT_PER_INTENT[tier];
      const cands = [...index.candidates(def.id)].sort((a, b) => b.prior - a.prior || a.line.id.localeCompare(b.line.id));
      let taken = 0;
      for (const wl of cands) {
        if (taken >= limit) break;
        const runtime = wl.line.slots.filter((s) => slotDefs[s]?.prevoice === 'runtime');
        if (tierOf(def.prevoice, wl.line, runtime) !== tier) continue;
        const line = runtime.length ? prefixLineOf(index, wl.line) : wl.line;
        if (!line) continue;
        const fillSets = combos(line, fills, catalog);
        if (!fillSets?.length) continue;
        let added = false;
        for (const f of fillSets) {
          const u = utteranceFor(index, line, f);
          const delivery = toDelivery(u, index.voice, provider);
          if (!delivery) continue;
          const fillKey = fillKeyOf(u.fills);
          const pair = `${u.lineId}|${fillKey}`;
          if (pairs.has(pair)) continue;
          const key = await clipKey(delivery);
          if (!keys.has(key) && keys.size >= maxClips) return items;
          pairs.add(pair);
          keys.add(key);
          const scope = Object.keys(u.fills).some((s) => WORKSPACE_SLOTS.has(s as SlotId)) ? 'workspace' : 'shared';
          items.push({ lineId: u.lineId, intent: def.id, tier, fills: u.fills, fillKey, delivery, clipKey: key, scope });
          added = true;
        }
        if (added) taken++;
      }
    }
  }
  return items;
}
