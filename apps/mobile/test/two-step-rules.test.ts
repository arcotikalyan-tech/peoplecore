import { describe, expect, it } from 'vitest';
import { codeNeeded, groupKey } from '../src/lib/two-step-rules';

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
