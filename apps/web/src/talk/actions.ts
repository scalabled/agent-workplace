// Owner commands: send (optimistic, idempotent by opId), retry, steer and stop jobs, voice on/off, Ambience, and
// the Floor quick-chat with a coworker.
import { BRAND, CHIEF_ID, coworkerAgentId, ids, OWNER_NAME_MAX_CHARS, TALK_MAX_CHARS, type OpId, type TalkAttachment, type UpdateWorkspaceRequest } from '@headcount/protocol';
import type { Ambience } from '@headcount/protocol/ext/expressions';
import { api, ApiError } from '../api/client';
import { beginSend, livingOwnerTurn, livingSendDecision, livingSetAmbience } from '../living';
import { addPendingOwner, addPendingSide, markOwnerAccepted, markOwnerFailed, markOwnerRetrying, markSideAccepted, markSideFailed, settings, type ThreadItem } from '../store';
import { showNotice } from '../ui/notice';
import { bargeIn, stopChiefAtBoundary } from '../voice/chief-voice';
import { stopSideVoice } from '../voice/side-voice';

/** A Floor quick-chat message is short (the worker answers 413 over this). */
export const DESK_MAX_CHARS = 2000;

/** One plain sentence with its fix (X8). Never provider JSON. */
export function errorSentence(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.missingKeys.length && !/[A-Z_]{6,}/.test(err.message)) return `${err.message} Add ${err.missingKeys.join(' or ')} to apps/worker/.dev.vars.`;
    return err.message;
  }
  return `Could not reach ${BRAND.name}. Check that it is running, then try again.`;
}

async function deliver(opId: OpId, text: string, via: 'text' | 'voice', at = Date.now(), attachments: readonly TalkAttachment[] = []): Promise<boolean> {
  const settle = beginSend();
  try {
    const accepted = await api.talk(text, via, opId, attachments.map((a) => a.cardId));
    markOwnerAccepted(accepted);
    // The living layer's clock for this turn starts when the owner finished, not when the 202 came back.
    livingOwnerTurn({ agentId: CHIEF_ID, turnId: accepted.turnId, at, mode: via, text });
    return true;
  } catch (err) {
    markOwnerFailed(opId, errorSentence(err));
    return false;
  } finally {
    settle();
  }
}

/**
 * Send a message to the Chief of Staff. Shown at once; the reply streams in over the feed. `at`: when the owner
 * finished (the push-to-talk release for voice).
 *
 * Sending while they speak (LIVING-WORKFORCE §2.3): a stop or steer, or more than 8 s left, ends their reply at
 * the sentence boundary; otherwise it finishes and the new answer follows (with "hold that thought" when 2.5–8 s
 * are left). Without the living layer the voice stops at once, as before.
 */
export async function sendOwnerMessage(text: string, via: 'text' | 'voice' = 'text', opts: { at?: number; opId?: OpId; attachments?: TalkAttachment[] } = {}): Promise<boolean> {
  const t = text.trim();
  if (!t) return false;
  if (t.length > TALK_MAX_CHARS) {
    showNotice(`Keep messages under ${TALK_MAX_CHARS.toLocaleString()} characters.`, 'error');
    return false;
  }
  const at = opts.at ?? Date.now();
  const decision = livingSendDecision(CHIEF_ID, t);
  if (decision === null) bargeIn();
  else if (decision === 'boundary') stopChiefAtBoundary();
  const opId = opts.opId ?? ids.op();
  addPendingOwner(opId, t, via, opts.attachments);
  return deliver(opId, t, via, at, opts.attachments);
}

/** A Floor quick-chat message to a catalog coworker; their reply streams into the bubble (and their profile). */
export async function sendDeskMessage(personaId: string, text: string, opts: { opId?: OpId } = {}): Promise<boolean> {
  const t = text.trim();
  if (!t) return false;
  if (t.length > DESK_MAX_CHARS) {
    showNotice(`Keep quick messages under ${DESK_MAX_CHARS.toLocaleString()} characters.`, 'error');
    return false;
  }
  const agentId = coworkerAgentId(personaId);
  stopSideVoice(agentId); // a new message cuts their reply (the worker does the same with its text)
  const opId = opts.opId ?? ids.op();
  const at = Date.now();
  addPendingSide(agentId, opId, t);
  const settle = beginSend();
  try {
    const accepted = await api.deskSay(personaId, t, opId);
    markSideAccepted(agentId, accepted);
    livingOwnerTurn({ agentId, turnId: accepted.turnId, at, mode: 'text', text: t });
    return true;
  } catch (err) {
    markSideFailed(agentId, opId, errorSentence(err));
    return false;
  } finally {
    settle();
  }
}

/** Retry a failed message with the same opId (the server treats it as the same command). */
export function retryOwnerMessage(item: ThreadItem): Promise<boolean> {
  if (!item.opId) return Promise.resolve(false);
  markOwnerRetrying(item.opId);
  return deliver(item.opId, item.text, item.via ?? 'text', Date.now(), item.attachments);
}

export async function steerJob(jobId: string, text: string): Promise<string | null> {
  const t = text.trim();
  if (!t) return 'Say what to change first.';
  try {
    await api.steerJob(jobId, t);
    return null;
  } catch (err) {
    return errorSentence(err);
  }
}

export async function stopJob(jobId: string): Promise<string | null> {
  try {
    await api.cancelJob(jobId);
    return null;
  } catch (err) {
    return errorSentence(err);
  }
}

/** Optimistic settings change; reverted with a sentence when it fails. */
export async function updateSettings(patch: UpdateWorkspaceRequest): Promise<boolean> {
  const prev = settings.value;
  if (prev) settings.value = { ...prev, ...patch } as typeof prev;
  try {
    settings.value = await api.putWorkspace(patch);
    return true;
  } catch (err) {
    settings.value = prev;
    showNotice(errorSentence(err), 'error');
    return false;
  }
}

export function setVoiceOn(on: boolean): Promise<boolean> {
  if (!on) bargeIn();
  return updateSettings({ voiceOn: on });
}

/** Quiet · Lively · Buzzing: how much the office chatters (LIVING-WORKFORCE §9.1). */
export async function setAmbience(a: Ambience): Promise<boolean> {
  const ok = await updateSettings({ ambience: a });
  if (ok) livingSetAmbience(a);
  return ok;
}

/**
 * What the office calls the owner (greetings, sign-offs, prompts; never small talk). Blank or null clears it. Returns
 * null when saved, else one sentence with its fix (the change is rolled back).
 */
export async function setOwnerName(name: string | null): Promise<string | null> {
  const t = (name ?? '').replace(/\s+/g, ' ').trim();
  const problem = ownerNameProblem(t);
  if (problem) return problem;
  const prev = settings.value;
  if (prev) settings.value = { ...prev, ownerName: t || null };
  try {
    settings.value = await api.putWorkspace({ ownerName: t || null });
    return null;
  } catch (err) {
    settings.value = prev;
    return errorSentence(err);
  }
}

/** Why the worker would refuse this name (the same rule as PUT /api/workspace), or null when it is fine. */
export function ownerNameProblem(name: string): string | null {
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f<>{}[\]\\/@#]/.test(name)) return 'Use letters for your name.';
  if (name.replace(/\s+/g, ' ').trim().length > OWNER_NAME_MAX_CHARS) return `Keep your name to ${OWNER_NAME_MAX_CHARS} characters or fewer.`;
  return null;
}
