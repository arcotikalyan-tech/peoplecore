import { describe, expect, it } from 'vitest';
import { hasEveryWord, searchPatterns } from '../src/pagination.ts';

describe('people search', () => {
  it('makes one pattern per word, whatever the spacing and case', () => {
    expect(searchPatterns('Dev  Nair ')).toEqual(['%dev%', '%nair%']);
    expect(searchPatterns('   ')).toEqual([]);
  });

  it('matches wildcards literally', () => {
    expect(searchPatterns('100%_a')).toEqual(['%100\\%\\_a%']);
  });

  it('finds a full name with or without a middle name, in any order', () => {
    expect(hasEveryWord('Dev Nair EMP001', 'dev nair')).toBe(true);
    expect(hasEveryWord('Dev Kumar Nair EMP001', 'dev nair')).toBe(true);
    expect(hasEveryWord('Dev Nair EMP001', 'NAIR  dev')).toBe(true);
    expect(hasEveryWord('Dev Nair EMP001', 'dev reddy')).toBe(false);
  });

  it('an empty search keeps everything', () => {
    expect(hasEveryWord('Dev Nair', '')).toBe(true);
  });
});
