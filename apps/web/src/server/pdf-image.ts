import { deflateSync, inflateSync } from 'node:zlib';
import type { PdfImage } from '@peoplecore/payroll';

/**
 * A JPEG or PNG (the formats logos are stored in) made ready for a PDF, without an image library: a JPEG goes in as
 * it is; a PNG is decoded, shrunk to at most 480 × 160 pixels (three times its largest size on a payslip) and stored
 * as compressed samples with its transparency. Null for anything else, or a damaged file: the payslip then has no logo.
 */
const MAX = { width: 480, height: 160 };
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function pdfImage(bytes: Uint8Array): PdfImage | null {
  try {
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return jpeg(bytes);
    if (PNG_SIGNATURE.every((b, i) => bytes[i] === b)) return png(bytes);
  } catch {
    // damaged: no logo
  }
  return null;
}

/** Reads the frame header for the size and colours; the bytes themselves are what the PDF shows. */
function jpeg(b: Uint8Array): PdfImage | null {
  let adobe = false;
  for (let i = 2; i + 4 <= b.length;) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1]!;
    if (marker === 0xff) { i++; continue; }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) { i += 2; continue; }
    const length = (b[i + 2]! << 8) | b[i + 3]!;
    if (marker === 0xee && String.fromCharCode(...b.subarray(i + 4, i + 9)) === 'Adobe') adobe = true;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const [precision, height, width, components] = [b[i + 4]!, (b[i + 5]! << 8) | b[i + 6]!, (b[i + 7]! << 8) | b[i + 8]!, b[i + 9]!];
      const colorSpace = components === 1 ? 'DeviceGray' : components === 3 ? 'DeviceRGB' : components === 4 ? 'DeviceCMYK' : null;
      if (precision !== 8 || !colorSpace || !width || !height) return null;
      return { width, height, colorSpace, filter: 'DCTDecode', data: b, invert: components === 4 && adobe };
    }
    i += 2 + length;
  }
  return null;
}

const paeth = (a: number, b: number, c: number) => {
  const p = a + b - c;
  const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

function png(b: Uint8Array): PdfImage | null {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let [width, height, depth, type, interlace] = [0, 0, 0, 0, 0];
  let palette: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  for (let i = 8; i + 8 <= b.length;) {
    const length = view.getUint32(i);
    const kind = String.fromCharCode(...b.subarray(i + 4, i + 8));
    const data = b.subarray(i + 8, i + 8 + length);
    if (kind === 'IHDR') [width, height, depth, type, interlace] = [view.getUint32(i + 8), view.getUint32(i + 12), b[i + 16]!, b[i + 17]!, b[i + 20]!];
    else if (kind === 'PLTE') palette = data;
    else if (kind === 'tRNS') trns = data;
    else if (kind === 'IDAT') idat.push(data);
    else if (kind === 'IEND') break;
    i += 12 + length;
  }
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[type];
  if (!channels || interlace !== 0 || !width || !height || width * height > 25_000_000) return null;
  if (!(type === 0 || type === 3 ? [1, 2, 4, 8, 16].includes(depth) && !(type === 3 && depth === 16) : [8, 16].includes(depth))) return null;
  if (type === 3 && !palette) return null;

  // Undo the per-line filters.
  const raw = inflateSync(Buffer.concat(idat));
  const stride = Math.ceil((width * channels * depth) / 8);
  const bpp = Math.max(1, (channels * depth) / 8);
  if (raw.length < height * (stride + 1)) return null;
  const px = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    if (filter > 4) return null;
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = px.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? px.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const [a, up, c] = [x >= bpp ? out[x - bpp]! : 0, prev ? prev[x]! : 0, prev && x >= bpp ? prev[x - bpp]! : 0];
      const add = filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? up : filter === 3 ? (a + up) >> 1 : paeth(a, up, c);
      out[x] = (line[x]! + add) & 0xff;
    }
  }

  // Each pixel as 8-bit colour and alpha.
  const sample = (y: number, n: number) => {
    const row = y * stride;
    if (depth === 16) return (px[row + n * 2]! << 8) | px[row + n * 2 + 1]!;
    if (depth === 8) return px[row + n]!;
    const bit = n * depth;
    return (px[row + (bit >> 3)]! >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
  };
  const to8 = (v: number) => (depth === 16 ? v >> 8 : depth < 8 ? Math.round((v * 255) / ((1 << depth) - 1)) : v);
  const key = (n: number) => (trns && trns.length >= n * 2 + 2 ? (trns[n * 2]! << 8) | trns[n * 2 + 1]! : -1);
  const gray = type === 0 || type === 4;
  const color = new Uint8Array(width * height * (gray ? 1 : 3));
  const alpha = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      const s = (k: number) => sample(y, x * channels + k);
      let a = 255;
      if (type === 0) {
        color[p] = to8(s(0));
        if (s(0) === key(0)) a = 0;
      } else if (type === 2) {
        for (let k = 0; k < 3; k++) color[p * 3 + k] = to8(s(k));
        if (s(0) === key(0) && s(1) === key(1) && s(2) === key(2)) a = 0;
      } else if (type === 3) {
        const i = s(0);
        for (let k = 0; k < 3; k++) color[p * 3 + k] = palette![i * 3 + k] ?? 0;
        if (trns && i < trns.length) a = trns[i]!;
      } else if (type === 4) {
        color[p] = to8(s(0));
        a = to8(s(1));
      } else {
        for (let k = 0; k < 3; k++) color[p * 3 + k] = to8(s(k));
        a = to8(s(3));
      }
      alpha[p] = a;
    }
  }
  return shrink({ width, height, gray, color, alpha });
}

/** Averages boxes of pixels down to the size limit (colour weighted by alpha, so edges don't darken). */
function shrink(img: { width: number; height: number; gray: boolean; color: Uint8Array; alpha: Uint8Array }): PdfImage {
  const n = img.gray ? 1 : 3;
  const f = Math.max(1, img.width / MAX.width, img.height / MAX.height);
  const [w, h] = [Math.max(1, Math.round(img.width / f)), Math.max(1, Math.round(img.height / f))];
  const color = f === 1 ? img.color : new Uint8Array(w * h * n);
  const alpha = f === 1 ? img.alpha : new Uint8Array(w * h);
  if (f > 1) {
    for (let y = 0; y < h; y++) {
      const [y0, y1] = [Math.floor((y * img.height) / h), Math.max(Math.floor(((y + 1) * img.height) / h), Math.floor((y * img.height) / h) + 1)];
      for (let x = 0; x < w; x++) {
        const [x0, x1] = [Math.floor((x * img.width) / w), Math.max(Math.floor(((x + 1) * img.width) / w), Math.floor((x * img.width) / w) + 1)];
        const sums = new Array<number>(n).fill(0);
        let [weight, count] = [0, 0];
        for (let sy = y0; sy < y1; sy++) {
          for (let sx = x0; sx < x1; sx++) {
            const p = sy * img.width + sx;
            const a = img.alpha[p]!;
            for (let k = 0; k < n; k++) sums[k]! += img.color[p * n + k]! * a;
            weight += a;
            count++;
          }
        }
        const q = y * w + x;
        for (let k = 0; k < n; k++) color[q * n + k] = weight ? Math.round(sums[k]! / weight) : 255;
        alpha[q] = Math.round(weight / count);
      }
    }
  }
  const opaque = alpha.every((a) => a === 255);
  return {
    width: w, height: h, colorSpace: img.gray ? 'DeviceGray' : 'DeviceRGB', filter: 'FlateDecode',
    data: deflateSync(color), ...(opaque ? {} : { alpha: deflateSync(alpha) }),
  };
}
