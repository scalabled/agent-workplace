// The Chief of Staff's spoken replies: live talk frames → AgentSpeaker, when voice is on.
import { speechChunkFromResponse } from '@headcount/audio';
import { CHIEF_ID, type Frame } from '@headcount/protocol';
import { api, ApiError } from '../api/client';
import { chiefVoiceHint, chiefVoiceRef } from '../chief';
import { livingBargeIn } from '../living';
import { can, capabilities, feedEpoch, isTalkSurface, onFrame, settings } from '../store';
import { audio } from './engine';
import { claimUnsettled, mayVoice, onUnvoiced } from './owner';
import { frontPlaying, stopVoiceFront } from './front';
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

/** An announcement kept silent here longer ago than this is old news: a fallback to this tab never voices it. */
export const UNVOICED_MAX_AGE_MS = 20_000;

/** Turns whose reply stream is remembered (a turn's end may name no message). */
const TURNS_KEPT = 50;

/** The Chief's reply this frame ends (a turn's end without a message id: the reply that streamed in that turn). */
function chiefReplyEnded(frame: Frame, replyOf: Map<string, string>): string | null {
  if (frame.type === 'talk.message') return frame.data.agentId === CHIEF_ID && isTalkSurface(frame.data.surface) && frame.data.kind !== 'note' ? frame.data.messageId : null;
  if (frame.type !== 'talk.done' || !isTalkSurface(frame.data.surface) || (frame.data.agentId && frame.data.agentId !== CHIEF_ID)) return null;
  return frame.data.messageId ?? replyOf.get(frame.data.turnId) ?? null;
}

/**
 * Speak live Chief of Staff messages while voice is on, in the one tab that has the voice (voice/owner.ts). Another
 * tab's messages are silenced here for good: a later claim starts with the next message. The exception: when the voice
 * falls to this tab because the tab that had it went away, the job announcements that reached no tab with the voice
 * meanwhile are voiced here, once. Returns the unsubscribe.
 */
export function startChiefVoice(): () => void {
  /** Announcements silenced here (another tab had the voice), with their feed seq, newest last. */
  let silenced: { messageId: string; text: string; seq: number; at: number }[] = [];
  /** The reply that streamed in each recent turn. */
  const replyOf = new Map<string, string>();
  const stopFrames = onFrame((frame, { live }) => {
    if (!live || !settings.value?.voiceOn) {
      // A reply's end that is not voiced still ends what streamed here: its end was replayed after the socket came back
      // (the reply finished while it was down, or the worker restarted mid-answer), or voice went off meanwhile. Left
      // open, the stream would hold every later line of the Chief's behind it. It ends where it is; nothing new is said.
      const ended = chiefReplyEnded(frame, replyOf);
      if (ended) chiefSpeaker.endHere(ended);
      return;
    }
    // A line that starts while this tab's claim is on its way belongs to the tab that had the voice (another device
    // still voicing it until the server's word arrives there).
    const here = mayVoice() && !claimUnsettled();
    switch (frame.type) {
      case 'talk.delta':
        // Talk only: a Floor quick-chat or an office room line is voiced by its own speaker (side-voice, room session).
        if (frame.data.agentId !== CHIEF_ID || !isTalkSurface(frame.data.surface)) break;
        if (!replyOf.has(frame.data.turnId)) {
          replyOf.set(frame.data.turnId, frame.data.messageId);
          if (replyOf.size > TURNS_KEPT) replyOf.delete(replyOf.keys().next().value!);
        }
        if (here) chiefSpeaker.delta(frame.data.messageId, frame.data.delta);
        else chiefSpeaker.silence(frame.data.messageId);
        break;
      case 'talk.message':
        // A reflex reply ("Anytime.") is voiced by its pre-voiced clip (reflex.say), never a second time here. A note
        // (a meeting happened) is a quiet line, never voiced.
        if (frame.data.agentId !== CHIEF_ID || frame.data.kind === 'reflex' || frame.data.kind === 'note' || !isTalkSurface(frame.data.surface)) break;
        if (here) chiefSpeaker.complete(frame.data.messageId, frame.data.text);
        else {
          chiefSpeaker.silence(frame.data.messageId);
          if (frame.data.kind === 'announcement' && typeof frame.seq === 'number') {
            const now = Date.now();
            silenced = [...silenced.filter((m) => now - m.at < UNVOICED_MAX_AGE_MS), { messageId: frame.data.messageId, text: frame.data.text, seq: frame.seq, at: now }].slice(-5);
          }
        }
        break;
      case 'talk.done': {
        if (!isTalkSurface(frame.data.surface)) break;
        if (frame.data.messageId) chiefSpeaker.complete(frame.data.messageId);
        else {
          // The turn ended without a message (nothing but whitespace was said): what streamed ends where it is.
          const ended = chiefReplyEnded(frame, replyOf);
          if (ended) chiefSpeaker.endHere(ended);
        }
        break;
      }
      default:
        break;
    }
  });
  // The feed socket came back (a new `ready`): what streamed while it was down never arrives (deltas are not replayed),
  // so a reply still streaming here ends where it is; the rest of it shows as text only.
  let epoch = feedEpoch.peek();
  const stopEpoch = feedEpoch.subscribe((e) => {
    if (e === epoch) return;
    epoch = e;
    chiefSpeaker.endStreaming();
  });
  const stopUnvoiced = onUnvoiced((afterSeq) => {
    const now = Date.now();
    const due = silenced.filter((m) => m.seq > afterSeq && now - m.at < UNVOICED_MAX_AGE_MS);
    silenced = silenced.filter((m) => !due.includes(m));
    if (!settings.value?.voiceOn || !mayVoice()) return;
    for (const m of due) chiefSpeaker.say(m.text, `unvoiced:${m.messageId}`);
  });
  return () => {
    stopFrames();
    stopEpoch();
    stopUnvoiced();
  };
}

/** Barge-in (Esc, a tap on the face, holding to talk): the Chief of Staff stops at once, reflexes too. */
export function bargeIn(): void {
  livingBargeIn(CHIEF_ID);
  stopVoiceFront();
  chiefSpeaker.stop();
}

/** The Chief of Staff ends the sentence now playing, then stops; the rest of the reply stays on screen (§2.3). */
export function stopChiefAtBoundary(): void {
  try {
    const e = audio();
    if (typeof e.stopAtBoundary === 'function') return e.stopAtBoundary(CHIEF_ID);
  } catch {
    /* no audio engine: nothing is sounding */
  }
  chiefSpeaker.stop();
}

/** Is the Chief of Staff speaking (or about to)? */
export function chiefIsSpeaking(): boolean {
  return chiefSpeaker.active || frontPlaying();
}
