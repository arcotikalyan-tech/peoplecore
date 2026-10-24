import { gzipSync } from 'node:zlib';
import { expect } from '@playwright/test';
import { archiveAuditDays } from '../../worker/src/audit-archive';
import { adminClient, open, signIn, test } from './helpers';

/**
 * The audit log's daily archive on the demo tenant: the worker's archive step runs (as it does each hour); HR checks
 * the archive and every day matches; a changed file is then reported, and the file is put back. Archive records are
 * append-only, so they stay (the next run continues after them).
 */
test.describe.configure({ mode: 'serial' });

const admin = adminClient();
let orgId = '';

test.beforeAll(async () => {
  orgId = (await admin.from('organizations').select('id').eq('slug', 'demo').eq('is_demo', true).single()).data!.id;
  await archiveAuditDays(admin, () => undefined, 500);
});

test('HR checks the archive; a changed file is reported', async ({ page }) => {
  const latest = (await admin.from('audit_archives').select('day, path').eq('organization_id', orgId).not('path', 'is', null)
    .order('day', { ascending: false }).limit(1).maybeSingle()).data;
  test.skip(!latest, 'the demo tenant has no archived day with events yet');

  await signIn(page, 'demo.hr');
  await open(page, '/app/demo/audit');
  const check = page.getByRole('form', { name: 'Check the archive' });
  await check.getByRole('button', { name: 'Check the last 30 days' }).click();
  await expect(check.getByText(/^All \d+ days? from .* match their files and the log\.$/)).toBeVisible();

  const bucket = admin.storage.from('audit-archive');
  const original = Buffer.from(await (await bucket.download(latest!.path!)).data!.arrayBuffer());
  await bucket.upload(latest!.path!, gzipSync(Buffer.from('{"id":1,"action":"nothing happened"}\n')), { upsert: true, contentType: 'application/gzip' });
  try {
    await page.reload();
    await page.getByRole('form', { name: 'Check the archive' }).getByRole('button', { name: 'Check the last 30 days' }).click();
    await expect(page.getByRole('form', { name: 'Check the archive' }).getByText(`${latest!.day}: its file was changed.`, { exact: false })).toBeVisible();
  } finally {
    await bucket.upload(latest!.path!, original, { upsert: true, contentType: 'application/gzip' });
  }
});
