// Hot updates (dev): Vite re-evaluates the modules between an edited file and the nearest component boundary without
// disposing the old instances. Before the handover a second living runtime came up beside the first and every reflex
// was voiced twice; these tests re-evaluate the modules the way a hot update does.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioEngine } from '@headcount/audio';
import type { LivingRuntime } from '../living/types';
import { createFakeAudio } from '../test/fake-audio';

type HotGlobal = { __headcountHot?: Record<string, unknown>; __headcountHotTest?: boolean };
const g = globalThis as unknown as HotGlobal;

beforeEach(() => {
  g.__headcountHotTest = true;
  g.__headcountHot = {};
  vi.resetModules();
});
afterEach(() => {
  delete g.__headcountHotTest;
  delete g.__headcountHot;
  vi.resetModules();
});

describe('hot updates', () => {
  it('a re-evaluated living entry disposes the runtime the previous one booted', async () => {
    const dispose = vi.fn();
    const { hotKeep } = await import('./hot');
    hotKeep('living-runtime', { dispose } as unknown as LivingRuntime);
    vi.resetModules();
    await import('../living/index');
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('a boot the old module still had in flight stands down', async () => {
    const { hotGeneration } = await import('./hot');
    const first = hotGeneration('living');
    expect(first()).toBe(true);
    const second = hotGeneration('living'); // the module evaluated again
    expect(first()).toBe(false);
    expect(second()).toBe(true);
  });

  it('a re-evaluated engine module takes the running engine over (one AudioContext)', async () => {
    const one = await import('../voice/engine');
    const fake = createFakeAudio() as AudioEngine;
    one.setAudioEngine(fake);
    vi.resetModules();
    const two = await import('../voice/engine');
    expect(two.audio()).toBe(fake);
  });

  it('keeps the tab’s client id across a hot update (its live marker would otherwise read as a copied tab)', async () => {
    sessionStorage.clear();
    const id = (await import('./client-id')).clientId();
    vi.resetModules();
    expect((await import('./client-id')).clientId()).toBe(id);
  });
});
