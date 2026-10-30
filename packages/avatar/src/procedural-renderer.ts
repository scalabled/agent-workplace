// The illustrated fallback face: a calm, flat-vector head-and-shoulders portrait built from the
// catalog appearance (look.ts). It is what a desk shows before its photo portrait exists, so it
// shares the portrait's framing (3:4, face in the upper middle, backdrop tinted by the agent's one
// accent) and the same FacePose: it blinks, breathes, leans, looks away and lip-syncs through the
// same sampler. Idea after oncloudnine persona/Components/Persona.tsx (a procedural bust from look
// fields), drawn here in Canvas2D so it scales from a 40 px token to a full stage.
import type { Rgba } from './color';
import { darken, lighten, mix, seededRandom, toCss } from './color';
import type { MarkAnchor, ProceduralStyle } from './look';
import type { FacePose } from './motion';
import type { ViewTransform } from './portrait-renderer';

type Ctx = CanvasRenderingContext2D;

/** Design space of the illustration (3:4, like the portraits). */
export const DESIGN_W = 300;
export const DESIGN_H = 400;

const CX = 150;
const HEAD_CY = 171;
const HEAD_RY = 77;
const EYE_DY = 3;
const MOUTH_DY = 50;
const NOSE_DY = 33;
/** The head is drawn this much larger than its design units (about its centre). */
const HEAD_SCALE = 1.1;
/** Where the face centre sits vertically (cover-fit focus). */
export const PROCEDURAL_FOCUS_Y = 0.46;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const css = (c: Rgba, a = 1) => toCss(c, a);

export interface ProceduralRenderOptions {
  /** Dark theme backdrop. */
  dark?: boolean;
}

interface Head {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  top: number;
  chin: number;
  eyeY: number;
  mouthY: number;
  noseY: number;
  fx: number;
  fy: number;
}

function egg(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, jaw: number) {
  ctx.moveTo(cx, cy - ry);
  ctx.bezierCurveTo(cx + rx * 0.58, cy - ry, cx + rx, cy - ry * 0.58, cx + rx, cy - ry * 0.02);
  ctx.bezierCurveTo(cx + rx, cy + ry * 0.46, cx + rx * jaw, cy + ry * 0.99, cx, cy + ry);
  ctx.bezierCurveTo(cx - rx * jaw, cy + ry * 0.99, cx - rx, cy + ry * 0.46, cx - rx, cy - ry * 0.02);
  ctx.bezierCurveTo(cx - rx, cy - ry * 0.58, cx - rx * 0.58, cy - ry, cx, cy - ry);
  ctx.closePath();
}

export class ProceduralRenderer {
  readonly w = DESIGN_W;
  readonly h = DESIGN_H;
  frames = 0;

  constructor(readonly style: ProceduralStyle) {}

  render(ctx: Ctx, pose: FacePose, view?: ViewTransform, opts: ProceduralRenderOptions = {}): void {
    const st = this.style;
    ctx.save();
    if (view && (view.scale !== 1 || view.x !== 0 || view.y !== 0)) ctx.transform(view.scale, 0, 0, view.scale, view.x, view.y);
    this.drawBackdrop(ctx, !!opts.dark);

    // Whole figure: attentive lean (slight scale toward the viewer) and breathing.
    const lean = clamp(pose.lean, 0, 1);
    ctx.translate(CX, DESIGN_H);
    ctx.scale(1 + lean * 0.028, 1 + lean * 0.028);
    ctx.translate(-CX, -DESIGN_H - pose.breath * 0.9);

    const rx = st.broad ? 60 : 57;
    const hx = pose.swayX * DESIGN_W + pose.yaw * 3.2;
    const hy = pose.swayY * DESIGN_H - pose.pitch * 2.4 + lean * 1.4 + pose.breath * 0.4;
    const head: Head = {
      cx: CX,
      cy: HEAD_CY,
      rx,
      ry: HEAD_RY,
      top: HEAD_CY - HEAD_RY,
      chin: HEAD_CY + HEAD_RY,
      eyeY: HEAD_CY + EYE_DY,
      mouthY: HEAD_CY + MOUTH_DY,
      noseY: HEAD_CY + NOSE_DY,
      fx: pose.yaw * 6.5,
      fy: -pose.pitch * 4.5,
    };

    const covering = st.covering?.kind;
    // Head group: sway and yaw rotate about the neck; the head is drawn a touch larger than its
    // design units so it fills a head-and-shoulders frame like the portraits do.
    const headGroup = () => {
      ctx.translate(CX + hx, 262 + hy);
      ctx.rotate(pose.swayRot + pose.yaw * 0.025);
      ctx.translate(-CX, -262);
      ctx.translate(CX, HEAD_CY);
      ctx.scale(HEAD_SCALE, HEAD_SCALE);
      ctx.translate(-CX, -HEAD_CY);
    };
    if (covering !== 'hijab') {
      ctx.save();
      headGroup();
      this.drawHairBack(ctx, head);
      ctx.restore();
    }
    if (st.attire.neckline === 'hood') this.drawHoodBack(ctx);
    this.drawNeck(ctx, head);
    this.drawBody(ctx);

    ctx.save();
    headGroup();
    if (covering === 'hijab') this.drawHijabBack(ctx, head);
    this.drawEars(ctx, head, pose);
    this.drawHead(ctx, head);
    this.drawComplexion(ctx, head);
    if (st.facialHair) this.drawFacialHair(ctx, head, pose);
    if (st.showNose) this.drawNose(ctx, head);
    this.drawMouth(ctx, head, pose);
    this.drawEyes(ctx, head, pose);
    this.drawBrows(ctx, head, pose);
    if (covering !== 'hijab') this.drawHairFront(ctx, head);
    if (st.eyewear) this.drawEyewear(ctx, head);
    if (covering) this.drawCovering(ctx, head);
    this.drawEarrings(ctx, head, pose);
    ctx.restore();

    if (st.hair.shape === 'singleBraid' && covering !== 'hijab') this.drawSingleBraid(ctx, head);
    ctx.restore();
    this.frames++;
  }

  // ── backdrop & body ────────────────────────────────────────────────────────

  private drawBackdrop(ctx: Ctx, dark: boolean) {
    const a = this.style.accent;
    const top = dark ? mix(a, { r: 38, g: 42, b: 49, a: 1 }, 0.66) : mix(a, { r: 243, g: 240, b: 234, a: 1 }, 0.74);
    const bottom = dark ? mix(a, { r: 22, g: 25, b: 29, a: 1 }, 0.74) : mix(a, { r: 231, g: 225, b: 215, a: 1 }, 0.6);
    const g = ctx.createLinearGradient(0, 0, 0, DESIGN_H);
    g.addColorStop(0, css(top));
    g.addColorStop(1, css(bottom));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);
    const glow = ctx.createRadialGradient(CX, HEAD_CY + 6, 10, CX, HEAD_CY + 6, 175);
    glow.addColorStop(0, css(lighten(top, dark ? 0.08 : 0.3), 0.75));
    glow.addColorStop(1, css(lighten(top, 0.1), 0));
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);
  }

  private get neckW() {
    return this.style.broad ? 27 : 23;
  }
  private get shoulderW() {
    return this.style.broad ? 124 : 110;
  }

  private drawNeck(ctx: Ctx, head: Head) {
    const st = this.style;
    const nw = this.neckW;
    ctx.beginPath();
    ctx.moveTo(CX - nw, head.cy + head.ry * 0.5);
    ctx.lineTo(CX - nw, 300);
    ctx.quadraticCurveTo(CX, 312, CX + nw, 300);
    ctx.lineTo(CX + nw, head.cy + head.ry * 0.5);
    ctx.closePath();
    // Soft shade under the jaw fading down the neck (no hard band).
    const chinY = HEAD_CY + (head.chin - HEAD_CY) * HEAD_SCALE;
    const g = ctx.createLinearGradient(0, chinY - 4, 0, chinY + 30);
    g.addColorStop(0, css(mix(st.skin, st.skinShade, 0.95)));
    g.addColorStop(1, css(mix(st.skin, st.skinShade, 0.45)));
    ctx.fillStyle = g;
    ctx.fill();
    // Vitiligo on the neck (the head group draws the face's own marks).
    for (const mark of st.vitiligo) {
      if (mark.anchor !== 'neck') continue;
      for (const side of mark.side === 0 ? ([-1, 1] as const) : [mark.side]) {
        const [x, y, r] = this.markPoint(head, 'neck', side, 'patch');
        ctx.beginPath();
        ctx.ellipse(x, y + 6, r * 0.8, r, 0, 0, Math.PI * 2);
        ctx.fillStyle = css(lighten(st.skin, 0.32), 0.5);
        ctx.fill();
      }
    }
  }

  private bodyPath(ctx: Ctx, neckline: 'crew' | 'vneck' | 'high') {
    const nw = this.neckW;
    const sw = this.shoulderW;
    const topY = 290;
    const shoulderY = 328;
    ctx.beginPath();
    ctx.moveTo(CX - nw - 4, topY - 4);
    ctx.bezierCurveTo(CX - nw - 30, topY + 2, CX - sw + 8, topY + 8, CX - sw, shoulderY);
    ctx.quadraticCurveTo(CX - sw - 8, 362, CX - sw - 10, DESIGN_H + 4);
    ctx.lineTo(CX + sw + 10, DESIGN_H + 4);
    ctx.quadraticCurveTo(CX + sw + 8, 362, CX + sw, shoulderY);
    ctx.bezierCurveTo(CX + sw - 8, topY + 8, CX + nw + 30, topY + 2, CX + nw + 4, topY - 4);
    if (neckline === 'vneck') {
      ctx.lineTo(CX, topY + 34);
    } else if (neckline === 'high') {
      ctx.lineTo(CX + nw + 3, 256);
      ctx.quadraticCurveTo(CX, 250, CX - nw - 3, 256);
    } else {
      ctx.quadraticCurveTo(CX, topY + 17, CX - nw - 4, topY - 4);
    }
    ctx.closePath();
  }

  private drawHoodBack(ctx: Ctx) {
    ctx.beginPath();
    ctx.ellipse(CX, 294, this.neckW + 30, 17, 0, 0, Math.PI * 2);
    ctx.fillStyle = css(darken(this.style.attire.outer, 0.16));
    ctx.fill();
  }

  private drawBody(ctx: Ctx) {
    const st = this.style;
    const at = st.attire;
    const nw = this.neckW;
    const sw = this.shoulderW;
    const topY = 290;
    const neck = at.neckline === 'turtleneck' ? 'high' : at.neckline === 'vneck' ? 'vneck' : 'crew';
    this.bodyPath(ctx, neck);
    const g = ctx.createLinearGradient(0, topY, 0, DESIGN_H);
    g.addColorStop(0, css(lighten(at.outer, 0.06)));
    g.addColorStop(1, css(darken(at.outer, 0.08)));
    ctx.fillStyle = g;
    ctx.fill();

    if (at.striped || at.print) {
      ctx.save();
      this.bodyPath(ctx, neck);
      ctx.clip();
      if (at.striped) {
        ctx.fillStyle = css(at.striped, 0.8);
        for (let y = topY; y < DESIGN_H; y += 10) ctx.fillRect(0, y, DESIGN_W, 3.5);
      }
      if (at.print) {
        const rand = seededRandom(st.seed ^ 0x51f1);
        for (let y = topY + 6; y < DESIGN_H; y += 13)
          for (let x = CX - sw - 10; x < CX + sw + 10; x += 13) {
            const c = at.print[Math.floor(rand() * at.print.length)]!;
            ctx.beginPath();
            ctx.arc(x + rand() * 6, y + rand() * 6, 2.3, 0, Math.PI * 2);
            ctx.fillStyle = css(c, 0.85);
            ctx.fill();
          }
      }
      ctx.restore();
    }

    const seam = darken(at.outer, 0.28);
    if (at.neckline === 'open' && at.inner) {
      // Inner garment in the V of an open jacket, lapels on top.
      ctx.beginPath();
      ctx.moveTo(CX - nw - 2, topY - 3);
      ctx.lineTo(CX, 374);
      ctx.lineTo(CX + nw + 2, topY - 3);
      ctx.quadraticCurveTo(CX, topY + 15, CX - nw - 2, topY - 3);
      ctx.closePath();
      ctx.fillStyle = css(at.inner);
      ctx.fill();
      if (st.tie) this.drawTie(ctx);
      ctx.strokeStyle = css(seam, 0.7);
      ctx.lineWidth = 1.4;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(CX + side * (nw + 2), topY - 3);
        ctx.lineTo(CX + side * 1, 374);
        ctx.stroke();
        // Lapel roll.
        ctx.beginPath();
        ctx.moveTo(CX + side * (nw + 8), topY + 2);
        ctx.quadraticCurveTo(CX + side * (nw + 20), topY + 40, CX + side * 10, 350);
        ctx.strokeStyle = css(seam, 0.35);
        ctx.stroke();
        ctx.strokeStyle = css(seam, 0.7);
      }
      if (at.innerCollar) this.drawCollar(ctx, at.inner, topY);
    } else if (at.neckline === 'collar') {
      if (st.tie) this.drawTie(ctx);
      this.drawCollar(ctx, lighten(at.outer, 0.05), topY);
      ctx.strokeStyle = css(seam, 0.35);
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(CX, topY + 14);
      ctx.lineTo(CX, DESIGN_H);
      ctx.stroke();
    } else if (at.neckline === 'turtleneck') {
      ctx.strokeStyle = css(seam, 0.28);
      ctx.lineWidth = 1.2;
      for (const y of [266, 276, 286]) {
        ctx.beginPath();
        ctx.moveTo(CX - nw - 2, y);
        ctx.quadraticCurveTo(CX, y + 5, CX + nw + 2, y);
        ctx.stroke();
      }
    } else if (at.neckline === 'hood') {
      ctx.strokeStyle = css(at.inner ?? lighten(at.outer, 0.5), 0.9);
      ctx.lineWidth = 1.6;
      ctx.lineCap = 'round';
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(CX + side * 9, topY + 12);
        ctx.lineTo(CX + side * 10, topY + 40);
        ctx.stroke();
      }
    } else {
      // Crew/V: a soft rib line at the neckline.
      ctx.strokeStyle = css(seam, 0.3);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      if (at.neckline === 'vneck') {
        ctx.moveTo(CX - nw - 4, topY - 4);
        ctx.lineTo(CX, topY + 34);
        ctx.lineTo(CX + nw + 4, topY - 4);
      } else {
        ctx.moveTo(CX - nw - 4, topY - 1);
        ctx.quadraticCurveTo(CX, topY + 20, CX + nw + 4, topY - 1);
      }
      ctx.stroke();
    }

    if (st.necklace) {
      ctx.strokeStyle = css(st.necklace.color, 0.95);
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(CX - nw + 1, topY - 8);
      ctx.quadraticCurveTo(CX, topY + 22, CX + nw - 1, topY - 8);
      ctx.stroke();
      if (st.necklace.pendant) {
        ctx.beginPath();
        ctx.arc(CX, topY + 9, 2.4, 0, Math.PI * 2);
        ctx.fillStyle = css(st.necklace.color);
        ctx.fill();
      }
    }
    if (st.chestAccent) {
      const x = CX + sw * 0.5;
      const y = 350;
      ctx.beginPath();
      if (st.chestAccent.kind === 'square') {
        ctx.moveTo(x - 7, y);
        ctx.lineTo(x + 7, y);
        ctx.lineTo(x + 3, y - 6);
        ctx.lineTo(x - 2, y - 4);
        ctx.closePath();
      } else ctx.arc(x, y, 3.3, 0, Math.PI * 2);
      ctx.fillStyle = css(st.chestAccent.color);
      ctx.fill();
    }
  }

  private drawCollar(ctx: Ctx, color: Rgba, topY: number) {
    const nw = this.neckW;
    ctx.fillStyle = css(color);
    ctx.strokeStyle = css(darken(color, 0.22), 0.5);
    ctx.lineWidth = 1;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(CX + side * (nw + 3), topY - 8);
      ctx.lineTo(CX + side * 2, topY + 13);
      ctx.lineTo(CX + side * (nw + 12), topY + 12);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }

  private drawTie(ctx: Ctx) {
    const c = this.style.tie!;
    ctx.beginPath();
    ctx.moveTo(CX - 5, 292);
    ctx.lineTo(CX + 5, 292);
    ctx.lineTo(CX + 4, 302);
    ctx.lineTo(CX + 8, 382);
    ctx.lineTo(CX, 394);
    ctx.lineTo(CX - 8, 382);
    ctx.lineTo(CX - 4, 302);
    ctx.closePath();
    ctx.fillStyle = css(c);
    ctx.fill();
  }

  // ── head ───────────────────────────────────────────────────────────────────

  private drawEars(ctx: Ctx, head: Head, pose: FacePose) {
    const st = this.style;
    if (st.covering?.kind === 'hijab') return;
    for (const side of [-1, 1]) {
      const turnAway = side > 0 ? Math.max(0, pose.yaw) : Math.max(0, -pose.yaw);
      const x = head.cx + side * head.rx * 0.97 + head.fx * 0.3;
      const y = head.eyeY + 10;
      ctx.beginPath();
      ctx.ellipse(x, y, 8 * (1 - turnAway * 0.45), 14, side * 0.12, 0, Math.PI * 2);
      ctx.fillStyle = css(mix(st.skin, st.skinShade, 0.3));
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(x + side * 1.5, y, 3.6 * (1 - turnAway * 0.45), 8, side * 0.12, -Math.PI / 2, Math.PI / 2, side < 0);
      ctx.strokeStyle = css(st.skinShade, 0.45);
      ctx.lineWidth = 1.2;
      ctx.stroke();
      if (st.hearingAid && ((st.hearingAid.side === 'left') === (side > 0))) {
        // Wearer's left ear is on the viewer's right.
        ctx.beginPath();
        ctx.ellipse(x + side * 5, y - 8, 3, 7, side * 0.3, 0, Math.PI * 2);
        ctx.fillStyle = css(st.hearingAid.color);
        ctx.fill();
      }
    }
  }

  private drawHead(ctx: Ctx, head: Head) {
    const st = this.style;
    const jaw = st.broad ? 0.7 : 0.6;
    ctx.beginPath();
    egg(ctx, head.cx, head.cy, head.rx, head.ry, jaw);
    const g = ctx.createRadialGradient(head.cx - 20 + head.fx, head.cy - 34, 8, head.cx, head.cy, head.ry * 1.18);
    g.addColorStop(0, css(st.skinLight));
    g.addColorStop(0.55, css(st.skin));
    g.addColorStop(1, css(mix(st.skin, st.skinShade, 0.55)));
    ctx.fillStyle = g;
    ctx.fill();
  }

  private drawComplexion(ctx: Ctx, head: Head) {
    const st = this.style;
    const { fx, fy } = head;
    // Cheeks: a whisper of warmth.
    for (const side of [-1, 1]) {
      const x = head.cx + side * 31 + fx * 0.8;
      const y = head.eyeY + 25 + fy;
      const g = ctx.createRadialGradient(x, y, 1, x, y, 17);
      g.addColorStop(0, css(st.blush, st.blushAlpha));
      g.addColorStop(1, css(st.blush, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, 17, 0, Math.PI * 2);
      ctx.fill();
    }
    const rand = seededRandom(st.seed ^ 0xf00d);
    // Vitiligo and beauty marks sit where the catalog says (side and place), in viewer space.
    for (const mark of st.vitiligo) {
      if (mark.anchor === 'neck') continue; // drawn with the neck, outside the head group
      for (const side of mark.side === 0 ? ([-1, 1] as const) : [mark.side]) {
        const [x, y, r] = this.markPoint(head, mark.anchor, side, 'patch');
        ctx.beginPath();
        ctx.ellipse(x + fx * 0.6, y + fy, r, r * 0.75, rand() - 0.5, 0, Math.PI * 2);
        ctx.fillStyle = css(lighten(st.skin, 0.32), 0.55);
        ctx.fill();
      }
    }
    if (st.freckles) {
      ctx.fillStyle = css(st.skinShade, 0.5);
      for (let i = 0; i < 14; i++) {
        const side = i % 2 ? 1 : -1;
        const x = head.cx + side * (8 + rand() * 24) + fx;
        const y = head.eyeY + 13 + rand() * 13 + fy;
        ctx.beginPath();
        ctx.arc(x, y, 0.8 + rand() * 0.45, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    const mark = st.beautyMark;
    if (mark && mark.anchor !== 'neck') {
      const [x, y] = this.markPoint(head, mark.anchor, mark.side === 0 ? 1 : mark.side, 'mark');
      ctx.beginPath();
      ctx.arc(x + fx, y + fy, 1.3, 0, Math.PI * 2);
      ctx.fillStyle = css(darken(st.skin, 0.55), 0.85);
      ctx.fill();
    }
    if (st.laughLines) {
      ctx.strokeStyle = css(st.skinShade, 0.32);
      ctx.lineWidth = 1.1;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(head.cx + side * 17 + fx, head.noseY + 3 + fy);
        ctx.quadraticCurveTo(head.cx + side * 24 + fx, head.mouthY - 2 + fy, head.cx + side * 21 + fx, head.mouthY + 8 + fy);
        ctx.stroke();
      }
    }
  }

  /** Centre and radius (design units) of a skin mark at a named place on one side (viewer space). */
  private markPoint(head: Head, anchor: MarkAnchor, side: -1 | 1, kind: 'patch' | 'mark'): [number, number, number] {
    const ex = head.cx + side * 23 * this.style.eyeSpacing;
    const small = kind === 'mark';
    switch (anchor) {
      case 'temple':
        return [head.cx + side * head.rx * 0.78, head.eyeY - 14, 10];
      case 'eyebrow':
        return [ex + side * 7, head.eyeY - (small ? 23 : 20), 7];
      case 'eye':
        return small ? [ex + side * 13, head.eyeY + 7, 1] : [ex, head.eyeY + 1, 12];
      case 'cheekbone':
        return [head.cx + side * 32, head.eyeY + 14, 10];
      case 'cheek':
        return [head.cx + side * 30, head.eyeY + 26, 11];
      case 'mouth':
        return [head.cx + side * 21, head.mouthY - (small ? 6 : 2), 8];
      case 'chin':
        return [head.cx + side * 8, head.chin - 11, 8];
      case 'jaw':
        return [head.cx + side * head.rx * 0.72, head.mouthY + 8, 9];
      case 'forehead':
        return [head.cx + side * 14, head.eyeY - 36, 9];
      case 'neck':
        return [head.cx + side * this.neckW * 0.45, head.cy + head.ry + 18, 8];
    }
  }

  private drawNose(ctx: Ctx, head: Head) {
    const st = this.style;
    const nx = head.cx + head.fx * 1.15;
    const ny = head.noseY + head.fy;
    const s = st.noseSize;
    const w = st.noseWidth;
    ctx.strokeStyle = css(st.skinShade, 0.62);
    ctx.lineWidth = 1.9;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(nx + 2, head.eyeY + 10 * s + head.fy);
    ctx.quadraticCurveTo(nx + 6.5 * w, ny - 7 * s, nx + 5 * w, ny - 0.8);
    ctx.quadraticCurveTo(nx + 1 * w, ny + 2.4, nx - 3.5 * w, ny + 0.6);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(nx - 7 * w, ny - 1.5);
    ctx.quadraticCurveTo(nx - 6 * w, ny + 1.4, nx - 3.5 * w, ny + 0.6);
    ctx.strokeStyle = css(st.skinShade, 0.4);
    ctx.stroke();
    if (st.noseStud) {
      ctx.beginPath();
      ctx.arc(nx + 6 * w, ny - 1.8, 1.25, 0, Math.PI * 2);
      ctx.fillStyle = css(st.noseStud);
      ctx.fill();
    }
  }

  private drawEyes(ctx: Ctx, head: Head, pose: FacePose) {
    const st = this.style;
    const open = 1 - clamp(pose.blink, 0, 1);
    for (const side of [-1, 1]) {
      const ex = head.cx + side * 23 * st.eyeSpacing + head.fx;
      const ey = head.eyeY + head.fy + (side > 0 ? st.asym * 0.35 : 0);
      const rX = 5.2 * st.eyeSize;
      const rY = 6.0 * st.eyeSize;
      if (open > 0.2) {
        const gx = ex + pose.lookX * 2.2;
        const gy = ey + pose.lookY * 1.7;
        ctx.beginPath();
        ctx.ellipse(gx, gy, rX, rY * open, 0, 0, Math.PI * 2);
        ctx.fillStyle = css(st.iris);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(gx - 1.7 * st.eyeSize, gy - 2.1 * st.eyeSize * open, 1.35 * st.eyeSize, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.82)';
        ctx.fill();
        // Upper lid line.
        ctx.beginPath();
        ctx.ellipse(ex, ey - 0.4, rX + 2.3, rY * open + 1.6, 0, Math.PI * 1.1, Math.PI * 1.9);
        ctx.strokeStyle = css(st.lash, 0.55);
        ctx.lineWidth = 1.4 * st.eyeSize;
        ctx.lineCap = 'round';
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.moveTo(ex - rX - 1.5, ey);
        ctx.quadraticCurveTo(ex, ey + 2.6, ex + rX + 1.5, ey);
        ctx.strokeStyle = css(st.lash, 0.8);
        ctx.lineWidth = 1.6 * st.eyeSize;
        ctx.lineCap = 'round';
        ctx.stroke();
      }
    }
  }

  private drawBrows(ctx: Ctx, head: Head, pose: FacePose) {
    const st = this.style;
    ctx.strokeStyle = css(st.brow, 0.92);
    ctx.lineWidth = 3.1 * st.browWeight;
    ctx.lineCap = 'round';
    // A concerned palette lifts the inner ends of the brows (LIVING-PLAN §3.7: browInner = 0.4 × weight).
    const inner = clamp(pose.browInner ?? 0, 0, 1) * 3.4;
    for (const side of [-1, 1]) {
      const ex = head.cx + side * 23 * st.eyeSpacing + head.fx;
      const by = head.eyeY - 17 + head.fy - clamp(pose.brow, 0, 1) * 4.5 + (side > 0 ? st.asym * 0.8 : 0);
      ctx.beginPath();
      ctx.moveTo(ex - side * 10, by + 1.6 - inner);
      ctx.quadraticCurveTo(ex + side * 1.5, by - 2.8 - inner * 0.35, ex + side * 11.5, by + 1.2);
      ctx.stroke();
    }
  }

  /** Lips that part and round with the pose's mouth params (same space as the photo warp). */
  private drawMouth(ctx: Ctx, head: Head, pose: FacePose) {
    const st = this.style;
    const m = pose.mouth;
    const open = clamp((m.openY + m.jawDrop) / 0.062, -0.5, 1.15);
    const wide = clamp(m.stretchX / 0.03, -1, 1);
    const round = clamp(m.round, 0, 1);
    // Negative corner pull (a mood frown) lowers the corners.
    const corner = clamp(m.cornerPull, -1, 1);
    const k = st.mouthSize;
    const mx = head.cx + head.fx;
    const my = head.mouthY + head.fy + Math.max(0, open) * 1.2;
    const halfW = 14.5 * st.mouthWidth * k * (1 + Math.max(0, wide) * 0.13 + Math.min(0, wide) * 0.08 - round * 0.26);
    const openH = Math.max(0, open) * 14 * k;
    const press = open < 0 ? 0.82 : 1;
    const upT = 3.1 * st.lipFullness * k * (1 + round * 0.15) * press;
    const loT = 4.0 * st.lipFullness * k * (1 + round * 0.18) * press;
    const lift = corner * 2.6 - round * 0.4;
    const L = { x: mx - halfW, y: my - lift };
    const R = { x: mx + halfW, y: my - lift };
    const upperLip = mix(st.lip, st.lipShade, 0.45);

    const upperOuter = (dy: number) => {
      ctx.moveTo(L.x, L.y);
      ctx.bezierCurveTo(mx - halfW * 0.55, my - upT * 0.95 - dy, mx - halfW * 0.22, my - upT * 1.15 - dy, mx, my - upT * 0.72 - dy);
      ctx.bezierCurveTo(mx + halfW * 0.22, my - upT * 1.15 - dy, mx + halfW * 0.55, my - upT * 0.95 - dy, R.x, R.y);
    };

    if (openH < 0.8) {
      const lineCtrl = my + 1.1 - lift * 0.5;
      ctx.beginPath();
      upperOuter(0);
      ctx.quadraticCurveTo(mx, lineCtrl, L.x, L.y);
      ctx.closePath();
      ctx.fillStyle = css(upperLip);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(L.x, L.y);
      ctx.quadraticCurveTo(mx, lineCtrl, R.x, R.y);
      ctx.bezierCurveTo(mx + halfW * 0.6, my + loT * 1.08, mx - halfW * 0.6, my + loT * 1.08, L.x, L.y);
      ctx.closePath();
      ctx.fillStyle = css(st.lip);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(L.x - 0.6, L.y);
      ctx.quadraticCurveTo(mx, lineCtrl, R.x + 0.6, R.y);
      ctx.strokeStyle = css(darken(st.lipShade, 0.3), 0.7);
      ctx.lineWidth = 1.1;
      ctx.lineCap = 'round';
      ctx.stroke();
    } else {
      const upApex = my - openH * 0.3;
      const loApex = my + openH * 0.7;
      const base = (L.y + R.y) / 2;
      const upCtrl = 2 * upApex - base;
      const loCtrl = 2 * loApex - base;
      // Cavity.
      ctx.beginPath();
      ctx.moveTo(L.x, L.y);
      ctx.quadraticCurveTo(mx, upCtrl, R.x, R.y);
      ctx.quadraticCurveTo(mx, loCtrl, L.x, L.y);
      ctx.closePath();
      const g = ctx.createLinearGradient(mx, upApex, mx, loApex);
      g.addColorStop(0, 'rgba(58, 26, 31, 1)');
      g.addColorStop(0.5, 'rgba(29, 11, 15, 1)');
      g.addColorStop(1, 'rgba(45, 20, 24, 1)');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.save();
      ctx.clip();
      if (openH > 2.5) {
        const teethH = Math.min(openH * 0.3, 3.4 * k);
        ctx.beginPath();
        ctx.ellipse(mx, upApex - 2, halfW * 0.62, teethH + 2, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(246, 241, 232, 0.95)';
        ctx.fill();
      }
      if ((pose.tongue || open > 0.55) && openH > 5) {
        ctx.beginPath();
        ctx.ellipse(mx, loApex + 1, halfW * 0.48, openH * 0.3, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(178, 86, 97, 0.9)';
        ctx.fill();
      }
      ctx.restore();
      // Upper lip over the top edge, lower lip under the bottom edge.
      const lift2 = openH * 0.3;
      ctx.beginPath();
      upperOuter(lift2);
      ctx.quadraticCurveTo(mx, upCtrl, L.x, L.y);
      ctx.closePath();
      ctx.fillStyle = css(upperLip);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(L.x, L.y);
      ctx.quadraticCurveTo(mx, loCtrl, R.x, R.y);
      ctx.bezierCurveTo(mx + halfW * 0.62, loApex + loT * 1.12, mx - halfW * 0.62, loApex + loT * 1.12, L.x, L.y);
      ctx.closePath();
      ctx.fillStyle = css(st.lip);
      ctx.fill();
    }
    // A soft highlight on the lower lip.
    ctx.beginPath();
    ctx.ellipse(mx, my + (openH < 0.8 ? loT * 0.55 : openH * 0.7 + loT * 0.55), halfW * 0.32, 1.1, 0, 0, Math.PI * 2);
    ctx.fillStyle = css(lighten(st.lip, 0.4), 0.18);
    ctx.fill();
  }

  private drawFacialHair(ctx: Ctx, head: Head, pose: FacePose) {
    const st = this.style;
    const fh = st.facialHair!;
    const { cx, rx, fx, fy } = head;
    const open = clamp((pose.mouth.openY + pose.mouth.jawDrop) / 0.062, 0, 1.15);
    const jawDrop = open * 2.2;
    const my = head.mouthY + fy;
    const alpha = fh.kind === 'stubble' ? 0.24 : 0.95;
    const color = css(fh.color, alpha);
    const hw = 14.5 * st.mouthWidth * st.mouthSize;
    const mx = cx + fx;
    if (fh.kind === 'beard' || fh.kind === 'stubble') {
      const grow = fh.kind === 'stubble' ? 0 : fh.full ? 5 : 2.5;
      const jaw = st.broad ? 0.7 : 0.6;
      const earY = head.eyeY + 18;
      ctx.beginPath();
      // Outer: along the jaw from ear to ear, a little beyond the face outline.
      ctx.moveTo(cx - rx - 0.5, earY);
      ctx.bezierCurveTo(cx - rx - grow * 0.4, head.cy + head.ry * 0.55, cx - rx * jaw - grow, head.chin + grow + jawDrop, cx + fx * 0.4, head.chin + grow + jawDrop);
      ctx.bezierCurveTo(cx + rx * jaw + grow, head.chin + grow + jawDrop, cx + rx + grow * 0.4, head.cy + head.ry * 0.55, cx + rx + 0.5, earY);
      // Inner: the cheek line down to the mouth, round the lips with a ring of skin, and back.
      ctx.bezierCurveTo(cx + rx * 0.66, head.eyeY + 34, mx + hw + 10, my - 12, mx + hw + 5, my + 1);
      ctx.bezierCurveTo(mx + hw + 3, my + 14 + jawDrop, mx - hw - 3, my + 14 + jawDrop, mx - hw - 5, my + 1);
      ctx.bezierCurveTo(mx - hw - 10, my - 12, cx - rx * 0.66, head.eyeY + 34, cx - rx - 0.5, earY);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
    }
    if (fh.kind === 'goatee') {
      ctx.beginPath();
      ctx.ellipse(mx, my + 15 + jawDrop, 9.5, 8, 0, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }
    if (fh.moustache || fh.kind === 'stubble') {
      const lipTop = my - 3.1 * st.lipFullness * st.mouthSize * 1.15;
      const top = lipTop - 5.5;
      const bottom = lipTop - 0.8;
      ctx.beginPath();
      ctx.moveTo(mx - hw - 1.5, my + 0.5);
      ctx.quadraticCurveTo(mx - hw * 0.6, top, mx, top + 0.8);
      ctx.quadraticCurveTo(mx + hw * 0.6, top, mx + hw + 1.5, my + 0.5);
      ctx.quadraticCurveTo(mx + hw * 0.5, bottom, mx, bottom);
      ctx.quadraticCurveTo(mx - hw * 0.5, bottom, mx - hw - 1.5, my + 0.5);
      ctx.closePath();
      ctx.fillStyle = fh.kind === 'stubble' ? css(fh.color, 0.2) : color;
      ctx.fill();
    }
  }

  // ── hair ───────────────────────────────────────────────────────────────────

  private capPath(ctx: Ctx, head: Head, vol: number, hairlineY: number, side: number) {
    const { cx, cy, rx, ry } = head;
    const top = head.top - vol;
    const templeY = cy - 5;
    ctx.beginPath();
    ctx.moveTo(cx - rx - side, templeY);
    ctx.bezierCurveTo(cx - rx - side, cy - ry * 0.78, cx - rx * 0.62, top, cx, top);
    ctx.bezierCurveTo(cx + rx * 0.62, top, cx + rx + side, cy - ry * 0.78, cx + rx + side, templeY);
    ctx.quadraticCurveTo(cx + rx - 3, hairlineY + 10, cx + rx * 0.55, hairlineY + 2);
    ctx.quadraticCurveTo(cx, hairlineY - 1, cx - rx * 0.55, hairlineY + 2);
    ctx.quadraticCurveTo(cx - rx + 3, hairlineY + 10, cx - rx - side, templeY);
    ctx.closePath();
  }

  private bumps(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, from: number, to: number, r: number, color: string) {
    const n = Math.max(6, Math.round(((to - from) * Math.max(rx, ry)) / (r * 1.25)));
    ctx.fillStyle = color;
    for (let i = 0; i <= n; i++) {
      const t = from + ((to - from) * i) / n;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(t) * rx, cy + Math.sin(t) * ry, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawHairBack(ctx: Ctx, head: Head) {
    const hair = this.style.hair;
    const { cx, cy, rx, top } = head;
    const shade = css(darken(hair.color, 0.16));
    let bottom = 0;
    let W = rx + 13;
    switch (hair.shape) {
      case 'bob':
        bottom = cy + head.ry * 0.62;
        break;
      case 'shoulder':
        bottom = 300;
        W = rx + 15;
        break;
      case 'long':
      case 'braids':
        bottom = 350;
        W = rx + 17;
        break;
      case 'curlyLong': {
        const r = hair.texture === 'coily' ? 11 : 14;
        const cloudRy = (292 - (top - 16)) / 2;
        const cloudCy = top - 16 + cloudRy;
        ctx.beginPath();
        ctx.ellipse(cx, cloudCy, rx + 22, cloudRy - 6, 0, 0, Math.PI * 2);
        ctx.fillStyle = shade;
        ctx.fill();
        this.bumps(ctx, cx, cloudCy, rx + 24, cloudRy - 4, 0, Math.PI * 2, r, shade);
        return;
      }
      case 'puff':
      case 'curlyShort':
        return;
      default:
        return;
    }
    if (hair.tucked && hair.shape === 'shoulder') W = rx + 10;
    ctx.beginPath();
    ctx.moveTo(cx, top - 12);
    ctx.bezierCurveTo(cx + rx + 16, top - 12, cx + W, cy - head.ry * 0.3, cx + W, cy + 10);
    ctx.lineTo(cx + W * 0.98, bottom - 14);
    ctx.quadraticCurveTo(cx + W * 0.92, bottom, cx + W * 0.55, bottom);
    ctx.lineTo(cx - W * 0.55, bottom);
    ctx.quadraticCurveTo(cx - W * 0.92, bottom, cx - W * 0.98, bottom - 14);
    ctx.lineTo(cx - W, cy + 10);
    ctx.bezierCurveTo(cx - W, cy - head.ry * 0.3, cx - rx - 16, top - 12, cx, top - 12);
    ctx.closePath();
    if (hair.tips) {
      const g = ctx.createLinearGradient(0, bottom - 70, 0, bottom);
      g.addColorStop(0, shade);
      g.addColorStop(1, css(hair.tips));
      ctx.fillStyle = g;
    } else ctx.fillStyle = shade;
    ctx.fill();
    if (hair.shape === 'braids' || hair.texture === 'strands') {
      ctx.save();
      ctx.clip();
      ctx.strokeStyle = css(darken(hair.color, 0.42), 0.55);
      ctx.lineWidth = 1.3;
      for (let x = cx - W; x <= cx + W; x += 7) {
        ctx.beginPath();
        ctx.moveTo(x, cy);
        ctx.lineTo(x + 2, bottom);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  private drawHairFront(ctx: Ctx, head: Head) {
    const st = this.style;
    const hair = hairFrontSpec(st);
    if (!hair) return;
    const { cx, cy, rx, ry } = head;
    const base = st.hair.color;
    const fill = css(hair.buzz ? mix(base, st.skin, 0.28) : base);
    const hairlineY = cy - ry * (st.hair.receding ? 0.63 : hair.hairline);
    ctx.save();
    ctx.translate(head.fx * 0.4, 0);

    if (st.hair.shape === 'puff') {
      const pr = 31;
      const py = head.top - 20;
      ctx.beginPath();
      ctx.arc(cx, py, pr, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      this.bumps(ctx, cx, py, pr, pr, 0, Math.PI * 2, 8.5, fill);
    }
    if (st.hair.shape === 'bun' && st.hair.bunHigh) {
      ctx.beginPath();
      ctx.arc(cx, head.top - 13, 16, 0, Math.PI * 2);
      ctx.fillStyle = css(darken(base, 0.05));
      ctx.fill();
    }

    this.capPath(ctx, head, hair.vol, hairlineY, hair.side);
    ctx.fillStyle = fill;
    ctx.fill();

    if (hair.curly) {
      const r = st.hair.texture === 'coily' ? 6.5 : 8;
      this.bumps(ctx, cx, cy - ry * 0.34, rx + 3, ry * 0.74, Math.PI * 1.02, Math.PI * 1.98, r, fill);
    }

    // Side panels framing the face (long styles not tucked behind the ears).
    if (hair.panels) {
      const bottom = st.hair.shape === 'bob' ? cy + ry * 0.58 : cy + ry * 0.74;
      ctx.fillStyle = fill;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(cx + side * (rx + 5), cy - 16);
        ctx.quadraticCurveTo(cx + side * (rx + 9), bottom - 20, cx + side * (rx + 4), bottom);
        ctx.lineTo(cx + side * (rx - 7), bottom - 6);
        ctx.quadraticCurveTo(cx + side * (rx - 4), cy, cx + side * (rx - 8), hairlineY + 6);
        ctx.closePath();
        ctx.fill();
      }
    }

    if (st.hair.fringe) {
      ctx.beginPath();
      ctx.moveTo(cx - rx * 0.86, hairlineY - 2);
      ctx.lineTo(cx - rx * 0.84, cy - ry * 0.26);
      for (let i = 1; i <= 6; i++) {
        const x = cx - rx * 0.84 + (rx * 1.68 * i) / 6;
        ctx.quadraticCurveTo(x - rx * 0.14, cy - ry * 0.22, x, cy - ry * 0.26);
      }
      ctx.lineTo(cx + rx * 0.86, hairlineY - 2);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    } else if (st.hair.shape === 'pixie' || st.hair.shape === 'swept') {
      // A side-swept lock across the forehead.
      const dir = st.hair.part === 'left' ? 1 : -1;
      ctx.beginPath();
      ctx.moveTo(cx - dir * rx * 0.3, head.top + 6);
      ctx.quadraticCurveTo(cx + dir * rx * 0.2, hairlineY - 2, cx + dir * rx * 0.9, cy - ry * (st.hair.shape === 'pixie' ? 0.3 : 0.45));
      ctx.quadraticCurveTo(cx + dir * rx * 0.3, hairlineY + 2, cx - dir * rx * 0.55, hairlineY + 3);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    }

    if (st.hair.part !== 'none' && !hair.buzz) {
      const px = st.hair.part === 'center' ? cx : cx + (st.hair.part === 'left' ? -1 : 1) * rx * 0.34;
      ctx.beginPath();
      ctx.moveTo(px, head.top - hair.vol + 3);
      ctx.quadraticCurveTo(px + (px - cx) * 0.1, (head.top + hairlineY) / 2, px + (px - cx) * 0.2, hairlineY - 1);
      ctx.strokeStyle = css(darken(base, 0.35), 0.5);
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    if (st.hair.streak) {
      ctx.save();
      this.capPath(ctx, head, hair.vol, hairlineY, hair.side);
      ctx.clip();
      const sx = cx + (st.hair.part === 'left' ? -1 : 1) * rx * 0.3;
      ctx.beginPath();
      ctx.moveTo(sx - 4, head.top - hair.vol);
      ctx.quadraticCurveTo(sx + 2, (head.top + hairlineY) / 2, sx + 9, hairlineY + 8);
      ctx.strokeStyle = css(st.hair.streak, 0.92);
      ctx.lineWidth = 6;
      ctx.stroke();
      ctx.restore();
    }
    if (st.hair.temples) {
      ctx.save();
      this.capPath(ctx, head, hair.vol, hairlineY, hair.side);
      ctx.clip();
      ctx.fillStyle = css(st.hair.temples, 0.8);
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(cx + side * (rx - 3), cy - 16, 7, 12, side * 0.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    // A quiet sheen on the crown.
    if (!hair.buzz) {
      ctx.beginPath();
      ctx.ellipse(cx - rx * 0.18, head.top + 12 - hair.vol * 0.5, rx * 0.42, 6, -0.2, Math.PI * 1.1, Math.PI * 1.75);
      ctx.strokeStyle = css(lighten(base, 0.22), 0.35);
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawSingleBraid(ctx: Ctx, head: Head) {
    const base = this.style.hair.color;
    const x0 = head.cx + head.rx * 0.72;
    for (let i = 0; i < 8; i++) {
      const t = i / 7;
      const x = x0 + t * 16 + (i % 2 ? 3 : -3);
      const y = head.cy + 36 + t * 110;
      ctx.beginPath();
      ctx.ellipse(x, y, 8 - t * 2, 9, (i % 2 ? 1 : -1) * 0.5, 0, Math.PI * 2);
      ctx.fillStyle = css(i % 2 ? base : darken(base, 0.12));
      ctx.fill();
    }
  }

  // ── accessories ──────────────────────────────────────────────────────────

  private drawEyewear(ctx: Ctx, head: Head) {
    const st = this.style;
    const ew = st.eyewear!;
    const s = ew.size * st.eyeSize;
    const color = ew.clear ? css(ew.color, 0.75) : ew.rimless ? css(ew.color, 0.5) : css(ew.color);
    ctx.lineWidth = ew.rimless ? 1 : ew.weight;
    ctx.strokeStyle = color;
    ctx.lineJoin = 'round';
    const lens = (ex: number, ey: number) => {
      ctx.beginPath();
      if (ew.shape === 'round') ctx.arc(ex, ey, 11.5 * s, 0, Math.PI * 2);
      else if (ew.shape === 'oval') ctx.ellipse(ex, ey, 13 * s, 9.6 * s, 0, 0, Math.PI * 2);
      else {
        const w = 25 * s;
        const h = 17 * s;
        const r = 4.5 * s;
        const x = ex - w / 2;
        const y = ey - h / 2;
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
      }
      ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
      ctx.fill();
      ctx.stroke();
    };
    const ey = head.eyeY + head.fy + 0.5;
    const half = ew.shape === 'round' ? 11.5 * s : ew.shape === 'oval' ? 13 * s : 12.5 * s;
    const exL = head.cx - 23 * st.eyeSpacing + head.fx;
    const exR = head.cx + 23 * st.eyeSpacing + head.fx;
    lens(exL, ey);
    lens(exR, ey);
    ctx.beginPath();
    ctx.moveTo(exL + half, ey - 2);
    ctx.quadraticCurveTo(head.cx + head.fx, ey - 6, exR - half, ey - 2);
    ctx.stroke();
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo((side < 0 ? exL : exR) + side * half, ey - 3);
      ctx.lineTo(head.cx + side * (head.rx - 1) + head.fx * 0.3, ey - 1);
      ctx.stroke();
    }
    // Glint.
    ctx.beginPath();
    ctx.moveTo(exL - half * 0.45, ey - half * 0.35);
    ctx.lineTo(exL - half * 0.1, ey - half * 0.6);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  /** Fabric behind the face (under the chin and jaw), so the opening never shows the backdrop. */
  private drawHijabBack(ctx: Ctx, head: Head) {
    const color = this.style.covering!.colors[0]!;
    const { cx, cy, rx, ry } = head;
    ctx.beginPath();
    ctx.ellipse(cx, cy + ry * 0.2, rx + 10, ry + 12, 0, 0, Math.PI * 2);
    ctx.fillStyle = css(darken(color, 0.12));
    ctx.fill();
  }

  private drawCovering(ctx: Ctx, head: Head) {
    const st = this.style;
    const cov = st.covering!;
    const color = cov.colors[0]!;
    const shade = darken(color, 0.2);
    const { cx, cy, rx, ry, top } = head;
    const pattern = (clipPath: () => void) => {
      if (!cov.patterned || cov.colors.length < 2) return;
      ctx.save();
      clipPath();
      ctx.clip();
      const rand = seededRandom(st.seed ^ 0xbeef);
      for (let y = top - 60; y < DESIGN_H; y += 11)
        for (let x = cx - 110; x < cx + 110; x += 11) {
          ctx.beginPath();
          ctx.arc(x + rand() * 5, y + rand() * 5, 2, 0, Math.PI * 2);
          ctx.fillStyle = css(cov.colors[1 + Math.floor(rand() * (cov.colors.length - 1))]!, 0.8);
          ctx.fill();
        }
      ctx.restore();
    };
    switch (cov.kind) {
      case 'hijab': {
        const outline = () => {
          ctx.beginPath();
          ctx.moveTo(cx, top - 14);
          ctx.bezierCurveTo(cx + rx + 18, top - 14, cx + rx + 19, cy + 10, cx + rx + 15, cy + ry * 0.7);
          ctx.bezierCurveTo(cx + rx + 26, 290, cx + 100, 318, cx + 106, 376);
          ctx.quadraticCurveTo(cx, 396, cx - 106, 376);
          ctx.bezierCurveTo(cx - 100, 318, cx - rx - 26, 290, cx - rx - 15, cy + ry * 0.7);
          ctx.bezierCurveTo(cx - rx - 19, cy + 10, cx - rx - 18, top - 14, cx, top - 14);
          ctx.closePath();
          // Face opening (forehead to below the chin: jaw and chin clear).
          const oTop = cy - ry * 0.62;
          const oBottom = head.chin + 8;
          ctx.ellipse(cx + head.fx * 0.5, (oTop + oBottom) / 2 + head.fy * 0.5, rx * 0.96, (oBottom - oTop) / 2, 0, 0, Math.PI * 2);
        };
        outline();
        ctx.fillStyle = css(color);
        ctx.fill('evenodd');
        pattern(outline);
        ctx.beginPath();
        const oTop = cy - ry * 0.62;
        const oBottom = head.chin + 8;
        ctx.ellipse(cx + head.fx * 0.5, (oTop + oBottom) / 2 + head.fy * 0.5, rx * 0.96 + 4, (oBottom - oTop) / 2 + 4, 0, Math.PI * 0.9, Math.PI * 2.1);
        ctx.strokeStyle = css(shade, 0.55);
        ctx.lineWidth = 1.6;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx - 60, 330);
        ctx.quadraticCurveTo(cx - 20, 352, cx + 30, 346);
        ctx.strokeStyle = css(shade, 0.35);
        ctx.stroke();
        return;
      }
      case 'turban': {
        const path = () => {
          ctx.beginPath();
          ctx.moveTo(cx - rx - 5, cy - ry * 0.26);
          ctx.bezierCurveTo(cx - rx - 10, top - 30, cx + rx + 10, top - 30, cx + rx + 5, cy - ry * 0.26);
          ctx.quadraticCurveTo(cx, cy - ry * 0.52, cx - rx - 5, cy - ry * 0.26);
          ctx.closePath();
        };
        path();
        ctx.fillStyle = css(color);
        ctx.fill();
        ctx.strokeStyle = css(shade, 0.45);
        ctx.lineWidth = 1.5;
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.moveTo(cx - rx + 2, cy - ry * (0.42 + i * 0.16));
          ctx.quadraticCurveTo(cx + 4, top - 4 - i * 6, cx + rx - 6, top + 4 + i * 12);
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.moveTo(cx - 12, top - 6);
        ctx.lineTo(cx, cy - ry * 0.48);
        ctx.lineTo(cx + 12, top - 6);
        ctx.stroke();
        return;
      }
      case 'headwrap': {
        const hgt = 60;
        const path = () => {
          ctx.beginPath();
          ctx.moveTo(cx - rx - 3, cy - ry * 0.28);
          ctx.bezierCurveTo(cx - rx - 24, top - hgt * 0.5, cx - rx * 0.55, top - hgt, cx + 4, top - hgt + 3);
          ctx.bezierCurveTo(cx + rx * 0.62, top - hgt + 1, cx + rx + 22, top - hgt * 0.45, cx + rx + 3, cy - ry * 0.28);
          ctx.quadraticCurveTo(cx, cy - ry * 0.56, cx - rx - 3, cy - ry * 0.28);
          ctx.closePath();
        };
        path();
        ctx.fillStyle = css(color);
        ctx.fill();
        ctx.save();
        path();
        ctx.clip();
        const bands = cov.colors.length > 1 ? cov.colors.slice(1) : [lighten(color, 0.18)];
        ctx.lineWidth = cov.colors.length > 1 ? 4.5 : 2;
        for (let i = 0; i < 6; i++) {
          const y = cy - ry * 0.5 - i * 11;
          ctx.strokeStyle = css(bands[i % bands.length]!, cov.colors.length > 1 ? 0.85 : 0.5);
          ctx.beginPath();
          ctx.moveTo(cx - rx - 26, y + 16);
          ctx.quadraticCurveTo(cx - 6, y - 16, cx + rx + 26, y - 30);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(cx + rx + 26, y + 16);
          ctx.quadraticCurveTo(cx + 6, y - 16, cx - rx - 26, y - 30);
          ctx.stroke();
        }
        ctx.restore();
        ctx.strokeStyle = css(shade, 0.45);
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(cx - rx * 0.7, cy - ry * 0.5);
        ctx.quadraticCurveTo(cx, top - hgt * 0.35, cx + rx * 0.72, cy - ry * 0.46);
        ctx.stroke();
        return;
      }
      case 'kufi':
      case 'cap': {
        const band = cy - ry * 0.52;
        ctx.beginPath();
        ctx.moveTo(cx - rx * 0.99, band + 3);
        ctx.bezierCurveTo(cx - rx * 1.02, top - 4, cx - rx * 0.5, top - 13, cx, top - 13);
        ctx.bezierCurveTo(cx + rx * 0.5, top - 13, cx + rx * 1.02, top - 4, cx + rx * 0.99, band + 3);
        ctx.quadraticCurveTo(cx, band - 7, cx - rx * 0.99, band + 3);
        ctx.closePath();
        const g = ctx.createLinearGradient(0, top - 13, 0, band);
        g.addColorStop(0, css(lighten(color, 0.08)));
        g.addColorStop(1, css(darken(color, 0.08)));
        ctx.fillStyle = g;
        ctx.fill();
        // Embroidered band.
        ctx.fillStyle = css(shade, 0.45);
        for (let i = -5; i <= 5; i++) {
          const x = cx + (i * rx) / 6;
          const y = band - 3 + (i * i * 0.18);
          ctx.beginPath();
          ctx.arc(x, y, 1.3, 0, Math.PI * 2);
          ctx.fill();
        }
        return;
      }
      case 'beanie': {
        ctx.beginPath();
        ctx.moveTo(cx - rx - 4, cy - ry * 0.4);
        ctx.bezierCurveTo(cx - rx - 6, top - 22, cx + rx + 6, top - 22, cx + rx + 4, cy - ry * 0.4);
        ctx.quadraticCurveTo(cx, cy - ry * 0.5, cx - rx - 4, cy - ry * 0.4);
        ctx.closePath();
        ctx.fillStyle = css(color);
        ctx.fill();
        ctx.strokeStyle = css(shade, 0.5);
        ctx.lineWidth = 1.2;
        for (let x = cx - rx + 2; x < cx + rx; x += 6) {
          ctx.beginPath();
          ctx.moveTo(x, cy - ry * 0.6);
          ctx.lineTo(x, cy - ry * 0.45);
          ctx.stroke();
        }
        return;
      }
    }
  }

  private drawEarrings(ctx: Ctx, head: Head, pose: FacePose) {
    const st = this.style;
    const e = st.earrings;
    if (!e || st.covering?.kind === 'hijab') return;
    if ((st.hair.shape === 'bob' || st.hair.shape === 'long' || st.hair.shape === 'shoulder' || st.hair.shape === 'curlyLong') && !st.hair.tucked) return;
    for (const side of [-1, 1]) {
      if (e.sides !== 'both' && (e.sides === 'left') !== side > 0) continue;
      const turnAway = side > 0 ? Math.max(0, pose.yaw) : Math.max(0, -pose.yaw);
      const x = head.cx + side * head.rx * 0.98 + head.fx * 0.3 - side * turnAway * 3;
      const y = head.eyeY + 23;
      ctx.beginPath();
      if (e.kind === 'hoop') {
        ctx.arc(x, y + 4, 4.2, 0, Math.PI * 2);
        ctx.strokeStyle = css(e.color);
        ctx.lineWidth = 1.4;
        ctx.stroke();
      } else if (e.kind === 'drop') {
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + 5);
        ctx.strokeStyle = css(e.color);
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y + 7.5, 2.6, 0, Math.PI * 2);
        ctx.fillStyle = css(e.color);
        ctx.fill();
      } else {
        ctx.arc(x, y + 1, 2.2, 0, Math.PI * 2);
        ctx.fillStyle = css(e.color);
        ctx.fill();
      }
    }
  }
}

function hairFrontSpec(st: ProceduralStyle): { vol: number; hairline: number; side: number; curly: boolean; panels: boolean; buzz: boolean } | null {
  const h = st.hair;
  const curlyTex = h.texture === 'curly' || h.texture === 'coily';
  switch (h.shape) {
    case 'none':
      return null;
    case 'buzz':
      return { vol: 2, hairline: 0.52, side: 1, curly: false, panels: false, buzz: true };
    case 'short':
      return { vol: 7, hairline: 0.5, side: 3, curly: curlyTex, panels: false, buzz: false };
    case 'swept':
      return { vol: 11, hairline: 0.56, side: 3, curly: false, panels: false, buzz: false };
    case 'pixie':
      return { vol: 8, hairline: 0.5, side: 3, curly: false, panels: false, buzz: false };
    case 'curlyShort':
      return { vol: 11, hairline: 0.5, side: 5, curly: true, panels: false, buzz: false };
    case 'puff':
    case 'bun':
    case 'singleBraid':
      return { vol: 3, hairline: 0.52, side: 2, curly: false, panels: false, buzz: false };
    case 'bob':
      return { vol: 8, hairline: 0.5, side: 6, curly: curlyTex, panels: !h.tucked, buzz: false };
    case 'shoulder':
    case 'long':
    case 'braids':
      return { vol: 7, hairline: 0.52, side: 5, curly: false, panels: !h.tucked, buzz: false };
    case 'curlyLong':
      return { vol: 12, hairline: 0.5, side: 6, curly: true, panels: false, buzz: false };
  }
}

