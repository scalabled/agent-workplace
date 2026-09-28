// One quiet line near the composer for transient voice/command feedback ("Didn't catch that…").
import { signal } from '@preact/signals';

export interface Notice {
  id: number;
  text: string;
  tone: 'info' | 'error';
}

export const notice = signal<Notice | null>(null);
let seq = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

export function showNotice(text: string, tone: Notice['tone'] = 'info', ms = 5000): void {
  const id = ++seq;
  notice.value = { id, text, tone };
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (notice.value?.id === id) notice.value = null;
  }, ms);
}

export function clearNotice(): void {
  clearTimeout(timer);
  notice.value = null;
}
