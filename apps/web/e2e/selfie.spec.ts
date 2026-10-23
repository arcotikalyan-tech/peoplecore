import { expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { adminClient, domain, liveEnv, open, signIn, test } from './helpers';

/**
 * Check-in selfies on the demo tenant, with the attendance rules asking for one: Dev opens the camera on the website
 * (Chrome's fake camera), takes the photo and checks in, and HR sees it in his daily log; the phone app's endpoint records a punch with a photo for a
 * signed-in employee and refuses a missing token or a file that isn't a photo. The rules are put back and the punches
 * and photos removed afterwards.
 */
test.describe.configure({ mode: 'serial' });
test.use({ launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] }, permissions: ['camera'] });

const admin = adminClient();
const startedAt = new Date().toISOString();
let orgId = '';
let devId = '';
let rulesBefore: Array<{ id: string; verify_selfie: boolean }> = [];
// The start of a JPEG: enough for the server's type check (it reads the file's first bytes).
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9]);

test.beforeAll(async () => {
  orgId = (await admin.from('organizations').select('id').eq('slug', 'demo').eq('is_demo', true).single()).data!.id;
  devId = (await admin.from('employees').select('id').eq('organization_id', orgId).eq('first_name', 'Dev').eq('last_name', 'Nair').single()).data!.id;
  rulesBefore = (await admin.from('shifts').select('id, verify_selfie').eq('organization_id', orgId)).data ?? [];
  await admin.from('shifts').update({ verify_selfie: true }).eq('organization_id', orgId);
});

test.afterAll(async () => {
  for (const r of rulesBefore) await admin.from('shifts').update({ verify_selfie: r.verify_selfie }).eq('id', r.id);
  const punches = (await admin.from('attendance_punches').select('id, selfie_path').eq('employee_id', devId).gte('received_at', startedAt)).data ?? [];
  const photos = punches.map((p) => p.selfie_path).filter((x): x is string => !!x);
  if (photos.length) await admin.storage.from('attendance-selfies').remove(photos);
  await admin.from('anomaly_flags').delete().eq('employee_id', devId).gte('created_at', startedAt);
  await admin.from('attendance_punches').delete().eq('employee_id', devId).gte('received_at', startedAt);
});

test('on the website, the employee takes a selfie with the camera and checks in', async ({ page }) => {
  await signIn(page, 'demo.employee');
  await open(page, '/app/demo/attendance');
  const punch = page.getByRole('button', { name: /^Check (in|out)$/ });
  await expect(punch).toBeDisabled(); // no photo yet
  await page.getByRole('button', { name: 'Open camera' }).click();
  await expect(page.getByLabel('Camera preview')).toBeVisible();
  await page.getByRole('button', { name: 'Take photo' }).click();
  await expect(page.getByRole('img', { name: 'Your selfie' })).toBeVisible();
  await punch.click();
  await expect(page.getByText(/^Punch recorded at /)).toBeVisible();
  const { data } = await admin.from('attendance_punches').select('method, selfie_path').eq('employee_id', devId).gte('received_at', startedAt);
  expect(data!.at(-1)).toMatchObject({ method: 'web', selfie_path: expect.stringMatching(new RegExp(`^${orgId}/${devId}/`)) });
});

test('HR sees the photo with the punch in the employee’s daily log', async ({ page }) => {
  await signIn(page, 'demo.hr');
  await open(page, `/app/demo/employees/${devId}?tab=attendance&view=logs`);
  const photo = page.getByRole('table', { name: 'Punches' }).getByRole('img', { name: /^Check-in photo at / }).last();
  await expect(photo).toBeVisible();
  const res = await page.request.get((await photo.getAttribute('src'))!);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toMatch(/^image\//);
});

test('the phone app’s endpoint records a punch with a photo, as the signed-in employee', async ({ baseURL }) => {
  const app = createClient(liveEnv().url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  const { data: session } = await app.auth.signInWithPassword({ email: `demo.employee@${domain}`, password: liveEnv().password });
  const token = session.session!.access_token;
  const send = (auth: string | null, file: Buffer, clientId = `mobile-${crypto.randomUUID()}`) => {
    const form = new FormData();
    form.set('clientId', clientId);
    form.set('orgId', orgId);
    form.set('punchedAt', new Date().toISOString());
    form.set('selfie', new Blob([new Uint8Array(file)], { type: 'image/jpeg' }), 'selfie.jpg');
    return fetch(`${baseURL}/api/mobile/punch`, { method: 'POST', body: form, headers: auth ? { Authorization: `Bearer ${auth}` } : {} });
  };

  const ok = await send(token, JPEG);
  expect(ok.status).toBe(200);
  const id = ((await ok.json()) as { id: string }).id;
  const { data: row } = await admin.from('attendance_punches').select('method, selfie_path').eq('id', id).single();
  expect(row).toMatchObject({ method: 'mobile', selfie_path: expect.stringMatching(new RegExp(`^${orgId}/${devId}/`)) });
  expect((await admin.from('anomaly_flags').select('rule').eq('subject_id', id)).data!.map((f) => f.rule)).not.toContain('no_selfie');

  expect((await send(null, JPEG)).status).toBe(401);
  const notPhoto = await send(token, Buffer.from('not a photo at all'));
  expect(notPhoto.status).toBe(400);
  expect(((await notPhoto.json()) as { message: string }).message).toBe('Take a photo (JPEG or PNG).');
});
