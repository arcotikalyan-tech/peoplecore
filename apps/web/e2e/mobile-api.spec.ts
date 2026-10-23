import { expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { adminClient, domain, liveEnv, test } from './helpers';

/**
 * The phone app's payslip download (/api/mobile/payslip): Dev gets his own released payslip as a PDF with his sign-in
 * token; without one, nothing; a run that isn't his, not found. A locked April 2019 run for him is made for the test
 * and removed afterwards.
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

test('the phone app downloads the employee’s own payslip as a PDF', async ({ baseURL }) => {
  const app = createClient(liveEnv().url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  const { data } = await app.auth.signInWithPassword({ email: `demo.employee@${domain}`, password: liveEnv().password });
  const token = data.session!.access_token;
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
