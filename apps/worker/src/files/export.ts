// Markdown documents as Office files (Phase 4): Word (headings, paragraphs, lists, tables, quotes, code, links), Excel
// (each table its own sheet; a document with none becomes one sheet of its lines) and PowerPoint (a title slide, then a
// slide per section, its paragraphs and list items as bullets, long sections continued). Plain OOXML zipped with fflate:
// no templates, no network, nothing executable. Model text is untrusted: everything is XML-escaped.
import { strToU8, zipSync, type Zippable } from 'fflate';
import { BRAND } from '@headcount/protocol';

// ── Markdown → blocks ─────────────────────────────────────────────────────────────

export type Run = { text: string; b?: boolean; i?: boolean; code?: boolean; link?: string };
export type Block =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; items: { text: string; level: number }[] }
  | { type: 'table'; rows: string[][] }
  | { type: 'code'; text: string }
  | { type: 'quote'; text: string }
  | { type: 'rule' };

const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const cellsOf = (line: string) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());

export function parseMarkdown(md: string): Block[] {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const out: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ type: 'paragraph', text: para.join(' ').trim() });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^\s*```/.test(line)) {
      flush();
      const code: string[] = [];
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]!); i++) code.push(lines[i]!);
      out.push({ type: 'code', text: code.join('\n') });
      continue;
    }
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      flush();
      out.push({ type: 'heading', level: h[1]!.length, text: h[2]! });
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush();
      out.push({ type: 'rule' });
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]!)) {
      flush();
      const rows = [cellsOf(line)];
      for (i += 2; i < lines.length && lines[i]!.includes('|') && lines[i]!.trim(); i++) rows.push(cellsOf(lines[i]!));
      i--;
      out.push({ type: 'table', rows });
      continue;
    }
    const li = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (li) {
      flush();
      const ordered = /\d/.test(li[2]!);
      const prev = out[out.length - 1];
      const item = { text: li[3]!, level: Math.min(3, Math.floor(li[1]!.replace(/\t/g, '  ').length / 2)) };
      if (prev?.type === 'list' && (prev.ordered === ordered || item.level > 0)) prev.items.push(item);
      else out.push({ type: 'list', ordered, items: [item] });
      continue;
    }
    const q = /^\s*>\s?(.*)$/.exec(line);
    if (q) {
      flush();
      const prev = out[out.length - 1];
      if (prev?.type === 'quote') prev.text += ` ${q[1]}`;
      else out.push({ type: 'quote', text: q[1]! });
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    // A wrapped list item continues the item.
    const prev = out[out.length - 1];
    if (!para.length && prev?.type === 'list' && /^\s{2,}\S/.test(line)) {
      prev.items[prev.items.length - 1]!.text += ` ${line.trim()}`;
      continue;
    }
    para.push(line.trim());
  }
  flush();
  return out;
}

/** Inline Markdown → runs (bold, italic, code, links; everything else is text). */
export function runsOf(text: string): Run[] {
  const runs: Run[] = [];
  const re = /(\*\*|__)(.+?)\1|(\*|_)(?!\s)(.+?)\3|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let at = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > at) runs.push({ text: text.slice(at, m.index) });
    if (m[2] !== undefined) runs.push(...runsOf(m[2]).map((r) => ({ ...r, b: true })));
    else if (m[4] !== undefined) runs.push(...runsOf(m[4]).map((r) => ({ ...r, i: true })));
    else if (m[5] !== undefined) runs.push({ text: m[5], code: true });
    else if (m[6] !== undefined) runs.push({ text: m[6], link: m[7]! });
    at = m.index + m[0].length;
  }
  if (at < text.length) runs.push({ text: text.slice(at) });
  return runs.filter((r) => r.text);
}

const plain = (text: string) =>
  runsOf(text)
    .map((r) => r.text)
    .join('');

// eslint-disable-next-line no-control-regex
const xml = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const zip = (files: Record<string, string>): Uint8Array => {
  const z: Zippable = {};
  for (const [k, v] of Object.entries(files)) z[k] = strToU8(v);
  return zipSync(z, { level: 6 });
};
const isoNow = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');
const core = (title: string) =>
  `${HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(title)}</dc:title><dc:creator>${xml(BRAND.name)}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${isoNow()}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${isoNow()}</dcterms:modified></cp:coreProperties>`;
const RELS_ROOT = (main: string) =>
  `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${main}"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;

// ── Word ──────────────────────────────────────────────────────────────────────────

export function toDocx(title: string, md: string): Uint8Array {
  const blocks = parseMarkdown(md);
  const links: string[] = [];
  const linkId = (url: string) => {
    let i = links.indexOf(url);
    if (i < 0) i = links.push(url) - 1;
    return `rIdL${i + 1}`;
  };
  const run = (r: Run) => {
    const props = `${r.b ? '<w:b/>' : ''}${r.i ? '<w:i/>' : ''}${r.code ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:shd w:val="clear" w:color="auto" w:fill="EEEEEE"/>' : ''}${r.link ? '<w:rStyle w:val="Hyperlink"/>' : ''}`;
    const t = `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${xml(r.text)}</w:t></w:r>`;
    return r.link && /^(https?:|mailto:)/i.test(r.link) ? `<w:hyperlink r:id="${linkId(r.link)}">${t}</w:hyperlink>` : t;
  };
  const para = (text: string, style?: string, extra = '') => `<w:p>${style || extra ? `<w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${extra}</w:pPr>` : ''}${runsOf(text).map(run).join('')}</w:p>`;
  const body: string[] = [para(title, 'Title')];
  for (const b of blocks) {
    if (b.type === 'heading') {
      // The document's own title is already the Title.
      if (b.level === 1 && plain(b.text) === title && body.length === 1) continue;
      body.push(para(b.text, `Heading${Math.min(3, b.level)}`));
    } else if (b.type === 'paragraph') body.push(para(b.text));
    else if (b.type === 'quote') body.push(para(b.text, 'Quote'));
    else if (b.type === 'rule') body.push('<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="BBBBBB"/></w:pBdr></w:pPr></w:p>');
    else if (b.type === 'code') for (const l of b.text.split('\n')) body.push(`<w:p><w:pPr><w:pStyle w:val="Code"/></w:pPr><w:r><w:t xml:space="preserve">${xml(l)}</w:t></w:r></w:p>`);
    else if (b.type === 'list') for (const it of b.items) body.push(para(it.text, 'ListParagraph', `<w:numPr><w:ilvl w:val="${it.level}"/><w:numId w:val="${b.ordered ? 2 : 1}"/></w:numPr>`));
    else if (b.type === 'table') {
      const cols = Math.max(...b.rows.map((r) => r.length));
      const width = Math.floor(9000 / cols);
      const rows = b.rows.map((r, ri) => `<w:tr>${Array.from({ length: cols }, (_, ci) => `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${ri === 0 ? '<w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/>' : ''}</w:tcPr><w:p>${runsOf(r[ci] ?? '').map((x) => run(ri === 0 ? { ...x, b: true } : x)).join('')}</w:p></w:tc>`).join('')}</w:tr>`);
      body.push(`<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="BBBBBB"/>`).join('')}</w:tblBorders></w:tblPr><w:tblGrid>${Array.from({ length: cols }, () => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>${rows.join('')}</w:tbl>`, '<w:p/>');
    }
  }
  const document = `${HEAD}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const style = (id: string, name: string, ppr: string, rpr: string, type = 'paragraph') => `<w:style w:type="${type}" w:styleId="${id}"><w:name w:val="${name}"/>${type === 'paragraph' ? '<w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>' : ''}${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}</w:style>`;
  const styles = `${HEAD}<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>${style('Title', 'Title', '<w:spacing w:after="240"/>', '<w:b/><w:sz w:val="48"/><w:color w:val="1F2937"/>')}${style('Heading1', 'heading 1', '<w:keepNext/><w:spacing w:before="360" w:after="120"/><w:outlineLvl w:val="0"/>', '<w:b/><w:sz w:val="34"/><w:color w:val="1F2937"/>')}${style('Heading2', 'heading 2', '<w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="1"/>', '<w:b/><w:sz w:val="28"/><w:color w:val="374151"/>')}${style('Heading3', 'heading 3', '<w:keepNext/><w:spacing w:before="200" w:after="60"/><w:outlineLvl w:val="2"/>', '<w:b/><w:sz w:val="24"/><w:color w:val="4B5563"/>')}${style('ListParagraph', 'List Paragraph', '<w:spacing w:after="60"/><w:ind w:left="720"/>', '')}${style('Quote', 'Quote', '<w:ind w:left="567"/><w:pBdr><w:left w:val="single" w:sz="12" w:space="8" w:color="D1A54A"/></w:pBdr>', '<w:i/><w:color w:val="4B5563"/>')}${style('Code', 'Code', '<w:spacing w:after="0"/><w:shd w:val="clear" w:color="auto" w:fill="F3F4F6"/>', '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="19"/>')}<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="2563EB"/><w:u w:val="single"/></w:rPr></w:style><w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style></w:styles>`;
  const lvl = (i: number, ordered: boolean) => `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${ordered ? (i % 2 ? 'lowerLetter' : 'decimal') : 'bullet'}"/><w:lvlText w:val="${ordered ? `%${i + 1}.` : ['•', '◦', '▪', '•'][i]}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 + i * 360}" w:hanging="360"/></w:pPr></w:lvl>`;
  const numbering = `${HEAD}<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0">${[0, 1, 2, 3].map((i) => lvl(i, false)).join('')}</w:abstractNum><w:abstractNum w:abstractNumId="1">${[0, 1, 2, 3].map((i) => lvl(i, true)).join('')}</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`;
  const docRels = `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdN" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>${links.map((u, i) => `<Relationship Id="rIdL${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xml(u)}" TargetMode="External"/>`).join('')}</Relationships>`;
  const types = `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;
  return zip({ '[Content_Types].xml': types, '_rels/.rels': RELS_ROOT('word/document.xml'), 'word/document.xml': document, 'word/styles.xml': styles, 'word/numbering.xml': numbering, 'word/_rels/document.xml.rels': docRels, 'docProps/core.xml': core(title) });
}

// ── Excel ─────────────────────────────────────────────────────────────────────────

const colName = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : colName(Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26)));
const NUMBER = /^-?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/;

export function toXlsx(title: string, md: string): Uint8Array {
  const blocks = parseMarkdown(md);
  const tables = blocks.filter((b): b is Extract<Block, { type: 'table' }> => b.type === 'table');
  // Each table its own sheet, named by the heading above it; no tables: the document's lines in one sheet.
  const sheets: { name: string; rows: string[][]; header: boolean }[] = [];
  if (tables.length) {
    let heading = '';
    for (const b of blocks) {
      if (b.type === 'heading') heading = plain(b.text);
      if (b.type === 'table') sheets.push({ name: heading || `Table ${sheets.length + 1}`, rows: b.rows.map((r) => r.map(plain)), header: true });
    }
  } else {
    const rows: string[][] = [];
    for (const b of blocks) {
      if (b.type === 'heading' || b.type === 'paragraph' || b.type === 'quote') rows.push([plain(b.text)]);
      else if (b.type === 'list') for (const it of b.items) rows.push([`${'  '.repeat(it.level)}• ${plain(it.text)}`]);
      else if (b.type === 'code') for (const l of b.text.split('\n')) rows.push([l]);
    }
    sheets.push({ name: title, rows: rows.length ? rows : [['']], header: false });
  }
  const used = new Set<string>();
  const safeName = (n: string) => {
    let base = n.replace(/[\\/?*[\]:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 28) || 'Sheet';
    let name = base;
    for (let k = 2; used.has(name.toLowerCase()); k++) name = `${base.slice(0, 26)} ${k}`;
    used.add(name.toLowerCase());
    return name;
  };
  const names = sheets.map((s) => safeName(s.name));
  const sheetXml = (s: (typeof sheets)[number]) => {
    const cols = Math.max(1, ...s.rows.map((r) => r.length));
    const widths = Array.from({ length: cols }, (_, c) => Math.min(60, Math.max(10, ...s.rows.map((r) => (r[c] ?? '').length + 2))));
    const rows = s.rows
      .map((r, ri) => {
        const cells = r.map((v, ci) => {
          const ref = `${colName(ci)}${ri + 1}`;
          const style = s.header && ri === 0 ? ' s="1"' : '';
          if (!(s.header && ri === 0) && NUMBER.test(v.trim())) return `<c r="${ref}"${style}><v>${Number(v.trim().replace(/,/g, ''))}</v></c>`;
          return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
        });
        return `<row r="${ri + 1}">${cells.join('')}</row>`;
      })
      .join('');
    return `${HEAD}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${s.header ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' : ''}<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${rows}</sheetData></worksheet>`;
  };
  const files: Record<string, string> = {
    '[Content_Types].xml': `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
    '_rels/.rels': RELS_ROOT('xl/workbook.xml'),
    'docProps/core.xml': core(title),
    'xl/workbook.xml': `${HEAD}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${xml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rIdS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': `${HEAD}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
  };
  sheets.forEach((s, i) => (files[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(s)));
  return zip(files);
}

// ── PowerPoint ────────────────────────────────────────────────────────────────────

const EMU_W = 12192000;
const EMU_H = 6858000;
const BULLETS_PER_SLIDE = 7;

export function slidesOf(title: string, md: string): { title: string; bullets: { text: string; level: number }[] }[] {
  const blocks = parseMarkdown(md);
  const slides: { title: string; bullets: { text: string; level: number }[] }[] = [];
  let cur: (typeof slides)[number] | null = null;
  const top = Math.min(...blocks.filter((b) => b.type === 'heading').map((b) => (b as { level: number }).level), 9);
  const push = (text: string, level = 0) => {
    if (!cur) slides.push((cur = { title: 'Overview', bullets: [] }));
    cur.bullets.push({ text, level });
  };
  for (const b of blocks) {
    if (b.type === 'heading' && b.level <= top + 1) {
      if (b.level === top && plain(b.text) === title && !slides.length) continue;
      slides.push((cur = { title: plain(b.text), bullets: [] }));
    } else if (b.type === 'heading') push(plain(b.text));
    else if (b.type === 'paragraph' || b.type === 'quote') push(plain(b.text));
    else if (b.type === 'list') for (const it of b.items) push(plain(it.text), Math.min(1, it.level));
    else if (b.type === 'table') for (const r of b.rows.slice(0, 12)) push(r.map(plain).filter(Boolean).join(' · '));
    else if (b.type === 'code') push(b.text.split('\n').slice(0, 4).join(' / '));
  }
  // Long sections continue on the next slide; long bullets are cut at a sentence.
  const out: typeof slides = [];
  for (const s of slides) {
    const bullets = s.bullets.map((x) => ({ ...x, text: x.text.length > 220 ? `${x.text.slice(0, 217).replace(/\s+\S*$/, '')}…` : x.text }));
    if (!bullets.length) out.push({ ...s, bullets });
    for (let i = 0; i < bullets.length; i += BULLETS_PER_SLIDE) out.push({ title: i ? `${s.title} (continued)` : s.title, bullets: bullets.slice(i, i + BULLETS_PER_SLIDE) });
  }
  return out;
}

export function toPptx(title: string, md: string): Uint8Array {
  const slides = slidesOf(title, md);
  const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
  const textBox = (id: number, name: string, x: number, y: number, w: number, h: number, paras: string) =>
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square" lIns="0" rIns="0"><a:normAutofit/></a:bodyPr><a:lstStyle/>${paras}</p:txBody></p:sp>`;
  const runP = (text: string, size: number, opts: { bold?: boolean; color?: string; bullet?: boolean; level?: number } = {}) =>
    `<a:p><a:pPr${opts.bullet ? ` marL="${342900 + (opts.level ?? 0) * 342900}" indent="-285750"` : ''}>${opts.bullet ? `<a:buFont typeface="Arial"/><a:buChar char="${opts.level ? '–' : '•'}"/>` : '<a:buNone/>'}<a:spcAft><a:spcPts val="${opts.bullet ? 900 : 0}"/></a:spcAft></a:pPr><a:r><a:rPr lang="en-US" sz="${size}"${opts.bold ? ' b="1"' : ''} dirty="0"><a:solidFill><a:srgbClr val="${opts.color ?? '1F2937'}"/></a:solidFill><a:latin typeface="Calibri"/></a:rPr><a:t>${xml(text)}</a:t></a:r></a:p>`;
  const accent = `<p:sp><p:nvSpPr><p:cNvPr id="9" name="Accent"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="609600" y="0"/><a:ext cx="${EMU_W - 1219200}" cy="76200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="D1A54A"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr></p:sp>`;
  const slideXml = (shapes: string) =>
    `${HEAD}<p:sld ${NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
  const all = [
    slideXml(`${accent}${textBox(2, 'Title', 609600, 2286000, EMU_W - 1219200, 1371600, runP(title, 4000, { bold: true }))}${textBox(3, 'Subtitle', 609600, 3733800, EMU_W - 1219200, 609600, runP(`Made with ${BRAND.name} · ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`, 1600, { color: '6B7280' }))}`),
    ...slides.map((s) =>
      slideXml(
        `${accent}${textBox(2, 'Title', 609600, 457200, EMU_W - 1219200, 914400, runP(s.title, 2800, { bold: true }))}${s.bullets.length ? textBox(3, 'Body', 609600, 1524000, EMU_W - 1219200, EMU_H - 2133600, s.bullets.map((b) => runP(b.text, b.level ? 1600 : 1800, { bullet: true, level: b.level, color: '374151' })).join('')) : ''}`,
      ),
    ),
  ];
  const files: Record<string, string> = {
    '[Content_Types].xml': `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${all.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
    '_rels/.rels': RELS_ROOT('ppt/presentation.xml'),
    'docProps/core.xml': core(title),
    'ppt/presentation.xml': `${HEAD}<p:presentation ${NS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rIdM"/></p:sldMasterIdLst><p:sldIdLst>${all.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`).join('')}</p:sldIdLst><p:sldSz cx="${EMU_W}" cy="${EMU_H}"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle><a:defPPr><a:defRPr lang="en-US"/></a:defPPr></p:defaultTextStyle></p:presentation>`,
    'ppt/_rels/presentation.xml.rels': `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdM" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/><Relationship Id="rIdT" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>${all.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`).join('')}</Relationships>`,
    'ppt/slideMasters/slideMaster1.xml': `${HEAD}<p:sldMaster ${NS}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="3200"/></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`,
    'ppt/slideMasters/_rels/slideMaster1.xml.rels': `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`,
    'ppt/slideLayouts/slideLayout1.xml': `${HEAD}<p:sldLayout ${NS} type="blank" preserve="1"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`,
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels': `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`,
    'ppt/theme/theme1.xml': THEME,
  };
  all.forEach((x, i) => {
    files[`ppt/slides/slide${i + 1}.xml`] = x;
    files[`ppt/slides/_rels/slide${i + 1}.xml.rels`] = `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`;
  });
  return zip(files);
}

const solid = (c: string) => `<a:solidFill><a:srgbClr val="${c}"/></a:solidFill>`;
const THEME = `${HEAD}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="${BRAND.name}"><a:themeElements><a:clrScheme name="Headcount"><a:dk1><a:srgbClr val="1F2937"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="374151"/></a:dk2><a:lt2><a:srgbClr val="F3F4F6"/></a:lt2><a:accent1><a:srgbClr val="D1A54A"/></a:accent1><a:accent2><a:srgbClr val="2563EB"/></a:accent2><a:accent3><a:srgbClr val="10B981"/></a:accent3><a:accent4><a:srgbClr val="8B5CF6"/></a:accent4><a:accent5><a:srgbClr val="F43F5E"/></a:accent5><a:accent6><a:srgbClr val="0EA5E9"/></a:accent6><a:hlink><a:srgbClr val="2563EB"/></a:hlink><a:folHlink><a:srgbClr val="7C3AED"/></a:folHlink></a:clrScheme><a:fontScheme name="Headcount"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Headcount"><a:fillStyleLst>${solid('D1A54A')}${solid('2563EB')}${solid('10B981')}</a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst>${solid('FFFFFF')}${solid('F3F4F6')}${solid('E5E7EB')}</a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`;

export const EXPORT_MIME = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  md: 'text/markdown; charset=utf-8',
} as const;

/** A safe file name from a title: letters, digits, spaces and dashes. */
export function fileNameOf(title: string, ext: string): string {
  const base = title.replace(/[^\p{L}\p{N} _-]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Document';
  return `${base}.${ext}`;
}
