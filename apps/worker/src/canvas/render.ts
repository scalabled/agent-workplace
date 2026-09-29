// How a canvas is served (personagram-ai experiences.ts serve/page, extended to documents and print):
// - an app runs sandboxed however it is opened: scripts in an opaque origin, no network, no cookies, no navigation,
//   framed only by our own pages; on the canvas it carries the error reporter (never in a download);
// - a document is Markdown rendered to one styled page (raw HTML in it is shown as text, never run), served with no
//   scripts at all;
// - print (Export PDF) is the same page with a line that opens the browser's print dialog once it has loaded, where
//   "Save as PDF" makes the file: sandboxed with modals allowed (printing needs them), and still no network.
import { Marked, type Tokens } from 'marked';
import { CANVAS_REPORT_TYPE } from '@headcount/protocol/ext/canvas';
import { anchorBlocks } from '@headcount/protocol/ext/threads';

export const APP_CSP = [
  'sandbox allow-scripts allow-pointer-lock',
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval' blob:",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'media-src data: blob:',
  'font-src data:',
  'worker-src blob:',
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'self'",
].join('; ');

export const DOCUMENT_CSP = ['sandbox', "default-src 'none'", "style-src 'unsafe-inline'", 'img-src data:', "form-action 'none'", "base-uri 'none'", "frame-ancestors 'self'"].join('; ');

/** Print pages: our one print line runs (and an app's own scripts, for an app); modals are allowed so print() can open. */
export const PRINT_CSP = APP_CSP.replace('sandbox allow-scripts allow-pointer-lock', 'sandbox allow-scripts allow-modals');

/**
 * Added to an app when it runs on the canvas: collects what goes wrong in a real browser (errors, rejected promises,
 * console.error, where shader failures surface) and hands them to the canvas, which offers to fix them. One line, so
 * the page's own line numbers in those errors stay true.
 */
export const REPORTER = `<script>(()=>{const seen=new Set(),errs=[];const push=m=>{m=String(m||"").slice(0,400);if(!m||seen.has(m)||errs.length>=8)return;seen.add(m);errs.push(m)};addEventListener("error",e=>push((e.message||"Error")+(e.lineno?" (line "+e.lineno+")":"")));addEventListener("unhandledrejection",e=>push("Unhandled rejection: "+(e.reason&&e.reason.message||e.reason)));const ce=console.error;console.error=function(...a){push(a.map(x=>x&&x.message||String(x)).join(" "));return ce.apply(this,a)};const report=()=>{try{parent.postMessage({type:${JSON.stringify(CANVAS_REPORT_TYPE)},errors:errs.slice()},"*")}catch(_){}};addEventListener("load",()=>setTimeout(report,2500));setTimeout(report,7000)})();</script>`;

/**
 * On the canvas page only (never in a download or print): a passage the owner selects in a document is handed to the
 * canvas with the block it sits in, so they can ask about it or link to that spot. Nothing else: no network, no DOM
 * changes; the frame stays an opaque origin.
 */
const ASK_SOURCE = `(()=>{const T=${JSON.stringify(CANVAS_REPORT_TYPE)};const post=a=>{try{parent.postMessage({type:T,ask:a},"*")}catch(_){}};const send=()=>{const s=getSelection();const q=s?String(s).replace(/\\s+/g," ").trim():"";if(!q){post(null);return}const n=s.anchorNode;let el=n&&(n.nodeType===1?n:n.parentElement);while(el&&!el.id)el=el.parentElement;const r=s.rangeCount?s.getRangeAt(0).getBoundingClientRect():null;post({anchor:el?el.id:"",quote:q.slice(0,600),rect:r?{x:r.left,y:r.top,w:r.width,h:r.height}:null})};document.addEventListener("mouseup",()=>setTimeout(send,10));document.addEventListener("keyup",e=>{if(e.shiftKey||e.key==="Escape")setTimeout(send,10)});document.addEventListener("touchend",()=>setTimeout(send,350));addEventListener("scroll",()=>{if(String(getSelection()||"").trim())send()},{passive:true})})();`;
export const ASK = `<script>${ASK_SOURCE}</script>`;

let askHash: Promise<string> | null = null;
/** The CSP for a document on the canvas: no scripts but the one above (by its hash). */
export async function documentViewCsp(): Promise<string> {
  askHash ??= crypto.subtle.digest('SHA-256', new TextEncoder().encode(ASK_SOURCE)).then((d) => btoa(String.fromCharCode(...new Uint8Array(d))));
  const hash = await askHash;
  return ['sandbox allow-scripts', "default-src 'none'", `script-src 'sha256-${hash}'`, "style-src 'unsafe-inline'", 'img-src data:', "form-action 'none'", "base-uri 'none'", "frame-ancestors 'self'"].join('; ');
}

/** Opens the print dialog once the page has laid out (Save as PDF there). */
export const PRINTER = `<script>addEventListener("load",()=>setTimeout(()=>{try{print()}catch(_){}},600));</script>`;

/** Insert one line of script right after <head> (or at the top). */
export function injectHead(html: string, script: string): string {
  const head = html.search(/<head[^>]*>/i);
  if (head < 0) return script + html;
  const end = html.indexOf('>', head) + 1;
  return html.slice(0, end) + script + html.slice(end);
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Markdown → HTML with any raw HTML shown as text and only http(s)/mailto links kept. */
const md = new Marked({
  gfm: true,
  breaks: false,
  async: false,
  renderer: {
    html(token: Tokens.HTML | Tokens.Tag) {
      return escapeHtml(token.text);
    },
    link(token: Tokens.Link) {
      const href = /^(https?:|mailto:)/i.test(token.href) ? token.href : '';
      const inner = this.parser.parseInline(token.tokens);
      return href ? `<a href="${escapeHtml(href)}" rel="noreferrer noopener">${inner}</a>` : inner;
    },
    image(token: Tokens.Image) {
      return escapeHtml(token.text || '');
    },
  },
});

const DOCUMENT_STYLE = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #f7f5f0; color: #1d1c1a; font: 16px/1.6 ui-serif, Georgia, "Iowan Old Style", serif; }
  main { max-width: 760px; margin: 0 auto; padding: 56px 28px 80px; background: #fff; min-height: 100vh; }
  h1, h2, h3, h4 { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; line-height: 1.25; color: #111; }
  h1 { font-size: 32px; margin: 0 0 20px; letter-spacing: -0.01em; }
  h2 { font-size: 22px; margin: 36px 0 12px; padding-bottom: 6px; border-bottom: 1px solid #e6e2d9; }
  h3 { font-size: 18px; margin: 28px 0 8px; }
  p, ul, ol, table, blockquote { margin: 0 0 16px; }
  a { color: #8a4b08; }
  code { font: 14px ui-monospace, SFMono-Regular, Menlo, monospace; background: #f3f1ec; padding: 1px 4px; border-radius: 4px; }
  pre { background: #f3f1ec; padding: 12px 14px; border-radius: 8px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  blockquote { border-left: 3px solid #d9a14a; padding: 4px 14px; color: #4a463f; background: #fbf7ef; }
  table { border-collapse: collapse; width: 100%; font: 14px/1.45 system-ui, -apple-system, sans-serif; }
  th, td { border: 1px solid #e0dbd0; padding: 7px 10px; text-align: left; vertical-align: top; }
  th { background: #f6f2ea; }
  hr { border: 0; border-top: 1px solid #e6e2d9; margin: 28px 0; }
  .meta { font: 13px system-ui, sans-serif; color: #7a756b; margin-top: 40px; }
  [id] { scroll-margin-top: 24px; }
  :target { background: #fff3d6; box-shadow: 0 0 0 6px #fff3d6; border-radius: 3px; transition: background 1.5s ease-out; }
  @media (max-width: 600px) { main { padding: 32px 18px 60px; } h1 { font-size: 26px; } }
  @media print {
    body { background: #fff; }
    main { max-width: none; padding: 0; min-height: 0; }
    h2 { break-after: avoid; } table, blockquote, pre { break-inside: avoid; }
    a { color: inherit; text-decoration: underline; }
  }
  @page { margin: 18mm 16mm; }
`;

/**
 * A Markdown document as one standalone, styled HTML page (for the canvas, the download and print). Every heading and
 * block has an anchor (`#h-…`, `#b-…`), so a link can point at any spot; on the canvas (`ask`) a selection can be asked
 * about.
 */
export function documentPage(title: string, markdown: string, meta?: string, opts: { ask?: boolean } = {}): string {
  const body = anchorBlocks(md.parse(markdown) as string);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${DOCUMENT_STYLE}</style>${opts.ask ? `\n${ASK}` : ''}
</head>
<body>
<main>
${body}
${meta ? `<p class="meta">${escapeHtml(meta)}</p>` : ''}
</main>
</body>
</html>`;
}

/** A file name from a title. */
export function fileName(title: string, ext: string): string {
  const stem = (title || 'canvas').replace(/[^\w -]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'canvas';
  return `${stem}.${ext}`;
}

export function page(html: string, csp: string, download?: string): Response {
  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': csp,
      'cache-control': 'private, no-store',
      'cross-origin-resource-policy': 'same-origin',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      ...(download ? { 'content-disposition': `attachment; filename="${download}"` } : {}),
    },
  });
}
