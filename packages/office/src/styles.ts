// The office's one <style id="hc-office-style"> (OFFICE-PLAN §1.4): palette tokens, SVG fill classes and the
// component CSS. Reads the app tokens (--surface, --ink, --muted, --lamp, --hand, …) with fallbacks. Injected once per
// document and removed when the last scene is destroyed.
import { FILL_CSS, paletteCss } from './art/palette';

export const STYLE_ID = 'hc-office-style';

const CSS = `
.hc-office{position:relative;width:100%;height:100%;overflow:hidden;overflow:clip;touch-action:none;user-select:none;-webkit-user-select:none;
  background:var(--o-void);color:var(--o-label-strong);isolation:isolate;contain:strict;
  font:13px/1.35 var(--font-sans,'Inter Variable',Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif);-webkit-font-smoothing:antialiased;
  --o-dur:var(--dur-state,200ms);--o-ease:var(--ease-out,cubic-bezier(.2,.7,.2,1));--fs:0px;--hit:20px;
  --o-focus:0 0 0 2px var(--o-void),0 0 0 4px var(--o-label-strong)}
.hc-office:focus{outline:none}
.hc-office *,.hc-office *::before,.hc-office *::after{box-sizing:border-box}
.hc-office button{font:inherit;color:inherit}
/* The reset above outranks .hc-o-btn--primary: every primary action keeps its dark ink on amber (AA contrast). */
.hc-office .hc-o-btn--primary{color:#1b1406}
.hc-o-skip{position:absolute;left:12px;top:12px;z-index:60;padding:8px 12px;border-radius:8px;background:var(--o-hud);color:var(--o-hud-ink);
  border:1px solid var(--o-hud-line);text-decoration:none;transform:translateY(-300%);transition:transform .15s}
.hc-o-skip:focus{transform:none;outline:2px solid var(--o-label-strong);outline-offset:2px}

/* sky */
.hc-o-sky{position:absolute;inset:0;overflow:hidden;background:var(--o-void);pointer-events:none;z-index:0}
.hc-o-sky__pan{position:absolute;will-change:transform}
/* Everything below the north floor line (and so beside and under the plate) is the void, not river. */
.hc-o-sky__cut{position:absolute;left:0;right:0;top:0;height:100%;will-change:transform;
  background:linear-gradient(to bottom,color-mix(in srgb,var(--o-void) 0%,transparent) 0,var(--o-void) 40px,var(--o-void))}
.hc-o-sky__v{position:absolute;inset:0;background-size:cover;background-position:center;transition:opacity 2s ease}
.hc-o-sky__v.is-entering{opacity:0}
.hc-o-sky__v>img,.hc-o-sky__v>svg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;filter:brightness(var(--o-sky-dim,1))}
.hc-o-sky__v>img{opacity:0;transition:opacity .5s ease}
.hc-o-sky__v.is-loaded>img{opacity:1}
.hc-o-sky__tw{position:absolute;inset:0}
.hc-o-sky__tw i{position:absolute;width:var(--d,2px);height:var(--d,2px);margin:calc(var(--d,2px) / -2) 0 0 calc(var(--d,2px) / -2);border-radius:50%;
  background:#ffe0b0;box-shadow:0 0 3px 1px rgba(255,190,110,.42);opacity:.9;animation:hc-o-tw var(--t,7s) ease-in-out var(--dl,0s) infinite alternate}
.hc-o-sky__tw i.c{background:#e4ecff;box-shadow:0 0 3px 1px rgba(150,185,255,.38)}
.hc-o-sky__tw i.hc-o-beacon{--d:4px;background:#ff3a2e;box-shadow:0 0 7px 2px rgba(255,58,40,.6);opacity:.08;animation:hc-o-beacon 2.4s ease-in-out var(--dl,0s) infinite}
@keyframes hc-o-tw{from{opacity:.95}to{opacity:.3}}
/* A slow, soft aviation light: about 12 % of each 2.4 s period lit, never a hard 1 Hz blink. */
@keyframes hc-o-beacon{0%{opacity:.08}6%{opacity:.9}12%{opacity:.9}20%{opacity:.08}100%{opacity:.08}}
/* Calm: after 30 s without input the sky holds still (WCAG 2.2.2); pointer or key input resumes it. */
.hc-office[data-calm] .hc-o-sky__tw i{animation-play-state:paused}
.hc-office[data-calm] .hc-o-sky__tw i.hc-o-beacon{animation:none;opacity:.5}
.hc-o-sky__shade{position:absolute;inset:0;background:
  linear-gradient(to bottom,rgba(3,4,7,.42) 0%,rgba(3,4,7,0) 24%,rgba(3,4,7,0) 58%,color-mix(in srgb,var(--o-void) 88%,transparent) 100%),
  linear-gradient(var(--o-sky-tint,transparent),var(--o-sky-tint,transparent))}

/* world: plate, people from above, light */
.hc-o-world{position:absolute;left:0;top:0;transform-origin:0 0;z-index:1;pointer-events:none}
.hc-office[data-moving] .hc-o-world{will-change:transform}
.hc-o-world>svg{position:absolute;left:0;top:0;overflow:visible;display:block}
.hc-o-light{mix-blend-mode:screen}
.hc-o-sl .mon,.hc-o-sl .lampl,.hc-o-sl .hand,.hc-o-sl .speak{opacity:0;transition:opacity var(--o-dur) ease-out}
.hc-o-sl[data-mon=on] .mon{opacity:1}
.hc-o-sl[data-mon=dim] .mon{opacity:.5}
.hc-o-sl[data-lamp] .lampl{opacity:1}
.hc-o-sl[data-halo=hand] .hand{opacity:1}
.hc-o-sl[data-halo=speak] .speak{opacity:1}
.hc-o-droplight{opacity:0;transition:opacity .2s}
.hc-o-droplight[data-on]{opacity:1}
.hc-office[data-tod=day] .hc-o-refl{display:none}
.hc-office[data-tod=day] .hc-o-pend{opacity:.45}
.hc-office[data-theme=light] .hc-o-refl{display:none}
.hc-o-bodies{transition:opacity .15s}
.hc-office:not([data-lod="0"]) .hc-o-bodies{opacity:0}
.hc-o-body .t{fill:color-mix(in srgb,var(--acc) 40%,#23262c)}
.hc-o-body .th{fill:color-mix(in srgb,var(--acc) 55%,#ffffff);opacity:.22}
.hc-office[data-theme=light] .hc-o-body .t{fill:color-mix(in srgb,var(--acc) 55%,#4a4e55)}

/* labels */
.hc-o-labels,.hc-o-people,.hc-o-bubbles{position:absolute;inset:0;pointer-events:none}
.hc-o-labels{z-index:2}
.hc-o-people{z-index:3}
.hc-o-bubbles{z-index:5}
.hc-o-label{position:absolute;left:0;top:0;white-space:nowrap;will-change:transform}
.hc-o-label__in{display:flex;flex-direction:column;gap:1px}
/* Neighbourhood and amenity signs: one line of small text on the floor at plan zoom (≥ 11 px, long names ellipsized
   to the cell), a door plate from L1. */
.hc-o-label--zone .hc-o-label__in,.hc-o-label--place .hc-o-label__in{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
  max-width:calc(var(--z,1.5) * 94px);line-height:1.2;letter-spacing:0;text-transform:none;
  font-size:max(11px,min(calc(var(--z,1.5) * 6.6px),12px));font-weight:600;color:color-mix(in srgb,var(--o-label) 80%,var(--o-label-strong))}
.hc-o-label--zone i{font-style:normal;font-weight:500;opacity:.6;letter-spacing:.04em}
.hc-o-label--zone .hc-o-label__in span{margin-right:5px}
.hc-o-label.is-center .hc-o-label__in{transform:translateX(-50%)}
.hc-office:not([data-lod="0"]) :is(.hc-o-label--zone,.hc-o-label--place) .hc-o-label__in{display:inline-flex;flex-direction:row;align-items:baseline;gap:6px;
  max-width:none;overflow:visible;opacity:1;margin-top:3px;padding:4px 9px 5px;border-radius:5px;background:linear-gradient(#202329,#17191d);
  border:1px solid rgba(255,255,255,.07);box-shadow:inset 0 1px 0 rgba(255,255,255,.06),0 4px 12px rgba(0,0,0,.45);font-size:11px;
  letter-spacing:.02em;text-transform:none;color:var(--o-label-strong)}
.hc-office:not([data-lod="0"]) .hc-o-label--zone i{color:var(--o-label);opacity:1}
.hc-office[data-theme=light]:not([data-lod="0"]) :is(.hc-o-label--zone,.hc-o-label--place) .hc-o-label__in{background:linear-gradient(#ffffff,#f2efe9);border-color:rgba(0,0,0,.1);box-shadow:0 3px 10px rgba(0,0,0,.12)}
.hc-o-label--room .hc-o-label__in,.hc-o-label--room .hc-o-label__in,.hc-o-label--chief .hc-o-label__in{transform:translate(-50%,-100%);align-items:center;
  padding:4px 8px 5px;border-radius:5px;background:linear-gradient(#202329,#17191d);border:1px solid rgba(255,255,255,.07);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.06),0 4px 12px rgba(0,0,0,.45)}
.hc-o-label--room b,.hc-o-label--chief b{font-size:11px;font-weight:650;color:var(--o-label-strong);letter-spacing:.01em}
.hc-o-label--room small,.hc-o-label--chief small,.hc-o-label--chief em{font-size:9.5px;color:var(--o-label);font-style:normal}
.hc-o-label--room .hc-o-label__in{transform:translate(-50%,-100%)}
.hc-office[data-lod="0"] .hc-o-label--room .hc-o-label__in{padding:2px 6px 3px;background:rgba(15,17,20,.72)}
.hc-office[data-lod="0"] .hc-o-label--room b{font-size:9.5px;letter-spacing:.1em;text-transform:uppercase}
.hc-o-label--chief .hc-o-label__in{transform:translate(0,-100%);align-items:flex-start}
.hc-office[data-lod="0"] .hc-o-label--chief .hc-o-label__in{padding:2px 6px 3px;background:rgba(15,17,20,.72)}
.hc-office[data-lod="0"] .hc-o-label--chief b{font-size:9.5px;letter-spacing:.1em;text-transform:uppercase}
.hc-office[data-lod="0"] .hc-o-label--chief em{display:none}
.hc-office[data-theme=light] .hc-o-label--room .hc-o-label__in,
.hc-office[data-theme=light] .hc-o-label--chief .hc-o-label__in{background:linear-gradient(#ffffff,#f2efe9);border-color:rgba(0,0,0,.1);box-shadow:0 3px 10px rgba(0,0,0,.12)}
.hc-office[data-mode=conference] .hc-o-labels{opacity:0;transition:opacity .2s}

/* seats */
.hc-o-seat{position:absolute;left:0;top:0;width:0;height:0;padding:0;margin:0;border:0;background:none;outline:none;cursor:pointer;
  pointer-events:none;will-change:transform;--fsx:var(--fs)}
.hc-o-seat[data-chief]{--fsx:calc(var(--fs) * 1.35)}
.hc-o-seat__hit{position:absolute;left:0;top:0;width:var(--hit);height:var(--hit);transform:translate(-50%,-50%);border-radius:50%;pointer-events:auto}
/* Plan zoom targets: at least 24 px (WCAG 2.5.8), 44 px on touch. */
.hc-office[data-lod="0"] .hc-o-seat__hit{width:max(24px,var(--hit));height:max(24px,var(--hit))}
@media (pointer:coarse){.hc-office[data-lod="0"] .hc-o-seat__hit{width:max(44px,var(--hit));height:max(44px,var(--hit))}}
.hc-office:not([data-lod="0"]) .hc-o-seat__hit{width:max(44px,var(--fsx));height:max(44px,var(--fsx))}
.hc-office[data-mode=conference] .hc-o-seat__hit,.hc-office[data-panning] .hc-o-seat__hit{pointer-events:none}
.hc-o-seat__shadow{position:absolute;left:0;top:calc(var(--fsx) * .42);width:calc(var(--fsx) * .9);height:calc(var(--fsx) * .22);
  transform:translate(-50%,-50%);border-radius:50%;background:radial-gradient(closest-side,rgba(0,0,0,.55),rgba(0,0,0,0));opacity:0;transition:opacity .15s}
.hc-o-seat__body{position:absolute;left:0;top:calc(var(--fsx) * .36);width:calc(var(--fsx) * 1.3);height:calc(var(--fsx) * .45);transform:translateX(-50%);
  border-radius:48% 48% 14% 14% / 80% 80% 20% 20%;background:color-mix(in srgb,var(--acc) 38%,#262a31);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.06),0 2px 5px rgba(0,0,0,.35);opacity:0;transition:opacity .15s;pointer-events:none}
.hc-office[data-theme=light] .hc-o-seat__body{background:color-mix(in srgb,var(--acc) 45%,#5d626b)}
.hc-o-seat__face{position:absolute;left:0;top:0;width:var(--fsx);height:var(--fsx);transform:translate(-50%,-50%);border-radius:50%;overflow:hidden;
  background:#1c1f24;box-shadow:0 3px 8px rgba(0,0,0,.5);opacity:0;transition:opacity .15s,transform var(--o-dur) var(--o-ease);--face-px:var(--fsx)}
.hc-o-seat__face>*{width:100%;height:100%;border-radius:inherit;display:block}
.hc-o-seat__ring{position:absolute;left:0;top:0;width:calc(var(--fsx) + 3px);height:calc(var(--fsx) + 3px);transform:translate(-50%,-50%);border-radius:50%;
  box-shadow:0 0 0 1.25px color-mix(in srgb,var(--acc) 72%,transparent);opacity:0;transition:opacity .15s,box-shadow var(--o-dur),transform var(--o-dur) var(--o-ease);pointer-events:none}
.hc-office:not([data-lod="0"]) .hc-o-seat[data-face] :is(.hc-o-seat__face,.hc-o-seat__ring,.hc-o-seat__shadow,.hc-o-seat__body){opacity:1}
.hc-o-seat[data-state=working] .hc-o-seat__ring{box-shadow:0 0 0 1.25px color-mix(in srgb,var(--acc) 72%,transparent),0 0 0 3px color-mix(in srgb,var(--state-working,var(--o-halo-speak)) 28%,transparent)}
.hc-o-seat[data-state=thinking] .hc-o-seat__ring{box-shadow:0 0 0 1.25px color-mix(in srgb,var(--acc) 72%,transparent),0 0 0 3px color-mix(in srgb,var(--state-thinking,var(--o-label)) 30%,transparent)}
.hc-o-seat[data-state=listening] .hc-o-seat__ring{box-shadow:0 0 0 2px color-mix(in srgb,var(--o-halo-hand) 60%,transparent)}
.hc-o-seat[data-state=raised_hand] .hc-o-seat__ring{box-shadow:0 0 0 2px var(--o-halo-hand),0 0 14px 2px color-mix(in srgb,var(--o-halo-hand) 45%,transparent)}
.hc-o-seat[data-state=raised_hand] .hc-o-seat__ring::after{content:"";position:absolute;right:-2px;top:-2px;width:28%;height:28%;min-width:9px;min-height:9px;border-radius:50%;
  background:var(--o-halo-hand);box-shadow:0 0 0 2px #111316}
.hc-o-seat[data-state=blocked] .hc-o-seat__ring{box-shadow:0 0 0 2px var(--blocked,#f08a4b)}
.hc-o-seat[data-state=away] .hc-o-seat__face{filter:saturate(.2) brightness(.7)}
.hc-o-seat[data-speaking] :is(.hc-o-seat__face,.hc-o-seat__ring){transform:translate(-50%,calc(-50% - 4px)) scale(1.15)}
/* The host's FaceView draws its own state ring and glyph: keep only the outer hover, focus and speaking halo here. */
.hc-o-seat[data-host-chrome] .hc-o-seat__ring{box-shadow:none}
.hc-o-seat[data-host-chrome] .hc-o-seat__ring::after{display:none}
.hc-o-seat[data-speaking] .hc-o-seat__ring{box-shadow:0 0 0 2.5px var(--o-halo-speak),0 0 22px 5px color-mix(in srgb,var(--o-halo-speak) 42%,transparent)}
.hc-o-seat[data-speaking][data-host-chrome] .hc-o-seat__ring{box-shadow:0 0 22px 5px color-mix(in srgb,var(--o-halo-speak) 42%,transparent)}
.hc-o-seat:is([data-hover],[data-tier=tile]) .hc-o-seat__ring{box-shadow:0 0 0 1.75px var(--acc),0 0 16px 2px color-mix(in srgb,var(--acc) 30%,transparent)}
.hc-o-seat:is([data-hover],[data-tier=tile])[data-host-chrome] .hc-o-seat__ring{box-shadow:0 0 16px 2px color-mix(in srgb,var(--acc) 30%,transparent)}
/* Focus is ink, never the speaking amber. */
.hc-o-seat:focus-visible .hc-o-seat__ring{opacity:1;box-shadow:var(--o-focus)}
.hc-o-seat:is([data-hover],:focus-visible){z-index:2}
.hc-office[data-lod="0"] .hc-o-seat[data-hover] .hc-o-seat__hit{box-shadow:0 0 0 1.5px color-mix(in srgb,var(--acc) 80%,transparent);background:color-mix(in srgb,var(--acc) 14%,transparent)}
/* After the hover rule: keyboard focus (which also wakes the hover) always shows the ink ring. */
.hc-office[data-lod="0"] .hc-o-seat:focus-visible .hc-o-seat__hit{box-shadow:var(--o-focus)}
.hc-office[data-lod="0"] .hc-o-seat__ring{display:none}
.hc-o-seat[data-dragging]{opacity:.35}
.hc-office[data-finding] .hc-o-seat:not([data-match]){opacity:.4}
.hc-office[data-finding][data-lod="0"] .hc-o-seat[data-match] .hc-o-seat__hit{box-shadow:0 0 0 2px var(--o-halo-speak);background:color-mix(in srgb,var(--o-halo-speak) 18%,transparent)}
.hc-office[data-mode=conference] .hc-o-seat{visibility:hidden}

.hc-o-seat__plate{position:absolute;left:0;top:calc(var(--fsx) * .74);transform:translateX(-50%);display:none;align-items:center;gap:3px;
  padding:0 6px 0 4px;height:16px;border-radius:999px;background:rgba(14,16,19,.9);color:var(--o-label-strong);font-size:10.5px;font-weight:600;
  line-height:16px;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.45),inset 0 0 0 1px rgba(255,255,255,.06);pointer-events:none;transition:transform var(--o-dur) var(--o-ease)}
.hc-office[data-theme=light] .hc-o-seat__plate{background:rgba(255,255,255,.94);box-shadow:0 1px 4px rgba(0,0,0,.18)}
.hc-o-seat__pip{width:6px;height:6px;border-radius:50%;background:var(--acc);flex:none;box-sizing:border-box}
.hc-o-seat[data-lamp] .hc-o-seat__pip{box-shadow:0 0 0 2px color-mix(in srgb,var(--o-halo-speak) 55%,transparent)}
/* The pip carries the state in the app's language (--state-*): working = a lamp dot with a lamp ring, thinking = a
   hollow muted ring, idle = the accent. The words are in the status line and the accessible name. */
.hc-o-seat[data-state=working] .hc-o-seat__pip{background:var(--state-working,var(--o-halo-speak));box-shadow:0 0 0 2px color-mix(in srgb,var(--state-working,var(--o-halo-speak)) 35%,transparent)}
.hc-o-seat[data-state=thinking] .hc-o-seat__pip{background:transparent;border:1.5px solid var(--state-thinking,var(--o-label))}
.hc-o-seat:is([data-state=raised_hand],[data-state=listening]) .hc-o-seat__pip{background:var(--o-halo-hand)}
.hc-o-seat[data-state=blocked] .hc-o-seat__pip{background:var(--blocked,#f08a4b)}
.hc-o-seat[data-speaking] .hc-o-seat__pip{background:var(--o-halo-speak);box-shadow:none;border:0}
.hc-o-seat__name{max-width:calc(var(--pitch,96px) - 6px);overflow:hidden;text-overflow:ellipsis}
.hc-o-seat__name::after{content:attr(data-first)}
.hc-o-seat:is([data-hover],:focus-visible) .hc-o-seat__name{max-width:none}
.hc-office[data-names] .hc-o-seat[data-face] .hc-o-seat__plate{display:flex}
.hc-office:is([data-names=short],[data-names=full]) .hc-o-seat__plate{height:18px;line-height:18px;font-size:11px}
.hc-office[data-names=short] .hc-o-seat__name::after{content:attr(data-short)}
.hc-office[data-names=full] .hc-o-seat__name::after{content:attr(data-full)}
.hc-office[data-lod="0"] .hc-o-seat:is([data-hover],:focus-visible) .hc-o-seat__plate{display:flex;top:calc(max(24px,var(--hit)) * .5 + 3px)}
.hc-office[data-lod="0"] .hc-o-seat:is([data-hover],:focus-visible) .hc-o-seat__name{max-width:none}
.hc-office[data-lod="0"] .hc-o-seat:is([data-hover],:focus-visible) .hc-o-seat__name::after{content:attr(data-full)}
.hc-o-seat__sub{position:absolute;left:0;top:calc(var(--fsx) * .74 + 21px);transform:translateX(-50%);width:max-content;max-width:calc(var(--pitch,170px) - 6px);overflow:hidden;
  white-space:normal;display:none;-webkit-line-clamp:2;-webkit-box-orient:vertical;text-align:center;line-height:1.25;
  font-size:10.5px;color:var(--o-label);text-shadow:0 1px 2px rgba(0,0,0,.9),0 0 6px rgba(0,0,0,.7)}
.hc-office:is([data-names=short],[data-names=full]) .hc-o-seat[data-sub="1"][data-face] .hc-o-seat__sub{display:-webkit-box}
.hc-o-seat[data-speaking] .hc-o-seat__plate{transform:translate(-50%,4px)}

/* faces without a host factory */
.hc-o-initials{display:grid;place-items:center;width:100%;height:100%;border-radius:50%;color:#fff;font-weight:650;letter-spacing:.02em;
  font-size:calc(var(--face-px,32px) * .36);background:radial-gradient(circle at 32% 26%,color-mix(in srgb,var(--acc) 62%,#fff 6%),color-mix(in srgb,var(--acc) 38%,#101114))}

/* bubbles */
.hc-o-bubble,.hc-o-anchor{position:absolute;left:0;top:0;width:0;height:0;will-change:transform}
.hc-o-anchor{pointer-events:auto}
.hc-o-bubble__in{position:absolute;left:0;bottom:8px;transform:translateX(-50%);width:max-content;max-width:260px;padding:8px 12px 9px;border-radius:12px;
  background:rgba(22,24,29,.96);border:1px solid rgba(255,255,255,.08);box-shadow:0 10px 28px rgba(0,0,0,.5);pointer-events:auto;transition:opacity .2s ease,translate .2s ease}
.hc-o-bubble__in::after{content:"";position:absolute;left:50%;bottom:-6px;width:10px;height:10px;margin-left:-5px;transform:rotate(45deg);background:rgb(22,24,29);
  border-right:1px solid rgba(255,255,255,.08);border-bottom:1px solid rgba(255,255,255,.08)}
.hc-o-bubble__who{display:block;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--acc);margin-bottom:2px}
.hc-o-bubble__text{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:13px;line-height:1.38;color:var(--o-label-strong)}
.hc-o-bubble.is-entering .hc-o-bubble__in,.hc-o-bubble.is-leaving .hc-o-bubble__in{opacity:0;translate:0 4px}
.hc-office[data-theme=light] .hc-o-bubble__in{background:rgba(255,255,255,.98);border-color:rgba(0,0,0,.08);box-shadow:0 10px 28px rgba(0,0,0,.16)}
.hc-office[data-theme=light] .hc-o-bubble__in::after{background:#fff;border-color:rgba(0,0,0,.08)}
.hc-o-arc{position:absolute;left:0;top:0;pointer-events:none;overflow:visible}
.hc-o-arc path{fill:none;stroke:var(--o-halo-speak);stroke-width:1.5;stroke-linecap:round;stroke-dasharray:1;stroke-dashoffset:1;animation:hc-o-arc 1.2s ease-out forwards}
@keyframes hc-o-arc{0%{stroke-dashoffset:1;opacity:1}70%{stroke-dashoffset:0;opacity:1}100%{stroke-dashoffset:0;opacity:0}}
.hc-o-ghost{position:absolute;left:0;top:0;width:54px;height:54px;margin:-27px 0 0 -27px;border-radius:50%;overflow:hidden;z-index:30;pointer-events:none;
  box-shadow:0 10px 26px rgba(0,0,0,.55),0 0 0 2px var(--acc);--face-px:54px}
.hc-o-ghost>*{width:100%;height:100%}
.hc-o-ghost.is-returning{transition:transform .26s var(--o-ease)}

/* HUD */
.hc-o-hud{position:absolute;inset:0;pointer-events:none;z-index:20}
/* A soft scrim under the desk-mode HUD so its controls never sit directly on faces. */
.hc-o-hud::before{content:"";position:absolute;left:0;right:0;top:0;height:72px;pointer-events:none;
  background:linear-gradient(color-mix(in srgb,var(--o-void) 60%,transparent),transparent)}
.hc-office[data-mode=conference] .hc-o-hud::before{display:none}
.hc-o-hud>*{pointer-events:auto}
.hc-o-seg{position:absolute;top:14px;left:50%;transform:translateX(-50%);display:flex;padding:3px;border-radius:999px;background:var(--o-hud);
  border:1px solid var(--o-hud-line);box-shadow:0 8px 24px rgba(0,0,0,.35);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}
.hc-o-seg__opt{appearance:none;border:0;background:none;color:var(--o-hud-muted);font-size:12.5px;font-weight:600;padding:7px 15px;border-radius:999px;cursor:pointer}
.hc-o-seg__opt[aria-checked=true]{background:color-mix(in srgb,var(--o-hud-ink) 12%,transparent);color:var(--o-hud-ink)}
.hc-o-seg__opt:focus-visible,.hc-o-btn:focus-visible,.hc-o-zoom__btn:focus-visible,.hc-o-menu__item:focus-visible{outline:2px solid var(--o-label-strong);outline-offset:1px}
.hc-o-tools{position:absolute;top:14px;right:14px;display:flex;gap:8px;align-items:flex-start}
.hc-o-btn{appearance:none;display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 13px;border-radius:999px;border:1px solid var(--o-hud-line);
  background:var(--o-hud);color:var(--o-hud-ink);font-size:12.5px;font-weight:600;cursor:pointer;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);white-space:nowrap}
.hc-o-btn:hover{background:color-mix(in srgb,var(--o-hud) 80%,var(--o-hud-ink) 10%)}
.hc-o-btn:disabled{opacity:.45;cursor:default}
.hc-o-btn--primary{background:var(--o-halo-speak);border-color:transparent;color:#1b1406}
.hc-o-btn--primary:hover{background:color-mix(in srgb,var(--o-halo-speak) 88%,#fff)}
.hc-o-btn--ghost{background:transparent;backdrop-filter:none}
.hc-office kbd{font:500 10px/1 ui-monospace,SFMono-Regular,Menlo,monospace;padding:3px 5px;border-radius:4px;background:color-mix(in srgb,var(--o-hud-ink) 9%,transparent);color:var(--o-hud-muted)}
.hc-o-find{position:relative}
.hc-o-input{appearance:none;height:32px;width:230px;padding:0 13px;border-radius:999px;border:1px solid var(--o-hud-line);background:var(--o-hud);color:var(--o-hud-ink);
  font:inherit;font-size:12.5px;outline:none;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}
.hc-o-input::placeholder{color:var(--o-hud-muted)}
.hc-o-input:focus{border-color:color-mix(in srgb,var(--o-label-strong) 45%,transparent)}
.hc-o-menu{position:absolute;top:calc(100% + 6px);right:0;min-width:240px;max-height:min(60vh,420px);overflow:auto;padding:5px;border-radius:12px;
  background:color-mix(in srgb,var(--o-hud) 96%,#000);border:1px solid var(--o-hud-line);box-shadow:0 16px 40px rgba(0,0,0,.5);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);z-index:5}
.hc-o-menu__item{display:flex;flex-direction:column;align-items:flex-start;width:100%;padding:7px 10px;border:0;border-radius:8px;background:none;color:var(--o-hud-ink);
  text-align:left;cursor:pointer;font-size:12.5px}
.hc-o-menu__item small{color:var(--o-hud-muted);font-size:11px}
.hc-o-menu__item:hover,.hc-o-menu__item[aria-selected=true]{background:color-mix(in srgb,var(--o-hud-ink) 9%,transparent)}
.hc-o-menu__sep{height:1px;margin:4px 6px;background:var(--o-hud-line)}
.hc-o-menu__none{padding:10px;color:var(--o-hud-muted)}
.hc-o-zoom{position:absolute;right:14px;bottom:14px;display:flex;flex-direction:column;border-radius:12px;overflow:hidden;background:var(--o-hud);
  border:1px solid var(--o-hud-line);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}
.hc-o-zoom__btn{appearance:none;width:34px;height:34px;display:grid;place-items:center;border:0;background:none;color:var(--o-hud-ink);cursor:pointer}
.hc-o-zoom__btn+.hc-o-zoom__btn{border-top:1px solid var(--o-hud-line)}
.hc-o-zoom__btn svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.hc-o-zoom__btn:hover{background:color-mix(in srgb,var(--o-hud-ink) 8%,transparent)}
.hc-o-mini{position:absolute;left:14px;bottom:14px;width:184px;height:74px;padding:4px;border-radius:10px;background:var(--o-hud);border:1px solid var(--o-hud-line);
  backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);cursor:pointer}
.hc-o-mini svg{width:176px;height:66px;display:block}
.hc-o-mini rect{fill:color-mix(in srgb,var(--o-hud-ink) 10%,transparent)}
.hc-o-mini .hc-o-mini__room,.hc-o-mini .hc-o-mini__chief{fill:color-mix(in srgb,var(--o-halo-hand) 22%,transparent)}
.hc-o-mini .hc-o-mini__amenity{fill:color-mix(in srgb,var(--o-halo-speak) 16%,transparent)}
.hc-o-mini .hc-o-mini__view{fill:color-mix(in srgb,var(--o-halo-speak) 8%,transparent);stroke:var(--o-halo-speak);stroke-width:1}
.hc-office[data-mode=conference] :is(.hc-o-tools,.hc-o-zoom,.hc-o-mini){display:none}

/* conference stage */
.hc-o-stage{position:absolute;inset:0;z-index:15;overflow:hidden;overflow:clip;background:#090a0c;transition:opacity .25s ease;--floor-y:60%}
.hc-o-stage[hidden]{display:none}
.hc-o-stage:focus{outline:none}
.hc-o-stage.is-entering,.hc-o-stage.is-leaving{opacity:0}
.hc-o-stage__bg{position:absolute;inset:0;overflow:hidden}
.hc-o-stage__bg::after{content:"";position:absolute;left:0;right:0;top:var(--floor-y);bottom:0;
  background:linear-gradient(#121317,#0b0c0e 60%,#08090a);box-shadow:0 -1px 0 rgba(255,255,255,.05)}
.hc-o-stage__frame{position:absolute;background-size:cover;background-position:center}
.hc-o-stage__frame>img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
.hc-o-stage__frame--vector{inset:0;background:radial-gradient(120% 60% at 50% 45%,#233049,#0b0f18 70%)}
.hc-o-stage__frame--wall>img{filter:brightness(.82) saturate(.92)}
.hc-o-stage__frame--wall::after{content:"";position:absolute;inset:0;background:linear-gradient(to bottom,rgba(0,0,0,.2),rgba(0,0,0,0) 30%,rgba(0,0,0,.35))}
.hc-o-stage__garden{position:absolute;inset:0;width:100%;height:100%}
.hc-o-stage__glass{position:absolute;left:0;right:0;top:0;pointer-events:none;background:linear-gradient(to bottom,rgba(0,0,0,.45),rgba(0,0,0,0) 26%,rgba(0,0,0,0) 80%,rgba(0,0,0,.25))}
.hc-o-stage__glass i{position:absolute;top:0;bottom:0;width:4px;margin-left:-2px;background:linear-gradient(to right,#07080a,#1d2127 50%,#07080a)}
.hc-o-stage__glass b{position:absolute;left:0;right:0;height:6px;background:#07080a}
.hc-o-stage__glass u{position:absolute;left:0;right:0;height:4px;background:#07080a;opacity:.85}
.hc-o-stage[data-view=garden] .hc-o-stage__glass{display:none}
.hc-o-stage__table{position:absolute;left:0;top:0;pointer-events:none;z-index:1}
.hc-o-stage__pool{transition:cx .4s var(--o-ease),cy .4s var(--o-ease)}
.hc-o-stage__puck{fill:color-mix(in srgb,var(--o-halo-hand) 70%,#000)}
.hc-o-stage__cards{position:absolute;inset:0;pointer-events:none;z-index:2}
.hc-o-tent{position:absolute;left:0;top:0;transform:translate(-50%,0);transform-origin:50% 0;
  padding:calc(2px + 3px * var(--cs,1)) calc(5px + 6px * var(--cs,1)) calc(3px + 3px * var(--cs,1));border-radius:4px;
  background:linear-gradient(#25282e,#17191d);border:1px solid rgba(255,255,255,.07);box-shadow:inset 0 1px 0 rgba(255,255,255,.07),0 6px 12px rgba(0,0,0,.45);
  text-align:center;white-space:nowrap;transition:opacity .3s,translate .3s,box-shadow .25s,border-color .25s}
.hc-o-tent b{display:block;font-size:max(11px,calc(13px * var(--cs,1)));line-height:1.25;font-weight:650;color:var(--o-label-strong)}
.hc-o-tent small{display:block;font-size:max(10px,calc(11px * var(--cs,1)));line-height:1.25;color:color-mix(in srgb,var(--o-label) 85%,var(--o-label-strong))}
.hc-o-tent::before{content:"";position:absolute;left:10px;right:10px;top:0;height:1.5px;background:var(--acc);opacity:.7;border-radius:2px}
.hc-o-tent[data-speaking]{border-color:color-mix(in srgb,var(--o-halo-speak) 60%,transparent);box-shadow:0 0 22px color-mix(in srgb,var(--o-halo-speak) 35%,transparent),0 6px 12px rgba(0,0,0,.45)}
.hc-o-tent[data-speaking] b{color:#ffe2b4}
.hc-o-tent.is-arriving{opacity:0;translate:0 6px}
.hc-o-stage__seats{position:absolute;inset:0;z-index:3;pointer-events:none}
.hc-o-stage__empties{position:absolute;inset:0}
.hc-o-sseat{position:absolute;width:0;height:0;pointer-events:none;transition:opacity .3s,translate .3s var(--o-ease),filter .3s;--s:1;--fs:100px}
.hc-o-sseat.is-arriving{opacity:0;translate:26px 0}
.hc-o-sseat[data-side=left].is-arriving{translate:-26px 0}
.hc-o-sseat__face{position:absolute;left:0;top:0;width:var(--fs);height:var(--fs);padding:0;border:0;border-radius:50%;background:#1a1d22;cursor:pointer;pointer-events:auto;
  transform:translate(-50%,-50%) perspective(600px) rotateY(var(--tilt,0deg)) scale(var(--s));transition:transform .4s var(--o-ease);
  box-shadow:0 14px 34px rgba(0,0,0,.6);--face-px:var(--fs);outline:none}
.hc-o-sseat__facebox{position:absolute;inset:0;border-radius:50%;overflow:hidden}
.hc-o-sseat__facebox>*{width:100%;height:100%;display:block;border-radius:inherit}
.hc-o-sseat__ring{position:absolute;inset:-3px;border-radius:50%;box-shadow:0 0 0 1.5px color-mix(in srgb,var(--acc) 75%,transparent);pointer-events:none;transition:box-shadow .25s}
.hc-o-sseat[data-speaking]{--s:1.18}
.hc-o-sseat[data-speaking] .hc-o-sseat__ring{box-shadow:0 0 0 3px var(--o-halo-speak),0 0 34px 8px color-mix(in srgb,var(--o-halo-speak) 40%,transparent)}
.hc-o-sseat[data-state=thinking] .hc-o-sseat__ring{box-shadow:0 0 0 1.5px color-mix(in srgb,var(--acc) 75%,transparent),0 0 0 5px rgba(255,255,255,.06)}
.hc-o-sseat[data-state=raised_hand] .hc-o-sseat__ring{box-shadow:0 0 0 3px var(--o-halo-hand)}
.hc-o-sseat[data-host-chrome]:not([data-speaking]) .hc-o-sseat__ring{box-shadow:none}
.hc-o-sseat[data-host-chrome][data-speaking] .hc-o-sseat__ring{box-shadow:0 0 34px 8px color-mix(in srgb,var(--o-halo-speak) 40%,transparent)}
/* Listeners dim by brightness, not opacity, so far faces never turn translucent over the city lights. */
.hc-o-sseat__facebox{transition:filter .3s}
.hc-o-stage[data-speaking] .hc-o-sseat:not([data-speaking]) .hc-o-sseat__facebox{filter:brightness(.62) saturate(.85)}
.hc-o-sseat__face:focus-visible .hc-o-sseat__ring{box-shadow:var(--o-focus)}
.hc-o-sseat__name{display:none;position:absolute;left:0;top:calc(var(--fs) * .5 + 6px);transform:translateX(-50%);font-size:11.5px;font-weight:600;white-space:nowrap;
  color:var(--o-label-strong);text-shadow:0 1px 3px #000}
.hc-o-sseat__back{position:absolute;left:0;top:calc(var(--fs) * -.5 - 30px);transform:translateX(-50%);height:24px;padding:0 10px;border-radius:999px;border:1px solid var(--o-hud-line);
  background:var(--o-hud);color:var(--o-hud-ink);font-size:11px;font-weight:600;white-space:nowrap;cursor:pointer;opacity:0;pointer-events:none;transition:opacity .15s}
.hc-o-sseat:hover .hc-o-sseat__back,.hc-o-sseat:focus-within .hc-o-sseat__back{opacity:1;pointer-events:auto}
.hc-o-sseat__face:hover~.hc-o-sseat__back,.hc-o-sseat__back:hover{opacity:1;pointer-events:auto}
.hc-o-stage__head{position:absolute;left:0;right:0;top:0;height:64px;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 18px 0 22px;z-index:400;
  background:linear-gradient(rgba(5,6,8,.78),rgba(5,6,8,0))}
.hc-o-stage__title{display:flex;align-items:baseline;gap:10px;min-width:0;overflow:hidden;white-space:nowrap}
.hc-o-stage__title b{font-size:15px;font-weight:650;color:var(--o-label-strong)}
.hc-o-stage__title span{color:var(--o-label);font-size:13px;overflow:hidden;text-overflow:ellipsis}
.hc-o-stage__clock{font-variant-numeric:tabular-nums;opacity:.8}
.hc-o-stage__actions{display:flex;gap:8px}
.hc-o-btn--leave{border-color:color-mix(in srgb,var(--o-halo-speak) 30%,transparent)}
.hc-o-stage__empty{position:absolute;left:50%;top:40%;transform:translate(-50%,-50%);z-index:350;padding:10px 18px;border-radius:999px;background:rgba(10,11,13,.72);
  border:1px solid rgba(255,255,255,.07);color:var(--o-label);font-size:13.5px;white-space:nowrap;backdrop-filter:blur(8px)}
.hc-o-stage__empty[hidden]{display:none}
.hc-o-stage__bottom{position:absolute;left:50%;bottom:18px;transform:translateX(-50%);width:min(760px,calc(100% - 32px));display:flex;flex-direction:column;gap:8px;z-index:400}
.hc-o-stage__floor{display:flex;align-items:center;gap:6px;min-height:0;font-size:11.5px;color:var(--o-label)}
.hc-o-stage__floor:empty{display:none}
.hc-o-stage__floorlbl{text-transform:uppercase;letter-spacing:.1em;font-size:10px;font-weight:650}
.hc-o-stage__chip{display:inline-flex;align-items:center;gap:5px;padding:2px 8px 2px 2px;border-radius:999px;background:rgba(15,17,20,.75);border:1px solid rgba(255,255,255,.07);color:var(--o-label-strong)}
.hc-o-stage__chipface{width:20px;height:20px;border-radius:50%;overflow:hidden;box-shadow:0 0 0 1px var(--acc);--face-px:20px}
.hc-o-stage__chipface>*{width:100%;height:100%;display:block}
.hc-o-stage__arrow{opacity:.5}
.hc-o-stage__cap{display:flex;flex-direction:column;gap:3px;padding:10px 14px 11px;border-radius:12px;background:rgba(9,10,12,.82);border:1px solid rgba(255,255,255,.07);
  backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}
.hc-o-stage__cap[hidden]{display:none}
.hc-o-cap__who{display:flex;align-items:baseline}
.hc-o-stage__cap b{font-size:10.5px;letter-spacing:.12em;font-weight:700}
.hc-o-cap__tag{margin-left:8px;font-size:10px;letter-spacing:.1em;text-transform:uppercase;font-weight:600;color:var(--o-label)}
.hc-o-cap__tag[hidden]{display:none}
.hc-o-cap__text{font-size:15px;line-height:1.4;color:var(--o-label-strong);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.hc-o-stage__dock{min-height:48px}
.hc-o-compose{display:flex;gap:8px;padding:6px;border-radius:999px;background:rgba(15,17,20,.86);border:1px solid rgba(255,255,255,.08);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}
.hc-o-compose .hc-o-input{flex:1;width:auto;border:0;background:transparent;backdrop-filter:none;height:36px;font-size:14px}
.hc-o-compose .hc-o-btn{height:36px}
.hc-o-stage[data-narrow] .hc-o-stage__head{height:auto;flex-wrap:wrap;padding:10px 12px;gap:8px}
.hc-o-stage[data-narrow] .hc-o-stage__title span:not(.hc-o-stage__clock){display:none}
.hc-o-stage[data-narrow] .hc-o-btn kbd{display:none}
.hc-o-stage[data-narrow] .hc-o-tent{display:none}
.hc-o-stage[data-narrow] .hc-o-sseat__name{display:block}
@media (max-width:899px){.hc-office[data-mode=conference] .hc-o-seg{display:none}}
.hc-o-stage[data-narrow] .hc-o-stage__empty{white-space:normal;width:min(320px,calc(100% - 32px));text-align:center;border-radius:14px}

/* picker */
/* One row the height of the office (never the list's height), the panel centred in it and never taller than 80 %. */
.hc-o-picker{position:absolute;inset:0;z-index:500;display:grid;grid-template-rows:minmax(0,1fr);grid-template-columns:minmax(0,1fr);place-items:center;background:rgba(3,4,6,.55);backdrop-filter:blur(3px)}
.hc-o-picker__panel{align-self:normal;width:min(460px,calc(100% - 24px));max-height:min(80%,640px);min-height:0;display:flex;flex-direction:column;gap:10px;padding:16px;border-radius:16px;
  background:#15171b;border:1px solid rgba(255,255,255,.08);box-shadow:0 30px 80px rgba(0,0,0,.6)}
.hc-office[data-theme=light] .hc-o-picker__panel{background:#fff;border-color:rgba(0,0,0,.08)}
.hc-o-picker__head{display:flex;align-items:center;justify-content:space-between}
.hc-o-picker__head h2{margin:0;font-size:15px;font-weight:650}
.hc-o-picker .hc-o-input{width:100%;backdrop-filter:none}
.hc-o-picker__list{overflow:auto;flex:1;min-height:120px;margin:0 -6px;padding:0 6px}
.hc-o-picker__list section{padding:4px 0}
.hc-o-picker__list section[hidden]{display:none}
.hc-o-picker__list h3{margin:8px 4px 4px;font-size:10px;letter-spacing:.11em;text-transform:uppercase;color:var(--o-label);font-weight:650}
.hc-o-picker__row{display:flex;align-items:center;gap:10px;padding:6px 6px;border-radius:9px;cursor:pointer}
.hc-o-picker__row[hidden]{display:none}
.hc-o-picker__row:hover{background:rgba(255,255,255,.05)}
.hc-o-picker__row input{accent-color:var(--o-halo-speak);width:16px;height:16px;margin:0}
.hc-o-picker__row:focus-within{background:rgba(255,255,255,.05)}
.hc-o-picker__face{width:30px;height:30px;border-radius:50%;overflow:hidden;flex:none;background:#20232a;box-shadow:0 0 0 1px color-mix(in srgb,var(--acc) 70%,transparent);--face-px:30px}
.hc-o-picker__face>*{width:100%;height:100%;display:block}
.hc-o-picker__txt{display:flex;flex-direction:column;min-width:0}
.hc-o-picker__txt b{font-size:13px;font-weight:600}
.hc-o-picker__txt small{font-size:11.5px;color:var(--o-label);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hc-o-picker__row[data-here]{opacity:.6}
.hc-o-picker__foot{display:flex;align-items:center;justify-content:space-between;gap:10px}
.hc-o-picker__note{font-size:12px;color:var(--o-label)}
.hc-o-picker__note[data-full]{color:var(--o-halo-speak)}

/* office life (OFFICE-LIFE §2.6, §3.3–§3.5, §4) */
.hc-o-seat__face{rotate:var(--lean,0deg);transition:opacity .15s,transform var(--o-dur) var(--o-ease),rotate .35s var(--o-ease),translate .25s var(--o-ease)}
.hc-o-seat[data-talking] :is(.hc-o-seat__face,.hc-o-seat__ring){translate:0 -2px}
.hc-o-seat[data-fade],.hc-o-body[data-fade]{transition:opacity .16s linear}
.hc-o-seat[data-fade=out],.hc-o-body[data-fade=out]{opacity:0}
.hc-office[data-rm] .hc-o-seat[data-fade],.hc-office[data-rm] .hc-o-body[data-fade]{transition:opacity .16s linear!important}
.hc-o-seat[data-cue=nod] .hc-o-seat__face{animation:hc-o-nod .6s ease-in-out}
.hc-o-seat[data-cue=look_up] .hc-o-seat__face{animation:hc-o-lookup .8s ease-out}
.hc-o-seat[data-cue=smile] .hc-o-seat__face{animation:hc-o-smile .9s ease-out}
.hc-o-seat[data-cue=head_tilt] .hc-o-seat__face{animation:hc-o-tilt .8s ease-in-out}
.hc-o-seat[data-cue=brow_flash] .hc-o-seat__face{animation:hc-o-flash .6s ease-out}
@keyframes hc-o-nod{0%,100%{translate:0 0}35%{translate:0 2px}65%{translate:0 -1px}}
@keyframes hc-o-lookup{0%,100%{translate:0 0}30%{translate:0 -3px}}
@keyframes hc-o-smile{0%,100%{scale:1}40%{scale:1.06}}
@keyframes hc-o-tilt{0%,100%{rotate:var(--lean,0deg)}50%{rotate:calc(var(--lean,0deg) + 7deg)}}
@keyframes hc-o-flash{50%{filter:brightness(1.18)}}
.hc-o-bubble__in{translate:var(--bx,0px) var(--by,0px)}
.hc-o-bubble__in::after{translate:calc(-1 * var(--bx,0px)) 0}
.hc-o-bubble.is-narrow .hc-o-bubble__in{max-width:200px}
/* Replies in a joined huddle's chat never swallow a click meant for someone underneath. */
.hc-o-bubble--passive,.hc-o-bubble--passive .hc-o-bubble__in{pointer-events:none}
/* A laugh: a muted caption chip beside the face, no name and no tail. */
.hc-o-chip{position:absolute;left:0;top:0;width:0;height:0;will-change:transform;pointer-events:none}
.hc-o-chip__in{position:absolute;left:0;top:0;white-space:nowrap;padding:2px 8px 3px;border-radius:999px;font-size:11.5px;line-height:15px;font-style:italic;
  color:var(--o-label);background:color-mix(in srgb,var(--o-void) 72%,transparent);box-shadow:0 2px 8px rgba(0,0,0,.25);transition:opacity .2s ease,translate .2s ease}
.hc-o-chip.is-entering .hc-o-chip__in,.hc-o-chip.is-leaving .hc-o-chip__in{opacity:0;translate:-3px 0}
.hc-office[data-theme=light] .hc-o-chip__in{background:rgba(255,255,255,.9);box-shadow:0 2px 8px rgba(0,0,0,.12)}
/* Walkers at plan zoom: an accent dot with a short fading trail, on its own layer (the plate never repaints). */
.hc-o-walkers{position:absolute;inset:0;pointer-events:none;z-index:2;overflow:hidden}
.hc-office:not([data-lod="0"]) .hc-o-walkers{display:none}
.hc-o-walker,.hc-o-walker__trail{position:absolute;left:0;top:0;border-radius:50%;background:var(--acc);will-change:transform}
.hc-o-walker{width:7px;height:7px;margin:-3.5px 0 0 -3.5px;box-shadow:0 0 0 1.5px rgba(10,12,15,.85),0 0 9px color-mix(in srgb,var(--acc) 65%,transparent)}
.hc-o-walker__trail{width:5px;height:5px;margin:-2.5px 0 0 -2.5px;opacity:calc(.46 - var(--k,0) * .052);scale:calc(1 - var(--k,0) * .08)}
.hc-office[data-theme=light] .hc-o-walker{box-shadow:0 0 0 1.5px rgba(255,255,255,.9),0 0 6px color-mix(in srgb,var(--acc) 55%,transparent)}
.hc-office[data-lod="0"] .hc-o-body[data-walking]{opacity:0}
.hc-o-label{transition:opacity .25s ease}
.hc-o-label.is-crossed{opacity:.4}
.hc-o-bubble.is-below .hc-o-bubble__in{bottom:auto;top:calc(var(--fsx,var(--fs)) + 30px)}
.hc-o-bubble.is-below .hc-o-bubble__in::after{bottom:auto;top:-6px;transform:rotate(225deg)}
.hc-o-bubble:is(.is-right,.is-left) .hc-o-bubble__in{bottom:auto;top:calc(var(--fs) * .5 + 6px);translate:0 calc(-50% + var(--sy,0px))}
.hc-o-bubble.is-right .hc-o-bubble__in{left:calc(var(--fs) * .5 + 12px);transform:none}
.hc-o-bubble.is-left .hc-o-bubble__in{left:auto;right:calc(var(--fs) * .5 + 12px);transform:none}
.hc-o-bubble:is(.is-right,.is-left) .hc-o-bubble__in::after{bottom:auto;top:clamp(12px,calc(50% - var(--sy,0px)),calc(100% - 12px));margin:-5px 0 0;translate:none}
.hc-o-bubble.is-right .hc-o-bubble__in::after{left:-6px;transform:rotate(135deg)}
.hc-o-bubble.is-left .hc-o-bubble__in::after{left:auto;right:-6px;transform:rotate(-45deg)}
.hc-o-bubble--talk,.hc-o-bubble--talk .hc-o-bubble__in{pointer-events:none}
.hc-o-bubble--talk .hc-o-bubble__in{max-width:240px;padding:7px 11px 8px}
.hc-o-bubble--talk .hc-o-bubble__text{font-size:12.5px}
.hc-o-bubble--talk.is-nonverbal .hc-o-bubble__text{font-style:italic;color:var(--o-label)}
.hc-o-ghostplate{position:absolute;left:0;top:0;translate:-50% -50%;display:flex;flex-direction:column;align-items:center;max-width:calc(var(--pitch,72px) + 12px);
  padding:3px 7px 4px;border-radius:8px;font-size:10.5px;line-height:1.2;text-align:center;color:var(--o-label);
  background:color-mix(in srgb,var(--o-void) 78%,transparent);border:1px dashed color-mix(in srgb,var(--o-label) 35%,transparent);pointer-events:none}
.hc-o-ghostplate :is(b,span){max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hc-o-ghostplate b{font-weight:650;color:var(--o-label-strong)}
.hc-office[data-mode=conference] .hc-o-ghostplate{display:none}
.hc-o-huddles{position:absolute;inset:0;pointer-events:none;z-index:3}
.hc-o-huddle{position:absolute;left:0;top:0;width:0;height:0;padding:0;margin:0;border:0;background:none;pointer-events:none;will-change:transform;outline:none}
.hc-o-huddle__ring{position:absolute;left:0;top:0;width:calc(34px * var(--z,1));height:calc(21px * var(--z,1));min-width:30px;min-height:20px;transform:translate(-50%,-50%);
  border-radius:50%;pointer-events:auto;cursor:pointer;transition:background .2s,box-shadow .2s}
.hc-o-huddle:is(:hover,:focus-visible) .hc-o-huddle__ring,.hc-o-huddle[data-joined] .hc-o-huddle__ring{background:color-mix(in srgb,var(--o-label-strong) 6%,transparent);
  box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--o-label-strong) 22%,transparent)}
.hc-o-huddle:focus-visible .hc-o-huddle__ring{box-shadow:var(--o-focus)}
.hc-o-huddle__dots{display:none;position:absolute;left:0;top:0;transform:translate(-50%,calc(-100% - 20px));gap:2.5px;padding:4px 6px;border-radius:999px;
  background:rgba(15,17,20,.78);border:1px solid rgba(255,255,255,.08);pointer-events:auto;cursor:pointer}
.hc-office[data-lod="0"] .hc-o-huddle__dots{display:flex}
.hc-office[data-lod="0"] .hc-o-huddle__ring{width:30px;height:20px}
.hc-o-huddle__dots i{width:3.5px;height:3.5px;border-radius:50%;background:var(--o-label-strong);opacity:.6}
.hc-o-huddle[data-talking="1"] .hc-o-huddle__dots i{animation:hc-o-dots 1.2s ease-in-out infinite}
.hc-o-huddle[data-talking="1"] .hc-o-huddle__dots i:nth-child(2){animation-delay:.2s}
.hc-o-huddle[data-talking="1"] .hc-o-huddle__dots i:nth-child(3){animation-delay:.4s}
.hc-o-huddle[data-listening] .hc-o-huddle__dots{border-color:color-mix(in srgb,var(--o-halo-speak) 60%,transparent)}
/* While a line runs, the plan-zoom glyph pulses in the speaker's accent. */
.hc-o-huddle[data-speaking] .hc-o-huddle__dots{border-color:color-mix(in srgb,var(--acc) 75%,transparent);box-shadow:0 0 0 3px color-mix(in srgb,var(--acc) 22%,transparent),0 0 14px color-mix(in srgb,var(--acc) 35%,transparent)}
.hc-o-huddle[data-speaking] .hc-o-huddle__dots i{background:var(--acc);opacity:1;animation:hc-o-dots .9s ease-in-out infinite}
.hc-o-huddle[data-speaking] .hc-o-huddle__dots i:nth-child(2){animation-delay:.15s}
.hc-o-huddle[data-speaking] .hc-o-huddle__dots i:nth-child(3){animation-delay:.3s}
@keyframes hc-o-dots{0%,100%{opacity:.3}50%{opacity:.95}}
.hc-office[data-theme=light] .hc-o-huddle__dots{background:rgba(255,255,255,.92);border-color:rgba(0,0,0,.1)}
.hc-office[data-theme=light] .hc-o-huddle__dots i{background:#3b3f46}
.hc-o-hcard{position:absolute;left:0;top:0;z-index:7;width:max-content;min-width:220px;max-width:300px;padding:10px 12px 11px;border-radius:12px;
  background:rgba(22,24,29,.97);border:1px solid rgba(255,255,255,.09);box-shadow:0 14px 34px rgba(0,0,0,.5);color:var(--o-label-strong);will-change:transform;pointer-events:auto}
.hc-o-hcard[hidden]{display:none}
.hc-o-hcard__head{font-size:10.5px;font-weight:650;letter-spacing:.08em;text-transform:uppercase;color:var(--o-label);margin-bottom:7px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hc-o-hcard__sub{font-size:11.5px;color:var(--o-label);margin:-4px 0 8px}
.hc-o-hcard__beat{font-style:italic;color:var(--o-label)}
.hc-o-hcard__lines{display:flex;flex-direction:column;gap:5px;margin-bottom:9px}
.hc-o-hcard__line{display:grid;grid-template-columns:auto 1fr;gap:8px;font-size:12.5px;line-height:1.38}
.hc-o-hcard__line b{font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--acc);padding-top:2px}
.hc-o-hcard__line.is-nonverbal span{font-style:italic;color:var(--o-label)}
.hc-o-hcard__line[data-owner] b{color:var(--o-label)}
.hc-o-hcard__quiet{font-size:12px;color:var(--o-label);font-style:italic}
.hc-o-hcard__actions{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.hc-o-hcard__actions .hc-o-btn{height:28px;padding:0 11px}
.hc-o-hcard__form{display:flex;gap:6px;width:100%}
.hc-o-hcard .hc-o-input{width:auto;flex:1;min-width:0;height:30px}
.hc-o-hcard__row{display:flex;gap:6px;width:100%;justify-content:space-between}
.hc-office[data-theme=light] .hc-o-hcard{background:rgba(255,255,255,.98);border-color:rgba(0,0,0,.08);box-shadow:0 12px 30px rgba(0,0,0,.16)}
.hc-o-life{position:absolute;top:14px;left:14px;display:flex;flex-direction:column;align-items:flex-start;gap:8px}
.hc-o-life[hidden]{display:none}
.hc-o-life__pill{gap:8px}
.hc-o-life__dot{width:7px;height:7px;border-radius:50%;background:var(--o-hud-muted);flex:none}
.hc-o-life__pill[data-state=on] .hc-o-life__dot{background:var(--o-halo-speak)}
.hc-o-life__pill[data-state=paused] .hc-o-life__dot{background:transparent;box-shadow:inset 0 0 0 1.5px var(--o-hud-muted)}
.hc-o-life__dot.is-pulse{animation:hc-o-pulse 1.2s ease-out 1}
@keyframes hc-o-pulse{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--o-halo-speak) 65%,transparent)}100%{box-shadow:0 0 0 9px transparent}}
.hc-o-life__pop{top:40px;left:0;right:auto;width:300px}
.hc-o-life__title{padding:6px 10px 4px;font-size:10.5px;font-weight:650;letter-spacing:.08em;text-transform:uppercase;color:var(--o-hud-muted)}
.hc-o-life__row{display:flex;align-items:center;gap:4px}
.hc-o-life__row .hc-o-menu__item{flex:1;min-width:0}
.hc-o-life__row .hc-o-menu__item b{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:190px}
.hc-o-life__follow{height:26px;padding:0 9px;font-size:11.5px}
.hc-o-life__row .hc-o-menu__item{display:flex;flex-direction:column;align-items:flex-start;gap:1px}
.hc-o-life__quote{display:block;max-width:190px;font-size:11.5px;font-style:italic;color:var(--o-hud-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hc-o-life__acts{display:flex;gap:4px;flex:none}
.hc-o-life__act{height:26px;padding:0 9px;font-size:11.5px}
.hc-o-life__pop{width:340px}
.hc-o-life__switch{display:flex;align-items:center;gap:8px;padding:7px 10px;font-size:12.5px;color:var(--o-hud-ink);cursor:pointer}
.hc-o-life__switch small{margin-left:auto;color:var(--o-hud-muted);font-size:11px}
.hc-o-life__switch input{accent-color:var(--o-halo-speak)}
.hc-o-life__offer{display:flex;align-items:center;gap:6px;padding:4px 4px 4px 12px;border-radius:999px;background:var(--o-hud);border:1px solid var(--o-hud-line);
  font-size:12.5px;color:var(--o-hud-ink);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}
.hc-o-life__offer[hidden]{display:none}
.hc-o-life__offer .hc-o-btn{height:26px;padding:0 10px}
.hc-o-follow{position:absolute;left:50%;bottom:18px;transform:translateX(-50%);display:flex;align-items:center;gap:8px;height:32px;padding:0 8px 0 14px;border-radius:999px;
  background:var(--o-hud);border:1px solid var(--o-hud-line);color:var(--o-hud-ink);font-size:12.5px;font-weight:600;cursor:pointer;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}
.hc-o-follow[hidden]{display:none}
.hc-office[data-mode=conference] :is(.hc-o-huddles,.hc-o-hcard,.hc-o-life,.hc-o-follow){display:none}
@media (max-width:640px){
  .hc-o-life{top:52px;left:10px}
  .hc-o-life__pill{padding:0 11px;min-width:44px;min-height:44px;justify-content:center}
  .hc-o-life__pill span{display:none}
  .hc-o-life__pop{position:fixed;left:10px;right:10px;top:auto;bottom:10px;width:auto}
}

/* Host insets (options.insets): controls in a reserved corner or strip move out of it (the scene sets the offsets). */
.hc-o-life{translate:var(--hc-o-life-x,0px) var(--hc-o-life-y,0px)}
.hc-o-seg{translate:var(--hc-o-seg-x,0px) var(--hc-o-seg-y,0px)}
.hc-o-tools{translate:var(--hc-o-tools-x,0px) var(--hc-o-tools-y,0px)}
.hc-o-zoom{translate:var(--hc-o-zoom-x,0px) var(--hc-o-zoom-y,0px)}
.hc-o-mini{translate:var(--hc-o-mini-x,0px) var(--hc-o-mini-y,0px)}
.hc-o-follow{translate:var(--hc-o-follow-x,0px) var(--hc-o-follow-y,0px)}

/* reduced motion: positions and states change instantly (FaceView keeps lip sync) */
.hc-office[data-rm] *,.hc-office[data-rm] *::before,.hc-office[data-rm] *::after{transition:none!important;animation:none!important}
.hc-o-find__btn{display:none;width:32px;padding:0;justify-content:center}
.hc-o-find__btn svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round}
/* Phones: one HUD row. Desks | Conference on the left, Walk to and a Find icon that expands on the right. */
@media (max-width:640px){
  .hc-o-seg{top:10px;left:10px;transform:none}
  .hc-o-seg__opt{padding:7px 12px}
  .hc-o-tools{top:10px;right:10px;gap:6px}
  .hc-o-tools .hc-o-btn kbd{display:none}
  .hc-o-find__btn{display:inline-flex}
  .hc-o-find .hc-o-input{display:none}
  .hc-o-find[data-open] .hc-o-find__btn{display:none}
  .hc-o-find[data-open] .hc-o-input{display:block;position:absolute;right:0;top:0;width:calc(100vw - 20px);max-width:420px;z-index:6;
    background:#16181c;backdrop-filter:none;-webkit-backdrop-filter:none}
  .hc-office[data-theme=light] .hc-o-find[data-open] .hc-o-input{background:#fff}
  .hc-o-find .hc-o-menu{width:calc(100vw - 20px);max-width:420px;top:40px}
  .hc-o-zoom{display:none}
  .hc-o-mini{display:none!important}
}
`;

const counts = new WeakMap<Document, number>();

export function injectStyles(doc: Document): void {
  counts.set(doc, (counts.get(doc) ?? 0) + 1);
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `${paletteCss('.hc-office')}\n${FILL_CSS}\n${CSS}`;
  (doc.head ?? doc.documentElement).append(style);
}

export function releaseStyles(doc: Document): void {
  const n = (counts.get(doc) ?? 1) - 1;
  counts.set(doc, n);
  if (n <= 0) doc.getElementById(STYLE_ID)?.remove();
}
