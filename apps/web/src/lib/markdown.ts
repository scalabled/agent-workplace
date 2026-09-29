// Chief of Staff and deliverable Markdown → sanitised HTML (marked + DOMPurify). Model text is untrusted.
import DOMPurify from 'dompurify';
import { Marked } from 'marked';
import { anchorBlocks } from '@headcount/protocol/ext/threads';

const marked = new Marked({ gfm: true, breaks: true, async: false });

const CONFIG = {
  USE_PROFILES: { html: true },
  FORBID_TAGS: ['img', 'style', 'iframe', 'form', 'input', 'button', 'video', 'audio', 'svg', 'math'],
  FORBID_ATTR: ['style'],
};

let hooked = false;
let sanitizerOk: boolean | null = null;

function ensureHooks() {
  if (hooked) return;
  hooked = true;
  // Links open outside the app and never carry the opener.
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      const href = node.getAttribute('href') ?? '';
      if (/^https?:/i.test(href)) {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
      }
    }
  });
}

/** Proves once that the sanitiser really removes handlers in this DOM; if not, we never emit HTML. */
function sanitizerWorks(): boolean {
  if (sanitizerOk === null) {
    try {
      const out = DOMPurify.sanitize('<p><b onclick="x()">ok</b><script>x()</script></p>', CONFIG);
      sanitizerOk = DOMPurify.isSupported && out === '<p><b>ok</b></p>';
    } catch {
      sanitizerOk = false;
    }
  }
  return sanitizerOk;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * Render Markdown to safe HTML. No images, iframes, forms, styles or event handlers survive. With `anchors` (a prefix,
 * unique on the page), every heading and block gets an id, so a link or a side chat can point at that spot.
 */
export function renderMarkdown(md: string, anchors?: string): string {
  ensureHooks();
  const html = sanitizerWorks()
    ? DOMPurify.sanitize(marked.parse(md ?? '') as string, CONFIG)
    : (md ?? '')
        .split(/\n{2,}/)
        .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
        .join('');
  return anchors === undefined ? html : anchorBlocks(html, anchors);
}
