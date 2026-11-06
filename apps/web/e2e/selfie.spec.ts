import { expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { adminClient, domain, liveEnv, open, signIn, test } from './helpers';

/**
 * Check-in selfies on the demo tenant, with the attendance rules asking for one: Dev presses a punch on the website, the
 * camera opens (Chrome's fake camera) and taking the photo records it, every punch with a new photo; HR sees the photos in
 * Attendance › Logs and in his daily log; the phone app's endpoint records a punch with a photo for a signed-in employee and refuses a missing token or a file that isn't a photo. HR asks the AI to check a photo the test
 * provider reads as a picture of a screen, and flags it for review. The rules and AI settings are put back and the
 * punches, photos and AI runs removed afterwards.
 */
test.describe.configure({ mode: 'serial' });
test.use({ launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] }, permissions: ['camera', 'geolocation'], geolocation: { latitude: 12.971599, longitude: 77.594563, accuracy: 18 } });

const MAP = /query=12\.971599%2C77\.594563$/;
const SPOT = '12.971599, 77.594563 · within 18 m';

const admin = adminClient();
const startedAt = new Date().toISOString();
let orgId = '';
let devId = '';
let rulesBefore: Array<{ id: string; verify_selfie: boolean }> = [];
let aiBefore: { enabled: boolean; monthly_token_budget: number; hourly_limit_per_user: number } | null = null;
// The start of a JPEG: enough for the server's type check (it reads the file's first bytes).
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9]);

test.beforeAll(async () => {
  orgId = (await admin.from('organizations').select('id').eq('slug', 'demo').eq('is_demo', true).single()).data!.id;
  devId = (await admin.from('employees').select('id').eq('organization_id', orgId).eq('first_name', 'Dev').eq('last_name', 'Nair').single()).data!.id;
  rulesBefore = (await admin.from('shifts').select('id, verify_selfie').eq('organization_id', orgId)).data ?? [];
  await admin.from('shifts').update({ verify_selfie: true }).eq('organization_id', orgId);
  aiBefore = (await admin.from('ai_settings').select('enabled, monthly_token_budget, hourly_limit_per_user').eq('organization_id', orgId).maybeSingle()).data;
  await admin.from('ai_settings').upsert({ organization_id: orgId, enabled: true, monthly_token_budget: 2_000_000, hourly_limit_per_user: 30 }, { onConflict: 'organization_id' });
});

test.afterAll(async () => {
  await admin.from('ai_runs').delete().eq('organization_id', orgId).gte('created_at', startedAt);
  if (aiBefore) await admin.from('ai_settings').update(aiBefore).eq('organization_id', orgId);
  else await admin.from('ai_settings').delete().eq('organization_id', orgId);
  for (const r of rulesBefore) await admin.from('shifts').update({ verify_selfie: r.verify_selfie }).eq('id', r.id);
  const punches = (await admin.from('attendance_punches').select('id, selfie_path').eq('employee_id', devId).gte('received_at', startedAt)).data ?? [];
  const photos = punches.map((p) => p.selfie_path).filter((x): x is string => !!x);
  if (photos.length) await admin.storage.from('attendance-selfies').remove(photos);
  await admin.from('anomaly_flags').delete().eq('employee_id', devId).gte('created_at', startedAt);
  await admin.from('attendance_punches').delete().eq('employee_id', devId).gte('received_at', startedAt);
});

test('on the website, pressing a punch asks for the selfie, and taking it records the punch', async ({ page }) => {
  await signIn(page, 'demo.employee');
  await open(page, '/app/demo/attendance');
  const today = page.getByRole('region', { name: 'Today' });
  const punch = today.getByRole('button', { name: /^Check (in|out)$/ });

  // The button works before any photo. Changing your mind records nothing.
  await punch.click();
  await expect(page.getByLabel('Camera preview')).toBeVisible();
  await expect(today.getByText(/^📸 Take a selfie to check (in|out)\.$/)).toBeVisible();
  await today.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByLabel('Camera preview')).toHaveCount(0);
  expect((await admin.from('attendance_punches').select('id').eq('employee_id', devId).gte('received_at', startedAt)).data).toEqual([]);

  await punch.click();
  await today.getByRole('button', { name: 'Take photo' }).click();
  await expect(page.getByText(/^Check-(in|out) at /)).toBeVisible();
  await expect(page.getByLabel('Camera preview')).toHaveCount(0);
  const { data } = await admin.from('attendance_punches').select('method, selfie_path').eq('employee_id', devId).gte('received_at', startedAt);
  expect(data!.at(-1)).toMatchObject({ method: 'web', selfie_path: expect.stringMatching(new RegExp(`^${orgId}/${devId}/`)) });
});

test('after checking in, lunch, a break and check-out work: each asks for a new selfie when pressed', async ({ page }) => {
  await signIn(page, 'demo.employee');
  await open(page, '/app/demo/attendance');
  const today = page.getByRole('region', { name: 'Today' });
  const withPhoto = async (name: string) => {
    await today.getByRole('button', { name, exact: true }).click();
    await today.getByRole('button', { name: 'Take photo' }).click();
  };
  if (await today.getByRole('button', { name: 'Check in' }).isVisible()) {
    await withPhoto('Check in');
    await expect(page.getByText(/^Check-in at /)).toBeVisible();
  }
  for (const name of ['Start lunch', 'Start break', 'Check out']) await expect(today.getByRole('button', { name, exact: true })).toBeEnabled();
  await withPhoto('Start lunch');
  await expect(page.getByText(/^Lunch started at /)).toBeVisible();
  await withPhoto('End lunch');
  await expect(page.getByText(/^Lunch ended at /)).toBeVisible();
  const { data } = await admin.from('attendance_punches').select('kind, selfie_path').eq('employee_id', devId).gte('received_at', startedAt).order('punched_at');
  const lunch = data!.slice(-2);
  expect(lunch.map((p) => p.kind)).toEqual(['lunch_start', 'lunch_end']);
  expect(lunch[0]!.selfie_path).toBeTruthy();
  expect(lunch[1]!.selfie_path).toBeTruthy();
  expect(lunch[0]!.selfie_path).not.toBe(lunch[1]!.selfie_path);

  // A busy day's punches keep their room: the buttons move below rather than squeeze them into a narrow column.
  const list = (await today.locator('p', { hasText: /Lunch started .* · Lunch ended/ }).boundingBox())!;
  expect(list.width).toBeGreaterThan((await today.boundingBox())!.width * 0.6);
});

test('HR sees the photos and the Google Maps location in Attendance › Logs and in the employee’s daily log; a full name finds them', async ({ page }) => {
  await signIn(page, 'demo.hr');
  await open(page, '/app/demo/attendance?tab=logs&view=daily&q=dev%20nair');
  const row = page.getByRole('row', { name: /Dev Nair/ });
  const inLog = row.getByRole('img', { name: /^Dev Nair: .* photo at / });
  await expect(inLog).toHaveCount(2); // the day's first and last
  await expect(inLog.first()).toHaveJSProperty('complete', true);
  await expect.poll(() => inLog.first().evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  const pins = row.getByRole('link', { name: /^Dev Nair: .* at .*, in Google Maps$/ });
  await expect(pins).toHaveCount(2);
  await expect(pins.first()).toHaveAttribute('href', MAP);
  // The other punches are a click away, in the person's daily log.
  await row.getByRole('link', { name: /^All \d+ punches of Dev Nair$/ }).click();

  const punches = page.getByRole('table', { name: 'Punches' });
  await expect(punches.getByRole('img', { name: /^Lunch started photo at / })).toBeVisible();
  await expect(punches.getByRole('link', { name: /^Lunch started at .*, in Google Maps$/ })).toHaveAttribute('href', MAP);
  await expect(punches.getByText(SPOT).first()).toBeVisible();
  const photo = punches.getByRole('img', { name: /^Check-(in|out) photo at / }).last();
  await expect(photo).toBeVisible();
  const res = await page.request.get((await photo.getAttribute('src'))!);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toMatch(/^image\//);
});

test('the employee sees their own photos and locations under Attendance › Punches', async ({ page }) => {
  await signIn(page, 'demo.employee');
  await open(page, '/app/demo/attendance?tab=logs');
  const table = page.getByRole('table', { name: 'Your punches' });
  const photo = table.getByRole('img', { name: /^Lunch started photo at / }).first();
  await expect(photo).toBeVisible();
  await expect.poll(() => photo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await expect(table.getByRole('link', { name: /^Lunch started at .*, in Google Maps$/ }).first()).toHaveAttribute('href', MAP);
  await expect(table.getByText(SPOT).first()).toBeVisible();
});

for (const who of ['demo.manager', 'demo.payroll'] as const) {
  test(`${who} sees them in Attendance › Logs too`, async ({ page }) => {
    await signIn(page, who);
    await open(page, '/app/demo/attendance?tab=logs&view=daily&q=dev%20nair');
    const row = page.getByRole('row', { name: /Dev Nair/ });
    const photo = row.getByRole('img', { name: /^Dev Nair: .* photo at / }).first();
    await expect(photo).toBeVisible();
    await expect.poll(() => photo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    await expect(row.getByRole('link', { name: /^Dev Nair: .* at .*, in Google Maps$/ }).first()).toHaveAttribute('href', MAP);
  });
}

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

  // The phone reads a punch's photo through the app server, which checks who may see it.
  const photoOf = (auth: string | null, punch: string) => fetch(`${baseURL}/api/mobile/punch-photo?punch=${punch}`, { headers: auth ? { Authorization: `Bearer ${auth}` } : {} });
  const photo = await photoOf(token, id);
  expect(photo.status).toBe(200);
  expect(((await photo.json()) as { url: string }).url).toContain('attendance-selfies');
  expect((await photoOf(null, id)).status).toBe(401);
  expect((await photoOf(token, crypto.randomUUID())).status).toBe(404);

  expect((await send(null, JPEG)).status).toBe(401);
  const notPhoto = await send(token, Buffer.from('not a photo at all'));
  expect(notPhoto.status).toBe(400);
  expect(((await notPhoto.json()) as { message: string }).message).toBe('Take a photo (JPEG or PNG).');
});

test('HR asks the AI to check a photo; one that looks like a screen is flagged for review', async ({ page, baseURL }) => {
  const app = createClient(liveEnv().url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  const { data: session } = await app.auth.signInWithPassword({ email: `demo.employee@${domain}`, password: liveEnv().password });
  const form = new FormData();
  form.set('clientId', `mobile-${crypto.randomUUID()}`);
  form.set('orgId', orgId);
  form.set('punchedAt', new Date().toISOString());
  // A JPEG carrying the text SCREEN: the test AI provider reads it as a photo of a screen.
  const screen = Buffer.concat([JPEG.subarray(0, JPEG.length - 2), Buffer.from('SCREEN'), JPEG.subarray(JPEG.length - 2)]);
  form.set('selfie', new Blob([new Uint8Array(screen)], { type: 'image/jpeg' }), 'selfie.jpg');
  const sent = await fetch(`${baseURL}/api/mobile/punch`, { method: 'POST', body: form, headers: { Authorization: `Bearer ${session.session!.access_token}` } });
  expect(sent.status).toBe(200);
  const id = ((await sent.json()) as { id: string }).id;

  await signIn(page, 'demo.hr');
  await open(page, `/app/demo/employees/${devId}?tab=attendance&view=logs`);
  const check = page.getByRole('form', { name: /^Check photo with AI: / }).last();
  await check.getByRole('button', { name: 'Check photo with AI' }).click();
  await expect(page.getByText('May not be a live photo')).toBeVisible();
  await page.getByRole('form', { name: /^Flag photo: / }).getByRole('button', { name: 'Flag for review' }).click();
  await expect(page.getByText('Flagged for review under Attendance › Approvals.')).toBeVisible();
  const flags = (await admin.from('anomaly_flags').select('rule, explanation').eq('subject_id', id)).data ?? [];
  expect(flags).toContainEqual({ rule: 'photo_check', explanation: 'Check-in photo: This looks like a picture of a screen rather than a live photo.' });
});
