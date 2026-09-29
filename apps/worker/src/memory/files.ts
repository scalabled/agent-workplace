// Reading dropped files to text (Inc 4 context cards): PDF (unpdf), Word (the document XML inside the .docx zip), Excel
// (each sheet's cells, as comma-separated rows), and plain text formats. Nothing in a file is ever run.
import { strFromU8, unzipSync } from 'fflate';
import type { CardKind } from '@headcount/protocol/ext/memory';

export class FileReadError extends Error {}

const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|yaml|yml|xml|html?|rtf|log)$/i;
/** Text kept from one file. */
export const FILE_TEXT_MAX = 400_000;

export function kindOf(name: string, mime: string): CardKind | null {
  const n = name.toLowerCase();
  if (n.endsWith('.pdf') || mime === 'application/pdf') return 'pdf';
  if (n.endsWith('.docx')) return 'docx';
  if (n.endsWith('.xlsx')) return 'xlsx';
  if (n.endsWith('.csv') || n.endsWith('.tsv')) return 'csv';
  if (TEXT_EXT.test(n)) return 'text';
  // Only a name without an extension falls back to the type the browser sent.
  return !/\.[a-z0-9]{1,8}$/i.test(n) && mime.startsWith('text/') ? 'text' : null;
}

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function xmlText(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e: string) =>
    e[0] === '#' ? String.fromCodePoint(e[1]!.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (XML_ENTITIES[e.toLowerCase()] ?? m),
  );
}

function unzip(bytes: Uint8Array): Record<string, Uint8Array> {
  try {
    return unzipSync(bytes);
  } catch {
    throw new FileReadError('That file could not be opened (it is not a valid Office file).');
  }
}

export function docxText(bytes: Uint8Array): string {
  const files = unzip(bytes);
  const doc = files['word/document.xml'];
  if (!doc) throw new FileReadError('That is not a Word document.');
  const xml = strFromU8(doc);
  return xml
    .split(/<\/w:p>/)
    .map((p) =>
      xmlText(
        (p.match(/<w:t(?:\s[^>]*)?>[^<]*<\/w:t>|<w:tab\/>|<w:br\/>/g) ?? [])
          .map((t) => (t === '<w:tab/>' ? '\t' : t === '<w:br/>' ? '\n' : t.replace(/<[^>]+>/g, '')))
          .join(''),
      ),
    )
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function xlsxText(bytes: Uint8Array, maxRows = 2000): string {
  const files = unzip(bytes);
  const shared = files['xl/sharedStrings.xml'] ? [...strFromU8(files['xl/sharedStrings.xml']).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => xmlText((m[1]!.match(/<t(?:\s[^>]*)?>[^<]*<\/t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, '')).join(''))) : [];
  const workbook = files['xl/workbook.xml'] ? strFromU8(files['xl/workbook.xml']) : '';
  const names = [...workbook.matchAll(/<sheet\b[^>]*name="([^"]*)"/g)].map((m) => xmlText(m[1]!));
  const sheets = Object.keys(files)
    .filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k))
    .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)![1]) - Number(/(\d+)\.xml$/.exec(b)![1]))
    .slice(0, 20);
  if (!sheets.length) throw new FileReadError('That is not an Excel workbook.');
  const out: string[] = [];
  sheets.forEach((key, i) => {
    const xml = strFromU8(files[key]!);
    const rows: string[] = [];
    for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      if (rows.length >= maxRows) break;
      const cells: string[] = [];
      for (const c of row[1]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1]!;
        const col = /r="([A-Z]+)\d+"/.exec(attrs)?.[1];
        const idx = col ? [...col].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1 : cells.length;
        const type = /t="([^"]+)"/.exec(attrs)?.[1];
        const inner = c[2] ?? '';
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        const value = type === 's' && v !== undefined ? (shared[Number(v)] ?? '') : type === 'inlineStr' ? xmlText((inner.match(/<t(?:\s[^>]*)?>[^<]*<\/t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, '')).join('')) : v !== undefined ? xmlText(v) : '';
        while (cells.length < idx) cells.push('');
        cells[idx] = value;
      }
      if (cells.some((x) => x.trim())) rows.push(cells.map(csvCell).join(','));
    }
    if (rows.length) out.push(`## ${names[i] ?? `Sheet ${i + 1}`}\n${rows.join('\n')}`);
  });
  return out.join('\n\n');
}

export async function pdfText(bytes: Uint8Array): Promise<string> {
  try {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(bytes);
    const { text } = await extractText(pdf, { mergePages: true });
    return (Array.isArray(text) ? text.join('\n\n') : text).trim();
  } catch {
    throw new FileReadError('No readable text in that PDF (a scanned image cannot be read yet).');
  }
}

/** The text of a file, or a FileReadError with one sentence the owner can act on. */
export async function readFile(name: string, mime: string, bytes: Uint8Array): Promise<{ kind: CardKind; text: string }> {
  const kind = kindOf(name, mime);
  if (!kind) throw new FileReadError('Use a PDF, Word (.docx), Excel (.xlsx), CSV or text file.');
  let text: string;
  if (kind === 'pdf') text = await pdfText(bytes);
  else if (kind === 'docx') text = docxText(bytes);
  else if (kind === 'xlsx') text = xlsxText(bytes);
  else text = new TextDecoder().decode(bytes).replace(/^﻿/, '');
  text = text.replace(/\u0000/g, '').trim();
  if (!text) throw new FileReadError('No readable text in that file.');
  return { kind, text: text.slice(0, FILE_TEXT_MAX) };
}
