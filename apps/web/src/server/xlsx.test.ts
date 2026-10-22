import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { readXlsx, XlsxError } from './xlsx';

/** A minimal .xlsx: the parts given, deflated (or stored), in a ZIP with a central directory. */
function zip(parts: Record<string, string>, store = false): Uint8Array {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(parts)) {
    const raw = enc.encode(text);
    const data = store ? raw : new Uint8Array(deflateRawSync(raw));
    const n = enc.encode(name);
    const local = new Uint8Array(30 + n.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(8, store ? 0 : 8, true);
    lv.setUint32(18, data.length, true); lv.setUint32(22, raw.length, true); lv.setUint16(26, n.length, true);
    local.set(n, 30);
    const head = new Uint8Array(46 + n.length);
    const hv = new DataView(head.buffer);
    hv.setUint32(0, 0x02014b50, true); hv.setUint16(10, store ? 0 : 8, true);
    hv.setUint32(20, data.length, true); hv.setUint32(24, raw.length, true); hv.setUint16(28, n.length, true); hv.setUint32(42, offset, true);
    head.set(n, 46);
    locals.push(local, data);
    central.push(head);
    offset += local.length + data.length;
  }
  const size = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, central.length, true); ev.setUint16(10, central.length, true);
  ev.setUint32(12, size, true); ev.setUint32(16, offset, true);
  const all = [...locals, ...central, end];
  const out = new Uint8Array(all.reduce((s, a) => s + a.length, 0));
  let p = 0;
  for (const a of all) { out.set(a, p); p += a.length; }
  return out;
}

const workbook = (sheets: string) => `<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets}</sheets></workbook>`;
const rels = '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="x"/><Relationship Id="rId2" Target="worksheets/sheet2.xml" Type="x"/></Relationships>';

describe('readXlsx', () => {
  it('reads shared and inline strings, numbers and booleans from the first sheet, leaving out blank rows', () => {
    const file = zip({
      'xl/workbook.xml': workbook('<sheet name="Employees" sheetId="2" r:id="rId2"/><sheet name="Notes" sheetId="1" r:id="rId1"/>'),
      'xl/_rels/workbook.xml.rels': rels,
      'xl/sharedStrings.xml': '<sst><si><t>Employee No</t></si><si><r><t>Na</t></r><r><t>me</t></r></si><si><t>DOJ</t></si><si><t>Asha &amp; co</t><rPh><t>x</t></rPh></si></sst>',
      'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Wrong sheet</t></is></c></row></sheetData></worksheet>',
      'xl/worksheets/sheet2.xml': `<worksheet><sheetData>
        <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="E1" t="b"><v>1</v></c></row>
        <row r="2"><c r="A2" t="inlineStr"><is><t>G-101</t></is></c><c r="B2" t="s"><v>3</v></c><c r="C2"><v>46027</v></c></row>
        <row r="3"><c r="A3"/></row>
        <row r="4"><c r="A4" t="str"><f>CONCAT("G-","102")</f><v>G-102</v></c><c r="C4"><v>46030</v></c></row>
      </sheetData></worksheet>`,
    });
    expect(readXlsx(file)).toEqual([
      ['Employee No', 'Name', 'DOJ', '', 'TRUE'],
      ['G-101', 'Asha & co', '46027'],
      ['G-102', '', '46030'],
    ]);
  });

  it('reads stored (uncompressed) parts and refuses files that aren’t workbooks or are too long', () => {
    const file = zip({
      'xl/workbook.xml': workbook('<sheet name="S" sheetId="1" r:id="rId1"/>'), 'xl/_rels/workbook.xml.rels': rels,
      'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Only</t></is></c></row><row r="5"><c r="B5"><v>3</v></c></row></sheetData></worksheet>',
    }, true);
    expect(readXlsx(file)).toEqual([['Only'], ['', '3']]);
    expect(() => readXlsx(file, { rows: 3, columns: 60 })).toThrow(XlsxError);
    expect(() => readXlsx(new TextEncoder().encode('Employee code,First name\nA,B\n'))).toThrow('This isn’t an Excel workbook');
  });
});
