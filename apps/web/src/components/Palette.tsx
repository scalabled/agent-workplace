// ⌘K: go to a place or a coworker, or flip a setting. It navigates and toggles; it never approves.
import { signal } from '@preact/signals';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { AMBIENCES, ambienceOf } from '@headcount/protocol/ext/expressions';
import { catalog, loadCatalog } from '../catalog';
import { chiefName } from '../chief';
import { setTheme, theme } from '../lib/theme';
import { navigate, paths } from '../router';
import { onboarded, settings } from '../store';
import { setAmbience, setVoiceOn } from '../talk/actions';
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
  returnFocus?.focus?.();
  returnFocus = null;
}

export interface PaletteItem {
  id: string;
  label: string;
  hint?: string;
  group: 'Places' | 'Coworkers' | 'Settings';
  icon: IconName;
  keywords?: string;
  run(): void;
}

/** Rank by: label starts with the query, a word starts with it, then anywhere (label, hint, keywords). */
export function filterItems(items: PaletteItem[], query: string, limit = 9): PaletteItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items.filter((i) => i.group !== 'Coworkers').slice(0, limit);
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
    ];
    if (s && onboarded.value) items.push({ id: 'set:voice', label: s.voiceOn ? 'Turn voice off' : 'Turn voice on', hint: 'Spoken replies', group: 'Settings', icon: s.voiceOn ? 'voiceOff' : 'voiceOn', keywords: 'speak mute sound audio', run: () => void setVoiceOn(!s.voiceOn) });
    items.push({ id: 'set:chief', label: 'Switch Chief of Staff', hint: 'Pick someone else', group: 'Settings', icon: 'user', keywords: 'lead change choose', run: go(paths.onboarding) });
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
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const items = useItems();
  const results = useMemo(() => filterItems(items, query), [items, query]);

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
              <span class="palette-group">{item.group === 'Coworkers' ? 'Coworker' : item.group === 'Places' ? 'Place' : ''}</span>
            </li>
          ))}
          {!results.length && <li class="palette-empty">No place or coworker matches “{query}”.</li>}
        </ul>
      </div>
    </div>
  );
}
