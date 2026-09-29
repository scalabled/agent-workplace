// The office HUD (OFFICE-PLAN §4.1, §4.4, §4.6): Desks | Conference, Walk to, Find, zoom buttons and the mini-map.
import type { OfficeStrings } from '../strings';
import type { OfficeMode, Rect } from '../types';

export interface WalkTarget {
  id: string;
  label: string;
  group: 'rooms' | 'places' | 'teams';
}

export interface FindResult {
  id: string;
  name: string;
  sub: string;
}

export interface HudHost {
  doc: Document;
  strings: OfficeStrings;
  onZoom(dir: 1 | -1 | 0): void;
  onMode(mode: OfficeMode): void;
  walkTargets(): WalkTarget[];
  onWalk(id: string): void;
  find(q: string): FindResult[];
  onFindChange(q: string, ids: string[]): void;
  onFindCommit(id: string): void;
  onMinimap(p: { x: number; y: number }): void;
}

export interface Hud {
  readonly el: HTMLElement;
  setMode(mode: OfficeMode): void;
  openWalk(): void;
  openFind(): void;
  /** Close an open menu; true if one was open. */
  closeMenus(): boolean;
  setMinimap(cells: { rect: Rect; kind: string }[], box: Rect): void;
  updateMinimap(view: Rect | null): void;
  destroy(): void;
}

export function createHud(h: HudHost): Hud {
  const { doc, strings: S } = h;
  const mk = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement): HTMLElementTagNameMap[K] => {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (parent) parent.append(e);
    return e;
  };
  const el = mk('div', 'hc-o-hud');

  // Desks | Conference.
  const seg = mk('div', 'hc-o-seg', el);
  seg.setAttribute('role', 'radiogroup');
  seg.setAttribute('aria-label', S.modeGroup);
  const modeBtns = (['desks', 'conference'] as const).map((m) => {
    const b = mk('button', 'hc-o-seg__opt', seg);
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.dataset.mode = m;
    b.textContent = m === 'desks' ? S.desks : S.conference;
    b.addEventListener('click', () => h.onMode(m));
    return b;
  });

  // Walk to and Find.
  const tools = mk('div', 'hc-o-tools', el);
  const walkBtn = mk('button', 'hc-o-btn', tools);
  walkBtn.type = 'button';
  walkBtn.setAttribute('aria-haspopup', 'menu');
  walkBtn.setAttribute('aria-expanded', 'false');
  walkBtn.innerHTML = `${S.walkTo} <kbd>G</kbd>`;
  const findWrap = mk('div', 'hc-o-find', tools);
  // Phones show Find as an icon that expands into the field (CSS below 640 px); elsewhere the field is always there.
  const findBtn = mk('button', 'hc-o-btn hc-o-find__btn', findWrap);
  findBtn.type = 'button';
  findBtn.setAttribute('aria-label', S.find);
  findBtn.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="M10.4 10.4 14 14"/></svg>';
  findBtn.addEventListener('click', () => api.openFind());
  const findInput = mk('input', 'hc-o-input', findWrap);
  findInput.type = 'search';
  findInput.placeholder = S.findPlaceholder;
  findInput.setAttribute('aria-label', S.find);
  findInput.setAttribute('role', 'combobox');
  findInput.setAttribute('aria-expanded', 'false');
  findInput.setAttribute('aria-autocomplete', 'list');
  const findList = mk('div', 'hc-o-menu hc-o-find__list', findWrap);
  findList.setAttribute('role', 'listbox');
  findList.hidden = true;
  const walkMenu = mk('div', 'hc-o-menu hc-o-walk', tools);
  walkMenu.setAttribute('role', 'menu');
  walkMenu.hidden = true;

  // Zoom.
  const zoom = mk('div', 'hc-o-zoom', el);
  const zb = (label: string, text: string, dir: 1 | -1 | 0) => {
    const b = mk('button', 'hc-o-zoom__btn', zoom);
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.title = label;
    b.innerHTML = text;
    b.addEventListener('click', () => h.onZoom(dir));
  };
  zb(S.zoomIn, '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg>', 1);
  zb(S.zoomOut, '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10"/></svg>', -1);
  zb(S.fit, '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 6V3h3M10 3h3v3M13 10v3h-3M6 13H3v-3"/></svg>', 0);

  // Mini-map.
  const mini = mk('div', 'hc-o-mini', el);
  mini.setAttribute('role', 'img');
  mini.setAttribute('aria-label', S.minimap);
  mini.hidden = true;
  let miniBox: Rect = { x: 0, y: 0, w: 1, h: 1 };
  const svgNS = 'http://www.w3.org/2000/svg';
  const miniSvg = doc.createElementNS(svgNS, 'svg');
  miniSvg.setAttribute('viewBox', '0 0 176 66');
  mini.append(miniSvg);
  const viewRect = doc.createElementNS(svgNS, 'rect');
  viewRect.setAttribute('class', 'hc-o-mini__view');

  let findIds: string[] = [];
  let active = -1;

  const renderFind = () => {
    const q = findInput.value.trim();
    const res = q ? h.find(q).slice(0, 8) : [];
    findIds = q ? h.find(q).map((r) => r.id) : [];
    h.onFindChange(q, findIds);
    findList.replaceChildren();
    active = res.length ? 0 : -1;
    if (q && !res.length) {
      const none = mk('div', 'hc-o-menu__none', findList);
      none.textContent = S.noMatches;
    }
    res.forEach((r, i) => {
      const o = mk('button', 'hc-o-menu__item', findList);
      o.type = 'button';
      o.setAttribute('role', 'option');
      o.id = `hc-o-find-${i}`;
      o.dataset.id = r.id;
      const b = mk('b', '', o);
      b.textContent = r.name;
      const s = mk('small', '', o);
      s.textContent = r.sub;
      if (i === 0) o.setAttribute('aria-selected', 'true');
      o.addEventListener('mousedown', (e) => e.preventDefault());
      o.addEventListener('click', () => commit(r.id));
    });
    findList.hidden = !q;
    findInput.setAttribute('aria-expanded', String(!!q));
  };
  const commit = (id: string) => {
    findList.hidden = true;
    findInput.setAttribute('aria-expanded', 'false');
    h.onFindCommit(id);
  };
  findInput.addEventListener('input', renderFind);
  findInput.addEventListener('keydown', (e) => {
    const items = [...findList.querySelectorAll<HTMLElement>('.hc-o-menu__item')];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!items.length) return;
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items.forEach((it, i) => it.setAttribute('aria-selected', String(i === active)));
      findInput.setAttribute('aria-activedescendant', items[active]!.id);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const id = items[active]?.dataset.id ?? findIds[0];
      if (id) commit(id);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      findInput.value = '';
      renderFind();
      findInput.blur();
    }
    e.stopPropagation();
  });
  findInput.addEventListener('blur', () => {
    setTimeout(() => {
      findList.hidden = true;
      if (!findInput.value && findWrap.dataset.open !== undefined) delete findWrap.dataset.open;
    }, 120);
  });

  const renderWalk = () => {
    walkMenu.replaceChildren();
    const targets = h.walkTargets();
    for (const group of ['rooms', 'places', 'teams'] as const) {
      const items = targets.filter((t) => t.group === group);
      if (!items.length) continue;
      mk('div', 'hc-o-menu__sep', walkMenu);
      for (const t of items) {
        const b = mk('button', 'hc-o-menu__item', walkMenu);
        b.type = 'button';
        b.setAttribute('role', 'menuitem');
        b.textContent = t.label;
        b.addEventListener('click', () => {
          api.closeMenus();
          h.onWalk(t.id);
        });
      }
    }
    walkMenu.firstElementChild?.remove();
  };
  walkBtn.addEventListener('click', () => (walkMenu.hidden ? api.openWalk() : api.closeMenus()));
  walkMenu.addEventListener('keydown', (e) => {
    const items = [...walkMenu.querySelectorAll<HTMLElement>('.hc-o-menu__item')];
    const i = items.indexOf(doc.activeElement as HTMLElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      api.closeMenus();
      walkBtn.focus();
    }
    e.stopPropagation();
  });

  let miniDrag = false;
  const miniJump = (e: PointerEvent) => {
    const r = miniSvg.getBoundingClientRect();
    if (!r.width) return;
    const fx = (e.clientX - r.left) / r.width;
    const fy = (e.clientY - r.top) / r.height;
    h.onMinimap({ x: miniBox.x + fx * miniBox.w, y: miniBox.y + fy * miniBox.h });
  };
  mini.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    miniDrag = true;
    mini.setPointerCapture?.(e.pointerId);
    miniJump(e);
  });
  mini.addEventListener('pointermove', (e) => {
    if (miniDrag) miniJump(e);
  });
  mini.addEventListener('pointerup', () => {
    miniDrag = false;
  });

  const api: Hud = {
    el,
    setMode(mode) {
      for (const b of modeBtns) b.setAttribute('aria-checked', String(b.dataset.mode === mode));
    },
    openWalk() {
      renderWalk();
      walkMenu.hidden = false;
      walkBtn.setAttribute('aria-expanded', 'true');
      (walkMenu.querySelector('.hc-o-menu__item') as HTMLElement | null)?.focus();
    },
    openFind() {
      findWrap.dataset.open = '';
      findInput.focus();
      findInput.select();
    },
    closeMenus() {
      let was = false;
      if (!walkMenu.hidden) {
        walkMenu.hidden = true;
        walkBtn.setAttribute('aria-expanded', 'false');
        was = true;
      }
      if (!findList.hidden) {
        findList.hidden = true;
        was = true;
      }
      return was;
    },
    setMinimap(cells, box) {
      miniBox = box;
      const sx = 176 / box.w;
      const sy = 66 / box.h;
      let s = '';
      for (const c of cells) s += `<rect class="hc-o-mini__${c.kind}" x="${((c.rect.x - box.x) * sx).toFixed(1)}" y="${((c.rect.y - box.y) * sy).toFixed(1)}" width="${(c.rect.w * sx).toFixed(1)}" height="${(c.rect.h * sy).toFixed(1)}" rx="1"/>`;
      miniSvg.innerHTML = s;
      miniSvg.append(viewRect);
    },
    updateMinimap(view) {
      mini.hidden = !view;
      if (!view) return;
      const sx = 176 / miniBox.w;
      const sy = 66 / miniBox.h;
      viewRect.setAttribute('x', ((view.x - miniBox.x) * sx).toFixed(1));
      viewRect.setAttribute('y', ((view.y - miniBox.y) * sy).toFixed(1));
      viewRect.setAttribute('width', (view.w * sx).toFixed(1));
      viewRect.setAttribute('height', (view.h * sy).toFixed(1));
    },
    destroy() {
      el.remove();
    },
  };
  return api;
}
