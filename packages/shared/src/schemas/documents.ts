import { z } from 'zod';
import { requiredText } from './common.ts';

/** Mirrors public.document_category and the employee_documents checks (migration 20261018000500). */
export const DOCUMENT_CATEGORIES = ['identity', 'address', 'education', 'employment', 'contract', 'medical', 'other'] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategory, string> = {
  identity: 'Identity proof',
  address: 'Address proof',
  education: 'Education',
  employment: 'Previous employment',
  contract: 'Offer & contract',
  medical: 'Medical',
  other: 'Other',
};

export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
export const DOCUMENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/** Text fields of the upload form; the file itself is checked with checkDocumentFile. */
export const uploadDocumentSchema = z.object({
  category: z.enum(DOCUMENT_CATEGORIES, { error: 'Choose a category' }),
  title: requiredText(120, 'Title'),
});
export type UploadDocumentInput = z.infer<typeof uploadDocumentSchema>;

/**
 * The file's real type, from its first bytes. The browser-supplied type and the extension are ignored:
 * both are easy to fake.
 */
export function sniffDocumentType(bytes: Uint8Array): DocumentType | null {
  const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (starts(0x25, 0x50, 0x44, 0x46, 0x2d)) return 'application/pdf'; // %PDF-
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
  return null;
}

/** Validates an uploaded file. Returns its real type, or a message for the user. */
export function checkDocumentFile(size: number, head: Uint8Array): { ok: true; type: DocumentType } | { ok: false; message: string } {
  if (size === 0) return { ok: false, message: 'Choose a file to upload.' };
  if (size > MAX_DOCUMENT_BYTES) return { ok: false, message: 'Files can be at most 5 MB.' };
  const type = sniffDocumentType(head);
  return type ? { ok: true, type } : { ok: false, message: 'Upload a PDF, JPEG or PNG file.' };
}

/** A file name safe to store and to offer back as a download name. */
export function safeFileName(name: string): string {
  const cleaned = [...name.normalize('NFKC')]
    .filter((ch) => ch.charCodeAt(0) >= 0x20 && ch.charCodeAt(0) !== 0x7f) // control characters
    .join('')
    .replace(/[\\/]/g, '_') // no path separators
    .replace(/["<>|:*?]/g, '') // reserved characters
    .trim();
  return (cleaned || 'document').slice(-200);
}
