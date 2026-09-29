// What the Chief of Staff said while the owner was elsewhere (D2: agents start conversations too). A finished
// job's announcement must be noticeable on every screen with voice off: the Talk tab and the bubble show a
// count until the owner opens Talk, and the bubble pulses once when news arrives.
import { effect, signal } from '@preact/signals';
import { CHIEF_ID } from '@headcount/protocol';
import { route } from '../router';
import { onFrame } from '../store';

/** Chief of Staff messages that arrived while the owner was not on Talk. */
export const unread = signal(0);
/** Bumped on each such message: the bubble pulses once per bump. */
export const news = signal(0);

export function startUnread(): () => void {
  const off = onFrame((f, { live }) => {
    // Floor quick-chats are answered in their bubble (and a reflex reply is to a message just sent): not news.
    if (!live || f.type !== 'talk.message' || f.data.agentId !== CHIEF_ID || f.data.surface === 'floor') return;
    if (route.value.name === 'talk') return;
    unread.value++;
    news.value++;
  });
  const stop = effect(() => {
    if (route.value.name === 'talk' && unread.peek() !== 0) unread.value = 0;
  });
  return () => {
    off();
    stop();
  };
}
