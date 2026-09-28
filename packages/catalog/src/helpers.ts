import type { VoiceRef } from '@headcount/protocol';
import type { CatalogFull, CatalogSlim, Department, Lead, MatchQuiz, Persona, PersonaSlim } from './types';

type AnyCatalog = CatalogFull | CatalogSlim;
type PersonaOf<C extends AnyCatalog> = C extends CatalogFull ? Persona : PersonaSlim;

export interface CatalogIndex<C extends AnyCatalog> {
  catalog: C;
  lead(id: string): Lead | undefined;
  persona(id: string): PersonaOf<C> | undefined;
  department(id: string): Department | undefined;
  personasIn(departmentId: string): PersonaOf<C>[];
  /** `@handle` lookup across leads and personas. */
  byHandle(handle: string): { kind: 'lead'; record: Lead } | { kind: 'persona'; record: PersonaOf<C> } | undefined;
}

/** O(1) lookups over a generated bundle (full in the worker, slim in the web). */
export function indexCatalog<C extends AnyCatalog>(catalog: C): CatalogIndex<C> {
  const personas = new Map<string, PersonaOf<C>>((catalog.personas as PersonaOf<C>[]).map((p) => [p.id, p]));
  const leads = new Map(catalog.leads.map((l) => [l.id, l]));
  const departments = new Map(catalog.departments.map((d) => [d.id, d]));
  const handles = new Map<string, { kind: 'lead'; record: Lead } | { kind: 'persona'; record: PersonaOf<C> }>();
  for (const l of catalog.leads) handles.set(l.handle, { kind: 'lead', record: l });
  for (const p of personas.values()) if (!handles.has(p.handle)) handles.set(p.handle, { kind: 'persona', record: p });
  return {
    catalog,
    lead: (id) => leads.get(id),
    persona: (id) => personas.get(id),
    department: (id) => departments.get(id),
    personasIn: (departmentId) => (departments.get(departmentId)?.personaIds ?? []).map((id) => personas.get(id)).filter((p): p is PersonaOf<C> => !!p),
    byHandle: (handle) => handles.get(handle.replace(/^@/, '').toLowerCase()),
  };
}

/** The TTS voice for a lead (Chief of Staff): the TTS ids chosen to match the lead's realtime voice. */
export function leadVoiceRef(lead: Pick<Lead, 'voice'>): VoiceRef {
  const v = lead.voice;
  return { openai: v.openai_tts, xai: v.xai_tts, speed: v.speed, ...(v.tts_instructions ? { instructions: v.tts_instructions } : {}) };
}

/** The TTS voice for a coworker persona. */
export function personaVoiceRef(persona: Pick<Persona | PersonaSlim, 'voice'>): VoiceRef {
  const v = persona.voice;
  return { openai: v.openai.voice, xai: v.xai.voice, speed: v.speed, ...(v.tts_instructions ? { instructions: v.tts_instructions } : {}) };
}

/** First name from "First Last" (owners address coworkers by first name). */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/** The name the owner sees for their Chief of Staff: their chosen name, else the lead's first name. */
export function chiefDisplayName(lead: Pick<Lead, 'name'> | undefined, chiefName: string | null | undefined): string {
  return chiefName?.trim() || (lead ? firstName(lead.name) : 'Chief of Staff');
}

/**
 * A catalog line in the owner's name for their Chief of Staff: the lead's first name (whole words only) becomes
 * `chiefName`, so a renamed lead never introduces themself by the catalog name ("I'm Dominic" → "I'm Rosa").
 * Unchanged when there is no chosen name or it equals the catalog one.
 */
export function renameLine(text: string, lead: Pick<Lead, 'name'>, chiefName: string | null | undefined): string {
  const name = chiefName?.trim();
  const first = firstName(lead.name);
  if (!name || !first || name === first) return text;
  const escaped = first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'gu'), () => name);
}

/** Initials for token faces and the Text Floor. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '')).toUpperCase();
}

export type QuizAnswers = Record<string, string | string[] | number>;

export interface QuizResult {
  leadId: string;
  score: number;
  /** 0–1 when the quiz normalises by max possible, else raw score. */
  normalized: number;
}

/**
 * Score the match quiz (catalog/SCHEMA.md §8): weighted sum over answers, normalised by the max
 * possible per lead, ties broken by lower default autonomy. Returns every lead, best first.
 */
export function scoreMatchQuiz(quiz: MatchQuiz, answers: QuizAnswers, leads: Pick<Lead, 'id' | 'defaults'>[]): QuizResult[] {
  const score = new Map<string, number>(leads.map((l) => [l.id, 0]));
  const max = new Map<string, number>(leads.map((l) => [l.id, 0]));
  const add = (m: Map<string, number>, weights: Record<string, number> | undefined, factor = 1) => {
    for (const [id, w] of Object.entries(weights ?? {})) if (m.has(id)) m.set(id, m.get(id)! + w * factor);
  };
  for (const q of quiz.questions) {
    const a = answers[q.id];
    if (q.kind === 'scale' && q.scale) {
      const { min, max: hi } = q.scale;
      for (const l of leads) {
        const best = Math.max(0, q.scale.weights_low[l.id] ?? 0, q.scale.weights_high[l.id] ?? 0);
        max.set(l.id, max.get(l.id)! + best);
      }
      if (typeof a !== 'number' || hi === min) continue;
      const t = Math.min(1, Math.max(0, (a - min) / (hi - min)));
      add(score, q.scale.weights_low, 1 - t);
      add(score, q.scale.weights_high, t);
      continue;
    }
    const options = q.options ?? [];
    for (const l of leads) {
      const ws = options.map((o) => o.weights[l.id] ?? 0);
      const best = q.kind === 'multi' ? ws.filter((w) => w > 0).reduce((s, w) => s + w, 0) : Math.max(0, ...ws);
      max.set(l.id, max.get(l.id)! + best);
    }
    const chosen = Array.isArray(a) ? a : typeof a === 'string' ? [a] : [];
    for (const id of chosen) add(score, options.find((o) => o.id === id)?.weights);
  }
  const autonomy = new Map(leads.map((l) => [l.id, l.defaults?.autonomy ?? 3]));
  const normalize = quiz.scoring?.normalize_by_max_possible !== false;
  return leads
    .map((l) => {
      const s = score.get(l.id)!;
      const m = max.get(l.id)!;
      return { leadId: l.id, score: s, normalized: normalize ? (m > 0 ? s / m : 0) : s };
    })
    .sort((x, y) => y.normalized - x.normalized || autonomy.get(x.leadId)! - autonomy.get(y.leadId)! || x.leadId.localeCompare(y.leadId));
}
