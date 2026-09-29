// The light layer (OFFICE-PLAN §1.2): four sources only. The skyline's window light is on the plate; this layer holds
// the pendants (ambient), the monitors (lit in the coworker's accent while they work or think), the desk lamps (Night
// Shift only) and the floor halos (raised hand, speaking). Everything is a gradient shape (no filters); state changes
// are attribute toggles on per-seat groups. The layer is composited with `mix-blend-mode: screen`.
import { K_Y, K_Z } from '../projection';
import { DESK_Z } from '../plan/geometry';
import type { OfficePlan, OfficeSeat } from '../plan/types';
import { n } from './symbols';

const Y = (y: number, z = 0) => y * K_Y - z * K_Z;

function seatLight(seat: OfficeSeat, gid: string): string {
  const m = seat.monitor;
  const towardViewer = seat.facing === 'n';
  const deskTop = Y(m.y, DESK_Z);
  let mon = '';
  if (seat.kind === 'desk' && towardViewer) {
    // The lit screen itself (its face is toward the camera) plus two faint lines of "work" on it.
    const sx = seat.desk.x + seat.desk.w / 2 - 3.05;
    const sy = Y(seat.desk.y + 1.1, 12.4) + 0.25;
    const sh = 4 * K_Z - 0.55;
    mon += `<rect x="${n(sx)}" y="${n(sy)}" width="6.1" height="${n(sh)}" style="fill:var(--acc)" opacity=".78"/>`;
    mon += `<rect x="${n(sx + 0.7)}" y="${n(sy + 0.45)}" width="3.4" height=".22" fill="#fff" opacity=".35"/><rect x="${n(sx + 0.7)}" y="${n(sy + 0.95)}" width="4.4" height=".18" fill="#fff" opacity=".22"/>`;
    mon += `<ellipse cx="${n(m.x)}" cy="${n(sy + sh / 2)}" rx="6.2" ry="2.6" fill="url(#${gid})" opacity=".55"/>`;
  }
  const spillY = towardViewer ? Y(m.y + 2.6, DESK_Z) : Y(m.y - 2.4, DESK_Z);
  if (towardViewer || seat.kind === 'chief') {
    mon += `<ellipse cx="${n(m.x)}" cy="${n(spillY)}" rx="${seat.kind === 'chief' ? 9 : 7.4}" ry="3.6" fill="url(#${gid})"/>`;
  } else {
    // North-side seats face the viewer, so their badge sits in front of the lit desk: a wider, doubled spill and a
    // brighter halo round the monitor's back keep the glow visible either side of the badge.
    mon += `<ellipse cx="${n(m.x)}" cy="${n(spillY)}" rx="11.5" ry="4.6" fill="url(#${gid})"/><ellipse cx="${n(m.x)}" cy="${n(spillY)}" rx="8" ry="3.2" fill="url(#${gid})"/>`;
    mon += `<ellipse cx="${n(m.x)}" cy="${n(Y(m.y - 0.6, 11.4))}" rx="6.2" ry="2" fill="url(#${gid})"/>`;
  }
  // Night Shift: the desk lamp's warm pool on the desk and a soft spill beyond, plus the bulb.
  const l = seat.lamp;
  const lt = Y(l.y, DESK_Z);
  const lamp =
    `<ellipse cx="${n(l.x + 0.6)}" cy="${n(lt + 0.4)}" rx="12" ry="6.5" fill="url(#hc-o-lampfar)"/>` +
    `<ellipse cx="${n(l.x + 0.8)}" cy="${n(lt + 0.2)}" rx="5.6" ry="2.8" fill="url(#hc-o-lamp)"/>` +
    `<ellipse cx="${n(l.x + 1.35)}" cy="${n(lt - 3.75)}" rx=".85" ry=".32" fill="#ffc977" opacity=".75"/>`;
  const fy = Y(seat.y);
  const halo =
    `<g class="hand"><ellipse cx="${n(seat.x)}" cy="${n(fy)}" rx="7.2" ry="${n(7.2 * K_Y * 0.62)}" fill="url(#hc-o-hand)"/><ellipse cx="${n(seat.x)}" cy="${n(fy)}" rx="5.6" ry="${n(5.6 * K_Y * 0.62)}" fill="none" stroke="var(--o-halo-hand)" stroke-width=".45" opacity=".85"/></g>` +
    `<g class="speak"><ellipse cx="${n(seat.x)}" cy="${n(fy - 2)}" rx="11" ry="${n(11 * K_Y * 0.6)}" fill="url(#hc-o-speak)"/></g>`;
  return `<g class="mon">${mon}</g><g class="lampl">${lamp}</g>${halo}`;
}

export interface LightInput {
  plan: OfficePlan;
  /** personId → accent (already adapted for the theme). */
  accentOf: (personId: string) => string;
}

/** The light layer SVG (same view box as the plate). */
export function buildLightSvg({ plan, accentOf }: LightInput, box: { x: number; y: number; w: number; h: number }): string {
  let defs =
    `<radialGradient id="hc-o-pend"><stop offset="0" style="stop-color:var(--o-pendant);stop-opacity:calc(var(--o-pendant-a) * var(--o-pendant-k, 1))"/><stop offset=".55" style="stop-color:var(--o-pendant);stop-opacity:calc(var(--o-pendant-a) * var(--o-pendant-k, 1) * .35)"/><stop offset="1" style="stop-color:var(--o-pendant);stop-opacity:0"/></radialGradient>` +
    `<radialGradient id="hc-o-lamp"><stop offset="0" style="stop-color:var(--o-lamp-light);stop-opacity:calc(var(--o-lamp-a) * 1.6)"/><stop offset="1" style="stop-color:var(--o-lamp-light);stop-opacity:0"/></radialGradient>` +
    `<radialGradient id="hc-o-lampfar"><stop offset="0" style="stop-color:var(--o-lamp-light);stop-opacity:var(--o-lamp-a)"/><stop offset=".6" style="stop-color:var(--o-lamp-light);stop-opacity:calc(var(--o-lamp-a) * .3)"/><stop offset="1" style="stop-color:var(--o-lamp-light);stop-opacity:0"/></radialGradient>` +
    `<radialGradient id="hc-o-hand"><stop offset="0" style="stop-color:var(--o-halo-hand);stop-opacity:.34"/><stop offset="1" style="stop-color:var(--o-halo-hand);stop-opacity:0"/></radialGradient>` +
    `<radialGradient id="hc-o-speak"><stop offset="0" style="stop-color:var(--o-halo-speak);stop-opacity:.42"/><stop offset=".5" style="stop-color:var(--o-halo-speak);stop-opacity:.14"/><stop offset="1" style="stop-color:var(--o-halo-speak);stop-opacity:0"/></radialGradient>` +
    `<linearGradient id="hc-o-strip" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--o-pendant);stop-opacity:calc(var(--o-pendant-a) * 1.3)"/><stop offset="1" style="stop-color:var(--o-pendant);stop-opacity:0"/></linearGradient>` +
    `<radialGradient id="hc-o-drop"><stop offset="0" style="stop-color:var(--o-halo-speak);stop-opacity:.22"/><stop offset="1" style="stop-color:var(--o-halo-speak);stop-opacity:.04"/></radialGradient>`;
  let body = '';
  // Ambient: pendants (pools on the furniture below them) and the café's under-counter strip.
  for (const p of plan.props) {
    if (p.symbol === 'pendant') {
      const room = p.roomId ? ` data-room="${p.roomId}"` : '';
      body += `<ellipse class="hc-o-pend"${room} cx="${n(p.x)}" cy="${n(Y(p.y, 7))}" rx="17" ry="10" fill="url(#hc-o-pend)"/>`;
    } else if (p.symbol === 'coffee-counter' && p.w && p.d) {
      body += `<rect x="${n(p.x + 1)}" y="${n(Y(p.y + p.d))}" width="${n(p.w - 2)}" height="${n(7 * K_Y)}" fill="url(#hc-o-strip)"/>`;
    } else if (p.symbol === 'island' && p.w && p.d) {
      body += `<rect x="${n(p.x + 1)}" y="${n(Y(p.y + p.d))}" width="${n(p.w - 2)}" height="${n(5 * K_Y)}" fill="url(#hc-o-strip)" opacity=".7"/>`;
    }
  }
  // Rooms light their glass while a badge is dragged over them.
  for (const r of plan.rooms) {
    body += `<rect class="hc-o-droplight" data-room="${r.id}" x="${n(r.rect.x + 1)}" y="${n(Y(r.rect.y + 1))}" width="${n(r.rect.w - 2)}" height="${n((r.rect.h - 2) * K_Y)}" rx="2" fill="url(#hc-o-drop)" stroke="var(--o-halo-speak)" stroke-width=".5"/>`;
  }
  plan.seats.forEach((seat, i) => {
    if (!seat.personId) return;
    const acc = accentOf(seat.personId);
    const gid = `hc-o-m${i}`;
    defs += `<radialGradient id="${gid}"><stop offset="0" stop-color="${acc}" stop-opacity=".62"/><stop offset=".5" stop-color="${acc}" stop-opacity=".2"/><stop offset="1" stop-color="${acc}" stop-opacity="0"/></radialGradient>`;
    body += `<g class="hc-o-sl" data-seat="${seat.id}" style="--acc:${acc}">${seatLight(seat, gid)}</g>`;
  });
  return (
    `<svg class="hc-o-light" xmlns="http://www.w3.org/2000/svg" viewBox="${n(box.x)} ${n(box.y)} ${n(box.w)} ${n(box.h)}" width="${n(box.w)}" height="${n(box.h)}" aria-hidden="true" focusable="false">` +
    `<defs>${defs}</defs>${body}</svg>`
  );
}
