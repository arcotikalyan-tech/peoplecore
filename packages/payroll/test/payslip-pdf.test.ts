import { describe, expect, it } from 'vitest';
import { payslipAmount, payslipMonth, payslipPdf, type PayslipDocument } from '../src/index.ts';

const doc = (o: Partial<PayslipDocument> = {}): PayslipDocument => ({
  organization: 'PeopleCore Demo (synthetic data)',
  periodMonth: '2026-05-01',
  employee: { name: 'Asha Iyer', code: 'PC-0001', designation: 'Engineer', department: 'Engineering' },
  payableDays: 29, lopDays: 2,
  earnings: [{ name: 'Basic', amount: 30000 }, { name: 'House rent allowance', amount: 15000 }],
  deductions: [{ name: 'Provident fund', amount: 1800 }, { name: 'Professional tax', amount: 200 }],
  totals: { gross: 45000, deductions: 2000, net: 43000 },
  ...o,
});
const text = (bytes: Uint8Array) => Buffer.from(bytes).toString('latin1');

describe('payslipPdf', () => {
  it('is a well-formed PDF: every cross-reference offset points at its object', () => {
    const pdf = text(payslipPdf(doc()));
    expect(pdf.startsWith('%PDF-1.4\n')).toBe(true);
    expect(pdf.endsWith('%%EOF\n')).toBe(true);
    const xrefAt = Number(pdf.match(/startxref\n(\d+)\n/)![1]);
    expect(pdf.slice(xrefAt, xrefAt + 4)).toBe('xref');
    const offsets = [...pdf.slice(xrefAt).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    expect(offsets).toHaveLength(6); // catalog, pages, two fonts, one page and its content
    offsets.forEach((o, i) => expect(pdf.slice(o).startsWith(`${i + 1} 0 obj`)).toBe(true));
    const stream = pdf.match(/<< \/Length (\d+) >>\nstream\n/)!;
    const start = stream.index! + stream[0].length;
    expect(pdf.slice(start + Number(stream[1]), start + Number(stream[1]) + 10)).toBe('\nendstream');
  });

  it('shows the period, the employee, every line and the totals', () => {
    const pdf = text(payslipPdf(doc()));
    for (const s of ['Payslip for May 2026', 'Asha Iyer', 'PC-0001', 'Engineering', 'Basic', 'House rent allowance',
      'Provident fund', '30,000.00', '45,000.00', '2,000.00', 'Net pay', '43,000.00', '(29)', '(2)']) {
      expect(pdf, s).toContain(s.startsWith('(') ? s : `(${s})`);
    }
  });

  it('right-aligns amounts on the margin', () => {
    const pdf = text(payslipPdf(doc()));
    // "43,000.00" at 13 pt: 7 digits × 556 + comma 278 + period 278 = 4448 units → 57.82 pt.
    expect(pdf).toContain(`${(539 - 57.824).toFixed(2)} `);
    expect(pdf).toMatch(/\/F2 13 Tf 481\.18 [\d.]+ Td \(43,000\.00\) Tj/);
  });

  it('is deterministic', () => {
    expect(text(payslipPdf(doc()))).toBe(text(payslipPdf(doc())));
  });

  it('escapes PDF string delimiters and replaces what the standard fonts cannot print', () => {
    const pdf = text(payslipPdf(doc({ organization: 'Acme (India) \\ Ltd', employee: { name: 'आशा Müller', code: 'X-1' } })));
    expect(pdf).toContain('(Acme \\(India\\) \\\\ Ltd)');
    expect(pdf).toContain(`(??? M${'ü'}ller)`);
    expect(pdf).not.toContain('Designation');
  });

  it('continues on a second page when there are many lines', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ name: `Allowance ${i + 1}`, amount: 100 }));
    const pdf = text(payslipPdf(doc({ earnings: many })));
    expect(pdf).toContain('/Count 2');
    expect(pdf).toContain('(Allowance 60)');
    expect(pdf).toContain('(Net pay)');
  });

  it('formats amounts and months the Indian way', () => {
    expect(payslipAmount(1234567.5)).toBe('12,34,567.50');
    expect(payslipAmount(-450)).toBe('-450.00');
    expect(payslipMonth('2026-01-01')).toBe('January 2026');
  });
});
