import { crc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { CardDesign, CardPerson } from '@/lib/id-cards';
import { cardSvgs, zipFiles } from './idcard-svg';
import { unzip } from './xlsx';

const design: CardDesign = {
  id: 'd1', name: 'Staff', template: 'classic', orientation: 'portrait', fields: ['designation', 'employee_code', 'blood_group', 'office_address'],
  primary_color: '#1d4ed8', accent_color: '#f59e0b', text_color: '#111827', show_logo: false, show_photo: true, show_qr: true, qr_content: 'vcard',
  back_text: 'If found, please return to\nReception, Example Tower', logo_path: null, is_default: true, card_type: 'id', custom_fields: [{ label: 'Floor', value: '4' }], rolled_out_at: null,
};
const person: CardPerson = {
  id: 'p1', name: 'Asha <Rao>', code: 'EMP-001', designation: 'Engineer', department: 'Tech', location: 'Pune office', date_of_joining: '2024-04-01',
  blood_group: 'O+', phone: '+91 90000 00000', work_email: 'asha@example.test', emergency_contact: null, office_address: '1 Example Road, Pune',
};
const qr = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 25 25"><path d="M0 0h7v7H0z"/></svg>';

describe('cardSvgs', () => {
  it('draws an ID card at CR80 size with the chosen fields, custom lines, QR and back text, escaping text', () => {
    const { front, back } = cardSvgs({ design, person, company: 'Example & Co', website: null, logo: null, qrSvg: qr });
    expect(front).toContain('width="54mm" height="86mm"');
    expect(front).toContain('Asha &lt;Rao&gt;');
    expect(front).not.toContain('<Rao>');
    expect(front).toContain('EXAMPLE &amp; CO');
    expect(front).toContain('Engineer');
    expect(front).toContain('ID: EMP-001');
    expect(front).toContain('Blood: O+');
    expect(front).toContain('Office: 1 Example Road, Pune');
    expect(front).toContain('Floor: 4');
    expect(front).not.toContain('Tech');
    expect(front).toContain('<svg x="39" y="69" width="11" height="11"');
    expect(back).toContain('Reception, Example Tower');
    expect(back).toContain('<svg x="13" y="12" width="28" height="28"');
  });

  it('lays landscape ID cards out sideways and leaves the photo out when asked', () => {
    const { front } = cardSvgs({ design: { ...design, orientation: 'landscape', show_photo: false }, person, company: 'Example', website: null, logo: null, qrSvg: null });
    expect(front).toContain('width="86mm" height="54mm"');
    expect(front).not.toContain('>AR<');
  });

  it('draws a visiting card at business-card size with contact lines and the website on the back', () => {
    const visiting = { ...design, card_type: 'visiting', orientation: 'landscape', fields: ['designation', 'phone', 'work_email', 'website'], custom_fields: [], back_text: null };
    const { front, back } = cardSvgs({ design: visiting, person, company: 'Example', website: 'example.test', logo: 'data:image/png;base64,AAAA', qrSvg: qr });
    expect(front).toContain('width="89mm" height="51mm"');
    expect(front).toContain('+91 90000 00000');
    expect(front).toContain('asha@example.test');
    expect(front).toContain('example.test');
    expect(front).not.toContain('EMP-001');
    expect(back).toContain('example.test');
    expect(back).toContain('<svg x="60.5"');
  });
});

describe('zipFiles', () => {
  it('writes a ZIP that reads back, with correct checksums, byte for byte the same each time', () => {
    const enc = new TextEncoder();
    const files = [{ name: 'EMP-001 Asha-front.svg', data: enc.encode('<svg>front</svg>') }, { name: 'EMP-001 Asha-back.svg', data: enc.encode('<svg>back ✓</svg>') }];
    const zip = zipFiles(files);
    const read = unzip(zip, () => true);
    expect([...read.keys()]).toEqual(['EMP-001 Asha-front.svg', 'EMP-001 Asha-back.svg']);
    expect(read.get('EMP-001 Asha-back.svg')).toBe('<svg>back ✓</svg>');
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    expect(view.getUint32(14, true)).toBe(crc32(files[0]!.data));
    expect(zipFiles(files)).toEqual(zip);
  });
});
