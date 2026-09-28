// Private state attached to compiled catalogs and agent indexes. Not exported from the package.
import type { AgentExpressionProfile, AgentIndex, CompiledCatalog, CompiledLine, ExpressionCatalogInput, IntentsFile } from './types';
import type { ArchetypeId, Sliders } from './vocab';

export interface CatalogInternals {
  input: ExpressionCatalogInput;
  slots: IntentsFile['slots'];
  sliderStats: { mean: Sliders; std: Sliders };
  /** Every compiled line by id; a catchphrase id maps to one compiled line per intent. */
  lineById: Map<string, CompiledLine[]>;
  contextKeys: Set<string>;
}

export interface IndexInternals {
  catalog: CompiledCatalog;
  profile: AgentExpressionProfile;
  /** Lower-cased never_says phrases (persona + global), tested with `containsPhrase`. */
  neverSays: readonly string[];
  dominant: ArchetypeId | null;
  archetypeInstructions: string | null;
  /** Lower-cased phrases filtered out of owner-facing intents only (E12 `GLOBAL_NEVER_SAYS_OWNER_FACING`). */
  ownerNever: readonly string[];
  /** Lines this agent can say, by line id (any intent). */
  lines: Map<string, CompiledLine[]>;
  /** Cache of never_says verdicts for slot-free lines, keyed `${lineId}|${intent}`. */
  staticNever: Map<string, boolean>;
  /** Phrase family → ids of this agent's lines in it (E21). */
  families: Map<string, string[]>;
  /** Per-day cap of a phrase family for this agent (E21). */
  familyCap(family: string): number;
  /** Topic id → lower-cased keywords (E19). */
  topics: readonly (readonly [string, readonly string[]])[];
}

export const catalogInternals = new WeakMap<CompiledCatalog, CatalogInternals>();
export const indexInternals = new WeakMap<AgentIndex, IndexInternals>();
/** The catalog each compiled line belongs to (scoreLine reads its defaults through it). */
export const lineCatalog = new WeakMap<CompiledLine, CompiledCatalog>();

export function catalogInternalsOf(catalog: CompiledCatalog): CatalogInternals {
  const i = catalogInternals.get(catalog);
  if (!i) throw new Error('expressions: not a catalog from compileCatalog()');
  return i;
}

export function indexInternalsOf(index: AgentIndex): IndexInternals {
  const i = indexInternals.get(index);
  if (!i) throw new Error('expressions: not an index from buildAgentIndex()');
  return i;
}

export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

export const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
