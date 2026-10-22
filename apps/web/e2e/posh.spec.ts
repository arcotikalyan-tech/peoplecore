import { expect } from '@playwright/test';
import { adminClient, open, signIn, test } from './helpers';

/**
 * POSH on the demo tenant: HR constitutes the Internal Committee (Meera presides; Farah and Rohan from the staff; an
 * external member) and records a workshop; Dev sees the committee and files a POSH complaint; Farah, on the committee
 * and signed in with two-step, records the first statutory step; Rohan, also on the committee, sees the case with his
 * password alone (two-step is off in the demo company); HR sees the year's figures. Everything made here is removed
 * afterwards.
 */
test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36).slice(-5).toUpperCase();
const admin = adminClient();
const startedAt = new Date().toISOString();
let orgId = '';
const ids: Record<string, string> = {};

test.beforeAll(async () => {
  orgId = (await admin.from('organizations').select('id').eq('slug', 'demo').eq('is_demo', true).single()).data!.id;
  for (const [key, first, last] of [['meera', 'Meera', 'Kulkarni'], ['farah', 'Farah', 'Qureshi'], ['rohan', 'Rohan', 'Iyer']] as const) {
    ids[key] = (await admin.from('employees').select('id').eq('organization_id', orgId).eq('first_name', first).eq('last_name', last).single()).data!.id;
  }
});

test.afterAll(async () => {
  const cases = (await admin.from('grievances').select('id').eq('organization_id', orgId).like('subject', `%${run}%`)).data ?? [];
  for (const c of cases) await admin.from('notifications').delete().eq('link', `/grievances/${c.id}`);
  await admin.from('grievances').delete().in('id', cases.map((c) => c.id));
  await admin.from('posh_committee_members').delete().eq('organization_id', orgId).gte('created_at', startedAt);
  await admin.from('posh_sessions').delete().eq('organization_id', orgId).like('title', `%${run}%`);
});

test('HR constitutes the committee; Dev complains; a committee member records the first step; HR sees the figures', async ({ page, browser }) => {
  await signIn(page, 'demo.hr');
  await open(page, '/app/demo/grievances');
  await page.getByRole('link', { name: 'POSH committee and annual report →' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'POSH' })).toBeVisible();

  const add = page.getByRole('form', { name: 'Add a committee member' });
  const register = page.getByRole('table', { name: 'Committee members' });
  for (const [role, key, name, woman] of [['presiding_officer', 'meera', 'Meera Kulkarni', 'yes'], ['member', 'farah', 'Farah Qureshi', 'yes'], ['member', 'rohan', 'Rohan Iyer', 'no']] as const) {
    await add.getByLabel('Role').selectOption(role);
    await add.getByLabel('Employee').selectOption(ids[key]!);
    await add.getByLabel('Woman').selectOption(woman);
    await add.getByRole('button', { name: 'Add to the committee' }).click();
    await expect(register.getByRole('row').filter({ hasText: name })).toBeVisible();
  }
  await add.getByLabel('Role').selectOption('external_member');
  await add.getByLabel('External member’s name').fill(`Asha Example ${run}`);
  await add.getByLabel('NGO or association').fill('Example Foundation');
  await add.getByLabel('Woman').selectOption('yes');
  await add.getByRole('button', { name: 'Add to the committee' }).click();
  await expect(register.getByText(`Asha Example ${run}`)).toBeVisible();
  await expect(page.getByText('The committee has the make-up the law asks for.')).toBeVisible();

  const session = page.getByRole('form', { name: 'Record a session' });
  await session.getByLabel('Title').fill(`POSH awareness ${run}`);
  await session.getByLabel('Attendees').fill('24');
  await session.getByRole('button', { name: 'Record session' }).click();
  await expect(page.getByRole('list', { name: 'Awareness sessions' }).getByText(`POSH awareness ${run}`)).toBeVisible();

  const dev = await (await browser.newContext()).newPage();
  await signIn(dev, 'demo.employee');
  await open(dev, '/app/demo/grievances');
  const committee = dev.getByRole('list', { name: 'Internal Committee' });
  await expect(committee.getByText('Meera Kulkarni')).toBeVisible();
  await expect(committee.getByText(`Asha Example ${run}`)).toBeVisible();
  const raise = dev.getByRole('form', { name: 'Raise a concern' });
  await raise.getByLabel('What is it about?').selectOption('posh');
  await raise.getByLabel('Title').fill(`Remarks ${run}`);
  await raise.getByLabel('What happened?').fill('Repeated remarks about my appearance in the team channel, in front of others.');
  await raise.getByRole('button', { name: 'Submit in confidence' }).click();
  await dev.waitForURL(/\/grievances\/[0-9a-f-]{36}$/);
  await expect(dev.getByRole('list', { name: 'POSH timeline' })).toHaveCount(0); // the steps are for the committee

  const farah = await (await browser.newContext()).newPage();
  await signIn(farah, 'demo.payroll');
  await open(farah, '/app/demo/grievances');
  await farah.getByRole('table', { name: 'Cases' }).getByRole('link', { name: `Remarks ${run}` }).click();
  const timeline = farah.getByRole('list', { name: 'POSH timeline' });
  const notice = timeline.getByRole('listitem').filter({ hasText: 'Copy of the complaint to the respondent' });
  await expect(notice.getByText(/^Due /)).toBeVisible();
  await notice.getByRole('button', { name: 'Record' }).click();
  await expect(notice.getByText(/^Done /)).toBeVisible();

  const rohan = await (await browser.newContext()).newPage();
  await signIn(rohan, 'demo.manager');
  await open(rohan, '/app/demo/grievances');
  await expect(rohan.getByText('POSH cases open in a two-step session')).toHaveCount(0);
  await expect(rohan.getByRole('table', { name: 'Cases' }).getByRole('link', { name: `Remarks ${run}` })).toBeVisible();

  await open(page, '/app/demo/grievances/posh');
  const received = page.locator('div').filter({ has: page.getByText('Complaints received', { exact: true }) }).locator('dd').first();
  await expect(received).not.toHaveText('0');
});
