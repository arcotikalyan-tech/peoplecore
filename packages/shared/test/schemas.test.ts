import { describe, expect, it } from 'vitest';
import { createEmployeeSchema, createOrganizationSchema, employeeListQuerySchema, fieldErrors } from '../src/index.ts';

const base = { firstName: ' Asha ', employmentType: 'permanent', dateOfJoining: '2026-01-05' };

describe('createEmployeeSchema', () => {
  it('trims text and turns empty optional fields into undefined', () => {
    const r = createEmployeeSchema.parse({ ...base, lastName: '  ', workEmail: '', departmentId: '', employeeCode: '' });
    expect(r.firstName).toBe('Asha');
    expect(r.lastName).toBeUndefined();
    expect(r.workEmail).toBeUndefined();
    expect(r.departmentId).toBeUndefined();
    expect(r.employeeCode).toBeUndefined();
  });

  it('normalises email case and phone formatting', () => {
    const r = createEmployeeSchema.parse({ ...base, workEmail: 'Asha@Example.TEST', workPhone: '+91 98765-43210' });
    expect(r.workEmail).toBe('asha@example.test');
    expect(r.workPhone).toBe('+919876543210');
  });

  it('rejects probation ending before joining, reported on the right field', () => {
    const r = createEmployeeSchema.safeParse({ ...base, probationEndDate: '2025-12-31' });
    expect(r.success).toBe(false);
    if (!r.success) expect(fieldErrors(r.error)).toHaveProperty('probationEndDate');
  });

  it('rejects impossible dates, unknown employment types and bad codes', () => {
    expect(createEmployeeSchema.safeParse({ ...base, dateOfJoining: '2026-02-30' }).success).toBe(false);
    expect(createEmployeeSchema.safeParse({ ...base, employmentType: 'freelance' }).success).toBe(false);
    expect(createEmployeeSchema.safeParse({ ...base, employeeCode: 'has space' }).success).toBe(false);
  });
});

describe('employeeListQuerySchema', () => {
  it('falls back to safe defaults for garbage query params', () => {
    expect(employeeListQuerySchema.parse({ page: '-3', status: 'fired', department: 'x' })).toEqual({
      page: 1, q: undefined, status: undefined, department: undefined,
    });
  });
});

describe('createOrganizationSchema', () => {
  it('rejects reserved and malformed slugs', () => {
    expect(createOrganizationSchema.safeParse({ name: 'Acme', slug: 'platform' }).success).toBe(false);
    expect(createOrganizationSchema.safeParse({ name: 'Acme', slug: '-acme' }).success).toBe(false);
    expect(createOrganizationSchema.parse({ name: 'Acme', slug: 'Acme-India' }).slug).toBe('acme-india');
  });
});
