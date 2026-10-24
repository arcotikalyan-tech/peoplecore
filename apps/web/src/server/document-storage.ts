import 'server-only';
import { createAdminClient } from './admin';

/**
 * Files in the private buckets (employee documents, receipts, letters, statutory proofs, selfies, company proofs, helpdesk files). Uses the service-role client: storage.objects has no
 * policies for signed-in users, so only the server can reach these files.
 *
 * AUTHORIZATION: callers must already have checked the actor's permission for this employee's documents,
 * and the database stays the authority: uploads are recorded with add_employee_document (removing the file
 * if that refuses), downloads are signed only for a path returned by document_download, and files are
 * removed only after delete_employee_document succeeded.
 */
export const DOCUMENT_BUCKET = 'employee-documents';
const SIGNED_URL_SECONDS = 60;

// <org uuid>/<employee uuid>/<document uuid>: the only shape the database produces.
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const PATH = new RegExp(`^${UUID}/${UUID}/${UUID}$`);

export const RECEIPT_BUCKET = 'expense-receipts';
/** Letterhead art and signatures: <org uuid>/<asset uuid>. Callers must hold letter.manage (checked by the action). */
export const LETTER_BUCKET = 'letter-assets';
const LETTER_PATH = new RegExp(`^${UUID}/${UUID}$`);
/** Proof of statutory filings: <org uuid>/<file uuid>. Callers must hold statutory.manage (checked by the action). */
export const STATUTORY_BUCKET = 'statutory-documents';
/** Check-in selfies: <org uuid>/<employee uuid>/<file uuid>. Written by the punch action for the signed-in employee only. */
export const SELFIE_BUCKET = 'attendance-selfies';
/** Company proofs (PAN, CIN, GST…): <org uuid>/<file uuid>. Callers must hold org.manage (checked by the action; RLS on the row). */
export const COMPANY_BUCKET = 'company-documents';
/** Files on helpdesk tickets: <org uuid>/<ticket uuid>/<file uuid>. Recorded with add_ticket_attachment, signed only for ticket_file. */
export const HELPDESK_BUCKET = 'helpdesk-attachments';
/** Announcement pictures: <org uuid>/<announcement uuid>/<file uuid>. Stored by the publish action (announcement.manage). */
export const ANNOUNCEMENT_BUCKET = 'announcement-images';
/** Files on grievance cases: <org uuid>/<case uuid>/<file uuid>. Recorded with add_grievance_file, signed only for grievance_file. */
export const GRIEVANCE_BUCKET = 'grievance-files';
/**
 * Profile photos (<org uuid>/<employee uuid>/<file uuid>, recorded with set_employee_photo) and company logos
 * (<org uuid>/logo/<file uuid>, set_company_logo). Signed only for paths read through RLS (rows the viewer can see).
 */
export const IMAGE_BUCKET = 'profile-images';
const LOGO_PATH = new RegExp(`^${UUID}/logo/${UUID}$`);
/** Always named explicitly: a default bucket would silently put files in the wrong place. */
type Bucket = typeof DOCUMENT_BUCKET | typeof RECEIPT_BUCKET | typeof LETTER_BUCKET | typeof STATUTORY_BUCKET | typeof SELFIE_BUCKET | typeof COMPANY_BUCKET
  | typeof HELPDESK_BUCKET | typeof GRIEVANCE_BUCKET | typeof ANNOUNCEMENT_BUCKET | typeof IMAGE_BUCKET;

function checkedPath(path: string, bucket?: Bucket) {
  const shape = bucket === LETTER_BUCKET || bucket === STATUTORY_BUCKET || bucket === COMPANY_BUCKET ? LETTER_PATH : bucket === IMAGE_BUCKET && path.includes('/logo/') ? LOGO_PATH : PATH;
  if (!shape.test(path)) throw new Error('Invalid document path');
  return path;
}

export async function storeDocumentFile(path: string, bytes: Uint8Array, contentType: string, bucket: Bucket): Promise<boolean> {
  const { error } = await createAdminClient().storage.from(bucket)
    .upload(checkedPath(path, bucket), bytes, { contentType, upsert: false, cacheControl: 'private, max-age=0' });
  return !error;
}

export async function removeDocumentFile(path: string, bucket: Bucket): Promise<boolean> {
  const { error } = await createAdminClient().storage.from(bucket).remove([checkedPath(path, bucket)]);
  return !error;
}

/** A short-lived link that downloads the file under its original name. */
export async function signDocumentUrl(path: string, fileName: string, bucket: Bucket): Promise<string | null> {
  const { data, error } = await createAdminClient().storage.from(bucket)
    .createSignedUrl(checkedPath(path, bucket), SIGNED_URL_SECONDS, { download: fileName });
  return error ? null : data.signedUrl;
}

/** A short-lived link to show an image inline (letterhead, signature) on a letter the viewer may read. */
export async function signImageUrl(path: string): Promise<string | null> {
  const { data, error } = await createAdminClient().storage.from(LETTER_BUCKET).createSignedUrl(checkedPath(path, LETTER_BUCKET), 300);
  return error ? null : data.signedUrl;
}

/** A short-lived link to show a check-in photo, for a path punch_selfie returned (the viewer may see that punch). */
export async function signSelfieUrl(path: string): Promise<string | null> {
  const { data, error } = await createAdminClient().storage.from(SELFIE_BUCKET).createSignedUrl(checkedPath(path, SELFIE_BUCKET), 300);
  return error ? null : data.signedUrl;
}

/** Links to show profile photos and logos (an hour), for paths the viewer read through RLS. */
export async function signImageUrls(paths: Array<string | null | undefined>): Promise<Map<string, string>> {
  const wanted = [...new Set(paths.filter((p): p is string => !!p))].map((p) => checkedPath(p, IMAGE_BUCKET));
  if (wanted.length === 0) return new Map();
  const { data, error } = await createAdminClient().storage.from(IMAGE_BUCKET).createSignedUrls(wanted, 3600);
  if (error || !data) return new Map();
  return new Map(data.flatMap((d) => (d.path && d.signedUrl ? [[d.path, d.signedUrl] as [string, string]] : [])));
}

/** The audit log's daily archive (migration 20261025000400): <org uuid>/<year>/<day>.jsonl.gz, written by the worker. */
const AUDIT_ARCHIVE_BUCKET = 'audit-archive';
const AUDIT_ARCHIVE_PATH = new RegExp(`^${UUID}/\\d{4}/\\d{4}-\\d{2}-\\d{2}\\.jsonl\\.gz$`);

/** A day's archive file, for a path audit_archive_check returned to someone holding audit.read. Null if it can't be read. */
export async function readAuditArchive(path: string): Promise<Uint8Array | null> {
  if (!AUDIT_ARCHIVE_PATH.test(path)) throw new Error('Invalid archive path');
  const { data, error } = await createAdminClient().storage.from(AUDIT_ARCHIVE_BUCKET).download(path);
  return error || !data ? null : new Uint8Array(await data.arrayBuffer());
}

/** Links to show announcement pictures (an hour), for paths the viewer read through RLS (announcements they can see). */
export async function signAnnouncementImages(paths: Array<string | null | undefined>): Promise<Map<string, string>> {
  const wanted = [...new Set(paths.filter((p): p is string => !!p))].map((p) => checkedPath(p, ANNOUNCEMENT_BUCKET));
  if (wanted.length === 0) return new Map();
  const { data, error } = await createAdminClient().storage.from(ANNOUNCEMENT_BUCKET).createSignedUrls(wanted, 3600);
  if (error || !data) return new Map();
  return new Map(data.flatMap((d) => (d.path && d.signedUrl ? [[d.path, d.signedUrl] as [string, string]] : [])));
}

/**
 * A check-in photo's bytes, for a path punch_selfie returned (attendance.manage checked by the caller), and the
 * employee's profile photo, for a path read through RLS: the AI photo check sends both to the model.
 */
export async function readSelfieAndPhoto(selfiePath: string, photoPath: string | null): Promise<{ selfie: Uint8Array | null; photo: Uint8Array | null }> {
  const admin = createAdminClient();
  const read = async (bucket: Bucket, path: string) => {
    const { data, error } = await admin.storage.from(bucket).download(checkedPath(path, bucket));
    return error || !data ? null : new Uint8Array(await data.arrayBuffer());
  };
  const [selfie, photo] = await Promise.all([read(SELFIE_BUCKET, selfiePath), photoPath ? read(IMAGE_BUCKET, photoPath) : Promise.resolve(null)]);
  return { selfie, photo };
}

/** A company logo's bytes (for a payslip PDF), for a logo path the caller read through RLS. Null if it can't be read. */
export async function readLogoFile(path: string): Promise<Uint8Array | null> {
  if (!LOGO_PATH.test(path)) throw new Error('Invalid document path');
  const { data, error } = await createAdminClient().storage.from(IMAGE_BUCKET).download(path);
  return error || !data ? null : new Uint8Array(await data.arrayBuffer());
}
