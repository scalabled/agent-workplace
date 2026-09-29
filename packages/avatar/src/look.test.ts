import type { Appearance } from '@headcount/catalog';
import { catalogSlim } from '@headcount/catalog/slim';
import { describe, expect, it } from 'vitest';
import { luminance, toHex } from './color';
import { lookFromAppearance, parseColors, placeholderLook, skinMarks } from './look';
import { STILL_POSE, type FacePose } from './motion';
import { ProceduralRenderer } from './procedural-renderer';
import { asCtx, FakeContext, paths } from './test-utils/fake-canvas';
import { VISEMES } from './visemes';

const base: Appearance = {
  skin_tone: 'medium-deep brown with warm undertones',
  hair: { style: 'gathered into a high bun', texture: 'coily', color: 'black with a few silver strands' },
  head_covering: null,
  facial_hair: null,
  eyewear: null,
  accessories: ['gold drop earrings'],
  attire: 'cream blouse with a patterned wrap scarf in ochre, deep green and cream',
  procedural: { avatar: 2, skinBrightness: 64, skinHue: -6, lipColor: '#6E3A33E0', eyeColor: '#2E1A10', eyeBrowColor: '#1C1410' },
};

describe('lookFromAppearance', () => {
  it('is deterministic for the same record', () => {
    const a = lookFromAppearance({ appearance: base, accent: '#C9982A', name: 'Amara Tesfaye' });
    const b = lookFromAppearance({ appearance: structuredClone(base), accent: '#C9982A', name: 'Amara Tesfaye' });
    expect(a).toEqual(b);
    expect(a.hair.shape).toBe('bun');
    expect(a.hair.bunHigh).toBe(true);
    expect(a.earrings?.kind).toBe('drop');
    expect(a.broad).toBe(false);
  });

  it('orders skin by the catalog brightness and keeps undertones natural', () => {
    const deep = lookFromAppearance({ appearance: { skin_tone: 'deep brown with warm undertones', procedural: { skinBrightness: 52 } }, accent: '#000000', name: 'a' }).skin;
    const mid = lookFromAppearance({ appearance: { skin_tone: 'light olive', procedural: { skinBrightness: 100 } }, accent: '#000000', name: 'b' }).skin;
    const fair = lookFromAppearance({ appearance: { skin_tone: 'fair with rosy undertones', procedural: { skinBrightness: 122 } }, accent: '#000000', name: 'c' }).skin;
    expect(luminance(deep)).toBeLessThan(luminance(mid));
    expect(luminance(mid)).toBeLessThan(luminance(fair));
    for (const s of [deep, mid, fair]) expect(s.r).toBeGreaterThan(s.b); // warm, never grey-blue
    // Without procedural numbers the words still place the tone.
    const words = lookFromAppearance({ appearance: { skin_tone: 'deep brown' }, accent: '#000000', name: 'd' }).skin;
    expect(luminance(words)).toBeLessThan(luminance(mid));
  });

  it('reads garments: outer layer, inner layer and neckline', () => {
    const blazer = lookFromAppearance({ appearance: { attire: 'charcoal blazer over an ivory blouse' }, accent: '#5B3A6B', name: 'x' }).attire;
    expect(blazer.neckline).toBe('open');
    expect(toHex(blazer.outer)).toBe('#3a3d43');
    expect(toHex(blazer.inner!)).toBe('#efe8d6');
    const under = lookFromAppearance({ appearance: { attire: 'light-blue shirt under a navy blazer' }, accent: '#5B3A6B', name: 'y' }).attire;
    expect(toHex(under.outer)).toBe('#243352');
    expect(under.innerCollar).toBe(true);
    expect(lookFromAppearance({ appearance: { attire: 'fitted black turtleneck' }, accent: '#000', name: 'z' }).attire.neckline).toBe('turtleneck');
    expect(lookFromAppearance({ appearance: { attire: 'oversized heather-grey hoodie, hood down' }, accent: '#000', name: 'w' }).attire.neckline).toBe('hood');
    expect(lookFromAppearance({ appearance: { attire: 'navy-and-white striped long-sleeve top' }, accent: '#000', name: 'v' }).attire.striped).not.toBeNull();
  });

  it('parses colour words with modifiers and compounds', () => {
    expect(parseColors('navy-and-white').map(toHex)).toEqual(['#243352', '#f3f2ee']);
    const [light] = parseColors('light gray');
    expect(luminance(light!)).toBeGreaterThan(luminance(parseColors('gray')[0]!));
    expect(parseColors('sunflower-yellow')).toHaveLength(1);
    expect(parseColors('off-white linen').map(toHex)).toEqual(['#ebe7dc']);
    expect(parseColors(null)).toEqual([]);
  });

  it('covers, beards, glasses and accessories', () => {
    const hijab = lookFromAppearance({ appearance: { head_covering: 'dusty-rose hijab, wrapped to leave the face, jaw and chin clear', hair: { style: 'covered by a hijab', color: 'not visible' } }, accent: '#000', name: 'h' });
    expect(hijab.covering?.kind).toBe('hijab');
    expect(hijab.hair.shape).toBe('none');
    const beard = lookFromAppearance({ appearance: { facial_hair: 'full salt-and-pepper beard trimmed close, moustache above the upper lip', hair: { style: 'short', color: 'black' } }, accent: '#000', name: 'b' });
    expect(beard.facialHair).toMatchObject({ kind: 'beard', full: true, moustache: true });
    expect(lookFromAppearance({ appearance: { facial_hair: 'light stubble, lips fully visible' }, accent: '#000', name: 's' }).facialHair?.kind).toBe('stubble');
    const glasses = lookFromAppearance({ appearance: { eyewear: 'round tortoiseshell glasses with clear lenses' }, accent: '#000', name: 'g' }).eyewear;
    expect(glasses).toMatchObject({ shape: 'round', rimless: false, clear: false });
    const acc = lookFromAppearance({ appearance: { accessories: ['small gold nose stud', 'thin gold chain', 'cornflower-blue enamel lapel pin', 'lavender behind-the-ear hearing aid on the left ear'] }, accent: '#000', name: 'a' });
    expect(acc.noseStud).not.toBeNull();
    expect(acc.necklace).not.toBeNull();
    expect(acc.chestAccent?.kind).toBe('pin');
    expect(acc.hearingAid?.side).toBe('left');
    expect(lookFromAppearance({ appearance: { accessories: ['small silver hoop in one ear'] }, accent: '#000', name: 'e' }).earrings).toMatchObject({ kind: 'hoop', sides: 'right' });
  });

  it('the placeholder is a monochrome sketch', () => {
    const p = placeholderLook('New hire');
    expect(p.facialHair).toBeNull();
    expect(p.blushAlpha).toBe(0);
    expect(Math.abs(p.skin.r - p.skin.b)).toBeLessThan(20);
  });
});

describe('ProceduralRenderer', () => {
  const style = lookFromAppearance({ appearance: base, accent: '#C9982A', name: 'Amara Tesfaye' });
  const pose = (extra: Partial<FacePose> = {}): FacePose => ({ ...STILL_POSE, ...extra });

  it('draws a closed mouth at rest and a dark cavity with teeth when open', () => {
    const r = new ProceduralRenderer(style);
    const rest = new FakeContext();
    r.render(asCtx(rest), pose());
    const restGradients = rest.ops.filter((o) => o.kind === 'gradient' && o.stops!.some(([, c]) => c.startsWith('rgba(29, 11, 15')));
    expect(restGradients, 'no cavity at rest').toHaveLength(0);
    const open = new FakeContext();
    r.render(asCtx(open), pose({ mouth: { ...VISEMES.OPEN_WIDE } }));
    const cavity = open.ops.find((o) => o.kind === 'gradient' && o.stops!.some(([, c]) => c.startsWith('rgba(29, 11, 15')));
    expect(cavity, 'an open mouth has a dark cavity').toBeTruthy();
    expect(open.ops.some((o) => o.kind === 'fill' && o.style === 'rgba(246, 241, 232, 0.95)'), 'upper teeth show').toBe(true);
  });

  it('opens wider for OPEN_WIDE than OPEN_SMALL (the sampler drives it)', () => {
    const r = new ProceduralRenderer(style);
    const height = (mouth: typeof VISEMES.OPEN_WIDE) => {
      const ctx = new FakeContext();
      r.render(asCtx(ctx), pose({ mouth: { ...mouth } }));
      const idx = ctx.ops.findIndex((o) => o.kind === 'gradient' && o.stops!.some(([, c]) => c.startsWith('rgba(29, 11, 15')));
      const g = ctx.ops[idx]!;
      return g.args[3]! - g.args[1]!;
    };
    expect(height(VISEMES.OPEN_WIDE)).toBeGreaterThan(height(VISEMES.OPEN_SMALL) * 1.8);
  });

  it('closes the eyes on a blink and moves the gaze with the pose', () => {
    const r = new ProceduralRenderer(style);
    const eyes = (p: FacePose) => {
      const ctx = new FakeContext();
      r.render(asCtx(ctx), p);
      return ctx.ops.filter((o) => o.kind === 'ellipse' && o.args[2]! > 4 && o.args[2]! < 7 && o.args[3]! > 4);
    };
    const open = eyes(pose());
    expect(open).toHaveLength(2);
    expect(eyes(pose({ blink: 1 }))).toHaveLength(0);
    const look = eyes(pose({ lookX: 1 }));
    expect(look[0]!.args[0]!).toBeGreaterThan(open[0]!.args[0]!);
  });

  it('renders every catalog lead and coworker without throwing', () => {
    const people = [...catalogSlim.leads.map((l) => ({ name: l.name, avatar: l.avatar })), ...catalogSlim.personas.map((p) => ({ name: p.name, avatar: p.avatar }))];
    expect(people.length).toBeGreaterThan(100);
    const shapes = new Set<string>();
    for (const person of people) {
      const look = lookFromAppearance({ appearance: person.avatar.appearance, accent: person.avatar.accent_color, name: person.name });
      shapes.add(look.hair.shape);
      const ctx = new FakeContext();
      const r = new ProceduralRenderer(look);
      r.render(asCtx(ctx), pose({ mouth: { ...VISEMES.OPEN_MED }, yaw: 0.3, lean: 0.5, blink: 0.4 }));
      r.render(asCtx(ctx), pose(), undefined, { dark: true });
      expect(ctx.count('save')).toBe(ctx.count('restore'));
      expect(paths(ctx.ops).length).toBeGreaterThan(10);
    }
    expect(shapes.size, 'the catalog spans many hair shapes').toBeGreaterThanOrEqual(8);
  });

  it('balances save/restore under every covering and hair shape', () => {
    for (const covering of ['patterned teal hijab', 'neatly tied navy blue turban', 'vibrant orange, turquoise and gold patterned headwrap', 'white knitted kufi cap', 'fitted black knit beanie', 'white cap with fine embroidered patterns']) {
      const ctx = new FakeContext();
      new ProceduralRenderer(lookFromAppearance({ appearance: { ...base, head_covering: covering }, accent: '#2A9D8F', name: covering })).render(asCtx(ctx), pose());
      expect(ctx.count('save')).toBe(ctx.count('restore'));
    }
  });
});

describe('hair length from "on top" phrasing', () => {
  const hairOf = (style: string, texture = 'straight') => lookFromAppearance({ appearance: { ...base, hair: { style, texture, color: 'dark brown' } }, accent: '#C9982A', name: 'Test Person' }).hair.shape;

  it.each([
    ['short, neatly cut, slightly longer on top', 'short'],
    ['short at the sides, longer on top, swept back', 'swept'],
    ['undercut, short sides, longer on top swept to one side', 'swept'],
    ['tousled undercut, longer on top and swept to one side', 'swept'],
    ['wavy, slightly tousled, medium length on top', 'short'],
    ['long, loose waves past the shoulders', 'long'],
    ['shoulder-length, layered', 'shoulder'],
  ])('%s → %s', (style, shape) => expect(hairOf(style)).toBe(shape));

  it('keeps short curls short', () => {
    expect(hairOf('short curls, slightly longer on top', 'tightly curled')).toBe('curlyShort');
    expect(hairOf('medium-length curls on top, shorter at the sides', 'curly')).toBe('curlyShort');
    expect(hairOf('shoulder-length curls', 'curly')).toBe('curlyLong');
  });

  it('never gives a catalog "on top" cut long hair', () => {
    const onTop = [...catalogSlim.leads, ...catalogSlim.personas].filter((p) => /\bon top\b/i.test(p.avatar.appearance.hair?.style ?? ''));
    expect(onTop.length).toBeGreaterThan(5);
    for (const p of onTop) {
      const shape = lookFromAppearance({ appearance: p.avatar.appearance, accent: p.avatar.accent_color, name: p.name }).hair.shape;
      expect([p.name, shape]).not.toEqual([p.name, expect.stringMatching(/^(long|shoulder|curlyLong)$/)]);
    }
  });
});

describe('complexion marks follow the catalog side and place', () => {
  it('puts the wearer\'s left on the viewer\'s right and names the places', () => {
    expect(skinMarks(['lighter patches of vitiligo at the left temple and around the left eye'], /vitiligo/, -1)).toEqual([
      { anchor: 'temple', side: 1 },
      { anchor: 'eye', side: 1 },
    ]);
    expect(skinMarks(['vitiligo patches around both eyes', 'vitiligo on the side of the neck'], /vitiligo/, -1)).toEqual([
      { anchor: 'eye', side: 0 },
      { anchor: 'neck', side: -1 },
    ]);
    expect(skinMarks(['small beauty mark near the left eyebrow'], /beauty mark/, -1)).toEqual([{ anchor: 'eyebrow', side: 1 }]);
    expect(skinMarks(['small beauty mark near the left cheekbone'], /beauty mark/, -1)).toEqual([{ anchor: 'cheekbone', side: 1 }]);
  });

  it('draws nothing when no place is recognised (never a fixed stain)', () => {
    expect(skinMarks(['vitiligo'], /vitiligo/, 1)).toEqual([]);
    const look = lookFromAppearance({ appearance: { ...base, complexion_details: ['a beauty mark'] }, accent: '#C9982A', name: 'Test Person' });
    expect(look.beautyMark).toBeNull();
  });

  it('places the catalog\'s marks on the named side of the drawn face', () => {
    const lead = catalogSlim.leads.find((l) => l.id === 'lead-steady-operator');
    expect(lead, 'lead-steady-operator is in the slim catalog').toBeDefined();
    if (!lead) return;
    const look = lookFromAppearance({ appearance: lead.avatar.appearance, accent: lead.avatar.accent_color, name: lead.name });
    expect(look.vitiligo.map((m) => m.side)).toEqual(expect.arrayContaining([1]));
    const ctx = new FakeContext();
    new ProceduralRenderer(look).render(asCtx(ctx), STILL_POSE, { scale: 1, x: 0, y: 0 });
    // Temple patch (r 10 → 10 × 7.5) and eye patch (r 12 → 12 × 9): both on the viewer's right (x > centre 150).
    const patches = ctx.ops.filter((o) => o.kind === 'ellipse' && ((o.args[2] === 10 && o.args[3] === 7.5) || (o.args[2] === 12 && o.args[3] === 9)));
    expect(patches).toHaveLength(2);
    expect(patches.every((o) => o.args[0]! > 150)).toBe(true);
  });
});
