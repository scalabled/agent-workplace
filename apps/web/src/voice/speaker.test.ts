import type { SpeechChunk } from '@headcount/audio';
import { describe, expect, it, vi } from 'vitest';
import { createFakeAudio } from '../test/fake-audio';
import { AgentSpeaker, BROWSER_MAX_TOKENS, type SpeakerDeps } from './speaker';

const voiceRef = { openai: 'echo', xai: 'leo', speed: 1 };

function setup(opts: { tts?: boolean; browser?: boolean; fail?: (text: string) => boolean } = {}) {
  const engine = createFakeAudio({ speechSynthesis: opts.browser ?? true });
  const synth = vi.fn(async (text: string): Promise<SpeechChunk> => {
    if (opts.fail?.(text)) throw new Error('tts down');
    return { audio: new TextEncoder().encode(text).buffer as ArrayBuffer, mime: 'audio/mpeg', text };
  });
  const deps: SpeakerDeps = { engine: () => engine, synthesize: (text) => synth(text), ttsAvailable: () => opts.tts ?? true };
  const speaker = new AgentSpeaker('cw_chief', deps, () => ({ voiceRef }));
  return { engine, synth, speaker };
}

const texts = (chunks: SpeechChunk[]) => chunks.map((c) => c.text);

describe('AgentSpeaker', () => {
  it('speaks a streamed reply sentence by sentence, in order, as one utterance', async () => {
    const { engine, synth, speaker } = setup();
    for (const d of ['Morning. I looked at ', 'the week. **Three** things ', 'matter, one can wait.']) speaker.delta('msg_1', d);
    speaker.complete('msg_1', 'Morning. I looked at the week. **Three** things matter, one can wait. Want the short version?');
    await engine.drain();
    expect(engine.spoken).toHaveLength(1);
    const chunks = engine.spoken[0]!.chunks as SpeechChunk[];
    expect(texts(chunks).join(' ')).toBe('Morning. I looked at the week. Three things matter, one can wait. Want the short version?');
    expect(chunks.every((c) => c.audio)).toBe(true);
    expect(synth).toHaveBeenCalled();
    // Markdown never reaches the voice.
    expect(synth.mock.calls.map((c) => c[0]).join(' ')).not.toContain('*');
  });

  it('speaks a complete message that never streamed (announcements, status)', async () => {
    const { engine, speaker } = setup();
    speaker.complete('msg_2', 'Suppliers are done. The write-up is in Projects.');
    await engine.drain();
    expect(texts(engine.spoken[0]!.chunks as SpeechChunk[]).join(' ')).toContain('Suppliers are done.');
  });

  it('keeps browser-voice sentences short (Chrome cuts long lines)', async () => {
    const { engine, speaker } = setup({ tts: false });
    const long = `${Array.from({ length: 90 }, (_, i) => `word${i}`).join(' ')} and that is all.`;
    speaker.say(long);
    await engine.drain();
    const chunks = engine.spoken[0]!.chunks as SpeechChunk[];
    expect(chunks.length).toBeGreaterThan(1);
    expect(Math.max(...chunks.map((c) => (c.text ?? '').split(/\s+/).length))).toBeLessThanOrEqual(BROWSER_MAX_TOKENS);
  });

  it('falls back to the browser voice without a TTS provider', async () => {
    const { engine, synth, speaker } = setup({ tts: false });
    speaker.say('Hello there. Nice to meet you.');
    await engine.drain();
    expect(synth).not.toHaveBeenCalled();
    const chunks = engine.spoken[0]!.chunks as SpeechChunk[];
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((c) => !c.audio && c.text)).toBe(true);
  });

  it('a failed sentence falls back to text for that sentence only', async () => {
    const { engine, speaker } = setup({ fail: (t) => t.startsWith('Second') });
    speaker.say('First sentence is fine here. Second one fails to synthesise. Third is fine again.');
    await engine.drain();
    const chunks = engine.spoken[0]!.chunks as SpeechChunk[];
    expect(chunks.map((c) => Boolean(c.audio))).toEqual([true, false, true]);
  });

  it('barge-in stops the speaker and silences the rest of that message', async () => {
    const { engine, speaker } = setup();
    speaker.delta('msg_3', 'This is a long first sentence that keeps going. ');
    expect(speaker.active).toBe(true);
    speaker.stop();
    expect(engine.stops).toContain('cw_chief');
    speaker.delta('msg_3', 'More words after the interruption.');
    speaker.complete('msg_3', 'This is a long first sentence that keeps going. More words after the interruption.');
    await engine.drain();
    expect(engine.spoken).toHaveLength(1); // no new utterance for the silenced message
    expect(engine.spoken[0]!.stopped).toBe(true);
    // A new message after the barge-in speaks normally.
    speaker.complete('msg_4', 'Understood.');
    await engine.drain();
    expect(engine.spoken).toHaveLength(2);
  });

  it('endHere ends a streaming message where it is: whole sentences play, the half one and later text never do', async () => {
    const { engine, speaker } = setup({ tts: false });
    speaker.delta('msg_5', 'The first part is done. And the sec');
    expect(speaker.pendingChars()).toBeGreaterThan(0);
    speaker.endHere('msg_5');
    // What is left to hear is the whole sentence at most, never the dropped half one.
    expect(speaker.pendingChars()).toBeLessThanOrEqual('The first part is done.'.length);
    speaker.delta('msg_5', 'ond part is too.');
    speaker.complete('msg_5', 'The first part is done. And the second part is too.');
    await engine.drain();
    expect(engine.spoken).toHaveLength(1);
    expect(texts(engine.spoken[0]!.chunks as SpeechChunk[])).toEqual(['The first part is done.']);
    expect(speaker.pendingChars()).toBe(0);
    expect(speaker.active).toBe(false);
    // Nothing streaming under that id: nothing happens, nothing is spoken.
    speaker.endHere('msg_6');
    await engine.drain();
    expect(engine.spoken).toHaveLength(1);
  });

  it('endStreaming ends every message still streaming, and leaves finished ones and later messages alone', async () => {
    const { engine, speaker } = setup({ tts: false });
    speaker.say('Morning.');
    speaker.delta('msg_7', 'One is ready. The oth');
    speaker.endStreaming();
    speaker.delta('msg_7', 'er is not.');
    speaker.delta('msg_8', 'Next answer.');
    speaker.complete('msg_8');
    await engine.drain();
    expect(engine.spoken.map((r) => (r.text !== null ? r.text : texts(r.chunks as SpeechChunk[]).join(' ')))).toEqual(['Morning.', 'One is ready.', 'Next answer.']);
    expect(speaker.active).toBe(false);
  });

  it('stays silent when nothing can speak', () => {
    const { engine, speaker } = setup({ tts: false, browser: false });
    expect(speaker.say('Hello.')).toBeNull();
    expect(engine.spoken).toHaveLength(0);
  });
});
