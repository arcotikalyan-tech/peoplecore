/**
 * The payslip, one format for every organization (the owner's Dronevex payslip, September 2026): what goes where,
 * worded and formatted the same way in the PDF (@peoplecore/payroll), on the website and in the phone app.
 */

export interface PayslipLine { name: string; amount: number }

/** One payslip's facts, as the server reads them for the signed-in person. */
export interface PayslipData {
  /** The organization's name, used when there is no legal name. */
  organization: string;
  company?: { legalName?: string | null; addressLines?: string[] };
  /** First day of the month, ISO (yyyy-mm-dd). */
  periodMonth: string;
  employee: {
    name: string; code: string; designation?: string | null; department?: string | null;
    /** ISO dates. */
    dateOfBirth?: string | null; joiningDate?: string | null;
    location?: string | null; uan?: string | null; pfNumber?: string | null; pan?: string | null; los?: string | null;
  };
  /** 'new' or 'old' income tax regime. */
  regime?: string | null;
  /** The month's days under the pay-days basis (calendar days, 30, or working days). */
  standardDays?: number | null;
  payableDays: number;
  lopDays: number;
  payment?: { mode?: string | null; accountNumber?: string | null };
  earnings: PayslipLine[];
  deductions: PayslipLine[];
  totals: { gross: number; deductions: number; net: number };
  /** Two decimals (1,234.00, the default) or whole rupees (Payroll › Settings › Show paise). */
  showPaise?: boolean;
  /** When it was made, shown at the foot as local time in `timeZone`. Left out, the foot has no time. */
  generatedAt?: Date | string | null;
  timeZone?: string;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** 23-SEP-1997. */
export const payslipDate = (iso: string | null | undefined) =>
  iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}-${MONTHS[Number(iso.slice(5, 7)) - 1]}-${iso.slice(0, 4)}` : '';

const paise = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const whole = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
/** Amounts grouped in thousands, as on the owner's payslip: 102,000.00 (or 102,000 without paise). */
export const payslipMoney = (n: number, showPaise = true) => (showPaise ? paise : whole).format(n);

export const PAYSLIP_REGIMES: Record<string, string> = { new: 'New Regime', old: 'Old Regime' };

/** The footer's time as the owner's payslip prints it, "Thu Oct 29 16:27:41 IST 2026", and the date "29/10/2026". */
export function payslipStamp(at: Date, timeZone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, weekday: 'short', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', year: 'numeric', timeZoneName: 'short',
  }).formatToParts(at).map((p) => [p.type, p.value]));
  const zone = timeZone === 'Asia/Kolkata' || timeZone === 'Asia/Calcutta' ? 'IST' : parts.timeZoneName ?? 'UTC';
  return {
    long: `${parts.weekday} ${parts.month} ${parts.day} ${parts.hour}:${parts.minute}:${parts.second} ${zone} ${parts.year}`,
    short: new Intl.DateTimeFormat('en-GB', { timeZone, day: '2-digit', month: '2-digit', year: 'numeric' }).format(at),
  };
}

export interface PayslipLayout {
  /** The legal name in capitals, and the registered office in up to three lines. */
  company: string;
  address: string[];
  /** "Payslip  for the month of  SEPTEMBER 2026". */
  title: string;
  /** Employee details: the left column (six rows) and the right column (five). */
  left: Array<[string, string]>;
  right: Array<[string, string]>;
  earnings: Array<[string, string]>;
  deductions: Array<[string, string]>;
  /** Beside the lines: the days, then the payment. */
  days: Array<[string, string]>;
  payment: Array<[string, string]>;
  totals: { earnings: string; deductions: string; net: string };
  /** In bold inside the box. */
  notes: string[];
  /** At the foot of the page; `italic` is the time it was made. */
  foot: Array<{ text: string; italic?: boolean }>;
}

const SIGNATORY = 'This is a system-generated payslip. Authorized signatory details and signature, where configured for the applicable Pay Group, Process Type and Pay Period, will be displayed on this document. Documents generated without a configured signature remain valid and do not require a physical signature.';

/** Every label and value of the payslip, in order. */
export function payslipLayout(d: PayslipData): PayslipLayout {
  const money = (n: number) => payslipMoney(n, d.showPaise !== false);
  const legal = d.company?.legalName?.trim() || d.organization;
  // The disclaimer names the company in title case even when the legal name is stored in capitals.
  const named = legal === legal.toUpperCase() ? legal.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : legal;
  const month = new Date(`${d.periodMonth.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).toUpperCase();
  const e = d.employee;
  const days = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(Number(n)));
  const at = d.generatedAt ? payslipStamp(new Date(d.generatedAt), d.timeZone ?? 'Asia/Kolkata') : null;
  return {
    company: legal.toUpperCase(),
    address: (d.company?.addressLines ?? []).slice(0, 3),
    title: `Payslip  for the month of  ${month}`,
    left: [
      ['Employee ID', e.code], ['Date of Birth', payslipDate(e.dateOfBirth)], ['Designation', e.designation ?? ''],
      ['UAN Number', e.uan ?? ''], ['PF Number', e.pfNumber ?? ''], ['Regime Type', d.regime ? PAYSLIP_REGIMES[d.regime] ?? d.regime : ''],
    ],
    right: [
      ['Employee Name', e.name], ['Joining Date', payslipDate(e.joiningDate)], ['Location', e.location ?? ''],
      ['Pan Number', e.pan ?? ''], ['LOS', e.los ?? ''],
    ],
    earnings: d.earnings.map((l) => [l.name, money(l.amount)]),
    deductions: d.deductions.map((l) => [l.name, money(l.amount)]),
    days: [['STANDARD DAYS', days(d.standardDays)], ['DAYS WORKED', days(d.payableDays)]],
    payment: [['PAYMENT', d.payment?.mode ?? ''], ['A/C No.', d.payment?.accountNumber ?? '']],
    totals: { earnings: money(d.totals.gross), deductions: money(d.totals.deductions), net: money(d.totals.net) },
    notes: [
      'Note: This is a system generated report. This does not require any signature.',
      `Private and Confidential Disclaimer: This payslip has been generated by the ${named} payroll. All compensation information has been treated as confidential`,
    ],
    foot: [
      { text: SIGNATORY },
      ...(at ? [{ text: at.long, italic: true }] : []),
      { text: 'This document contains confidential information. If you are not the intended recipient you are not authorized to use or disclose it in any form.' },
      { text: 'If you received this in error please destroy it along with any copies and notify the sender immediately.' },
      ...(at ? [{ text: at.short }] : []),
    ],
  };
}
