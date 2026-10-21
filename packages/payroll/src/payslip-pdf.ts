/**
 * A payslip as a PDF, with no dependencies: A4, the standard Helvetica fonts (so nothing is embedded), text and
 * rules only, uncompressed. The same input always gives the same bytes; there is no creation date.
 *
 * The standard fonts cover Latin-1 only: other characters (for example a name in Devanagari) print as "?".
 * The on-screen payslip shows them correctly.
 */

export interface PayslipLine { name: string; amount: number }

export interface PayslipDocument {
  organization: string;
  /** First day of the month, ISO (yyyy-mm-dd). */
  periodMonth: string;
  employee: { name: string; code: string; department?: string | null; designation?: string | null };
  payableDays: number;
  lopDays: number;
  earnings: PayslipLine[];
  deductions: PayslipLine[];
  totals: { gross: number; deductions: number; net: number };
  /** Two decimals (₹1,234.00, the default) or whole rupees (Payroll › Settings › Show paise). */
  showPaise?: boolean;
}

const PAGE = { width: 595, height: 842, left: 56, right: 539, top: 786, bottom: 72 };
const amountFormat = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Amounts in Indian grouping with two decimals, e.g. 1,23,456.00. */
export const payslipAmount = (n: number) => amountFormat.format(n);
const wholeFormat = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

export const payslipMonth = (iso: string) =>
  new Date(`${iso.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** Helvetica and Helvetica-Bold share these widths (per 1000 units) for the characters amounts use. */
const NUMBER_WIDTHS: Record<string, number> = { ',': 278, '.': 278, '-': 333, ' ': 278 };
function numberWidth(s: string, size: number) {
  let w = 0;
  for (const c of s) w += NUMBER_WIDTHS[c] ?? 556; // digits are 556
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

class Pages {
  pages: string[][] = [[]];
  y = PAGE.top;
  constructor(private readonly format: (n: number) => string = payslipAmount) {}
  private get ops() { return this.pages[this.pages.length - 1]!; }

  /** Moves down by `dy`, starting a new page when there's no room. */
  down(dy: number) {
    if (this.y - dy < PAGE.bottom) {
      this.pages.push([]);
      this.y = PAGE.top;
    }
    this.y -= dy;
  }
  text(x: number, s: string, size = 10, bold = false) {
    this.ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x.toFixed(2)} ${this.y.toFixed(2)} Td (${pdfText(s)}) Tj ET`);
  }
  amount(n: number, size = 10, bold = false) {
    const s = this.format(n);
    this.text(PAGE.right - numberWidth(s, size), s, size, bold);
  }
  rule(weight = 0.5) {
    this.ops.push(`${weight} w ${PAGE.left} ${(this.y - 6).toFixed(2)} m ${PAGE.right} ${(this.y - 6).toFixed(2)} l S`);
  }
}

export function payslipPdf(doc: PayslipDocument): Uint8Array {
  const p = new Pages(doc.showPaise === false ? (n) => wholeFormat.format(n) : payslipAmount);
  p.text(PAGE.left, doc.organization, 16, true);
  p.down(22);
  p.text(PAGE.left, `Payslip for ${payslipMonth(doc.periodMonth)}`, 12);
  p.rule(1);

  const details: Array<[string, string]> = [
    ['Employee', doc.employee.name],
    ['Employee code', doc.employee.code],
    ...(doc.employee.designation ? [['Designation', doc.employee.designation] as [string, string]] : []),
    ...(doc.employee.department ? [['Department', doc.employee.department] as [string, string]] : []),
    ['Payable days', String(doc.payableDays)],
    ['Loss of pay days', String(doc.lopDays)],
  ];
  p.down(14);
  for (const [label, value] of details) {
    p.down(16);
    p.text(PAGE.left, label, 10);
    p.text(PAGE.left + 130, value, 10, true);
  }

  const section = (title: string, lines: PayslipLine[], totalLabel: string, total: number) => {
    p.down(30);
    p.text(PAGE.left, title, 11, true);
    p.text(PAGE.right - 70, 'Amount (INR)', 9);
    p.rule();
    p.down(4);
    for (const l of lines) {
      p.down(16);
      p.text(PAGE.left, l.name);
      p.amount(l.amount);
    }
    if (lines.length === 0) {
      p.down(16);
      p.text(PAGE.left, 'None');
    }
    p.rule();
    p.down(20);
    p.text(PAGE.left, totalLabel, 10, true);
    p.amount(total, 10, true);
  };
  section('Earnings', doc.earnings, 'Gross earnings', doc.totals.gross);
  section('Deductions', doc.deductions, 'Total deductions', doc.totals.deductions);

  p.down(20);
  p.rule(1);
  p.down(24);
  p.text(PAGE.left, 'Net pay', 13, true);
  p.amount(doc.totals.net, 13, true);
  p.down(40);
  p.text(PAGE.left, 'Amounts are in Indian rupees. This payslip is computer generated and needs no signature.', 8);

  return assemble(p.pages);
}

function assemble(pages: string[][]): Uint8Array {
  // 1 catalog, 2 pages, 3 Helvetica, 4 Helvetica-Bold, then a page and its content stream per page.
  const kids = pages.map((_, i) => `${5 + i * 2} 0 R`).join(' ');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  ];
  for (const [i, ops] of pages.entries()) {
    const content = ops.join('\n');
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + i * 2} 0 R >>`,
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    );
  }
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  // Every character is Latin-1 by now, so one byte each: string offsets are byte offsets.
  return Uint8Array.from(pdf, (c) => c.charCodeAt(0));
}
