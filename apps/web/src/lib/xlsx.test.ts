import { crc32, inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { columnName, toXlsx } from './xlsx';

/** Reads the archive back through its central directory, checking every entry's CRC. */
function unzip(bytes: Uint8Array): Map<string, string> {
  const buf = Buffer.from(bytes);
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const out = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(p)).toBe(0x02014b50);
    const crc = buf.readUInt32LE(p + 16);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    expect(buf.readUInt32LE(local)).toBe(0x04034b50);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = inflateRawSync(buf.subarray(start, start + size));
    expect(crc32(data)).toBe(crc);
    out.set(name, data.toString('utf8'));
    p += 46 + nameLen;
  }
  return out;
}

describe('xlsx', () => {
  it('names columns like Excel', () => {
    expect([0, 25, 26, 27, 51, 52, 701, 702].map(columnName)).toEqual(['A', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA']);
  });

  it('writes a workbook Excel can open: parts, sheets, bold frozen header, numbers as numbers, text never a formula', () => {
    const file = toXlsx([
      { name: 'Net pay', columns: ['Employee', 'Net'], rows: [['Asha <A&B>', 1234.5], ['=HYPERLINK("x")', 1000], ['Bell\u0007', null]] },
      { name: 'Summary: all/teams', columns: ['Count'], rows: [[2]] },
    ]);
    const parts = unzip(file);
    expect([...parts.keys()]).toEqual(['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml',
      'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']);
    expect(parts.get('xl/workbook.xml')).toContain('<sheet name="Net pay" sheetId="1" r:id="rId1"/>');
    expect(parts.get('xl/workbook.xml')).toContain('<sheet name="Summary  all teams" sheetId="2"');
    const s1 = parts.get('xl/worksheets/sheet1.xml')!;
    expect(s1).toContain('<c r="A1" t="inlineStr" s="1"><is><t xml:space="preserve">Employee</t></is></c>');
    expect(s1).toContain('<c r="A2" t="inlineStr"><is><t xml:space="preserve">Asha &lt;A&amp;B&gt;</t></is></c>');
    expect(s1).toContain('<c r="B2" s="2"><v>1234.5</v></c>');
    expect(s1).toContain('<c r="B3"><v>1000</v></c>');
    expect(s1).toContain('=HYPERLINK(&quot;x&quot;)</t>'); // stored as text, not <f>
    expect(s1).not.toContain('<f>');
    expect(s1).toContain('<t xml:space="preserve">Bell</t>'); // control character removed
    expect(s1).toContain('state="frozen"');
  });
});
