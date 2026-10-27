import type { Payslip } from './engine.ts';

/**
 * The text a run's results are fingerprinted from (SHA-256 of it, hex). The database builds the same text from what
 * was stored (app.payroll_results_digest), so the checker's approval names results they reproduced from the inputs,
 * not just the inputs. One line per employee, sorted by id: blocking, payable days, on hold, the claims, adjustments
 * and encashments the run pays, the PF and ESI wages, and every line as code/kind/amount. Keep in step with the SQL.
 */
interface StoredInput {
  payableDays: number;
  onHold?: boolean;
  reimbursementClaims?: string[];
  adjustmentIds?: string[];
  encashmentIds?: string[];
}

const num = (n: number) => String(Math.round(n * 100) / 100);
const ids = (list: string[] | undefined) => [...(list ?? [])].sort().join(',');
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function resultsDigestSource(results: Array<Pick<Payslip, 'employeeId' | 'lines' | 'exceptions'> & Partial<Pick<Payslip, 'statutoryWages'>> & { input: StoredInput }>): string {
  return [...results]
    .sort((a, b) => byText(a.employeeId, b.employeeId))
    .map((r) => [
      r.employeeId,
      r.exceptions.some((e) => e.blocking) ? '1' : '0',
      num(r.input.payableDays),
      String(r.input.onHold ?? false),
      ids(r.input.reimbursementClaims),
      ids(r.input.adjustmentIds),
      ids(r.input.encashmentIds),
      `${num(r.statutoryWages?.pf ?? 0)}/${num(r.statutoryWages?.esi ?? 0)}`,
      [...r.lines]
        .sort((a, b) => byText(a.code, b.code) || byText(a.kind, b.kind) || a.amount - b.amount)
        .map((l) => `${l.code}/${l.kind}/${num(l.amount)}`).join(','),
    ].join('|'))
    .join('\n');
}
