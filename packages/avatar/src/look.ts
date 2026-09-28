// Deterministic catalog appearance → illustrated-face style. Reads the descriptive fields (skin
// tone, hair, head covering, facial hair, eyewear, accessories, attire, complexion details) and
// the oncloudnine procedural look numbers (catalog `appearance.procedural`, after OC
// persona/Modules/PersonaSettings.ts) and never guesses at random: the same record always yields
// the same face, and every field only ever changes a small, tasteful detail.
import type { Appearance } from '@headcount/catalog';
import { darken, desaturate, hash32, hueRotate, lighten, mix, parseHex, seededRandom, type Rgba } from './color';

export type HairShape =
  | 'none'
  | 'buzz'
  | 'short'
  | 'swept'
  | 'pixie'
  | 'curlyShort'
  | 'puff'
  | 'bun'
  | 'bob'
  | 'shoulder'
  | 'long'
  | 'curlyLong'
  | 'braids'
  | 'singleBraid';

export interface HairLook {
  shape: HairShape;
  color: Rgba;
  texture: 'straight' | 'wavy' | 'curly' | 'coily' | 'strands';
  part: 'left' | 'right' | 'center' | 'none';
  fringe: boolean;
  receding: boolean;
  bunHigh: boolean;
  /** Long styles tucked behind the ears (ears and earrings stay visible). */
  tucked: boolean;
  streak: Rgba | null;
  tips: Rgba | null;
  temples: Rgba | null;
}

export type CoveringKind = 'hijab' | 'turban' | 'headwrap' | 'kufi' | 'cap' | 'beanie';
export interface CoveringLook {
  kind: CoveringKind;
  colors: Rgba[];
  patterned: boolean;
}

export interface FacialHairLook {
  kind: 'beard' | 'goatee' | 'stubble' | 'moustache';
  full: boolean;
  moustache: boolean;
  color: Rgba;
}

export interface EyewearLook {
  shape: 'round' | 'rect' | 'oval';
  color: Rgba;
  weight: number;
  rimless: boolean;
  clear: boolean;
  size: number;
}

export interface EarringLook {
  kind: 'stud' | 'hoop' | 'drop';
  color: Rgba;
  sides: 'both' | 'left' | 'right';
}

export type Neckline = 'crew' | 'vneck' | 'open' | 'collar' | 'turtleneck' | 'hood';

export interface AttireLook {
  outer: Rgba;
  inner: Rgba | null;
  neckline: Neckline;
  /** Inner garment is a collared shirt (small collar points under a jacket). */
  innerCollar: boolean;
  striped: Rgba | null;
  print: Rgba[] | null;
}

export interface ProceduralStyle {
  seed: number;
  name: string;
  accent: Rgba;
  skin: Rgba;
  skinLight: Rgba;
  skinShade: Rgba;
  blush: Rgba;
  blushAlpha: number;
  lip: Rgba;
  lipShade: Rgba;
  iris: Rgba;
  lash: Rgba;
  brow: Rgba;
  browWeight: number;
  hair: HairLook;
  covering: CoveringLook | null;
  facialHair: FacialHairLook | null;
  eyewear: EyewearLook | null;
  earrings: EarringLook | null;
  noseStud: Rgba | null;
  necklace: { color: Rgba; pendant: boolean } | null;
  chestAccent: { color: Rgba; kind: 'pin' | 'square' } | null;
  tie: Rgba | null;
  hearingAid: { color: Rgba; side: 'left' | 'right' } | null;
  attire: AttireLook;
  /** Broader shoulders and jaw (OC avatar index 0/1) vs narrower (2/3). */
  broad: boolean;
  eyeSpacing: number;
  eyeSize: number;
  mouthWidth: number;
  mouthSize: number;
  lipFullness: number;
  noseSize: number;
  noseWidth: number;
  showNose: boolean;
  freckles: boolean;
  /** Where the catalog puts a beauty mark (viewer space), or null when none or no place is named. */
  beautyMark: SkinMark | null;
  /** Vitiligo patches where the catalog puts them (viewer space); empty when none or no place is named. */
  vitiligo: SkinMark[];
  laughLines: boolean;
  /** −1 … 1 small deterministic asymmetry (brow height, part side). */
  asym: number;
}

/** A place on the face or neck named by `complexion_details`. */
export type MarkAnchor = 'temple' | 'eye' | 'eyebrow' | 'cheekbone' | 'cheek' | 'mouth' | 'chin' | 'jaw' | 'forehead' | 'neck';

/** A mark in viewer space: side −1 is the viewer's left, 1 the viewer's right, 0 both sides. */
export interface SkinMark {
  anchor: MarkAnchor;
  side: -1 | 0 | 1;
}

const MARK_ANCHORS: [MarkAnchor, RegExp][] = [
  ['temple', /\btemples?\b/],
  ['eyebrow', /\b(eye)?brows?\b/],
  ['eye', /\beyes?\b|\beyelids?\b/],
  ['cheekbone', /\bcheekbones?\b/],
  ['cheek', /\bcheeks?\b/],
  ['mouth', /\bmouth\b|\blips?\b/],
  ['chin', /\bchin\b/],
  ['jaw', /\bjaw(line)?\b/],
  ['forehead', /\bforehead\b|\bhairline\b/],
  ['neck', /\bneck\b|\bthroat\b/],
];

/**
 * Marks named in complexion details matching `kind`, placed where the text says. The wearer's left is the
 * viewer's right (as for ear accessories). A detail with no place a face can show yields nothing, never a guess.
 */
export function skinMarks(details: readonly string[], kind: RegExp, fallbackSide: -1 | 1): SkinMark[] {
  const out: SkinMark[] = [];
  for (const raw of details) {
    const d = raw.toLowerCase();
    if (!kind.test(d)) continue;
    const side: SkinMark['side'] = /\bboth\b/.test(d) ? 0 : /\bleft\b/.test(d) ? 1 : /\bright\b/.test(d) ? -1 : fallbackSide;
    for (const [anchor, re] of MARK_ANCHORS) if (re.test(d) && !out.some((m) => m.anchor === anchor)) out.push({ anchor, side });
  }
  return out;
}

// ── colour vocabulary ─────────────────────────────────────────────────────────

const C = (hex: string): Rgba => parseHex(hex)!;

/** Garment / accessory colour words. */
const COLOR_WORDS: Record<string, string> = {
  black: '#222326',
  charcoal: '#3a3d43',
  graphite: '#44474d',
  slate: '#5c6572',
  gray: '#8c9097',
  grey: '#8c9097',
  silver: '#c4c7cc',
  white: '#f3f2ee',
  ivory: '#efe8d6',
  cream: '#ece3cd',
  offwhite: '#ebe7dc',
  beige: '#d8c6a7',
  oat: '#d6cbb3',
  oatmeal: '#d6cbb3',
  sand: '#d0bb95',
  camel: '#bf9868',
  tan: '#c5a079',
  khaki: '#b3a378',
  taupe: '#978776',
  brown: '#6a4a34',
  chocolate: '#4d3326',
  chestnut: '#7a492c',
  rust: '#a2502c',
  terracotta: '#b5603f',
  copper: '#b46f40',
  bronze: '#9a7a3e',
  ochre: '#c28b30',
  mustard: '#c89f2e',
  gold: '#c9a44e',
  golden: '#c9a44e',
  yellow: '#e0bf45',
  sunflower: '#e7b52f',
  saffron: '#df9f31',
  amber: '#d09936',
  marigold: '#e3a032',
  orange: '#dc7a30',
  coral: '#e2735f',
  peach: '#eab394',
  salmon: '#df8b77',
  red: '#bf3a2e',
  crimson: '#a62533',
  scarlet: '#c0302a',
  burgundy: '#782436',
  claret: '#732330',
  maroon: '#6b2331',
  wine: '#6c2739',
  plum: '#5a3a69',
  purple: '#6b4a8b',
  violet: '#7a5ea6',
  lavender: '#b6a5d4',
  lilac: '#c1a8d2',
  mauve: '#a78299',
  pink: '#e39ab2',
  rose: '#cd7f8e',
  blush: '#e5b2ae',
  magenta: '#b5387a',
  fuchsia: '#c2407f',
  navy: '#243352',
  indigo: '#353b78',
  midnight: '#212c45',
  cobalt: '#2f5ab6',
  blue: '#4070b4',
  cornflower: '#6e8ed6',
  sky: '#8bb6de',
  denim: '#4f6c8d',
  chambray: '#7b94b3',
  teal: '#2b8a88',
  turquoise: '#37b0ad',
  aqua: '#5fc3c1',
  mint: '#a3d6bf',
  sage: '#9db198',
  olive: '#6e7344',
  moss: '#6a7940',
  green: '#3f7d4f',
  forest: '#2f593d',
  emerald: '#2d8961',
  jade: '#4e9879',
  lime: '#a6c44b',
  pearl: '#f1ece2',
  wood: '#8a6340',
  wooden: '#8a6340',
  brass: '#b8963f',
};

const HAIR_WORDS: Record<string, string> = {
  black: '#1d1a19',
  dark: '#2b211c',
  brown: '#583b28',
  chestnut: '#6c3b23',
  auburn: '#7a3a20',
  copper: '#a9552b',
  red: '#963a22',
  ginger: '#ad5a2e',
  honey: '#b4844a',
  blond: '#c7a468',
  blonde: '#c7a468',
  golden: '#c79f55',
  sandy: '#b69669',
  ash: '#aa9e89',
  platinum: '#e4ddca',
  bleached: '#e1d9c4',
  gray: '#8e8c89',
  grey: '#8e8c89',
  silver: '#b8b9bc',
  white: '#e5e3de',
  teal: '#2f8f8c',
  purple: '#6a4b98',
  pink: '#e4a0b7',
  salt: '#9c9a96',
  pepper: '#3a3634',
};

const MODIFIERS: Record<string, (c: Rgba) => Rgba> = {
  light: (c) => lighten(c, 0.32),
  pale: (c) => lighten(c, 0.4),
  soft: (c) => lighten(c, 0.22),
  pastel: (c) => lighten(desaturate(c, 0.15), 0.45),
  washed: (c) => lighten(desaturate(c, 0.2), 0.2),
  faded: (c) => lighten(desaturate(c, 0.25), 0.18),
  dusty: (c) => lighten(desaturate(c, 0.3), 0.08),
  muted: (c) => desaturate(c, 0.35),
  heather: (c) => mix(c, C('#9a9ca1'), 0.4),
  dark: (c) => darken(c, 0.3),
  deep: (c) => darken(c, 0.28),
  rich: (c) => darken(c, 0.14),
  bright: (c) => c,
  vivid: (c) => c,
  vibrant: (c) => c,
  mid: (c) => c,
};

const tokens = (text: string) =>
  text
    .toLowerCase()
    .replace(/off-white/g, 'offwhite')
    .split(/[^a-z]+/)
    .filter(Boolean);

/**
 * Colours named in `text`, in order. Modifiers apply to the next colour; adjacent colour words
 * blend into one ("sky-blue", "sunflower-yellow"); "and"/commas separate colours.
 */
export function parseColors(text: string | null | undefined, table: Record<string, string> = COLOR_WORDS): Rgba[] {
  if (!text) return [];
  const out: Rgba[] = [];
  let pending: ((c: Rgba) => Rgba)[] = [];
  let prevWasColor = false;
  for (const t of tokens(text)) {
    const hex = table[t];
    if (hex) {
      let c = C(hex);
      for (const m of pending) c = m(c);
      pending = [];
      if (prevWasColor && out.length) out[out.length - 1] = mix(out[out.length - 1]!, c, 0.5);
      else out.push(c);
      prevWasColor = true;
      continue;
    }
    prevWasColor = false;
    const mod = MODIFIERS[t];
    if (mod) pending.push(mod);
    else pending = [];
  }
  return out;
}

const has = (text: string | null | undefined, re: RegExp) => !!text && re.test(text.toLowerCase());

// ── skin ─────────────────────────────────────────────────────────────────────

/** Deep → fair ramp of natural skin colours, indexed by OC skinBrightness (45–130). */
const SKIN_RAMP = ['#3b2319', '#583524', '#774a32', '#966345', '#b5805e', '#cf9f80', '#e3bc9f', '#f1d4bf'].map(C);

function rampAt(t: number): Rgba {
  const x = Math.max(0, Math.min(1, t)) * (SKIN_RAMP.length - 1);
  const i = Math.min(SKIN_RAMP.length - 2, Math.floor(x));
  return mix(SKIN_RAMP[i]!, SKIN_RAMP[i + 1]!, x - i);
}

const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) && v !== 0 ? v : fallback);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function skinFrom(appearance: Appearance): Rgba {
  const p = appearance.procedural ?? {};
  const text = (appearance.skin_tone ?? '').toLowerCase();
  let brightness = num(p.skinBrightness, NaN);
  if (!Number.isFinite(brightness)) {
    // No procedural numbers: estimate from the words.
    brightness = /deep|dark/.test(text) ? 58 : /medium-deep/.test(text) ? 66 : /medium/.test(text) ? 80 : /tan|olive|light brown/.test(text) ? 94 : /fair|pale|light/.test(text) ? 114 : 100;
  }
  let c = rampAt((clamp(brightness, 40, 135) - 45) / 85);
  if (/cool|pink|rosy|ruddy/.test(text)) c = hueRotate(c, -5);
  if (/olive/.test(text)) c = desaturate(hueRotate(c, 6), 0.1);
  if (/golden/.test(text)) c = hueRotate(c, 3);
  c = hueRotate(c, clamp(num(p.skinHue, 0), -25, 25) * 0.3);
  c = desaturate(c, clamp(num(p.skinGrayScale, 0), 0, 60) / 100 * 0.6);
  return c;
}

// ── hair ─────────────────────────────────────────────────────────────────────

function hairColorFrom(text: string, fallback: Rgba): { color: Rgba; streak: Rgba | null; tips: Rgba | null; temples: Rgba | null } {
  const lower = text.toLowerCase();
  const clauses = lower.split(/\bwith\b|,|;|\bgoing\b|\bgraying\b|\bgreying\b|\bflecked\b/);
  const main = parseColors(clauses[0] ?? '', HAIR_WORDS);
  let color = main[0] ?? fallback;
  if (main.length > 1 && /\band\b/.test(clauses[0] ?? '')) color = mix(main[0]!, main[1]!, 0.35);
  if (/salt-and-pepper|salt and pepper/.test(lower) && !/sides|temples/.test(lower)) color = C('#6d6a66');
  let streak: Rgba | null = null;
  let tips: Rgba | null = null;
  let temples: Rgba | null = null;
  const grayish = parseColors('gray', HAIR_WORDS)[0]!;
  for (const clause of clauses.slice(1)) {
    const cs = parseColors(clause, HAIR_WORDS);
    const tint = cs[0] ?? (/(gray|grey|silver)/.test(clause) ? grayish : null);
    if (/streak/.test(clause) && tint) streak = tint;
    else if (/tips/.test(clause) && tint) tips = tint;
    else if (/temple|sides/.test(clause)) temples = tint ?? grayish;
    else if (/strand|a little|few/.test(clause) && tint) color = mix(color, tint, 0.18);
    else if (tint) color = mix(color, tint, 0.3);
  }
  if (/temples/.test(lower) && !temples) temples = grayish;
  if (/sun-lightened|honey-toned/.test(lower)) color = lighten(color, 0.1);
  return { color, streak, tips, temples };
}

function hairShapeFrom(style: string, texture: string, covered: boolean): Pick<HairLook, 'shape' | 'texture' | 'fringe' | 'receding' | 'bunHigh' | 'tucked'> & { partHint: HairLook['part'] | null } {
  const s = style.toLowerCase();
  const tx = `${texture} ${s}`.toLowerCase();
  const textureKind: HairLook['texture'] = /braid|locs|twist/.test(tx) ? 'strands' : /coil|afro|kink/.test(tx) ? 'coily' : /curl|curly|puff/.test(tx) ? 'curly' : /wav/.test(tx) ? 'wavy' : 'straight';
  const partHint: HairLook['part'] | null = /center[- ]part/.test(s) ? 'center' : /\bright\b/.test(s) && /part|swept|side/.test(s) ? 'right' : /\bleft\b/.test(s) && /part|swept|side/.test(s) ? 'left' : null;
  const base = {
    texture: textureKind,
    fringe: /bang|fringe|cut above the brows/.test(s),
    receding: /reced/.test(s),
    bunHigh: /high|top|crown/.test(s),
    tucked: /tucked|behind (the|one) ear|behind the shoulders|pushed back|kept back|off the (face|forehead)|pulled back|gathered/.test(s),
    partHint,
  };
  // "Short at the sides, longer on top" is a short cut: the length words of an "on top" clause describe the
  // crown, never the overall length, and "longer" is not "long" (word boundaries throughout).
  const lengthText = s.replace(/[^,;]*\bon top\b[^,;]*/g, ' ');
  const shortSides = /\bundercut\b|\b(short|shorter|faded|fade|tapered|shaved|clipped)\b[^,;]*\bsides?\b|\bshort sides\b/.test(s);
  let shape: HairShape;
  if (covered || /covered by|not visible/.test(s)) shape = 'none';
  else if (/shaved|bald/.test(s)) shape = 'none';
  else if (/\bbun\b|chignon|top ?knot|ponytail/.test(s)) shape = 'bun';
  else if (/puff|afro/.test(s)) shape = 'puff';
  else if (/single braid/.test(s)) shape = 'singleBraid';
  else if (/braids|locs/.test(s) && /long|shoulder|past|behind the shoulders|falling/.test(s)) shape = 'braids';
  else if (/buzz|close-cropped|close cropped|fade|crew cut/.test(s)) shape = 'buzz';
  else if (/pixie/.test(s)) shape = 'pixie';
  else if (/\bbob\b/.test(s)) shape = 'bob';
  else if (/curl|curly|coil|twist|springy|voluminous/.test(s) || textureKind === 'coily' || (textureKind === 'curly' && !/straight/.test(s)))
    shape = !shortSides && /shoulder|\blong\b|past|voluminous|full, loose|medium-length/.test(lengthText) ? 'curlyLong' : 'curlyShort';
  else if (!shortSides && /\blong\b|past the shoulders|waist/.test(lengthText)) shape = 'long';
  else if (!shortSides && /shoulder|chin-length|medium length|medium-length|layered/.test(lengthText)) shape = 'shoulder';
  else if (/swept back|combed back|slicked|undercut|swept to one side|swept/.test(s)) shape = 'swept';
  else shape = 'short';
  return { shape, ...base };
}

// ── garments and accessories ─────────────────────────────────────────────────

const OUTER_GARMENT = /blazer|jacket|suit|cardigan|coat|vest|overshirt|bomber|fleece|gilet|waistcoat/;

function attireFrom(text: string | undefined, accent: Rgba): AttireLook {
  const t = (text ?? '').toLowerCase();
  const clauses = t.split(/\bover\b|\bunder\b|\bwith\b|\bbeneath\b|,|;/).map((c) => c.trim()).filter(Boolean);
  const colorOf = (clause: string) => parseColors(clause)[0] ?? null;
  let outerClause: string | undefined = clauses.find((c) => OUTER_GARMENT.test(c));
  let innerClause: string | undefined;
  if (/\bunder\b/.test(t) && clauses.length >= 2 && !outerClause) {
    innerClause = clauses[0];
    outerClause = clauses[1];
  } else if (outerClause) innerClause = clauses.find((c) => c !== outerClause && colorOf(c));
  else {
    outerClause = clauses[0];
    innerClause = clauses.length > 1 && /\bover\b/.test(t) ? clauses[1] : undefined;
  }
  // "open over a tee" (overshirt/hoodie without an OUTER word) still layers.
  if (!innerClause && /\bover\b/.test(t) && clauses.length >= 2) innerClause = clauses[1];
  const outer = colorOf(outerClause ?? t) ?? parseColors(t)[0] ?? mix(accent, C('#4a4f57'), 0.55);
  const inner = innerClause ? colorOf(innerClause) : null;
  const layered = !!outerClause && OUTER_GARMENT.test(outerClause) && !!inner;
  const base = outerClause ?? t;
  let neckline: Neckline;
  if (/turtleneck|roll-neck|roll neck|high-neck|high neck|mock neck/.test(t) && !layered) neckline = 'turtleneck';
  else if (/hoodie|hood/.test(base)) neckline = 'hood';
  else if (layered) neckline = 'open';
  else if (/v-neck|v neck|wrap/.test(base)) neckline = 'vneck';
  else if (/shirt|button|oxford|polo|collar|blouse/.test(base) && !/t-shirt|tee/.test(base)) neckline = 'collar';
  else neckline = 'crew';
  const striped = /stripe/.test(t) ? (parseColors(t)[1] ?? lighten(outer, 0.6)) : null;
  const printColors = /floral|print|pattern|paisley/.test(t) ? parseColors(t).slice(1, 4) : [];
  return {
    outer,
    inner: layered || neckline === 'hood' ? (inner ?? lighten(outer, 0.5)) : inner,
    neckline,
    innerCollar: !!innerClause && /shirt|button|oxford|collar/.test(innerClause) && !/t-shirt|tee/.test(innerClause),
    striped,
    print: printColors.length ? printColors : null,
  };
}

const METAL: Record<string, string> = { gold: '#d4b04a', silver: '#c9ccd2', pearl: '#f2eee6', brass: '#b8963f', platinum: '#dcdcdc' };
const metalOf = (text: string, fallback = '#d4b04a'): Rgba => {
  for (const [k, v] of Object.entries(METAL)) if (text.includes(k)) return C(v);
  return parseColors(text)[0] ?? C(fallback);
};

// ── the style ────────────────────────────────────────────────────────────────

export interface LookInput {
  appearance: Appearance;
  accent: string;
  name: string;
}

/** Build the illustrated-face style for a catalog appearance. Pure and deterministic. */
export function lookFromAppearance({ appearance, accent, name }: LookInput): ProceduralStyle {
  const a = appearance ?? {};
  const p = a.procedural ?? {};
  const seed = hash32(`${name}|${a.alt_text ?? ''}`);
  const rand = seededRandom(seed);
  const accentRgb = parseHex(accent) ?? C('#8a8f98');

  const skin = skinFrom(a);
  const skinLum = (skin.r + skin.g + skin.b) / 765;
  const skinText = `${a.skin_tone ?? ''} ${(a.complexion_details ?? []).join(' ')}`.toLowerCase();
  const flush = /rosy|ruddy|flush|pink/.test(skinText);

  const covText = (a.head_covering ?? '').toLowerCase();
  const coveringKind: CoveringKind | null = !covText
    ? null
    : /hijab|scarf/.test(covText)
      ? 'hijab'
      : /turban|dastar|pagri/.test(covText)
        ? 'turban'
        : /wrap|gele|duku/.test(covText)
          ? 'headwrap'
          : /kufi|taqiyah|kippah|yarmulke/.test(covText)
            ? 'kufi'
            : /beanie|knit/.test(covText)
              ? 'beanie'
              : /cap|hat/.test(covText)
                ? 'cap'
                : 'headwrap';
  const covering: CoveringLook | null = coveringKind
    ? { kind: coveringKind, colors: parseColors(covText).length ? parseColors(covText) : [mix(accentRgb, C('#5b5f66'), 0.4)], patterned: /pattern|print|wax/.test(covText) }
    : null;

  const hairText = a.hair ?? {};
  const browFallback = parseHex(typeof p.eyeBrowColor === 'string' ? p.eyeBrowColor : null) ?? darken(skin, 0.6);
  const hc = hairColorFrom(hairText.color ?? '', browFallback);
  const shape = hairShapeFrom(hairText.style ?? '', hairText.texture ?? '', coveringKind === 'hijab' || coveringKind === 'turban' || coveringKind === 'headwrap');
  const partSide: HairLook['part'] = shape.partHint ?? (/part/.test((hairText.style ?? '').toLowerCase()) || shape.shape === 'swept' || shape.shape === 'pixie' ? (rand() < 0.5 ? 'left' : 'right') : 'none');
  const hair: HairLook = {
    shape: shape.shape,
    color: /shaved/.test((hairText.color ?? '').toLowerCase()) ? browFallback : hc.color,
    texture: shape.texture,
    part: partSide,
    fringe: shape.fringe,
    receding: shape.receding,
    bunHigh: shape.bunHigh,
    tucked: shape.tucked,
    streak: hc.streak,
    tips: hc.tips,
    temples: hc.temples,
  };

  const fhText = (a.facial_hair ?? '').toLowerCase();
  let facialHair: FacialHairLook | null = null;
  if (fhText && !/^clean-shaven$/.test(fhText.trim())) {
    const fhColor = parseColors(fhText, HAIR_WORDS)[0] ?? (/salt-and-pepper/.test(fhText) ? C('#6d6a66') : hair.shape === 'none' ? browFallback : hair.color);
    if (/goatee/.test(fhText)) facialHair = { kind: 'goatee', full: false, moustache: true, color: fhColor };
    else if (/beard/.test(fhText)) facialHair = { kind: 'beard', full: /full/.test(fhText), moustache: !/no moustache|no mustache/.test(fhText), color: fhColor };
    else if (/stubble|shadow/.test(fhText)) facialHair = { kind: 'stubble', full: false, moustache: false, color: fhColor };
    else if (/moustache|mustache/.test(fhText)) facialHair = { kind: 'moustache', full: false, moustache: true, color: fhColor };
  }

  const ewText = (a.eyewear ?? '').toLowerCase();
  let eyewear: EyewearLook | null = null;
  if (ewText) {
    const clear = /clear-framed|clear frames|clear round|transparent/.test(ewText);
    const color = /tortoise/.test(ewText)
      ? /dark/.test(ewText)
        ? C('#4a2e1d')
        : C('#6f4528')
      : clear
        ? C('#d6dbe0')
        : /gold/.test(ewText)
          ? C('#c9a44e')
          : /silver|wire|metal/.test(ewText)
            ? C('#aeb3ba')
            : (parseColors(ewText.replace(/clear lenses|clear, glare-free lenses|lenses/g, ''))[0] ?? C('#26272b'));
    eyewear = {
      shape: /round|circular/.test(ewText) ? 'round' : /oval/.test(ewText) ? 'oval' : 'rect',
      color,
      weight: /bold|statement|thick|oversized/.test(ewText) ? 2.8 : /thin|wire|rimless|fine/.test(ewText) ? 1.2 : 1.9,
      rimless: /rimless/.test(ewText),
      clear,
      size: /oversized/.test(ewText) ? 1.18 : 1,
    };
  }

  let earrings: EarringLook | null = null;
  let noseStud: Rgba | null = null;
  let necklace: ProceduralStyle['necklace'] = null;
  let chestAccent: ProceduralStyle['chestAccent'] = null;
  let tie: Rgba | null = null;
  let hearingAid: ProceduralStyle['hearingAid'] = null;
  for (const raw of a.accessories ?? []) {
    if (!raw) continue;
    const t = raw.toLowerCase();
    if (/hearing aid/.test(t)) hearingAid = { color: parseColors(t)[0] ?? C('#b9b3a8'), side: /right/.test(t) ? 'right' : 'left' };
    else if (/nose/.test(t)) noseStud = metalOf(t);
    else if (/earring|stud|hoop|huggie|ear cuff|helix|ear stud|\bear\b/.test(t) && !earrings) {
      const one = /one ear|right ear|left ear|helix|cuff|in the right|in the left/.test(t);
      earrings = {
        kind: /hoop|huggie/.test(t) ? 'hoop' : /drop|dangle|statement|woven/.test(t) ? 'drop' : 'stud',
        color: metalOf(t),
        sides: one ? (/left/.test(t) ? 'left' : 'right') : 'both',
      };
    } else if (/chain|necklace|pendant/.test(t) && !/glasses/.test(t)) necklace = { color: metalOf(t), pendant: /pendant/.test(t) };
    else if (/pocket square/.test(t)) chestAccent = { color: parseColors(t)[0] ?? accentRgb, kind: 'square' };
    else if (/\btie\b/.test(t) && !/tie bar/.test(t)) tie = parseColors(t)[0] ?? darken(accentRgb, 0.2);
    else if (/pin|brooch|tie bar/.test(t)) chestAccent = { color: parseColors(t.replace(/enamel/g, ''))[0] ?? metalOf(t), kind: 'pin' };
  }
  const attire = attireFrom(a.attire, accentRgb);
  if (/\btie\b/.test((a.attire ?? '').toLowerCase()) && !tie) {
    const m = /([a-z-]+\s+)?(knit\s+)?tie\b/.exec((a.attire ?? '').toLowerCase());
    tie = (m && parseColors(m[0])[0]) ?? darken(attire.outer, 0.25);
  }

  const eyeRaw = parseHex(typeof p.eyeColor === 'string' ? p.eyeColor : null) ?? C('#3b2a20');
  const iris = mix(eyeRaw, C('#15100d'), (eyeRaw.r + eyeRaw.g + eyeRaw.b) / 765 > 0.35 ? 0.3 : 0.45);
  const lipRaw = parseHex(typeof p.lipColor === 'string' ? p.lipColor : null);
  const lip = lipRaw ? mix(skin, { ...lipRaw, a: 1 }, clamp(lipRaw.a, 0.4, 1) * 0.85) : mix(skin, C('#b0625c'), 0.55);
  const brow = parseHex(typeof p.eyeBrowColor === 'string' ? p.eyeBrowColor : null) ?? darken(hair.color, 0.1);
  const lash = parseHex(typeof p.eyeOutlineColor === 'string' ? p.eyeOutlineColor : null) ?? darken(skin, 0.75);
  const avatarIdx = typeof p.avatar === 'number' ? p.avatar : 0;
  const complexion = (a.complexion_details ?? []).join(' ').toLowerCase();
  const asym = rand() * 2 - 1;
  // A mark whose side the catalog does not name goes on one deterministic side.
  const markSide: -1 | 1 = asym > 0 ? 1 : -1;

  return {
    seed,
    name,
    accent: accentRgb,
    skin,
    skinLight: lighten(skin, 0.12),
    skinShade: darken(skin, 0.16),
    blush: mix(skin, C('#e0675a'), 0.55),
    blushAlpha: (flush ? 0.26 : 0.14) * (skinLum < 0.35 ? 0.7 : 1),
    lip,
    lipShade: darken(lip, 0.22),
    iris,
    lash,
    brow,
    browWeight: clamp(num(p.eyeBrowSize, 1), 0.6, 1.5),
    hair,
    covering,
    facialHair,
    eyewear,
    earrings,
    noseStud,
    necklace,
    chestAccent,
    tie,
    hearingAid,
    attire,
    broad: avatarIdx === 0 || avatarIdx === 1,
    eyeSpacing: clamp(num(p.eyeSpacing, 1), 0.85, 1.15),
    eyeSize: clamp(num(p.eyeWidth, 58.3) / 58.3, 0.85, 1.15),
    mouthWidth: clamp(num(p.mouthWidth, 80) / 80, 0.85, 1.15),
    mouthSize: clamp(num(p.mouthSize, 1), 0.8, 1.2),
    lipFullness: clamp(num(p.lipSize, 8) / 8, 0.65, 1.35) * clamp(num(p.mouthHeight, 58) / 58, 0.85, 1.15),
    noseSize: clamp(num(p.noseSize, 1) * (num(p.noseHeight, 82) / 82), 0.8, 1.2),
    noseWidth: clamp(num(p.noseWidth, 64) / 64, 0.85, 1.2),
    showNose: p.showNose !== false,
    freckles: /freckle/.test(complexion),
    beautyMark: skinMarks(a.complexion_details ?? [], /beauty mark|\bmole\b/, markSide)[0] ?? null,
    vitiligo: skinMarks(a.complexion_details ?? [], /vitiligo/, markSide),
    laughLines: /laugh line|smile line|crow/.test(complexion),
    asym,
  };
}

/**
 * A quiet, monochrome "sketch" for a face with no appearance yet (EXPERIENCE §4.6: the hiring
 * placeholder is a labelled sketch). Same geometry as every other face, so it never looks broken.
 */
export function placeholderLook(name = 'Coworker', accent = '#8a8f98'): ProceduralStyle {
  const base = lookFromAppearance({
    appearance: { hair: { style: 'short and neatly cut', color: 'gray' }, attire: 'gray crew-neck sweater', procedural: { skinBrightness: 100 } },
    accent,
    name,
  });
  const tone = C('#c9c5be');
  const ink = C('#77736d');
  return {
    ...base,
    skin: tone,
    skinLight: lighten(tone, 0.14),
    skinShade: darken(tone, 0.14),
    blush: tone,
    blushAlpha: 0,
    lip: darken(tone, 0.12),
    lipShade: darken(tone, 0.24),
    iris: ink,
    lash: ink,
    brow: darken(tone, 0.3),
    hair: { ...base.hair, shape: 'short', color: darken(tone, 0.2), streak: null, tips: null, temples: null, part: 'none' },
    facialHair: null,
    eyewear: null,
    earrings: null,
    noseStud: null,
    necklace: null,
    chestAccent: null,
    tie: null,
    hearingAid: null,
    covering: null,
    attire: { outer: darken(tone, 0.08), inner: null, neckline: 'crew', innerCollar: false, striped: null, print: null },
    freckles: false,
    beautyMark: null,
    vitiligo: [],
    laughLines: false,
  };
}
