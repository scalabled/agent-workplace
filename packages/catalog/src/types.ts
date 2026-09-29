/**
 * Typed views of the read-only catalog in /catalog (see catalog/SCHEMA.md; the JSON Schemas win).
 * Only the fields Headcount code reads are typed precisely; every record keeps its remaining
 * fields through an index signature so nothing is lost when the catalog grows.
 */

export type Pronouns = 'she/her' | 'he/him' | 'they/them';
export type CatalogTier = 'deep' | 'balanced' | 'fast';

export interface Sliders {
  warmth: number;
  directness: number;
  formality: number;
  humor: number;
  risk_appetite: number;
  detail: number;
  pace: number;
}

/** oncloudnine procedural PersonaSettings look fields (drive the procedural face fallback). */
export interface ProceduralLook {
  [field: string]: number | string | boolean | null | undefined;
}

export interface Appearance {
  skin_tone?: string;
  complexion_details?: string[];
  hair?: { style?: string; texture?: string; color?: string } | null;
  head_covering?: string | null;
  facial_hair?: string | null;
  eyewear?: string | null;
  accessories?: (string | null)[];
  attire?: string;
  alt_text?: string;
  procedural?: ProceduralLook;
  [extra: string]: unknown;
}

export interface CatalogAvatar {
  portrait_prompt: string;
  appearance: Appearance;
  accent_color: string;
  expression_palette?: Record<string, string>;
  signature_look?: string;
  [extra: string]: unknown;
}

/** Persona (coworker) voice: provider voice ids per surface. */
export interface PersonaVoice {
  openai: { voice: string; alternates?: string[] };
  xai: { voice: string; alternates?: string[] };
  speed: number;
  delivery_notes?: string;
  tts_instructions?: string;
}

/** Lead (Chief of Staff) voice: realtime + TTS ids chosen to sound the same live and in playback. */
export interface LeadVoice {
  openai_realtime: string;
  openai_live?: string;
  xai_realtime: string;
  openai_tts: string;
  xai_tts: string;
  speed: number;
  delivery_notes?: string;
  tts_instructions?: string;
}

export interface OriginMoment {
  title: string;
  story: string;
  share_when: string;
}

export interface Lead {
  id: string;
  name: string;
  handle: string;
  pronouns: Pronouns;
  age_range: string;
  heritage: string;
  is_ai: true;
  title: string;
  archetype: string;
  tagline: string;
  tone: string;
  personality: {
    values: string[];
    temperament: string;
    humor: string;
    pushback_style: string;
    bad_news_style: string;
    celebration_style: string;
    traits: string[];
    sliders: Sliders;
    quirks: string[];
    pet_peeves: string[];
  };
  defaults: {
    proactivity: 'off' | 'quiet' | 'on';
    autonomy: number;
    verbosity: 'terse' | 'balanced' | 'detailed';
    check_in_cadence: string;
  };
  communication: {
    greeting: string;
    morning_brief_opening: string;
    delegating: string;
    asking_approval: string;
    reporting_failure: string;
    celebrating: string;
    signature_phrases: string[];
    words_they_avoid: string[];
  };
  backstory: string;
  origin_moments: OriginMoment[];
  relatability_hooks: { owner_kind: string; connection: string }[];
  rapport_topics: string[];
  staffing_style: {
    approach: string;
    default_size: 'lean' | 'balanced' | 'thorough';
    favourite_persona_ids: string[];
    always_includes_roles: string[];
  };
  rituals?: Record<string, unknown>;
  voice: LeadVoice;
  avatar: CatalogAvatar;
  best_for_owners_who: string[];
  might_not_suit_owners_who: string[];
  honesty_note: string;
  operating_principles: string[];
  guardrails: string[];
  rules?: unknown;
  version?: number;
  [extra: string]: unknown;
}

export interface Persona {
  id: string;
  handle: string;
  name: string;
  pronouns: Pronouns;
  age_range: string;
  heritage: string;
  is_ai: true;
  title: string;
  department: string;
  seniority: 'specialist' | 'senior' | 'lead' | 'principal';
  one_liner: string;
  description: string;
  expertise: string[];
  personality: {
    traits: string[];
    sliders: Sliders;
    communication_style: string;
    quirks: string[];
    pet_peeves: string[];
  };
  backstory: string;
  intro_line: string;
  welcome: string;
  instructions: string;
  team_roles: string[];
  skills: { primary: string[]; secondary: string[] };
  tools: string[];
  model_policy: { tier: CatalogTier; needs: string[]; provider_preference: string[]; reasoning_effort?: string };
  voice: PersonaVoice;
  avatar: CatalogAvatar;
  regulated_domains: string[];
  industries: string[];
  tags: string[];
  [extra: string]: unknown;
}

/** What the web bundle carries per coworker (Floor, Directory, profiles). */
export interface PersonaSlim {
  id: string;
  name: string;
  handle: string;
  pronouns: Pronouns;
  title: string;
  department: string;
  seniority: Persona['seniority'];
  one_liner: string;
  backstory: string;
  intro_line: string;
  skills: { primary: string[]; secondary: string[] };
  voice: PersonaVoice;
  avatar: {
    appearance: Appearance;
    accent_color: string;
    portrait_prompt: string;
  };
}

export interface Department {
  id: string;
  name: string;
  icon: string;
  description: string;
  /** Persona ids in taxonomy order (only records that loaded). */
  personaIds: string[];
}

export interface SkillIndexEntry {
  id: string;
  name: string;
  icon: string;
  category: string;
  one_liner: string;
}

export interface Skill {
  id: string;
  name: string;
  icon: string;
  category: string;
  description: string;
  when: string;
  tools: string[];
  instructions: string;
  [extra: string]: unknown;
}

export interface MatchQuizOption {
  id: string;
  label: string;
  weights: Record<string, number>;
}

export interface MatchQuizQuestion {
  id: string;
  prompt: string;
  kind: 'single' | 'multi' | 'scale';
  options?: MatchQuizOption[];
  scale?: {
    min: number;
    max: number;
    low_label: string;
    high_label: string;
    weights_low: Record<string, number>;
    weights_high: Record<string, number>;
  };
}

export interface MatchQuiz {
  version: number;
  intro: string;
  questions: MatchQuizQuestion[];
  scoring: { method: string; normalize_by_max_possible?: boolean; show_top: number; tie_breaker?: string };
  results: Record<string, { headline: string; why_you_match: string }>;
  try_before_choosing?: { voice_preview_line?: string; sample_prompts?: string[] };
  [extra: string]: unknown;
}

export interface CatalogReport {
  sourceHash: string;
  counts: { departments: number; personas: number; skills: number; leads: number; recipes: number };
  warnings: string[];
}

/** Worker bundle: everything, full records. */
export interface CatalogFull {
  kind: 'full';
  sourceHash: string;
  departments: Department[];
  leads: Lead[];
  personas: Persona[];
  skills: Skill[];
  matchQuiz: MatchQuiz | null;
  recipes: Record<string, unknown>[];
  formation: Record<string, unknown> | null;
  honestyPolicy: unknown;
  /** TTS voice id → presentation (feminine, masculine, neutral) per provider, from the taxonomy. */
  voices?: { openai: Record<string, string>; xai: Record<string, string> };
  report: CatalogReport;
}

/** Web bundle: leads in full (the picker needs backstory, voice, quiz results), personas slim. */
export interface CatalogSlim {
  kind: 'slim';
  sourceHash: string;
  departments: Department[];
  leads: Lead[];
  personas: PersonaSlim[];
  skills: SkillIndexEntry[];
  matchQuiz: MatchQuiz | null;
}
