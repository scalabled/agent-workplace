import { describe, expect, it } from 'vitest';
import { pickVoice } from './browser-voice';
import { speakable, SpeakableFilter } from './speakable';

describe('speakable', () => {
  it('strips Markdown syntax but keeps the words', () => {
    expect(speakable('## Plan\n**Bold** and _italic_ and `code`.')).toBe('Plan Bold and italic and code.');
    expect(speakable('Read [the brief](https://x.test/a) or https://y.test/b now.')).toBe('Read the brief or now.');
    expect(speakable('1. First\n2. Second')).toBe('First Second');
    expect(speakable('| a | b |\n|---|---|\n| 1 | 2 |')).toBe('a, b. 1, 2.');
    expect(speakable('snake_case_name stays')).toBe('snakecasename stays');
  });

  it('drops fenced code across chunks', () => {
    const f = new SpeakableFilter();
    expect(f.push('Here it is:')).toBe('Here it is:');
    expect(f.push('```ts')).toBe('');
    expect(f.push('const secret = 1;')).toBe('');
    expect(f.push('```')).toBe('');
    expect(f.push('That is all.')).toBe('That is all.');
  });
});

describe('pickVoice', () => {
  const v = (name: string, lang = 'en-US', localService = true) => ({ name, lang, localService, default: false, voiceURI: name }) as SpeechSynthesisVoice;
  const voices = [v('Samantha'), v('Daniel', 'en-GB'), v('Alex'), v('Zarvox'), v('Karen', 'en-AU'), v('Thomas', 'fr-FR'), v('Moira', 'en-IE'), v('Fred')];

  it('honours a name hint first', () => {
    expect(pickVoice(voices, { name: 'daniel' })?.name).toBe('Daniel');
  });

  it('prefers the language and presentation, never novelty voices', () => {
    for (const seed of ['a', 'b', 'c', 'd', 'e']) {
      const chosen = pickVoice(voices, { lang: 'en-US', presentation: 'masculine' }, seed)!;
      expect(chosen.name).toBe('Alex');
    }
    const fem = pickVoice(voices, { lang: 'en-GB', presentation: 'feminine' }, 'x')!;
    expect(fem.lang).toBe('en-GB'); // exact language wins over presentation
    expect(pickVoice(voices, { lang: 'fr-FR' })?.name).toBe('Thomas');
  });

  it('is deterministic per speaker', () => {
    const a = pickVoice(voices, { lang: 'en' }, 'cw_ada');
    expect(pickVoice(voices, { lang: 'en' }, 'cw_ada')).toBe(a);
    expect(pickVoice([], {}, 'x')).toBeNull();
  });
});
