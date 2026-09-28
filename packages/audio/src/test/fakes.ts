// Test doubles for Web Audio, speechSynthesis, MediaRecorder and getUserMedia. Time is manual:
// FakeAudioContext.advance(seconds) moves the audio clock and fires `onended` for sources that finished.

export class FakeParam {
  events: { kind: string; value: number; time: number }[] = [];
  constructor(public value: number) {}
  setValueAtTime(value: number, time: number) {
    this.events.push({ kind: 'set', value, time });
    this.value = value;
    return this;
  }
  linearRampToValueAtTime(value: number, time: number) {
    this.events.push({ kind: 'ramp', value, time });
    this.value = value;
    return this;
  }
  setTargetAtTime(value: number, time: number) {
    this.events.push({ kind: 'target', value, time });
    this.value = value;
    return this;
  }
  cancelScheduledValues(time: number) {
    this.events.push({ kind: 'cancel', value: this.value, time });
    return this;
  }
}

export class FakeNode {
  outputs: FakeNode[] = [];
  disconnected = false;
  constructor(
    readonly ctx: FakeAudioContext,
    readonly kind: string,
  ) {}
  connect<T extends FakeNode>(node: T): T {
    this.outputs.push(node);
    return node;
  }
  disconnect() {
    this.outputs = [];
    this.disconnected = true;
  }
}

export class FakeGain extends FakeNode {
  gain = new FakeParam(1);
  constructor(ctx: FakeAudioContext) {
    super(ctx, 'gain');
  }
}

export class FakeAnalyser extends FakeNode {
  fftSize = 2048;
  smoothingTimeConstant = 0.8;
  /** dB written into every frequency bin. */
  db = -100;
  /** Value written into every time-domain sample (mic meter). */
  sample = 0;
  constructor(ctx: FakeAudioContext) {
    super(ctx, 'analyser');
  }
  get frequencyBinCount() {
    return this.fftSize / 2;
  }
  getFloatFrequencyData(arr: Float32Array) {
    arr.fill(this.db);
  }
  getFloatTimeDomainData(arr: Float32Array) {
    arr.fill(this.sample);
  }
}

export class FakeBuffer {
  readonly numberOfChannels = 1;
  readonly length: number;
  private readonly data: Float32Array;
  constructor(
    readonly duration: number,
    readonly sampleRate = 8000,
  ) {
    this.length = Math.round(duration * sampleRate);
    this.data = new Float32Array(this.length);
    // A voiced tone so offline analysis finds speech.
    for (let i = 0; i < this.length; i++) this.data[i] = 0.3 * Math.sin((2 * Math.PI * 220 * i) / sampleRate);
  }
  getChannelData() {
    return this.data;
  }
}

export class FakeSource extends FakeNode {
  buffer: FakeBuffer | null = null;
  startAt: number | null = null;
  stopAt: number | null = null;
  ended = false;
  onended: (() => void) | null = null;
  constructor(ctx: FakeAudioContext) {
    super(ctx, 'source');
  }
  start(when = 0) {
    if (this.startAt !== null) throw new Error('InvalidStateError: start twice');
    this.startAt = when;
  }
  stop(when = 0) {
    if (this.startAt === null) throw new Error('InvalidStateError: stop before start');
    this.stopAt = Math.max(when, 0);
  }
  /** Context time at which this source goes silent. */
  get endAt(): number {
    const natural = (this.startAt ?? 0) + (this.buffer?.duration ?? 0);
    return this.stopAt === null ? natural : Math.min(natural, Math.max(this.stopAt, this.startAt ?? 0));
  }
}

/** Encodes a fake "clip": the decoder reads the duration (seconds) from the first float64. */
export function fakeClip(seconds: number): ArrayBuffer {
  const buf = new ArrayBuffer(16);
  new DataView(buf).setFloat64(0, seconds);
  return buf;
}

export class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  currentTime = 0;
  sampleRate = 48000;
  baseLatency = 0;
  outputLatency = 0;
  destination: FakeNode;
  sources: FakeSource[] = [];
  analysers: FakeAnalyser[] = [];
  gains: FakeGain[] = [];
  /** Held decodes resolve when the test calls releaseDecodes(). */
  holdDecodes = false;
  private held: (() => void)[] = [];
  private listeners = new Set<() => void>();
  /** Clock for getOutputTimestamp (tests share it with the engine's `now`). */
  static clock: () => number = () => 1000;

  constructor() {
    this.destination = new FakeNode(this, 'destination');
    FakeAudioContext.instances.push(this);
  }
  createGain() {
    const g = new FakeGain(this);
    this.gains.push(g);
    return g;
  }
  createAnalyser() {
    const a = new FakeAnalyser(this);
    this.analysers.push(a);
    return a;
  }
  createBufferSource() {
    const s = new FakeSource(this);
    this.sources.push(s);
    return s;
  }
  createMediaStreamSource() {
    return new FakeNode(this, 'mic');
  }
  decodeAudioData(data: ArrayBuffer): Promise<FakeBuffer> {
    if (data.byteLength < 8) return Promise.reject(new Error('EncodingError'));
    const seconds = new DataView(data).getFloat64(0);
    const buffer = new FakeBuffer(seconds);
    if (!this.holdDecodes) return Promise.resolve(buffer);
    return new Promise((resolve) => this.held.push(() => resolve(buffer)));
  }
  releaseDecodes() {
    for (const r of this.held.splice(0)) r();
  }
  async resume() {
    if (this.state === 'closed') throw new Error('closed');
    this.state = 'running';
    for (const l of this.listeners) l();
  }
  async close() {
    this.state = 'closed';
  }
  addEventListener(_type: string, cb: () => void) {
    this.listeners.add(cb);
  }
  removeEventListener(_type: string, cb: () => void) {
    this.listeners.delete(cb);
  }
  getOutputTimestamp() {
    return { contextTime: this.currentTime, performanceTime: FakeAudioContext.clock() };
  }
  /** Move the audio clock; fires onended for sources that are done. */
  advance(seconds: number) {
    this.currentTime += seconds;
    for (const s of this.sources) {
      if (s.ended || s.startAt === null) continue;
      if (this.currentTime + 1e-9 >= s.endAt) {
        s.ended = true;
        s.onended?.();
      }
    }
  }
  /** Sources that were started and are audible at the current time. */
  audible(): FakeSource[] {
    return this.sources.filter((s) => s.startAt !== null && !s.ended && s.startAt <= this.currentTime + 1e-9 && this.currentTime < s.endAt);
  }
}

// ── speechSynthesis ──────────────────────────────────────────────────────────

export class FakeUtterance {
  voice: unknown = null;
  lang = '';
  rate = 1;
  pitch = 1;
  volume = 1;
  onstart: ((e: unknown) => void) | null = null;
  onend: ((e: unknown) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onboundary: ((e: { charIndex: number }) => void) | null = null;
  constructor(public text = '') {}
}

export class FakeSynth {
  queue: FakeUtterance[] = [];
  current: FakeUtterance | null = null;
  spoken: string[] = [];
  cancels = 0;
  voices: { name: string; lang: string; localService: boolean; default: boolean; voiceURI: string }[] = [];
  getVoices() {
    return this.voices;
  }
  speak(u: FakeUtterance) {
    this.queue.push(u);
    this.pump();
  }
  private pump() {
    if (this.current || !this.queue.length) return;
    const u = this.queue.shift()!;
    this.current = u;
    this.spoken.push(u.text);
    queueMicrotask(() => u.onstart?.({}));
  }
  /** Test control: the current utterance finishes. */
  finish() {
    const u = this.current;
    this.current = null;
    u?.onend?.({});
    this.pump();
  }
  boundary(charIndex: number) {
    this.current?.onboundary?.({ charIndex });
  }
  cancel() {
    this.cancels++;
    const all = [this.current, ...this.queue].filter(Boolean) as FakeUtterance[];
    this.current = null;
    this.queue = [];
    for (const u of all) u.onerror?.({ error: 'interrupted' });
  }
  addEventListener() {}
  removeEventListener() {}
}

// ── mic ──────────────────────────────────────────────────────────────────────

export class FakeTrack {
  stopped = false;
  readyState = 'live';
  stop() {
    this.stopped = true;
    this.readyState = 'ended';
  }
}

export class FakeStream {
  tracks = [new FakeTrack()];
  getTracks() {
    return this.tracks;
  }
}

export function fakeMediaDevices(fail?: string) {
  const streams: FakeStream[] = [];
  return {
    streams,
    async getUserMedia() {
      if (fail) throw Object.assign(new Error(fail), { name: fail });
      const s = new FakeStream();
      streams.push(s);
      return s as unknown as MediaStream;
    },
  };
}

export class FakeRecorder {
  static supported = ['audio/webm;codecs=opus', 'audio/webm'];
  static instances: FakeRecorder[] = [];
  static isTypeSupported(t: string) {
    return FakeRecorder.supported.includes(t);
  }
  state: 'inactive' | 'recording' = 'inactive';
  mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  timeslice: number | undefined;
  constructor(
    readonly stream: unknown,
    opts?: { mimeType?: string },
  ) {
    this.mimeType = opts?.mimeType ?? 'audio/webm';
    FakeRecorder.instances.push(this);
  }
  start(timeslice?: number) {
    this.state = 'recording';
    this.timeslice = timeslice;
  }
  stop() {
    if (this.state === 'inactive') return;
    this.state = 'inactive';
    queueMicrotask(() => {
      this.ondataavailable?.({ data: new Blob(['opus-bytes'], { type: this.mimeType }) });
      this.onstop?.();
    });
  }
}

// ── recognition ──────────────────────────────────────────────────────────────

export class FakeRecognition {
  static instances: FakeRecognition[] = [];
  lang = '';
  interimResults = false;
  continuous = false;
  maxAlternatives = 1;
  onresult: ((e: { resultIndex: number; results: unknown }) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  onstart: (() => void) | null = null;
  starts = 0;
  running = false;
  constructor() {
    FakeRecognition.instances.push(this);
  }
  start() {
    this.starts++;
    this.running = true;
    queueMicrotask(() => this.onstart?.());
  }
  stop() {
    if (!this.running) return;
    this.running = false;
    queueMicrotask(() => this.onend?.());
  }
  abort() {
    this.running = false;
    queueMicrotask(() => this.onend?.());
  }
  /** Test control: emit results [[text, isFinal], …]. */
  emit(results: [string, boolean][]) {
    const list = results.map(([t, f]) => Object.assign([{ transcript: t }], { isFinal: f }));
    this.onresult?.({ resultIndex: 0, results: list });
  }
  /** Test control: the browser ends the session on its own (silence). */
  endByItself() {
    this.running = false;
    this.onend?.();
  }
}
