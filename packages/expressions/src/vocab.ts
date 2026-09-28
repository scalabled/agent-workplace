// Vocabulary of the living-workforce layer (docs/LIVING-WORKFORCE.md §3, §6, §11.2).
// Ids, unions and the constants every other module shares. Pure data, no I/O.

export type IntentId =
  | 'backchannel' | 'acknowledge' | 'thinking_filler' | 'holding_filler' | 'deferral'
  | 'laugh' | 'surprise' | 'delight' | 'concern' | 'sympathy' | 'encouragement'
  | 'gratitude_reply' | 'apology' | 'yield_floor' | 'juggling' | 'back_with_you'
  | 'greeting' | 'passing_by' | 'micro_status' | 'quip' | 'sign_off'
  | 'handoff_give' | 'handoff_take' | 'ask_coworker' | 'answer_coworker' | 'share_result'
  | 'review_approve' | 'review_changes' | 'sidetalk_reply'
  | 'celebrate' | 'blocked' | 'unblocked' | 'oops';
export type IntentFamily = 'conversation' | 'presence' | 'sidetalk' | 'work';
export type ArchetypeId =
  | 'warm' | 'dry-wit' | 'energetic' | 'calm-steady' | 'blunt' | 'playful'
  | 'meticulous' | 'gentle' | 'hustler' | 'visionary' | 'analytical' | 'veteran';
export type SlotId =
  | 'owner_name' | 'chief_name' | 'self_name' | 'coworker' | 'project' | 'client' | 'step_label' | 'artifact'
  | 'done' | 'total' | 'eta' | 'other_thread' | 'blocker' | 'finding_count' | 'weekday' | 'part_of_day' | 'gist';
export type Ambience = 'quiet' | 'lively' | 'buzzing';
export type AmbienceLevel = 'off' | 'face' | 'bubble' | 'full';
export type TtsProvider = 'xai' | 'openai' | 'browser' | 'mock';
export type PaletteState = 'resting' | 'thinking' | 'delighted' | 'concerned';
export type FaceGesture =
  | 'none' | 'nod' | 'double_nod' | 'look_up' | 'brow_flash' | 'head_tilt' | 'smile' | 'wince' | 'exhale' | 'glance' | 'still';
export type Surface = 'talk' | 'desk' | 'floor' | 'room' | 'elsewhere';
export type PrevoiceTier = 'p0' | 'p1' | 'p2' | 'runtime';
export type Mailbox = 'owner' | 'floor' | 'coworker' | 'work' | 'ambient';
export type SliderKey = 'warmth' | 'directness' | 'formality' | 'humor' | 'risk_appetite' | 'detail' | 'pace';
export type Sliders = Record<SliderKey, number>;
export type TeamRole = 'lead' | 'co_owner' | 'reviewer' | 'sceptic' | 'facilitator' | 'specialist';
export type Seniority = 'specialist' | 'senior' | 'lead' | 'principal';

export interface Mood { valence: number; energy: number }

export type MoodEventKind =
  | 'deliverable.accepted' | 'deliverable.accepted_edited' | 'verdict.approve' | 'verdict.changes' | 'verdict.block'
  | 'job.done' | 'step.retry' | 'job.failed' | 'step.blocked' | 'step.unblocked' | 'decision.approved' | 'decision.declined'
  | 'project.done' | 'teammate.win' | 'owner.thanks' | 'owner.praise' | 'owner.frustrated' | 'owner.distress'
  | 'hired' | 'everyone.stop' | 'work.hour';

export const INTENT_IDS: readonly IntentId[] = [
  'backchannel', 'acknowledge', 'thinking_filler', 'holding_filler', 'deferral',
  'laugh', 'surprise', 'delight', 'concern', 'sympathy', 'encouragement',
  'gratitude_reply', 'apology', 'yield_floor', 'juggling', 'back_with_you',
  'greeting', 'passing_by', 'micro_status', 'quip', 'sign_off',
  'handoff_give', 'handoff_take', 'ask_coworker', 'answer_coworker', 'share_result',
  'review_approve', 'review_changes', 'sidetalk_reply',
  'celebrate', 'blocked', 'unblocked', 'oops',
];

export const ARCHETYPE_IDS: readonly ArchetypeId[] = [
  'warm', 'dry-wit', 'energetic', 'calm-steady', 'blunt', 'playful',
  'meticulous', 'gentle', 'hustler', 'visionary', 'analytical', 'veteran',
];

export const SLOT_IDS: readonly SlotId[] = [
  'owner_name', 'chief_name', 'self_name', 'coworker', 'project', 'client', 'step_label', 'artifact',
  'done', 'total', 'eta', 'other_thread', 'blocker', 'finding_count', 'weekday', 'part_of_day', 'gist',
];

export const SLIDER_KEYS: readonly SliderKey[] = ['warmth', 'directness', 'formality', 'humor', 'risk_appetite', 'detail', 'pace'];

export const AMBIENCES: readonly Ambience[] = ['quiet', 'lively', 'buzzing'];

export const LAUGH_KINDS = ['chuckle', 'warm_laugh', 'belly_laugh', 'giggle', 'snort', 'breathy', 'dry_huff', 'silent_smile'] as const;

/** owner 0 · floor 1 · coworker 2 · work 3 · ambient 4 (§2.1). Lower is more urgent. */
export const MAILBOX_PRIORITY: Readonly<Record<Mailbox, number>> = Object.freeze({
  owner: 0,
  floor: 1,
  coworker: 2,
  work: 3,
  ambient: 4,
});

/** Mood event deltas (§6.2). Applied as ρ · scale · Δ with soft saturation. */
export const MOOD_DELTAS: Readonly<Record<MoodEventKind, Mood>> = Object.freeze({
  'deliverable.accepted': { valence: 0.35, energy: 0.2 },
  'deliverable.accepted_edited': { valence: 0.15, energy: 0.05 },
  'verdict.approve': { valence: 0.2, energy: 0.1 },
  'verdict.changes': { valence: -0.12, energy: 0.05 },
  'verdict.block': { valence: -0.25, energy: 0.05 },
  'job.done': { valence: 0.12, energy: 0.05 },
  'step.retry': { valence: -0.05, energy: -0.02 },
  'job.failed': { valence: -0.2, energy: -0.1 },
  'step.blocked': { valence: -0.25, energy: -0.1 },
  'step.unblocked': { valence: 0.2, energy: 0.15 },
  'decision.approved': { valence: 0.15, energy: 0.05 },
  'decision.declined': { valence: -0.05, energy: 0 },
  'project.done': { valence: 0.3, energy: 0.25 },
  'teammate.win': { valence: 0.05, energy: 0.03 },
  'owner.thanks': { valence: 0.15, energy: 0.05 },
  'owner.praise': { valence: 0.25, energy: 0.1 },
  'owner.frustrated': { valence: -0.05, energy: 0.1 },
  'owner.distress': { valence: -0.1, energy: -0.15 },
  hired: { valence: 0.2, energy: 0.3 },
  'everyone.stop': { valence: -0.1, energy: -0.35 },
  'work.hour': { valence: 0, energy: -0.08 },
});

/** Decay half-lives toward the baseline: valence 45 min, energy 20 min (§6.2). */
export const MOOD_HALF_LIFE_MS: Readonly<{ valence: number; energy: number }> = Object.freeze({
  valence: 45 * 60_000,
  energy: 20 * 60_000,
});

/** Owner-directed reaction intents; at most `max_reactions_per_turn` of them per owner turn (§1.3). */
export const REACTION_INTENTS: readonly IntentId[] = ['laugh', 'surprise', 'delight', 'concern', 'sympathy', 'encouragement', 'apology'];

/** Intents that open a side-talk thread (§8.3). */
export const SIDETALK_OPENERS: readonly IntentId[] = ['handoff_give', 'ask_coworker', 'answer_coworker', 'share_result', 'review_approve', 'review_changes'];

/**
 * Phrases filtered out of every candidate line for every agent, on top of each persona's `never_says`
 * (§5.1 "persona list + global banned list"): corporate filler and AI boilerplate that no likeable coworker says.
 */
export const GLOBAL_NEVER_SAYS: readonly string[] = [
  'synergy',
  'synergies',
  'circle back',
  'touch base',
  'low-hanging fruit',
  'per my last',
  'as an ai language model',
  'as a large language model',
];

/**
 * Words no agent says to the owner (E12): they echo the sniffer's own self-doubt cues ("am I crazy?") or read as
 * dismissive. Filtered out of every owner-facing candidate line; side-talk between coworkers is not affected.
 */
export const GLOBAL_NEVER_SAYS_OWNER_FACING: readonly string[] = ['crazy', 'dumb', 'insane', 'lame', 'calm down'];

/** Intents that play as Floor bubbles on a hover (§8.1); one Floor gap spaces all of them (E8). */
export const FLOOR_INTENTS: readonly IntentId[] = ['passing_by', 'micro_status', 'quip', 'blocked', 'unblocked'];

/** Who unblocked a step (E18): the owner (or a decision the owner approved), a coworker's answer, or the system (retry, connector). */
export type UnblockedBy = 'owner' | 'coworker' | 'system';

/** Tone of the owner's last turn as the sniffer reads it (E4). */
export type OwnerTone = 'positive' | 'neutral' | 'negative';

export function isIntentId(x: unknown): x is IntentId {
  return typeof x === 'string' && (INTENT_IDS as readonly string[]).includes(x);
}

export function isArchetypeId(x: unknown): x is ArchetypeId {
  return typeof x === 'string' && (ARCHETYPE_IDS as readonly string[]).includes(x);
}

export function isSlotId(x: unknown): x is SlotId {
  return typeof x === 'string' && (SLOT_IDS as readonly string[]).includes(x);
}
