// Markdown documents as Word, Excel and PowerPoint (src/files/export.ts): the parts each needs, the content in them,
// tables as sheets, sections as slides, and untrusted text escaped.
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { parseMarkdown, slidesOf, toDocx, toPptx, toXlsx } from '../src/files/export';

const DOC = `# Crystal subscription box

A monthly box of **three hand-picked crystals**, with a card on each and a [care guide](https://example.com/care).

## Pricing

| Plan | Price | Crystals |
| --- | --- | --- |
| Monthly | 39 | 3 |
| Quarterly | 105 | 9 |

## Launch plan

1. Tease it on Instagram
2. Email the list
   - with a discount code
3. Open orders

> Keep margins above 40% <script>alert(1)</script> & watch shipping.

\`\`\`
SKU-001 amethyst
\`\`\`
`;

const parts = (bytes: Uint8Array) => Object.fromEntries(Object.entries(unzipSync(bytes)).map(([k, v]) => [k, strFromU8(v)]));

describe('export', () => {
  it('parses the blocks a deliverable uses', () => {
    const blocks = parseMarkdown(DOC);
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'heading', 'table', 'heading', 'list', 'quote', 'code']);
    const list = blocks.find((b) => b.type === 'list') as { items: { text: string; level: number }[] };
    expect(list.items).toEqual([
      { text: 'Tease it on Instagram', level: 0 },
      { text: 'Email the list', level: 0 },
      { text: 'with a discount code', level: 1 },
      { text: 'Open orders', level: 0 },
    ]);
  });

  it('Word: title, headings, a table, lists, a link, escaped text', () => {
    const p = parts(toDocx('Crystal subscription box', DOC));
    expect(Object.keys(p)).toEqual(expect.arrayContaining(['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'word/numbering.xml', 'word/_rels/document.xml.rels', 'docProps/core.xml']));
    const doc = p['word/document.xml']!;
    expect(doc.match(/w:val="Title"/g)).toHaveLength(1); // the H1 that repeats the title is not doubled
    expect(doc).toContain('<w:pStyle w:val="Heading2"/>');
    expect(doc).toContain('<w:tbl>');
    expect(doc).toContain('three hand-picked crystals');
    expect(doc).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; watch');
    expect(p['word/_rels/document.xml.rels']).toContain('https://example.com/care');
  });

  it('Excel: each table a sheet named by its heading, numbers as numbers; no tables → the lines', () => {
    const p = parts(toXlsx('Crystal subscription box', DOC));
    expect(p['xl/workbook.xml']).toContain('<sheet name="Pricing"');
    expect(p['xl/worksheets/sheet1.xml']).toContain('<c r="B2"><v>39</v></c>');
    expect(p['xl/worksheets/sheet1.xml']).toContain('<t xml:space="preserve">Monthly</t>');
    const plain = parts(toXlsx('Notes', '# Notes\n\n- one\n- two'));
    expect(plain['xl/worksheets/sheet1.xml']).toContain('• two');
  });

  it('PowerPoint: a title slide, then a slide per section', () => {
    expect(slidesOf('Crystal subscription box', DOC).map((s) => s.title)).toEqual(['Overview', 'Pricing', 'Launch plan']);
    const p = parts(toPptx('Crystal subscription box', DOC));
    expect(Object.keys(p).filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k))).toHaveLength(4);
    expect(p['ppt/slides/slide3.xml']).toContain('Plan · Price · Crystals');
    expect(p['ppt/presentation.xml']).toContain('<p:sldId id="259" r:id="rId4"/>');
  });

  it.runIf(!!process.env.EXPORT_OUT)('writes samples for checking in Office tools', async () => {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(`${process.env.EXPORT_OUT}/sample.docx`, toDocx('Crystal subscription box', DOC));
    writeFileSync(`${process.env.EXPORT_OUT}/sample.xlsx`, toXlsx('Crystal subscription box', DOC));
    writeFileSync(`${process.env.EXPORT_OUT}/sample.pptx`, toPptx('Crystal subscription box', DOC));
  });
});
