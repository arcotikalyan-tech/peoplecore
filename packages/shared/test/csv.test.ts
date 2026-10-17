import { describe, expect, it } from 'vitest';
import { csvCell, toCsv } from '../src/index.ts';

describe('csvCell', () => {
  it('quotes commas, quotes and line breaks', () => {
    expect(csvCell('Rao, Asha')).toBe('"Rao, Asha"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(42)).toBe('42');
  });

  it('neutralises formulas in text cells', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell('+91 98450 12345')).toBe("'+91 98450 12345");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('-5')).toBe("'-5");
    expect(csvCell(-5)).toBe('-5'); // real numbers are left alone
  });
});

describe('toCsv', () => {
  it('writes a BOM, a header and CRLF lines', () => {
    expect(toCsv(['a', 'b'], [['1', null], ['Ś', 'x,y']])).toBe('\uFEFFa,b\r\n1,\r\nŚ,"x,y"\r\n');
  });
});
