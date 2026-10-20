import { expect } from '@playwright/test';
import { adminClient, open, signIn, test } from './helpers';

/**
 * Timesheet on the demo tenant: HR adds Dev to the workspace, creates a client, a project with Dev as a member and a
 * task; Dev logs 1:30 today; HR approves it and invoices the client. Everything created is removed afterwards.
 */
test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36).slice(-5).toUpperCase();
const admin = adminClient();
let orgId = '';
let devId = '';
let devWasMember = false;

test.beforeAll(async () => {
  orgId = (await admin.from('organizations').select('id').eq('slug', 'demo').eq('is_demo', true).single()).data!.id;
  devId = (await admin.from('employees').select('id').eq('organization_id', orgId).eq('first_name', 'Dev').eq('last_name', 'Nair').single()).data!.id;
  devWasMember = !!(await admin.from('ts_members').select('employee_id').eq('employee_id', devId).maybeSingle()).data;
});

test.afterAll(async () => {
  const clients = (await admin.from('ts_clients').select('id').eq('organization_id', orgId).like('name', `%${run}%`)).data ?? [];
  const projects = (await admin.from('ts_projects').select('id').eq('organization_id', orgId).like('name', `%${run}%`)).data ?? [];
  const pids = projects.map((p) => p.id);
  if (pids.length) await admin.from('ts_entries').delete().in('project_id', pids);
  if (clients.length) await admin.from('ts_invoices').delete().in('client_id', clients.map((c) => c.id));
  if (pids.length) await admin.from('ts_projects').delete().in('id', pids);
  if (clients.length) await admin.from('ts_clients').delete().in('id', clients.map((c) => c.id));
  if (!devWasMember) await admin.from('ts_members').delete().eq('employee_id', devId);
});

test('HR sets up the workspace, the employee logs time, HR approves and invoices', async ({ page, browser }) => {
  await signIn(page, 'demo.hr');
  await open(page, '/app/demo/timesheet');
  await expect(page.getByRole('heading', { level: 1, name: 'Timesheet' })).toBeVisible();

  await open(page, '/app/demo/timesheet?tab=workspace&view=members');
  const add = page.getByRole('form', { name: 'Add from directory' });
  if (await add.getByText(/^Dev Nair/).count()) {
    await add.getByLabel(/^Dev Nair/).check();
    await add.getByLabel('Default rate / hour (₹)').fill('1500');
    await add.getByRole('button', { name: '＋ Add from directory' }).click();
    await expect(add.getByText('1 member added.')).toBeVisible();
  }

  await open(page, '/app/demo/timesheet?tab=workspace&view=clients');
  const client = page.getByRole('form', { name: 'Add client' });
  await client.locator('input[name="name"]').fill(`Acme ${run}`);
  await client.getByLabel('Client rate / hour').fill('2000');
  await client.getByRole('button', { name: '＋ Add client' }).click();
  await expect(client.getByText(`Acme ${run} added.`)).toBeVisible();

  await open(page, '/app/demo/timesheet?tab=workspace&view=projects');
  const project = page.getByRole('form', { name: 'Create project' });
  await project.locator('input[name="name"]').fill(`Nimbus ${run}`);
  await project.locator('select[name="clientId"]').selectOption({ label: `Acme ${run}` });
  await project.getByLabel('Dev Nair').check();
  await project.getByRole('button', { name: 'Create project' }).click();
  await expect(project.getByText(`Nimbus ${run} created.`)).toBeVisible();

  await open(page, '/app/demo/timesheet?tab=workspace&view=tasks');
  const task = page.getByRole('form', { name: 'Add task' });
  await task.locator('select[name="projectId"]').selectOption({ label: `Acme ${run} · Nimbus ${run}` });
  await task.locator('input[name="name"]').fill('Development');
  await task.getByRole('button', { name: '＋ Add task' }).click();
  await expect(task.getByText('Development added.')).toBeVisible();

  const dev = await (await browser.newContext()).newPage();
  await signIn(dev, 'demo.employee');
  await open(dev, '/app/demo/timesheet');
  const entry = dev.getByRole('form', { name: 'Add entry' });
  await entry.locator('select[name="projectId"]').selectOption({ label: `Acme ${run} · Nimbus ${run}` });
  await entry.getByRole('radio', { name: 'Total hours' }).click();
  await entry.locator('input[name="duration"]').fill('1:30');
  await entry.getByLabel('Description').fill(`Build ${run}`);
  await entry.getByRole('button', { name: 'Add entry' }).click();
  await expect(entry.getByText('Logged 1h 30m.')).toBeVisible();
  await expect(dev.getByRole('table', { name: 'Day’s logs' }).getByText(`Build ${run}`)).toBeVisible();
  await dev.context().close();

  await open(page, '/app/demo/timesheet?tab=approvals');
  const approvals = page.getByRole('form', { name: 'Approve time logs' });
  const row = approvals.getByRole('row').filter({ hasText: `Build ${run}` });
  await row.getByRole('checkbox').check();
  await approvals.getByRole('button', { name: '✓ Bulk approve' }).click();
  await expect(page.getByText('1 log approved.')).toBeVisible();

  await open(page, '/app/demo/timesheet?tab=finance');
  const inv = page.getByRole('form', { name: 'Generate invoice' });
  await inv.locator('select[name="clientId"]').selectOption({ label: `Acme ${run} (INR)` });
  await inv.getByRole('button', { name: '＋ Generate invoice' }).click();
  await expect(page.getByText('Invoice generated as a draft.')).toBeVisible();
  const invoices = page.getByRole('table', { name: 'Invoices' });
  const line = invoices.getByRole('row').filter({ hasText: `Acme ${run}` });
  await expect(line.getByText('₹3,000')).toBeVisible();
  await line.getByRole('link').first().click();
  await expect(page.getByRole('cell', { name: `Nimbus ${run}`, exact: true })).toBeVisible();
  await expect(page.getByText('1h 30m').first()).toBeVisible();
});
