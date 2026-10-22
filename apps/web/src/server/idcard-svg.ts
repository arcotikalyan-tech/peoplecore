import { crc32 } from 'node:zlib';
import { cardValue, templateFor, type CardDesign, type CardPerson } from '@/lib/id-cards';
import { formatDate } from '@/lib/format';

/**
 * ID and visiting cards as SVG, for "Export all": vector files at card size (CR80 54 × 86 mm, business card 89 × 51 mm)
 * that print sharply at any resolution and open in any design tool. The layout follows the on-screen card.
 */

export interface SvgCardInput {
  design: CardDesign;
  person: CardPerson;
  company: string;
  website: string | null;
  /** The logo as a data: URI (fetched once for the whole export), or null. */
  logo: string | null;
  /** The QR code as an SVG string (from the qrcode package), or null. */
  qrSvg: string | null;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
/** Shortens text to roughly fit `mm` at a font size of `size` mm (average glyph ≈ 0.55 em). */
const fit = (s: string, mm: number, size: number) => {
  const max = Math.max(4, Math.floor(mm / (size * 0.55)));
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
const text = (x: number, y: number, s: string, size: number, o: { fill?: string; weight?: number; anchor?: 'start' | 'middle' | 'end'; upper?: boolean; opacity?: number } = {}) =>
  `<text x="${x}" y="${y}" font-size="${size}" font-family="Helvetica, Arial, sans-serif" fill="${o.fill ?? 'currentColor'}"${o.weight ? ` font-weight="${o.weight}"` : ''}`
  + `${o.anchor && o.anchor !== 'start' ? ` text-anchor="${o.anchor}"` : ''}${o.opacity !== undefined ? ` fill-opacity="${o.opacity}"` : ''}>${esc(o.upper ? s.toUpperCase() : s)}</text>`;
/** Places the qrcode package's SVG at a position and size. */
const qrAt = (svg: string, x: number, y: number, size: number) => svg.replace(/^<svg\b/, `<svg x="${x}" y="${y}" width="${size}" height="${size}"`);
const doc = (w: number, h: number, color: string, body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}" color="${color}">${body}</svg>\n`;

function idFront(c: SvgCardInput): string {
  const { design: d, person: p } = c;
  const t = templateFor(d.template);
  const land = d.orientation === 'landscape';
  const [W, H] = land ? [86, 54] : [54, 86];
  const parts: string[] = [`<rect width="${W}" height="${H}" rx="3" fill="#ffffff"/>`];
  if (t.tint) parts.push(`<rect width="${W}" height="${H}" rx="3" fill="${d.primary_color}" fill-opacity="0.08"/>`);
  const headH = t.header === 'full' ? (land ? 18 : 30) : t.header === 'band' ? 12 : t.header === 'wave' ? 20 : 0;
  if (t.header === 'band' || t.header === 'full') parts.push(`<rect width="${W}" height="${headH}" fill="${d.primary_color}"/>`);
  if (t.header === 'wave') {
    parts.push(`<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${d.primary_color}"/><stop offset="1" stop-color="${d.accent_color}"/></linearGradient></defs>`,
      `<path d="M0 0H${W}V${headH}Q${W / 2} ${headH + 8} 0 ${headH}Z" fill="url(#g)"/>`);
  }
  if (t.header === 'side') parts.push(`<rect width="6" height="${H}" fill="${d.primary_color}"/>`);
  const onColour = t.header === 'band' || t.header === 'full' || t.header === 'wave';
  const left = t.header === 'side' ? 9 : 4;
  const centred = t.align === 'center' && !land;
  const cx = centred ? W / 2 : left;
  const anchor = centred ? 'middle' : 'start';
  let hx = cx;
  if (d.show_logo && c.logo) {
    parts.push(`<image href="${c.logo}" x="${centred ? W / 2 - 13 : left}" y="2.5" width="5" height="5" preserveAspectRatio="xMidYMid meet"/>`);
    if (!centred) hx = left + 6.5;
  }
  parts.push(text(centred && d.show_logo && c.logo ? W / 2 + 2 : hx, 6.5, fit(c.company, W - 14, 2.4), 2.4, { fill: onColour ? '#ffffff' : d.primary_color, weight: 700, anchor, upper: true }));

  const photo = 18;
  let y = t.header === 'full' && !land ? 16 : headH ? headH + 3 : 11;
  let tx = cx;
  if (d.show_photo) {
    const px = land ? left : centred ? W / 2 - photo / 2 : left;
    const r = t.photo === 'circle' ? photo / 2 : t.photo === 'rounded' ? 2.5 : 0.5;
    parts.push(`<rect x="${px}" y="${y}" width="${photo}" height="${photo}" rx="${r}" fill="${d.accent_color}" stroke="${d.primary_color}" stroke-width="0.6"/>`,
      text(px + photo / 2, y + photo / 2 + 2, initials(p.name), 5.5, { fill: '#ffffff', weight: 700, anchor: 'middle' }));
    if (land) tx = left + photo + 4;
    else y += photo + 5;
  } else y += 4;
  if (land) y += 4;
  const width = land ? W - tx - 4 : W - 8;
  const a = land ? 'start' : anchor;
  parts.push(text(tx, y, fit(p.name, width, 3.2), 3.2, { weight: 700, anchor: a }));
  y += 3.6;
  if (d.fields.includes('designation') && p.designation) {
    parts.push(text(tx, y, fit(p.designation, width, 2.3), 2.3, { fill: d.primary_color, weight: 600, anchor: a }));
    y += 3.6;
  }
  const rows = [
    ...d.fields.filter((k) => k !== 'designation').map((k): [string, string | null] => [k, k === 'date_of_joining' ? formatDate(p.date_of_joining) : cardValue(k, p, c.website)]),
    ...d.custom_fields.map((x): [string, string | null] => [x.label, x.value]),
  ].filter((r): r is [string, string] => !!r[1]);
  const labels: Record<string, string> = { department: 'Dept', employee_code: 'ID', date_of_joining: 'Joined', blood_group: 'Blood', phone: 'Phone', work_email: 'Email',
    location: 'Location', emergency_contact: 'SOS', office_address: 'Office', website: 'Web' };
  for (const [k, v] of rows) {
    if (y > H - 4) break;
    parts.push(text(tx, y, fit(`${labels[k] ?? k}: ${v}`, width, 2), 2, { anchor: a }));
    y += 2.9;
  }
  if (c.qrSvg && !land) parts.push(qrAt(c.qrSvg, W - 15, H - 17, 11));
  parts.push(`<rect y="${H - 1.8}" width="${W}" height="1.8" fill="${d.accent_color}"/>`);
  return doc(W, H, d.text_color, parts.join(''));
}

function idBack(c: SvgCardInput): string {
  const d = c.design;
  const land = d.orientation === 'landscape';
  const [W, H] = land ? [86, 54] : [54, 86];
  const parts = [`<rect width="${W}" height="${H}" rx="3" fill="#ffffff"/>`, text(W / 2, 8, fit(c.company, W - 8, 2.8), 2.8, { fill: d.primary_color, weight: 700, anchor: 'middle' })];
  const q = land ? 24 : 28;
  if (c.qrSvg) parts.push(qrAt(c.qrSvg, W / 2 - q / 2, 12, q));
  const lines = (d.back_text ?? 'If found, please return to the company.').split('\n').flatMap((l) => l.match(/.{1,34}(\s|$)/g) ?? [l]).slice(0, 5);
  lines.forEach((l, i) => parts.push(text(W / 2, (c.qrSvg ? 16 + q : 16) + 4 + i * 3, l.trim(), 2, { anchor: 'middle', opacity: 0.8 })));
  parts.push(`<rect x="4" y="${H - 4}" width="${W - 8}" height="1.5" rx="0.7" fill="${d.primary_color}"/>`);
  return doc(W, H, d.text_color, parts.join(''));
}

function visitingFront(c: SvgCardInput): string {
  const { design: d, person: p } = c;
  const t = templateFor(d.template);
  const [W, H] = [89, 51];
  const parts = [`<rect width="${W}" height="${H}" rx="2" fill="#ffffff"/>`];
  if (t.tint) parts.push(`<rect width="${W}" height="${H}" rx="2" fill="${d.primary_color}" fill-opacity="0.06"/>`);
  const bandW = t.header === 'none' ? 0 : t.header === 'side' ? 4 : 24;
  if (bandW) {
    if (t.header === 'wave') parts.push(`<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${d.primary_color}"/><stop offset="1" stop-color="${d.accent_color}"/></linearGradient></defs>`);
    parts.push(`<rect width="${bandW}" height="${H}" fill="${t.header === 'wave' ? 'url(#g)' : d.primary_color}"/>`);
    if (bandW > 10 && d.show_logo && c.logo) parts.push(`<image href="${c.logo}" x="3" y="${H / 2 - 9}" width="18" height="18" preserveAspectRatio="xMidYMid meet"/>`);
  }
  const x = bandW + 4;
  const w = W - x - 4;
  parts.push(text(x, 10, fit(p.name, w, 3.6), 3.6, { weight: 700 }));
  if (d.fields.includes('designation') && p.designation) parts.push(text(x, 14, fit(p.designation, w, 2.4), 2.4, { fill: d.primary_color, weight: 600 }));
  parts.push(text(x, 18.5, fit(c.company, w, 2), 2, { weight: 600, upper: true, opacity: 0.7 }));
  const lines = [
    ...(['phone', 'work_email', 'office_address', 'website', 'location', 'department'] as const).filter((k) => d.fields.includes(k)).map((k) => cardValue(k, p, c.website)),
    ...d.custom_fields.map((x2) => `${x2.label}: ${x2.value}`),
  ].filter((v): v is string => !!v).slice(0, 6);
  lines.forEach((l, i) => parts.push(text(x, H - 5 - (lines.length - 1 - i) * 2.9, fit(l, w, 2), 2)));
  parts.push(`<rect y="${H - 1.2}" width="${W}" height="1.2" fill="${d.accent_color}"/>`);
  return doc(W, H, d.text_color, parts.join(''));
}

function visitingBack(c: SvgCardInput): string {
  const d = c.design;
  const t = templateFor(d.template);
  const [W, H] = [89, 51];
  const parts = [t.header === 'wave'
    ? `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${d.primary_color}"/><stop offset="1" stop-color="${d.accent_color}"/></linearGradient></defs><rect width="${W}" height="${H}" rx="2" fill="url(#g)"/>`
    : `<rect width="${W}" height="${H}" rx="2" fill="${d.primary_color}"/>`];
  const textW = c.qrSvg ? W - 38 : W - 10;
  parts.push(text(5, 14, fit(c.company, textW, 3.4), 3.4, { fill: '#ffffff', weight: 700 }));
  if (c.website) parts.push(text(5, 19, fit(c.website, textW, 2.2), 2.2, { fill: '#ffffff', opacity: 0.85 }));
  (d.back_text ?? '').split('\n').flatMap((l) => l.match(/.{1,40}(\s|$)/g) ?? [l]).slice(0, 4)
    .forEach((l, i) => parts.push(text(5, 26 + i * 3, l.trim(), 2, { fill: '#ffffff', opacity: 0.85 })));
  if (c.qrSvg) parts.push(`<rect x="${W - 30}" y="${H / 2 - 13}" width="26" height="26" rx="1.5" fill="#ffffff"/>`, qrAt(c.qrSvg, W - 28.5, H / 2 - 11.5, 23));
  return doc(W, H, d.text_color, parts.join(''));
}

/** The front and back of one card as SVG documents. */
export function cardSvgs(c: SvgCardInput): { front: string; back: string } {
  return c.design.card_type === 'visiting' ? { front: visitingFront(c), back: visitingBack(c) } : { front: idFront(c), back: idBack(c) };
}

/** A ZIP of the given files, stored without compression (SVGs are small); dated 1 January 1980 so the bytes repeat. */
export function zipFiles(files: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true); lv.setUint16(12, 33, true);
    lv.setUint32(14, crc, true); lv.setUint32(18, f.data.length, true); lv.setUint32(22, f.data.length, true); lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const head = new Uint8Array(46 + name.length);
    const hv = new DataView(head.buffer);
    hv.setUint32(0, 0x02014b50, true); hv.setUint16(4, 20, true); hv.setUint16(6, 20, true); hv.setUint16(8, 0x0800, true); hv.setUint16(14, 33, true);
    hv.setUint32(16, crc, true); hv.setUint32(20, f.data.length, true); hv.setUint32(24, f.data.length, true); hv.setUint16(28, name.length, true);
    hv.setUint32(42, offset, true);
    head.set(name, 46);
    chunks.push(local, f.data);
    central.push(head);
    offset += local.length + f.data.length;
  }
  const size = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true); ev.setUint32(12, size, true); ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + size + 22);
  let p = 0;
  for (const c of [...chunks, ...central, end]) { out.set(c, p); p += c.length; }
  return out;
}
