// Host insets: the app's Chief bubble corner keeps the HUD and bubbles out.
import { describe, expect, it } from 'vitest';
import slim from '../../../catalog/generated/slim.js';
import type { OfficeGroup, OfficePerson } from '../types';
import { insetLayout, normInsets } from './insets';
import { createOfficeScene } from './scene';

describe('insetLayout', () => {
  it('reserves the bottom-right corner for {right, bottom}: only the zoom buttons rise above it', () => {
    const l = insetLayout({ right: 88, bottom: 88 }, 1200, 800);
    expect(l.reserved).toEqual([{ x: 1112, y: 712, w: 88, h: 88 }]);
    expect(l.offsets.zoom).toEqual({ x: 0, y: -88 });
    for (const k of ['life', 'seg', 'tools', 'mini', 'follow'] as const) expect(l.offsets[k]).toEqual({ x: 0, y: 0 });
  });

  it('reserves a whole strip for an edge alone, and moves every control on that edge', () => {
    const l = insetLayout({ bottom: 72 }, 400, 800);
    expect(l.reserved).toEqual([{ x: 0, y: 728, w: 400, h: 72 }]);
    expect(l.offsets.zoom).toEqual({ x: 0, y: -72 });
    expect(l.offsets.mini).toEqual({ x: 0, y: -72 });
    expect(l.offsets.follow).toEqual({ x: 0, y: -72 });
    expect(l.offsets.tools).toEqual({ x: 0, y: 0 });
    const side = insetLayout({ left: 60 }, 400, 800);
    expect(side.offsets.life).toEqual({ x: 60, y: 0 });
    expect(side.offsets.mini).toEqual({ x: 60, y: 0 });
  });

  it('ignores missing, zero, negative and non-finite insets', () => {
    expect(normInsets({ top: -4, right: Number.NaN, bottom: 0 })).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    const l = insetLayout(null, 800, 600);
    expect(l.reserved).toEqual([]);
    expect(Object.values(l.offsets).every((o) => o.x === 0 && o.y === 0)).toBe(true);
  });
});

describe('the scene with host insets', () => {
  it('moves the zoom buttons above the reserved corner, and follows setInsets', () => {
    const lead = slim.leads[0]!;
    const people: OfficePerson[] = [
      { id: lead.id, name: lead.name, title: 'Chief of Staff', groupId: 'chief', accent: lead.avatar.accent_color },
      ...slim.personas.map((p) => ({ id: p.id, name: p.name, title: p.title, groupId: p.department, accent: p.avatar.accent_color })),
    ];
    const groups: OfficeGroup[] = slim.departments.map((d) => ({ id: d.id, name: d.name, kind: 'department' as const }));
    const host = document.createElement('div');
    document.body.append(host);
    const s = createOfficeScene(host, { people, groups, leadId: lead.id, assetsBase: null, reducedMotion: true, cameraKey: null, insets: { right: 88, bottom: 88 } });
    expect(s.el.style.getPropertyValue('--hc-o-zoom-y')).toBe('-88px');
    expect(s.el.style.getPropertyValue('--hc-o-mini-y')).toBe('0px');
    s.setInsets({ bottom: 72 });
    expect(s.el.style.getPropertyValue('--hc-o-mini-y')).toBe('-72px');
    s.setInsets(null);
    expect(s.el.style.getPropertyValue('--hc-o-zoom-y')).toBe('0px');
    s.destroy();
    host.remove();
  });
});
