// Listen in: only the voice owner, voice on, audio armed, a provider voice (keyless is
// captions only), a voiceable line, no live mic, no conversation playing, and room in Listen's own budget (never the
// shared ambient window; Quiet too: the owner asked). A render later than 1.2 s plays nothing.
import type { HuddlePick } from '@headcount/expressions';
import type { HuddleInfo, HuddleLineEvent } from '@headcount/office';
import { describe, expect, it, vi } from 'vitest';
import type { LivingRuntime } from '../living/types';
import { createListen, LISTEN_GAIN_DB, LISTEN_RENDER_TIMEOUT_MS, LISTEN_WINDOW_MS, type ListenDeps } from './listen';

const H: HuddleInfo = { id: 'hd:1', spotId: 'cooler:cafe', spot: 'water_cooler', label: 'Water cooler', members: ['cw_a', 'cw_b'], startedAt: 0, endsAt: 1, joined: false, listening: true, crew: false };
const E: HuddleLineEvent = { exchangeId: 'hd-craft.001', index: 0, line: { personId: 'cw_a', kind: 'line', text: 'Tables beat charts for four numbers.', atMs: 0, estMs: 3000 }, visible: true, listening: true };
const PICK = { exchangeId: 'hd-craft.001', lines: [{ index: 0, agentId: 'cw_a', estMs: 2600, voiceable: true, fills: { name_b: 'Pax' } }] } as unknown as HuddlePick;

function rig(over: Partial<ListenDeps> & { left?: number; provider?: string | null; armed?: boolean; mic?: boolean; fg?: boolean; clipMs?: number } = {}) {
  let now = 1000;
  const played: { speakerId: string; bus: string; gainDb: number }[] = [];
  const spent: number[] = [];
  const renders: unknown[] = [];
  const timers: { fn: () => void; ms: number }[] = [];
  const engine = {
    armed: over.armed ?? true,
    micLive: () => over.mic ?? false,
    foregroundActive: () => over.fg ?? false,
    playPrepared: vi.fn((req: { speakerId: string; bus: string; gainDb: number; onStart?: () => void }) => {
      played.push({ speakerId: req.speakerId, bus: req.bus, gainDb: req.gainDb });
      req.onStart?.();
      return { started: Promise.resolve(true), done: Promise.resolve('completed' as const), stop() {} };
    }),
  };
  const rt = {
    provider: () => (over.provider === undefined ? 'xai' : over.provider),
    ambientVoice: { leftMs: () => over.left ?? 20_000, spend: (ms: number) => spent.push(ms) },
    loadClip: async (key: string) => ({ key, durationMs: over.clipMs ?? 2500, alignment: null, handle: { key } }),
  } as unknown as LivingRuntime;
  const listen = createListen({
    living: () => rt,
    mayVoice: () => true,
    claimUnsettled: () => false,
    voiceOn: () => true,
    ambience: () => 'lively',
    engine: () => engine as unknown as ReturnType<ListenDeps['engine']>,
    pickOf: () => PICK,
    render: async (req) => {
      renders.push(req);
      return { clipKey: 'ck1', url: '', alignmentUrl: '', durationMs: 2500, scope: 'shared', cached: false };
    },
    now: () => now,
    setTimer: (fn, ms) => {
      const t = { fn, ms };
      timers.push(t);
      return () => void timers.splice(timers.indexOf(t), 1);
    },
    ...over,
  });
  listen.setListening(H);
  return { listen, played, spent, renders, timers, advance: (ms: number) => (now += ms) };
}

describe('listen-in voice', () => {
  it('voices a listened line on the ambient bus at −6 dB, at Quiet too, without spending the shared ambient window', async () => {
    const r = rig();
    expect(await r.listen.line(H, E)).toBeNull();
    expect(r.renders).toEqual([{ exchangeId: 'hd-craft.001', index: 0, agentId: 'cw_a', fills: { name_b: 'Pax' }, provider: 'xai' }]);
    expect(r.played).toEqual([{ speakerId: 'cw_a', bus: 'ambient', gainDb: LISTEN_GAIN_DB }]);
    expect(r.spent).toEqual([]);
    // An empty shared window and Quiet do not stop an owner who asked to listen.
    const q = rig({ ambience: () => 'quiet' as const, left: 0 });
    expect(await q.listen.line(H, E)).toBeNull();
    expect(q.played).toHaveLength(1);
  });

  it('has its own budget: 90 s of voice per 10 minutes', async () => {
    const r = rig({ clipMs: 30_000 });
    for (let i = 0; i < 3; i++) expect(await r.listen.line(H, E)).toBeNull();
    expect(await r.listen.line(H, E)).toBe('budget');
    r.advance(LISTEN_WINDOW_MS + 1);
    expect(await r.listen.line(H, E)).toBeNull();
  });

  it.each([
    ['no_voice', { mayVoice: () => false }],
    ['unsettled', { claimUnsettled: () => true }],
    ['voice_off', { voiceOn: () => false }],
    ['not_armed', { armed: false }],
    ['keyless', { provider: 'browser' }],
    ['mic', { mic: true }],
    ['conversation', { fg: true }],
    ['no_runtime', { living: () => null }],
  ] as [string, Parameters<typeof rig>[0]][])('renders nothing when %s', async (reason, over) => {
    const r = rig(over);
    expect(await r.listen.line(H, E)).toBe(reason);
    expect(r.renders).toHaveLength(0);
    expect(r.played).toHaveLength(0);
  });

  it('only for the listened huddle, and never a face beat or an unvoiceable line', async () => {
    const r = rig();
    expect(await r.listen.line({ ...H, id: 'hd:2' }, E)).toBe('not_listening');
    expect(await r.listen.line(H, { ...E, listening: false })).toBe('not_listening');
    expect(await r.listen.line(H, { ...E, line: { ...E.line, kind: 'face', text: '' } })).toBe('not_voiceable');
    const noVoice = rig({ pickOf: () => ({ ...PICK, lines: [{ ...PICK.lines[0]!, voiceable: false }] }) as unknown as HuddlePick });
    expect(await noVoice.listen.line(H, E)).toBe('not_voiceable');
    r.listen.setListening(null);
    expect(await r.listen.line(H, E)).toBe('not_listening');
    expect(r.played).toHaveLength(0);
  });

  it('a render later than 1.2 s plays nothing (the bubble showed either way)', async () => {
    let r!: ReturnType<typeof rig>;
    r = rig({
      render: async () => {
        r.advance(LISTEN_RENDER_TIMEOUT_MS + 50);
        return { clipKey: 'ck1', url: '', alignmentUrl: '', durationMs: 2500, scope: 'shared', cached: false };
      },
    });
    expect(await r.listen.line(H, E)).toBe('late');
    expect(r.played).toHaveLength(0);
    expect(r.spent).toHaveLength(0);
  });

  it('checks the voice again when the clip is ready (another tab took it meanwhile)', async () => {
    let may = true;
    const r = rig({
      mayVoice: () => may,
      render: async () => {
        may = false;
        return { clipKey: 'ck1', url: '', alignmentUrl: '', durationMs: 2500, scope: 'shared', cached: false };
      },
    });
    expect(await r.listen.line(H, E)).toBe('no_voice');
    expect(r.played).toHaveLength(0);
  });
});
