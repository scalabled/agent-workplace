// Floor quick-chat replies in the coworker's own voice: their catalog voice through TTS when a provider is
// configured, else the browser voice. One speaker per coworker, created on their first reply. Phatic replies
// (talk.message kind 'reflex') are voiced by their reflex clip instead, never here.
import { personaVoiceRef } from '@headcount/catalog';
import { personaIdFromAgentId, type Frame } from '@headcount/protocol';
import { catalog } from '../catalog';
import { browserVoiceHint } from '../chief';
import { feedEpoch, onFrame, settings } from '../store';
import { speakerDeps } from './chief-voice';
import { claimUnsettled, mayVoice } from './owner';
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

/** Stop every coworker's voice (this tab lost the voice to another tab). */
export function stopSideVoices(): void {
  for (const s of speakers.values()) s.stop();
}

/** Turns whose reply stream is remembered (a turn's end may name no message). */
const TURNS_KEPT = 50;

/** The quick-chat reply this frame ends, and whose (a turn's end without a message id: the reply of that turn). */
function sideReplyEnded(frame: Frame, replyOf: Map<string, { agentId: string; messageId: string }>): { agentId: string; messageId: string } | null {
  if (frame.type === 'talk.message') return frame.data.surface === 'floor' ? { agentId: frame.data.agentId, messageId: frame.data.messageId } : null;
  if (frame.type !== 'talk.done' || frame.data.surface !== 'floor' || !frame.data.agentId) return null;
  if (frame.data.messageId) return { agentId: frame.data.agentId, messageId: frame.data.messageId };
  const r = replyOf.get(frame.data.turnId);
  return r && r.agentId === frame.data.agentId ? r : null;
}

/** Speak live Floor quick-chat replies while voice is on, in the tab that has the voice. Returns the unsubscribe. */
export function startSideVoice(): () => void {
  /** The reply that streamed in each recent quick-chat turn. */
  const replyOf = new Map<string, { agentId: string; messageId: string }>();
  // The feed socket came back (a new `ready`): what streamed while it was down never arrives (deltas are not replayed),
  // so a reply still streaming here ends where it is; the rest of it shows as text only.
  let epoch = feedEpoch.peek();
  const stopEpoch = feedEpoch.subscribe((e) => {
    if (e === epoch) return;
    epoch = e;
    for (const s of speakers.values()) s.endStreaming();
  });
  const stopFrames = onFrame((frame, { live }) => {
    if (!live || !settings.value?.voiceOn) {
      // A reply's end that is not voiced (replayed after the socket came back, or voice went off meanwhile) still ends
      // what streamed here, so that coworker's next reply is not left waiting behind it. Nothing new is said.
      const ended = sideReplyEnded(frame, replyOf);
      if (ended) speakers.get(ended.agentId)?.endHere(ended.messageId);
      return;
    }
    // A reply that starts while this tab's claim is on its way is the other device's (voice/owner.ts).
    const here = mayVoice() && !claimUnsettled();
    switch (frame.type) {
      case 'talk.delta':
        if (frame.data.surface !== 'floor') break;
        if (!replyOf.has(frame.data.turnId)) {
          replyOf.set(frame.data.turnId, { agentId: frame.data.agentId, messageId: frame.data.messageId });
          if (replyOf.size > TURNS_KEPT) replyOf.delete(replyOf.keys().next().value!);
        }
        if (here) sideSpeaker(frame.data.agentId)?.delta(frame.data.messageId, frame.data.delta);
        else sideSpeaker(frame.data.agentId)?.silence(frame.data.messageId);
        break;
      case 'talk.message':
        if (frame.data.surface !== 'floor' || frame.data.kind === 'reflex') break;
        if (here) sideSpeaker(frame.data.agentId)?.complete(frame.data.messageId, frame.data.text);
        else sideSpeaker(frame.data.agentId)?.silence(frame.data.messageId);
        break;
      case 'talk.done':
        if (frame.data.surface !== 'floor' || !frame.data.agentId) break;
        if (frame.data.messageId) sideSpeaker(frame.data.agentId)?.complete(frame.data.messageId);
        else {
          // The turn ended without a message (a failed reply, nothing but whitespace said): it ends where it is.
          const ended = sideReplyEnded(frame, replyOf);
          if (ended) speakers.get(ended.agentId)?.endHere(ended.messageId);
        }
        break;
      default:
        break;
    }
  });
  return () => {
    stopFrames();
    stopEpoch();
  };
}
