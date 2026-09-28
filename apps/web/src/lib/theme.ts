// Light / dark / system. Follows the OS by default; a choice is a per-browser convenience (localStorage).
import { signal } from '@preact/signals';

export type ThemeChoice = 'system' | 'light' | 'dark';
const KEY = 'headcount.theme';

function read(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export const theme = signal<ThemeChoice>(typeof localStorage !== 'undefined' ? read() : 'system');

function apply(choice: ThemeChoice) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (choice === 'system') delete root.dataset.theme;
  else root.dataset.theme = choice;
}

export function setTheme(choice: ThemeChoice): void {
  theme.value = choice;
  apply(choice);
  try {
    if (choice === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    /* storage blocked: the choice lasts for this page */
  }
}

/** Apply the stored choice before first paint. */
export function initTheme(): void {
  apply(theme.value);
}
