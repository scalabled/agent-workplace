// Palette tokens (OFFICE-PLAN §1.4). Every SVG fill is a class over a `--o-…` token, so a theme switch restyles the
// plate without rebuilding it. App tokens (--surface, --ink, --lamp, --hand, …) are read with fallbacks.

const DARK = `
  --o-void:#07080a; --o-floor:#121418; --o-floor-hi:#1b1e23; --o-floor-line:rgba(255,255,255,.028);
  --o-carpet-lead:#1d1a16; --o-carpet-build:#161a20; --o-carpet-grow:#1c1820; --o-carpet-run:#161c19; --o-carpet-edge:rgba(255,255,255,.035);
  --o-wall:#1b1e24; --o-wall-top:#2c3139; --o-wall-face:#20242b; --o-slab:#0e1013; --o-slab-hi:rgba(255,255,255,.10);
  --o-glass:rgba(170,200,255,.055); --o-glass-edge:rgba(205,222,255,.30); --o-glass-hi:rgba(220,232,255,.10); --o-mullion:#2a2f37;
  --o-wood:#43322a; --o-wood-hi:#57432f; --o-wood-lo:#261b14; --o-oak:#1f1a16; --o-oak-line:rgba(255,235,210,.03);
  --o-stone:#474b50; --o-stone-hi:#565b61;
  --o-metal:#2d3137; --o-metal-hi:#58606b; --o-metal-lo:#1b1e22; --o-chrome:#7c838c;
  --o-fabric:#353b45; --o-fabric-hi:#4b525e; --o-fabric-lo:#23272e; --o-mesh:#3b424d;
  --o-felt:#2b2630; --o-felt-hi:#383140; --o-felt-lo:#1f1b24; --o-leather:#2a1f1a; --o-leather-hi:#3b2c24;
  --o-plant:#2f4f3f; --o-plant-hi:#4a7a60; --o-plant-lo:#20382c; --o-plant-y:#6f8f55; --o-trunk:#3b2e24;
  --o-pot:#2b2e34; --o-pot-hi:#3a3e46; --o-soil:#17120e;
  --o-screen-off:#0b0d10; --o-board:#c9cdd1; --o-board-lo:#9ea4aa; --o-paper:#d9d4c9; --o-ink-line:rgba(40,60,120,.55);
  --o-rug-0:#2a211b; --o-rug-1:#1f2429; --o-rug-2:#27222c; --o-rug-3:#1c2226; --o-rug-4:#1e261f; --o-rug-line:rgba(255,255,255,.05);
  --o-cafe-floor:#1a1917; --o-tile-line:rgba(255,255,255,.03); --o-mat:#1a1712;
  --o-note-1:#c9b458; --o-note-2:#6aa8ff; --o-note-3:#e38b7a; --o-note-4:#7fd1b9; --o-note-a:.72;
  --o-shadow:rgba(0,0,0,.42); --o-shadow-soft:rgba(0,0,0,.22);
  --o-pendant:#ffd9a0; --o-pendant-a:.16; --o-lamp-light:var(--lamp,#f5b85a); --o-lamp-a:.30;
  --o-label:var(--muted,#a0a5ae); --o-label-strong:var(--ink,#eeece7); --o-plate-bg:rgba(17,19,23,.82);
  --o-badge-ring:rgba(255,255,255,.14); --o-halo-hand:var(--hand,#8aabff); --o-halo-speak:var(--lamp,#f5b85a);
  --o-hud:rgba(17,19,23,.78); --o-hud-line:rgba(255,255,255,.09); --o-hud-ink:var(--ink,#eeece7); --o-hud-muted:var(--muted,#a0a5ae);
  --o-sky-dim:1; --o-sky-tint:rgba(7,9,14,0); --o-hairline:rgba(255,255,255,.06);
`;

const LIGHT = `
  --o-void:#e9e6df; --o-floor:#f1eee8; --o-floor-hi:#f7f5f1; --o-floor-line:rgba(0,0,0,.035);
  --o-carpet-lead:#ebe6dc; --o-carpet-build:#e4e8ec; --o-carpet-grow:#ebe5ea; --o-carpet-run:#e3e9e4; --o-carpet-edge:rgba(0,0,0,.05);
  --o-wall:#dcd8d0; --o-wall-top:#c9c4ba; --o-wall-face:#e3dfd8; --o-slab:#cfcac1; --o-slab-hi:rgba(255,255,255,.7);
  --o-glass:rgba(80,110,160,.08); --o-glass-edge:rgba(60,90,140,.32); --o-glass-hi:rgba(255,255,255,.35); --o-mullion:#b9bcc1;
  --o-wood:#c49a72; --o-wood-hi:#d8b48e; --o-wood-lo:#a47c58; --o-oak:#e6dccd; --o-oak-line:rgba(120,90,60,.07);
  --o-stone:#d9d6d0; --o-stone-hi:#e8e6e1;
  --o-metal:#8f949b; --o-metal-hi:#b4b8be; --o-metal-lo:#6f747b; --o-chrome:#c8ccd1;
  --o-fabric:#5b5f66; --o-fabric-hi:#71767e; --o-fabric-lo:#474b51; --o-mesh:#666b73;
  --o-felt:#8a7f8f; --o-felt-hi:#a095a5; --o-felt-lo:#766b7b; --o-leather:#7a5a48; --o-leather-hi:#936f5a;
  --o-plant:#4f7d62; --o-plant-hi:#77a88a; --o-plant-lo:#3d644d; --o-plant-y:#9cb77a; --o-trunk:#7a5f48;
  --o-pot:#d6d1c8; --o-pot-hi:#e6e2db; --o-soil:#5a4636;
  --o-screen-off:#2a2d33; --o-board:#fbfbfa; --o-board-lo:#dfe1e3; --o-paper:#ffffff; --o-ink-line:rgba(40,60,120,.55);
  --o-rug-0:#e2d6c6; --o-rug-1:#d9dde1; --o-rug-2:#e2d9e2; --o-rug-3:#d6dde0; --o-rug-4:#d9e2d8; --o-rug-line:rgba(0,0,0,.05);
  --o-cafe-floor:#ebe7df; --o-tile-line:rgba(0,0,0,.05); --o-mat:#a99a82;
  --o-note-1:#c9b458; --o-note-2:#6aa8ff; --o-note-3:#e38b7a; --o-note-4:#7fd1b9; --o-note-a:.85;
  --o-shadow:rgba(40,30,20,.16); --o-shadow-soft:rgba(40,30,20,.08);
  --o-pendant:#ffd9a0; --o-pendant-a:.10; --o-lamp-light:var(--lamp,#e8a33d); --o-lamp-a:.22;
  --o-label:var(--muted,#62666d); --o-label-strong:var(--ink,#1c1e21); --o-plate-bg:rgba(255,255,255,.86);
  --o-badge-ring:rgba(0,0,0,.10); --o-halo-hand:var(--hand,#3d6fe8); --o-halo-speak:var(--lamp,#e8a33d);
  --o-hud:rgba(255,255,255,.86); --o-hud-line:rgba(28,30,33,.12); --o-hud-ink:var(--ink,#1c1e21); --o-hud-muted:var(--muted,#62666d);
  --o-sky-dim:1; --o-sky-tint:rgba(255,255,255,0); --o-hairline:rgba(255,255,255,.5);
`;

/** Time-of-day light: window light colour and strength, pendant strength, how the sky is shown. */
const TOD = {
  night: { window: '#6f8fd6', windowA: 0.13, pendantA: 1, skyDim: 1, skyTint: 'rgba(6,8,14,0)' },
  dusk: { window: '#c89aa8', windowA: 0.15, pendantA: 0.9, skyDim: 0.95, skyTint: 'rgba(6,8,14,.06)' },
  day: { window: '#b9cde6', windowA: 0.3, pendantA: 0.55, skyDim: 0.72, skyTint: 'rgba(10,14,22,.22)' },
} as const;

export function paletteCss(scope: string): string {
  const tod = Object.entries(TOD)
    .map(
      ([k, v]) =>
        `${scope}[data-tod=${k}]{--o-window:${v.window};--o-window-a:${v.windowA};--o-pendant-k:${v.pendantA};--o-sky-dim:${v.skyDim};--o-sky-tint:${v.skyTint}}`,
    )
    .join('\n');
  return `${scope},${scope}[data-theme=dark]{${DARK}}\n${scope}[data-theme=light]{${LIGHT}}\n${tod}\n${scope}[data-theme=light][data-tod=day]{--o-sky-dim:.9;--o-sky-tint:rgba(255,255,255,.18)}`;
}

/** SVG fill classes (short names keep the plate small). */
const FILL_SRC = `
.hc-office svg .fl{fill:var(--o-floor)} .hc-office svg .flh{fill:var(--o-floor-hi)}
.hc-office svg .wl{fill:var(--o-wall)} .hc-office svg .wt{fill:var(--o-wall-top)} .hc-office svg .wf{fill:var(--o-wall-face)}
.hc-office svg .sl{fill:var(--o-slab)} .hc-office svg .slh{fill:var(--o-slab-hi)}
.hc-office svg .gl{fill:var(--o-glass)} .hc-office svg .ge{fill:var(--o-glass-edge)} .hc-office svg .gh{fill:var(--o-glass-hi)} .hc-office svg .mu{fill:var(--o-mullion)}
.hc-office svg .w{fill:var(--o-wood)} .hc-office svg .wh{fill:var(--o-wood-hi)} .hc-office svg .wd{fill:var(--o-wood-lo)}
.hc-office svg .ok{fill:var(--o-oak)} .hc-office svg .st{fill:var(--o-stone)} .hc-office svg .sth{fill:var(--o-stone-hi)}
.hc-office svg .m{fill:var(--o-metal)} .hc-office svg .mh{fill:var(--o-metal-hi)} .hc-office svg .md{fill:var(--o-metal-lo)} .hc-office svg .cr{fill:var(--o-chrome)}
.hc-office svg .fb{fill:var(--o-fabric)} .hc-office svg .fbh{fill:var(--o-fabric-hi)} .hc-office svg .fbd{fill:var(--o-fabric-lo)} .hc-office svg .me{fill:var(--o-mesh)}
.hc-office svg .ft{fill:var(--o-felt)} .hc-office svg .fth{fill:var(--o-felt-hi)} .hc-office svg .ftd{fill:var(--o-felt-lo)}
.hc-office svg .le{fill:var(--o-leather)} .hc-office svg .leh{fill:var(--o-leather-hi)}
.hc-office svg .p{fill:var(--o-plant)} .hc-office svg .ph{fill:var(--o-plant-hi)} .hc-office svg .pd{fill:var(--o-plant-lo)} .hc-office svg .py{fill:var(--o-plant-y)}
.hc-office svg .tr{fill:var(--o-trunk)} .hc-office svg .po{fill:var(--o-pot)} .hc-office svg .poh{fill:var(--o-pot-hi)} .hc-office svg .so{fill:var(--o-soil)}
.hc-office svg .sc{fill:var(--o-screen-off)} .hc-office svg .bd{fill:var(--o-board)} .hc-office svg .bdl{fill:var(--o-board-lo)} .hc-office svg .pa{fill:var(--o-paper)}
.hc-office svg .n1{fill:var(--o-note-1);fill-opacity:var(--o-note-a)} .hc-office svg .n2{fill:var(--o-note-2);fill-opacity:var(--o-note-a)}
.hc-office svg .n3{fill:var(--o-note-3);fill-opacity:var(--o-note-a)} .hc-office svg .n4{fill:var(--o-note-4);fill-opacity:var(--o-note-a)}
.hc-office svg .r0{fill:var(--o-rug-0)} .hc-office svg .r1{fill:var(--o-rug-1)} .hc-office svg .r2{fill:var(--o-rug-2)} .hc-office svg .r3{fill:var(--o-rug-3)} .hc-office svg .r4{fill:var(--o-rug-4)}
.hc-office svg .rl{fill:none;stroke:var(--o-rug-line);stroke-width:.5}
.hc-office svg .cf{fill:var(--o-cafe-floor)} .hc-office svg .tl{fill:none;stroke:var(--o-tile-line);stroke-width:.25}
.hc-office svg .mt{fill:var(--o-mat)} .hc-office svg .sh{fill:var(--o-shadow)} .hc-office svg .shs{fill:var(--o-shadow-soft)}
.hc-office svg .ca-lead{fill:var(--o-carpet-lead)} .hc-office svg .ca-build{fill:var(--o-carpet-build)} .hc-office svg .ca-grow{fill:var(--o-carpet-grow)} .hc-office svg .ca-run{fill:var(--o-carpet-run)}
.hc-office svg .ce{fill:none;stroke:var(--o-carpet-edge);stroke-width:.4}
.hc-office svg .ln{fill:none;stroke:var(--o-floor-line);stroke-width:.3}
.hc-office svg .okl{fill:none;stroke:var(--o-oak-line);stroke-width:.3}
.hc-office svg .ink{fill:none;stroke:var(--o-ink-line);stroke-width:.18;stroke-linecap:round;stroke-linejoin:round}
.hc-office svg .leg{fill:none;stroke:var(--o-metal-lo);stroke-width:.55;stroke-linecap:round}
.hc-office svg .legh{fill:none;stroke:var(--o-metal-hi);stroke-width:.35;stroke-linecap:round}
.hc-office svg .cord{fill:none;stroke:var(--o-metal-lo);stroke-width:.12}
.hc-office svg .edge{fill:none;stroke:var(--o-glass-edge);stroke-width:.25}
.hc-office svg .hair{fill:none;stroke:var(--o-hairline);stroke-width:.2}
.hc-office svg .stem{fill:none;stroke:var(--o-trunk);stroke-width:.45;stroke-linecap:round}
.hc-office svg .vein{fill:none;stroke:var(--o-plant-lo);stroke-width:.14;stroke-linecap:round}
`;

// Chrome matches only simple selectors inside <use> shadow trees (no ancestor combinators), so the plate's fill
// classes are single, prefixed classes (`hco-w`); theme differences travel through the inherited --o-* tokens.
const CLASS_RULE = /\.hc-office svg \.([\w-]+)\{/g;

/** The SVG fill classes as single-class rules. */
export const FILL_CSS = FILL_SRC.replace(CLASS_RULE, '.hco-$1{');

/** Every fill class name the symbols use. */
export const FILL_CLASSES: ReadonlySet<string> = new Set([...FILL_SRC.matchAll(CLASS_RULE)].map((m) => m[1]!));

/** Rewrite `class="w p"` in symbol markup to the prefixed classes (other classes are kept). */
export function prefixClasses(svg: string): string {
  return svg.replace(/class="([^"]+)"/g, (_, list: string) => `class="${list.split(' ').map((c) => (FILL_CLASSES.has(c) ? `hco-${c}` : c)).join(' ')}"`);
}
