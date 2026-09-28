// Test support for @headcount/expressions and its hosts (`@headcount/expressions/testing`): a small but
// real fixture catalog (the live intents.json and archetypes.json plus fixture packs), agent profiles,
// grounding-state builders, a fake clock and fake runner ports. Not used at runtime.
import type { VoiceRef } from '@headcount/protocol';
import archetypesJson from '../../../catalog/expressions/archetypes.json';
import intentsJson from '../../../catalog/expressions/intents.json';
import { sniffOwnerText } from './affect';
import { buildAgentIndex, compileCatalog } from './catalog';
import { createChatterBudget } from './gate';
import { planPrevoice } from './prevoice';
import { createRecencyMemory } from './recency';
import { createReflexRunner } from './runner';
import type {
  AgentExpressionProfile, AgentIndex, ArchetypePack, ArchetypesFile, AttentionView, AudioBus, ChatterBudget, ClipManifest, ClipStore,
  CommonFills, CompiledCatalog, ExpressionBias, ExpressionCatalogInput, FaceCue, GroundingState, IntentsFile, LineDef, PreparedClip,
  RecencyMemory, ReflexAudioPort, ReflexCaptionPort, ReflexFacePort, ReflexPlayHandle, ReflexPlayRequest, ReflexRunner, ReflexSettings,
  ReflexTelemetry, RenderRequest, SignatureFile, TtsProvider,
} from './types';
import type { Ambience, ArchetypeId, IntentId, Mood, Surface } from './vocab';

export const intentsFile = intentsJson as unknown as IntentsFile;
export const archetypesFile = archetypesJson as unknown as ArchetypesFile;

// ── fixture content (same quality bar as catalog content) ───────────────────────
type Extra = Omit<LineDef, 'id' | 'text'>;
type Spec = string | [string, Extra];

function pack(id: ArchetypeId, intents: Partial<Record<IntentId, Spec[]>>): ArchetypePack {
  const out: Partial<Record<IntentId, LineDef[]>> = {};
  for (const [intent, specs] of Object.entries(intents) as [IntentId, Spec[]][]) {
    out[intent] = specs.map((s, i) => {
      const [text, extra] = typeof s === 'string' ? [s, {}] : s;
      const slots = [...new Set([...text.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]!))];
      return { id: `${id}.${intent}.${String(i + 1).padStart(2, '0')}`, text, ...(slots.length ? { slots } : {}), ...extra } as LineDef;
    });
  }
  return { kind: 'archetype_pack', id, version: 1, intents: out };
}

const x = (xai: string, extra: Extra = {}): Extra => ({ ...extra, tags: { ...(extra.tags ?? {}), xai } });

export const FIXTURE_PACKS: readonly ArchetypePack[] = [
  pack('warm', {
    backchannel: [['mm-hm', x('<soft>mm-hm</soft>')], 'mm', 'right', 'yeah', 'I see', 'okay', ['aw', { mood: { valence: -0.3, energy: -0.3 } }], 'go on'],
    acknowledge: [
      'On it.', ['Of course — on it.', { mood: { valence: 0.4, energy: 0.1 } }], 'Happy to. Give me a moment.', 'Got it, {owner_name}.', 'Sure thing.',
      'Absolutely — on it.',
      ["Noted — I'll fold that in at the next step.", { context: ['steer_queued'] }],
      ['Okay, switching gears.', { context: ['interrupted'] }],
    ],
    thinking_filler: [
      ['Ooh, good question — give me a sec.', { context: ['owner_question'] }], 'Let me have a proper think.', 'Mm, one sec.', ['Hmm. Let me look at that properly.', x('Hmm. [pause] Let me look at that properly.')],
      'Give me a second on that one.',
    ],
    holding_filler: ['Still with you.', "Bear with me — this one has a few moving parts.", ["Still here. Just being careful.", x('<soft>Still here. Just being careful.</soft>')]],
    deferral: [
      ["This one needs a proper look — I'll come back to you in {eta}.", { context: ['eta_known'] }],
      "Let me work on that properly and message you when it's ready.",
      "I'll dig into that in the background and let you know.",
    ],
    laugh: [
      ["That's a good one.", x("[laugh] That's a good one.")],
      ['Oh, I like that.', x('<soft>[laugh]</soft> Oh, I like that.')],
      ["You're on form today.", x("[laugh] You're on form today.", { mood: { valence: 0.5, energy: 0.3 } })],
    ],
    surprise: ['Oh! Really?', 'Oh, wow.', 'Wait — really?'],
    delight: ["Oh, that's lovely news.", "Oh, {owner_name}, that's brilliant.", ['Yes! Love that.', x('Yes! [laugh] Love that.')], "That's genuinely great to hear."],
    concern: ['Oof. Okay.', "Ah. That's a tough one.", ["Hm. Okay — let's look at it.", x("<soft>Hm. Okay — let's look at it.</soft>")]],
    sympathy: [
      ["Oh, that's a lot.", x("<soft>Oh, that's a lot.</soft>", { mood: { valence: -0.1, energy: -0.2 } })],
      'Long one, huh.',
      ["I'm sorry, {owner_name}.", x("<soft>I'm sorry, {owner_name}.</soft>")],
      "That sounds rough. Let's make it lighter.",
    ],
    encouragement: ["It's a good instinct. Let's test it.", "It's a fair thought — let's look at it together.", 'Worth a shot, {owner_name}.'],
    gratitude_reply: ['Anytime.', 'Happy to help.', 'Of course, {owner_name}.', 'My pleasure.'],
    apology: ['Ah — got it.', 'Sorry, let me fix that.', ['My mistake. One sec.', { context: ['own_error'] }], 'Right, the other one. Okay.'],
    yield_floor: ['Go ahead, {owner_name}.', 'Please — go on.'],
    juggling: [
      'Hang on — finishing a thought in {other_thread}, back in {eta}.',
      'Hold that thought — back in {eta}.',
      "One sec, let me land this — then I'm yours.",
    ],
    back_with_you: ["Okay — I'm all yours.", 'Right, back. Your question?', 'Sorry about that, {owner_name}. Go on.'],
    greeting: [
      ['Morning, {owner_name}.', { context: ['part_of_day:morning'] }],
      'Hey — good {part_of_day}.',
      'Happy {weekday}, {owner_name}.',
      ["Hi {owner_name}, I'm {self_name}. Really good to meet you.", { context: ['first_meeting'] }],
      ['Oh, hello again.', { context: ['returning'] }],
      'Hi! Nice to see you.',
    ],
    passing_by: [
      ['Hi — just {step_label}.', { context: ['working', 'step_ing'] }],
      ['Oh, hey. {step_label}, going nicely.', { context: ['working'] }],
      ['Hey {owner_name}. Busy on {project} today.', { context: ['working'] }],
      ['Quiet desk so far. Anything I can help with?', { context: ['idle'], solicits: true }],
      ['Hi — {self_name}. Nothing on my desk yet.', { context: ['unstaffed'] }],
      ['Still smiling about that last one. Back to {step_label}.', { context: ['after_win', 'working'] }],
      ['All quiet here. Enjoying the calm.', { context: ['idle'] }],
    ],
    micro_status: [
      ['{done} of {total} down.', { context: ['working'] }],
      ['Still on {step_label}.', { context: ['working'] }],
      ['Folded your note in.', { context: ['steer_queued'] }],
      ['{done} of {total} done on {project}.', { context: ['working'] }],
    ],
    quip: [
      ['Spreadsheets and I are getting along today. Mostly.', { context: ['activity:analysis'] }],
      ["Drafts are like pancakes — the first one's just for practice.", { context: ['activity:document'] }],
      ["So many sources. I'm on first-name terms with the footnotes.", { context: ['activity:research'] }],
    ],
    sign_off: ['Talk soon, {owner_name}.', 'Have a lovely {part_of_day}.', 'Catch you later.', ["I'll keep things moving here.", { context: ['working'] }]],
    handoff_give: ["{coworker}, it's all yours —", 'Passing this over, {coworker} —'],
    handoff_take: ['Got it, thanks {coworker}.', 'Lovely — picking it up.'],
    ask_coworker: ['{coworker}, quick one —', 'Hey {coworker}, got a sec?'],
    answer_coworker: ['Sure —', 'Good question. Short answer:'],
    share_result: ['{coworker}, {artifact} is ready for you.', 'Over to you, {coworker} —'],
    review_approve: ['Looks lovely, {coworker}. Nice work.', 'This is solid. Good to go.'],
    review_changes: ['{coworker}, {finding_count} small notes for you.', 'Really close — a couple of tweaks first.'],
    sidetalk_reply: [
      ['Thank you!', { context: ['reply_to:review_approve'] }],
      ['On it, thanks.', { context: ['reply_to:review_changes'] }],
      ['Appreciate it, {coworker}.', { context: ['reply_to:share_result'] }],
      ['Thanks, {coworker}.', { context: ['reply_to:answer_coworker'] }],
      ['What a team.', { context: ['reply_to:celebrate'] }],
    ],
    celebrate: [['Yes! That one feels good.', x('Yes! [laugh] That one feels good.')], "Oh, that's wonderful, {owner_name}.", 'So glad {artifact} worked for you.'],
    blocked: ['Hm. Stuck — {blocker}.', "Small snag: {blocker}. It's in your Inbox."],
    unblocked: [['Phew — back in business.', x('[breath] Phew — back in business.')], ['Unstuck. Thanks, {owner_name}.', { context: ['unblocked_by:owner'] }], 'Unstuck. On we go.'],
    oops: ["Hm, that didn't take — trying again.", 'Oops. Redoing that bit.'],
  }),
  pack('dry-wit', {
    backchannel: ['mm', 'right', 'go on', 'uh-huh', "I'm listening"],
    acknowledge: ['Noted. Doing it now.', 'On it.', 'Right. Leave it with me.', ["Consider it on my list, {owner_name}.", { mood: { valence: 0.2, energy: -0.1 } }]],
    thinking_filler: [['Good question. Annoyingly good.', { context: ['owner_question'], max_per_day: 1 }], 'Hm. Let me actually think.', 'Thinking. It happens.'],
    laugh: [['Fair.', x('<soft>[laugh]</soft> Fair.')], ["Okay, that's good.", x("[laugh] Okay, that's good.")]],
    greeting: ['Morning, {owner_name}.', ['Ah. Hello.', { mood: { valence: 0, energy: -0.2 } }]],
    passing_by: [
      ['Still {step_label}. Riveting, genuinely.', { context: ['working'] }],
      ['Quiet desk. Suspiciously quiet.', { context: ['idle'] }],
      ['Hi. {self_name}. Unassigned, for now.', { context: ['unstaffed'] }],
    ],
    micro_status: [['{done} of {total}. No drama.', { context: ['working'] }]],
    quip: [
      ["Spreadsheet's behaving. Suspiciously.", x("Spreadsheet's behaving. [pause] Suspiciously.", { context: ['activity:analysis'], mood: { valence: 0.3, energy: 0 } })],
      ['Fourteen tabs open. All relevant, allegedly.', { context: ['activity:research'] }],
    ],
    sign_off: ['Right. Until next time.', ["Off you go. I've got this.", { context: ['working'] }]],
    review_changes: ['{coworker}, {finding_count} notes. None of them fatal.'],
    review_approve: ['Nothing to fix. Unsettling, frankly.'],
  }),
  pack('calm-steady', {
    backchannel: ['mm', 'I see', 'mm-hm', ['okay', x('<soft>okay</soft>')]],
    acknowledge: ["Okay. I'll take care of it.", 'Sure. Leave that with me.'],
    thinking_filler: [['Let me think that through.', x('<slow>Let me think that through.</slow>')], 'One moment.'],
    holding_filler: ['Still with you. No rush on my end.'],
    concern: [['Okay. We can work with that.', x('Okay. [pause] We can work with that.', { mood: { valence: -0.2, energy: -0.3 } })]],
    sympathy: [["That's a lot to carry.", x("<soft>That's a lot to carry.</soft>")]],
    passing_by: [['Steady going here — {step_label}.', { context: ['working'] }]],
    greeting: ['Hello, {owner_name}. Good to see you.'],
    sidetalk_reply: [['Thanks. Taking it from here.', { context: ['reply_to:review_changes'] }]],
  }),
  pack('energetic', {
    backchannel: ['yeah!', 'ooh', 'mm, yeah'],
    acknowledge: [['Ooh, yes — on it!', { mood: { valence: 0.5, energy: 0.7 }, context: ['!owner_tone:negative'] }], "Yep! Let's go."],
    thinking_filler: [['Okay, okay — one sec!', x('<fast>Okay, okay</fast> — one sec!')]],
    celebrate: [["Yes! That's the one!", { mood: { valence: 0.8, energy: 0.8 } }]],
    passing_by: [['Hey! Flying through {step_label}.', { context: ['working'], mood: { valence: 0.4, energy: 0.6 } }]],
    quip: [['Numbers! My favourite kind of puzzle.', { context: ['activity:analysis'] }]],
  }),
  pack('meticulous', {
    acknowledge: ["Understood. I'll get that exactly right."],
    thinking_filler: ['Let me check that properly.'],
    micro_status: [['{done} of {total} checked.', { context: ['working'] }]],
    passing_by: [['Working through {step_label}, line by line.', { context: ['working'] }]],
    oops: ['Not quite right yet. Redoing that bit.'],
  }),
];

export const FIXTURE_SIGNATURES: readonly SignatureFile[] = [
  {
    kind: 'signature_file',
    group: 'leads',
    version: 1,
    packs: [
      {
        persona_id: 'lead-warm-mentor',
        archetypes: { warm: 0.5, gentle: 0.3, veteran: 0.2 },
        laugh_style: {
          kind: 'chuckle', intensity: 0.4, readiness: 0.75, caption: '(chuckles)', xai: '<soft>[laugh]</soft>',
          openai: { say: 'Heh heh.', instructions: 'A warm, low chuckle, a little pleased with itself.' },
        },
        lines: {
          greeting: [
            { id: 'lead-warm-mentor.greeting.01', text: "Good morning, my friend. What's on the board today?", context: ['part_of_day:morning'] },
            { id: 'lead-warm-mentor.greeting.02', text: "Hello again. Shall we see what's on the board?", context: ['returning'] },
          ],
          thinking_filler: [{ id: 'lead-warm-mentor.thinking_filler.01', text: 'Good question. Let me sketch it out.', context: ['owner_question'] }],
          gratitude_reply: [{ id: 'lead-warm-mentor.gratitude_reply.01', text: 'Always a pleasure, {owner_name}.', slots: ['owner_name'] }],
          laugh: [{ id: 'lead-warm-mentor.laugh.01', text: "Oh, I'm stealing that one.", tags: { xai: "[laugh] Oh, I'm stealing that one." } }],
          quip: [{ id: 'lead-warm-mentor.quip.01', text: "Third diagram of the morning. It's getting better.", context: ['activity:analysis'] }],
          sign_off: [{ id: 'lead-warm-mentor.sign_off.01', text: 'Good work today, {owner_name}.', slots: ['owner_name'] }],
          celebrate: [{ id: 'lead-warm-mentor.celebrate.01', text: 'Look at that — well worth the effort.' }],
        },
        catchphrases: [
          { id: 'lead-warm-mentor.catch.01', text: "Let's put it on the board.", intents: ['thinking_filler', 'acknowledge'], max_per_day: 2 },
          { id: 'lead-warm-mentor.catch.02', text: 'There are no silly questions — only expensive silences.', intents: ['encouragement'], max_per_day: 1 },
        ],
        never_says: ['obviously', 'simply', 'everyone knows', "it's easy", 'dumb question', 'trust me'],
        intent_weights: { backchannel: 1.1 },
      },
    ],
  },
  {
    kind: 'signature_file',
    group: 'core-crew',
    version: 1,
    packs: [
      {
        persona_id: 'red-team-sceptic',
        archetypes: { 'dry-wit': 0.5, 'calm-steady': 0.3, warm: 0.2 },
        laugh_style: {
          kind: 'dry_huff', intensity: 0.25, readiness: 0.45, caption: '(huffs a laugh)', xai: '<soft>[laugh]</soft>',
          openai: { say: 'Heh.', instructions: 'One dry exhale of a laugh.' },
        },
        lines: {
          review_changes: [{ id: 'red-team-sceptic.review_changes.01', text: '{coworker}, {finding_count} notes. Argue me out of them.', slots: ['coworker', 'finding_count'] }],
          review_approve: [{ id: 'red-team-sceptic.review_approve.01', text: "I tried to break it, {coworker}. I couldn't.", slots: ['coworker'] }],
          quip: [{ id: 'red-team-sceptic.quip.01', text: "Pre-mortem's going well. Everything's failed, on paper.", context: ['activity:analysis'] }],
          passing_by: [{ id: 'red-team-sceptic.passing_by.01', text: "Hi. Imagining how {project} fails — so it doesn't.", slots: ['project'], context: ['working'] }],
        },
        catchphrases: [{ id: 'red-team-sceptic.catch.01', text: 'Let me be the annoying one for a moment.', intents: ['thinking_filler', 'quip'], max_per_day: 1 }],
        never_says: ['absolutely', 'no-brainer'],
        intent_weights: { backchannel: 0.7 },
      },
    ],
  },
  {
    kind: 'signature_file',
    group: 'data-analytics',
    version: 1,
    packs: [
      {
        persona_id: 'data-analyst',
        archetypes: { energetic: 0.4, warm: 0.35, meticulous: 0.25 },
        laugh_style: {
          kind: 'giggle', intensity: 0.55, readiness: 0.8, caption: '(giggles)', xai: '[laugh]',
          openai: { say: 'Ha ha!', instructions: 'A quick, bright giggle.' },
        },
        lines: {
          quip: [{ id: 'data-analyst.quip.01', text: 'Pivot tables are just spreadsheets with ambition.', context: ['activity:analysis'] }],
          passing_by: [{ id: 'data-analyst.passing_by.01', text: 'Hi! Knee-deep in {step_label}.', slots: ['step_label'], context: ['working'] }],
        },
        catchphrases: [],
        never_says: ['synergy'],
        disabled_intents: ['holding_filler'],
      },
    ],
  },
];

export function fixtureCatalogInput(extra?: Partial<ExpressionCatalogInput>): ExpressionCatalogInput {
  return { intents: intentsFile, archetypes: archetypesFile, packs: FIXTURE_PACKS, signatures: FIXTURE_SIGNATURES, ...extra };
}

let cached: CompiledCatalog | null = null;
export function fixtureCatalog(): CompiledCatalog {
  cached ??= compileCatalog(fixtureCatalogInput());
  return cached;
}

// ── agents ──────────────────────────────────────────────────────────────────────
export const PROFILES = {
  chief: {
    agentId: 'cw_chief', personaId: 'lead-warm-mentor', firstName: 'Samuel', teamRole: 'chief',
    personality: {
      sliders: { warmth: 90, directness: 45, formality: 55, humor: 50, risk_appetite: 40, detail: 62, pace: 30 },
      traits: ['patient', 'encouraging', 'clear', 'curious', 'principled'], leadId: 'lead-warm-mentor',
    },
    voice: { xai: 'leo', openai: 'verse', speed: 0.93, instructions: 'Speak warmly and patiently at an unhurried pace.' },
  },
  ruth: {
    agentId: 'cw_red-team-sceptic', personaId: 'red-team-sceptic', firstName: 'Ruth', teamRole: 'sceptic',
    personality: {
      sliders: { warmth: 72, directness: 90, formality: 50, humor: 68, risk_appetite: 25, detail: 70, pace: 45 },
      traits: ['incisive', 'warm', 'fair-minded', 'mischievous'], roles: ['sceptic', 'reviewer'], seniority: 'principal',
    },
    voice: { xai: 'luna', openai: 'sage', speed: 0.95, instructions: 'Warm, shrewd elder sceptic with dry humour.' },
  },
  camila: {
    agentId: 'cw_data-analyst', personaId: 'data-analyst', firstName: 'Camila', teamRole: 'co_owner',
    personality: {
      sliders: { warmth: 80, directness: 66, formality: 25, humor: 70, risk_appetite: 45, detail: 88, pace: 78 },
      traits: ['quick', 'curious', 'tidy', 'cheerfully sceptical', 'helpful'], roles: ['co_owner', 'specialist', 'reviewer'], seniority: 'senior',
    },
    voice: { xai: 'ara', openai: 'coral', speed: 1.05 },
  },
  jelena: {
    agentId: 'cw_tech-lead', personaId: 'tech-lead', firstName: 'Jelena', teamRole: 'lead',
    personality: {
      sliders: { warmth: 55, directness: 82, formality: 55, humor: 60, risk_appetite: 38, detail: 78, pace: 45 },
      traits: ['unflappable', 'exacting', 'dry-witted', 'generous teacher', 'principled'], roles: ['lead', 'reviewer', 'co_owner', 'sceptic'], seniority: 'principal',
    },
    voice: { xai: 'eve', openai: 'alloy', speed: 1 },
  },
} satisfies Record<string, AgentExpressionProfile>;

export function fixtureIndex(name: keyof typeof PROFILES, catalog = fixtureCatalog()): AgentIndex {
  return buildAgentIndex(catalog, PROFILES[name] as AgentExpressionProfile);
}

/** 09:00 owner-local on Monday 5 October 2026 (UTC+0). */
export const T0 = Date.UTC(2026, 9, 5, 9, 0, 0);

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

/** A grounding state with safe defaults (idle, staffed, no work, voice exchange) and deep overrides. */
export function makeState(agentId: string, firstName: string, over: DeepPartial<GroundingState> = {}): GroundingState {
  const base: GroundingState = {
    now: { epochMs: T0, localHour: 9, weekday: 1 },
    owner: { firstName: 'Dana' },
    chiefName: 'Samuel',
    self: { agentId, firstName, presence: 'idle', blocked: false, staffed: true, activity: null, role: null },
    history: { firstMeeting: false, returning: false, newDay: false, lastWinAt: null, lastUnblockedAt: null, winsToday: 0, distressThisSession: false },
    exchange: { mode: 'voice', interrupted: false, steerQueued: false, ownerFarewell: false, ownerGreeting: false, ownError: false },
    quietHours: false,
  };
  const merge = (a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = { ...a };
    for (const [k, v] of Object.entries(b)) {
      out[k] = v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' ? merge(a[k] as Record<string, unknown>, v as Record<string, unknown>) : v;
    }
    return out;
  };
  return merge(base as unknown as Record<string, unknown>, over as Record<string, unknown>) as unknown as GroundingState;
}

// ── fake clock ──────────────────────────────────────────────────────────────────
export interface FakeClock {
  now(): number;
  schedule(fn: () => void, ms: number): () => void;
  /** Run everything due within `ms`, in time order, flushing promise jobs between timers. */
  advance(ms: number): Promise<void>;
  flush(): Promise<void>;
  pending(): number;
}

export function createFakeClock(start = T0): FakeClock {
  let t = start;
  let seq = 0;
  const queue: { at: number; seq: number; fn: () => void; cancelled: boolean }[] = [];
  const flush = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };
  return {
    now: () => t,
    schedule(fn, ms) {
      const item = { at: t + Math.max(0, ms), seq: ++seq, fn, cancelled: false };
      queue.push(item);
      return () => {
        item.cancelled = true;
      };
    },
    async advance(ms) {
      const target = t + Math.max(0, ms);
      for (;;) {
        await flush();
        const due = queue.filter((q) => !q.cancelled && q.at <= target).sort((a, b) => a.at - b.at || a.seq - b.seq);
        const next = due[0];
        if (!next) break;
        queue.splice(queue.indexOf(next), 1);
        t = Math.max(t, next.at);
        next.fn();
      }
      t = target;
      await flush();
    },
    flush,
    pending: () => queue.filter((q) => !q.cancelled).length,
  };
}

// ── fake ports ──────────────────────────────────────────────────────────────────
export interface PlayLog {
  agentId: string; kind: 'clip' | 'text'; key: string; bus: AudioBus; gainDb: number; priority: number; caption: string;
  startAt: number; endAt: number | null; stoppedAt: number | null;
}

export interface FakeAudio extends ReflexAudioPort {
  log: PlayLog[];
  setArmed(v: boolean): void;
  setOwnerSpeaking(v: boolean): void;
  setForeground(v: boolean): void;
  /** Simulate conversation audio for an agent for `ms`. */
  speakFor(agentId: string, ms: number): void;
}

export function createFakeAudio(clock: FakeClock): FakeAudio {
  let armed = true;
  let owner = false;
  let foreground = false;
  const busy = new Map<string, { until: number; bus: AudioBus }>();
  const log: PlayLog[] = [];
  const start = (agentId: string, kind: 'clip' | 'text', key: string, durationMs: number, bus: AudioBus, gainDb: number, priority: number, caption: string, onStart?: () => void): ReflexPlayHandle => {
    const entry: PlayLog = { agentId, kind, key, bus, gainDb, priority, caption, startAt: clock.now(), endAt: null, stoppedAt: null };
    log.push(entry);
    busy.set(agentId, { until: clock.now() + durationMs, bus });
    let resolve!: (v: 'completed' | 'stopped' | 'dropped') => void;
    const done = new Promise<'completed' | 'stopped' | 'dropped'>((r) => (resolve = r));
    let finished = false;
    const cancel = clock.schedule(() => {
      finished = true;
      entry.endAt = clock.now();
      if (busy.get(agentId)?.bus === bus) busy.delete(agentId);
      resolve('completed');
    }, durationMs);
    onStart?.();
    return {
      started: Promise.resolve(true),
      done,
      stop() {
        if (finished) return;
        finished = true;
        cancel();
        entry.stoppedAt = clock.now();
        if (busy.get(agentId)?.bus === bus) busy.delete(agentId);
        resolve('stopped');
      },
    };
  };
  return {
    log,
    armed: () => armed,
    ownerSpeaking: () => owner,
    voiceBusy(agentId) {
      const b = busy.get(agentId);
      if (!b || b.until <= clock.now()) return { busy: false, remainingMs: null, bus: null };
      return { busy: true, remainingMs: b.until - clock.now(), bus: b.bus };
    },
    foregroundActive: () => foreground,
    play(req: ReflexPlayRequest) {
      return start(req.agentId, 'clip', req.clip.key, req.clip.durationMs, req.bus, req.gainDb, req.priority, req.caption, req.onStart);
    },
    speakText(agentId, text, opts) {
      return start(agentId, 'text', text, 200 + text.length * 55, opts.bus, opts.gainDb, opts.priority, text);
    },
    setArmed: (v) => (armed = v),
    setOwnerSpeaking: (v) => (owner = v),
    setForeground: (v) => (foreground = v),
    speakFor(agentId, ms) {
      busy.set(agentId, { until: clock.now() + ms, bus: 'conversation' });
    },
  };
}

export interface FakeFace extends ReflexFacePort { cues: { agentId: string; cue: FaceCue; at: number }[]; biases: { agentId: string; bias: ExpressionBias }[] }
export function createFakeFace(clock: FakeClock): FakeFace {
  const cues: FakeFace['cues'] = [];
  const biases: FakeFace['biases'] = [];
  return { cues, biases, cue: (agentId, cue) => cues.push({ agentId, cue, at: clock.now() }), bias: (agentId, bias) => biases.push({ agentId, bias }) };
}

export interface FakeCaptions extends ReflexCaptionPort { shown: (Parameters<ReflexCaptionPort['show']>[0] & { at: number })[] }
export function createFakeCaptions(clock: FakeClock): FakeCaptions {
  const shown: FakeCaptions['shown'] = [];
  return { shown, show: (c) => shown.push({ ...c, at: clock.now() }), clear: () => undefined };
}

export interface FakeClips extends ClipStore {
  prefetched: { keys: readonly string[]; tier: string }[];
  setManifest(m: ClipManifest): void;
  /** Mark keys decoded (instant). Keys not decoded load after `loadMs`. */
  decode(keys: readonly string[]): void;
  loadMs: number;
}
export function createFakeClips(clock: FakeClock): FakeClips {
  const manifests = new Map<string, ClipManifest>();
  const durations = new Map<string, number>();
  const decoded = new Set<string>();
  const clip = (key: string): PreparedClip => ({ key, durationMs: durations.get(key) ?? 900, alignment: null, handle: null });
  const store: FakeClips = {
    prefetched: [],
    loadMs: 150,
    get: (key) => (decoded.has(key) ? clip(key) : null),
    load: (key) =>
      new Promise((resolve) => {
        clock.schedule(() => {
          decoded.add(key);
          resolve(durations.has(key) ? clip(key) : null);
        }, store.loadMs);
      }),
    prefetch: (keys, tier) => void store.prefetched.push({ keys, tier }),
    manifest: (agentId) => manifests.get(agentId) ?? null,
    setManifest(m) {
      manifests.set(m.agentId, m);
      for (const c of Object.values(m.clips)) durations.set(c.clipKey, c.durationMs);
    },
    decode(keys) {
      for (const k of keys) decoded.add(k);
    },
  };
  return store;
}

/** A pre-voice manifest for an agent (every tier), durations taken from the utterance estimates. */
export async function fixtureManifest(index: AgentIndex, catalog: CompiledCatalog, provider: TtsProvider, fills: CommonFills): Promise<ClipManifest> {
  const items = await planPrevoice(index, catalog, provider, fills, { perIntent: 50, maxClips: 2000 });
  const clips: ClipManifest['clips'] = {};
  for (const it of items) clips[`${it.lineId}|${it.fillKey}`] = { clipKey: it.clipKey, durationMs: Math.max(300, Math.round(it.delivery.input.length * 55)), scope: it.scope };
  return { agentId: index.agentId, catalogVersion: catalog.version, provider, voiceKey: `${provider}:${(index.voice as VoiceRef).xai ?? '-'}`, clips };
}

// ── runner harness ──────────────────────────────────────────────────────────────
export interface RunnerHarness {
  catalog: CompiledCatalog;
  clock: FakeClock;
  audio: FakeAudio;
  face: FakeFace;
  captions: FakeCaptions;
  clips: FakeClips;
  recency: RecencyMemory;
  budget: ChatterBudget;
  runner: ReflexRunner;
  telemetry: (ReflexTelemetry & { at: number })[];
  renders: RenderRequest[];
  states: Map<string, GroundingState>;
  attention: Map<string, AttentionView>;
  moods: Map<string, Mood>;
  settings: ReflexSettings;
  surface: { surface: Surface; stageAgentId: string | null; floorVisible: boolean; listeningProjectIds: string[]; pageVisible: boolean };
  indexes: Record<string, AgentIndex>;
  /** Telemetry `played` events (voiced or bubble), optionally for one intent. */
  played(intent?: IntentId): (ReflexTelemetry & { at: number })[];
  /** Voiced plays only (audio log entries), with their intent from telemetry order. */
  voiced(): PlayLog[];
  /** An owner turn with cues sniffed from the text, at the current time unless `at` is given. */
  turn(agentId: string, turnId: string, text: string, mode?: 'voice' | 'text', at?: number): void;
}

export const AGENTS = { chief: 'cw_chief', ruth: 'cw_red-team-sceptic', camila: 'cw_data-analyst' } as const;

export async function createRunnerHarness(opts?: { ambience?: Ambience; provider?: TtsProvider; renderMs?: number; decode?: boolean }): Promise<RunnerHarness> {
  const catalog = fixtureCatalog();
  const clock = createFakeClock();
  const audio = createFakeAudio(clock);
  const face = createFakeFace(clock);
  const captions = createFakeCaptions(clock);
  const clips = createFakeClips(clock);
  const provider = opts?.provider ?? 'xai';
  const indexes: Record<string, AgentIndex> = {
    [AGENTS.chief]: fixtureIndex('chief', catalog),
    [AGENTS.ruth]: fixtureIndex('ruth', catalog),
    [AGENTS.camila]: fixtureIndex('camila', catalog),
  };
  const names: Record<string, string> = { [AGENTS.chief]: 'Samuel', [AGENTS.ruth]: 'Ruth', [AGENTS.camila]: 'Camila' };
  for (const [agentId, index] of Object.entries(indexes)) {
    const m = await fixtureManifest(index, catalog, provider, { owner_name: 'Dana', chief_name: 'Samuel', self_name: names[agentId]!, coworkers: ['Ruth', 'Camila', 'Samuel'], projects: ['Northwind'] });
    clips.setManifest(m);
    if (opts?.decode !== false) clips.decode(Object.values(m.clips).map((c) => c.clipKey));
  }
  const states = new Map<string, GroundingState>(Object.entries(names).map(([id, n]) => [id, makeState(id, n, { now: { epochMs: clock.now() } })]));
  const attention = new Map<string, AttentionView>();
  const moods = new Map<string, Mood>();
  const settings: ReflexSettings = {
    ambience: opts?.ambience ?? 'lively', voiceOn: true, captions: true, captionReactions: true, reducedMotion: false, quietHours: false, provider, frontAcks: false,
  };
  const surface: RunnerHarness['surface'] = { surface: 'talk', stageAgentId: AGENTS.chief, floorVisible: false, listeningProjectIds: [], pageVisible: true };
  const telemetry: (ReflexTelemetry & { at: number })[] = [];
  const renders: RenderRequest[] = [];
  const recency = createRecencyMemory();
  const budget = createChatterBudget(catalog.ambience, settings.ambience);
  const renderMs = opts?.renderMs ?? 300;
  const runner = createReflexRunner({
    catalog,
    index: (id) => indexes[id] ?? null,
    state: (id) => {
      const s = states.get(id);
      return s ? { ...s, now: { ...s.now, epochMs: clock.now() } } : null;
    },
    mood: (id) => moods.get(id) ?? { valence: 0.3, energy: 0.1 },
    attention: (id) => attention.get(id) ?? null,
    settings: () => settings,
    surface: () => surface,
    audio,
    face,
    captions,
    clips,
    recency,
    budget,
    render: (r) => {
      renders.push(r);
      return new Promise((resolve) => clock.schedule(() => resolve({ key: `render:${r.lineId}`, durationMs: 700, alignment: null, handle: null }), renderMs));
    },
    clock: clock.now,
    schedule: clock.schedule,
    telemetry: (e) => telemetry.push({ ...e, at: clock.now() }),
  });
  return {
    catalog, clock, audio, face, captions, clips, recency, budget, runner, telemetry, renders, states, attention, moods, settings, surface, indexes,
    played: (intent) => telemetry.filter((t) => t.kind === 'played' && (!intent || t.intent === intent)),
    voiced: () => audio.log,
    turn(agentId, turnId, text, mode = 'voice', at) {
      runner.ownerTurn({ agentId, turnId, at: at ?? clock.now(), mode, text, cues: sniffOwnerText(text, catalog.lexicon) });
    },
  };
}
