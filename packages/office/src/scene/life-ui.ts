// The office-life layer of the scene (OFFICE-LIFE §3.3–§3.5, §4.2–§4.3): huddle markers and the huddle card, the
// "What's happening" pill with its popover (moments with a primary action each, Autopilot, Pause), the Following chip
// and the one-time autopilot offer. Plain DOM; positions come from the scene each frame.
import type { HuddleAction, LifeSummary, Moment, ShowHuddleArgs } from '../life/types';
import type { OfficeStrings } from '../strings';
import type { Point } from '../types';

/** The owner's own lines in a joined huddle's chat. */
export const OWNER_LINE = '@owner';

export interface LifeUiHost {
  doc: Document;
  strings: OfficeStrings;
  root: HTMLElement;
  hud: HTMLElement;
  /** The huddle layer sits just under this element (the people layer), so faces stay on top. */
  before: HTMLElement;
  firstName(id: string): string;
  accent(id: string): string;
  onHuddleAction(id: string, action: HuddleAction, text?: string): void;
  onPause(paused: boolean): void;
  onAutopilot(on: boolean): void;
  /** Fly to a moment; then follow its person, or open a quick chat with them (a raised hand). */
  onMoment(m: Moment, then: 'none' | 'follow' | 'talk'): void;
  onFollowStop(): void;
  onOffer(accept: boolean): void;
  /** The card or pill wants the owner's attention on a huddle (hover hold). */
  onCardHold(members: readonly string[], held: boolean): void;
  reducedMotion(): boolean;
}

interface Marker {
  args: ShowHuddleArgs;
  el: HTMLButtonElement;
  ring: HTMLElement;
  sx: number;
  sy: number;
  /** The ring's size (px) when it follows its members, or '' for the CSS default. */
  size: string;
  visible: boolean;
}

/** Where a huddle's members stand (screen px): the ring is centred on them and wraps them all (a row at a counter too). */
export interface HuddleExtent {
  cx: number;
  cy: number;
  w: number;
  h: number;
}

export interface LifeUi {
  readonly layer: HTMLElement;
  showHuddle(h: ShowHuddleArgs): void;
  hideHuddle(id: string): void;
  /** Per frame: project a plan point (floor, z in u) to the screen, or null when off-screen. */
  place(
    project: (p: Point, z: number) => Point | null,
    lod: 0 | 1 | 2,
    vp: { w: number; h: number },
    lowest?: (members: readonly string[]) => number | null,
    extent?: (members: readonly string[]) => HuddleExtent | null,
  ): void;
  openCard(id: string, focus?: boolean): void;
  closeCard(): boolean;
  cardId(): string | null;
  huddleOf(personId: string): string | null;
  huddleIds(): string[];
  /** H: the next huddle (in view first); returns its id. */
  nextHuddle(inView: (id: string) => boolean): string | null;
  hoverPerson(personId: string | null): void;
  setSummary(s: LifeSummary | null): void;
  setAutopilot(on: boolean): void;
  setPaused(p: boolean): void;
  setFollow(name: string | null): void;
  offerWander(show: boolean): void;
  closePopover(): boolean;
  /** The screen rect of the open card (bubbles keep clear of it), or null. */
  cardRect(): { x: number; y: number; w: number; h: number } | null;
  destroy(): void;
}

/** "10:40" (or "10:40 AM") in the owner's locale, for an owner-local minute of the day. */
function clockTime(minute: number): string {
  const m = Math.round(minute / 5) * 5;
  const d = new Date(2000, 0, 1, Math.floor(m / 60) % 24, m % 60);
  try {
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(d);
  } catch {
    return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
}

export function createLifeUi(h: LifeUiHost): LifeUi {
  const { doc, strings: S } = h;
  const L = S.life;
  const mk = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement): HTMLElementTagNameMap[K] => {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (parent) parent.append(e);
    return e;
  };
  const layer = mk('div', 'hc-o-huddles');
  h.root.insertBefore(layer, h.before);
  layer.setAttribute('role', 'group');
  layer.setAttribute('aria-label', 'Huddles');
  const markers = new Map<string, Marker>();
  const names = (ids: readonly string[]) => ids.map((id) => h.firstName(id));
  let vpSize = { w: 1280, h: 800 };

  /** "Water cooler · Kate, Pax", or for a drop-by "At Jasleen's desk · Nayra visiting". */
  const titleOf = (a: ShowHuddleArgs): string => {
    if (a.hostId && a.members.includes(a.hostId)) {
      const visitors = a.members.filter((m) => m !== a.hostId);
      return `${L.atDesk(h.firstName(a.hostId))} · ${L.visiting(names(visitors).join(', '))}`;
    }
    return L.huddleTitle(a.label, names(a.members));
  };
  const habitOf = (a: { usualMin?: number; where?: string }): string | null => (a.usualMin !== undefined && a.where ? L.usual(clockTime(a.usualMin), a.where) : null);
  /** Lines as rows, a laugh appended to the line it answers ("… a draw. · Emilio laughs"), never standing alone. */
  const rowsOf = (lines: ShowHuddleArgs['lines']) => {
    const rows: { personId: string; text: string; after: string[] }[] = [];
    for (const l of lines) {
      if (l.nonverbal) {
        const prev = rows[rows.length - 1];
        if (prev) prev.after.push(L.laughs(h.firstName(l.personId), l.text));
        continue;
      }
      rows.push({ personId: l.personId, text: l.text, after: [] });
    }
    return rows;
  };
  /** The last line someone said (a new one after Join is the greeting). */
  const lastSig = (lines: ShowHuddleArgs['lines']) => {
    const l = [...lines].reverse().find((x) => !x.nonverbal && x.personId !== OWNER_LINE);
    return l ? `${l.personId}|${l.text}` : '';
  };
  const latestLine = (a: ShowHuddleArgs) => [...a.lines].reverse().find((l) => !l.nonverbal && l.personId !== OWNER_LINE) ?? null;

  // ── the huddle card ──────────────────────────────────────────────────────────────
  const card = mk('div', 'hc-o-hcard', h.root);
  card.setAttribute('role', 'group');
  card.hidden = true;
  let cardFor: string | null = null;
  let cardHover = false;
  let closeTimer: ReturnType<typeof setTimeout> | null = null;
  let openTimer: ReturnType<typeof setTimeout> | null = null;
  /** Join puts the owner straight into the chat: the field takes focus once the greeting shows (or soon after). */
  let focusAfterJoin: { id: string; last: string; timer: ReturnType<typeof setTimeout> | null } | null = null;
  let draft = '';
  const clearTimers = () => {
    if (closeTimer) clearTimeout(closeTimer);
    if (openTimer) clearTimeout(openTimer);
    closeTimer = null;
    openTimer = null;
  };
  card.addEventListener('pointerenter', () => {
    cardHover = true;
    if (closeTimer) clearTimeout(closeTimer);
    closeTimer = null;
  });
  card.addEventListener('pointerleave', () => {
    cardHover = false;
    scheduleClose();
  });
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      const m = cardFor ? markers.get(cardFor) : undefined;
      if (m?.args.joined) h.onHuddleAction(m.args.id, 'leave');
      api.closeCard();
    }
  });
  const scheduleClose = () => {
    if (closeTimer) clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      closeTimer = null;
      const m = cardFor ? markers.get(cardFor) : undefined;
      if (cardHover || m?.args.joined || card.contains(doc.activeElement)) return;
      api.closeCard();
    }, 320);
  };
  const join = (id: string) => {
    const m = markers.get(id);
    if (focusAfterJoin?.timer) clearTimeout(focusAfterJoin.timer);
    focusAfterJoin = { id, last: lastSig(m?.args.lines ?? []), timer: setTimeout(() => focusField(id), 900) };
    h.onHuddleAction(id, 'join');
  };
  const focusField = (id: string) => {
    if (!focusAfterJoin || focusAfterJoin.id !== id) return;
    if (focusAfterJoin.timer) clearTimeout(focusAfterJoin.timer);
    focusAfterJoin = null;
    if (cardFor !== id) return;
    card.querySelector<HTMLInputElement>('.hc-o-hcard__input')?.focus({ preventScroll: true });
  };

  const renderCard = () => {
    const m = cardFor ? markers.get(cardFor) : undefined;
    if (!m) return;
    const a = m.args;
    const who = names(a.members);
    card.setAttribute('aria-label', L.huddleLabel(a.hostId ? L.atDesk(h.firstName(a.hostId)) : a.label, who));
    if (a.joined) card.dataset.joined = '';
    else delete card.dataset.joined;
    // Keep a draft the owner is typing.
    const input = card.querySelector<HTMLInputElement>('.hc-o-hcard__input');
    if (input) draft = input.value;
    const hadFocus = input && doc.activeElement === input;
    card.replaceChildren();
    const head = mk('div', 'hc-o-hcard__head', card);
    head.textContent = titleOf(a);
    const habit = habitOf(a);
    if (habit) {
      const sub = mk('div', 'hc-o-hcard__sub', card);
      sub.textContent = habit;
    }
    const list = mk('div', 'hc-o-hcard__lines', card);
    const rows = rowsOf(a.lines).slice(a.joined ? -4 : -3);
    if (!rows.length) {
      const q = mk('div', 'hc-o-hcard__quiet', list);
      q.textContent = L.quiet;
    }
    for (const l of rows) {
      const row = mk('div', 'hc-o-hcard__line', list);
      row.style.setProperty('--acc', h.accent(l.personId));
      const b = mk('b', '', row);
      b.textContent = l.personId === OWNER_LINE ? S.you : h.firstName(l.personId);
      if (l.personId === OWNER_LINE) row.dataset.owner = '';
      const t = mk('span', '', row);
      t.textContent = l.text;
      if (l.after.length) {
        const i = mk('i', 'hc-o-hcard__beat', t);
        i.textContent = ` · ${l.after.join(' · ')}`;
      }
    }
    const act = mk('div', 'hc-o-hcard__actions', card);
    if (!a.joined) {
      const joinBtn = mk('button', 'hc-o-btn hc-o-btn--primary', act);
      joinBtn.type = 'button';
      joinBtn.textContent = L.join;
      joinBtn.addEventListener('click', () => join(a.id));
      const listen = mk('button', 'hc-o-btn', act);
      listen.type = 'button';
      listen.setAttribute('aria-pressed', String(a.listening));
      listen.innerHTML = `${a.listening ? L.listening : L.listen} <kbd>L</kbd>`;
      listen.addEventListener('click', () => h.onHuddleAction(a.id, 'listen'));
    } else {
      const form = mk('form', 'hc-o-hcard__form', act);
      const inp = mk('input', 'hc-o-input hc-o-hcard__input', form);
      inp.type = 'text';
      inp.placeholder = L.sayTo(who);
      inp.setAttribute('aria-label', L.sayTo(who));
      inp.value = draft;
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') return;
        e.stopPropagation();
      });
      const send = mk('button', 'hc-o-btn hc-o-btn--primary', form);
      send.type = 'submit';
      send.textContent = L.send;
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = inp.value.trim();
        if (!text) return;
        draft = '';
        inp.value = '';
        h.onHuddleAction(a.id, 'talk', text);
      });
      const row = mk('div', 'hc-o-hcard__row', act);
      const room = mk('button', 'hc-o-btn hc-o-btn--ghost', row);
      room.type = 'button';
      room.textContent = L.openInRoom;
      room.addEventListener('click', () => h.onHuddleAction(a.id, 'room'));
      const leave = mk('button', 'hc-o-btn hc-o-btn--ghost', row);
      leave.type = 'button';
      leave.textContent = L.leave;
      leave.addEventListener('click', () => {
        h.onHuddleAction(a.id, 'leave');
        api.closeCard();
      });
      if (hadFocus) inp.focus({ preventScroll: true });
      // The greeting is in: straight into the chat.
      else if (focusAfterJoin?.id === a.id && lastSig(a.lines) !== focusAfterJoin.last) setTimeout(() => focusField(a.id), 0);
    }
  };

  // ── the pill, its popover and the chip ───────────────────────────────────────────
  const pillWrap = mk('div', 'hc-o-life', h.hud);
  // Hidden until life's first summary: the pill never says "Quiet floor" over a crowd it has not counted yet.
  pillWrap.hidden = true;
  const pill = mk('button', 'hc-o-btn hc-o-life__pill', pillWrap);
  pill.type = 'button';
  pill.setAttribute('aria-haspopup', 'dialog');
  pill.setAttribute('aria-expanded', 'false');
  const dot = mk('i', 'hc-o-life__dot', pill);
  dot.setAttribute('aria-hidden', 'true');
  const pillText = mk('span', '', pill);
  pillText.textContent = L.quietFloor;
  const pop = mk('div', 'hc-o-menu hc-o-life__pop', pillWrap);
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', L.whatsHappening);
  pop.hidden = true;
  const offer = mk('div', 'hc-o-life__offer', pillWrap);
  offer.hidden = true;
  const chip = mk('div', 'hc-o-follow', h.hud);
  chip.hidden = true;
  const chipText = mk('span', '', chip);
  const chipKbd = mk('kbd', '', chip);
  chipKbd.textContent = 'Esc';
  chip.addEventListener('click', () => h.onFollowStop());
  let summary: LifeSummary | null = null;
  let cardBox: { x: number; y: number; w: number; h: number } | null = null;
  let autopilot = false;
  let pausedState = false;
  let lastHuddles = 0;

  const renderPop = () => {
    pop.replaceChildren();
    const title = mk('div', 'hc-o-life__title', pop);
    title.textContent = L.whatsHappening;
    const ms = summary?.moments ?? [];
    if (!ms.length) {
      const none = mk('div', 'hc-o-menu__none', pop);
      none.textContent = L.nothingNow;
    }
    for (const [i, m] of ms.slice(0, 5).entries()) {
      const row = mk('div', 'hc-o-life__row', pop);
      const go = mk('button', 'hc-o-menu__item', row);
      go.type = 'button';
      const b = mk('b', '', go);
      b.textContent = names(m.personIds).join(', ') || m.label;
      const sm = mk('small', '', go);
      sm.textContent = m.usualMin !== undefined ? `${m.label} · ${L.usualShort(clockTime(m.usualMin))}` : m.label;
      // A huddle previews what they are saying.
      if (m.line) {
        const q = mk('span', 'hc-o-life__quote', go);
        q.textContent = `${h.firstName(m.line.personId)}: “${m.line.text}”`;
      }
      go.addEventListener('click', () => {
        api.closePopover();
        h.onMoment(m, 'none');
      });
      const acts = mk('span', 'hc-o-life__acts', row);
      const action = (label: string, aria: string, primary: boolean, fn: () => void) => {
        const btn = mk('button', `hc-o-btn ${primary ? 'hc-o-btn--primary' : 'hc-o-btn--ghost'} hc-o-life__act`, acts);
        btn.type = 'button';
        btn.textContent = label;
        btn.setAttribute('aria-label', aria);
        btn.addEventListener('click', () => {
          api.closePopover();
          fn();
        });
      };
      const first = names(m.personIds)[0] ?? '';
      // Calm: one filled button in the list (the top moment's), the rest quiet; a raised hand always asks.
      const lead = i === 0;
      if (m.kind === 'raised_hand') action(L.talk, `${L.talk} ${first}`.trim(), true, () => h.onMoment(m, 'talk'));
      else if (m.huddleId) {
        const hid = m.huddleId;
        action(L.listen, `${L.listen}: ${m.label}`, lead, () => {
          h.onMoment(m, 'none');
          h.onHuddleAction(hid, 'listen');
        });
        action(L.join, `${L.join}: ${m.label}`, false, () => {
          h.onMoment(m, 'none');
          join(hid);
          api.openCard(hid);
        });
      } else action(L.follow, `${L.follow} ${first}`.trim(), lead, () => h.onMoment(m, 'follow'));
    }
    mk('div', 'hc-o-menu__sep', pop);
    const sw = (label: string, on: boolean, disabled: boolean, note: string | null, fn: (v: boolean) => void) => {
      const lab = mk('label', 'hc-o-life__switch', pop);
      const box = mk('input', '', lab);
      box.type = 'checkbox';
      box.setAttribute('role', 'switch');
      box.checked = on;
      box.disabled = disabled;
      const t = mk('span', '', lab);
      t.textContent = label;
      if (note) {
        const n = mk('small', '', lab);
        n.textContent = note;
      }
      box.addEventListener('change', () => fn(box.checked));
    };
    const rm = h.reducedMotion();
    sw(L.autopilot, autopilot && !rm, rm, rm ? L.autopilotOffRm : null, (v) => h.onAutopilot(v));
    sw(L.pause, pausedState, false, null, (v) => h.onPause(v));
  };
  pill.addEventListener('click', () => {
    if (pop.hidden) {
      // One overlay at a time (phones: the sheet never stacks on the huddle card).
      api.closeCard();
      renderPop();
      pop.hidden = false;
      pill.setAttribute('aria-expanded', 'true');
      (pop.querySelector('.hc-o-menu__item, input') as HTMLElement | null)?.focus();
    } else api.closePopover();
  });
  pop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      api.closePopover();
      pill.focus();
    }
    e.stopPropagation();
  });

  /** The nearest huddle's latest line, for the pill's tooltip (the words behind the glyphs at plan zoom). */
  const nearestLine = (): string | null => {
    let best: { d: number; text: string } | null = null;
    for (const m of markers.values()) {
      const l = latestLine(m.args);
      if (!l) continue;
      const d = m.visible && Number.isFinite(m.sx) ? Math.hypot(m.sx - vpSize.w / 2, m.sy - vpSize.h / 2) : 1e6;
      if (!best || d < best.d) best = { d, text: `${h.firstName(l.personId)}: “${l.text}”` };
    }
    return best?.text ?? null;
  };
  const renderPill = () => {
    const s = summary;
    let text = L.quietFloor;
    if (pausedState) text = L.paused;
    else if (s?.night) text = s.huddles ? `${L.nightPill(s.atWindows ?? 0)} · ${L.pill(s.huddles, 0)}` : L.nightPill(s.atWindows ?? 0);
    else if (s && (s.huddles || s.away)) text = L.pill(s.huddles, s.away);
    if (pillText.textContent !== text) pillText.textContent = text;
    pill.setAttribute('aria-label', L.pillLabel(text));
    const line = pausedState ? null : nearestLine();
    if (line) pill.title = line;
    else pill.removeAttribute('title');
    pill.dataset.state = pausedState ? 'paused' : s?.huddles ? 'on' : 'off';
    // The dot pulses once when a huddle starts (static with reduced motion).
    if (s && s.huddles > lastHuddles && !h.reducedMotion()) {
      dot.classList.remove('is-pulse');
      void dot.offsetWidth;
      dot.classList.add('is-pulse');
    }
    lastHuddles = s?.huddles ?? 0;
    if (!pop.hidden) renderPop();
  };

  const api: LifeUi = {
    layer,
    showHuddle(args) {
      let m = markers.get(args.id);
      if (!m) {
        const el = mk('button', 'hc-o-huddle', layer);
        el.type = 'button';
        el.tabIndex = -1;
        el.dataset.id = args.id;
        const ring = mk('span', 'hc-o-huddle__ring', el);
        const dots = mk('span', 'hc-o-huddle__dots', el);
        for (let i = 0; i < 3; i++) mk('i', '', dots);
        el.addEventListener('pointerenter', () => {
          if (openTimer) clearTimeout(openTimer);
          if (closeTimer) clearTimeout(closeTimer);
          openTimer = setTimeout(() => api.openCard(args.id), 400);
        });
        el.addEventListener('pointerleave', () => {
          if (openTimer) clearTimeout(openTimer);
          openTimer = null;
          if (cardFor === args.id) scheduleClose();
        });
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          api.openCard(args.id, true);
        });
        el.addEventListener('focus', () => api.openCard(args.id));
        el.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            join(args.id);
            api.openCard(args.id);
          }
        });
        m = { args, el, ring, sx: NaN, sy: NaN, size: '', visible: false };
        markers.set(args.id, m);
      }
      m.args = args;
      m.el.setAttribute('aria-label', L.huddleLabel(args.hostId ? L.atDesk(h.firstName(args.hostId)) : args.label, names(args.members)));
      m.el.dataset.talking = args.talking ? '1' : '0';
      // The plan-zoom glyph pulses in the speaker's accent while a line runs.
      if (args.speaker) {
        m.el.dataset.speaking = '';
        m.el.style.setProperty('--acc', h.accent(args.speaker));
      } else delete m.el.dataset.speaking;
      if (args.joined) m.el.dataset.joined = '';
      else delete m.el.dataset.joined;
      if (args.listening) m.el.dataset.listening = '';
      else delete m.el.dataset.listening;
      if (cardFor === args.id) renderCard();
    },
    hideHuddle(id) {
      const m = markers.get(id);
      if (!m) return;
      markers.delete(id);
      m.el.remove();
      if (cardFor === id) api.closeCard();
    },
    place(project, lod, vp, lowest, extent) {
      vpSize = vp;
      layer.dataset.lod = String(lod);
      for (const m of markers.values()) {
        let p = project(m.args.center, 0);
        // Closer in, the ring follows the members themselves (a row at a counter is one capsule, not a circle on one).
        const ext = p && lod > 0 ? (extent?.(m.args.members) ?? null) : null;
        if (ext) p = { x: ext.cx, y: ext.cy };
        const size = ext ? `${Math.round(ext.w)}x${Math.round(ext.h)}` : '';
        if (size !== m.size) {
          m.size = size;
          if (ext) {
            m.ring.style.width = `${Math.round(ext.w)}px`;
            m.ring.style.height = `${Math.round(ext.h)}px`;
            m.ring.style.borderRadius = `${Math.round(Math.min(ext.w, ext.h) / 2)}px`;
          } else for (const prop of ['width', 'height', 'border-radius']) m.ring.style.removeProperty(prop);
        }
        const vis = !!p;
        if (vis !== m.visible) {
          m.visible = vis;
          m.el.style.visibility = vis ? '' : 'hidden';
        }
        if (!p) continue;
        if (p.x !== m.sx || p.y !== m.sy) {
          m.sx = p.x;
          m.sy = p.y;
          m.el.style.transform = `translate3d(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px,0)`;
        }
      }
      if (cardFor) {
        const m = markers.get(cardFor);
        const top = m ? project(m.args.center, 20) : null;
        if (!m || !top) {
          card.style.visibility = 'hidden';
          return;
        }
        card.style.visibility = '';
        const w = card.offsetWidth || 280;
        const ch = card.offsetHeight || 120;
        const lift = lod === 0 ? 18 : lod === 1 ? 44 : 66;
        const x = Math.max(8 + w / 2, Math.min(vp.w - 8 - w / 2, top.x));
        // Above the group; a joined huddle's chat sits below it, so the replies' bubbles stay in view.
        const below = (lowest?.(m.args.members) ?? project(m.args.center, 0)?.y ?? top.y) + (lod === 0 ? 16 : 30);
        let y = m.args.joined ? below : top.y - lift - ch;
        if (y < 64) y = below;
        y = Math.min(vp.h - ch - 8, y);
        cardBox = { x: x - w / 2, y, w, h: ch };
        card.style.transform = `translate3d(${(x - w / 2).toFixed(1)}px,${y.toFixed(1)}px,0)`;
      }
    },
    openCard(id, focus) {
      const m = markers.get(id);
      if (!m) return;
      clearTimers();
      // One overlay at a time: the card closes the What's happening popover (phones: never two sheets).
      api.closePopover();
      if (cardFor && cardFor !== id) api.closeCard();
      const was = cardFor;
      cardFor = id;
      card.hidden = false;
      renderCard();
      if (was !== id) {
        h.onCardHold(m.args.members, true);
        h.onHuddleAction(id, 'open');
      }
      if (focus) (card.querySelector('.hc-o-btn, .hc-o-hcard__input') as HTMLElement | null)?.focus({ preventScroll: true });
    },
    closeCard() {
      if (!cardFor) return false;
      const m = markers.get(cardFor);
      if (m) h.onCardHold(m.args.members, false);
      const id = cardFor;
      cardFor = null;
      cardBox = null;
      card.hidden = true;
      cardHover = false;
      clearTimers();
      if (m && markers.has(id)) h.onHuddleAction(id, 'close');
      return true;
    },
    cardId: () => cardFor,
    huddleOf(personId) {
      for (const m of markers.values()) if (m.args.members.includes(personId)) return m.args.id;
      return null;
    },
    huddleIds: () => [...markers.keys()],
    nextHuddle(inView) {
      const ids = [...markers.keys()];
      if (!ids.length) return null;
      const sorted = [...ids.filter(inView), ...ids.filter((i) => !inView(i))];
      const cur = cardFor ? sorted.indexOf(cardFor) : -1;
      const next = sorted[(cur + 1) % sorted.length]!;
      markers.get(next)?.el.focus({ preventScroll: true });
      api.openCard(next);
      return next;
    },
    hoverPerson(personId) {
      const id = personId ? api.huddleOf(personId) : null;
      if (id) {
        if (openTimer) clearTimeout(openTimer);
        if (closeTimer) clearTimeout(closeTimer);
        closeTimer = null;
        if (cardFor !== id) openTimer = setTimeout(() => api.openCard(id), 400);
      } else {
        if (openTimer) clearTimeout(openTimer);
        openTimer = null;
        if (cardFor) scheduleClose();
      }
    },
    setSummary(s) {
      summary = s;
      pillWrap.hidden = !s;
      renderPill();
    },
    setAutopilot(on) {
      autopilot = on;
      if (!pop.hidden) renderPop();
    },
    setPaused(p) {
      pausedState = p;
      renderPill();
    },
    setFollow(name) {
      chip.hidden = !name;
      if (name) chipText.textContent = L.following(name);
    },
    offerWander(show) {
      offer.hidden = !show;
      if (!show) return;
      offer.replaceChildren();
      const t = mk('span', '', offer);
      t.textContent = L.wander;
      const yes = mk('button', 'hc-o-btn hc-o-btn--primary', offer);
      yes.type = 'button';
      yes.textContent = L.wanderYes;
      yes.addEventListener('click', () => h.onOffer(true));
      const no = mk('button', 'hc-o-btn hc-o-btn--ghost', offer);
      no.type = 'button';
      no.textContent = L.wanderNo;
      no.addEventListener('click', () => h.onOffer(false));
    },
    closePopover() {
      if (pop.hidden) return false;
      pop.hidden = true;
      pill.setAttribute('aria-expanded', 'false');
      return true;
    },
    cardRect: () => (cardFor && !card.hidden ? cardBox : null),
    destroy() {
      clearTimers();
      if (focusAfterJoin?.timer) clearTimeout(focusAfterJoin.timer);
      focusAfterJoin = null;
      layer.remove();
      card.remove();
      pillWrap.remove();
      chip.remove();
    },
  };
  pillWrap.hidden = true;
  return api;
}
