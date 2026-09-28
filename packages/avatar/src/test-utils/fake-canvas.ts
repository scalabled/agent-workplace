// Ported from personagram-ai/tests/renderer.test.ts (FakeContext/FakeCanvas) — a deliberately small
// canvas spy. Renderer tests inspect geometry and draw order rather than pixels, so they stay
// deterministic and need no native canvas. Extended with the calls the illustrated face uses.

export type Op = { kind: string; args: number[]; style?: unknown; stops?: [number, string][] };

export interface FakeGradient {
  stops: [number, string][];
  addColorStop(offset: number, color: string): void;
}

export class FakeContext {
  ops: Op[] = [];
  fillStyle: unknown = '#000';
  strokeStyle: unknown = '#000';
  lineWidth = 1;
  lineCap = 'butt';
  lineJoin = 'miter';
  globalAlpha = 1;
  private readonly alphaStack: number[] = [];
  save() {
    this.alphaStack.push(this.globalAlpha);
    this.ops.push({ kind: 'save', args: [] });
  }
  restore() {
    this.globalAlpha = this.alphaStack.pop() ?? this.globalAlpha;
    this.ops.push({ kind: 'restore', args: [] });
  }
  beginPath() {
    this.ops.push({ kind: 'beginPath', args: [] });
  }
  closePath() {
    this.ops.push({ kind: 'closePath', args: [] });
  }
  clip() {
    this.ops.push({ kind: 'clip', args: [] });
  }
  fill(_rule?: string) {
    this.ops.push({ kind: 'fill', args: [], style: this.fillStyle });
  }
  stroke() {
    this.ops.push({ kind: 'stroke', args: [], style: this.strokeStyle });
  }
  moveTo(x: number, y: number) {
    this.ops.push({ kind: 'moveTo', args: [x, y] });
  }
  lineTo(x: number, y: number) {
    this.ops.push({ kind: 'lineTo', args: [x, y] });
  }
  quadraticCurveTo(cx: number, cy: number, x: number, y: number) {
    this.ops.push({ kind: 'quad', args: [cx, cy, x, y] });
  }
  bezierCurveTo(...args: number[]) {
    this.ops.push({ kind: 'bezier', args });
  }
  rect(x: number, y: number, w: number, h: number) {
    this.ops.push({ kind: 'rect', args: [x, y, w, h] });
  }
  ellipse(...args: unknown[]) {
    this.ops.push({ kind: 'ellipse', args: args.filter((a): a is number => typeof a === 'number') });
  }
  arc(...args: unknown[]) {
    this.ops.push({ kind: 'arc', args: args.filter((a): a is number => typeof a === 'number') });
  }
  translate(x: number, y: number) {
    this.ops.push({ kind: 'translate', args: [x, y] });
  }
  rotate(a: number) {
    this.ops.push({ kind: 'rotate', args: [a] });
  }
  scale(x: number, y: number) {
    this.ops.push({ kind: 'scale', args: [x, y] });
  }
  transform(a: number, b: number, c: number, d: number, e: number, f: number) {
    this.ops.push({ kind: 'transform', args: [a, b, c, d, e, f] });
  }
  setTransform(...args: number[]) {
    this.ops.push({ kind: 'setTransform', args });
  }
  clearRect(...args: number[]) {
    this.ops.push({ kind: 'clearRect', args });
  }
  fillRect(...args: number[]) {
    this.ops.push({ kind: 'fillRect', args, style: this.fillStyle });
  }
  drawImage(...args: unknown[]) {
    this.ops.push({ kind: 'drawImage', args: args.filter((a): a is number => typeof a === 'number'), style: this.globalAlpha });
  }
  createLinearGradient(...args: number[]): FakeGradient {
    const stops: [number, string][] = [];
    this.ops.push({ kind: 'gradient', args, stops });
    return { stops, addColorStop: (offset, color) => stops.push([offset, color]) };
  }
  createRadialGradient(...args: number[]): FakeGradient {
    const stops: [number, string][] = [];
    this.ops.push({ kind: 'radial', args, stops });
    return { stops, addColorStop: (offset, color) => stops.push([offset, color]) };
  }
  getImageData(_x = 0, _y = 0, w = 1, h = 1) {
    const data = new Uint8ClampedArray(Math.max(1, w * h) * 4);
    for (let i = 0; i < data.length; i += 4) data.set([180, 140, 120, 255], i);
    this.ops.push({ kind: 'getImageData', args: [_x, _y, w, h] });
    return { data };
  }
  count(kind: string) {
    return this.ops.filter((o) => o.kind === kind).length;
  }
  reset() {
    this.ops.length = 0;
  }
}

export class FakeCanvas {
  width = 0;
  height = 0;
  readonly ctx = new FakeContext();
  getContext(kind: string) {
    return kind === '2d' ? this.ctx : null;
  }
}

/** A FakeCanvas typed as the DOM canvas the renderers expect. */
export function fakeCanvas(): { canvas: HTMLCanvasElement; ctx: FakeContext; asCtx: CanvasRenderingContext2D } {
  const c = new FakeCanvas();
  return { canvas: c as unknown as HTMLCanvasElement, ctx: c.ctx, asCtx: c.ctx as unknown as CanvasRenderingContext2D };
}

export const asCtx = (ctx: FakeContext) => ctx as unknown as CanvasRenderingContext2D;

/** Split an op log into closed paths with the points drawn into them and the fills applied after. */
export function paths(ops: Op[]) {
  const out: { points: { x: number; y: number }[]; fills: unknown[] }[] = [];
  let current: { x: number; y: number }[] | null = null;
  let last: (typeof out)[number] | null = null;
  for (const op of ops) {
    if (op.kind === 'beginPath') current = [];
    else if ((op.kind === 'moveTo' || op.kind === 'lineTo') && current) current.push({ x: op.args[0]!, y: op.args[1]! });
    // Smoothed outlines pass through segment midpoints with the landmark as the quadratic control
    // point, so the control points are the vertices the tests care about.
    else if (op.kind === 'quad' && current) current.push({ x: op.args[0]!, y: op.args[1]! });
    else if (op.kind === 'closePath' && current) {
      last = { points: current, fills: [] };
      out.push(last);
      current = null;
    } else if (op.kind === 'fill' && last) last.fills.push(op.style);
  }
  return out;
}

/** Colour stops of a recorded gradient fill style, or null for a solid. */
export function stopsOf(style: unknown): [number, string][] | null {
  const stops = (style as { stops?: [number, string][] })?.stops;
  return Array.isArray(stops) ? stops : null;
}

/** Perceived lightness (0–255) and alpha of an rgb()/rgba() string. */
export function rgba(color: string) {
  const [r, g, b, a = '1'] = /rgba?\(([^)]*)\)/.exec(color)![1]!.split(',').map((v) => v.trim());
  return { lum: (Number(r) + Number(g) + Number(b)) / 3, alpha: Number(a) };
}
