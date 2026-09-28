// ▶ Hear a coworker or lead in their own catalog voice. Shown only when a TTS provider is configured:
// a browser voice is not their voice, so without TTS the control is absent (X8).
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { VoiceRef } from '@headcount/protocol';
import { can, localPresence } from '../store';
import { speakerDeps } from '../voice/chief-voice';
import { armAudio } from '../voice/engine';
import { AgentSpeaker } from '../voice/speaker';
import { Icon } from './Icon';

let current: AgentSpeaker | null = null;

/** One speaker per sample source; its `mouth` drives the face beside the button. */
export function useSampleSpeaker(speakerId: string, voiceRef: VoiceRef): AgentSpeaker {
  const speaker = useMemo(() => new AgentSpeaker(speakerId, speakerDeps, () => ({ voiceRef })), [speakerId, voiceRef.openai, voiceRef.xai, voiceRef.speed]);
  useEffect(
    () => () => {
      speaker.stop();
      if (current === speaker) current = null;
    },
    [speaker],
  );
  return speaker;
}

export function VoiceSample({ speaker, text, name }: { speaker: AgentSpeaker; text: string; name: string }) {
  const [pending, setPending] = useState(false);
  if (!can('tts')) return null;
  const playing = pending || Boolean(localPresence.value[speaker.speakerId]?.speaking);
  return (
    <button
      type="button"
      class="voice-sample"
      data-playing={playing || undefined}
      aria-label={playing ? `Stop ${name}'s voice sample` : `Hear ${name}'s voice`}
      onClick={() => {
        if (playing) {
          speaker.stop();
          setPending(false);
          return;
        }
        armAudio();
        if (current && current !== speaker) current.stop();
        current = speaker;
        speaker.stop();
        const u = speaker.say(text);
        if (!u) return;
        setPending(true);
        void u.handle.done.then(() => setPending(false));
      }}
    >
      <Icon name={playing ? 'stop' : 'play'} size={16} />
      <span>{playing ? 'Stop' : `Hear ${name}`}</span>
    </button>
  );
}
