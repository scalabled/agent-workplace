// The living runtime (INC05-PLAN §5, LIVING-WORKFORCE §11.4): one reflex runner per tab, fed by the owner feed,
// the voices and the Floor, and speaking through pre-voiced clips (or the browser voice when keyless). A lazy chunk:
// `living/index.ts` loads it once the app is idle.
import { effect, signal } from '@preact/signals';
import type { AudioEngine } from '@headcount/audio';
import {
  compileCatalog,
  createChatterBudget,
  createRecencyMemory,
  createReflexRunner,
  expressionBias,
  lineOf,
  moodAt,
  ownerDayKey,
  REACTION_INTENTS,
  recordUtterance,
  selectLine,
  sniffOwnerText,
  type IntentId,
  type CompiledCatalog,
  type ConversationEvent,
  type ExpressionCatalogInput,
  type GroundingState,
  type Mood,
  type PreparedClip,
  type PrevoiceTier,
  type RecencySnapshot,
  type ReflexRunner,
  type ReflexSettings,
  type ReflexTelemetry,
} from '@headcount/expressions';
import { CHIEF_ID, ownerFirstNameOf, personaIdFromAgentId, type Frame } from '@headcount/protocol';
import {
  ambienceOf,
  type Ambience,
  type ExprAgentResponse,
  type ExprClipRef,
  type ExprPrevoiceAccepted,
  type ExprPrevoiceRequest,
  type ExprPrevoiceStatus,
  type ExprRecentOp,
  type ExprRenderRequest,
  type ReactHint,
  type ReflexSayData,
  type ViewerOp,
} from '@headcount/protocol/ext/expressions';
import { api } from '../api/client';
import { catalog as slimCatalog } from '../catalog';
import { browserVoiceHint, chiefName, chiefVoiceHint } from '../chief';
import { now as clock } from '../lib/time';
import { route } from '../router';
import { feedEpoch, jobs, lastSeq, onboarded, onFrame, presence, replayThrough, settings, sideThreads, thread } from '../store';
import { greetedThisSession } from '../talk/draft';
import { chiefSpeaker } from '../voice/chief-voice';
import { audio } from '../voice/engine';
import { claimUnsettled, mayVoice, voiceActive } from '../voice/owner';
import { eachSideSpeaker } from '../voice/side-voice';
import type { AgentSpeaker } from '../voice/speaker';
import { createAgents, type AgentEntry } from './agents';
import { captionLog } from './captions';
import { createClipStore } from './clips';
import { biasFace, cueLog } from './faces';
import { chiefGrounding, coworkerGrounding } from './grounding';
import { isQuietHours, livelyAnyway, quietHoursApply, quietHoursNow } from './quiet';
import { sendsInFlight } from './index';
import { sendWhileSpeaking } from './policy';
import { createBudgetPause } from './budget-pause';
import { activityOf, captionPort, createAudioPort, createRender, DROPPED_PLAY, facePort } from './ports';
import type { HoverPhase, HoverVia, LivingRuntime, OwnerTurnInput } from './types';
import { createOpSender, officeStage, recentOp, stageOf, viewerOp } from './viewer';

export const RECENCY_STORAGE_KEY = 'hc-expr-recency-v1';
/** While an agent's reply sounds, the runner hears how much is left this often (§3.4 `speaking`). */
export const SPEAKING_TICK_MS = 250;
export const PREVOICE_POLL_MS = 2000;
const PREVOICE_MAX_POLLS = 150;
/** A reply's `done` waits for its audio to end, but never longer than this. */
const DONE_WAIT_MAX_MS = 90_000;
/** Server reflexes and conversation events for a turn this tab is still sending wait at most this long. */
const HOLD_MAX_MS = 8000;
/** The next answer waits this long after the previous one for "back with you" / the acknowledgement to start. */
const NEXT_REPLY_GRACE_MS = 450;
const NEXT_REPLY_MAX_HOLD_MS = 12_000;
/** A job-done announcement waits at most this long for its lead-in ("Nice.") to start: the lead-in itself gives up after its 3 s TTL (INC05-PLAN §3.4 celebrate). */
const LEAD_IN_MAX_HOLD_MS = 3200;
const REMEMBER = 400;
/** Face palettes follow the mood as it decays (the server only emits on events): recomputed this often. */
export const BIAS_REFRESH_MS = 60_000;
/** After P0 is decoded, the Chief's reaction clips (sympathy, concern, delight …) decode this much later, when idle. */
const REACTION_DECODE_DELAY_MS = 1500;
/** The Chief's thinking fillers are all pre-voiced with P0: two or three lines would repeat in turn (E1). */
const CHIEF_P0_ALL_LINES_FOR: IntentId[] = ['thinking_filler'];
/** Intents whose clips decode after P0 for the Chief: the reactions a voice turn can get (§1.3). */
const REACTION_DECODE = new Set<IntentId>(REACTION_INTENTS);
/** Phatic replies: the whole answer to "thanks", "hi", "bye" (they wait for a previous answer to finish). */
const PHATIC_REPLIES = new Set<string>(['gratitude_reply', 'greeting', 'sign_off']);
/** How long a phatic reply waits for the previous answer to end before it plays anyway (the engine then decides). */
const REPLY_WAIT_MAX_MS = 12_000;

export interface RuntimeApi {
  exprAgent(agentId: string): Promise<ExprAgentResponse>;
  exprRender(req: ExprRenderRequest): Promise<ExprClipRef>;
  exprPrevoice(req: ExprPrevoiceRequest): Promise<ExprPrevoiceAccepted>;
  exprPrevoiceStatus(runId: string): Promise<ExprPrevoiceStatus>;
}

export interface RuntimeSpeakers {
  chief: AgentSpeaker;
  /** Every coworker speaker made so far and from now on. */
  each(cb: (agentId: string, s: AgentSpeaker) => void): () => void;
}

export interface RuntimeDeps {
  catalog: CompiledCatalog;
  engine(): AudioEngine;
  send(op: ViewerOp | ExprRecentOp): void;
  api: RuntimeApi;
  fetch(url: string): Promise<Response>;
  caches?: CacheStorage | null;
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  now?(): number;
  schedule?(fn: () => void, ms: number): () => void;
  speakers?: RuntimeSpeakers;
  /** Dev builds: expose the runtime on window.__headcount.living. */
  devHook?: boolean;
  /** The bundle's office small-talk packs (OFFICE-PHASE2 §4.5.13), kept for the Office. */
  huddles?: { version: string; packs: readonly unknown[] } | null;
}

const defaultSchedule = (fn: () => void, ms: number) => {
  const t = setTimeout(fn, ms);
  return () => clearTimeout(t);
};

function remember<K, V>(map: Map<K, V>, key: K, value: V): void {
  map.set(key, value);
  if (map.size > REMEMBER) map.delete(map.keys().next().value!);
}

function prefersReducedMotion(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

const pageVisible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';

/** A talk.* frame of an office room or joined huddle (`surface: 'room'`). */
export function isRoomTalk(frame: Frame): boolean {
  switch (frame.type) {
    case 'talk.owner':
    case 'talk.delta':
    case 'talk.message':
    case 'talk.done':
      return (frame.data as { surface?: string }).surface === 'room';
    default:
      return false;
  }
}

/** A greeting or sign-off from the office starts within this long, or not at all (its bubble shows either way). */
export const SAY_INTENT_VOICE_TTL_MS = 1500;
/** Seeds tried for a greeting that says the owner's name before the first pick stands. */
export const NAMED_GREETING_TRIES = 24;

export function createLivingRuntime(deps: RuntimeDeps): LivingRuntime {
  const now = deps.now ?? Date.now;
  const schedule = deps.schedule ?? defaultSchedule;
  const catalog = deps.catalog;
  const disposers: (() => void)[] = [];
  let disposed = false;
  /** Dev and e2e only (the dev hook): force quiet hours on or off instead of the owner-local clock. */
  let quietOverride: boolean | null = null;
  const quiet = (): boolean => quietOverride ?? quietHoursApply(new Date(now()));
  const chief = deps.speakers?.chief ?? chiefSpeaker;
  const sides = new Map<string, AgentSpeaker>();
  const speakerOf = (agentId: string): AgentSpeaker | null => (agentId === CHIEF_ID ? chief : (sides.get(agentId) ?? null));
  const telemetry: (ReflexTelemetry & { at: number })[] = [];
  /** The intent each agent voiced last. */
  const lastPlayed = new Map<string, string>();

  // ── agents, clips, recency ──────────────────────────────────────────────────
  const agents = createAgents({
    catalog,
    fetchAgent: (id) => deps.api.exprAgent(id),
    now,
    onLoaded: (e) => onAgentLoaded(e),
  });
  const clips = createClipStore({
    prepare: (bytes, opts) => deps.engine().prepare(bytes, opts),
    fetch: (url) => deps.fetch(url),
    caches: deps.caches ?? null,
    storage: deps.storage ?? null,
    manifest: (id) => agents.manifest(id),
  });

  const restored = ((): RecencySnapshot | undefined => {
    try {
      const raw = deps.storage?.getItem(RECENCY_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as RecencySnapshot) : undefined;
    } catch {
      return undefined;
    }
  })();
  let recency = createRecencyMemory();
  if (restored) {
    try {
      recency = createRecencyMemory({ snapshot: restored });
    } catch {
      /* an unreadable snapshot starts fresh */
    }
  }
  let saveTimer: (() => void) | null = null;
  const saveRecency = () => {
    saveTimer = null;
    try {
      deps.storage?.setItem(RECENCY_STORAGE_KEY, JSON.stringify(recency.snapshot()));
    } catch {
      /* storage blocked or full: memory only */
    }
  };

  // ── ports ───────────────────────────────────────────────────────────────────
  let inPause = false;
  /** The Chief's next answer, held until a reflex between answers plays (see holdNextReply). */
  let nextReply: { intent: 'back_with_you' | 'acknowledge' | 'celebrate'; release: () => void } | null = null;
  const basePort = createAudioPort({
    engine: deps.engine,
    pendingChars: (id) => speakerOf(id)?.pendingChars() ?? 0,
    inOwnerPause: () => inPause,
    voiceHint: (id) => {
      if (id === CHIEF_ID) return chiefVoiceHint.peek();
      const p = slimCatalog.peek()?.persona(personaIdFromAgentId(id) ?? '');
      return p ? browserVoiceHint(p.pronouns, p.voice.speed) : undefined;
    },
  });
  // The runner's port. While the Chief's next answer is held for a reflex between answers (a lead-in, "all yours"),
  // that answer is queued in the engine but silent: it must not count as a busy voice, or the reflex it waits for
  // waits for it. The runtime's own decisions (sending while they speak, barge-in) read `basePort`.
  // One voice per workspace: only the tab that has the voice plays anything (a line planned just before another tab
  // took the voice is dropped here; the runner already treats every other tab as voice off, captions only).
  const audioPort: typeof basePort = {
    ...basePort,
    play: (req) => (mayVoice() ? basePort.play(req) : DROPPED_PLAY),
    speakText: (agentId, text, opts) => (mayVoice() ? basePort.speakText(agentId, text, opts) : null),
    voiceBusy(agentId) {
      const b = basePort.voiceBusy(agentId);
      if (agentId !== CHIEF_ID || !nextReply || b.bus !== 'conversation') return b;
      try {
        const e = deps.engine();
        if (e.speaking().includes(agentId)) return b;
        return activityOf(e, agentId).reflex ? { busy: true, remainingMs: null, bus: 'reflex' } : { busy: false, remainingMs: null, bus: null };
      } catch {
        return b;
      }
    },
  };

  const reducedMotion = signal(prefersReducedMotion());
  const base: ReflexSettings = {
    ambience: ambienceOf(settings.peek()),
    voiceOn: (settings.peek()?.voiceOn ?? false) && mayVoice(),
    captions: true,
    captionReactions: true,
    reducedMotion: reducedMotion.peek(),
    quietHours: quiet(),
    provider: 'browser',
    frontAcks: false,
  };
  const budget = createChatterBudget(catalog.ambience, base.ambience);
  // A spent voice budget (429) pauses renders and pre-voicing alike until it can have come back (budget-pause.ts).
  const voicePause = createBudgetPause(deps.storage ?? null);
  const render = createRender({ exprRender: (r) => deps.api.exprRender(r), clips, agents, pause: voicePause, now });

  const grounding = (agentId: string): GroundingState | null => {
    const quietHours = quiet();
    if (agentId === CHIEF_ID) {
      if (!onboarded.peek()) return null;
      return chiefGrounding({ now: now(), chiefName: chiefName.peek(), jobs: Object.values(jobs.peek()), thread: thread.peek(), quietHours, greetedThisSession: greetedThisSession.peek(), ownerFirstName: ownerFirstNameOf(settings.peek()) });
    }
    const e = agents.get(agentId);
    if (!e) return null;
    return coworkerGrounding({ now: now(), agentId, firstName: e.resp.profile.firstName, chiefName: chiefName.peek(), sideThread: sideThreads.peek()[agentId] ?? [], quietHours, ownerFirstName: ownerFirstNameOf(settings.peek()) });
  };

  const surface = () => {
    const r = route.peek();
    const st = stageOf(r, officeStage.peek());
    return { ...st, floorVisible: st.surface === 'floor', listeningProjectIds: [] as string[], pageVisible: pageVisible() };
  };

  const runner: ReflexRunner = createReflexRunner({
    catalog,
    index: (id) => agents.index(id),
    state: grounding,
    mood: (id) => agents.mood(id),
    attention: (id) => agents.attention(id),
    settings: () => base,
    surface,
    audio: audioPort,
    face: facePort,
    captions: captionPort,
    clips,
    recency,
    budget,
    render,
    clock: now,
    schedule,
    telemetry: (e) => onTelemetry(e),
  });

  // ── socket ops ──────────────────────────────────────────────────────────────
  const sender = createOpSender((op) => deps.send(op), { now, schedule });
  let chiefVoiceUntil: number | null = null;
  const currentViewer = (): ViewerOp => {
    let armed = false;
    try {
      armed = deps.engine().armed;
    } catch {
      /* no audio here */
    }
    return viewerOp({
      route: route.peek(),
      audioArmed: armed,
      voiceOn: settings.peek()?.voiceOn ?? false,
      pageVisible: pageVisible(),
      reducedMotion: reducedMotion.peek(),
      quietHours: quiet(),
      tzOffsetMin: new Date(now()).getTimezoneOffset(),
      voice: chiefVoiceUntil !== null ? { agentId: CHIEF_ID, untilMs: chiefVoiceUntil } : null,
      office: officeStage.peek(),
    });
  };
  const updateViewer = () => sender.viewer(currentViewer());
  /** Voice is on, this tab has the voice and audio is armed: a voiced reflex can be heard here. */
  const voiceAudible = (): boolean => {
    if (!settings.peek()?.voiceOn || !mayVoice()) return false;
    try {
      return deps.engine().armed;
    } catch {
      return false;
    }
  };

  // ── conversation events ─────────────────────────────────────────────────────
  /** Turns this tab sent (owner-turn reflexes play only here). */
  const ownTurns = new Map<string, true>();
  const msgTurn = new Map<string, string>();
  const firstToken = new Map<string, true>();
  /** Events and server reflexes for a turn whose 202 has not come back yet. */
  const early = new Map<string, { events: ConversationEvent[]; at: number }>();
  let heldSays: { data: ReflexSayData; at: number }[] = [];
  const deferredDone = new Map<string, { ev: ConversationEvent; cancel: () => void }>();

  const emit = (e: ConversationEvent) => {
    if (e.kind !== 'speaking' && !ownTurns.has(e.turnId) && sendsInFlight() > 0) {
      const slot = early.get(e.turnId) ?? { events: [], at: now() };
      if (slot.events.length < 8) slot.events.push(e);
      remember(early, e.turnId, slot);
      return;
    }
    runner.conversation(e);
  };

  const faceOnly = (d: ReflexSayData) => runner.frame({ type: 'reflex.face', data: { agentId: d.agentId, cue: d.face } });

  /**
   * An owner-turn reflex of this tab. A phatic reply ("Anytime.") is that turn's whole answer: while the agent's
   * previous answer still sounds it waits its turn, as the next answer would (a reflex started over an answer is
   * dropped), and the face reacts at once.
   */
  const playOwn = (d: ReflexSayData) => {
    const answering = (): boolean => {
      try {
        return activityOf(deps.engine(), d.agentId).conversation;
      } catch {
        return false;
      }
    };
    if (!PHATIC_REPLIES.has(d.intent) || !d.channels.voice || !answering()) return runner.frame({ type: 'reflex.say', data: d });
    faceOnly(d);
    const since = now();
    const wait = () => {
      if (disposed) return;
      if (answering() && now() - since < REPLY_WAIT_MAX_MS) return void schedule(wait, 100);
      runner.frame({ type: 'reflex.say', data: d });
    };
    schedule(wait, 100);
  };

  /** §3.3: owner-turn reflexes only in the tab that sent the turn; event reflexes only at that agent's visible stage. */
  const routeSay = (d: ReflexSayData) => {
    if (d.turnId) {
      if (ownTurns.has(d.turnId)) return playOwn(d);
      if (sendsInFlight() > 0) {
        heldSays.push({ data: d, at: now() });
        return;
      }
      return faceOnly(d);
    }
    const sf = surface();
    const atStage = sf.pageVisible && (sf.surface === 'talk' || sf.surface === 'desk') && sf.stageAgentId === d.agentId;
    if (!atStage) return faceOnly(d);
    // A reaction that arrives while this tab's claim of the voice is on its way is voiced by the device that had the
    // voice (until the server's word reaches it): here it shows as it would in a tab without the voice.
    if (d.channels.voice && claimUnsettled()) return runner.frame({ type: 'reflex.say', data: { ...d, channels: { ...d.channels, voice: false } } });
    // The celebration is a lead-in to the job-done announcement that follows it on the feed: the announcement's
    // voice waits for it (it would otherwise start first, and the lead-in would be dropped behind it).
    if (d.intent === 'celebrate' && d.agentId === CHIEF_ID && d.channels.voice && voiceAudible()) {
      holdNextReply(CHIEF_ID, 'celebrate', LEAD_IN_MAX_HOLD_MS);
      // A progress line still sounding is old news now: it gives way, so the lead-in lands within its TTL.
      try {
        const e = deps.engine();
        if (lastPlayed.get(CHIEF_ID) === 'micro_status' && activityOf(e, CHIEF_ID).reflex) e.stopReflexes({ speakerId: CHIEF_ID, bus: 'reflex' });
      } catch {
        /* no audio here: nothing is sounding */
      }
    }
    runner.frame({ type: 'reflex.say', data: d });
  };

  const onDelta = (d: { turnId: string; messageId: string; hint?: ReactHint }) => {
    remember(msgTurn, d.messageId, d.turnId);
    if (firstToken.has(d.turnId)) return;
    remember(firstToken, d.turnId, true);
    emit({ kind: 'first_token', turnId: d.turnId, at: now(), hint: d.hint ?? null });
  };

  /** The reply that streamed live in a turn (a replayed end may name no message: a worker restart mid-answer). */
  const replyOfTurn = (turnId: string): string | null => {
    let found: string | null = null;
    for (const [msg, t] of msgTurn) if (t === turnId) found = msg;
    return found;
  };

  /**
   * A turn's end. `replayed`: it came back as history after the socket reconnected (the reply finished while it was
   * down) for a turn this tab saw live: the runner closes that turn without voicing anything for it.
   */
  const onDone = (d: { turnId: string; messageId: string | null; agentId?: string; finish: string }, replayed = false) => {
    const agentId = d.agentId ?? CHIEF_ID;
    const ev: ConversationEvent = { kind: d.finish === 'cancelled' ? 'cancelled' : 'done', turnId: d.turnId, at: now(), ...(replayed ? { replayed: true } : {}) };
    const s = speakerOf(agentId);
    const reply = d.messageId ?? (replayed ? replyOfTurn(d.turnId) : null);
    // A voiced reply is over when its audio is: the runner's "back with you" and gaps count from there.
    if (ev.kind === 'done' && reply && s?.has(reply)) {
      const msg = reply;
      deferredDone.get(msg)?.cancel();
      deferredDone.set(msg, { ev, cancel: schedule(() => flushDone(msg), DONE_WAIT_MAX_MS) });
      return;
    }
    emit(ev);
  };

  const flushDone = (messageId: string) => {
    const d = deferredDone.get(messageId);
    if (!d) return;
    deferredDone.delete(messageId);
    d.cancel();
    emit({ ...d.ev, at: now() } as ConversationEvent);
  };

  disposers.push(
    onFrame((frame: Frame, { live }) => {
      // Room turns and joined huddles (OFFICE-PHASE2 §4.4) are not the runner's conversations: their voices and faces
      // belong to the office's room session.
      if (isRoomTalk(frame)) return;
      if (!live) {
        // Replayed history never speaks or animates. Only the end of a turn this tab saw live (its reply finished while
        // the socket was down) reaches the runner, which closes it silently: no filler or "still thinking" for it later.
        if (frame.type === 'talk.done' && (ownTurns.has(frame.data.turnId) || firstToken.has(frame.data.turnId))) onDone(frame.data, true);
        return;
      }
      switch (frame.type) {
        case 'reflex.say':
          return routeSay(frame.data);
        case 'reflex.face':
          return runner.frame({ type: 'reflex.face', data: frame.data });
        case 'mood.changed':
          agents.applyMood(frame.data);
          return runner.frame({ type: 'mood.changed', data: frame.data });
        case 'attention.changed':
          agents.applyAttention(frame.data);
          return runner.frame({ type: 'attention.changed', data: frame.data });
        case 'sidetalk.line':
          return runner.frame({ type: 'sidetalk.line', data: frame.data });
        case 'talk.delta':
          return onDelta(frame.data);
        case 'talk.message':
          if (!frame.data.turnId) return;
          remember(msgTurn, frame.data.messageId, frame.data.turnId);
          // A reply that arrives whole (no deltas) is its own first token; a reflex reply is the host's own.
          if (frame.data.kind === 'reply' || frame.data.kind === 'status') onDelta({ turnId: frame.data.turnId, messageId: frame.data.messageId });
          return;
        case 'talk.done':
          return onDone(frame.data);
        default:
          return;
      }
    }),
  );

  // ── speakers: first audio, how much is left, the end ───────────────────────
  let ticking: (() => void) | null = null;
  const tick = () => {
    ticking = null;
    let any = false;
    let chiefLeft: number | null = null;
    for (const [agentId, s] of [[CHIEF_ID, chief] as const, ...sides]) {
      const msg = s.soundingMessage();
      if (!msg) continue;
      any = true;
      const turnId = msgTurn.get(msg);
      const left = basePort.voiceBusy(agentId).remainingMs;
      if (agentId === CHIEF_ID) chiefLeft = left ?? 0;
      if (turnId) runner.conversation({ kind: 'speaking', turnId, agentId, remainingMs: left });
    }
    const until = chiefLeft === null ? null : now() + chiefLeft;
    if ((until === null) !== (chiefVoiceUntil === null) || (until !== null && chiefVoiceUntil !== null && Math.abs(until - chiefVoiceUntil) > 1000)) {
      chiefVoiceUntil = until;
      updateViewer();
    }
    if (any) ticking = schedule(tick, SPEAKING_TICK_MS);
  };
  const startTicking = () => {
    if (!ticking) ticking = schedule(tick, 0);
  };

  /** The next answer waits for the reflex between two answers (§2.3); `intent` releases it as soon as it plays. */
  const holdNextReply = (agentId: string, intent: 'back_with_you' | 'acknowledge' | 'celebrate', maxHoldMs = NEXT_REPLY_MAX_HOLD_MS) => {
    const s = speakerOf(agentId);
    if (!s) return;
    nextReply?.release();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const cancelMax = schedule(() => done(), maxHoldMs);
    const done = () => {
      cancelMax();
      release();
      if (nextReply?.release === done) nextReply = null;
    };
    nextReply = { intent, release: done };
    s.holdNext(gate);
  };

  const observe = (agentId: string, s: AgentSpeaker) =>
    s.observe({
      started: (messageId) => {
        const turnId = msgTurn.get(messageId);
        if (turnId) emit({ kind: 'first_chunk', turnId, at: now() });
        startTicking();
      },
      ended: (messageId) => {
        flushDone(messageId);
        // The previous answer ended: give the reflex between answers a moment, then let the next one speak.
        if (nextReply && agentId === CHIEF_ID) {
          const pending = nextReply;
          schedule(() => pending.release(), NEXT_REPLY_GRACE_MS);
        }
      },
    });
  disposers.push(observe(CHIEF_ID, chief));
  disposers.push(
    (deps.speakers?.each ?? eachSideSpeaker)((agentId, s) => {
      if (sides.has(agentId)) return;
      sides.set(agentId, s);
      disposers.push(observe(agentId, s));
    }),
  );

  // ── telemetry: recency sync and the reflex between answers ──────────────────
  function onTelemetry(e: ReflexTelemetry): void {
    telemetry.push({ ...e, at: now() });
    if (telemetry.length > 300) telemetry.splice(0, telemetry.length - 300);
    // A lead-in that will not play releases the announcement at once.
    if ((e.kind === 'dropped' || e.kind === 'skipped') && nextReply?.intent === 'celebrate' && e.agentId === CHIEF_ID && e.intent === 'celebrate') nextReply.release();
    if (e.kind === 'played') {
      lastPlayed.set(e.agentId, e.intent);
      if (nextReply && e.agentId === CHIEF_ID && e.intent === nextReply.intent) nextReply.release();
      sender.recent(recentOp(recency.snapshot(), undefined, now()));
      saveTimer ??= schedule(saveRecency, 5000);
    }
  }

  // ── agents: the Chief at boot and on a new lead or name; coworkers on demand ─
  /** Decode an agent's clips of one tier (or of some intents): the reflex path only plays decoded clips (§2.6). */
  const decodeTier = (agentId: string, tier: Exclude<PrevoiceTier, 'runtime'>, intents?: ReadonlySet<IntentId>) => {
    const e = agents.get(agentId);
    if (!e) return;
    const keys = Object.entries(e.manifest.clips)
      .filter(([k]) => {
        const line = lineOf(e.index, k.split('|')[0] ?? '');
        if (!line) return false;
        return intents ? intents.has(line.intent) : catalog.intents.get(line.intent)?.prevoice === tier;
      })
      .map(([, c]) => c.clipKey);
    if (keys.length) clips.prefetch(keys, tier);
  };
  let reactionDecode: (() => void) | null = null;

  /** The face palette from the mood as it is now (decayed toward the baseline) and the agent's presence. */
  const refreshBias = (agentId: string) => {
    const st = agents.moodState(agentId);
    if (!st) return biasFace(agentId, null);
    const p = presence.peek()[agentId]?.state ?? 'idle';
    biasFace(agentId, expressionBias(moodAt(st, now()), p));
  };

  function onAgentLoaded(e: AgentEntry): void {
    // A lead change resets the Chief's mood on the server: no mood here means the old palette goes too.
    refreshBias(e.resp.agentId);
    if (e.resp.agentId === CHIEF_ID) {
      runner.setSettings({ provider: e.resp.provider });
      decodeTier(CHIEF_ID, 'p0'); // decoding needs no gesture: reflexes are instant from the first turn
      // Then, when idle, the reactions a voice turn can get (P1): sympathy and concern are voiced, not only the laugh.
      reactionDecode?.();
      reactionDecode = schedule(() => {
        reactionDecode = null;
        decodeTier(CHIEF_ID, 'p1', REACTION_DECODE);
      }, REACTION_DECODE_DELAY_MS);
    }
  }
  const biasTimer = () => {
    for (const id of agents.withMood()) refreshBias(id);
    stopBias = schedule(biasTimer, BIAS_REFRESH_MS);
  };
  let stopBias: (() => void) | null = schedule(biasTimer, BIAS_REFRESH_MS);
  disposers.push(() => {
    stopBias?.();
    stopBias = null;
    reactionDecode?.();
  });
  // Presence moves the palette too (thinking, working): recompute when it changes.
  let lastPresence = '';
  disposers.push(
    effect(() => {
      const p = presence.value;
      const key = agents.withMood().map((id) => `${id}:${p[id]?.state ?? ''}`).join('|');
      if (key === lastPresence) return;
      lastPresence = key;
      for (const id of agents.withMood()) refreshBias(id);
    }),
  );

  let chiefKey = '';
  disposers.push(
    effect(() => {
      const s = settings.value;
      if (!s?.leadId) return;
      const key = `${s.leadId}|${s.chiefName ?? ''}`;
      if (key === chiefKey) return;
      const first = chiefKey === '';
      chiefKey = key;
      void agents.load(CHIEF_ID, { force: !first });
    }),
  );

  // ── pre-voicing (B3): the Chief's P0 then P1, once per voice and catalog, when Talk opens ─
  const prevoiced = new Set<string>();
  let prevoicing = false;
  const pollRun = async (runId: string) => {
    for (let i = 0; i < PREVOICE_MAX_POLLS; i++) {
      await new Promise<void>((r) => schedule(r, PREVOICE_POLL_MS));
      if (disposed) return;
      const st = await deps.api.exprPrevoiceStatus(runId);
      if (st.state !== 'queued' && st.state !== 'running') return;
    }
  };
  const prevoiceChief = async () => {
    if (prevoicing) return;
    const e = await agents.load(CHIEF_ID);
    if (!e || e.resp.provider === 'browser') return; // keyless: the browser voice speaks, nothing to render
    const key = `${e.resp.voiceKey}|${e.resp.catalogVersion}|${e.resp.provider}|${e.resp.profile.firstName}`;
    if (prevoiced.has(key)) return;
    if (voicePause.blocked(now())) return; // budget spent earlier: don't ask again until it can have reset
    prevoicing = true;
    try {
      for (const tier of ['p0', 'p1'] as const) {
        const acc = await deps.api.exprPrevoice({ agentIds: [CHIEF_ID], tiers: [tier], ...(tier === 'p0' ? { allLinesFor: CHIEF_P0_ALL_LINES_FOR } : {}) });
        if (acc.runId && !acc.reused && acc.toRender > 0) await pollRun(acc.runId);
        if (disposed) return;
        await agents.load(CHIEF_ID, { force: true });
        if (tier === 'p0') decodeTier(CHIEF_ID, 'p0');
      }
      prevoiced.add(key);
    } catch (err) {
      // Budget spent (429): pause until it can have reset. No provider: reflexes fall back to faces and bubbles.
      voicePause.note(err, now());
    } finally {
      prevoicing = false;
    }
  };

  // ── stage: Talk is the Chief's, a profile is that coworker's desk ───────────
  let openStage: string | null = null;
  let wantStage: string | null = null;
  disposers.push(
    effect(() => {
      const r = route.value;
      const caughtUp = feedEpoch.value > 0 && lastSeq.value >= replayThrough.value;
      const ready = onboarded.value && caughtUp;
      const target = ready ? stageOf(r).stageAgentId : null;
      wantStage = target;
      if (target === openStage) return;
      if (openStage) runner.stage(openStage, 'close', r.name === 'landing' ? 'leave' : 'navigate');
      openStage = null;
      if (!target) return;
      if (target === CHIEF_ID) void prevoiceChief();
      void agents.load(target).then((e) => {
        if (!e || disposed || wantStage !== target || openStage === target) return;
        openStage = target;
        runner.stage(target, 'open');
      });
    }),
  );

  // ── settings (B9) ───────────────────────────────────────────────────────────
  disposers.push(
    effect(() => {
      const s = settings.value;
      void clock.value; // quiet hours follow the clock
      void livelyAnyway.value; // "Lively anyway" lifts them for the night
      quietHoursNow.value = quietOverride ?? isQuietHours(new Date(now()));
      // Another tab has the voice (or this one shows the landing page): voice off here, captions and faces stay.
      runner.setSettings({ ambience: ambienceOf(s), voiceOn: (s?.voiceOn ?? false) && voiceActive.value, reducedMotion: reducedMotion.value, quietHours: quiet() });
    }),
  );
  if (typeof matchMedia === 'function') {
    try {
      const mq = matchMedia('(prefers-reduced-motion: reduce)');
      const onChange = () => (reducedMotion.value = mq.matches);
      mq.addEventListener('change', onChange);
      disposers.push(() => mq.removeEventListener('change', onChange));
    } catch {
      /* no media queries */
    }
  }

  // ── viewer and recency on every connect; viewer on every change ─────────────
  disposers.push(
    effect(() => {
      if (!feedEpoch.value) return;
      sender.viewer(currentViewer(), true);
      sender.recent(recentOp(recency.snapshot(), undefined, now()), true);
    }),
  );
  disposers.push(
    effect(() => {
      void route.value;
      void settings.value?.voiceOn;
      void reducedMotion.value;
      void clock.value;
      void officeStage.value;
      updateViewer();
    }),
  );
  if (typeof document !== 'undefined') {
    const onVisibility = () => updateViewer();
    // Audio arms on the first gesture: tell the server a moment later.
    const onGesture = () => schedule(updateViewer, 60);
    const onHide = () => saveRecency();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pointerdown', onGesture, { capture: true, passive: true });
    window.addEventListener('keydown', onGesture, { capture: true });
    window.addEventListener('pagehide', onHide);
    disposers.push(() => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pointerdown', onGesture, { capture: true });
      window.removeEventListener('keydown', onGesture, { capture: true });
      window.removeEventListener('pagehide', onHide);
    });
  }

  // ── the owner's voice (VAD) while they hold to talk to the Chief ────────────
  try {
    const e = deps.engine();
    if (typeof e.onOwnerVad === 'function')
      disposers.push(
        e.onOwnerVad((v) => {
          inPause = v.kind === 'pause';
          runner.ownerSpeech({ agentId: CHIEF_ID, kind: v.kind, at: v.at, ...(v.pauseMs !== undefined ? { pauseMs: v.pauseMs } : {}), utteranceMs: v.utteranceMs });
        }),
      );
  } catch {
    /* no audio in this environment */
  }

  // ── hover ───────────────────────────────────────────────────────────────────
  const hovering = new Set<string>();
  const hover = (agentId: string, phase: HoverPhase, via: HoverVia) => {
    if (phase === 'leave') {
      hovering.delete(agentId);
      runner.hover(agentId, 'leave', via);
      return;
    }
    if (phase === 'enter') hovering.add(agentId);
    if (agents.get(agentId)) {
      runner.hover(agentId, phase, via);
      return;
    }
    // A pointer sweeping across the grid loads nothing: a desk's profile loads on the dwell (a real pause).
    if (phase === 'enter') return;
    void agents.load(agentId).then((e) => {
      if (!e || disposed) return;
      if (via !== 'pointer' || hovering.has(agentId)) runner.hover(agentId, phase, via);
    });
  };

  /**
   * The office's greeting on Join and sign-off on Leave (OFFICE-PHASE2 §4.5.11): catalog selection with live grounding
   * (the owner's name, a first meeting). The text comes back at once; the voice follows only in the tab that may voice,
   * with voice on and audio armed, from a clip (pre-voiced, or rendered now) that starts within its TTL. Keyless: text.
   */
  const sayIntent = async (agentId: string, intent: 'greeting' | 'sign_off'): Promise<{ text: string; voiced: boolean } | null> => {
    try {
      const e = await agents.load(agentId);
      if (!e || disposed) return null;
      const state = grounding(agentId);
      if (!state) return null;
      const t = now();
      const provider = e.resp.provider;
      const canVoice = voiceAudible() && !claimUnsettled() && provider !== 'browser';
      const manifest = agents.manifest(agentId);
      const seed = `${agentId}|${intent}|office|${Math.floor(t / 60_000)}`;
      const pick = (s: string) =>
        selectLine(
          e.index,
          {
            intent,
            state,
            mood: agents.mood(agentId),
            ambience: ambienceOf(settings.peek()),
            provider,
            seed: s,
            now: t,
            channel: canVoice ? 'voice' : 'text',
            clips: { has: (k) => !!clips.get(k), durationMs: (k) => clips.get(k)?.durationMs ?? null, pronunciationChecked: () => false },
            clipKeyOf: (lineId, fk) => manifest?.clips[`${lineId}|${fk}`]?.clipKey,
          },
          recency,
        );
      let res = pick(seed);
      // Joining a huddle is greeted by name when the owner gave one (OFFICE-PHASE2 §0): among the lines the catalog
      // allows right now, one that says the name wins; the pick stays deterministic (seeded) and pure.
      if (res.ok && intent === 'greeting' && state.owner?.firstName && res.utterance.fills.owner_name === undefined) {
        for (let k = 1; k <= NAMED_GREETING_TRIES; k++) {
          const alt = pick(`${seed}|named${k}`);
          if (alt.ok && alt.utterance.fills.owner_name !== undefined) {
            res = alt;
            break;
          }
        }
      }
      if (!res.ok) return null;
      const u = res.utterance;
      recordUtterance(recency, e.index, u, t, ownerDayKey(state));
      facePort.cue(agentId, u.face);
      if (!canVoice || u.nonverbal) return { text: u.caption, voiced: false };
      const started = t;
      void (async () => {
        const key = manifest?.clips[`${u.lineId}|${u.fillKey}`]?.clipKey;
        const clip = key ? await clips.load(key) : await render({ agentId, lineId: u.lineId, fills: u.fills, provider });
        // One voice per workspace, checked again when it would start: a late clip plays nothing.
        if (!clip || disposed || !mayVoice() || claimUnsettled() || now() - started > SAY_INTENT_VOICE_TTL_MS) return;
        basePort.play({ agentId, clip, bus: 'reflex', gainDb: 0, priority: 6, ttlMs: 800, caption: u.caption, intent });
      })().catch(() => undefined);
      return { text: u.caption, voiced: true };
    } catch {
      return null;
    }
  };

  const rt: LivingRuntime = {
    runner,
    catalog,
    ownerTurn(e: OwnerTurnInput) {
      runner.ownerTurn({ ...e, cues: sniffOwnerText(e.text, catalog.lexicon) });
      remember(ownTurns, e.turnId, true);
      const held = early.get(e.turnId);
      early.delete(e.turnId);
      for (const ev of held?.events ?? []) runner.conversation(ev);
      const mine = heldSays.filter((h) => h.data.turnId === e.turnId);
      heldSays = heldSays.filter((h) => h.data.turnId !== e.turnId);
      for (const h of mine) playOwn(h.data);
    },
    sendSettled() {
      if (sendsInFlight() > 0) return;
      // Nothing of ours is in flight: what was held belongs to another tab's turn.
      const t = now();
      for (const h of heldSays) if (t - h.at <= HOLD_MAX_MS) faceOnly(h.data);
      heldSays = [];
      for (const [turnId, slot] of early) {
        early.delete(turnId);
        for (const ev of slot.events) runner.conversation(ev);
      }
    },
    hover,
    ensureAgent: (agentId) => agents.load(agentId).then((e) => !!e),
    sendDecision(agentId, text) {
      const s = speakerOf(agentId);
      const busy = basePort.voiceBusy(agentId);
      const d = catalog.defaults;
      const stopOrSteer = sniffOwnerText(text, catalog.lexicon).stopOrSteer;
      const decision = sendWhileSpeaking({
        speaking: busy.bus === 'conversation' || !!s?.active,
        remainingMs: busy.remainingMs,
        stopOrSteer,
        ...(typeof d.juggle_min_remaining_ms === 'number' ? { finishWithinMs: d.juggle_min_remaining_ms } : {}),
        ...(typeof d.juggle_preempt_over_ms === 'number' ? { juggleWithinMs: d.juggle_preempt_over_ms } : {}),
      });
      // The reflex between the two answers ("hold that thought" … "all yours", or "got it" when the reply stops at its
      // sentence) plays before the new answer starts.
      if (decision === 'juggle') holdNextReply(agentId, 'back_with_you');
      else if (decision === 'boundary') holdNextReply(agentId, 'acknowledge');
      return decision;
    },
    bargeIn(agentId) {
      const busy = basePort.voiceBusy(agentId).busy || !!speakerOf(agentId)?.active;
      if (busy) runner.bargeIn(agentId);
      if (agentId === CHIEF_ID) nextReply?.release();
    },
    setAmbience(a: Ambience) {
      runner.setSettings({ ambience: a });
    },
    cues: (text) => sniffOwnerText(text, catalog.lexicon),
    clipsDecoded: () => clips.decodedCount(),
    huddles: deps.huddles ?? null,
    ambientVoice: {
      leftMs: () => budget.voiceLeftMs?.(now()) ?? 0,
      spend: (ms: number) => budget.spendVoice?.(now(), ms),
    },
    loadClip: (clipKey: string): Promise<PreparedClip | null> => clips.load(clipKey).catch(() => null),
    moodOf(agentId: string): Mood | null {
      const st = agents.moodState(agentId);
      if (st) return moodAt(st, now());
      return agents.get(agentId) ? agents.mood(agentId) : null;
    },
    provider: (agentId: string) => agents.provider(agentId),
    profileOf: (agentId: string) => agents.get(agentId)?.resp.profile ?? null,
    sayIntent: (agentId, intent) => sayIntent(agentId, intent),
    dispose() {
      if (disposed) return;
      disposed = true;
      ticking?.();
      saveTimer?.();
      saveRecency();
      nextReply?.release();
      for (const d of deferredDone.values()) d.cancel();
      for (const d of disposers.splice(0)) {
        try {
          d();
        } catch {
          /* keep disposing */
        }
      }
      sender.dispose();
      runner.destroy();
    },
  };

  if (deps.devHook) {
    const w = window as unknown as { __headcount?: Record<string, unknown> };
    w.__headcount = {
      ...(w.__headcount ?? {}),
      living: {
        runner,
        captions: captionLog,
        cues: cueLog,
        telemetry,
        clipsDecoded: () => clips.decodedCount(),
        ambience: () => ambienceOf(settings.peek()),
        viewer: () => currentViewer(),
        agent: (id: string) => agents.get(id)?.resp ?? null,
        mood: (id: string) => agents.moodState(id),
        /** e2e: force quiet hours on or off (null: the owner-local clock, 22:00–07:00). */
        setQuietHours: (v: boolean | null) => {
          quietOverride = v;
          quietHoursNow.value = v ?? isQuietHours(new Date(now()));
          runner.setSettings({ quietHours: quiet() });
          updateViewer();
        },
      },
    };
  }
  return rt;
}

/** Load the catalog, compile it off the critical path, and start the runtime. Throws when the worker has none. */
export async function bootLiving(opts: { send(op: ViewerOp | ExprRecentOp): void }): Promise<LivingRuntime> {
  const bundle = await api.exprCatalog();
  if (bundle?.kind !== 'expression_bundle' || !bundle.input) throw new Error('No expression catalog.');
  const compiled = await new Promise<CompiledCatalog>((resolve, reject) => {
    const run = () => {
      try {
        resolve(compileCatalog(bundle.input as ExpressionCatalogInput));
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    };
    if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 3000 });
    else setTimeout(run, 0);
  });
  let caches: CacheStorage | null = null;
  let storage: Storage | null = null;
  try {
    caches = typeof globalThis.caches === 'undefined' ? null : globalThis.caches;
  } catch {
    caches = null;
  }
  try {
    storage = typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    storage = null;
  }
  return createLivingRuntime({
    catalog: compiled,
    engine: audio,
    send: opts.send,
    api,
    fetch: (url) => fetch(url),
    caches,
    storage,
    devHook: import.meta.env.DEV,
    huddles: bundle.huddles && Array.isArray(bundle.huddles.packs) ? { version: String(bundle.huddles.version ?? ''), packs: bundle.huddles.packs } : null,
  });
}
