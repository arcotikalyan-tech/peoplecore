import { describe, expect, it } from 'vitest';
import { passwordErrorMessage, passwordProblem } from '../src/password.ts';

describe('passwordProblem', () => {
  it('asks for length, letters and a number, within 72 bytes', () => {
    expect(passwordProblem('short1')).toBe('Use at least 8 characters.');
    expect(passwordProblem('onlyletters')).toBe('Use letters and at least one number.');
    expect(passwordProblem('12345678')).toBe('Use letters and at least one number.');
    expect(passwordProblem('a'.repeat(80) + '1')).toBe('Use at most 72 characters.');
    expect(passwordProblem('Sunrise2026')).toBeNull();
    expect(passwordProblem('सूर्योदय2026')).toBeNull(); // letters in any script
  });
  it('explains Supabase’s refusals', () => {
    expect(passwordErrorMessage('same_password', undefined)).toBe('That’s your current password. Choose a new one.');
    expect(passwordErrorMessage('weak_password', 'Password is known to be weak')).toBe('Choose a stronger password: Password is known to be weak');
    expect(passwordErrorMessage(undefined, undefined)).toBe('The password couldn’t be saved. Try again.');
  });
});
