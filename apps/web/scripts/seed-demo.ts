/**
 * Seeds a clearly-marked DEMO tenant (slug "demo") with synthetic people into a PeopleCore Supabase project.
 *
 *   corepack pnpm --filter @peoplecore/web seed:demo --yes [--platform-admin] [--reset] [--allow-short-password]
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY and DEMO_USER_PASSWORD from apps/web/.env.local or
 * the shell. Every name is fictional; every email is on DEMO_EMAIL_DOMAIN (default example.test, a
 * reserved TLD). The password is supplied by you and is never generated or printed.
 *
 * Accounts are created first; if anything fails after the tenant is created, the tenant is deleted
 * again so a re-run starts clean. --reset deletes an existing "demo" tenant, but only if it is
 * marked is_demo.
 */
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@peoplecore/db/types';
import { ensureDemoMfa } from './lib/demo-mfa.ts';

type RoleKey = 'owner' | 'hr_admin' | 'payroll_admin' | 'manager' | 'employee';
type EmploymentType = Database['public']['Enums']['employment_type'];

class SeedError extends Error {}

function fail(message: string): never {
  throw new SeedError(message);
}

const args = new Set(process.argv.slice(2));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const password = process.env.DEMO_USER_PASSWORD;
const domain = process.env.DEMO_EMAIL_DOMAIN ?? 'example.test';

// Helpers take the whole awaited response type R and read R['data'] from it. (Inferring a row type
// parameter from Supabase's success|failure response union collapses it to `null`.)
type Response = { data: unknown; error: { message: string } | null };

/** Query that may legitimately return no row. */
function maybe<R extends Response>(result: R, what: string): R['data'] {
  if (result.error) fail(`${what}: ${result.error.message}`);
  return result.data;
}

/** Query that must return data. */
function must<R extends Response>(result: R, what: string): NonNullable<R['data']> {
  const data = maybe(result, what);
  if (data === null || data === undefined) fail(`${what}: no data returned`);
  return data as NonNullable<R['data']>;
}

/** Write without a returned row. */
function exec(result: { error: { message: string } | null }, what: string): void {
  if (result.error) fail(`${what}: ${result.error.message}`);
}

const isoDaysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

let createdOrgId: string | null = null;

async function main() {
  if (!url || !secretKey) fail('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (see .env.example).');
  if (!password) fail('Set DEMO_USER_PASSWORD for the demo sign-in accounts.');
  if (password.length < 12 && !args.has('--allow-short-password')) {
    fail('DEMO_USER_PASSWORD should be 12+ characters (pass --allow-short-password to accept a shorter one).');
  }
  if (!args.has('--yes')) fail(`This creates a demo tenant in ${url}. Re-run with --yes to continue.`);

  const db = createClient<Database>(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });

  /** Creates the account, or finds it and resets its password, so DEMO_USER_PASSWORD always works. */
  async function ensureUser(local: string): Promise<{ id: string; email: string }> {
    const email = `${local}@${domain}`;
    const created = await db.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.data.user) return { id: created.data.user.id, email };
    for (let page = 1; page <= 20; page++) {
      const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) fail(`list users: ${error.message}`);
      const hit = data.users.find((u) => u.email === email);
      if (hit) {
        const { error: updateError } = await db.auth.admin.updateUserById(hit.id, { password });
        if (updateError) fail(`update password for ${email}: ${updateError.message}`);
        return { id: hit.id, email };
      }
      if (data.users.length < 1000) break;
    }
    fail(`could not create or find ${email}: ${created.error?.message ?? 'unknown error'}`);
  }

  // ─── Accounts first: nothing tenant-side exists yet if this fails ─────────

  const accounts = {
    owner: await ensureUser('demo.owner'),
    hr: await ensureUser('demo.hr'),
    payroll: await ensureUser('demo.payroll'),
    manager: await ensureUser('demo.manager'),
    employee: await ensureUser('demo.employee'),
  };
  const platform = args.has('--platform-admin') ? await ensureUser('demo.platform') : null;

  // ─── Tenant & structure ───────────────────────────────────────────────────

  const existing = maybe(await db.from('organizations').select('id, is_demo').eq('slug', 'demo').maybeSingle(), 'check for demo tenant');
  if (existing) {
    if (!existing.is_demo) fail('A tenant with slug "demo" exists and is NOT marked as demo. Refusing to touch it.');
    if (!args.has('--reset')) fail('A demo tenant already exists. Re-run with --reset to delete and recreate it.');
    const failed = await deleteDemoTenant(db, existing.id);
    if (failed) fail(`delete existing demo tenant: ${failed}`);
    console.log('✓ deleted the previous demo tenant');
  }

  const org = must(
    await db.from('organizations').insert({ name: 'PeopleCore Demo (synthetic data)', slug: 'demo', is_demo: true }).select('id').single(),
    'create organization',
  );
  const orgId = org.id;
  createdOrgId = orgId;

  const entity = must(
    await db.from('legal_entities').insert({ organization_id: orgId, name: 'Demo Technologies Pvt Ltd (synthetic)' }).select('id').single(),
    'create legal entity',
  );

  const locations = must(
    await db.from('locations').insert([
      { organization_id: orgId, code: 'BLR', name: 'Bengaluru office', city: 'Bengaluru', state_code: 'KA', latitude: 12.9716, longitude: 77.5946 },
      { organization_id: orgId, code: 'PUN', name: 'Pune office', city: 'Pune', state_code: 'MH', latitude: 18.5204, longitude: 73.8567 },
      { organization_id: orgId, code: 'REMOTE', name: 'Remote', state_code: null },
    ]).select('id, code'),
    'create locations',
  );
  const locationId = (code: string) => locations.find((l) => l.code === code)!.id;

  const departments = must(
    await db.from('departments').insert([
      { organization_id: orgId, code: 'LEAD', name: 'Leadership' },
      { organization_id: orgId, code: 'ENG', name: 'Engineering' },
      { organization_id: orgId, code: 'HR', name: 'People & HR' },
      { organization_id: orgId, code: 'FIN', name: 'Finance' },
      { organization_id: orgId, code: 'SALES', name: 'Sales' },
      { organization_id: orgId, code: 'OPS', name: 'Operations' },
    ]).select('id, code'),
    'create departments',
  );
  const deptId = (code: string) => departments.find((d) => d.code === code)!.id;

  const designationSpecs = [
    ['Chief Executive Officer', 10], ['Engineering Manager', 7], ['Senior Software Engineer', 5], ['Software Engineer', 4],
    ['HR Manager', 6], ['HR Executive', 3], ['Finance Manager', 6], ['Payroll Executive', 3],
    ['Sales Manager', 6], ['Sales Executive', 3], ['Operations Associate', 2],
  ] as const;
  const designations = must(
    await db.from('designations').insert(designationSpecs.map(([title, level]) => ({ organization_id: orgId, title, level }))).select('id, title'),
    'create designations',
  );
  const desigId = (title: string) => designations.find((d) => d.title === title)!.id;

  // ─── People ───────────────────────────────────────────────────────────────

  let seq = 0;
  interface Spec {
    first: string;
    last: string;
    dept: string;
    title: string;
    loc: string;
    managerId: string | null;
    joinedDaysAgo: number;
    type?: EmploymentType;
    userId?: string;
    probationMonths?: number;
  }

  async function addEmployee(s: Spec): Promise<string> {
    seq += 1;
    const doj = isoDaysAgo(s.joinedDaysAgo);
    const probationEnd = s.probationMonths ? isoDaysAgo(s.joinedDaysAgo - s.probationMonths * 30) : null;
    const row = must(
      await db.from('employees').insert({
        organization_id: orgId,
        employee_code: `DEMO-${String(seq).padStart(4, '0')}`,
        first_name: s.first,
        last_name: s.last,
        work_email: `${s.first}.${s.last}.${seq}@${domain}`.toLowerCase(),
        status: s.joinedDaysAgo < 0 ? 'pre_joining' : 'active',
        employment_type: s.type ?? 'permanent',
        date_of_joining: doj,
        probation_end_date: probationEnd,
        department_id: deptId(s.dept),
        designation_id: desigId(s.title),
        location_id: locationId(s.loc),
        legal_entity_id: entity.id,
        manager_employee_id: s.managerId,
        user_id: s.userId ?? null,
      }).select('id').single(),
      `create employee ${s.first} ${s.last}`,
    );
    exec(
      await db.from('employment_records').insert({
        organization_id: orgId,
        employee_id: row.id,
        effective_from: doj,
        department_id: deptId(s.dept),
        designation_id: desigId(s.title),
        location_id: locationId(s.loc),
        manager_employee_id: s.managerId,
        employment_type: s.type ?? 'permanent',
        change_reason: 'joining',
      }),
      'create joining record',
    );
    return row.id;
  }

  const ceo = await addEmployee({ first: 'Asha', last: 'Varma', dept: 'LEAD', title: 'Chief Executive Officer', loc: 'BLR', managerId: null, joinedDaysAgo: 1400, userId: accounts.owner.id });
  const hrHead = await addEmployee({ first: 'Kiran', last: 'Menon', dept: 'HR', title: 'HR Manager', loc: 'BLR', managerId: ceo, joinedDaysAgo: 1100, userId: accounts.hr.id });
  const finHead = await addEmployee({ first: 'Farah', last: 'Qureshi', dept: 'FIN', title: 'Finance Manager', loc: 'PUN', managerId: ceo, joinedDaysAgo: 1000, userId: accounts.payroll.id });
  const engHead = await addEmployee({ first: 'Rohan', last: 'Iyer', dept: 'ENG', title: 'Engineering Manager', loc: 'BLR', managerId: ceo, joinedDaysAgo: 900, userId: accounts.manager.id });
  const salesHead = await addEmployee({ first: 'Meera', last: 'Kulkarni', dept: 'SALES', title: 'Sales Manager', loc: 'PUN', managerId: ceo, joinedDaysAgo: 800 });
  const dev = await addEmployee({ first: 'Dev', last: 'Nair', dept: 'ENG', title: 'Software Engineer', loc: 'BLR', managerId: engHead, joinedDaysAgo: 400, userId: accounts.employee.id });

  const firsts = ['Aarav', 'Diya', 'Kabir', 'Ananya', 'Vihaan', 'Isha', 'Arjun', 'Saanvi', 'Kavya', 'Aditya', 'Nisha', 'Kunal', 'Riya', 'Siddharth', 'Tara', 'Yash', 'Zoya', 'Neel', 'Pooja', 'Varun'];
  const lasts = ['Sharma', 'Reddy', 'Das', 'Patel', 'Gupta', 'Singh', 'Joshi', 'Fernandes', 'Bose', 'Rao'];
  const teams: Array<{ dept: string; title: string; managerId: string; loc: string }> = [
    { dept: 'ENG', title: 'Senior Software Engineer', managerId: engHead, loc: 'BLR' },
    { dept: 'ENG', title: 'Software Engineer', managerId: engHead, loc: 'REMOTE' },
    { dept: 'SALES', title: 'Sales Executive', managerId: salesHead, loc: 'PUN' },
    { dept: 'HR', title: 'HR Executive', managerId: hrHead, loc: 'BLR' },
    { dept: 'FIN', title: 'Payroll Executive', managerId: finHead, loc: 'PUN' },
    { dept: 'OPS', title: 'Operations Associate', managerId: ceo, loc: 'BLR' },
  ];
  for (let i = 0; i < firsts.length; i++) {
    const team = teams[i % teams.length]!;
    // A few future joiners (pre-joining), a few with probation ending soon, one intern, one contractor.
    const joinedDaysAgo = i % 9 === 0 ? -14 - i : i % 5 === 0 ? 165 : 120 + i * 37;
    await addEmployee({
      first: firsts[i]!, last: lasts[i % lasts.length]!, ...team, joinedDaysAgo,
      probationMonths: joinedDaysAgo < 200 ? 6 : undefined,
      type: i === 7 ? 'intern' : i === 11 ? 'contract' : 'permanent',
    });
  }

  // ─── Access ───────────────────────────────────────────────────────────────

  const roles = must(await db.from('roles').select('id, key').eq('organization_id', orgId), 'load roles');
  async function grant(userId: string, roleKeys: RoleKey[]) {
    const member = must(
      await db.from('organization_members').insert({ organization_id: orgId, user_id: userId, status: 'active' }).select('id').single(),
      'create membership',
    );
    exec(
      await db.from('member_roles').insert(roleKeys.map((k) => ({ organization_id: orgId, member_id: member.id, role_id: roles.find((r) => r.key === k)!.id }))),
      'assign roles',
    );
  }
  await grant(accounts.owner.id, ['owner', 'employee']);
  await grant(accounts.hr.id, ['hr_admin', 'employee']);
  await grant(accounts.payroll.id, ['payroll_admin', 'employee']);
  await grant(accounts.manager.id, ['manager', 'employee']);
  await grant(accounts.employee.id, ['employee']);

  if (platform) {
    exec(await db.from('platform_admins').upsert({ user_id: platform.id }), 'grant platform admin');
  }

  // ─── Engagement and self-service content ────────────────────────────────────

  exec(await db.from('announcements').insert({
    organization_id: orgId, title: 'Welcome to PeopleCore',
    body: 'Leave, attendance, payslips, expenses and reviews now live in one place. Questions? Raise a ticket in the Helpdesk.',
  }), 'add the welcome announcement');
  exec(await db.from('kb_articles').insert([
    { organization_id: orgId, category: 'Payroll', published: true, title: 'When do payslips appear?',
      body: 'Payslips appear under Payslips once that month’s payroll run is locked, usually on the last working day. Reimbursements approved before the run are paid with it.' },
    { organization_id: orgId, category: 'Leave', published: true, title: 'How to apply for leave',
      body: 'Open Leave, choose the type and dates, and submit. Your manager approves it in their Inbox. Holidays and weekly offs are not counted.' },
    { organization_id: orgId, category: 'Attendance', published: true, title: 'Fixing a missed punch',
      body: 'If you forgot to check in or out, open Attendance and request a regularization for that day. Your manager approves it.' },
  ]), 'add knowledge-base articles');

  // Assets and system access: Dev holds a laptop (receipt confirmed) and has email and GitHub accounts; Rohan owns GitHub.
  exec(await db.from('id_card_designs').insert({
    organization_id: orgId, name: 'Standard card', template: 'classic', is_default: true, back_text: 'If found, please return to PeopleCore Demo reception.',
  }), 'add the ID card design');
  exec(await db.from('asset_categories').insert([
    { organization_id: orgId, name: 'Laptop', icon: '💻', useful_life_months: 36 },
    { organization_id: orgId, name: 'Monitor', icon: '🖥', useful_life_months: 60 },
    { organization_id: orgId, name: 'Phone', icon: '📱', useful_life_months: 24 },
    { organization_id: orgId, name: 'Headset', icon: '🎧', useful_life_months: 24 },
    { organization_id: orgId, name: 'Access card', icon: '🪪', requestable: false },
  ], { defaultToNull: false }), 'add asset categories'); // the others get the column default (requestable), not null
  const assets = must(await db.from('assets').insert([
    { organization_id: orgId, tag: 'AST-0001', name: 'ThinkPad T14 Gen 4', category: 'Laptop', serial_number: 'DEMO-LT-0001', location_id: locationId('BLR'),
      purchased_on: isoDaysAgo(400), purchase_cost: 98000, warranty_until: isoDaysAgo(-330) },
    { organization_id: orgId, tag: 'AST-0002', name: 'MacBook Air M3', category: 'Laptop', serial_number: 'DEMO-LT-0002', location_id: locationId('BLR'),
      purchased_on: isoDaysAgo(60), purchase_cost: 114900, warranty_until: isoDaysAgo(-305) },
    { organization_id: orgId, tag: 'AST-0003', name: 'Dell 27" monitor', category: 'Monitor', serial_number: 'DEMO-MN-0003', location_id: locationId('PUN') },
    { organization_id: orgId, tag: 'AST-0004', name: 'Pixel 8', category: 'Phone', serial_number: 'DEMO-PH-0004', status: 'in_repair', notes: 'Screen replacement under warranty.' },
  ], { defaultToNull: false }).select('id, tag'), 'add assets'); // rows without a status get the column default, not null
  const laptop = assets.find((a) => a.tag === 'AST-0001')!.id;
  exec(await db.from('asset_assignments').insert({
    organization_id: orgId, asset_id: laptop, employee_id: dev, condition_out: 'New, with charger', acknowledged_at: new Date().toISOString(),
  }), 'issue the demo laptop');
  exec(await db.from('assets').update({ status: 'assigned' }).eq('id', laptop), 'mark the demo laptop issued');
  const systems = must(await db.from('access_systems').insert([
    { organization_id: orgId, name: 'Google Workspace' },
    { organization_id: orgId, name: 'GitHub', owner_employee_id: engHead },
    { organization_id: orgId, name: 'VPN' },
  ]).select('id, name'), 'add access systems');
  const system = (name: string) => systems.find((x) => x.name === name)!.id;
  exec(await db.from('access_grants').insert([
    { organization_id: orgId, employee_id: dev, system_id: system('Google Workspace'), account: accounts.employee.email },
    { organization_id: orgId, employee_id: dev, system_id: system('GitHub'), account: 'dev-nair-demo', access_level: 'Member' },
  ]), 'record demo system access');

  createdOrgId = null; // success: keep the tenant

  // Owner, HR, payroll and platform roles require two-step sign-in; enroll the demo accounts' authenticators.
  const mfaEmails = [accounts.owner.email, accounts.hr.email, accounts.payroll.email, ...(platform ? [platform.email] : [])];
  if (publishableKey) {
    await ensureDemoMfa({ url: url!, publishableKey, secretKey: secretKey!, password: password! }, mfaEmails);
    console.log('✓ two-step verification set up for the demo admin accounts (codes: demo:totp <account>)');
  } else {
    console.warn('! NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY not set: run demo:mfa to set up two-step verification');
  }
  console.log(`✓ Demo tenant created: /app/demo (${seq} synthetic employees)`);
  for (const [role, a] of Object.entries(accounts)) console.log(`  ${role.padEnd(9)} ${a.email}`);
  if (platform) console.log(`  platform  ${platform.email} (platform admin, not a tenant member)`);
  console.log('  Password: the DEMO_USER_PASSWORD you supplied.');
}


/**
 * Deletes a demo tenant (and only a demo tenant). Employment history goes first: its keys to locations and
 * departments are checked during the organization's cascade and would otherwise refuse it.
 */
async function deleteDemoTenant(db: ReturnType<typeof createClient<Database>>, id: string): Promise<string | null> {
  const { data: org, error: lookup } = await db.from('organizations').select('id').eq('id', id).eq('is_demo', true).maybeSingle();
  if (lookup) return lookup.message;
  if (!org) return 'not a demo tenant';
  const history = await db.from('employment_records').delete().eq('organization_id', id);
  if (history.error) return history.error.message;
  const { error } = await db.from('organizations').delete().eq('id', id).eq('is_demo', true);
  return error?.message ?? null;
}

try {
  await main();
} catch (err) {
  console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
  if (createdOrgId && url && secretKey) {
    // Roll back the partially created tenant so the next run starts clean.
    const db = createClient<Database>(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const failed = await deleteDemoTenant(db, createdOrgId);
    console.error(failed ? `✗ cleanup failed (${failed}); re-run with --reset` : '✓ removed the partially created demo tenant');
  }
  process.exit(1);
}
