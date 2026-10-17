import { describe, expect, it } from 'vitest';
import { changeAssignmentSchema, createEmployeeSchema } from '@peoplecore/shared';
import { toChangeAssignmentArgs, toCreateEmployeeArgs } from './employee-args';

const ORG = '00000000-0000-4000-8000-000000000001';
const DEPT = '00000000-0000-4000-8000-000000000002';

describe('toCreateEmployeeArgs', () => {
  it('maps form fields to RPC arguments and drops empty optionals (so JSON omits them)', () => {
    const input = createEmployeeSchema.parse({
      firstName: 'Asha', lastName: '', employmentType: 'intern', dateOfJoining: '2026-11-01', departmentId: DEPT, workEmail: '',
    });
    const args = JSON.parse(JSON.stringify(toCreateEmployeeArgs(ORG, input)));
    expect(args).toEqual({
      p_organization_id: ORG, p_first_name: 'Asha', p_employment_type: 'intern', p_date_of_joining: '2026-11-01', p_department_id: DEPT,
    });
  });
});

describe('toChangeAssignmentArgs', () => {
  it('only sends the fields that were provided', () => {
    const input = changeAssignmentSchema.parse({ employeeId: DEPT, effectiveFrom: '2026-12-01', changeReason: 'promotion', notes: ' ' });
    expect(JSON.parse(JSON.stringify(toChangeAssignmentArgs(input)))).toEqual({
      p_employee_id: DEPT, p_effective_from: '2026-12-01', p_change_reason: 'promotion',
    });
  });
});
