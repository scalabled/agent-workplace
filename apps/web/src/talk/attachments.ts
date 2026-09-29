// What the owner shows with their next message in Talk (Inc 4 vision): files and pictures, read as they are added
// (each is kept on the Memory page too), then sent with the message so the Chief of Staff looks at them.
import { signal } from '@preact/signals';
import { TALK_ATTACHMENTS_MAX, type TalkAttachment } from '@headcount/protocol';
import type { ContextCard } from '@headcount/protocol/ext/memory';
import { uploadFiles } from '../memory/upload';
import { showNotice } from '../ui/notice';

export interface DraftFile {
  key: string;
  name: string;
  image: boolean;
  /** A local picture to show while it is read. */
  preview?: string;
  /** Set once it has been read. */
  card?: ContextCard;
}

export const draftFiles = signal<DraftFile[]>([]);
let seq = 0;

function patch(key: string, change: Partial<DraftFile> | null): void {
  draftFiles.value = change ? draftFiles.value.map((f) => (f.key === key ? { ...f, ...change } : f)) : draftFiles.value.filter((f) => f.key !== key);
}

/** Add files to the next message (up to four), reading each one. */
export async function attachFiles(files: File[]): Promise<void> {
  const room = TALK_ATTACHMENTS_MAX - draftFiles.value.length;
  if (!files.length) return;
  if (room <= 0 || files.length > room) showNotice(`Up to ${TALK_ATTACHMENTS_MAX} files go with one message.`, 'error', 5000);
  const take = files.slice(0, Math.max(0, room)).map((file) => {
    const image = file.type.startsWith('image/');
    return { file, draft: { key: `f${++seq}`, name: file.name, image, ...(image && typeof URL.createObjectURL === 'function' ? { preview: URL.createObjectURL(file) } : {}) } as DraftFile };
  });
  draftFiles.value = [...draftFiles.value, ...take.map((t) => t.draft)];
  await Promise.all(
    take.map(async ({ file, draft }) => {
      const r = await uploadFiles([file]);
      if (!draftFiles.value.some((f) => f.key === draft.key)) return; // removed while it was read
      if (r.added[0]) patch(draft.key, { card: r.added[0] });
      else {
        forget(draft);
        patch(draft.key, null);
        showNotice(r.errors.join(' ') || `${file.name} could not be shared.`, 'error', 8000);
      }
    }),
  );
}

export function removeDraftFile(key: string): void {
  const f = draftFiles.value.find((x) => x.key === key);
  if (f) forget(f);
  patch(key, null);
}

/** The files ready to send, and clear the tray. Null while one is still being read. */
export function takeAttachments(): TalkAttachment[] | null {
  const files = draftFiles.value;
  if (files.some((f) => !f.card)) return null;
  for (const f of files) forget(f);
  draftFiles.value = [];
  return files.map((f) => ({ cardId: f.card!.cardId, name: f.card!.name, kind: f.card!.kind }));
}

function forget(f: DraftFile): void {
  if (f.preview) URL.revokeObjectURL(f.preview);
}
