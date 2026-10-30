// Faces in the office: FaceView with its own chrome, the mouth only above token size, stored
// landmarks only, registered for cues and mood, gone on destroy.
import { describe, expect, it, vi } from 'vitest';
import { REST_SAMPLE } from '@headcount/protocol';
import type { FaceSubject } from '../components/Face';
import { createFaceFactory, toProtocolState, type FaceViewLike } from './faces';

const subject: FaceSubject = { id: 'kate-rivera', name: 'Kate Rivera', accent: '#3366cc', appearance: {} as FaceSubject['appearance'] };

function rig() {
  const calls: string[] = [];
  const opts: unknown[] = [];
  const view: FaceViewLike = {
    mount: vi.fn(() => calls.push('mount')),
    setPortrait: vi.fn(async () => void calls.push('portrait')),
    setAppearanceFallback: vi.fn(() => calls.push('fallback')),
    setState: vi.fn((s: string, label?: string) => void calls.push(`state:${s}:${label ?? ''}`)),
    attachSampler: vi.fn((s: unknown) => void calls.push(s ? 'sampler' : 'no-sampler')),
    setTier: vi.fn((t: string) => void calls.push(`tier:${t}`)),
    cue: vi.fn((c: { gesture: string }) => void calls.push(`cue:${c.gesture}`)),
    setExpressionBias: vi.fn(),
    destroy: vi.fn(() => void calls.push('destroy')),
  };
  const unregister = vi.fn();
  const registered: string[] = [];
  const sampler = { sample: () => REST_SAMPLE } as unknown as ReturnType<Parameters<typeof createFaceFactory>[0]['sampler']>;
  const factory = createFaceFactory({
    subjectFor: (id) => (id === 'cw_kate-rivera' ? subject : null),
    accentFor: (hex) => hex,
    sampler: () => sampler,
    portraitFor: async () => ({ url: '/p.webp', landmarks: null, version: 'v1' }),
    saveLandmarks: vi.fn(),
    registerFace: (id) => {
      registered.push(id);
      return unregister;
    },
    createView: (o) => {
      opts.push(o);
      return view;
    },
  });
  return { factory, view, calls, opts, unregister, registered };
}

describe('the office faceFactory', () => {
  it('draws its own chrome, never detects landmarks, and registers for cues', async () => {
    const r = rig();
    const slot = r.factory('cw_kate-rivera', 'token');
    expect(slot.drawsChrome).toBe(true);
    expect(slot.el.className).toBe('office-face');
    expect(r.opts[0]).toMatchObject({ tier: 'token', detectLandmarks: false, name: 'Kate Rivera' });
    expect(r.registered).toEqual(['cw_kate-rivera']);
    await Promise.resolve();
    await Promise.resolve();
    expect(r.calls).toContain('portrait');
  });

  it('attaches the mouth only above token size', () => {
    const r = rig();
    const slot = r.factory('cw_kate-rivera', 'token');
    expect(r.calls.filter((c) => c.endsWith('sampler'))).toEqual(['no-sampler']);
    slot.setTier('tile');
    slot.setTier('hero');
    slot.setTier('token');
    expect(r.calls.filter((c) => c.endsWith('sampler'))).toEqual(['no-sampler', 'sampler', 'sampler', 'no-sampler']);
  });

  it('maps the office states and cues, and unregisters on destroy', () => {
    const r = rig();
    const slot = r.factory('cw_kate-rivera', 'tile');
    slot.setState!('away');
    slot.setState!('working', 'Drafting the launch note');
    slot.cue!('look_up');
    slot.destroy();
    expect(r.calls).toContain('state:idle:idle');
    expect(r.calls).toContain('state:working:Drafting the launch note');
    expect(r.calls).toContain('cue:look_up');
    expect(r.unregister).toHaveBeenCalledTimes(1);
    expect(r.calls.at(-1)).toBe('destroy');
    expect(toProtocolState('blocked')).toBe('idle');
    expect(toProtocolState('thinking')).toBe('thinking');
  });
});
