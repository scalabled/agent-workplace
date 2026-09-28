import type { MouthSample, MouthSampler } from '@headcount/protocol';
import { describe, expect, it } from 'vitest';
import { FaceMotion } from './motion';
import { VISEMES } from './visemes';

const constant = (s: Partial<MouthSample>): MouthSampler => ({ sample: () => ({ openness: 0, width: 0, round: 0, energy: 0, ...s }) });
const openWide: MouthSample = { openness: 1, width: 0.3, round: 0, energy: 0.6, voiced: true, heard: true, done: false, params: { ...VISEMES.OPEN_WIDE }, shape: 'OPEN_WIDE' };

function step(m: FaceMotion, from: number, to: number, dt = 16) {
  let pose = m.update(from);
  for (let t = from + dt; t <= to; t += dt) pose = m.update(t);
  return pose;
}

describe('FaceMotion', () => {
  it('opens the mouth only while the sampler reports audible, unfinished speech', () => {
    const m = new FaceMotion({ seed: 7 });
    m.sampler = constant(openWide);
    const talking = step(m, 0, 300);
    expect(talking.talking).toBe(true);
    expect(talking.mouth.openY).toBeGreaterThan(VISEMES.OPEN_WIDE.openY * 0.9);
    m.sampler = constant({ ...openWide, heard: false }); // barge-in duck
    const ducked = step(m, 316, 800);
    expect(ducked.talking).toBe(false);
    expect(ducked.mouth.openY).toBe(0);
    m.sampler = constant({ ...openWide, done: true });
    expect(step(m, 816, 1300).mouth.openY).toBe(0);
    m.sampler = null;
    expect(step(m, 1316, 1500).talking).toBe(false);
  });

  it('smooths with PG time constants: ~40 ms attack, ~90 ms release, 20 ms bilabial snap', () => {
    const m = new FaceMotion({ seed: 1 });
    m.sampler = constant(openWide);
    m.update(0);
    const a = m.update(40).mouth.openY / VISEMES.OPEN_WIDE.openY; // ≈ 1 − e^(−40/40) after the first 16 ms step
    expect(a).toBeGreaterThan(0.55);
    expect(a).toBeLessThan(0.8);
    step(m, 56, 400);
    m.sampler = constant({ ...openWide, params: { ...VISEMES.CLOSED }, shape: 'CLOSED', openness: 0 });
    const snapped = m.update(420).mouth.openY; // 20 ms of snap
    expect(snapped).toBeLessThan(VISEMES.OPEN_WIDE.openY * 0.45);
  });

  it('maps plain envelope samplers (no params) into the same mouth space', () => {
    const m = new FaceMotion({ seed: 2 });
    m.sampler = constant({ openness: 0.6, width: 0.2, round: 0.1, energy: 0.5, voiced: true });
    const pose = step(m, 0, 300);
    expect(pose.mouth.openY).toBeGreaterThan(0.02);
    expect(pose.mouth.round).toBeGreaterThan(0.05);
  });

  it('thinking looks gently away and up; listening leans in; working looks down', () => {
    const m = new FaceMotion({ seed: 3 });
    m.state = 'thinking';
    const t = step(m, 0, 1200);
    expect(t.yaw).toBeGreaterThan(0.3);
    expect(t.pitch).toBeGreaterThan(0.3);
    expect(t.lookX).toBeGreaterThan(0.6);
    m.state = 'listening';
    const l = step(m, 1216, 2400);
    expect(l.lean).toBeGreaterThan(0.9);
    expect(Math.abs(l.yaw)).toBeLessThan(0.02);
    m.state = 'working';
    const w = step(m, 2416, 3600);
    expect(w.pitch).toBeLessThan(-0.4);
    m.state = 'raised_hand';
    expect(step(m, 3616, 4800).brow).toBeGreaterThan(0.4); // held brow with the hand glyph
  });

  it('blinks every few seconds, and more slowly while thinking', () => {
    const idle = new FaceMotion({ seed: 11 });
    let blinks = 0;
    let longest = 0;
    let run = 0;
    for (let t = 0; t < 30000; t += 16) {
      const b = idle.update(t).blink;
      if (b > 0) run += 16;
      else if (run) {
        blinks++;
        longest = Math.max(longest, run);
        run = 0;
      }
    }
    expect(blinks).toBeGreaterThanOrEqual(4);
    expect(blinks).toBeLessThanOrEqual(11);
    expect(longest).toBeLessThanOrEqual(272);
    const thinking = new FaceMotion({ seed: 11 });
    thinking.state = 'thinking';
    let tBlinks = 0;
    let tLongest = 0;
    run = 0;
    for (let t = 0; t < 30000; t += 16) {
      const b = thinking.update(t).blink;
      if (b > 0) run += 16;
      else if (run) {
        tBlinks++;
        tLongest = Math.max(tLongest, run);
        run = 0;
      }
    }
    expect(tBlinks).toBeLessThan(blinks);
    expect(tLongest).toBeGreaterThan(300);
  });

  it('reduced motion removes decoration but keeps lip sync', () => {
    const m = new FaceMotion({ seed: 5, reducedMotion: true });
    m.state = 'thinking';
    m.sampler = constant(openWide);
    for (let t = 0; t < 20000; t += 16) {
      const p = m.update(t);
      expect(p.blink).toBe(0);
      expect(p.swayX).toBe(0);
      expect(p.swayRot).toBe(0);
      expect(p.breath).toBe(0);
      expect(p.yaw).toBe(0);
      expect(p.brow).toBe(0);
    }
    expect(m.update(20016).mouth.openY).toBeGreaterThan(0.04);
  });

  it('raises the brows on a sharp energy onset, at most every 1.5 s', () => {
    const m = new FaceMotion({ seed: 9 });
    let e = 0;
    m.sampler = { sample: () => ({ ...openWide, energy: e }) };
    step(m, 0, 200);
    e = 0.8;
    expect(m.update(216).brow).toBeGreaterThan(0.9);
    e = 0;
    step(m, 232, 600);
    e = 0.8;
    expect(m.update(616).brow, 'second onset inside 1.5 s does not re-fire').toBeLessThan(0.5);
  });
});
