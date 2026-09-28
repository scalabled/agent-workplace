// The client audio engine (ARCHITECTURE §8.6, EXPERIENCE §5):
//
//   sources → utterance gain (fade on stop) → speaker gain → analyser tap → voices bus → ducker → master → out
//
// One AudioContext for the page, created/resumed in a user gesture (PG armAudio). Every decoded chunk is
// scheduled gaplessly into its speaker's channel, so the analyser tap always hears exactly what plays
// (the OC SpeechOutput.captureTap idea, without media elements). Barge-in by generations
// (PG transports.ts outputGeneration, OC SpeechOutput generation): stopSpeaker() bumps the speaker's
// generation, stops every scheduled and playing source at once (BB only reset a playhead and let sources
// run on) and any chunk that arrives or finishes decoding later is dropped.

import type { Alignment, MouthSampler } from '@headcount/protocol';
import { BrowserVoiceLane } from './browser-voice';
import { SentenceChunker } from './chunker';
import { startRecognition } from './dictation';
import { micError, openRecorder } from './mic';
import { analyzeBuffer, segmentSpeech, warpTimelineToSegments } from './lipsync/audio-features';
import { SpeakerSampler, SpectrumReader, UtteranceSampler } from './lipsync/sampler';
import { alignmentToVisemeSequence, textToVisemeSequence } from './lipsync/visemes';
import { speakable } from './speakable';
import type {
  AudioEngine,
  AudioEngineDeps,
  AudioSupport,
  DictationOptions,
  DictationSession,
  MicSession,
  SpeakChunk,
  SpeakHandle,
  SpeakOutcome,
  SpeakRequest,
  SpeechChunk,
} from './types';

/** Scheduling lead so the first chunk never starts in the past. */
export const SCHEDULE_LEAD_S = 0.03;
/** Fade applied on stop (click-free, still "at once"). */
export const STOP_FADE_S = 0.015;
/** Owner speech ducks voices by 18 dB (EXPERIENCE §10.7). */
export const DUCK_GAIN = Math.pow(10, -18 / 20);
const DUCK_TIME_CONSTANT_S = 0.01; // ≈30 ms to settle
/** Nothing playing for this long between chunks → the speaker is no longer "speaking". */
export const STARVE_MS = 350;
/** How long speak() waits for a suspended context (autoplay policy) before giving up on audio. */
const RESUME_WAIT_MS = 2500;

interface Channel {
  gain: GainNode;
  analyser: AnalyserNode;
  reader: SpectrumReader;
  sampler: SpeakerSampler;
}

interface Graph {
  ctx: AudioContext;
  master: GainNode;
  ducker: GainNode;
  voices: GainNode;
}

type G = typeof globalThis & {
  webkitAudioContext?: new () => AudioContext;
  SpeechRecognition?: AudioEngineDeps['SpeechRecognition'];
  webkitSpeechRecognition?: AudioEngineDeps['SpeechRecognition'];
};

export function createAudioEngine(deps: AudioEngineDeps = {}): AudioEngine {
  const g = globalThis as G;
  const pick = <K extends keyof AudioEngineDeps>(key: K, fallback: AudioEngineDeps[K]): AudioEngineDeps[K] => (key in deps ? deps[key] : fallback);
  const Ctx = pick('AudioContext', g.AudioContext ?? g.webkitAudioContext ?? null);
  const synth = pick('speechSynthesis', typeof g.speechSynthesis === 'object' ? g.speechSynthesis : null);
  const Utter = pick('SpeechSynthesisUtterance', g.SpeechSynthesisUtterance ?? null);
  const Recognition = pick('SpeechRecognition', g.SpeechRecognition ?? g.webkitSpeechRecognition ?? null);
  const Recorder = pick('MediaRecorder', g.MediaRecorder ?? null);
  const mediaDevices = pick('mediaDevices', g.navigator?.mediaDevices ?? null);
  const now = deps.now ?? (() => performance.now());
  const secureContext = pick('secureContext', typeof g.isSecureContext === 'boolean' ? g.isSecureContext : undefined);
  const gestureTarget = pick('gestureTarget', typeof g.document !== 'undefined' ? g.document : null);

  let graph: Graph | null = null;
  let destroyed = false;
  let isDucked = false;
  const channels = new Map<string, Channel>();
  const speakerSamplers = new Map<string, SpeakerSampler>();
  const gens = new Map<string, number>();
  const live = new Map<string, Set<Utterance>>(); // queued, loading or playing
  const tails = new Map<string, Promise<unknown>>();
  const sounding = new Map<string, Set<Utterance>>();
  const speakingListeners = new Set<(id: string, on: boolean) => void>();
  const micListeners = new Set<(live: boolean) => void>();
  let micCount = 0;
  let duckHolds = 0;
  let mic: { cancel(): void } | null = null;
  let dictation: DictationSession | null = null;
  const lane = synth && Utter ? new BrowserVoiceLane(synth, Utter, now) : null;

  // ── graph ──────────────────────────────────────────────────────────────────
  function ensureGraph(): Graph | null {
    if (graph || destroyed || !Ctx) return graph;
    try {
      const ctx = new Ctx();
      const master = ctx.createGain();
      const ducker = ctx.createGain();
      const voices = ctx.createGain();
      ducker.gain.value = isDucked ? DUCK_GAIN : 1;
      voices.connect(ducker);
      ducker.connect(master);
      master.connect(ctx.destination);
      graph = { ctx, master, ducker, voices };
    } catch {
      graph = null;
    }
    return graph;
  }

  function channel(speakerId: string): Channel | null {
    const gr = ensureGraph();
    if (!gr) return null;
    let ch = channels.get(speakerId);
    if (ch) return ch;
    const gain = gr.ctx.createGain();
    const analyser = gr.ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.5;
    gain.connect(analyser);
    analyser.connect(gr.voices);
    // The tap is read in render time; the reader delays it by the output latency so it matches what is heard.
    const ctx = gr.ctx;
    ch = { gain, analyser, reader: new SpectrumReader(analyser, ctx.sampleRate, () => perfAt(ctx, ctx.currentTime) - now()), sampler: speakerSampler(speakerId) };
    channels.set(speakerId, ch);
    return ch;
  }

  function speakerSampler(speakerId: string): SpeakerSampler {
    let s = speakerSamplers.get(speakerId);
    if (!s) speakerSamplers.set(speakerId, (s = new SpeakerSampler()));
    return s;
  }

  /** performance.now() at which context time `t` reaches the speakers. */
  function perfAt(ctx: AudioContext, t: number): number {
    try {
      const ts = ctx.getOutputTimestamp?.();
      if (ts && typeof ts.performanceTime === 'number' && ts.performanceTime > 0 && typeof ts.contextTime === 'number') {
        return ts.performanceTime + (t - ts.contextTime) * 1000;
      }
    } catch {
      /* fall through */
    }
    const latency = (ctx.outputLatency || ctx.baseLatency || 0) * 1000;
    return now() + (t - ctx.currentTime) * 1000 + latency;
  }

  async function running(ctx: AudioContext, waitMs: number): Promise<boolean> {
    if (ctx.state === 'running') return true;
    if (ctx.state === 'closed') return false;
    const resumed = ctx.resume().then(
      () => true,
      () => false,
    );
    const deadline = new Promise<boolean>((r) => setTimeout(() => r(false), waitMs));
    await Promise.race([resumed, deadline]);
    if ((ctx.state as AudioContextState) === 'running') return true;
    // Still suspended (no gesture yet): wait for arm() on the next tap or key.
    return new Promise<boolean>((resolve) => {
      const onChange = () => {
        if (ctx.state !== 'running') return;
        clearTimeout(timer);
        ctx.removeEventListener?.('statechange', onChange);
        resolve(true);
      };
      const timer = setTimeout(() => {
        ctx.removeEventListener?.('statechange', onChange);
        resolve(ctx.state === 'running');
      }, waitMs);
      ctx.addEventListener?.('statechange', onChange);
    });
  }

  // ── speaking state ─────────────────────────────────────────────────────────
  function setSounding(id: string, u: Utterance, on: boolean): void {
    let set = sounding.get(id);
    if (!set) sounding.set(id, (set = new Set()));
    const before = set.size > 0;
    if (on) set.add(u);
    else set.delete(u);
    const after = set.size > 0;
    if (before !== after) {
      for (const cb of [...speakingListeners]) {
        try {
          cb(id, after);
        } catch {
          /* a listener must not break playback */
        }
      }
    }
  }

  // ── ducking ────────────────────────────────────────────────────────────────
  function applyDuck(on: boolean): void {
    if (isDucked === on) return;
    isDucked = on;
    const gr = graph;
    if (!gr) return;
    const p = gr.ducker.gain;
    const t = gr.ctx.currentTime;
    try {
      p.cancelScheduledValues(t);
      p.setValueAtTime(p.value, t);
      p.setTargetAtTime(on ? DUCK_GAIN : 1, t, DUCK_TIME_CONSTANT_S);
    } catch {
      p.value = on ? DUCK_GAIN : 1;
    }
  }
  let manualDuck = false;
  const holdDuck = () => {
    duckHolds++;
    applyDuck(true);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      duckHolds = Math.max(0, duckHolds - 1);
      if (duckHolds === 0) applyDuck(manualDuck);
    };
  };
  const heard = () => !isDucked;

  function setMic(delta: 1 | -1): void {
    const before = micCount > 0;
    micCount = Math.max(0, micCount + delta);
    const after = micCount > 0;
    if (before !== after) for (const cb of [...micListeners]) cb(after);
  }

  // ── utterances ─────────────────────────────────────────────────────────────
  class Utterance {
    readonly sampler: UtteranceSampler;
    readonly done: Promise<SpeakOutcome>;
    private resolveDone!: (o: SpeakOutcome) => void;
    private ended = false;
    stopped = false;
    private sources = new Set<AudioBufferSourceNode>();
    private gain: GainNode | null = null;
    private nextTime = 0;
    private iterator: AsyncIterator<SpeakChunk> | null = null;
    private browserCancel: (() => void) | null = null;
    private drainWaiters: (() => void)[] = [];
    private onTimer: ReturnType<typeof setTimeout> | null = null;
    private starveTimer: ReturnType<typeof setTimeout> | null = null;
    private playedAudio = false;
    private spokeBrowser = false;
    private windows: { start: number; end: number }[] = [];
    private browserMs = 0;

    constructor(
      readonly speakerId: string,
      readonly gen: number,
      readonly req: SpeakRequest,
    ) {
      this.sampler = new UtteranceSampler(heard);
      this.done = new Promise<SpeakOutcome>((r) => (this.resolveDone = r));
    }

    get stale(): boolean {
      return this.stopped || this.ended || destroyed || (gens.get(this.speakerId) ?? 0) !== this.gen;
    }

    async run(turn: Promise<unknown>): Promise<void> {
      await turn;
      if (this.stale) return this.finish('stopped');
      if (typeof this.req.chunks === 'string') return this.runBrowser(this.req.chunks);
      return this.runChunks(this.req.chunks);
    }

    // Browser speech for a whole string: sentence by sentence (Chrome cuts long lines, and a sentence
    // boundary is a clean place for barge-in).
    private async runBrowser(text: string): Promise<void> {
      if (!lane) return this.finish('failed', 'Browser speech is not available.');
      const sentences: string[] = [];
      const chunker = new SentenceChunker({ maxTokens: 60, firstClauseChars: 0, onChunk: (s) => sentences.push(s) });
      chunker.push(text);
      chunker.flush();
      for (const s of sentences) {
        const r = await this.sayBrowser(s);
        if (this.stale) return this.finish('stopped');
        if (r.status === 'failed') return this.finish('failed', r.error);
      }
      this.finish('completed');
    }

    private async runChunks(chunks: AsyncIterable<SpeakChunk>): Promise<void> {
      let it: AsyncIterator<SpeakChunk>;
      try {
        it = chunks[Symbol.asyncIterator]();
      } catch (err) {
        return this.finish('failed', errorText(err));
      }
      this.iterator = it;
      let index = 0;
      let lastError: string | undefined;
      for (;;) {
        let r: IteratorResult<SpeakChunk>;
        try {
          r = await it.next();
        } catch (err) {
          if (this.stale) return this.finish('stopped');
          lastError = errorText(err);
          break;
        }
        if (this.stale) return this.finish('stopped'); // late chunk after barge-in: dropped
        if (r.done) break;
        const chunk = normalizeChunk(r.value, index === 0 ? this.req.alignment : null);
        index++;
        if (chunk.audio && isArrayBuffer(chunk.audio) && chunk.audio.byteLength > 0) {
          const played = await this.playAudio(chunk);
          if (this.stale) return this.finish('stopped');
          if (played === 'ok') continue;
          lastError = played;
        }
        const words = chunk.text ? speakable(chunk.text) : '';
        if (words && !lane) lastError ??= 'Browser speech is not available.';
        if (words && lane) {
          await this.drain();
          if (this.stale) return this.finish('stopped');
          const s = await this.sayBrowser(words);
          if (this.stale) return this.finish('stopped');
          if (s.status === 'failed') lastError = s.error;
        }
      }
      this.iterator = null;
      await this.drain();
      if (this.stale) return this.finish('stopped');
      // Sources end on the audio clock; the owner hears the tail one output latency later. The mouth and
      // `speaking` follow what is heard, so wait for the last window to end (barge-in still stops at once).
      await this.untilHeard();
      if (this.stale) return this.finish('stopped');
      if (lastError && !this.playedAudio && !this.spokeBrowser) return this.finish('failed', lastError);
      this.finish('completed', lastError);
    }

    /** Heard time (performance ms) at which the last scheduled audio ends. */
    private heardEnd(): number {
      let end = 0;
      for (const w of this.windows) if (w.end > end) end = w.end;
      return end;
    }

    private untilHeard(): Promise<void> {
      const wait = this.heardEnd() - now();
      if (wait <= 0) return Promise.resolve();
      return new Promise((r) => {
        const t = setTimeout(r, wait);
        // finish() (barge-in, destroy) releases drain waiters: stop waiting then too.
        this.drainWaiters.push(() => {
          clearTimeout(t);
          r();
        });
      });
    }

    /** Decode and schedule one chunk. Returns 'ok' or a reason it could not play. */
    private async playAudio(chunk: SpeechChunk): Promise<'ok' | string> {
      const ch = channel(this.speakerId);
      const gr = graph;
      if (!ch || !gr) return 'Web Audio is not available.';
      let buffer: AudioBuffer;
      try {
        buffer = await decode(gr.ctx, chunk.audio!);
      } catch (err) {
        return `Could not decode audio (${errorText(err)}).`;
      }
      if (this.stale) return 'stale';
      if (!(await running(gr.ctx, RESUME_WAIT_MS))) return 'Audio is blocked until you click or press a key.';
      if (this.stale) return 'stale';
      this.schedule(gr, ch, buffer, chunk);
      return 'ok';
    }

    private schedule(gr: Graph, ch: Channel, buffer: AudioBuffer, chunk: SpeechChunk): void {
      const ctx = gr.ctx;
      if (!this.gain) {
        this.gain = ctx.createGain();
        this.gain.connect(ch.gain);
        this.sampler.attachSpectrum(ch.reader);
      }
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(this.gain);
      const startAt = Math.max(ctx.currentTime + SCHEDULE_LEAD_S, this.nextTime);
      this.nextTime = startAt + buffer.duration;
      this.sources.add(src);
      src.onended = () => this.sourceEnded(src);
      src.start(startAt);
      this.playedAudio = true;

      const perfStart = perfAt(ctx, startAt);
      const durMs = buffer.duration * 1000;
      this.windows.push({ start: perfStart, end: perfStart + durMs });
      this.sampler.addWindow(perfStart, perfStart + durMs);
      const aligned = alignmentToVisemeSequence(chunk.alignment);
      if (aligned) this.sampler.addTimeline(aligned, perfStart, 'alignment');
      else if (chunk.text) {
        let seq = textToVisemeSequence(speakable(chunk.text), durMs);
        try {
          const segs = segmentSpeech(analyzeBuffer(buffer));
          if (segs.length) seq = warpTimelineToSegments(seq, segs);
        } catch {
          /* keep the even spread */
        }
        this.sampler.addTimeline(seq, perfStart, 'timeline');
      }
      ch.sampler.current = this.sampler;

      if (this.starveTimer) {
        clearTimeout(this.starveTimer);
        this.starveTimer = null;
      }
      if (!this.onTimer && !sounding.get(this.speakerId)?.has(this)) {
        const delay = Math.max(0, perfStart - now());
        this.onTimer = setTimeout(() => {
          this.onTimer = null;
          if (!this.stale) setSounding(this.speakerId, this, true);
        }, delay);
      }
    }

    private sourceEnded(src: AudioBufferSourceNode): void {
      if (!this.sources.delete(src)) return;
      try {
        src.disconnect();
      } catch {
        /* ignore */
      }
      if (this.sources.size) return;
      for (const w of this.drainWaiters.splice(0)) w();
      if (this.ended) return;
      // Nothing is playing; more chunks may still be on their way.
      if (this.onTimer) {
        clearTimeout(this.onTimer);
        this.onTimer = null;
      }
      if (!this.starveTimer) {
        // The tail is still reaching the speakers for one output latency: count the starve time from there.
        const tail = Math.max(0, this.heardEnd() - now());
        this.starveTimer = setTimeout(() => {
          this.starveTimer = null;
          if (!this.sources.size) setSounding(this.speakerId, this, false);
        }, tail + STARVE_MS);
      }
    }

    private drain(): Promise<void> {
      if (!this.sources.size) return Promise.resolve();
      return new Promise((r) => this.drainWaiters.push(r));
    }

    private async sayBrowser(text: string) {
      if (!lane) return { status: 'failed' as const, error: 'Browser speech is not available.' };
      let startedAt = 0;
      const job = lane.say({
        speakerId: this.speakerId,
        text,
        hint: this.req.voiceHint,
        onStart: (t) => {
          if (this.stale) return;
          startedAt = t;
          if (this.starveTimer) {
            clearTimeout(this.starveTimer);
            this.starveTimer = null;
          }
          this.sampler.startText(text, t, this.req.voiceHint?.rate ?? 1);
          speakerSampler(this.speakerId).current = this.sampler;
          setSounding(this.speakerId, this, true);
        },
        onBoundary: (i, t) => this.sampler.boundary(i, t),
      });
      this.browserCancel = job.cancel;
      const r = await job.done;
      this.browserCancel = null;
      this.sampler.endText();
      if (startedAt) {
        this.spokeBrowser = true;
        this.browserMs += now() - startedAt;
        if (!this.stale && !this.starveTimer) {
          this.starveTimer = setTimeout(() => {
            this.starveTimer = null;
            if (!this.sources.size) setSounding(this.speakerId, this, false);
          }, STARVE_MS);
        }
      }
      return r;
    }

    /** Barge-in: silence now, drop everything scheduled or still loading. */
    stop(): void {
      if (this.ended) return;
      this.stopped = true;
      const gr = graph;
      if (gr && (this.sources.size || this.gain)) {
        const t = gr.ctx.currentTime;
        if (this.gain) {
          const p = this.gain.gain;
          try {
            p.cancelScheduledValues(t);
            p.setValueAtTime(p.value, t);
            p.linearRampToValueAtTime(0, t + STOP_FADE_S);
          } catch {
            p.value = 0;
          }
        }
        for (const src of this.sources) {
          try {
            src.stop(t + STOP_FADE_S);
          } catch {
            /* never started or already stopped */
          }
        }
      }
      this.browserCancel?.();
      this.browserCancel = null;
      const it = this.iterator;
      this.iterator = null;
      if (it?.return) {
        // Tell the producer (e.g. a SpeechStream) to cancel its pending TTS requests.
        void Promise.resolve()
          .then(() => it.return!())
          .catch(() => undefined);
      }
      this.finish('stopped');
    }

    finish(status: SpeakOutcome['status'], error?: string): void {
      if (this.ended) return;
      this.ended = true;
      if (this.onTimer) clearTimeout(this.onTimer);
      if (this.starveTimer) clearTimeout(this.starveTimer);
      this.onTimer = this.starveTimer = null;
      this.sampler.end();
      const sp = speakerSamplers.get(this.speakerId);
      if (sp?.current === this.sampler) sp.current = null;
      setSounding(this.speakerId, this, false);
      live.get(this.speakerId)?.delete(this);
      for (const w of this.drainWaiters.splice(0)) w();
      const gain = this.gain;
      if (gain) {
        // Let the stop fade finish, then unhook this utterance from the speaker channel.
        setTimeout(
          () => {
            for (const src of this.sources) {
              try {
                src.disconnect();
              } catch {
                /* ignore */
              }
            }
            this.sources.clear();
            try {
              gain.disconnect();
            } catch {
              /* ignore */
            }
          },
          status === 'stopped' ? 50 : 0,
        );
      }
      const source = this.playedAudio ? 'audio' : this.spokeBrowser ? 'browser' : 'none';
      const outcome: SpeakOutcome = { status, source, playedMs: Math.round(this.playedMs() + this.browserMs) };
      if (error && status !== 'stopped' && error !== 'stale') outcome.error = error;
      this.resolveDone(outcome);
    }

    private playedMs(): number {
      const t = now();
      let ms = 0;
      for (const w of this.windows) if (t > w.start) ms += Math.min(t, w.end) - w.start;
      return ms;
    }
  }

  // ── public API ─────────────────────────────────────────────────────────────
  const support = (): AudioSupport => ({
    webAudio: !!Ctx,
    mic: !!mediaDevices?.getUserMedia && !!Recorder,
    speechSynthesis: !!lane,
    speechRecognition: !!Recognition,
  });

  async function arm(): Promise<void> {
    const gr = ensureGraph();
    if (!gr || gr.ctx.state === 'running' || gr.ctx.state === 'closed') return;
    try {
      await gr.ctx.resume();
    } catch {
      /* not in a gesture: the next one will do */
    }
  }

  // Stays attached: a context suspended later (iOS interruption, backgrounded tab) resumes on the next tap.
  const gestureEvents = ['pointerdown', 'keydown', 'touchend'] as const;
  const onGesture = () => {
    if (graph?.ctx.state !== 'running') void arm();
  };
  const removeGestureListeners = () => {
    for (const ev of gestureEvents) gestureTarget?.removeEventListener(ev, onGesture, true);
  };
  if (Ctx && gestureTarget) for (const ev of gestureEvents) gestureTarget.addEventListener(ev, onGesture, { capture: true, passive: true });

  function speak(req: SpeakRequest): SpeakHandle {
    const id = req.speakerId;
    const gen = gens.get(id) ?? 0;
    const u = new Utterance(id, gen, req);
    let set = live.get(id);
    if (!set) live.set(id, (set = new Set()));
    set.add(u);
    const turn = tails.get(id) ?? Promise.resolve();
    tails.set(
      id,
      Promise.all([turn, u.done]).then(
        () => undefined,
        () => undefined,
      ),
    );
    if (destroyed) u.stop();
    else
      void u.run(turn).catch((err: unknown) => {
        // run() handles its own failures; this is a last guard so done always resolves.
        u.finish('failed', errorText(err));
      });
    return { speakerId: id, generation: gen, sampler: u.sampler, done: u.done, stop: () => u.stop() };
  }

  function stopSpeaker(id: string): void {
    gens.set(id, (gens.get(id) ?? 0) + 1);
    for (const u of [...(live.get(id) ?? [])]) u.stop();
    lane?.cancelSpeaker(id);
    tails.delete(id);
  }

  const engine: AudioEngine = {
    get armed() {
      return graph?.ctx.state === 'running';
    },
    get ducked() {
      return isDucked;
    },
    arm,
    speak,
    stopSpeaker,
    stopAll() {
      const ids = new Set<string>([...live.keys(), ...channels.keys(), ...gens.keys()]);
      for (const id of ids) stopSpeaker(id);
      lane?.cancelSpeaker();
    },
    speaking: () => [...sounding.entries()].filter(([, s]) => s.size > 0).map(([id]) => id),
    onSpeakingChange(cb) {
      speakingListeners.add(cb);
      return () => speakingListeners.delete(cb);
    },
    sampler: (speakerId: string): MouthSampler => speakerSampler(speakerId),
    generation: (speakerId: string) => gens.get(speakerId) ?? 0,
    duck(on: boolean) {
      manualDuck = on;
      applyDuck(on || duckHolds > 0);
    },
    async startPushToTalk(): Promise<MicSession> {
      if (destroyed) throw micError('failed');
      mic?.cancel();
      mic = null;
      const unduck = holdDuck();
      setMic(1);
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        unduck();
        setMic(-1);
      };
      try {
        const session = await openRecorder({
          mediaDevices,
          Recorder,
          secureContext,
          context: () => {
            const gr = ensureGraph();
            if (gr && gr.ctx.state !== 'running') void gr.ctx.resume().catch(() => undefined);
            return gr?.ctx ?? null;
          },
          now,
          onRelease: release,
        });
        mic = session;
        return session;
      } catch (err) {
        release();
        throw err;
      }
    },
    startDictation(opts?: DictationOptions): DictationSession | null {
      if (!Recognition || destroyed) return null;
      dictation?.cancel();
      const unduck = holdDuck();
      let on = false;
      const session = startRecognition(Recognition, {
        ...opts,
        onLive: (l) => {
          if (l === on) return;
          on = l;
          setMic(l ? 1 : -1);
          if (!l) unduck();
        },
      });
      if (!on) unduck(); // failed to start
      dictation = session;
      return session;
    },
    micLive: () => micCount > 0,
    onMicChange(cb) {
      micListeners.add(cb);
      return () => micListeners.delete(cb);
    },
    support,
    destroy() {
      if (destroyed) return;
      engine.stopAll();
      destroyed = true;
      mic?.cancel();
      dictation?.cancel();
      mic = dictation = null;
      lane?.destroy();
      removeGestureListeners();
      const gr = graph;
      graph = null;
      channels.clear();
      if (gr) void gr.ctx.close().catch(() => undefined);
      speakingListeners.clear();
      micListeners.clear();
    },
  };
  return engine;
}

function isArrayBuffer(v: unknown): v is ArrayBuffer {
  return v instanceof ArrayBuffer || Object.prototype.toString.call(v) === '[object ArrayBuffer]';
}

function normalizeChunk(value: SpeakChunk, alignment: Alignment | null | undefined): SpeechChunk {
  if (isArrayBuffer(value)) return { audio: value, alignment: alignment ?? null };
  if (ArrayBuffer.isView(value as unknown)) {
    const v = value as unknown as ArrayBufferView;
    return { audio: v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) as ArrayBuffer, alignment: alignment ?? null };
  }
  return value;
}

function decode(ctx: AudioContext, audio: ArrayBuffer): Promise<AudioBuffer> {
  // decodeAudioData detaches its argument; keep the caller's bytes intact.
  const copy = audio.slice(0);
  return new Promise<AudioBuffer>((resolve, reject) => {
    try {
      const p = ctx.decodeAudioData(copy, resolve, reject);
      if (p && typeof p.then === 'function') p.then(resolve, reject);
    } catch (err) {
      reject(err);
    }
  });
}

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
