// Speech to text on this device (voice/local-stt.ts): which Whisper model and language a browser's language picks.
import { describe, expect, it } from 'vitest';
import { whisperLanguage, whisperModel } from './local-stt';

describe('on-device speech to text', () => {
  it('uses the English-only model for English and the multilingual one otherwise', () => {
    expect(whisperModel('en-US')).toBe('Xenova/whisper-tiny.en');
    expect(whisperModel(undefined)).toBe('Xenova/whisper-tiny.en');
    expect(whisperModel('fr-CA')).toBe('Xenova/whisper-tiny');
    expect(whisperLanguage('fr-CA')).toBe('fr');
    expect(whisperLanguage('en-GB')).toBeUndefined();
    expect(whisperLanguage('')).toBeUndefined();
  });
});
