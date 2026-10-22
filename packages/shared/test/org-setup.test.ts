import { describe, expect, it } from 'vitest';
import { evaluateSetup, SETUP_STEPS, type SetupFacts } from '../src/org-setup.ts';

const fresh: SetupFacts = {
  company: false, locations: false, structure: false, shifts_changed: false, leave_changed: false, holidays: false,
  employees: 0, signed_in: 0, managers: false, members: 1, hr_team: false, salaries: false, bank: false, marks: {},
};

describe('evaluateSetup', () => {
  it('starts a new company at 0% with the required steps first', () => {
    const p = evaluateSetup(fresh, new Set());
    expect(p).toMatchObject({ done: 0, total: SETUP_STEPS.length, percent: 0 });
    expect(p.requiredLeft).toBe(SETUP_STEPS.filter((s) => s.required).length);
    expect(p.next.map((s) => s.key).slice(0, 3)).toEqual(['company', 'locations', 'structure']);
    expect(p.next.at(-1)!.required).toBe(false);
  });

  it('counts what the data shows, defaults someone confirmed, and optional steps marked not needed', () => {
    const p = evaluateSetup({
      ...fresh, company: true, shifts_changed: true, employees: 12, signed_in: 3, members: 4,
      marks: { work_week: 'done', bank: 'skipped', salaries: 'skipped' },
    }, new Set());
    const status = Object.fromEntries(p.steps.map((s) => [s.key, s.status]));
    expect(status).toMatchObject({ company: 'done', attendance: 'done', work_week: 'done', employees: 'done', invite: 'done', bank: 'skipped', salaries: 'todo', leave: 'todo' });
    expect(p.steps.find((s) => s.key === 'attendance')!.byData).toBe(true);
    expect(p.steps.find((s) => s.key === 'work_week')!.byData).toBe(false);
    expect(p.steps.find((s) => s.key === 'invite')!.detail).toBe('3 of 12 employees can sign in');
    expect(p.done).toBe(6);
    expect(p.percent).toBe(Math.floor((6 / 15) * 100));
  });

  it('leaves out the steps of switched-off modules, and reaches 100% only when everything is done', () => {
    const p = evaluateSetup(fresh, new Set(['payroll', 'attendance', 'onboarding']));
    expect(p.steps.some((s) => ['salaries', 'statutory', 'bank', 'attendance', 'work_week'].includes(s.key))).toBe(false);
    expect(p.steps.find((s) => s.key === 'invite')!.href).toBe('members');
    const marks = Object.fromEntries(SETUP_STEPS.map((s) => [s.key, 'done' as const]));
    expect(evaluateSetup({ ...fresh, marks: { ...marks, holidays: 'skipped' } }, new Set()).percent).toBe(93);
    expect(evaluateSetup({ ...fresh, marks }, new Set()).percent).toBe(100);
  });
});
