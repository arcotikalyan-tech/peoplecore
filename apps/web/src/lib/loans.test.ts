import { describe, expect, it } from 'vitest';
import { loanEmi, loanSchedule } from './loans';

describe('loan arithmetic', () => {
  it('matches the database EMI', () => {
    expect(loanEmi(100000, 12, 12)).toBe(8884.88);
    expect(loanEmi(120000, 0, 12)).toBe(10000);
  });

  it('schedules clear the principal exactly', () => {
    const rows = loanSchedule(100000, 12, 12);
    expect(rows).toHaveLength(12);
    expect(Math.round(rows.reduce((s, r) => s + r.principal, 0) * 100) / 100).toBe(100000);
    expect(rows[0]).toEqual({ seq: 1, opening: 100000, principal: 7884.88, interest: 1000, emi: 8884.88 });
  });
});
