// The Talk composer draft survives navigation (switching places never loses what you typed).
import { signal } from '@preact/signals';

export const draft = signal('');
/** Bumped to ask the composer to take focus (starters, "Delegate something"). */
export const focusComposer = signal(0);

export function prefillComposer(text: string): void {
  draft.value = text;
  focusComposer.value++;
}

/** Set when a lead was just chosen: Talk greets once, aloud when voice is on. */
export const greetOnArrival = signal(false);
