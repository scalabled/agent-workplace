import { describe, expect, it } from 'vitest';
import { anchorBlocks, isDocRef } from './threads';

describe('document anchors', () => {
  it('ids every heading (by its words) and block (in order), with a prefix, never twice', () => {
    const html = '<h1>Opening checklist</h1>\n<p>Before 7am.</p>\n<ul>\n<li>Lights</li>\n<li><strong>Till</strong> float</li>\n</ul>\n<h2>Café &amp; bar</h2>\n<h2>Café &amp; bar</h2>\n<blockquote>\n<p>Be kind.</p>\n</blockquote>\n<pre><code>x</code></pre>';
    expect(anchorBlocks(html, 'dl-')).toBe(
      '<h1 id="dl-h-opening-checklist">Opening checklist</h1>\n<p id="dl-b-1">Before 7am.</p>\n<ul>\n<li id="dl-b-2">Lights</li>\n<li id="dl-b-3"><strong>Till</strong> float</li>\n</ul>\n<h2 id="dl-h-cafe-bar">Café &amp; bar</h2>\n<h2 id="dl-h-cafe-bar-2">Café &amp; bar</h2>\n<blockquote id="dl-b-4">\n<p>Be kind.</p>\n</blockquote>\n<pre id="dl-b-5"><code>x</code></pre>',
    );
  });
  it('knows a document reference', () => {
    expect(isDocRef('canvas:cnv_0123456789abcdef')).toBe(true);
    expect(isDocRef('deliverable:prj_01h2x3y4z5')).toBe(true);
    expect(isDocRef('handbook')).toBe(true);
    expect(isDocRef('canvas:../etc')).toBe(false);
  });
});
