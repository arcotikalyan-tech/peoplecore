import { expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { adminClient, domain, expectNotFound, liveEnv, open, signIn, test } from './helpers';

/**
 * Employee documents on the live demo tenant: upload, type checking, audited download through a signed
 * URL, access limits and deletion (which removes the stored file). Uses a throwaway employee; every
 * document and file created here is removed afterwards.
 */
test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36).slice(-5).toUpperCase();
const admin = adminClient();
const BUCKET = 'employee-documents';
let orgId = '';
let subjectId = '';
let devId = '';

// A minimal valid PDF. The content is synthetic.
const pdf = Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n% E2E ${run}\n`);
const uploadForm = (page: Page) => page.getByRole('form', { name: 'Upload a document' });

async function upload(page: Page, title: string, file: { name: string; mimeType: string; buffer: Buffer }) {
  const form = uploadForm(page);
  await form.getByLabel('Category').selectOption('contract');
  await form.getByLabel('Title').fill(title);
  await form.getByLabel('File').setInputFiles(file);
  await form.getByRole('button', { name: 'Upload' }).click();
}

test.beforeAll(async () => {
  orgId = (await admin.from('organizations').select('id').eq('slug', 'demo').eq('is_demo', true).single()).data!.id;
  devId = (await admin.from('employees').select('id').eq('organization_id', orgId).eq('first_name', 'Dev').eq('last_name', 'Nair').single()).data!.id;
  const rohan = (await admin.from('employees').select('id').eq('organization_id', orgId).eq('first_name', 'Rohan').single()).data!;
  const { data, error } = await admin.from('employees').insert({
    organization_id: orgId, employee_code: `E2E-${run}`, first_name: 'Neha', last_name: `Test${run}`,
    work_email: `e2e.documents.${run.toLowerCase()}@${domain}`, employment_type: 'permanent',
    date_of_joining: '2026-01-05', status: 'active', manager_employee_id: rohan.id,
  }).select('id').single();
  if (error) throw new Error(error.message);
  subjectId = data.id;
});

test.afterAll(async () => {
  const { data } = await admin.from('employee_documents').select('id, storage_path').eq('organization_id', orgId).ilike('title', `%${run}%`);
  if (data?.length) {
    await admin.storage.from(BUCKET).remove(data.map((d) => d.storage_path));
    await admin.from('employee_documents').delete().in('id', data.map((d) => d.id));
  }
  if (subjectId) await admin.from('employees').delete().eq('id', subjectId);
});

test('HR uploads a document; a file that only pretends to be a PDF is refused', async ({ page }) => {
  await signIn(page, 'demo.hr');
  await open(page, `/app/demo/employees/${subjectId}`);

  await upload(page, `Fake ${run}`, { name: 'fake.pdf', mimeType: 'application/pdf', buffer: Buffer.from('<html>not a pdf</html>') });
  await expect(uploadForm(page).getByText('Upload a PDF, JPEG or PNG file.')).toBeVisible();

  await upload(page, `Offer letter ${run}`, { name: 'offer-letter.pdf', mimeType: 'application/pdf', buffer: pdf });
  await expect(page.getByText(`“Offer letter ${run}” uploaded.`)).toBeVisible();
  await expect(page.getByRole('link', { name: `Download Offer letter ${run}` })).toBeVisible();

  const { data } = await admin.from('employee_documents').select('storage_path, content_type, size_bytes').eq('employee_id', subjectId);
  expect(data).toEqual([{ storage_path: expect.stringMatching(new RegExp(`^${orgId}/${subjectId}/`)), content_type: 'application/pdf', size_bytes: pdf.length }]);
  expect((await admin.from('employee_documents').select('id').ilike('title', `Fake ${run}`)).data).toEqual([]);
});

test('downloading goes through a short-lived link and is recorded', async ({ page }) => {
  await signIn(page, 'demo.hr');
  await open(page, `/app/demo/employees/${subjectId}`);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: `Download Offer letter ${run}` }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('offer-letter.pdf');
  expect(download.url()).toContain('/storage/v1/object/sign/');
  const path = await download.path();
  const { readFile } = await import('node:fs/promises');
  expect((await readFile(path)).equals(pdf)).toBe(true);

  const doc = (await admin.from('employee_documents').select('id').eq('employee_id', subjectId).single()).data!;
  const { data: events } = await admin.from('audit_events').select('action').eq('entity_id', doc.id).eq('action', 'download');
  expect(events?.length).toBeGreaterThan(0);
});

test('employees upload their own documents but cannot delete them or open a colleague’s', async ({ page }) => {
  await signIn(page, 'demo.employee');
  await open(page, `/app/demo/employees/${devId}`);
  await upload(page, `Degree ${run}`, { name: 'degree.pdf', mimeType: 'application/pdf', buffer: pdf });
  await expect(page.getByText(`“Degree ${run}” uploaded.`)).toBeVisible();
  await expect(page.getByRole('button', { name: `Delete Degree ${run}` })).toHaveCount(0);

  // A colleague's document: the download route answers as if it didn't exist.
  const doc = (await admin.from('employee_documents').select('id').eq('employee_id', subjectId).single()).data!;
  const res = await page.request.get(`/app/demo/employees/${subjectId}/documents/${doc.id}`, { maxRedirects: 0 });
  expect(res.status()).toBe(404);
  await open(page, `/app/demo/employees/${subjectId}`);
  await expectNotFound(page);
});

test('the storage API itself refuses signed-in users, even for their own files', async () => {
  // What a browser could do with the publishable key and its own session, bypassing the app.
  const user = createClient(liveEnv().url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  const { error: signInError } = await user.auth.signInWithPassword({ email: `demo.employee@${domain}`, password: liveEnv().password });
  expect(signInError).toBeNull();
  const own = (await admin.from('employee_documents').select('storage_path').eq('employee_id', devId).ilike('title', `Degree ${run}`).single()).data!;

  expect((await user.storage.from(BUCKET).download(own.storage_path)).error).not.toBeNull();
  expect((await user.storage.from(BUCKET).createSignedUrl(own.storage_path, 60)).error).not.toBeNull();
  expect((await user.storage.from(BUCKET).list(`${orgId}/${devId}`)).data ?? []).toEqual([]);
  expect((await user.storage.from(BUCKET).upload(`${orgId}/${devId}/planted.pdf`, pdf, { contentType: 'application/pdf' })).error).not.toBeNull();
  await user.auth.signOut({ scope: 'local' }); // only this client: don't end the demo account's other sessions
});

test('a manager sees no documents section for a report', async ({ page }) => {
  await signIn(page, 'demo.manager');
  await open(page, `/app/demo/employees/${subjectId}`);
  await expect(page.getByRole('heading', { level: 1, name: `Neha Test${run}` })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Documents', exact: true })).toHaveCount(0);
});

test('HR deletes a document: it disappears and the stored file is removed', async ({ page }) => {
  const doc = (await admin.from('employee_documents').select('id, storage_path').eq('employee_id', subjectId).single()).data!;
  await signIn(page, 'demo.hr');
  await open(page, `/app/demo/employees/${subjectId}`);
  await page.getByRole('button', { name: `Delete Offer letter ${run}` }).click();
  await expect(page.getByRole('link', { name: `Download Offer letter ${run}` })).toHaveCount(0);

  const row = (await admin.from('employee_documents').select('deleted_at').eq('id', doc.id).single()).data!;
  expect(row.deleted_at).not.toBeNull(); // kept, hidden, for the audit trail
  const stored = await admin.storage.from(BUCKET).download(doc.storage_path);
  expect(stored.error).not.toBeNull();
});
