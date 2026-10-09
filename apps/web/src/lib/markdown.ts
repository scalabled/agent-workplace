// Chief of Staff and deliverable Markdown → sanitised HTML (marked + DOMPurify). Model text is untrusted.
import DOMPurify from 'dompurify';
import { Marked } from 'marked';
import { anchorBlocks } from '@headcount/protocol/ext/threads';

const marked = new Marked({ gfm: true, breaks: true, async: false });

const CONFIG = {
  USE_PROFILES: { html: true },
  FORBID_TAGS: ['style', 'iframe', 'form', 'input', 'button', 'audio', 'svg', 'math'],
  FORBID_ATTR: ['style'],
  ADD_TAGS: ['video'],
  ADD_ATTR: ['controls', 'playsinline', 'preload'],
};

/** Images and videos the office made (Files): our own address only, never a remote one. */
export const OWN_FILE_RE = /^\/api\/files\/fil_[a-f0-9]{20}\.(png|jpg|webp|svg|mp4)$/;

let hooked = false;
let sanitizerOk: boolean | null = null;

function ensureHooks() {
  if (hooked) return;
  hooked = true;
  // Only the office's own images survive (Files); a video file shows as a player. Anything else is dropped.
  DOMPurify.addHook('uponSanitizeElement', (node, data) => {
    if (data.tagName !== 'img' && data.tagName !== 'video') return;
    const el = node as Element;
    const src = el.getAttribute('src') ?? '';
    if (!OWN_FILE_RE.test(src) || (data.tagName === 'video' && !src.endsWith('.mp4'))) {
      el.parentNode?.removeChild(el);
      return;
    }
    if (data.tagName === 'img' && src.endsWith('.mp4')) {
      const video = el.ownerDocument.createElement('video');
      video.setAttribute('src', src);
      video.setAttribute('controls', '');
      video.setAttribute('playsinline', '');
      video.setAttribute('preload', 'metadata');
      video.setAttribute('class', 'md-media');
      el.replaceWith(video);
    }
  });
  // Links open outside the app and never carry the opener.
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'IMG') {
      node.setAttribute('loading', 'lazy');
      node.setAttribute('class', 'md-media');
    }
    if (node.tagName === 'VIDEO') {
      for (const a of ['autoplay', 'loop', 'muted', 'poster']) node.removeAttribute(a);
      node.setAttribute('controls', '');
      node.setAttribute('class', 'md-media');
    }
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
 * Render Markdown to safe HTML. No iframes, forms, styles or event handlers survive, and no images or videos but the
 * office's own (Files, /api/files/…). With `anchors` (a prefix,
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

/**
 * Markdown as one line of plain text, for previews (a list row, a card): no markers, links as their words, headings
 * and list items run together as sentences.
 */
export function plainText(md: string): string {
  return (md ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}(?:[-*+]|\d+[.)])\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/gm, ' ')
    .replace(/\|/g, ' ')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[^\w*])[*_]([^*_\n]+)[*_](?=[^\w*]|$)/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}
