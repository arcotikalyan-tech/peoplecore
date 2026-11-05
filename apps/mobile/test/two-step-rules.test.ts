import { describe, expect, it } from 'vitest';
import { codeNeeded, groupKey, signInProblem } from '../src/lib/two-step-rules';

describe('two-step on the phone', () => {
  it('asks for a code only where it is switched on or the person uses it, and not twice', () => {
    expect(codeNeeded({ currentLevel: 'aal1', required: false, hasAuthenticator: false })).toBe(false);
    expect(codeNeeded({ currentLevel: 'aal1', required: true, hasAuthenticator: false })).toBe(true);
    expect(codeNeeded({ currentLevel: 'aal1', required: false, hasAuthenticator: true })).toBe(true);
    expect(codeNeeded({ currentLevel: 'aal2', required: true, hasAuthenticator: true })).toBe(false);
  });

  it('groups a setup key in fours', () => {
    expect(groupKey('ABCDEFGHIJ')).toBe('ABCD EFGH IJ');
  });
});

describe('when signing in fails', () => {
  it('says so only when the password was really refused', () => {
    expect(signInProblem(null)).toBeNull();
    expect(signInProblem({ name: 'AuthApiError' })).toBe('That email and password don’t match.');
    expect(signInProblem({ name: 'AuthRetryableFetchError' })).toBe('Couldn’t reach PeopleCore. Check your connection and try again.');
  });
});
