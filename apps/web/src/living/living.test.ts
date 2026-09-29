// The living layer's pure parts: captions and bubbles, the clip store, the ports, grounding, the send and dwell
// policies, and the viewer ops.
import type { PreparedAudio } from '@headcount/audio';
import type { RecencySnapshot } from '@headcount/expressions';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ThreadItem } from '../store';
import { createFakeAudio } from '../test/fake-audio';
import { BUBBLE_HOLD_AFTER_MS, BUBBLE_MIN_VISIBLE_MS, bubbles, captionLog, clearCaption, dismissBubble, holdBubble, lastSaid, liveCaptions, resetCaptions, showCaption } from './captions';
import { CLIP_CACHE, createClipStore } from './clips';
import { chiefGrounding, coworkerGrounding, currentJob, isQuietHours, RETURNING_AFTER_MS } from './grounding';
import { createDwell, sendWhileSpeaking } from './policy';
import { createAudioPort, MS_PER_UNSYNTHESISED_CHAR, voiceBusyOf } from './ports';
import { livelyAnyway, quietHoursApply, quietHoursEnd, setLivelyAnyway } from './quiet';
import { createOpSender, recentOp, RECENT_MIN_GAP_MS, RECENT_WINDOW_MS, stageOf, VIEWER_DEBOUNCE_MS, viewerOp } from './viewer';

// ── captions and bubbles ────────────────────────────────────────────────────────
describe('captions and bubbles (L6, §8.2)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetCaptions();
  });
  afterEach(() => vi.useRealTimers());

  it('shows a caption line for its TTL, and a newer one replaces it', () => {
    showCaption({ agentId: 'cw_chief', text: 'mm-hm', kind: 'reaction', ttlMs: 1500, replyable: false });
    expect(liveCaptions.value.cw_chief).toMatchObject({ text: 'mm-hm', kind: 'reaction' });
    vi.advanceTimersByTime(1000);
    showCaption({ agentId: 'cw_chief', text: 'On it.', kind: 'line', ttlMs: 1500, replyable: false });
    vi.advanceTimersByTime(1000);
    expect(liveCaptions.value.cw_chief?.text).toBe('On it.'); // the first one's timer does not clear the second
    vi.advanceTimersByTime(600);
    expect(liveCaptions.value.cw_chief).toBeUndefined();
    expect(captionLog.map((c) => c.text)).toEqual(['mm-hm', 'On it.']);
  });

  it('keeps a bubble while held and for 3 s after, and remembers what was said for screen readers', () => {
    showCaption({ agentId: 'cw_a', text: 'Hi — Nina, architecture.', kind: 'bubble', ttlMs: 4000, replyable: true, intent: 'passing_by' });
    expect(lastSaid.value.cw_a).toBe('Hi — Nina, architecture.');
    holdBubble('cw_a', true);
    vi.advanceTimersByTime(20_000);
    expect(bubbles.value.cw_a).toBeDefined();
    holdBubble('cw_a', false);
    vi.advanceTimersByTime(BUBBLE_HOLD_AFTER_MS - 10);
    expect(bubbles.value.cw_a).toBeDefined();
    vi.advanceTimersByTime(20);
    expect(bubbles.value.cw_a).toBeUndefined();
    expect(lastSaid.value.cw_a).toBe('Hi — Nina, architecture.');
  });

  it('a filler, an acknowledgement or a listener sound is never what an agent "last said" (§9.4)', () => {
    showCaption({ agentId: 'cw_chief', text: 'Nice to see you.', kind: 'bubble', ttlMs: 4000, replyable: false, intent: 'greeting' });
    for (const intent of ['thinking_filler', 'holding_filler', 'acknowledge', 'backchannel']) {
      showCaption({ agentId: 'cw_chief', text: 'Ooh, a puzzle. One sec.', kind: 'bubble', ttlMs: 4000, replyable: false, intent });
    }
    expect(lastSaid.value.cw_chief).toBe('Nice to see you.');
  });

  it('a "one sec" bubble cleared by its answer still shows for its minimum, never a flicker', () => {
    showCaption({ agentId: 'cw_chief', text: 'One sec.', kind: 'bubble', ttlMs: 4000, replyable: false, intent: 'thinking_filler' });
    vi.advanceTimersByTime(250);
    clearCaption('cw_chief', 'bubble');
    expect(bubbles.value.cw_chief?.text).toBe('One sec.');
    vi.advanceTimersByTime(BUBBLE_MIN_VISIBLE_MS - 250 + 10);
    expect(bubbles.value.cw_chief).toBeUndefined();
    showCaption({ agentId: 'cw_chief', text: 'Two secs.', kind: 'bubble', ttlMs: 4000, replyable: false, intent: 'thinking_filler' });
    vi.advanceTimersByTime(BUBBLE_MIN_VISIBLE_MS + 1);
    clearCaption('cw_chief', 'bubble');
    expect(bubbles.value.cw_chief).toBeUndefined();
  });

  it('expires an unheld bubble after its TTL; clear() leaves a held one alone', () => {
    showCaption({ agentId: 'cw_b', text: 'Quiet desk.', kind: 'bubble', ttlMs: 4000, replyable: true });
    vi.advanceTimersByTime(4001);
    expect(bubbles.value.cw_b).toBeUndefined();
    showCaption({ agentId: 'cw_b', text: 'Hello again.', kind: 'bubble', ttlMs: 4000, replyable: true });
    holdBubble('cw_b', true);
    clearCaption('cw_b', 'bubble');
    expect(bubbles.value.cw_b).toBeDefined();
    dismissBubble('cw_b');
    expect(bubbles.value.cw_b).toBeUndefined();
  });
});

// ── clip store ──────────────────────────────────────────────────────────────────
function fakeCaches() {
  const store = new Map<string, Response>();
  const puts: string[] = [];
  const cache = {
    match: async (url: string) => store.get(url)?.clone(),
    put: async (url: string, res: Response) => {
      puts.push(url);
      store.set(url, res);
    },
  };
  return { caches: { open: async (name: string) => (name === CLIP_CACHE ? cache : null) } as unknown as CacheStorage, store, puts };
}

const clipResponse = () => new Response(new Uint8Array(64), { headers: { 'content-type': 'audio/wav' } });
const alignResponse = (key: string) => new Response(JSON.stringify({ clipKey: key, text: 'On it.', alignment: null }), { headers: { 'content-type': 'application/json' } });

function clipDeps(over: Partial<Parameters<typeof createClipStore>[0]> = {}) {
  const fetches: string[] = [];
  const prepared: { key: string; text: string | undefined; mime: string | undefined }[] = [];
  const deps: Parameters<typeof createClipStore>[0] = {
    prepare: async (bytes, opts) => {
      prepared.push({ key: opts.key, text: opts.text, mime: opts.mime });
      return { key: opts.key, durationMs: 500, alignment: opts.alignment, text: opts.text ?? null, bytes: 1000 } satisfies PreparedAudio;
    },
    fetch: async (url) => {
      fetches.push(url);
      if (url.includes('missing')) return new Response('', { status: 404 });
      const key = decodeURIComponent(url.split('/')[4]!);
      return url.endsWith('/align') ? alignResponse(key) : clipResponse();
    },
    manifest: () => null,
    ...over,
  };
  return { deps, fetches, prepared };
}

describe('clip store (§7.3)', () => {
  it('fetches once, caches bytes and alignment, and serves the decoded clip synchronously', async () => {
    const c = fakeCaches();
    const { deps, fetches, prepared } = clipDeps({ caches: c.caches });
    const store = createClipStore(deps);
    expect(store.get('c1_a')).toBeNull();
    const clip = await store.load('c1_a');
    expect(clip).toMatchObject({ key: 'c1_a', durationMs: 500 });
    expect(store.get('c1_a')).toBe(clip);
    expect(prepared).toEqual([{ key: 'c1_a', text: 'On it.', mime: 'audio/wav' }]);
    expect(c.puts.sort()).toEqual(['/api/expr/clips/c1_a', '/api/expr/clips/c1_a/align']);
    // A second store (a new tab) reads the cache: no network.
    const again = createClipStore(clipDeps({ caches: c.caches }).deps);
    const before = fetches.length;
    expect(await again.load('c1_a')).not.toBeNull();
    expect(fetches.length).toBe(before);
  });

  it('evicts the least recently used clips past the decoded budget', async () => {
    const { deps } = clipDeps({ budgetBytes: 2500 });
    const store = createClipStore(deps);
    await store.load('c1_a');
    await store.load('c1_b');
    store.get('c1_a'); // a is now more recent than b
    await store.load('c1_c');
    expect(store.has('c1_a')).toBe(true);
    expect(store.has('c1_b')).toBe(false);
    expect(store.has('c1_c')).toBe(true);
    expect(store.decodedBytes()).toBeLessThanOrEqual(2500);
  });

  it('keeps the P0 reflexes in memory when runtime lines and Floor clips fill the budget', async () => {
    const { deps } = clipDeps({ budgetBytes: 2500 });
    const store = createClipStore(deps);
    store.prefetch(['c1_p0'], 'p0');
    await store.load('c1_p0');
    await store.load('c1_r1');
    await store.load('c1_r2');
    await store.load('c1_r3');
    expect(store.has('c1_p0')).toBe(true);
    expect(store.decodedBytes()).toBeLessThanOrEqual(2500);
  });

  it('trims Cache Storage to its cap, least recently used first, and deletes older hc-expr caches', async () => {
    const store = new Map<string, Response>();
    const deleted: string[] = [];
    const cache = {
      match: async (url: string) => store.get(url)?.clone(),
      put: async (url: string, res: Response) => void store.set(url, res),
      delete: async (url: string) => store.delete(url),
      keys: async () => [...store.keys()].map((url) => ({ url })),
    };
    const caches = {
      open: async () => cache,
      keys: async () => ['hc-expr-v0', CLIP_CACHE, 'other-app'],
      delete: async (name: string) => (deleted.push(name), true),
    } as unknown as CacheStorage;
    const saved = new Map<string, string>();
    const storage = { getItem: (k: string) => saved.get(k) ?? null, setItem: (k: string, v: string) => void saved.set(k, v) };
    let t = 1000;
    const { deps } = clipDeps({ caches, storage, cacheMaxEntries: 4, now: () => (t += 10) });
    const clips = createClipStore(deps);
    for (const k of ['c1_a', 'c1_b', 'c1_c', 'c1_d']) await clips.load(k);
    await new Promise((r) => setTimeout(r, 0));
    expect(deleted).toEqual(['hc-expr-v0']);
    expect(store.size).toBeLessThanOrEqual(4);
    expect(store.has('/api/expr/clips/c1_d')).toBe(true); // the newest stays
    expect(store.has('/api/expr/clips/c1_a')).toBe(false); // the oldest went first
  });

  it('works from memory when Cache Storage is unavailable, and returns null for a clip that does not exist', async () => {
    const broken = { open: () => Promise.reject(new Error('SecurityError')) } as unknown as CacheStorage;
    const { deps, fetches } = clipDeps({ caches: broken });
    const store = createClipStore(deps);
    expect(await store.load('c1_a')).not.toBeNull();
    expect(await store.load('missing')).toBeNull();
    expect(fetches.filter((u) => u === '/api/expr/clips/c1_a')).toHaveLength(1);
  });

  it('prefetches at most four at a time and joins a load already in flight', async () => {
    let inflight = 0;
    let peak = 0;
    const { deps } = clipDeps({
      fetch: async (url) => {
        inflight++;
        peak = Math.max(peak, inflight);
        await new Promise((r) => setTimeout(r, 5));
        inflight--;
        return url.endsWith('/align') ? alignResponse('k') : clipResponse();
      },
    });
    const store = createClipStore(deps);
    store.prefetch(['c1_1', 'c1_2', 'c1_3', 'c1_4', 'c1_5', 'c1_6'], 'p0');
    const same = [store.load('c1_1'), store.load('c1_1')];
    await Promise.all(same);
    await new Promise((r) => setTimeout(r, 60));
    expect(store.decodedCount()).toBe(6);
    expect(peak).toBeLessThanOrEqual(8); // four clips, each with its alignment beside it
  });
});

// ── ports ───────────────────────────────────────────────────────────────────────
describe('audio port over the reflex API (§3.6, B2)', () => {
  const prepared = (key: string): PreparedAudio => ({ key, durationMs: 400, alignment: null, text: null, bytes: 10 });

  it('reports a busy voice with heard time plus unsynthesised text while the stream is open', () => {
    expect(voiceBusyOf({ conversation: false, reflex: false, ambient: true, remainingMs: null, streamOpen: false }, 0)).toEqual({ busy: false, remainingMs: null, bus: null });
    expect(voiceBusyOf({ conversation: true, reflex: false, ambient: false, remainingMs: 1200, streamOpen: true }, 40)).toEqual({ busy: true, remainingMs: 1200 + 40 * MS_PER_UNSYNTHESISED_CHAR, bus: 'conversation' });
    expect(voiceBusyOf({ conversation: true, reflex: false, ambient: false, remainingMs: 1200, streamOpen: false }, 40).remainingMs).toBe(1200);
    expect(voiceBusyOf({ conversation: false, reflex: true, ambient: false, remainingMs: null, streamOpen: false }, 0).bus).toBe('reflex');
  });

  it('maps priorities: juggling interjects into its own answer, a backchannel may play in a pause, the rest plays now', () => {
    const engine = createFakeAudio();
    let pause = false;
    const port = createAudioPort({ engine: () => engine, pendingChars: () => 0, inOwnerPause: () => pause, voiceHint: () => ({ lang: 'en-US' }) });
    engine.setActivity('cw_chief', { conversation: true, remainingMs: 5000, streamOpen: false });
    port.play({ agentId: 'cw_chief', clip: { key: 'j', durationMs: 400, alignment: null, handle: prepared('j') }, bus: 'reflex', gainDb: -2, priority: 1, ttlMs: 4000, caption: 'Hold that thought.' });
    engine.setActivity('cw_chief', null);
    port.play({ agentId: 'cw_chief', clip: { key: 'a', durationMs: 400, alignment: null, handle: prepared('a') }, bus: 'reflex', gainDb: -2, priority: 2, ttlMs: 600, caption: 'On it.' });
    engine.setMicLive(true);
    expect(port.ownerSpeaking()).toBe(true);
    pause = true;
    expect(port.ownerSpeaking()).toBe(false); // a real pause: the gate may let a backchannel through
    port.play({ agentId: 'cw_chief', intent: 'backchannel', clip: { key: 'b', durationMs: 300, alignment: null, handle: prepared('b') }, bus: 'reflex', gainDb: -8, priority: 3, ttlMs: 250, caption: 'mm-hm' });
    expect(engine.reflexes.map((r) => [r.key, r.mode, r.duringOwner])).toEqual([
      ['j', 'interject', false],
      ['a', 'now', false],
      ['b', 'now', true],
    ]);
  });

  it('with the mic live, only a backchannel sounds: a progress line or a celebration in a pause is dropped (L5)', async () => {
    const engine = createFakeAudio();
    const port = createAudioPort({ engine: () => engine, pendingChars: () => 0, inOwnerPause: () => true, voiceHint: () => ({ lang: 'en-US' }) });
    engine.setMicLive(true);
    for (const intent of ['micro_status', 'celebrate', 'oops', 'acknowledge'] as const) {
      const h = port.play({ agentId: 'cw_chief', intent, clip: { key: intent, durationMs: 800, alignment: null, handle: prepared(intent) }, bus: 'reflex', gainDb: 0, priority: 3, ttlMs: 2000, caption: intent });
      expect(await h.done).toBe('dropped');
    }
    expect(engine.reflexes).toEqual([]);
    engine.setMicLive(false);
    port.play({ agentId: 'cw_chief', intent: 'celebrate', clip: { key: 'c', durationMs: 800, alignment: null, handle: prepared('c') }, bus: 'reflex', gainDb: 0, priority: 3, ttlMs: 2000, caption: 'Nice.' });
    expect(engine.reflexes.map((r) => [r.key, r.duringOwner])).toEqual([['c', false]]);
  });

  it('speaks keyless lines with the browser voice on the reflex bus, and drops a clip with nothing decoded', async () => {
    const engine = createFakeAudio();
    const port = createAudioPort({ engine: () => engine, pendingChars: () => 0, inOwnerPause: () => false, voiceHint: () => ({ lang: 'en-GB', presentation: 'feminine' }) });
    const h = port.speakText('cw_chief', 'On it.', { gainDb: -2, bus: 'reflex', priority: 2 });
    expect(await h!.started).toBe(true);
    expect(engine.reflexes[0]).toMatchObject({ kind: 'text', key: 'On it.', bus: 'reflex' });
    const dropped = port.play({ agentId: 'cw_chief', clip: { key: 'x', durationMs: 1, alignment: null, handle: null }, bus: 'reflex', gainDb: 0, priority: 2, ttlMs: 500, caption: '' });
    expect(await dropped.done).toBe('dropped');
  });
});

// ── grounding ───────────────────────────────────────────────────────────────────
const NOW = new Date(2026, 9, 5, 10, 30).getTime(); // Monday 10:30 owner-local
const job = (over: Record<string, unknown> = {}) =>
  ({ jobId: 'job_1', projectId: 'everyday', title: 'Packaging suppliers', brief: 'b', status: 'running', label: 'Reading supplier reviews', step: 3, of: 5, agentId: 'cw_chief', startedAt: '2026-10-05T09:00:00.000Z', updatedAt: '2026-10-05T09:10:00.000Z', steers: [], ...over }) as never;
const owner = (ts: number, over: Partial<ThreadItem> = {}): ThreadItem => ({ messageId: `m${ts}`, turnId: 'turn_x' as never, from: 'owner', text: 'hi', streaming: false, ts: new Date(ts).toISOString(), ...over });

describe('grounding (B4, H1)', () => {
  it('the Chief working: presence, the running sentence, and progress as done = step − 1 of `of`', () => {
    const s = chiefGrounding({ now: NOW, chiefName: 'Sasha', jobs: [job()], thread: [owner(NOW - 60_000)], quietHours: false, greetedThisSession: false });
    expect(s.self).toMatchObject({ agentId: 'cw_chief', firstName: 'Sasha', presence: 'working', staffed: true, activity: 'Reading supplier reviews', role: 'chief' });
    expect(s.work).toEqual({ stepLabel: 'Reading supplier reviews', done: 2, total: 5 });
    expect(s.owner.firstName).toBeNull(); // no owner-name setting yet: lines that need it are never picked
    expect(s.now).toMatchObject({ localHour: 10, weekday: 1 });
    expect(s.history).toMatchObject({ firstMeeting: false, returning: false, newDay: false });
  });

  it('the Chief idle, back after a break, on a new day; never a second hello after onboarding', () => {
    const yesterday = NOW - 20 * 60 * 60_000;
    const s = chiefGrounding({ now: NOW, chiefName: 'Sasha', jobs: [job({ status: 'done', finishedAt: new Date(NOW - 5000).toISOString() })], thread: [owner(yesterday)], quietHours: false, greetedThisSession: false });
    expect(s.self.presence).toBe('idle');
    expect(s.work).toBeUndefined();
    expect(s.history).toMatchObject({ firstMeeting: false, returning: true, newDay: true, winsToday: 1 });
    // Never a first meeting for the Chief: Talk always opens with the lead's own introduction (no second "Hi, I'm …").
    expect(chiefGrounding({ now: NOW, chiefName: 'Sasha', jobs: [], thread: [], quietHours: false, greetedThisSession: false }).history.firstMeeting).toBe(false);
    expect(chiefGrounding({ now: NOW, chiefName: 'Sasha', jobs: [], thread: [], quietHours: false, greetedThisSession: true }).history.firstMeeting).toBe(false);
    expect(chiefGrounding({ now: NOW, chiefName: 'S', jobs: [], thread: [owner(NOW - RETURNING_AFTER_MS + 1000)], quietHours: false, greetedThisSession: false }).history.returning).toBe(false);
  });

  it('prefers a running job over a queued one, and ignores pending owner messages', () => {
    expect(currentJob([job({ jobId: 'q', status: 'queued', updatedAt: '2026-10-05T09:59:00.000Z' }), job({ jobId: 'r' })])?.jobId).toBe('r');
    const s = chiefGrounding({ now: NOW, chiefName: 'S', jobs: [], thread: [owner(NOW, { status: 'pending' })], quietHours: false, greetedThisSession: false });
    expect(s.history).toMatchObject({ firstMeeting: false, returning: false, newDay: false });
  });

  it('a Directory coworker is unstaffed and idle, with no activity to claim (H2)', () => {
    const s = coworkerGrounding({ now: NOW, agentId: 'cw_tech-lead', firstName: 'Nina', chiefName: 'Sasha', sideThread: [], quietHours: true });
    expect(s.self).toEqual({ agentId: 'cw_tech-lead', firstName: 'Nina', presence: 'idle', blocked: false, staffed: false, activity: null, role: null });
    expect(s.work).toBeUndefined();
    expect(s.history.firstMeeting).toBe(true);
    expect(s.quietHours).toBe(true);
    expect(coworkerGrounding({ now: NOW, agentId: 'cw_x', firstName: 'X', chiefName: 'S', sideThread: [owner(NOW - 1000)], quietHours: false }).history.firstMeeting).toBe(false);
  });

  it('quiet hours are 22:00–07:00 owner-local', () => {
    expect(isQuietHours(new Date(2026, 9, 5, 21, 59))).toBe(false);
    expect(isQuietHours(new Date(2026, 9, 5, 22, 0))).toBe(true);
    expect(isQuietHours(new Date(2026, 9, 6, 6, 59))).toBe(true);
    expect(isQuietHours(new Date(2026, 9, 6, 7, 0))).toBe(false);
  });

  it('"Lively anyway" lifts quiet hours until they end, then they apply again', () => {
    const night = new Date(2026, 9, 5, 23, 40);
    expect(quietHoursEnd(night).getHours()).toBe(7);
    expect(quietHoursEnd(night).getDate()).toBe(6);
    setLivelyAnyway(false);
    expect(quietHoursApply(night)).toBe(true);
    setLivelyAnyway(true, night);
    expect(livelyAnyway.value).toBe(true);
    expect(quietHoursApply(new Date(2026, 9, 6, 1, 0))).toBe(false);
    // The next night the choice has run out.
    expect(quietHoursApply(new Date(2026, 9, 6, 23, 0))).toBe(true);
    expect(livelyAnyway.value).toBe(false);
    setLivelyAnyway(false);
  });
});

// ── policies ────────────────────────────────────────────────────────────────────
describe('sending while the Chief speaks (§2.3)', () => {
  it('stops at the boundary on a stop cue or over 8 s left; finishes under 2.5 s; juggles in between', () => {
    expect(sendWhileSpeaking({ speaking: false, remainingMs: null, stopOrSteer: 1 })).toBe('none');
    expect(sendWhileSpeaking({ speaking: true, remainingMs: 1000, stopOrSteer: 0.8 })).toBe('boundary');
    expect(sendWhileSpeaking({ speaking: true, remainingMs: 2000, stopOrSteer: 0 })).toBe('finish');
    expect(sendWhileSpeaking({ speaking: true, remainingMs: null, stopOrSteer: 0 })).toBe('finish');
    expect(sendWhileSpeaking({ speaking: true, remainingMs: 5000, stopOrSteer: 0 })).toBe('juggle');
    expect(sendWhileSpeaking({ speaking: true, remainingMs: 9000, stopOrSteer: 0 })).toBe('boundary');
  });
});

describe('passing by a desk (§8.1)', () => {
  const clock = () => {
    let t = 0;
    const timers: { at: number; fn: () => void; dead: boolean }[] = [];
    return {
      now: () => t,
      schedule(fn: () => void, ms: number) {
        const item = { at: t + ms, fn, dead: false };
        timers.push(item);
        return () => void (item.dead = true);
      },
      advance(ms: number) {
        const end = t + ms;
        for (;;) {
          const next = timers.filter((x) => !x.dead && x.at <= end).sort((a, b) => a.at - b.at)[0];
          if (!next) break;
          next.dead = true;
          t = next.at;
          next.fn();
        }
        t = end;
      },
    };
  };

  it('dwells after 600 ms of rest, restarts on a fast pass, once per visit', () => {
    const c = clock();
    const dwells: string[] = [];
    const d = createDwell({ onDwell: (v) => dwells.push(v), schedule: c.schedule, now: c.now });
    d.enter(0, 0);
    c.advance(400);
    d.move(200, 0); // 0.5 px/ms: passing through
    c.advance(500);
    expect(dwells).toEqual([]);
    c.advance(100);
    expect(dwells).toEqual(['pointer']);
    d.move(201, 0);
    c.advance(2000);
    expect(dwells).toEqual(['pointer']);
    d.leave();
    d.enter(0, 0);
    c.advance(599);
    d.leave();
    c.advance(1000);
    expect(dwells).toEqual(['pointer']);
  });

  it('slow movement still dwells; keyboard focus needs 900 ms', () => {
    const c = clock();
    const dwells: string[] = [];
    const d = createDwell({ onDwell: (v) => dwells.push(v), schedule: c.schedule, now: c.now });
    d.enter(0, 0);
    for (let i = 1; i <= 6; i++) {
      c.advance(100);
      d.move(i * 10, 0); // 0.1 px/ms
    }
    expect(dwells).toEqual(['pointer']);
    d.focus();
    c.advance(899);
    expect(dwells).toEqual(['pointer']);
    c.advance(1);
    expect(dwells).toEqual(['pointer', 'keyboard']);
    d.blur();
    d.focus();
    c.advance(500);
    d.blur();
    c.advance(1000);
    expect(dwells).toEqual(['pointer', 'keyboard']);
  });
});

// ── viewer ops ──────────────────────────────────────────────────────────────────
describe('viewer and recency ops (§3.3)', () => {
  it('derives the stage from the route', () => {
    expect(stageOf({ name: 'talk', params: {} })).toEqual({ surface: 'talk', stageAgentId: 'cw_chief' });
    expect(stageOf({ name: 'coworker', params: { personaId: 'tech-lead' } })).toEqual({ surface: 'desk', stageAgentId: 'cw_tech-lead' });
    expect(stageOf({ name: 'floor', params: {} })).toEqual({ surface: 'floor', stageAgentId: null });
    expect(stageOf({ name: 'projects', params: {} })).toEqual({ surface: 'elsewhere', stageAgentId: null });
    const op = viewerOp({ route: { name: 'floor', params: {} }, audioArmed: true, voiceOn: true, pageVisible: true, reducedMotion: false, quietHours: false, tzOffsetMin: -120, voice: { agentId: 'cw_chief', untilMs: 1_000_000_250 } });
    expect(op).toMatchObject({ op: 'viewer', surface: 'floor', floorVisible: true, stageAgentId: null, tzOffsetMin: -120, voice: { agentId: 'cw_chief', untilMs: 1_000_001_000 } });
  });

  it('sends each agent’s newest line ids, at most 32', () => {
    const entries = Array.from({ length: 40 }, (_, i) => ({ lineId: `l${i}`, intent: 'acknowledge' as const, textHash: i, opener: 'x', at: i }));
    const snap: RecencySnapshot = { v: 2, day: '2026-10-05', agents: { cw_chief: entries }, daily: {} };
    const op = recentOp(snap);
    expect(op.agents.cw_chief).toHaveLength(32);
    expect(op.agents.cw_chief![0]).toBe('l39');
  });

  it('sends only lines played in the last 30 minutes (the server stamps them as just played)', () => {
    const now = 10 * 60 * 60_000;
    const entries = [
      { lineId: 'fresh', intent: 'acknowledge' as const, textHash: 1, opener: 'x', at: now - 60_000 },
      { lineId: 'old', intent: 'acknowledge' as const, textHash: 2, opener: 'x', at: now - RECENT_WINDOW_MS - 1 },
      { lineId: 'days', intent: 'thinking_filler' as const, textHash: 3, opener: 'x', at: now - 3 * 24 * 60 * 60_000 },
    ];
    const snap: RecencySnapshot = { v: 2, day: '2026-10-05', agents: { cw_chief: entries, cw_old: [entries[2]!] }, daily: {} };
    expect(recentOp(snap, undefined, now).agents).toEqual({ cw_chief: ['fresh'] });
  });

  it('debounces the viewer op, drops repeats, and spaces recency by 10 s (forced after a connect)', () => {
    let t = 0;
    const timers: { at: number; fn: () => void; dead: boolean }[] = [];
    const sent: string[] = [];
    const clk = {
      now: () => t,
      schedule: (fn: () => void, ms: number) => {
        const it = { at: t + ms, fn, dead: false };
        timers.push(it);
        return () => void (it.dead = true);
      },
    };
    const run = (ms: number) => {
      t += ms;
      for (const x of timers) if (!x.dead && x.at <= t) {
        x.dead = true;
        x.fn();
      }
    };
    const s = createOpSender((op) => sent.push(op.op === 'viewer' ? `viewer:${op.surface}` : `recent:${Object.keys(op.agents).length}`), clk);
    const v = (surface: 'talk' | 'floor') => viewerOp({ route: { name: surface, params: {} }, audioArmed: false, voiceOn: true, pageVisible: true, reducedMotion: false, quietHours: false, tzOffsetMin: 0, voice: null });
    s.viewer(v('talk'));
    s.viewer(v('floor'));
    run(VIEWER_DEBOUNCE_MS);
    s.viewer(v('floor'));
    run(VIEWER_DEBOUNCE_MS);
    expect(sent).toEqual(['viewer:floor']);
    s.viewer(v('floor'), true);
    expect(sent).toEqual(['viewer:floor', 'viewer:floor']);
    s.recent({ op: 'expr.recent', agents: { a: ['1'] } }, true);
    s.recent({ op: 'expr.recent', agents: { a: ['1'], b: ['2'] } });
    run(1000);
    expect(sent.filter((x) => x.startsWith('recent'))).toEqual(['recent:1']);
    run(RECENT_MIN_GAP_MS);
    expect(sent.filter((x) => x.startsWith('recent'))).toEqual(['recent:1', 'recent:2']);
  });
});
