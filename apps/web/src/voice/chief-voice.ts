// The Chief of Staff's spoken replies: live talk frames → AgentSpeaker, when voice is on.
import { speechChunkFromResponse } from '@headcount/audio';
import { CHIEF_ID } from '@headcount/protocol';
import { api, ApiError } from '../api/client';
import { chiefVoiceHint, chiefVoiceRef } from '../chief';
import { can, capabilities, onFrame, settings } from '../store';
import { audio } from './engine';
import { AgentSpeaker, type SpeakerDeps } from './speaker';

export const speakerDeps: SpeakerDeps = {
  engine: audio,
  async synthesize(text, voiceRef, speakerId, signal) {
    try {
      // JSON carries the provider's character alignment when it has one: sharper lip sync.
      const res = await api.tts({ text, voiceRef, speakerId, response: 'json' }, signal);
      return await speechChunkFromResponse(res, text);
    } catch (err) {
      // The provider went away: refresh capabilities so voice controls that cannot work disappear (X8).
      if (err instanceof ApiError && err.code === 'not_configured')
        void api
          .capabilities()
          .then((c) => (capabilities.value = c))
          .catch(() => undefined);
      throw err;
    }
  },
  ttsAvailable: () => can('tts'),
};

export const chiefSpeaker = new AgentSpeaker(CHIEF_ID, speakerDeps, () => ({ voiceRef: chiefVoiceRef.value, hint: chiefVoiceHint.value }));

/** Speak live Chief of Staff messages while voice is on. Returns the unsubscribe. */
export function startChiefVoice(): () => void {
  return onFrame((frame, { live }) => {
    if (!live || !settings.value?.voiceOn) return;
    switch (frame.type) {
      case 'talk.delta':
        if (frame.data.agentId === CHIEF_ID) chiefSpeaker.delta(frame.data.messageId, frame.data.delta);
        break;
      case 'talk.message':
        if (frame.data.agentId === CHIEF_ID) chiefSpeaker.complete(frame.data.messageId, frame.data.text);
        break;
      case 'talk.done':
        if (frame.data.messageId) chiefSpeaker.complete(frame.data.messageId);
        break;
      default:
        break;
    }
  });
}

/** Barge-in: the owner speaks or sends; the Chief of Staff stops at once. */
export function bargeIn(): void {
  chiefSpeaker.stop();
}

/** Is the Chief of Staff speaking (or about to)? */
export function chiefIsSpeaking(): boolean {
  return chiefSpeaker.active;
}
