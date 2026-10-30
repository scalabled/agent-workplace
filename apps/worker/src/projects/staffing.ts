// "Staff it" (Inc 1): pick the catalog team recipe that best fits the owner's goal, then turn its composition into a
// named team and its plan skeleton into steps. The recipe carries the craft (who leads, who reviews, the designated
// sceptic, acceptance criteria); the model only chooses among recipes and names the project. Keyword scoring ranks
// the shortlist and is the whole choice for the keyless Mock provider.
import type { CatalogFull, Lead, Persona } from '@headcount/catalog';
import type { DeliverableKind, ProjectForecast, ProjectStep, TeamMember, TeamRole } from '@headcount/protocol/ext/projects';

export interface RecipeRole {
  persona_id: string;
  role: string;
  why?: string;
  /** Pins this member's voice for the team (must be their voice or an alternate). */
  voice_override?: { openai?: string; xai?: string };
}
export interface RecipeStep {
  id: string;
  title: string;
  brief?: string;
  acceptance?: string;
  owner_persona_id: string;
  reviewer_persona_ids?: string[];
  depends_on?: string[];
}
export interface Recipe {
  id: string;
  name: string;
  outcome?: string;
  when_to_use?: string;
  group?: string;
  composition: RecipeRole[];
  coordinator_persona_id?: string;
  plan_skeleton: RecipeStep[];
  deliverables?: unknown;
}

const STOP = new Set(
  'a an and are as at be by for from how i in into is it its me my of on or our out please so that the their them this to up us we what when with you your can need want help make get do new some'.split(' '),
);

export function words(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9][a-z0-9'-]*/g) ?? []).map((w) => w.replace(/'s$/, '')).filter((w) => w.length > 2 && !STOP.has(w));
}

/** Crude stem so "launching" meets "launch" and "hires" meets "hire". */
function stem(w: string): string {
  return w.replace(/(ing|ed|es|s)$/, '');
}

/** Overlap between the goal and a recipe's name, outcome and when-to-use (name counts double). */
export function scoreRecipe(goal: string, recipe: Recipe): number {
  const g = new Set(words(goal).map(stem));
  if (!g.size) return 0;
  let score = 0;
  for (const w of words(recipe.name)) if (g.has(stem(w))) score += 2;
  for (const w of new Set(words(`${recipe.outcome ?? ''} ${recipe.when_to_use ?? ''}`))) if (g.has(stem(w))) score += 1;
  return score;
}

export function recipesOf(catalog: Pick<CatalogFull, 'recipes'>): Recipe[] {
  return (catalog.recipes as unknown as Recipe[]).filter((r) => r && typeof r.id === 'string' && Array.isArray(r.composition) && Array.isArray(r.plan_skeleton) && r.plan_skeleton.length > 0);
}

/** Best keyword matches first (stable: catalog order breaks ties). */
export function shortlist(goal: string, recipes: Recipe[], n = 12): Recipe[] {
  return recipes
    .map((r, i) => ({ r, i, s: scoreRecipe(goal, r) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, n)
    .map((x) => x.r);
}

const ROLES: readonly TeamRole[] = ['lead', 'co_owner', 'reviewer', 'sceptic', 'specialist', 'facilitator'];
function asRole(raw: string): TeamRole {
  return (ROLES as readonly string[]).includes(raw) ? (raw as TeamRole) : 'specialist';
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/**
 * The team from the recipe's composition (members missing from the catalog are dropped), each with a voice unique
 * within the team and never the lead's when `voices` is given (the lead and the voice table).
 */
export function teamFrom(recipe: Recipe, persona: (id: string) => Persona | undefined, voices?: { lead: Pick<Lead, 'voice'> | undefined; table: CatalogFull['voices'] }): TeamMember[] {
  const picked: { persona: Persona; role: RecipeRole }[] = [];
  const seen = new Set<string>();
  for (const c of recipe.composition) {
    const p = persona(c.persona_id);
    if (!p || seen.has(p.id)) continue;
    seen.add(p.id);
    picked.push({ persona: p, role: c });
  }
  const assigned = voices ? assignVoices(picked.map((x) => ({ persona: x.persona, ...(x.role.voice_override ? { override: x.role.voice_override } : {}) })), voices.lead, voices.table) : null;
  return picked.map(({ persona: p, role: c }) => {
    const voice = assigned?.get(p.id);
    return { personaId: p.id, name: p.name, title: p.title, role: asRole(c.role), why: (c.why ?? p.one_liner).slice(0, 300), ...(voice ? { voice } : {}) };
  });
}

/**
 * The team the owner chose (the people in the room, or the coworker they asked at their desk): the first leads, the
 * rest keep their playbook role when the playbook has them (a second lead co-owns). Someone working alone gets the
 * playbook's people up to three, so their work is still reviewed. Falls back to the playbook's team when nobody chosen
 * is in the catalog.
 */
export function teamWith(recipe: Recipe, people: readonly string[], persona: (id: string) => Persona | undefined, voices?: { lead: Pick<Lead, 'voice'> | undefined; table: CatalogFull['voices'] }): TeamMember[] {
  const seen = new Set<string>();
  const own: Persona[] = [];
  for (const id of people) {
    const p = persona(id);
    if (!p || seen.has(p.id)) continue;
    seen.add(p.id);
    own.push(p);
  }
  if (!own.length) return teamFrom(recipe, persona, voices);
  const inRecipe = (id: string) => recipe.composition.find((c) => c.persona_id === id);
  const picked: { persona: Persona; role: RecipeRole }[] = own.map((p, i) => {
    const c = inRecipe(p.id);
    const role = i === 0 ? 'lead' : c?.role === 'lead' ? 'co_owner' : (c?.role ?? 'specialist');
    return { persona: p, role: { persona_id: p.id, role, why: c?.why ?? p.one_liner, ...(c?.voice_override ? { voice_override: c.voice_override } : {}) } };
  });
  if (picked.length === 1) {
    for (const c of recipe.composition) {
      if (picked.length >= 3) break;
      const p = persona(c.persona_id);
      if (!p || seen.has(p.id)) continue;
      seen.add(p.id);
      picked.push({ persona: p, role: { ...c, role: c.role === 'lead' ? 'co_owner' : c.role } });
    }
  }
  const assigned = voices ? assignVoices(picked.map((x) => ({ persona: x.persona, ...(x.role.voice_override ? { override: x.role.voice_override } : {}) })), voices.lead, voices.table) : null;
  return picked.map(({ persona: p, role: c }) => {
    const voice = assigned?.get(p.id);
    return { personaId: p.id, name: p.name, title: p.title, role: asRole(c.role), why: (c.why ?? p.one_liner).slice(0, 300), ...(voice ? { voice } : {}) };
  });
}

/** "Femi leads, with Kavya and Kemar. Ruth is our skeptic and checks our claims." */
export function staffingNote(team: TeamMember[], recipeName: string | null): string {
  const lead = team.find((m) => m.role === 'lead') ?? team[0];
  const sceptic = team.find((m) => m.role === 'sceptic');
  const rest = team.filter((m) => m !== lead && m !== sceptic).map((m) => firstName(m.name));
  if (!lead) return 'I could not staff this one.';
  const list = rest.length > 1 ? `${rest.slice(0, -1).join(', ')} and ${rest[rest.length - 1]}` : rest[0];
  const with_ = list ? `, with ${list}` : '';
  const scep = sceptic ? ` ${firstName(sceptic.name)} is our skeptic and checks our claims.` : '';
  const how = recipeName ? ` (our “${recipeName}” playbook)` : '';
  return `${firstName(lead.name)} leads${with_}${how}.${scep}`;
}

/**
 * The plan: the recipe's skeleton, owners and reviewers kept to the team (a step whose owner is missing goes to the
 * lead; unknown reviewers are dropped; dependencies on missing steps are dropped). At most 8 steps.
 */
export function stepsFrom(recipe: Recipe, team: TeamMember[], goal: string): ProjectStep[] {
  const members = new Set(team.map((m) => m.personaId));
  const lead = team.find((m) => m.role === 'lead')?.personaId ?? team[0]?.personaId ?? '';
  const sceptic = team.find((m) => m.role === 'sceptic')?.personaId;
  const skeleton = recipe.plan_skeleton.slice(0, 8);
  const ids = new Set(skeleton.map((s) => s.id));
  return skeleton.map((s) => {
    const ownerId = members.has(s.owner_persona_id) ? s.owner_persona_id : lead;
    let reviewerIds = (s.reviewer_persona_ids ?? []).filter((r) => members.has(r) && r !== ownerId);
    if (!reviewerIds.length) {
      const fallback = sceptic && sceptic !== ownerId ? sceptic : team.find((m) => m.personaId !== ownerId)?.personaId;
      reviewerIds = fallback ? [fallback] : [];
    }
    return {
      id: s.id,
      title: s.title,
      brief: `${(s.brief ?? '').trim()}\n\nThe owner's goal for this project: ${goal}`.trim(),
      acceptance: (s.acceptance ?? 'The reviewer approves the work.').trim(),
      ownerId,
      reviewerIds: reviewerIds.slice(0, 1),
      dependsOn: (s.depends_on ?? []).filter((d) => ids.has(d) && d !== s.id),
      status: 'waiting' as const,
    };
  });
}

/** Steps whose dependencies are all done and that have not started. */
export function readySteps(steps: ProjectStep[]): ProjectStep[] {
  const done = new Set(steps.filter((s) => s.status === 'done').map((s) => s.id));
  return steps.filter((s) => s.status === 'waiting' && s.dependsOn.every((d) => done.has(d)));
}

/** A short project title from the goal when the model gives none ("Launch the spring menu"). */
export function titleFromGoal(goal: string): string {
  const clean = goal
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(please|can you|could you|i need( you)? to|help me|let's|lets)\s+/i, '')
    // "Put together a team to launch…" → "Launch…": the team is implied by the project.
    .replace(/^(put together|assemble|staff|spin up|pull together|get|hire|build)( me)? (a |the )?(small |quick |little )?(team|crew|squad) (to|for|that can|who can|on)\s+/i, '');
  const first = clean.split(/(?<=[.!?])\s/)[0] ?? clean;
  const t = first.length > 60 ? `${first.slice(0, 57).trimEnd()}…` : first;
  return t.charAt(0).toUpperCase() + t.slice(1).replace(/[.!?]+$/, '');
}

/** Steps that run at once in a project (the team host's MAX_PARALLEL). */
const PARALLEL = 2;

/**
 * The plan card's forecast: rounds = the longer of the dependency chain and the steps two at a time;
 * each step is work and a review (plus a revision when asked), then the deliverable. Minutes assume a reasoning model
 * (about 1 to 2.5 minutes a round, 0.5 to 1.5 for the deliverable); Mock is faster.
 */
export function forecastOf(steps: readonly Pick<ProjectStep, 'id' | 'dependsOn' | 'reviewerIds'>[]): ProjectForecast {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const depth = new Map<string, number>();
  const depthOf = (id: string, seen: Set<string>): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    if (seen.has(id)) return 1; // a cycle: the host reports it as stuck
    seen.add(id);
    const s = byId.get(id);
    const d = 1 + Math.max(0, ...(s?.dependsOn ?? []).filter((x) => byId.has(x)).map((x) => depthOf(x, seen)));
    depth.set(id, d);
    return d;
  };
  const chain = Math.max(0, ...steps.map((s) => depthOf(s.id, new Set())));
  const rounds = Math.max(chain, Math.ceil(steps.length / PARALLEL));
  const reviewed = steps.filter((s) => s.reviewerIds.length > 0).length;
  const modelCalls = { min: steps.length + reviewed + 1, max: steps.length + reviewed * 2 + 1 };
  const minutes = { min: Math.max(1, Math.round(rounds * 1 + 0.5)), max: Math.ceil(rounds * 2.5 + 1.5) };
  return { rounds, modelCalls, minutes };
}

/** "About 4 to 9 minutes once you approve (3 rounds, 9 to 13 model calls)." */
export function forecastSentence(f: ProjectForecast): string {
  return `About ${f.minutes.min} to ${f.minutes.max} minutes once you approve (${f.rounds} round${f.rounds === 1 ? '' : 's'} of work, ${f.modelCalls.min} to ${f.modelCalls.max} model calls).`;
}

// ── voices (FORMATION §Voices, formation.json voice_assignment) ──────────────────────

type VoiceProvider = 'openai' | 'xai';
const PRESENTATION: Record<string, string[]> = { 'she/her': ['feminine'], 'he/him': ['masculine'], 'they/them': ['neutral', 'feminine', 'masculine'] };

/** First matching in claim order: each member takes their earliest free candidate unless that strands someone later. */
function match(candidates: string[][]): (string | null)[] | null {
  const out: (string | null)[] = new Array(candidates.length).fill(null);
  const taken = new Set<string>();
  const go = (i: number): boolean => {
    if (i === candidates.length) return true;
    for (const c of candidates[i]!) {
      if (taken.has(c)) continue;
      taken.add(c);
      out[i] = c;
      if (go(i + 1)) return true;
      taken.delete(c);
    }
    return false;
  };
  return go(0) ? out : null;
}

/**
 * Resolve each member's voice so nobody on the team sounds like anyone else or like the lead. Per provider, as a
 * matching over [recipe override | voice, ...alternates]; only when no matching exists, add every free voice of the
 * member's presentation. If even that fails (more members of one presentation than the provider has voices), the
 * unmatched keep their own voice.
 */
export function assignVoices(
  members: readonly { persona: Pick<Persona, 'id' | 'voice' | 'pronouns'>; override?: RecipeRole['voice_override'] }[],
  lead: Pick<Lead, 'voice'> | undefined,
  table: CatalogFull['voices'],
): Map<string, NonNullable<TeamMember['voice']>> {
  const out = new Map<string, NonNullable<TeamMember['voice']>>();
  const pick: Record<VoiceProvider, (string | null)[]> = { openai: [], xai: [] };
  const unique: Record<VoiceProvider, boolean> = { openai: true, xai: true };
  for (const provider of ['openai', 'xai'] as const) {
    const reserved = new Set(lead ? (provider === 'openai' ? [lead.voice.openai_tts, lead.voice.openai_realtime, lead.voice.openai_live] : [lead.voice.xai_tts, lead.voice.xai_realtime]).filter(Boolean) : []);
    const own = members.map((m) => {
      const v = m.persona.voice[provider];
      const pinned = m.override?.[provider];
      return [...new Set([...(pinned ? [pinned] : []), v.voice, ...(v.alternates ?? [])])].filter((c) => !reserved.has(c));
    });
    let result = match(own);
    if (!result) {
      const voices = Object.entries(table?.[provider] ?? {});
      const wide = members.map((m, i) => {
        const fits = PRESENTATION[m.persona.pronouns] ?? ['neutral'];
        const extra = voices.filter(([id, pres]) => fits.includes(pres) && !reserved.has(id)).map(([id]) => id);
        return [...new Set([...own[i]!, ...extra])];
      });
      result = match(wide);
    }
    pick[provider] = result ?? members.map(() => null);
    unique[provider] = !!result;
  }
  // Over capacity on one provider: play the team through the one that keeps everyone distinct.
  const prefer = unique.openai === unique.xai ? undefined : unique.openai ? ('openai' as const) : ('xai' as const);
  members.forEach((m, i) => out.set(m.persona.id, { openai: pick.openai[i] ?? m.persona.voice.openai.voice, xai: pick.xai[i] ?? m.persona.voice.xai.voice, ...(prefer ? { prefer } : {}) }));
  return out;
}

// ── the planner's plan, normalised (biz-bot plan.js normalizePlan / breakCycles / validateTaskEdit) ───────────────

export const MAX_PLANNED_STEPS = 8;
/** Steps a plan may grow to by the owner's edits. */
export const MAX_EDITED_STEPS = 12;

const sanitizeId = (raw: unknown, i: number) => (typeof raw === 'string' ? raw : '').replace(/[^\w-]/g, '').slice(0, 40) || `t${i + 1}`;
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\r\n/g, '\n').trim().slice(0, max) : '');

/** Drop dependency edges that close a cycle (depth-first, keeping the first-seen direction). */
export function breakCycles(steps: ProjectStep[]): ProjectStep[] {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const state = new Map<string, 'visiting' | 'done'>();
  const keep = new Map<string, string[]>();
  const visit = (s: ProjectStep) => {
    state.set(s.id, 'visiting');
    const deps: string[] = [];
    for (const d of s.dependsOn) {
      const t = byId.get(d);
      if (!t || state.get(d) === 'visiting') continue; // unknown, or a back edge: dropped
      if (state.get(d) !== 'done') visit(t);
      deps.push(d);
    }
    keep.set(s.id, deps);
    state.set(s.id, 'done');
  };
  for (const s of steps) if (!state.has(s.id)) visit(s);
  return steps.map((s) => ({ ...s, dependsOn: keep.get(s.id) ?? [] }));
}

/** Does giving `stepId` these dependencies create a cycle? */
export function wouldCycle(steps: readonly ProjectStep[], stepId: string, deps: readonly string[]): boolean {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const seen = new Set<string>();
  const reaches = (from: string): boolean => {
    if (from === stepId) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    return (byId.get(from)?.dependsOn ?? []).some(reaches);
  };
  return deps.some(reaches);
}

export interface NormalizedPlan {
  steps: ProjectStep[];
  kind: DeliverableKind;
  finisherId: string;
  deliverableTitle: string;
}

/**
 * The planner's output made safe to run: at most 8 tasks with unique ids; owners and reviewers kept to the team
 * (owners 1–3, the first the lead; reviewers 0–2 who are not owners; a task left without owners gets one round-robin);
 * dependencies remapped to kept ids, self and unknown ones dropped, cycles broken; the finisher is never the sceptic.
 * Null when nothing usable came back (the playbook's plan stands).
 */
export function normalizePlan(raw: unknown, team: readonly TeamMember[], goal: string, preferKind?: DeliverableKind): NormalizedPlan | null {
  const r = (raw ?? {}) as { deliverable?: { kind?: unknown; title?: unknown }; finisher?: unknown; tasks?: unknown };
  const tasks = Array.isArray(r.tasks) ? (r.tasks as Record<string, unknown>[]).slice(0, MAX_PLANNED_STEPS) : [];
  const ids = team.map((m) => m.personaId);
  const onTeam = new Set(ids);
  const idMap = new Map<string, string>();
  const used = new Set<string>();
  const steps: ProjectStep[] = [];
  tasks.forEach((t, i) => {
    const title = str(t.title, 80);
    const brief = str(t.brief, 1500);
    if (!title || !brief) return;
    let id = sanitizeId(t.id, i);
    while (used.has(id)) id = `${id}_${i}`;
    used.add(id);
    if (typeof t.id === 'string') idMap.set(t.id, id);
    const owners = [...new Set((Array.isArray(t.owners) ? t.owners : []).filter((o): o is string => typeof o === 'string' && onTeam.has(o)))].slice(0, 3);
    if (!owners.length) owners.push(ids[i % ids.length]!);
    const reviewers = [...new Set((Array.isArray(t.reviewers) ? t.reviewers : []).filter((o): o is string => typeof o === 'string' && onTeam.has(o) && !owners.includes(o)))].slice(0, 2);
    steps.push({
      id,
      title,
      brief: brief.includes("The owner's goal for this project:") ? brief : `${brief}\n\nThe owner's goal for this project: ${goal}`,
      acceptance: str(t.acceptance, 600) || 'The reviewers approve the work.',
      ownerId: owners[0]!,
      ...(owners.length > 1 ? { coOwnerIds: owners.slice(1) } : {}),
      reviewerIds: reviewers,
      dependsOn: (Array.isArray(t.dependsOn) ? t.dependsOn : []).filter((d): d is string => typeof d === 'string'),
      status: 'waiting',
    });
  });
  if (steps.length < 2) return null;
  for (const s of steps) s.dependsOn = [...new Set(s.dependsOn.map((d) => idMap.get(d) ?? d).filter((d) => d !== s.id && used.has(d)))];
  const kinds: DeliverableKind[] = ['document', 'web', 'code'];
  const rawKind = r.deliverable?.kind;
  const kind = preferKind ?? (kinds.includes(rawKind as DeliverableKind) ? (rawKind as DeliverableKind) : 'document');
  const sceptic = team.find((m) => m.role === 'sceptic')?.personaId;
  const lead = team.find((m) => m.role === 'lead')?.personaId ?? ids[0]!;
  const finisher = typeof r.finisher === 'string' && onTeam.has(r.finisher) && r.finisher !== sceptic ? r.finisher : lead;
  return { steps: breakCycles(steps), kind, finisherId: finisher, deliverableTitle: str(r.deliverable?.title, 120) };
}

/** Owners of a step, lead first. */
export const ownersOf = (s: Pick<ProjectStep, 'ownerId' | 'coOwnerIds'>): string[] => [s.ownerId, ...(s.coOwnerIds ?? [])];

/** Validate an owner's edit of a step (biz-bot activities.js validateTaskEdit). Returns the sentence, or null when fine. */
export function stepEditError(edit: { title?: string; brief?: string; acceptance?: string; ownerIds?: string[]; reviewerIds?: string[]; dependsOn?: string[] }, ctx: { steps: readonly ProjectStep[]; team: readonly TeamMember[]; stepId: string | null }): string | null {
  const onTeam = new Set(ctx.team.map((m) => m.personaId));
  if (edit.title !== undefined && !edit.title.trim()) return 'A step needs a title.';
  if (edit.title !== undefined && edit.title.length > 100) return 'Keep the title under 100 characters.';
  if (edit.brief !== undefined && !edit.brief.trim()) return 'A step needs a brief.';
  if (edit.brief !== undefined && edit.brief.length > 12_000) return 'Keep the brief under 12,000 characters.';
  if (edit.acceptance !== undefined && !edit.acceptance.trim()) return 'Say how to tell the step is done.';
  if (edit.acceptance !== undefined && edit.acceptance.length > 2000) return 'Keep "done when" under 2,000 characters.';
  if (edit.ownerIds !== undefined) {
    if (!edit.ownerIds.length || edit.ownerIds.length > 3) return 'A step has one to three owners (the first leads).';
    if (edit.ownerIds.some((o) => !onTeam.has(o))) return 'Owners must be on the team.';
  }
  const owners = edit.ownerIds ?? (ctx.stepId ? ownersOf(ctx.steps.find((s) => s.id === ctx.stepId)!) : []);
  if (edit.reviewerIds !== undefined) {
    if (edit.reviewerIds.length > 2) return 'A step has at most two reviewers.';
    if (edit.reviewerIds.some((r) => !onTeam.has(r))) return 'Reviewers must be on the team.';
    if (edit.reviewerIds.some((r) => owners.includes(r))) return 'A reviewer cannot also own the step.';
  }
  if (edit.dependsOn !== undefined) {
    const ids = new Set(ctx.steps.map((s) => s.id));
    if (edit.dependsOn.some((d) => !ids.has(d) || d === ctx.stepId)) return 'A step can only depend on other steps in the plan.';
    if (ctx.stepId && wouldCycle(ctx.steps, ctx.stepId, edit.dependsOn)) return 'Those dependencies create a cycle. Choose an earlier, independent step.';
  }
  return null;
}
