import { inflateRawSync } from 'node:zlib';

/**
 * Reads the first worksheet of an .xlsx workbook into rows of cell text, for employee imports. An .xlsx file is a ZIP
 * of XML parts: the reader finds the parts it needs through the ZIP's central directory, inflates them with Node's
 * zlib and reads shared strings and cells. Formulas give their cached values; dates stay Excel serial numbers (the
 * import mapping turns them into dates). Old .xls files aren't supported.
 */
export class XlsxError extends Error {}

const MAX_PART_BYTES = 20 * 1024 * 1024;

function unzip(bytes: Uint8Array, want: (name: string) => boolean): Map<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // End of central directory: within the last 64 KiB + 22 bytes.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new XlsxError('This isn’t an Excel workbook (.xlsx). Save it as .xlsx or CSV and try again.');
  const entries = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const out = new Map<string, string>();
  const decoder = new TextDecoder('utf-8');
  for (let n = 0; n < entries; n++) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== 0x02014b50) throw new XlsxError('The workbook is damaged.');
    const method = view.getUint16(p + 10, true);
    const compressed = view.getUint32(p + 20, true);
    const size = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!want(name)) continue;
    if (size > MAX_PART_BYTES) throw new XlsxError('The workbook is too large.');
    if (view.getUint32(local, true) !== 0x04034b50) throw new XlsxError('The workbook is damaged.');
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + compressed);
    const raw = method === 0 ? data : method === 8 ? inflateRawSync(data, { maxOutputLength: MAX_PART_BYTES }) : null;
    if (!raw) throw new XlsxError('The workbook uses a compression this reader doesn’t support. Save it as CSV and try again.');
    out.set(name, decoder.decode(raw));
  }
  return out;
}

const decodeXml = (s: string) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
  .replace(/&amp;/g, '&');

/** The text of every <t> in a fragment (rich-text runs joined), leaving out phonetic hints. */
const textOf = (xml: string) => [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1]!)).join('');

const columnIndex = (ref: string) => {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? 'A';
  return [...letters].reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0) - 1;
};

export function readXlsx(bytes: Uint8Array, limits = { rows: 2001, columns: 60 }): string[][] {
  const parts = unzip(bytes, (n) => n === 'xl/workbook.xml' || n === 'xl/_rels/workbook.xml.rels' || n === 'xl/sharedStrings.xml' || n.startsWith('xl/worksheets/sheet'));
  const workbook = parts.get('xl/workbook.xml');
  if (!workbook) throw new XlsxError('This isn’t an Excel workbook (.xlsx). Save it as .xlsx or CSV and try again.');
  // The first sheet in the workbook's order, through its relationship id.
  const rid = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(workbook)?.[1];
  const target = rid ? new RegExp(`<Relationship\\b[^>]*\\bId="${rid}"[^>]*\\bTarget="([^"]+)"`).exec(parts.get('xl/_rels/workbook.xml.rels') ?? '')?.[1]
    ?? new RegExp(`<Relationship\\b[^>]*\\bTarget="([^"]+)"[^>]*\\bId="${rid}"`).exec(parts.get('xl/_rels/workbook.xml.rels') ?? '')?.[1] : undefined;
  const sheetPath = target ? (target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`) : 'xl/worksheets/sheet1.xml';
  const sheet = parts.get(sheetPath) ?? parts.get('xl/worksheets/sheet1.xml');
  if (!sheet) throw new XlsxError('The workbook has no worksheet.');
  const shared = [...(parts.get('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]!));

  const rows: string[][] = [];
  for (const rm of sheet.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const r = Number(/\br="(\d+)"/.exec(rm[1]!)?.[1] ?? rows.length + 1) - 1;
    if (r >= limits.rows) throw new XlsxError(`Import at most ${(limits.rows - 1).toLocaleString('en-IN')} rows at a time.`);
    const row: string[] = [];
    for (const cm of rm[2]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1]!;
      const inner = cm[2] ?? '';
      const c = columnIndex(/\br="([A-Z]+\d+)"/.exec(attrs)?.[1] ?? '');
      if (c >= limits.columns) continue;
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      let value = '';
      if (type === 's') value = shared[Number(v)] ?? '';
      else if (type === 'inlineStr') value = textOf(inner);
      else if (type === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
      else if (v !== undefined) value = decodeXml(v);
      row[c] = value;
    }
    rows[r] = Array.from(row, (x) => x ?? '');
  }
  // Rows with nothing in them are left out (spreadsheets often carry blank rows below the data).
  return Array.from(rows, (x) => x ?? []).filter((row) => row.some((x) => x.trim() !== ''));
}
