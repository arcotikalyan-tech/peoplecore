import { crc32, deflateSync, inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { pdfImage } from './pdf-image';

/** A PNG from rows of samples, each row stored with the given filter (0–4), so the reader's unfiltering is tested. */
function png(o: { width: number; height: number; type: number; depth?: number; rows: number[][]; filters?: number[]; plte?: number[]; trns?: number[]; interlace?: number }) {
  const depth = o.depth ?? 8;
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[o.type]!;
  const bpp = Math.max(1, (channels * depth) / 8);
  const paeth = (a: number, b: number, c: number) => {
    const p = a + b - c;
    const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  const lines: number[] = [];
  o.rows.forEach((row, y) => {
    const f = o.filters?.[y] ?? 0;
    const prev = y > 0 ? o.rows[y - 1]! : null;
    lines.push(f, ...row.map((v, x) => {
      const [a, up, c] = [x >= bpp ? row[x - bpp]! : 0, prev ? prev[x]! : 0, prev && x >= bpp ? prev[x - bpp]! : 0];
      const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? up : f === 3 ? (a + up) >> 1 : paeth(a, up, c);
      return (v - pred) & 0xff;
    }));
  });
  const chunk = (kind: string, data: Uint8Array) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(kind, 4, 'latin1');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(o.width, 0);
  ihdr.writeUInt32BE(o.height, 4);
  ihdr.set([depth, o.type, 0, 0, o.interlace ?? 0], 8);
  return new Uint8Array(Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr),
    ...(o.plte ? [chunk('PLTE', Uint8Array.from(o.plte))] : []), ...(o.trns ? [chunk('tRNS', Uint8Array.from(o.trns))] : []),
    chunk('IDAT', deflateSync(Uint8Array.from(lines))), chunk('IEND', new Uint8Array()),
  ]));
}
const samples = (data: Uint8Array) => [...inflateSync(data)];

describe('logo images for PDFs', () => {
  it('decodes an RGBA PNG through every line filter, with its transparency', () => {
    const rows = [[255, 0, 0, 255, 0, 255, 0, 128], [0, 0, 255, 0, 10, 20, 30, 255], [1, 2, 3, 4, 5, 6, 7, 8], [9, 9, 9, 9, 200, 100, 50, 25], [0, 0, 0, 255, 255, 255, 255, 255]];
    const img = pdfImage(png({ width: 2, height: 5, type: 6, rows, filters: [0, 1, 2, 3, 4] }))!;
    expect(img).toMatchObject({ width: 2, height: 5, colorSpace: 'DeviceRGB', filter: 'FlateDecode' });
    expect(samples(img.data)).toEqual(rows.flatMap((r) => [r[0], r[1], r[2], r[4], r[5], r[6]]));
    expect(samples(img.alpha!)).toEqual(rows.flatMap((r) => [r[3], r[7]]));
  });

  it('leaves out the transparency when every pixel is opaque', () => {
    const img = pdfImage(png({ width: 2, height: 1, type: 2, rows: [[1, 2, 3, 4, 5, 6]] }))!;
    expect(samples(img.data)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(img.alpha).toBeUndefined();
  });

  it('reads palettes of 4 bits with a transparent entry, and 16-bit gray with alpha', () => {
    // Pixels 0, 1, 2 (two per byte; the last nibble is padding). Entry 1 is transparent.
    const pal = pdfImage(png({ width: 3, height: 1, type: 3, depth: 4, rows: [[0x01, 0x20]], plte: [10, 20, 30, 40, 50, 60, 70, 80, 90], trns: [255, 0] }))!;
    expect(samples(pal.data)).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90]);
    expect(samples(pal.alpha!)).toEqual([255, 0, 255]);
    const ga = pdfImage(png({ width: 1, height: 1, type: 4, depth: 16, rows: [[0xab, 0xcd, 0x80, 0x00]] }))!;
    expect(ga.colorSpace).toBe('DeviceGray');
    expect([samples(ga.data), samples(ga.alpha!)]).toEqual([[0xab], [0x80]]);
  });

  it('shrinks a large logo to fit 480 × 160, averaging colour by alpha so edges stay clean', () => {
    const width = 960;
    const rows = Array.from({ length: 2 }, () => Array.from({ length: width }, (_, x) => (x % 2 ? [0, 0, 0, 0] : [200, 100, 50, 255])).flat());
    const img = pdfImage(png({ width, height: 2, type: 6, rows }))!;
    expect([img.width, img.height]).toEqual([480, 1]);
    // Each output pixel averages one opaque and one transparent pixel: the colour of the opaque one, half alpha.
    expect(samples(img.data).slice(0, 3)).toEqual([200, 100, 50]);
    expect(samples(img.alpha!).slice(0, 2)).toEqual([128, 128]);
  });

  it('takes a JPEG as it is, with its size and colours from the frame header', () => {
    const sof = (components: number) => [0xff, 0xc0, 0, 8 + components * 3, 8, 0x01, 0x2c, 0x02, 0x58, components, ...Array(components * 3).fill(1)];
    const jpg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, ...sof(3), 0xff, 0xd9]);
    expect(pdfImage(jpg)).toEqual({ width: 600, height: 300, colorSpace: 'DeviceRGB', filter: 'DCTDecode', data: jpg, invert: false });
    const adobe = Uint8Array.from([0xff, 0xd8, 0xff, 0xee, 0, 7, 0x41, 0x64, 0x6f, 0x62, 0x65, ...sof(4), 0xff, 0xd9]);
    expect(pdfImage(adobe)).toMatchObject({ colorSpace: 'DeviceCMYK', invert: true });
  });

  it('gives no image for anything else or a damaged file', () => {
    expect(pdfImage(new TextEncoder().encode('<svg/>'))).toBeNull();
    expect(pdfImage(png({ width: 1, height: 1, type: 2, rows: [[1, 2, 3]], interlace: 1 }))).toBeNull();
    const broken = png({ width: 4, height: 4, type: 2, rows: [[1, 2, 3]] }); // fewer lines than the header says
    expect(pdfImage(broken)).toBeNull();
    expect(pdfImage(Uint8Array.from([0xff, 0xd8, 0x00]))).toBeNull();
  });
});
