import { describe, expect, it } from 'vitest';
import {
  applicableForms, evaluate, obligationsDue, obligationsForPeriod, STAT_FORM_BY_ID, STAT_FORMS, STATES, type ScopeFacts,
} from '../src/statutory.ts';

const form = (id: string) => STAT_FORM_BY_ID.get(id)!;
const small: ScopeFacts = {
  headcount: 8, byState: { KA: 3 }, pfEnabled: true, pfCode: false, esiEnabled: true, esiCode: false, ptEnabled: true,
  tds: true, contractLabour: false, factory: false,
};

describe('catalogue', () => {
  it('has unique ids and a known jurisdiction for every form', () => {
    expect(new Set(STAT_FORMS.map((f) => f.id)).size).toBe(STAT_FORMS.length);
    for (const f of STAT_FORMS) expect(f.jurisdiction === 'IN' || f.jurisdiction in STATES).toBe(true);
  });
  it('only uses MM-DD dates that exist', () => {
    for (const f of STAT_FORMS) {
      const r = f.due;
      const dates = r.kind === 'quarterly' || r.kind === 'half_yearly' ? r.due : r.kind === 'annual' ? [r.due] : r.kind === 'monthly' && r.march ? [r.march] : [];
      for (const d of dates) expect(d).toMatch(/^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/);
    }
  });
});

describe('due dates', () => {
  it('monthly forms fall due in the following month; TDS for March by 30 April', () => {
    const ecr = obligationsDue([form('IN-P-01')], '2026-11-01', '2026-11-30');
    expect(ecr.map((o) => [o.label, o.due])).toEqual([['Oct 2026', '2026-11-15']]);
    const tds = obligationsDue([form('IN-T-01')], '2026-04-01', '2026-04-30');
    expect(tds.map((o) => [o.label, o.due])).toEqual([['Mar 2026', '2026-04-30']]);
    expect(obligationsDue([form('IN-T-01')], '2026-04-07', '2026-04-07')).toEqual([]);
  });
  it('Form 24Q follows the financial-year quarters', () => {
    const q = obligationsDue([form('IN-T-02')], '2026-01-01', '2026-12-31');
    expect(q.map((o) => [o.label, o.due])).toEqual([
      ['Q3 FY 2025-26', '2026-01-31'], ['Q4 FY 2025-26', '2026-05-31'], ['Q1 FY 2026-27', '2026-07-31'], ['Q2 FY 2026-27', '2026-10-31'],
    ]);
  });
  it('annual and half-yearly forms fall due after the period ends', () => {
    expect(obligationsDue([form('KA-LWF-01')], '2027-01-01', '2027-01-31').map((o) => [o.label, o.due])).toEqual([['2026', '2027-01-15']]);
    expect(obligationsDue([form('IN-T-03')], '2026-06-01', '2026-06-30').map((o) => [o.label, o.due])).toEqual([['FY 2025-26', '2026-06-15']]);
    expect(obligationsDue([form('MH-LWF-01')], '2026-07-01', '2026-07-31').map((o) => o.label)).toEqual(['Jan–Jun 2026']);
  });
  it('Maharashtra PT is due within the month itself', () => {
    expect(obligationsDue([form('MH-PT-02')], '2026-02-01', '2026-02-28').map((o) => o.due)).toEqual(['2026-02-28']);
  });
  it('Labour Code forms start with the codes', () => {
    expect(obligationsDue([form('IN-W-03')], '2025-11-01', '2025-11-30')).toEqual([]);
    expect(obligationsDue([form('IN-W-03')], '2025-12-01', '2025-12-31').map((o) => o.label)).toEqual(['Nov 2025']);
  });
  it('the documents for a wage period are the obligations whose period ends in that month', () => {
    const ids = obligationsForPeriod([form('IN-P-01'), form('IN-T-02'), form('KA-LWF-01')], '2026-12').map((o) => o.form.id);
    expect(ids).toEqual(['IN-P-01', 'KA-LWF-01', 'IN-T-02']); // by due date: 15 Jan, 15 Jan, 31 Jan
    expect(obligationsForPeriod([form('IN-T-02')], '2026-11')).toEqual([]);
  });
});

describe('applicability', () => {
  it('applies thresholds and explains why', () => {
    const pf = evaluate(form('IN-P-01'), small, '2026-10-20');
    expect(pf.applies).toBe(false);
    expect(pf.reasons.join(' ')).toContain('fewer than 20 employees');
    expect(evaluate(form('IN-P-01'), { ...small, pfCode: true }, '2026-10-20').applies).toBe(true);
    expect(evaluate(form('IN-G-01'), small, '2026-10-20').applies).toBe(false);
    expect(evaluate(form('IN-G-01'), { ...small, headcount: 12 }, '2026-10-20').applies).toBe(true);
  });
  it('state forms need an establishment in the state; PT and LWF follow the state', () => {
    const ids = applicableForms(small, '2026-10-20').map((f) => f.id);
    expect(ids).toContain('KA-PT-02');
    expect(ids).toContain('KA-LWF-01');
    expect(ids).not.toContain('MH-PT-02');
    expect(ids).not.toContain('IN-C-04');
    expect(applicableForms({ ...small, ptEnabled: false }, '2026-10-20').map((f) => f.id)).not.toContain('KA-PT-02');
    expect(applicableForms({ ...small, byState: { DL: 2 } }, '2026-10-20').map((f) => f.id)).not.toContain('DL-PT-02');
  });
});
