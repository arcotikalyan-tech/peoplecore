import { describe, expect, it } from 'vitest';
import { decisionMessage, decisionProblem, refusalMessage } from '../src/lib/decisions';

describe('decisions on the phone', () => {
  it('need a reason to reject, and say what happened', () => {
    expect(decisionProblem('reject', '  ')).toBe('Give a reason when rejecting.');
    expect(decisionProblem('approve', '')).toBeNull();
    expect(decisionMessage('pending')).toBe('Approved. It moves to the next approver.');
    expect(decisionMessage('rejected')).toBe('Rejected.');
    expect(refusalMessage({ code: '42501' })).toMatch(/can’t decide/);
    expect(refusalMessage({ code: '22023', message: 'This request was withdrawn.' })).toBe('This request was withdrawn.');
  });
});
