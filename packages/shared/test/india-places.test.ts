import { describe, expect, it } from 'vitest';
import { INDIA_STATES, STATES, citiesOf, findState, stateName } from '../src/index.ts';

describe('India places', () => {
  it('lists every state and UT once, by name', () => {
    expect(INDIA_STATES).toHaveLength(Object.keys(STATES).length);
    expect(INDIA_STATES.map((s) => s.name)).toEqual([...INDIA_STATES.map((s) => s.name)].sort((a, b) => a.localeCompare(b)));
  });

  it('gives every state its cities, A to Z without repeats', () => {
    for (const { code } of INDIA_STATES) {
      const cities = citiesOf(code);
      expect(cities.length, code).toBeGreaterThan(0);
      expect(new Set(cities).size, code).toBe(cities.length);
      expect(cities, code).toEqual([...cities].sort((a, b) => a.localeCompare(b)));
      for (const c of cities) expect(c, code).toMatch(/^\S.{0,98}\S$/);
    }
    expect(citiesOf('KA')).toContain('Bengaluru');
  });

  it('finds a state from its code or name, whatever the case', () => {
    expect(findState('ka')).toBe('KA');
    expect(findState(' Karnataka ')).toBe('KA');
    expect(findState('tamil nadu')).toBe('TN');
    expect(findState('Atlantis')).toBeNull();
    expect(findState('')).toBeNull();
    expect(findState(null)).toBeNull();
  });

  it('names a state from its code and leaves anything else alone', () => {
    expect(stateName('TS')).toBe('Telangana');
    expect(stateName('Karnataka')).toBe('Karnataka');
    expect(stateName('constructor')).toBe('constructor');
    expect(stateName(null)).toBeNull();
  });
});
