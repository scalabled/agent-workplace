// The invite picker: a searchable list grouped by department, with face tokens, checkboxes and
// "Invite N". It stops at the room's capacity and says so.
import type { OfficeStrings } from '../strings';
import type { FaceSlot, OfficePerson } from '../types';

export interface PickerOptions {
  doc: Document;
  strings: OfficeStrings;
  roomName: string;
  /** Seats besides the owner. */
  capacity: number;
  /** Already in the room. */
  current: readonly string[];
  people: readonly OfficePerson[];
  groupName(groupId: string): string;
  groupOrder(groupId: string): number;
  face(personId: string): FaceSlot;
  onInvite(ids: string[]): void;
  onClose(): void;
}

export interface Picker {
  readonly el: HTMLElement;
  close(): void;
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

export function openPicker(container: HTMLElement, o: PickerOptions): Picker {
  const { doc, strings: S } = o;
  const el = doc.createElement('div');
  el.className = 'hc-o-picker';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', S.inviteTitle(o.roomName));
  const panel = doc.createElement('div');
  panel.className = 'hc-o-picker__panel';
  const head = doc.createElement('div');
  head.className = 'hc-o-picker__head';
  const title = doc.createElement('h2');
  title.textContent = S.inviteTitle(o.roomName);
  const close = doc.createElement('button');
  close.type = 'button';
  close.className = 'hc-o-btn hc-o-btn--ghost';
  close.textContent = S.close;
  head.append(title, close);
  const search = doc.createElement('input');
  search.type = 'search';
  search.className = 'hc-o-input';
  search.placeholder = S.inviteSearch;
  search.setAttribute('aria-label', S.inviteSearch);
  const list = doc.createElement('div');
  list.className = 'hc-o-picker__list';
  const foot = doc.createElement('div');
  foot.className = 'hc-o-picker__foot';
  const note = doc.createElement('span');
  note.className = 'hc-o-picker__note';
  const go = doc.createElement('button');
  go.type = 'button';
  go.className = 'hc-o-btn hc-o-btn--primary';
  foot.append(note, go);
  panel.append(head, search, list, foot);
  el.append(panel);

  const current = new Set(o.current);
  const chosen = new Set<string>();
  const faces = new Map<string, FaceSlot>();
  const rows = new Map<string, { row: HTMLElement; box: HTMLInputElement; text: string }>();
  const free = () => Math.max(0, o.capacity - current.size);

  const byGroup = new Map<string, OfficePerson[]>();
  for (const p of o.people) (byGroup.get(p.groupId) ?? byGroup.set(p.groupId, []).get(p.groupId)!).push(p);
  const groupIds = [...byGroup.keys()].sort((a, b) => o.groupOrder(a) - o.groupOrder(b) || a.localeCompare(b));
  const sections: { sec: HTMLElement; ids: string[] }[] = [];

  const observer =
    typeof IntersectionObserver === 'function'
      ? new IntersectionObserver(
          (entries) => {
            for (const e of entries) {
              if (!e.isIntersecting) continue;
              const id = (e.target as HTMLElement).dataset.pid!;
              if (faces.has(id)) continue;
              const slot = o.face(id);
              faces.set(id, slot);
              e.target.replaceChildren(slot.el);
              observer?.unobserve(e.target);
            }
          },
          { root: list, rootMargin: '120px' },
        )
      : null;

  for (const gid of groupIds) {
    const sec = doc.createElement('section');
    const h = doc.createElement('h3');
    h.textContent = o.groupName(gid);
    sec.append(h);
    const ids: string[] = [];
    for (const p of byGroup.get(gid)!) {
      const row = doc.createElement('label');
      row.className = 'hc-o-picker__row';
      const box = doc.createElement('input');
      box.type = 'checkbox';
      box.value = p.id;
      const faceBox = doc.createElement('span');
      faceBox.className = 'hc-o-picker__face';
      faceBox.dataset.pid = p.id;
      faceBox.style.setProperty('--acc', p.accent);
      const txt = doc.createElement('span');
      txt.className = 'hc-o-picker__txt';
      const nm = doc.createElement('b');
      nm.textContent = p.name;
      const tt = doc.createElement('small');
      tt.textContent = current.has(p.id) ? S.inRoom(o.roomName) : p.title;
      txt.append(nm, tt);
      row.append(box, faceBox, txt);
      if (current.has(p.id)) {
        box.checked = true;
        box.disabled = true;
        row.dataset.here = '';
      }
      box.addEventListener('change', () => {
        if (box.checked) {
          if (chosen.size >= free()) {
            box.checked = false;
            note.dataset.full = '';
            return;
          }
          chosen.add(p.id);
        } else chosen.delete(p.id);
        update();
      });
      sec.append(row);
      rows.set(p.id, { row, box, text: norm(`${p.name} ${p.title} ${o.groupName(gid)}`) });
      ids.push(p.id);
      if (observer) observer.observe(faceBox);
      else {
        const slot = o.face(p.id);
        faces.set(p.id, slot);
        faceBox.append(slot.el);
      }
    }
    sections.push({ sec, ids });
    list.append(sec);
  }

  const update = () => {
    go.textContent = S.inviteN(chosen.size);
    go.disabled = chosen.size === 0;
    note.textContent = S.capacity(o.roomName, o.capacity);
    for (const [id, r] of rows) if (!current.has(id)) r.box.disabled = !r.box.checked && chosen.size >= free();
  };
  const filter = () => {
    const q = norm(search.value.trim());
    for (const { sec, ids } of sections) {
      let any = false;
      for (const id of ids) {
        const r = rows.get(id)!;
        const hit = !q || r.text.includes(q);
        r.row.hidden = !hit;
        any ||= hit;
      }
      sec.hidden = !any;
    }
  };
  search.addEventListener('input', filter);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      api.close();
    }
  };
  el.addEventListener('keydown', onKey);
  close.addEventListener('click', () => api.close());
  el.addEventListener('pointerdown', (e) => {
    if (e.target === el) api.close();
  });
  go.addEventListener('click', () => {
    if (!chosen.size) return;
    const ids = [...chosen];
    api.close();
    o.onInvite(ids);
  });
  update();
  container.append(el);
  search.focus({ preventScroll: true });

  let closed = false;
  const api: Picker = {
    el,
    close() {
      if (closed) return;
      closed = true;
      observer?.disconnect();
      for (const f of faces.values()) f.destroy();
      faces.clear();
      el.remove();
      o.onClose();
    },
  };
  return api;
}
