// Floor quick-chat replies in the coworker's own voice: their catalog voice through TTS when a provider is
// configured, else the browser voice. One speaker per coworker, created on their first reply. Phatic replies
// (talk.message kind 'reflex') are voiced by their reflex clip instead, never here.
import { personaVoiceRef } from '@headcount/catalog';
import { personaIdFromAgentId } from '@headcount/protocol';
import { catalog } from '../catalog';
import { browserVoiceHint } from '../chief';
import { onFrame, settings } from '../store';
import { speakerDeps } from './chief-voice';
import { AgentSpeaker, type VoiceSpec } from './speaker';

const speakers = new Map<string, AgentSpeaker>();
const created = new Set<(agentId: string, speaker: AgentSpeaker) => void>();

function voiceOf(personaId: string): VoiceSpec {
  const p = catalog.value?.persona(personaId);
  return p ? { voiceRef: personaVoiceRef(p), hint: browserVoiceHint(p.pronouns, p.voice.speed) } : { voiceRef: null };
}

/** The speaker for a catalog coworker (`cw_<personaId>`), or null for anyone else. */
export function sideSpeaker(agentId: string): AgentSpeaker | null {
  const have = speakers.get(agentId);
  if (have) return have;
  const personaId = personaIdFromAgentId(agentId);
  if (!personaId) return null;
  const s = new AgentSpeaker(agentId, speakerDeps, () => voiceOf(personaId));
  speakers.set(agentId, s);
  for (const cb of created) cb(agentId, s);
  return s;
}

/** Every coworker speaker made so far, and each one made from now on. */
export function eachSideSpeaker(cb: (agentId: string, speaker: AgentSpeaker) => void): () => void {
  for (const [id, s] of speakers) cb(id, s);
  created.add(cb);
  return () => created.delete(cb);
}

/** Stop a coworker's voice at once (Esc on their bubble, a new message to them). */
export function stopSideVoice(agentId: string): void {
  speakers.get(agentId)?.stop();
}

/** Speak live Floor quick-chat replies while voice is on. Returns the unsubscribe. */
export function startSideVoice(): () => void {
  return onFrame((frame, { live }) => {
    if (!live || !settings.value?.voiceOn) return;
    switch (frame.type) {
      case 'talk.delta':
        if (frame.data.surface === 'floor') sideSpeaker(frame.data.agentId)?.delta(frame.data.messageId, frame.data.delta);
        break;
      case 'talk.message':
        if (frame.data.surface === 'floor' && frame.data.kind !== 'reflex') sideSpeaker(frame.data.agentId)?.complete(frame.data.messageId, frame.data.text);
        break;
      case 'talk.done':
        if (frame.data.surface === 'floor' && frame.data.agentId && frame.data.messageId) sideSpeaker(frame.data.agentId)?.complete(frame.data.messageId);
        break;
      default:
        break;
    }
  });
}
