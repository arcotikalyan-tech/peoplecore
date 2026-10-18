import { expect, type Page } from '@playwright/test';
import { adminClient, domain, expectNotFound, open, signIn, test } from './helpers';

/**
 * The hire journey on the live demo tenant: requisition → published on the careers page (an anonymous visitor
 * applies) → candidate → interview with a scorecard → offer approved by someone else → accepted → employee
 * (pre-joining), with one employee per hire, candidate deduplication, consent, erasure and scoped visibility.
 * Everything created here carries the run id and is deleted afterwards (audit entries stay, by design).
 */
test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36).slice(-5).toUpperCase();
const title = `E2E Engineer ${run}`;
const candidateEmail = `e2e.cand.${run.toLowerCase()}@${domain}`;
const admin = adminClient();
const startedAt = new Date().toISOString();
let orgId = '';
let managerLabel = '';
let requisitionUrl = '';

const istDate = (offsetDays: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(Date.now() + offsetDays * 86_400_000));
const joiningDate = istDate(30);
/** One hour ago, as a datetime-local value in the organization's zone (IST). */
const anHourAgo = (() => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(Date.now() - 3600_000)).map((x) => [x.type, x.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
})();
const addForm = (page: Page) => page.getByRole('form', { name: 'Add candidate' });

async function addCandidate(page: Page, first: string, email: string, consent: boolean) {
  const form = addForm(page);
  await form.getByLabel('First name').fill(first);
  await form.getByLabel('Last name').fill(`Test${run}`);
  await form.getByLabel('Email').fill(email);
  await form.getByLabel('Source').selectOption('referral');
  if (consent) await form.getByRole('checkbox', { name: /agreed to us storing/ }).check();
  await form.getByRole('button', { name: 'Add candidate' }).click();
}

test.beforeAll(async () => {
  orgId = (await admin.from('organizations').select('id').eq('slug', 'demo').eq('is_demo', true).single()).data!.id;
  const rohan = (await admin.from('employees').select('employee_code').eq('organization_id', orgId).eq('first_name', 'Rohan').eq('last_name', 'Iyer').single()).data!;
  managerLabel = `Rohan Iyer (${rohan.employee_code})`;
});

test.afterAll(async () => {
  await admin.from('approval_requests').delete().eq('organization_id', orgId).eq('subject_type', 'offer').like('summary', `%${run}%`);
  await admin.from('tasks').delete().eq('organization_id', orgId).eq('subject_type', 'interview').like('title', `%${run}%`);
  await admin.from('notifications').delete().eq('organization_id', orgId).gte('created_at', startedAt).or('kind.like.approval.%,kind.eq.interview.scheduled');
  const reqs = (await admin.from('job_requisitions').select('id').eq('organization_id', orgId).like('title', `%${run}`)).data ?? [];
  const apps = reqs.length ? (await admin.from('applications').select('id, candidate_id, converted_employee_id').in('requisition_id', reqs.map((r) => r.id))).data ?? [] : [];
  if (apps.length) await admin.from('applications').delete().in('id', apps.map((a) => a.id));
  await admin.from('candidates').delete().eq('organization_id', orgId).like('last_name', `%${run}`);
  if (reqs.length) await admin.from('job_requisitions').delete().in('id', reqs.map((r) => r.id));
  const hired = apps.map((a) => a.converted_employee_id).filter((x): x is string => !!x);
  if (hired.length) await admin.from('employees').delete().in('id', hired);
});

test('HR opens a requisition with a hiring manager', async ({ page }) => {
  await signIn(page, 'demo.hr');
  await open(page, '/app/demo/recruitment');
  const form = page.getByRole('form', { name: 'New requisition' });
  await form.getByLabel('Job title').fill(title);
  await form.getByLabel('Department').selectOption({ label: 'Engineering (ENG)' });
  await form.getByLabel('Hiring manager').selectOption({ label: managerLabel });
  await form.getByRole('button', { name: 'Create requisition' }).click();
  await page.waitForURL(/\/app\/demo\/recruitment\/[0-9a-f-]{36}$/);
  requisitionUrl = new URL(page.url()).pathname;
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  await expect(page.getByText(/^REQ\d{5} · Permanent · 1 opening$/)).toBeVisible();
});

test('candidates need consent, are not duplicated, and can be erased', async ({ page }) => {
  await signIn(page, 'demo.hr');
  await open(page, requisitionUrl);

  await addCandidate(page, 'Kavya', candidateEmail, false);
  await expect(addForm(page).getByText('The candidate must agree before their details are stored')).toBeVisible();
  await addCandidate(page, 'Kavya', candidateEmail, true);
  await expect(page.getByText('Kavya added to the pipeline.')).toBeVisible();
  await addCandidate(page, 'Kavya', candidateEmail.toUpperCase(), true);
  await expect(page.getByText('This candidate has already applied for this requisition.')).toBeVisible();
  expect((await admin.from('candidates').select('id').eq('organization_id', orgId).ilike('email', candidateEmail)).data).toHaveLength(1);

  const eraseEmail = `e2e.erase.${run.toLowerCase()}@${domain}`;
  await addCandidate(page, 'Esha', eraseEmail, true);
  await expect(page.getByText('Esha added to the pipeline.')).toBeVisible();
  // The erase form sits in a collapsed <details>; open it from Esha's card first (hidden forms have no role).
  await page.getByRole('listitem').filter({ hasText: `Esha Test${run}` }).getByText('Erase candidate').click();
  const erase = page.getByRole('form', { name: `Erase Esha Test${run}` });
  await erase.getByRole('checkbox').check();
  await erase.getByRole('button', { name: 'Erase permanently' }).click();
  await expect(page.getByText(`Esha Test${run}`)).toHaveCount(0);
  expect((await admin.from('candidates').select('id').eq('organization_id', orgId).eq('email', eraseEmail)).data).toEqual([]);
});

test('HR sets how long candidate records are kept and sees who is due for erasure', async ({ page }) => {
  await signIn(page, 'demo.hr');
  await open(page, '/app/demo/recruitment');
  const form = page.getByRole('form', { name: 'Candidate retention' });
  const days = form.getByLabel('Days after a candidate’s last activity');
  const current = await days.inputValue();
  await days.fill('10');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form.getByText('At least 30 days')).toBeVisible();
  await days.fill(current); // leave the demo tenant's setting as it was
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form.getByText('Saved.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Due for erasure in the next 30 days' })).toBeVisible();
});

test('HR publishes the requisition; an anonymous visitor applies on the careers page', async ({ page, browser }) => {
  await signIn(page, 'demo.hr');
  await open(page, requisitionUrl);
  await page.getByRole('button', { name: 'Publish on careers page' }).click();
  await expect(page.getByText('Published on the careers page.')).toBeVisible();

  const visitor = await (await browser.newContext()).newPage(); // not signed in
  await visitor.goto('/careers/demo');
  await visitor.getByRole('link', { name: new RegExp(title) }).click();
  await expect(visitor.getByRole('heading', { level: 1, name: title })).toBeVisible();
  const form = visitor.getByRole('form', { name: 'Apply' });
  await form.getByLabel('First name').fill('Ravi');
  await form.getByLabel('Last name').fill(`Applicant${run}`);
  await form.getByLabel('Email').fill(`e2e.careers.${run.toLowerCase()}@${domain}`);
  await form.getByRole('button', { name: 'Apply' }).click();
  await expect(form.getByText('Please agree to the processing of your details to apply')).toBeVisible();
  await form.getByRole('checkbox').check();
  await form.getByRole('button', { name: 'Apply' }).click();
  await expect(visitor.getByText('Thank you. We have received your application and will be in touch.')).toBeVisible();

  await open(page, requisitionUrl);
  await expect(page.getByRole('list', { name: 'Applied' }).getByText(`Ravi Applicant${run}`)).toBeVisible();
  await expect(page.getByRole('list', { name: 'Applied' }).getByText(/Careers site/).first()).toBeVisible();
});

test('HR schedules an interview; the hiring manager submits a scorecard', async ({ browser }) => {
  const hr = await (await browser.newContext()).newPage();
  await signIn(hr, 'demo.hr');
  await open(hr, requisitionUrl);
  const name = `Kavya Test${run}`;
  await hr.getByRole('listitem').filter({ hasText: name }).getByText('Schedule an interview').click();
  const sched = hr.getByRole('form', { name: `Schedule interview for ${name}` });
  await sched.getByLabel('Round').fill(`Technical ${run}`);
  await sched.getByLabel('When').fill(anHourAgo);
  await sched.getByRole('checkbox', { name: /Rohan Iyer/ }).check();
  await sched.getByRole('button', { name: 'Schedule' }).click();
  // The candidate moves to the Interview stage (the card re-renders there) with the interview listed.
  await expect(hr.getByRole('list', { name: 'Interview' }).getByText(new RegExp(`Technical ${run}`))).toBeVisible();

  const manager = await (await browser.newContext()).newPage();
  await signIn(manager, 'demo.manager');
  await open(manager, '/app/demo/inbox');
  await manager.getByRole('link', { name: new RegExp(`Interview ${name}`) }).click();
  const card = manager.getByRole('form', { name: new RegExp(`^Scorecard: ${name}`) });
  for (const label of ['Role skills', 'Problem solving', 'Communication', 'Values and teamwork']) await card.getByLabel(label).selectOption('4');
  await card.getByLabel('Recommendation').selectOption('yes');
  await card.getByLabel('Summary').fill('Clear thinking, good fundamentals.');
  await card.getByRole('button', { name: 'Submit scorecard' }).click();
  await expect(manager.getByText('Scorecard submitted', { exact: true })).toBeVisible(); // the form is replaced by the badge

  await open(hr, requisitionUrl);
  await expect(hr.getByText(/Technical .* Rohan Iyer \(Yes\)/)).toBeVisible();
});

test('HR makes an offer, the owner approves it, the candidate accepts, and HR hires: one pre-joining employee', async ({ browser }) => {
  const hr = await (await browser.newContext()).newPage();
  await signIn(hr, 'demo.hr');
  await open(hr, requisitionUrl);
  const name = `Kavya Test${run}`;
  await hr.getByRole('listitem').filter({ hasText: name }).getByText('Make an offer').click();
  const offer = hr.getByRole('form', { name: `Offer form for ${name}` });
  await offer.getByLabel('Annual CTC (₹)').fill('1800000');
  await offer.getByLabel('Joining date').fill(joiningDate);
  await offer.getByLabel('Offer valid until').fill(istDate(7));
  await offer.getByRole('button', { name: 'Save offer' }).click();
  // The candidate moves to the Offer stage, where their card now shows the draft offer.
  const offerPanel = hr.getByRole('list', { name: 'Offer' }).getByLabel(`Offer for ${name}`);
  await expect(offerPanel.getByText('Draft')).toBeVisible();
  await expect(offerPanel.getByText(/₹18,00,000 a year/)).toBeVisible();
  await hr.getByRole('button', { name: `Submit for approval: ${name}` }).click();
  await expect(hr.getByText('Sent for approval.')).toBeVisible();

  const owner = await (await browser.newContext()).newPage();
  await signIn(owner, 'demo.owner');
  await open(owner, '/app/demo/inbox');
  await owner.getByRole('form', { name: new RegExp(`^Decide: Offer for ${name}`) }).getByRole('button', { name: 'Approve' }).click();
  await expect(owner.getByRole('status').filter({ hasText: 'Approved.' })).toBeVisible();

  await open(hr, requisitionUrl);
  await hr.getByRole('button', { name: `Mark as sent: ${name}` }).click();
  await expect(hr.getByText('Marked as sent.')).toBeVisible();
  await open(hr, requisitionUrl);
  await hr.getByRole('button', { name: `Candidate accepted: ${name}` }).click();
  await expect(hr.getByText('Acceptance recorded. You can hire now.')).toBeVisible();

  await open(hr, requisitionUrl);
  const hire = hr.getByRole('form', { name: `Hire ${name}` });
  await expect(hire.getByLabel('Date of joining')).toHaveValue(joiningDate);
  await hire.getByLabel('Work email').fill(`e2e.hire.${run.toLowerCase()}@${domain}`);
  await hire.getByRole('button', { name: 'Hire and create employee' }).click();
  await hr.waitForURL(/\/app\/demo\/employees\/[0-9a-f-]{36}\?created=1$/);
  await expect(hr.getByRole('heading', { level: 1, name })).toBeVisible();
  await expect(hr.getByText('Pre-joining')).toBeVisible();

  const req = (await admin.from('job_requisitions').select('id, status').eq('organization_id', orgId).eq('title', title).single()).data!;
  expect(req.status).toBe('closed');
  const hiredApps = (await admin.from('applications').select('stage, converted_employee_id').eq('requisition_id', req.id).eq('stage', 'hired')).data!;
  expect(hiredApps).toHaveLength(1);
  const employees = (await admin.from('employees').select('id, status, date_of_joining').eq('organization_id', orgId).eq('last_name', `Test${run}`)).data!;
  expect(employees).toEqual([{ id: hiredApps[0]!.converted_employee_id, status: 'pre_joining', date_of_joining: joiningDate }]);
});

test('the hiring manager sees the requisition read-only; employees see no recruitment', async ({ browser }) => {
  const manager = await (await browser.newContext()).newPage();
  await signIn(manager, 'demo.manager');
  await open(manager, '/app/demo/recruitment');
  await manager.getByRole('link', { name: title }).click();
  await expect(manager.getByRole('list', { name: 'Hired' }).getByText(`Kavya Test${run}`)).toBeVisible();
  await expect(manager.getByRole('form', { name: 'Add candidate' })).toHaveCount(0);
  await expect(manager.getByRole('form', { name: 'New requisition' })).toHaveCount(0);
  await expect(manager.getByRole('form', { name: 'Candidate retention' })).toHaveCount(0);

  const employee = await (await browser.newContext()).newPage();
  await signIn(employee, 'demo.employee');
  await open(employee, '/app/demo');
  await expect(employee.getByRole('link', { name: 'Recruitment' })).toHaveCount(0);
  await open(employee, requisitionUrl);
  await expectNotFound(employee);
});
