/**
 * A payslip as a PDF, with no dependencies: A4, the standard Helvetica fonts (so nothing is embedded), text, rules and
 * the company logo, uncompressed apart from the logo. The same input always gives the same bytes; the only time in it is
 * `generatedAt`, printed in the footer.
 *
 * The standard fonts cover Latin-1 only: other characters (for example a name in Devanagari) print as "?".
 * The on-screen payslip shows them correctly.
 */

import { payslipDate, payslipLayout, type PayslipData, type PayslipLine } from '@peoplecore/shared/payslip';

export { payslipDate };
export type { PayslipLine };

/** An image ready for a PDF: a JPEG as is, or zlib-compressed 8-bit samples (with transparency, if any). */
export interface PdfImage {
  width: number;
  height: number;
  colorSpace: 'DeviceRGB' | 'DeviceGray' | 'DeviceCMYK';
  filter: 'DCTDecode' | 'FlateDecode';
  data: Uint8Array;
  /** Transparency as zlib-compressed 8-bit gray samples (FlateDecode images only). */
  alpha?: Uint8Array;
  /** Adobe CMYK JPEGs store their samples inverted. */
  invert?: boolean;
}

/** A payslip's facts (shared with the website and the phone app) and the company logo, top left. */
export interface PayslipDocument extends PayslipData {
  /** At most 175 × 38 pt, its proportions kept. */
  logo?: PdfImage | null;
}

const LOGO_BOX = { width: 175, height: 38 };
const PAGE = { width: 595, height: 842 };
/** The bordered block and its columns (points from the left edge). */
const BOX = { left: 18, right: 577, top: 793 };
const COL = { amount1: 143.5, deductions: 207.5, amount2: 333, panel: 393 };
const ROW = 12;

const amountFormat = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Amounts in Indian grouping with two decimals, e.g. 1,23,456.00 (the on-screen payslip). */
export const payslipAmount = (n: number) => amountFormat.format(n);

export const payslipMonth = (iso: string) =>
  new Date(`${iso.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

// Helvetica and Helvetica-Bold advance widths (per 1000 units) for printable ASCII, from the standard AFM files.
const W_REGULAR = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556,
  278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944,
  667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556,
  500, 722, 500, 500, 500, 334, 260, 334, 584];
const W_BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556,
  333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944,
  667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611,
  556, 778, 556, 556, 500, 389, 280, 389, 584];
type Font = 'F1' | 'F2' | 'F3'; // regular, bold, oblique
/** The width of `s` in points (characters outside printable ASCII count as 556). */
export function textWidth(s: string, size: number, font: Font = 'F1') {
  const table = font === 'F2' ? W_BOLD : W_REGULAR;
  let w = 0;
  for (const c of s) { const i = c.charCodeAt(0) - 32; w += table[i] ?? 556; }
  return (w * size) / 1000;
}

/** Latin-1 only, no control characters, PDF string escapes. */
function pdfText(s: string) {
  const latin1 = [...s].map((c) => {
    const code = c.codePointAt(0)!;
    return code < 32 || (code >= 127 && code < 160) || code > 255 ? (code < 32 ? ' ' : '?') : c;
  }).join('');
  return latin1.replace(/[\\()]/g, (c) => `\\${c}`);
}

/** Splits `s` into lines no wider than `width`. */
function wrap(s: string, width: number, size: number, font: Font) {
  const lines: string[] = [];
  let line = '';
  for (const word of s.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && textWidth(next, size, font) > width) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

class Page {
  ops: string[] = [];
  text(x: number, y: number, s: string, size = 8, font: Font = 'F1', color?: string) {
    if (!s) return;
    this.ops.push(`BT ${color ?? '0 0 0'} rg /${font} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${pdfText(s)}) Tj ET`);
  }
  right(x: number, y: number, s: string, size = 8, font: Font = 'F1') { this.text(x - textWidth(s, size, font), y, s, size, font); }
  center(x1: number, x2: number, y: number, s: string, size = 8, font: Font = 'F1', color?: string) {
    this.text((x1 + x2 - textWidth(s, size, font)) / 2, y, s, size, font, color);
  }
  line(x1: number, y1: number, x2: number, y2: number) {
    this.ops.push(`${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`);
  }
  hline(y: number, x1 = BOX.left, x2 = BOX.right) { this.line(x1, y, x2, y); }
  vline(x: number, y1: number, y2: number) { this.line(x, y1, x, y2); }
  image(x: number, y: number, w: number, h: number) {
    this.ops.push(`q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /Im1 Do Q`);
  }
}

/**
 * One payslip on one A4 page, laid out like the payslip the owner gave (Dronevex, September 2026): logo and registered
 * address, the month, the employee's details in two columns, earnings and deductions side by side with the days and
 * payment beside them, the totals and net salary, then the notes and, at the foot of the page, the disclaimers.
 */
export function payslipPdf(doc: PayslipDocument): Uint8Array {
  const L = payslipLayout(doc);
  const p = new Page();
  p.ops.push('0.6 w 0 0 0 RG');

  // Header: logo, company name and address.
  let nameX = BOX.left + 8;
  if (doc.logo) {
    const scale = Math.min(LOGO_BOX.width / doc.logo.width, LOGO_BOX.height / doc.logo.height);
    const [w, h] = [doc.logo.width * scale, doc.logo.height * scale];
    p.image(BOX.left + 6, BOX.top - 4 - h, w, h);
    nameX = BOX.left + 6 + w + 12;
  }
  p.text(nameX, BOX.top - 15, L.company, 12, 'F2');
  L.address.forEach((l, i) => p.text(nameX, BOX.top - 26 - i * 9, l, 7.5));

  // The month.
  p.center(BOX.left, BOX.right, 719, L.title, 9, 'F2', '0.1 0.1 0.95');
  p.hline(714);

  // Employee details: two columns.
  L.left.forEach(([l, v], i) => { const y = 701 - i * 12.2; p.text(23, y, l); p.text(111, y, ':'); p.text(120, y, v); });
  L.right.forEach(([l, v], i) => { const y = 701 - i * 12.2; p.text(303, y, l); p.text(392.5, y, ':'); p.text(400, y, v); });

  // Earnings and deductions, side by side, with the days and the payment in the panel on the right.
  const top = 636;
  p.hline(top);
  p.text(21, top - 9, 'EARNINGS');
  p.center(COL.amount1, COL.deductions, top - 9, 'Amount (Rs.)');
  p.text(COL.deductions + 2, top - 9, 'DEDUCTIONS');
  p.center(COL.amount2, COL.panel, top - 9, 'Amount (Rs.)');
  const head = top - 12.4;
  p.hline(head, BOX.left, COL.panel);
  const rows = Math.max(6, L.earnings.length, L.deductions.length);
  // Everything stays on one page: past about 36 lines the rows (and their type) get smaller.
  const rowH = Math.min(ROW, (head - 165) / rows);
  const size = Math.min(8, rowH - 1);
  const bottom = head - rows * rowH;
  const lineY = (i: number) => head - rowH + (rowH - size) / 2 + size * 0.2 - i * rowH + (rowH === ROW ? 0.6 : 0);
  L.earnings.forEach(([n, a], i) => { p.text(21, lineY(i), n, size); p.right(COL.deductions - 2, lineY(i), a, size); });
  L.deductions.forEach(([n, a], i) => { p.text(COL.deductions + 2, lineY(i), n, size); p.right(COL.panel - 2, lineY(i), a, size); });
  for (const x of [COL.amount1, COL.deductions, COL.amount2, COL.panel]) p.vline(x, top, bottom);
  const panel = ([label, value]: [string, string], y: number) => { p.text(COL.panel + 5, y, label); p.text(489.5, y, ':'); p.text(503, y, value); };
  panel(L.days[0]!, top - 11.5);
  panel(L.days[1]!, top - 23.5);
  p.hline(top - 40.4, COL.panel, BOX.right);
  panel(L.payment[0]!, top - 51.5);
  panel(L.payment[1]!, top - 63);

  // Totals and net salary.
  const totals = bottom - 11.6;
  p.hline(bottom);
  p.hline(totals);
  p.vline(COL.deductions, bottom, totals);
  p.vline(COL.panel, bottom, totals);
  const ty = bottom - 8.6;
  p.right(COL.deductions - 2, ty, L.totals.earnings, 8, 'F2');
  p.right(COL.deductions - 2 - textWidth(L.totals.earnings, 8, 'F2') - 4, ty, 'Total Earnings Rs.', 8, 'F2');
  p.right(COL.panel - 2, ty, L.totals.deductions, 8, 'F2');
  p.right(COL.panel - 2 - textWidth(L.totals.deductions, 8, 'F2') - 10, ty, 'Total Deductions Rs.', 8, 'F2');
  p.right(BOX.right - 2, ty, `Net Salary Rs. ${L.totals.net}`, 8, 'F2');

  // An empty row, then the notes.
  const blank = totals - 27.4;
  p.vline(357, totals, blank);
  p.hline(blank);
  const notes = L.notes.flatMap((n) => wrap(n, BOX.right - BOX.left - 8, 7, 'F2'));
  notes.forEach((l, i) => p.text(21, blank - 9 - i * 8, l, 7, 'F2'));
  const boxBottom = blank - 9 - (notes.length - 1) * 8 - 6;
  p.ops.push(`${BOX.left} ${boxBottom.toFixed(2)} ${BOX.right - BOX.left} ${(BOX.top - boxBottom).toFixed(2)} re S`);

  // The foot of the page: the paragraph wraps; a little more space around the time and before the date.
  const foot = L.foot.flatMap((f) => wrap(f.text, BOX.right - BOX.left - 6, 7.5, 'F1').map((t) => ({ t, font: (f.italic ? 'F3' : 'F1') as Font })));
  const timed = L.foot.some((f) => f.italic);
  const gaps = foot.map((_, i): number => (i === 0 ? 0 : foot[i - 1]!.font === 'F3' || foot[i]!.font === 'F3' || (i === foot.length - 1 && timed) ? 13 : 10));
  let y = 18 + gaps.reduce((a, b) => a + b, 0);
  foot.forEach((f, i) => { y -= gaps[i]!; p.text(BOX.left + 3, y, f.t, 7.5, f.font); });

  return assemble([p.ops], doc.logo ?? null);
}

/** Bytes as a string of the same length (every character below 256), the form the rest of the file is built in. */
function binary(bytes: Uint8Array) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return s;
}

function imageObjects(img: PdfImage, id: number): string[] {
  const common = `/Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /BitsPerComponent 8`;
  const mask = img.alpha ? ` /SMask ${id + 1} 0 R` : '';
  const decode = img.invert ? ' /Decode [1 0 1 0 1 0 1 0]' : '';
  const objects = [`<< ${common} /ColorSpace /${img.colorSpace} /Filter /${img.filter}${decode}${mask} /Length ${img.data.length} >>\nstream\n${binary(img.data)}\nendstream`];
  if (img.alpha) objects.push(`<< ${common} /ColorSpace /DeviceGray /Filter /FlateDecode /Length ${img.alpha.length} >>\nstream\n${binary(img.alpha)}\nendstream`);
  return objects;
}

function assemble(pages: string[][], logo: PdfImage | null): Uint8Array {
  // 1 catalog, 2 pages, 3 Helvetica, 4 Helvetica-Bold, 5 Helvetica-Oblique, then a page and its content stream per page, then the logo (and
  // its transparency), used by the first page.
  const kids = pages.map((_, i) => `${6 + i * 2} 0 R`).join(' ');
  const logoId = 6 + pages.length * 2;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>',
  ];
  for (const [i, ops] of pages.entries()) {
    const content = ops.join('\n');
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >>${
        logo && i === 0 ? ` /XObject << /Im1 ${logoId} 0 R >>` : ''} >> /Contents ${7 + i * 2} 0 R >>`,
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    );
  }
  if (logo) objects.push(...imageObjects(logo, logoId));
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  // Every character is Latin-1 (or a byte of the logo) by now, so one byte each: string offsets are byte offsets.
  return Uint8Array.from(pdf, (c) => c.charCodeAt(0));
}
