// Owner commands: send (optimistic, idempotent by opId), retry, steer and stop jobs, voice on/off.
import { ids, TALK_MAX_CHARS, type OpId, type UpdateWorkspaceRequest } from '@headcount/protocol';
import { api, ApiError } from '../api/client';
import { addPendingOwner, markOwnerAccepted, markOwnerFailed, markOwnerRetrying, settings, type ThreadItem } from '../store';
import { showNotice } from '../ui/notice';
import { bargeIn } from '../voice/chief-voice';

/** One plain sentence with its fix (X8). Never provider JSON. */
export function errorSentence(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.missingKeys.length && !/[A-Z_]{6,}/.test(err.message)) return `${err.message} Add ${err.missingKeys.join(' or ')} to apps/worker/.dev.vars.`;
    return err.message;
  }
  return 'Could not reach Headcount. Check that it is running, then try again.';
}

async function deliver(opId: OpId, text: string, via: 'text' | 'voice'): Promise<boolean> {
  try {
    markOwnerAccepted(await api.talk(text, via, opId));
    return true;
  } catch (err) {
    markOwnerFailed(opId, errorSentence(err));
    return false;
  }
}

/** Send a message to the Chief of Staff. Shown at once; the reply streams in over the feed. */
export async function sendOwnerMessage(text: string, via: 'text' | 'voice' = 'text'): Promise<boolean> {
  const t = text.trim();
  if (!t) return false;
  if (t.length > TALK_MAX_CHARS) {
    showNotice(`Keep messages under ${TALK_MAX_CHARS.toLocaleString()} characters.`, 'error');
    return false;
  }
  bargeIn();
  const opId = ids.op();
  addPendingOwner(opId, t, via);
  return deliver(opId, t, via);
}

/** Retry a failed message with the same opId (the server treats it as the same command). */
export function retryOwnerMessage(item: ThreadItem): Promise<boolean> {
  if (!item.opId) return Promise.resolve(false);
  markOwnerRetrying(item.opId);
  return deliver(item.opId, item.text, item.via ?? 'text');
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
