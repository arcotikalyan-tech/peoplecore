import { expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { adminClient, domain, liveEnv, test } from './helpers';

/**
 * The phone app's payslip download (/api/mobile/payslip): Dev gets his own released payslip as a PDF with his sign-in
 * token; without one, nothing; a run that isn't his, not found. With a company logo, the PDF carries it. A locked April
 * 2019 run for him (and the logo) are made for the test and removed afterwards.
 */
test.describe.configure({ mode: 'serial' });

const admin = adminClient();
const MONTH = '2019-04-01';
let orgId = '';
let devId = '';
let runId = '';

test.beforeAll(async () => {
  orgId = (await admin.from('organizations').select('id').eq('slug', 'demo').eq('is_demo', true).single()).data!.id;
  devId = (await admin.from('employees').select('id').eq('organization_id', orgId).eq('first_name', 'Dev').eq('last_name', 'Nair').single()).data!.id;
  const ruleSet = (await admin.from('statutory_rule_sets').select('id').limit(1).single()).data!.id;
  runId = (await admin.from('payroll_runs').insert({ organization_id: orgId, period_month: MONTH, status: 'draft', rule_set_id: ruleSet }).select('id').single()).data!.id;
  await admin.from('payroll_run_employees').insert({
    organization_id: orgId, run_id: runId, employee_id: devId, period_month: MONTH, input: {}, payable_days: 30, lop_days: 0,
    gross: 50000, deductions: 5000, net: 45000, employer_cost: 52000, taxable: 50000, exceptions: [], has_blocking: false,
  });
  await admin.from('payroll_line_items').insert([
    { organization_id: orgId, run_id: runId, employee_id: devId, code: 'BASIC', name: 'Basic', kind: 'earning', amount: 50000 },
    { organization_id: orgId, run_id: runId, employee_id: devId, code: 'PF', name: 'Provident fund', kind: 'deduction', amount: 5000 },
  ]);
  await admin.from('payroll_runs').update({ status: 'locked', locked_at: new Date().toISOString() }).eq('id', runId);
});

test.afterAll(async () => {
  if (runId) await admin.rpc('purge_demo_payroll_run', { p_run: runId }); // a locked run; demo tenants only
});

async function employeeToken() {
  const app = createClient(liveEnv().url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  const { data } = await app.auth.signInWithPassword({ email: `demo.employee@${domain}`, password: liveEnv().password });
  return data.session!.access_token;
}

test('the phone app downloads the employee’s own payslip as a PDF', async ({ baseURL }) => {
  const token = await employeeToken();
  const get = (run: string, auth: string | null) =>
    fetch(`${baseURL}/api/mobile/payslip?org=${orgId}&run=${run}`, { headers: auth ? { Authorization: `Bearer ${auth}` } : {} });

  const ok = await get(runId, token);
  expect(ok.status).toBe(200);
  expect(ok.headers.get('content-type')).toBe('application/pdf');
  expect(ok.headers.get('content-disposition')).toMatch(/payslip-2019-04-/);
  expect(Buffer.from(await ok.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');

  expect((await get(runId, null)).status).toBe(401);
  expect((await get(crypto.randomUUID(), token)).status).toBe(404);
});

test('the payslip PDF carries the company logo, transparency and all', async ({ baseURL }) => {
  // A 2×2 RGBA PNG (one transparent pixel), as the company page would store it.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAF0lEQVR4nGPwd3v6X2THsv8MIAYDEAAAToUHZBnK2vMAAAAASUVORK5CYII=', 'base64');
  const path = `${orgId}/logo/${crypto.randomUUID()}`;
  const before = (await admin.from('company_profiles').select('logo_path').eq('organization_id', orgId).single()).data!.logo_path;
  expect((await admin.storage.from('profile-images').upload(path, png, { contentType: 'image/png' })).error).toBeNull();
  await admin.from('company_profiles').update({ logo_path: path }).eq('organization_id', orgId);
  try {
    const res = await fetch(`${baseURL}/api/mobile/payslip?org=${orgId}&run=${runId}`, { headers: { Authorization: `Bearer ${await employeeToken()}` } });
    expect(res.status).toBe(200);
    const pdf = Buffer.from(await res.arrayBuffer()).toString('latin1');
    expect(pdf).toMatch(/q [\d.]+ 0 0 [\d.]+ [\d.]+ [\d.]+ cm \/Im1 Do Q/);
    expect(pdf).toContain('/Width 2 /Height 2 /BitsPerComponent 8 /ColorSpace /DeviceRGB /Filter /FlateDecode /SMask');
  } finally {
    await admin.from('company_profiles').update({ logo_path: before }).eq('organization_id', orgId);
    await admin.storage.from('profile-images').remove([path]);
  }
});
