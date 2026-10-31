import { describe, expect, it } from 'vitest';
import { screenFor } from '../src/lib/push-links';

describe('tapping a notification', () => {
  it('opens the phone’s own screen for that part of the app, else the Inbox', () => {
    expect(screenFor('/leave')).toBe('/(app)/(tabs)/leave');
    expect(screenFor('/leave/requests?status=pending')).toBe('/(app)/(tabs)/leave');
    expect(screenFor('/payslips')).toBe('/(app)/payslips');
    expect(screenFor('/attendance?tab=requests')).toBe('/(app)/(tabs)/attendance');
    expect(screenFor('/engagement')).toBe('/(app)/announcements');
    expect(screenFor('/inbox')).toBe('/(app)/(tabs)/inbox');
    expect(screenFor('/helpdesk/42')).toBe('/(app)/(tabs)/inbox');
    expect(screenFor('/payroll/runs/1')).toBe('/(app)/(tabs)/inbox'); // payroll admin pages aren't on the phone
    expect(screenFor('')).toBe('/(app)/(tabs)/inbox');
    expect(screenFor(undefined)).toBe('/(app)/(tabs)/inbox');
  });
});
