import { describe, expect, it } from 'vitest';
import { checkDocumentFile, MAX_DOCUMENT_BYTES, safeFileName, sniffDocumentType, uploadDocumentSchema } from '../src/index.ts';

const bytes = (...b: number[]) => new Uint8Array(b);
const PDF = bytes(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0);

describe('sniffDocumentType', () => {
  it('recognises PDF, PNG and JPEG by their bytes', () => {
    expect(sniffDocumentType(PDF)).toBe('application/pdf');
    expect(sniffDocumentType(PNG)).toBe('image/png');
    expect(sniffDocumentType(JPEG)).toBe('image/jpeg');
  });

  it('rejects anything else, including HTML and truncated headers', () => {
    expect(sniffDocumentType(new TextEncoder().encode('<html><script>'))).toBeNull();
    expect(sniffDocumentType(bytes(0x25, 0x50))).toBeNull();
    expect(sniffDocumentType(bytes())).toBeNull();
  });
});

describe('checkDocumentFile', () => {
  it('enforces presence and the 5 MB limit', () => {
    expect(checkDocumentFile(0, PDF)).toEqual({ ok: false, message: 'Choose a file to upload.' });
    expect(checkDocumentFile(MAX_DOCUMENT_BYTES, PDF)).toEqual({ ok: true, type: 'application/pdf' });
    expect(checkDocumentFile(MAX_DOCUMENT_BYTES + 1, PDF)).toEqual({ ok: false, message: 'Files can be at most 5 MB.' });
  });
});

describe('safeFileName', () => {
  it('removes path separators and reserved characters', () => {
    expect(safeFileName('../../etc/passwd')).toBe('.._.._etc_passwd');
    expect(safeFileName('offer "final"<1>.pdf')).toBe('offer final1.pdf');
    expect(safeFileName('a\u0000b\u001f\u007fc.pdf')).toBe('abc.pdf');
    expect(safeFileName('   ')).toBe('document');
  });
});

describe('uploadDocumentSchema', () => {
  it('needs a known category and a title', () => {
    expect(uploadDocumentSchema.safeParse({ category: 'contract', title: ' Offer letter ' }))
      .toEqual({ success: true, data: { category: 'contract', title: 'Offer letter' } });
    expect(uploadDocumentSchema.safeParse({ category: 'payslip', title: 'x' }).success).toBe(false);
    expect(uploadDocumentSchema.safeParse({ category: 'other', title: '' }).success).toBe(false);
  });
});
