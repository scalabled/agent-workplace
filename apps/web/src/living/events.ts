// Real events the office may mention (OFFICE-PHASE2 §4.5.8): the seq of each `job.done` frame this page applied,
// replay included, so grounded small talk can cite the ledger event it is about. Started with the living layer at
// boot (before the feed replays), light (a map), and never a source of text: job titles and results stay private.
import type { Frame } from '@headcount/protocol';
import { onFrame } from '../store';

export interface DoneEvent {
  seq: number;
  /** When the frame was written (epoch ms). */
  at: number;
}

const MAX = 200;
/** jobId → the persisted job.done frame. */
export const jobDoneSeqs = new Map<string, DoneEvent>();

export function recordFrame(frame: Frame): void {
  if (frame.type !== 'job.done' || typeof frame.seq !== 'number') return;
  jobDoneSeqs.set(frame.data.jobId, { seq: frame.seq, at: Date.parse(frame.ts) || Date.now() });
  if (jobDoneSeqs.size > MAX) jobDoneSeqs.delete(jobDoneSeqs.keys().next().value!);
}

let stop: (() => void) | null = null;

/** Start recording (idempotent). */
export function trackEvents(): void {
  stop ??= onFrame((f) => recordFrame(f));
}

/** Tests. */
export function resetEvents(): void {
  stop?.();
  stop = null;
  jobDoneSeqs.clear();
}
