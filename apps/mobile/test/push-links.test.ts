import { describe, expect, it } from 'vitest';
import { screenFor } from '../src/lib/push-links';

describe('tapping a notification', () => {
  it('opens the phone’s own screen for that part of the app, else the Inbox', () => {
    expect(screenFor('/leave')).toBe('/(app)/leave');
    expect(screenFor('/leave/requests?status=pending')).toBe('/(app)/leave');
    expect(screenFor('/payslips')).toBe('/(app)/payslips');
    expect(screenFor('/attendance?tab=requests')).toBe('/(app)');
    expect(screenFor('/inbox')).toBe('/(app)/inbox');
    expect(screenFor('/helpdesk/42')).toBe('/(app)/inbox');
    expect(screenFor('/payroll/runs/1')).toBe('/(app)/inbox'); // payroll admin pages aren't on the phone
    expect(screenFor('')).toBe('/(app)/inbox');
    expect(screenFor(undefined)).toBe('/(app)/inbox');
  });
});
