import 'server-only';
import { createAdminClient } from './admin';

/**
 * Files in the private `employee-documents` bucket. Uses the service-role client: storage.objects has no
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

function checkedPath(path: string) {
  if (!PATH.test(path)) throw new Error('Invalid document path');
  return path;
}

export async function storeDocumentFile(path: string, bytes: Uint8Array, contentType: string): Promise<boolean> {
  const { error } = await createAdminClient().storage.from(DOCUMENT_BUCKET)
    .upload(checkedPath(path), bytes, { contentType, upsert: false, cacheControl: 'private, max-age=0' });
  return !error;
}

export async function removeDocumentFile(path: string): Promise<boolean> {
  const { error } = await createAdminClient().storage.from(DOCUMENT_BUCKET).remove([checkedPath(path)]);
  return !error;
}

/** A short-lived link that downloads the file under its original name. */
export async function signDocumentUrl(path: string, fileName: string): Promise<string | null> {
  const { data, error } = await createAdminClient().storage.from(DOCUMENT_BUCKET)
    .createSignedUrl(checkedPath(path), SIGNED_URL_SECONDS, { download: fileName });
  return error ? null : data.signedUrl;
}
