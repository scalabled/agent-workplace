// Side chats in documents (ext/threads.ts) on the web: the threads of each document, a passage waiting to be asked
// about, and the calls. A selection anywhere in a document (in the app, or inside a canvas document's frame) becomes
// `asking`; the document's panel then offers to ask about it.
import { signal } from '@preact/signals';
import type { DocRef, DocThread } from '@headcount/protocol/ext/threads';
import { api, ApiError } from '../api/client';

/** Threads per document, newest activity first. */
export const docThreads = signal<Record<string, DocThread[]>>({});
/** A passage selected to ask about (the panel of that document shows the question box). */
export const asking = signal<{ doc: DocRef; anchor: string; quote: string } | null>(null);
/** The thread shown open in its document's panel. */
export const openThread = signal<string | null>(null);

export function putThread(t: DocThread): void {
  const list = docThreads.peek()[t.doc] ?? [];
  docThreads.value = { ...docThreads.peek(), [t.doc]: [t, ...list.filter((x) => x.threadId !== t.threadId)] };
}

export async function loadThreads(doc: DocRef): Promise<void> {
  try {
    const r = await api.listThreads(doc);
    docThreads.value = { ...docThreads.peek(), [doc]: r.threads };
  } catch {
    /* the panel shows none */
  }
}

export const errorOf = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);
