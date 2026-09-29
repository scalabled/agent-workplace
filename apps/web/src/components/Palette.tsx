// ⌘K: go to a place or a coworker, or flip a setting. It navigates and toggles; it never approves.
// Screens add their own items while they are on screen (registerPaletteItems: the office's camera and life switches),
// and an item can ask for one line first (askInPalette: "Set your name").
import { signal } from '@preact/signals';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { OWNER_NAME_MAX_CHARS } from '@headcount/protocol';
import { AMBIENCES, ambienceOf } from '@headcount/protocol/ext/expressions';
import { catalog, loadCatalog } from '../catalog';
import { chiefName } from '../chief';
import { setTheme, theme } from '../lib/theme';
import { navigate, paths } from '../router';
import { auth, isOwner, signOut } from '../auth/session';
import { onboarded, settings } from '../store';
import { setAmbience, setOwnerName, setVoiceOn } from '../talk/actions';
import { AMBIENCE_LABEL, AMBIENCE_LINE } from './AmbienceControl';
import { Icon, type IconName } from './Icon';

export const paletteOpen = signal(false);
let returnFocus: HTMLElement | null = null;

export function openPalette(): void {
  if (paletteOpen.value) return;
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  paletteOpen.value = true;
  void loadCatalog();
}

export function closePalette(): void {
  paletteOpen.value = false;
  prompt.value = null;
  returnFocus?.focus?.();
  returnFocus = null;
}

export interface PaletteItem {
  id: string;
  label: string;
  hint?: string;
  /** 'Office': items the office registers while it is on screen. */
  group: 'Places' | 'Coworkers' | 'Settings' | 'Office';
  icon: IconName;
  keywords?: string;
  run(): void;
}

/** One line the palette asks for in place of its list (Enter submits, Esc cancels). */
export interface PalettePrompt {
  label: string;
  placeholder?: string;
  /** The field's starting text. */
  value: string;
  maxLength?: number;
  autoComplete?: string;
  /** One quiet line under the field. */
  help?: string;
  /** Resolves to an error sentence to show (the palette stays open), or nothing when done. */
  submit(value: string): Promise<string | null | void> | string | null | void;
}

const prompt = signal<PalettePrompt | null>(null);

/** Open the palette on one text field (from a palette item's run, or anywhere else). */
export function askInPalette(p: PalettePrompt): void {
  if (!paletteOpen.value) openPalette();
  prompt.value = p;
}

const providers = signal<readonly (() => PaletteItem[])[]>([]);

/**
 * Add items to ⌘K while a screen is on screen (the office's camera and life switches). `provide` is called each time
 * the palette renders, so its items follow the screen's state (it may read signals). Returns the unregister.
 */
export function registerPaletteItems(provide: () => PaletteItem[]): () => void {
  providers.value = [...providers.peek(), provide];
  return () => {
    providers.value = providers.peek().filter((p) => p !== provide);
  };
}

/** The registered items, now. A provider that throws adds nothing. */
export function registeredPaletteItems(): PaletteItem[] {
  const out: PaletteItem[] = [];
  for (const provide of providers.value) {
    try {
      out.push(...provide());
    } catch (err) {
      console.error('palette items failed', err);
    }
  }
  return out;
}

/** "Set your name": what the office calls the owner in greetings (OFFICE-PHASE2 §4.6). */
export function ownerNamePrompt(current: string | null): PalettePrompt {
  return {
    label: 'Your first name',
    placeholder: 'Your first name',
    value: current ?? '',
    maxLength: OWNER_NAME_MAX_CHARS,
    autoComplete: 'given-name',
    help: current ? 'Used in greetings. Enter saves, Esc cancels, blank clears it.' : 'Used in greetings. Enter saves, Esc cancels.',
    submit: (v) => setOwnerName(v.trim() ? v.trim() : null),
  };
}

/**
 * Rank by: label starts with the query, a word starts with it, then anywhere (label, hint, keywords). With no query
 * the palette is the menu: every place and setting (the list scrolls), coworkers only when searched for.
 */
export function filterItems(items: PaletteItem[], query: string, limit = 9): PaletteItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items.filter((i) => i.group !== 'Coworkers');
  const scored: [number, PaletteItem][] = [];
  for (const item of items) {
    const label = item.label.toLowerCase();
    const rest = `${item.hint ?? ''} ${item.keywords ?? ''}`.toLowerCase();
    let score = -1;
    if (label.startsWith(q)) score = 0;
    else if (label.split(/\s+/).some((w) => w.startsWith(q))) score = 1;
    else if (label.includes(q)) score = 2;
    else if (rest.includes(q)) score = 3;
    if (score >= 0) scored.push([score, item]);
  }
  return scored
    .sort((a, b) => a[0] - b[0] || a[1].label.localeCompare(b[1].label))
    .slice(0, limit)
    .map(([, i]) => i);
}

function useItems(): PaletteItem[] {
  const c = catalog.value;
  const s = settings.value;
  const name = chiefName.value;
  const t = theme.value;
  return useMemo(() => {
    const go = (href: string) => () => navigate(href);
    const items: PaletteItem[] = [
      { id: 'place:talk', label: 'Talk', hint: `with ${name}`, group: 'Places', icon: 'talk', run: go(paths.talk) },
      { id: 'place:floor', label: 'Floor', hint: 'Directory of coworkers', group: 'Places', icon: 'floor', keywords: 'directory staff people', run: go(paths.floor) },
      { id: 'place:projects', label: 'Projects', hint: 'Everyday and more', group: 'Places', icon: 'projects', keywords: 'jobs everyday', run: go(paths.projects) },
      { id: 'place:inbox', label: 'Inbox', hint: 'Raised hands', group: 'Places', icon: 'inbox', keywords: 'decisions', run: go(paths.inbox) },
      { id: 'place:skills', label: 'Skills', hint: 'The methods coworkers use', group: 'Places', icon: 'book', keywords: 'methods playbooks library edit', run: go(paths.skills) },
      { id: 'place:canvas', label: 'Canvas', hint: 'Apps and documents made for you', group: 'Places', icon: 'sparkle', keywords: 'app document build make pdf html export calculator tool report', run: go(paths.canvas) },
      { id: 'place:handbook', label: 'Handbook', hint: 'Your description of the business', group: 'Places', icon: 'book', keywords: 'company business about us rules brand voice interview context md', run: go(paths.handbook) },
      { id: 'place:memory', label: 'Memory', hint: 'What the team remembers, and your files', group: 'Places', icon: 'memory', keywords: 'remember recall facts knowledge files documents upload pdf forget context', run: go(paths.memory) },
      { id: 'place:automations', label: 'Automations', hint: 'Work that starts by itself', group: 'Places', icon: 'retry', keywords: 'schedule recurring every watch page monitor trigger', run: go(paths.automations) },
      { id: 'place:connectors', label: 'Connectors', hint: 'Services coworkers can use', group: 'Places', icon: 'plus', keywords: 'mcp integrations github notion connect services tools', run: go(paths.connectors) },
      ...(isOwner.value
        ? [
            { id: 'place:admin', label: 'Admin', hint: 'Settings, people and costs', group: 'Places' as const, icon: 'edit' as const, keywords: 'settings configuration preferences options admin', run: go(paths.admin()) },
            { id: 'place:usage', label: 'Usage and costs', hint: 'Tokens, calls and limits', group: 'Places' as const, icon: 'expand' as const, keywords: 'tokens cost spend metrics usage billing limits performance', run: go(paths.admin('usage')) },
            { id: 'place:people', label: 'People and roles', hint: 'Who can sign in', group: 'Places' as const, icon: 'user' as const, keywords: 'invite members users team access roles contributor reader owner', run: go(paths.admin('people')) },
          ]
        : []),
      { id: 'place:chief', label: `How ${name} works`, hint: 'Their prompt and tools', group: 'Places', icon: 'code', keywords: 'prompt system instructions tools transparency chief', run: go(paths.chief) },
    ];
    if (s && onboarded.value) items.push({ id: 'set:voice', label: s.voiceOn ? 'Turn voice off' : 'Turn voice on', hint: 'Spoken replies', group: 'Settings', icon: s.voiceOn ? 'voiceOff' : 'voiceOn', keywords: 'speak mute sound audio', run: () => void setVoiceOn(!s.voiceOn) });
    if (s && onboarded.value) {
      const current = s.ownerName?.trim() || null;
      items.push({ id: 'set:owner-name', label: 'Set your name', hint: current ? `Now ${current}` : 'Used in greetings', group: 'Settings', icon: 'user', keywords: 'my name call me first name greeting owner', run: () => askInPalette(ownerNamePrompt(current)) });
    }
    items.push({ id: 'set:chief', label: 'Switch Chief of Staff', hint: 'Pick someone else', group: 'Settings', icon: 'user', keywords: 'lead change choose', run: go(paths.onboarding) });
    const who = auth.value;
    if (who.status === 'signed-in') items.push({ id: 'set:signout', label: 'Sign out', hint: who.email, group: 'Settings', icon: 'user', keywords: 'log out logout account google leave', run: () => void signOut() });
    if (t !== 'dark') items.push({ id: 'set:dark', label: 'Use dark theme', group: 'Settings', icon: 'moon', keywords: 'night theme appearance', run: () => setTheme('dark') });
    if (t !== 'light') items.push({ id: 'set:light', label: 'Use light theme', group: 'Settings', icon: 'sun', keywords: 'day theme appearance', run: () => setTheme('light') });
    if (t !== 'system') items.push({ id: 'set:system', label: 'Match system theme', group: 'Settings', icon: 'sun', keywords: 'auto theme appearance', run: () => setTheme('system') });
    if (s && onboarded.value) {
      // Ambience (LIVING-WORKFORCE §9.1): how much the office chatters. The current one is marked.
      const current = ambienceOf(s);
      for (const a of AMBIENCES)
        items.push({
          id: `set:ambience:${a}`,
          label: `Ambience: ${AMBIENCE_LABEL[a]}`,
          hint: a === current ? `Current · ${AMBIENCE_LINE[a]}` : AMBIENCE_LINE[a],
          group: 'Settings',
          icon: a === current ? 'check' : 'ambience',
          keywords: 'chatter quiet lively buzzing noise bubbles hello',
          run: () => void setAmbience(a),
        });
    }
    for (const p of c?.catalog.personas ?? []) {
      items.push({ id: `cw:${p.id}`, label: p.name, hint: p.title, group: 'Coworkers', icon: 'user', keywords: `${c?.department(p.department)?.name ?? ''} ${p.handle}`, run: go(paths.coworker(p.id)) });
    }
    return items;
  }, [c, s, name, t]);
}

export function Palette() {
  if (!paletteOpen.value) return null;
  return <PaletteDialog />;
}

function PaletteDialog() {
  const ask = prompt.value;
  if (ask) return <PromptDialog key={ask.label} ask={ask} />;
  return <ListDialog />;
}

function ListDialog() {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const base = useItems();
  // Registered items follow their screen's state: read on every render (cheap; a few items).
  const extra = registeredPaletteItems();
  const items = extra.length ? [...base.filter((i) => i.group === 'Places'), ...extra, ...base.filter((i) => i.group !== 'Places')] : base;
  const results = filterItems(items, query);

  useEffect(() => input.current?.focus(), []);
  useEffect(() => setActive(0), [query]);

  const run = (item: PaletteItem | undefined) => {
    if (!item) return;
    closePalette();
    item.run();
  };

  return (
    <div class="palette-scrim" onPointerDown={(e) => e.target === e.currentTarget && closePalette()}>
      <div class="palette" role="dialog" aria-modal="true" aria-label="Go to">
        <div class="palette-field">
          <Icon name="search" />
          <input
            ref={input}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={results[active] ? `pi-${results[active]!.id}` : undefined}
            aria-autocomplete="list"
            placeholder="Go to a place or a coworker…"
            value={query}
            onInput={(e) => setQuery(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(results.length - 1, a + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                run(results[active]);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                closePalette();
              } else if (e.key === 'Tab') {
                e.preventDefault();
              }
            }}
          />
          <kbd class="palette-esc">Esc</kbd>
        </div>
        <ul id="palette-list" role="listbox" class="palette-list" aria-label="Results">
          {results.map((item, i) => (
            <li
              key={item.id}
              id={`pi-${item.id}`}
              role="option"
              aria-selected={i === active}
              class="palette-item"
              onPointerMove={() => setActive(i)}
              onClick={() => run(item)}
            >
              <Icon name={item.icon} size={18} />
              <span class="palette-label">{item.label}</span>
              {item.hint && <span class="palette-hint">{item.hint}</span>}
              <span class="palette-group">{item.group === 'Coworkers' ? 'Coworker' : item.group === 'Places' ? 'Place' : item.group === 'Office' ? 'Office' : ''}</span>
            </li>
          ))}
          {!results.length && <li class="palette-empty">No place or coworker matches “{query}”.</li>}
        </ul>
      </div>
    </div>
  );
}

/** The palette asking for one line (Enter submits, Esc cancels; an error keeps it open with one sentence). */
function PromptDialog({ ask }: { ask: PalettePrompt }) {
  const [value, setValue] = useState(ask.value);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const err = await ask.submit(value);
      if (typeof err === 'string' && err) {
        setError(err);
        input.current?.focus();
        return;
      }
      closePalette();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div class="palette-scrim" onPointerDown={(e) => e.target === e.currentTarget && closePalette()}>
      <div class="palette" role="dialog" aria-modal="true" aria-label={ask.label}>
        <div class="palette-field">
          <Icon name="user" />
          <input
            ref={input}
            aria-label={ask.label}
            aria-describedby="palette-prompt-help"
            aria-invalid={error ? 'true' : undefined}
            placeholder={ask.placeholder ?? ask.label}
            value={value}
            maxLength={ask.maxLength}
            autoComplete={ask.autoComplete ?? 'off'}
            onInput={(e) => setValue(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.isComposing) {
                e.preventDefault();
                void submit();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                closePalette();
              } else if (e.key === 'Tab') {
                e.preventDefault();
              }
            }}
          />
          <kbd class="palette-esc">Esc</kbd>
        </div>
        {error ? (
          <p class="palette-empty" id="palette-prompt-help" role="alert">
            {error}
          </p>
        ) : (
          <p class="palette-empty" id="palette-prompt-help">
            {ask.help ?? 'Enter saves, Esc cancels.'}
          </p>
        )}
      </div>
    </div>
  );
}
