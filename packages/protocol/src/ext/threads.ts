// Side chats in documents: the owner selects a passage in a document (a canvas document, a project's deliverable, a
// job's write-up, a Handbook section), asks about it, and the agent who wrote it (or keeps it) answers there — in a
// thread pinned to that spot, which can change the document when asked (a canvas: a new version; the Handbook: the
// section). Every block of a document has a stable anchor, so a link can point at any spot in it.

/**
 * What a thread is about: `canvas:<canvasId>`, `deliverable:<projectId>`, `job:<jobId>`, or `handbook` (the anchor
 * names the section).
 */
export type DocRef = string;

export const isDocRef = (s: unknown): s is DocRef => typeof s === 'string' && (/^canvas:cnv_[a-f0-9]{8,40}$/.test(s) || /^deliverable:prj_[a-z0-9]{8,40}$/.test(s) || /^job:job_[a-z0-9]{8,40}$/.test(s) || s === 'handbook');

export interface DocAction {
  /** `revised`: a new canvas version was started; `handbook`: a Handbook section was rewritten. */
  kind: 'revised' | 'handbook';
  canvasId?: string;
  section?: string;
}

export interface DocMessage {
  /** 'owner', or the agent's id. */
  from: string;
  name: string;
  text: string;
  at: string;
  action?: DocAction;
}

export interface DocThread {
  threadId: string;
  doc: DocRef;
  /** The block it is pinned to (an element id in the document). */
  anchor: string;
  /** The passage selected. */
  quote: string;
  agentId: string;
  agentName: string;
  status: 'open' | 'resolved';
  createdAt: string;
  updatedAt: string;
  messages: DocMessage[];
}

export interface ThreadsResponse {
  threads: DocThread[];
}

export interface ThreadResponse {
  thread: DocThread;
}

export interface ThreadStart {
  doc: DocRef;
  anchor: string;
  quote: string;
  text: string;
}

export const THREAD_TEXT_MAX = 2000;
export const THREAD_QUOTE_MAX = 600;

// ── anchors ──────────────────────────────────────────────────────────────────────────

const slug = (s: string) =>
  s
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

/**
 * Give every heading and block of rendered Markdown a stable id: headings `<prefix>h-<slug>`, other blocks (paragraphs,
 * list items, quotes, tables, code) `<prefix>b-<n>` in order. Pure string work on the renderer's own tags (raw HTML in
 * the Markdown is escaped before this), so the worker's document pages and the app's Markdown agree.
 */
export function anchorBlocks(html: string, prefix = ''): string {
  const used = new Set<string>();
  let n = 0;
  return html.replace(/<(h[1-6]|p|li|blockquote|table|pre)>([\s\S]*?)(?=<\/\1>)/g, (_all, tag: string, inner: string) => {
    let id: string;
    if (tag[0] === 'h' && tag.length === 2) {
      const base = `${prefix}h-${slug(inner) || String(++n)}`;
      id = base;
      for (let i = 2; used.has(id); i++) id = `${base}-${i}`;
    } else id = `${prefix}b-${++n}`;
    used.add(id);
    return `<${tag} id="${id}">${inner}`;
  });
}
