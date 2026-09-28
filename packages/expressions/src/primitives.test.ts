import { createHash, webcrypto } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { clipKey, fillKeyOf, toDelivery, voiceKeyOf } from './delivery';
import { base32, sha256, sha256Async, seededRng, utf8 } from './hash';
import { instructionsFromTags, openaiInputFromXai, readable, speakable } from './markup';
import { renderUtterance, selectLine } from './select';
import { createRecencyMemory } from './recency';
import { fixtureIndex, makeState, PROFILES, T0 } from './testing';
import type { TtsDelivery, Utterance } from './types';

describe('seededRng', () => {
  it('is deterministic per seed and uniform-ish', () => {
    const a = seededRng('cw_chief|acknowledge|turn_1');
    const b = seededRng('cw_chief|acknowledge|turn_1');
    const xs = Array.from({ length: 1000 }, () => a.next());
    expect(xs).toEqual(Array.from({ length: 1000 }, () => b.next()));
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThan(1);
    const mean = xs.reduce((s, v) => s + v, 0) / xs.length;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);
    expect(seededRng('other').next()).not.toBe(xs[0]);
  });
  it('has stable golden values (xmur3 → mulberry32; replay across builds and hosts)', () => {
    const r = seededRng('golden');
    expect([r.next(), r.next(), r.next()]).toEqual([0.9212453747168183, 0.48674044315703213, 0.8353869873099029]);
  });
});

describe('sha256 and base32', () => {
  it('matches node crypto for ASCII and multi-byte text', () => {
    for (const s of ['', 'abc', 'Anytime, Dana.', 'Hang on — back in ten seconds.', 'emoji 😂 and ümlauts', 'x'.repeat(200)]) {
      const expected = createHash('sha256').update(s, 'utf8').digest();
      expect(Buffer.from(sha256(utf8(s)))).toEqual(expected);
      expect(Buffer.from(utf8(s))).toEqual(Buffer.from(s, 'utf8'));
    }
  });
  it('sha256Async (WebCrypto) and the pure version agree', async () => {
    expect(globalThis.crypto ?? webcrypto).toBeTruthy();
    const bytes = utf8('[1,"xai","grok-tts","leo","0.93","en","On it.",""]');
    expect(await sha256Async(bytes)).toEqual(sha256(bytes));
  });
  it('base32 is RFC 4648 lowercase without padding', () => {
    expect(base32(utf8('foobar'))).toBe('mzxw6ytboi');
    expect(base32(utf8('f'))).toBe('my');
  });
});

describe('speakable / readable (PG port)', () => {
  it('keeps known tags, drops unknown markup and balances wrappers', () => {
    expect(speakable('<soft>Hello [laugh] there')).toBe('<soft>Hello [laugh] there</soft>');
    expect(speakable('Hi [smirk] <b>you</b> [PAUSE] ok')).toBe('Hi you [pause] ok');
    expect(speakable('<soft><fast>one</soft> two')).toBe('<soft><fast>one</fast></soft> two');
    expect(speakable('a </loud> b')).toBe('a b');
  });
  it('readable strips every tag and fixes punctuation spacing', () => {
    expect(readable('<soft>[laugh]</soft> Oh, I like that.')).toBe('Oh, I like that.');
    expect(readable('Okay. [pause] We can work with that.')).toBe('Okay. We can work with that.');
    expect(readable('[laugh]')).toBe('');
  });
  it('maps xAI pauses to ellipses for OpenAI and derives instructions from tags', () => {
    expect(openaiInputFromXai('Hmm. [pause] Let me look at that properly.')).toBe('Hmm. … Let me look at that properly.');
    expect(openaiInputFromXai('[long-pause] Right. [laugh] Okay.')).toBe('Right. Okay.');
    expect(instructionsFromTags('<soft>[laugh]</soft> Fair.')).toBe('Begins with a light, genuine laugh. Softly.');
    expect(instructionsFromTags('Plain.')).toBeNull();
  });
});

describe('delivery mapping and clip keys', () => {
  const chief = fixtureIndex('chief');
  const pick = (intent: Parameters<typeof selectLine>[1]['intent'], seed: string, over = {}) => {
    const r = selectLine(chief, {
      intent, state: makeState('cw_chief', 'Samuel', over), mood: { valence: 0.2, energy: 0 }, ambience: 'lively', provider: 'xai',
      seed, now: T0, channel: 'voice',
    }, createRecencyMemory());
    if (!r.ok) throw new Error(r.reason);
    return r.utterance;
  };

  it('xAI keeps tags; OpenAI gets instructions; browser gets the caption; nonverbal lines are face-only in the browser', () => {
    const laugh = renderUtterance(chief, 'lead-warm-mentor.laugh.00', {});
    expect(laugh.ok).toBe(true);
    const u = (laugh as { ok: true; utterance: Utterance }).utterance;
    expect(u.nonverbal).toBe(true);
    expect(u.caption).toBe('(chuckles)');
    const xai = toDelivery(u, PROFILES.chief.voice, 'xai')!;
    expect(xai).toMatchObject({ provider: 'xai', model: 'grok-tts', voiceId: 'leo', speed: 0.93, input: '<soft>[laugh]</soft>', instructions: null });
    const oa = toDelivery(u, PROFILES.chief.voice, 'openai')!;
    expect(oa.input).toBe('Heh heh.');
    expect(oa.instructions).toContain('Speak warmly and patiently');
    expect(oa.instructions).toContain('pleased with itself');
    expect(toDelivery(u, PROFILES.chief.voice, 'browser')).toBeNull();
    expect(toDelivery(u, PROFILES.chief.voice, 'mock')!.input).toBe('(chuckles)');
  });

  it('OpenAI input turns [pause] into an ellipsis and instructions carry the archetype and intent hints', () => {
    const r = renderUtterance(chief, 'warm.thinking_filler.04', {});
    const u = (r as { ok: true; utterance: Utterance }).utterance;
    expect(u.speak.xai).toBe('Hmm. [pause] Let me look at that properly.');
    const d = toDelivery(u, PROFILES.chief.voice, 'openai')!;
    expect(d.input).toBe('Hmm. … Let me look at that properly.');
    expect(d.instructions).toMatch(/^Speak warmly.*Warm, friendly and unhurried.*Thinking aloud/);
  });

  it('returns null when the voice has no id for the provider', () => {
    const u = pick('acknowledge', 's1');
    expect(toDelivery(u, { openai: 'verse' }, 'xai')).toBeNull();
    expect(toDelivery(u, { xai: 'leo', speed: 2 }, 'xai')!.speed).toBe(1.15);
  });

  it('clip keys are content-addressed, stable and sensitive to every delivery input', async () => {
    const d: TtsDelivery = { provider: 'xai', model: 'grok-tts', voiceId: 'leo', speed: 0.93, lang: 'en', input: 'On it.', instructions: null };
    const k = await clipKey(d);
    expect(k).toMatch(/^c1_[a-z2-7]{32}$/);
    expect(await clipKey({ ...d })).toBe(k);
    const expected = `c1_${base32(createHash('sha256').update(JSON.stringify([1, 'xai', 'grok-tts', 'leo', '0.93', 'en', 'On it.', ''])).digest()).slice(0, 32)}`;
    expect(k).toBe(expected);
    for (const change of [{ voiceId: 'eve' }, { speed: 0.95 }, { input: 'On it!' }, { instructions: 'Softly.' }, { lang: 'de' }, { model: 'grok-tts-2' }]) {
      expect(await clipKey({ ...d, ...change })).not.toBe(k);
    }
  });

  it('fill keys ignore order and are empty without fills', () => {
    expect(fillKeyOf({})).toBe('');
    expect(fillKeyOf({ owner_name: 'Dana', part_of_day: 'morning' })).toBe(fillKeyOf({ part_of_day: 'morning', owner_name: 'Dana' }));
    expect(fillKeyOf({ owner_name: 'Dana' })).toMatch(/^f_[a-z2-7]+$/);
    expect(fillKeyOf({ owner_name: 'Dana' })).not.toBe(fillKeyOf({ owner_name: 'Luis' }));
    expect(voiceKeyOf(PROFILES.chief.voice, 'xai')).toMatch(/^xai:leo:0\.93:/);
  });
});
