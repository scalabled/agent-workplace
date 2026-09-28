// DOM chrome around a face: the state ring and the glyph badge (raised hand; thinking/working on
// still tokens). Kept out of the canvas so it follows the host's shape (circle bubble, rounded
// tile) and the theme tokens (--state-*, --hand, --panel) in light and dark without a redraw.
import type { FaceTier, PresenceState } from '@headcount/protocol';

const STYLE_ID = 'hc-face-style';

const CSS = `
.hc-face{position:relative;width:100%;height:100%;border-radius:inherit}
.hc-face>canvas{display:block;width:100%;height:100%;border-radius:inherit}
.hc-face__ring{position:absolute;inset:0;border-radius:inherit;pointer-events:none;
  box-shadow:inset 0 0 0 var(--hc-ring-w,2px) var(--hc-ring,transparent);
  transition:box-shadow var(--dur-state,200ms) ease-out}
.hc-face[data-tier=hero]{--hc-ring-w:3px}
.hc-face[data-state=speaking]{--hc-ring:var(--state-speaking,#e8a33d)}
.hc-face[data-state=raised_hand]{--hc-ring:var(--state-raised-hand,#3d6fe8)}
.hc-face[data-state=listening]{--hc-ring:color-mix(in srgb,var(--state-listening,#3d6fe8) 55%,transparent)}
.hc-face[data-state=thinking],.hc-face[data-state=working]{--hc-ring:color-mix(in srgb,var(--state-thinking,#6b6f76) 40%,transparent)}
.hc-face__badge{position:absolute;right:0;bottom:0;width:clamp(14px,26%,34px);aspect-ratio:1;border-radius:50%;
  display:grid;place-items:center;pointer-events:none;background:var(--panel,#fff);color:var(--muted,#6b6f76);
  box-shadow:0 1px 3px rgba(0,0,0,.16);opacity:0;transform:translate(14%,14%) scale(.8);
  transition:opacity var(--dur-state,200ms) ease-out,transform var(--dur-state,200ms) ease-out}
.hc-face__badge svg{width:62%;height:62%}
.hc-face[data-badge=hand] .hc-face__badge{color:var(--hand,#3d6fe8);animation:hc-face-pulse 1.8s ease-in-out infinite}
.hc-face[data-badge=hand] .hc-face__badge,.hc-face[data-badge=thinking] .hc-face__badge,.hc-face[data-badge=working] .hc-face__badge{opacity:1;transform:translate(14%,14%)}
@keyframes hc-face-pulse{0%,100%{box-shadow:0 1px 3px rgba(0,0,0,.16),0 0 0 0 color-mix(in srgb,var(--hand,#3d6fe8) 45%,transparent)}
  60%{box-shadow:0 1px 3px rgba(0,0,0,.16),0 0 0 6px color-mix(in srgb,var(--hand,#3d6fe8) 0%,transparent)}}
.hc-face[data-still] .hc-face__badge,.hc-face[data-still] .hc-face__ring{animation:none;transition:none}
@media (prefers-reduced-motion:reduce){.hc-face .hc-face__badge,.hc-face .hc-face__ring{animation:none;transition:none}}
`;

const GLYPHS = {
  hand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 13V6a1.5 1.5 0 0 1 3 0v5"/><path d="M11 10.5V4.5a1.5 1.5 0 0 1 3 0v6"/><path d="M14 10.5V6a1.5 1.5 0 0 1 3 0v6"/><path d="M17 11.5a1.5 1.5 0 0 1 3 0V15a7 7 0 0 1-7 7h-1.2a6 6 0 0 1-4.9-2.6L4.4 15.6a1.6 1.6 0 0 1 2.6-1.8L8 15"/></svg>',
  thinking: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="6" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="18" cy="12" r="1.7"/></svg>',
  working: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5z"/><path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5z"/></svg>',
} as const;

export type BadgeKind = keyof typeof GLYPHS | '';

export interface FaceChrome {
  root: HTMLElement;
  ring: HTMLElement;
  badge: HTMLElement;
  badgeKind: BadgeKind;
}

export function ensureFaceStyles(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  (doc.head ?? doc.documentElement).appendChild(style);
}

export function createChrome(doc: Document, canvas: HTMLCanvasElement): FaceChrome {
  ensureFaceStyles(doc);
  const root = doc.createElement('div');
  root.className = 'hc-face';
  const ring = doc.createElement('div');
  ring.className = 'hc-face__ring';
  ring.setAttribute('aria-hidden', 'true');
  const badge = doc.createElement('div');
  badge.className = 'hc-face__badge';
  badge.setAttribute('aria-hidden', 'true');
  root.append(canvas, ring, badge);
  return { root, ring, badge, badgeKind: '' };
}

/** Which glyph a state shows: the hand always; thinking/working only on still tokens. */
export function badgeFor(state: PresenceState, tier: FaceTier): BadgeKind {
  if (state === 'raised_hand') return 'hand';
  if (tier === 'token' && (state === 'thinking' || state === 'working')) return state;
  return '';
}

export function updateChrome(chrome: FaceChrome, state: PresenceState, tier: FaceTier, still: boolean, ring: boolean): void {
  const { root } = chrome;
  root.dataset.state = ring ? state : 'idle';
  root.dataset.tier = tier;
  if (still) root.dataset.still = '';
  else delete root.dataset.still;
  const kind = badgeFor(state, tier);
  root.dataset.badge = kind;
  if (kind !== chrome.badgeKind) {
    chrome.badgeKind = kind;
    if (kind) chrome.badge.innerHTML = GLYPHS[kind];
  }
}
