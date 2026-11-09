import { describe, expect, it } from 'vitest';
import { payslipAmount, payslipDate, payslipMonth, payslipPdf, textWidth, type PayslipDocument, type PdfImage } from '../src/index.ts';

const doc = (o: Partial<PayslipDocument> = {}): PayslipDocument => ({
  organization: 'PeopleCore Demo (synthetic data)',
  periodMonth: '2026-05-01',
  company: { legalName: 'PEOPLECORE DEMO PRIVATE LIMITED', addressLines: ['4th Floor, Example Building, HSR Layout,', 'Bengaluru, Karnataka - 560102'] },
  employee: { name: 'Asha Iyer', code: 'PC-0001', designation: 'Engineer', department: 'Engineering', location: 'Bengaluru', dateOfBirth: '1997-09-23',
    joiningDate: '2025-06-27', uan: '100000000001', pan: 'ABCDE1234F' },
  regime: 'new', standardDays: 31, payableDays: 29, lopDays: 2,
  payment: { mode: 'BANK TRANSFER', accountNumber: '00001111222233' },
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
    expect(offsets).toHaveLength(7); // catalog, pages, three fonts, one page and its content
    offsets.forEach((o, i) => expect(pdf.slice(o).startsWith(`${i + 1} 0 obj`)).toBe(true));
    const stream = pdf.match(/<< \/Length (\d+) >>\nstream\n/)!;
    const start = stream.index! + stream[0].length;
    expect(pdf.slice(start + Number(stream[1]), start + Number(stream[1]) + 10)).toBe('\nendstream');
  });

  it('is laid out like the owner’s payslip: letterhead, month, details, earnings beside deductions, days and payment, totals', () => {
    const pdf = text(payslipPdf(doc()));
    for (const s of ['PEOPLECORE DEMO PRIVATE LIMITED', 'Bengaluru, Karnataka - 560102', 'Payslip  for the month of  MAY 2026',
      'Employee ID', 'PC-0001', 'Date of Birth', '23-SEP-1997', 'Designation', 'Engineer', 'UAN Number', '100000000001', 'PF Number',
      'Regime Type', 'New Regime', 'Employee Name', 'Asha Iyer', 'Joining Date', '27-JUN-2025', 'Location', 'Bengaluru', 'Pan Number',
      'ABCDE1234F', 'LOS', 'EARNINGS', 'Amount \\(Rs.\\)', 'DEDUCTIONS', 'Basic', 'House rent allowance', 'Provident fund', '30,000.00',
      'STANDARD DAYS', '31', 'DAYS WORKED', '29', 'PAYMENT', 'BANK TRANSFER', 'A/C No.', '00001111222233',
      'Total Earnings Rs.', '45,000.00', 'Total Deductions Rs.', '2,000.00', 'Net Salary Rs. 43,000.00',
      'Note: This is a system generated report. This does not require any signature.']) {
      expect(pdf, s).toContain(`(${s})`);
    }
    // The disclaimer names the company in title case; the month title is blue; the footer has no time without one.
    expect(pdf).toContain('Peoplecore Demo Private Limited payroll.');
    expect(pdf).toMatch(/BT 0\.1 0\.1 0\.95 rg \/F2 9 Tf [\d.]+ 719\.00 Td \(Payslip/);
    expect(pdf).not.toContain('IST');
  });

  it('right-aligns amounts on their column', () => {
    const pdf = text(payslipPdf(doc()));
    // "30,000.00" at 8 pt ends 2 pt left of the deductions column (207.5).
    expect(pdf).toContain(`${(205.5 - textWidth('30,000.00', 8)).toFixed(2)} `);
    expect(pdf).toContain(`(Net Salary Rs. 43,000.00)`);
  });

  it('prints when it was made, in the organization’s time zone', () => {
    const pdf = text(payslipPdf(doc({ generatedAt: new Date('2026-10-29T10:57:41Z'), timeZone: 'Asia/Kolkata' })));
    expect(pdf).toContain('/F3 7.5 Tf');
    expect(pdf).toContain('(Thu Oct 29 16:27:41 IST 2026)');
    expect(pdf).toContain('(29/10/2026)');
  });

  it('leaves out what it doesn’t have', () => {
    const pdf = text(payslipPdf(doc({ company: undefined, employee: { name: 'Asha Iyer', code: 'PC-0001' }, regime: null, standardDays: null, payment: undefined })));
    expect(pdf).toContain('(PEOPLECORE DEMO \\(SYNTHETIC DATA\\))');
    expect(pdf).toContain('(PF Number)');
    expect(pdf).not.toContain('BANK TRANSFER');
  });

  it('is deterministic', () => {
    expect(text(payslipPdf(doc()))).toBe(text(payslipPdf(doc())));
  });

  it('escapes PDF string delimiters and replaces what the standard fonts cannot print', () => {
    const pdf = text(payslipPdf(doc({ organization: 'Acme (India) \\ Ltd', company: undefined, employee: { name: 'आशा Müller', code: 'X-1' } })));
    expect(pdf).toContain('(ACME \\(INDIA\\) \\\\ LTD)');
    expect(pdf).toContain(`(??? M${'ü'}ller)`);
  });

  it('keeps many lines on one page', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ name: `Allowance ${i + 1}`, amount: 100 }));
    const pdf = text(payslipPdf(doc({ earnings: many })));
    expect(pdf).toContain('/Count 1');
    expect(pdf).toContain('(Allowance 60)');
    expect(pdf).toContain('(Net Salary Rs. 43,000.00)');
  });

  it('formats amounts, months and dates', () => {
    expect(payslipAmount(1234567.5)).toBe('12,34,567.50');
    expect(payslipAmount(-450)).toBe('-450.00');
    expect(payslipMonth('2026-01-01')).toBe('January 2026');
    expect(payslipDate('1997-09-23')).toBe('23-SEP-1997');
    expect(payslipDate(null)).toBe('');
    expect(text(payslipPdf(doc({ earnings: [{ name: 'Basic', amount: 102000 }] })))).toContain('(102,000.00)');
    expect(text(payslipPdf(doc({ showPaise: false })))).toContain('(Net Salary Rs. 43,000)');
  });
});

describe('payslipPdf with a logo', () => {
  const jpeg: PdfImage = { width: 400, height: 200, colorSpace: 'DeviceRGB', filter: 'DCTDecode', data: Uint8Array.from([0xff, 0xd8, 0xff, 0xd9, 0x00, 0x80]) };

  it('draws it top left, kept in proportion within 175 × 38 pt, with the company name beside it', () => {
    const pdf = text(payslipPdf(doc({ logo: jpeg })));
    // 400 × 200 scaled by min(175/400, 38/200) = 0.19 → 76 × 38, left edge at 24, top edge at 789.
    expect(pdf).toContain('q 76.00 0 0 38.00 24.00 751.00 cm /Im1 Do Q');
    expect(pdf).toMatch(/\/F2 12 Tf 112\.00 778\.00 Td \(PEOPLECORE DEMO PRIVATE LIMITED\)/);
    expect(pdf).toContain('/XObject << /Im1 8 0 R >>');
    expect(pdf).toContain('/Width 400 /Height 200 /BitsPerComponent 8 /ColorSpace /DeviceRGB /Filter /DCTDecode /Length 6 >>');
  });

  it('keeps the bytes exactly and every offset right, with transparency as a second image', () => {
    const png: PdfImage = { width: 2, height: 1, colorSpace: 'DeviceGray', filter: 'FlateDecode', data: Uint8Array.from([120, 156, 1, 2, 0, 253, 255, 0, 255, 1, 0, 1, 0]), alpha: Uint8Array.from([120, 156, 99, 0, 0, 0, 1, 0, 1]) };
    const bytes = payslipPdf(doc({ logo: png }));
    const pdf = text(bytes);
    const xrefAt = Number(pdf.match(/startxref\n(\d+)\n/)![1]);
    const offsets = [...pdf.slice(xrefAt).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    expect(offsets).toHaveLength(9); // catalog, pages, three fonts, page, content, image, transparency
    offsets.forEach((o, i) => expect(pdf.slice(o).startsWith(`${i + 1} 0 obj`)).toBe(true));
    expect(pdf).toContain('/SMask 9 0 R');
    const start = pdf.indexOf('/Filter /FlateDecode /SMask 9 0 R /Length 13 >>\nstream\n') + '/Filter /FlateDecode /SMask 9 0 R /Length 13 >>\nstream\n'.length;
    expect([...bytes.subarray(start, start + 13)]).toEqual([...png.data]);
  });

  it('leaves the page as it was without one', () => {
    expect(text(payslipPdf(doc({ logo: null })))).toBe(text(payslipPdf(doc())));
    expect(text(payslipPdf(doc()))).not.toContain('/XObject');
  });
});
