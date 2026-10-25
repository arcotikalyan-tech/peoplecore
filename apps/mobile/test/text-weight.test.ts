import { describe, expect, it } from 'vitest';
import { baseWeight, drawnWeight, plainSpaces } from '../src/lib/text-weight';

describe('text weight', () => {
  it('reads numbers, numeric strings and names, and nothing when unset', () => {
    expect(baseWeight(600)).toBe(600);
    expect(baseWeight('700')).toBe(700);
    expect(baseWeight('bold')).toBe(700);
    expect(baseWeight('normal')).toBe(400);
    expect(baseWeight(undefined)).toBeNull();
    expect(baseWeight('condensed')).toBeNull();
  });

  it('adds Android’s Bold text adjustment and stays within 100–900', () => {
    expect(drawnWeight(400, 0)).toBe('400');
    expect(drawnWeight(400, 300)).toBe('700');
    expect(drawnWeight(700, 300)).toBe('900');
    expect(drawnWeight(100, -300)).toBe('100');
    expect(drawnWeight(450, 0)).toBe('500');
  });

  it('swaps Android’s narrow space in times for a normal no-break space', () => {
    expect(plainSpaces('12:42\u202fam')).toBe('12:42\u00a0am');
    expect(plainSpaces('25 Oct, 9:05 pm')).toBe('25 Oct, 9:05 pm');
  });
});
