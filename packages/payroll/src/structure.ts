/**
 * Salary structures: how a monthly gross splits into components. Each line is a percentage of gross, a percentage
 * of basic (the BASIC line), a fixed amount, or the balance of gross left after the others. Pure and deterministic,
 * rounded to whole rupees; the balance absorbs rounding so the lines always add up to the gross.
 */
export type StructureCalc = 'percent_of_gross' | 'percent_of_basic' | 'fixed' | 'balance';

export interface StructureLine {
  componentId: string;
  code: string;
  name: string;
  calc: StructureCalc;
  value: number; // percent (40 = 40%) or rupees for fixed; ignored for balance
}

export interface BreakupLine { componentId: string; code: string; name: string; amount: number }

export interface Breakup {
  lines: BreakupLine[];
  total: number;
  /** The fixed and percentage lines exceed the gross: the balance is zero and the total is above the gross. */
  overflow: boolean;
}

export function structureBreakup(monthlyGross: number, lines: StructureLine[]): Breakup {
  const gross = Math.max(0, Math.round(monthlyGross));
  const amounts = new Map<string, number>();
  for (const l of lines) {
    if (l.calc === 'percent_of_gross') amounts.set(l.componentId, Math.round((gross * l.value) / 100));
    if (l.calc === 'fixed') amounts.set(l.componentId, Math.round(l.value));
  }
  const basicLine = lines.find((l) => l.code === 'BASIC');
  const basic = basicLine ? amounts.get(basicLine.componentId) ?? 0 : 0;
  for (const l of lines) {
    if (l.calc === 'percent_of_basic') amounts.set(l.componentId, Math.round((basic * l.value) / 100));
  }
  const allocated = [...amounts.values()].reduce((s, n) => s + n, 0);
  const balance = gross - allocated;
  let balanceGiven = false;
  for (const l of lines) {
    if (l.calc !== 'balance') continue;
    amounts.set(l.componentId, balanceGiven ? 0 : Math.max(0, balance));
    balanceGiven = true;
  }
  const out = lines.map((l) => ({ componentId: l.componentId, code: l.code, name: l.name, amount: amounts.get(l.componentId) ?? 0 }));
  return { lines: out, total: out.reduce((s, l) => s + l.amount, 0), overflow: balance < 0 };
}
