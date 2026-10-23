import { describe, expect, it } from 'vitest';
import { AttemptLimiter, minutesText } from './attempt-limiter';

describe('attempt limiter', () => {
  it('lets a key fail up to the limit, then makes it wait until the oldest failure leaves the window', () => {
    let now = 0;
    const limiter = new AttemptLimiter(3, 10 * 60_000, () => now);
    for (const t of [0, 60_000, 120_000]) {
      expect(limiter.waitFor('a')).toBe(0);
      now = t;
      limiter.fail('a');
    }
    expect(limiter.waitFor('a')).toBe(8 * 60_000); // the first failure (at 0) leaves at 10 minutes
    expect(limiter.waitFor('b')).toBe(0);           // other keys are untouched
    now = 10 * 60_000 + 1;
    expect(limiter.waitFor('a')).toBe(0);
    limiter.fail('a');                              // three in the window again: 1, 2 and now 10 minutes
    expect(limiter.waitFor('a')).toBe(60_000 + 10 * 60_000 - now);
  });

  it('starts over after a success clears the key', () => {
    const limiter = new AttemptLimiter(2, 60_000, () => 0);
    limiter.fail('a');
    limiter.fail('a');
    expect(limiter.waitFor('a')).toBeGreaterThan(0);
    limiter.clear('a');
    expect(limiter.waitFor('a')).toBe(0);
  });

  it('forgets old keys when it holds many', () => {
    let now = 0;
    const limiter = new AttemptLimiter(1, 1000, () => now);
    for (let i = 0; i <= 10_000; i++) limiter.fail(`k${i}`);
    now = 5000;
    limiter.fail('fresh'); // over 10,000 keys: the expired ones are swept
    expect((limiter as unknown as { failures: Map<string, number[]> }).failures.size).toBe(1);
  });

  it('says the wait in whole minutes, rounded up', () => {
    expect(minutesText(1)).toBe('1 minute');
    expect(minutesText(60_000)).toBe('1 minute');
    expect(minutesText(60_001)).toBe('2 minutes');
    expect(minutesText(14 * 60_000)).toBe('14 minutes');
  });
});
