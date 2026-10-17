/**
 * Seeds a clearly-marked DEMO tenant (slug "demo") with synthetic people into a PeopleCore Supabase project.
 *
 *   DEMO_USER_PASSWORD='…' corepack pnpm --filter @peoplecore/web seed:demo --yes [--platform-admin]
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY from apps/web/.env.local or the shell.
 * Every name is fictional; every email is on DEMO_EMAIL_DOMAIN (default example.test, a reserved TLD).
 * The password is supplied by you and is never generated or printed.
 */
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@peoplecore/db/types';

type RoleKey = 'owner' | 'hr_admin' | 'payroll_admin' | 'manager' | 'employee';
type EmploymentType = Database['public']['Enums']['employment_type'];

const args = new Set(process.argv.slice(2));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
const password = process.env.DEMO_USER_PASSWORD;
const domain = process.env.DEMO_EMAIL_DOMAIN ?? 'example.test';

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

if (!url || !secretKey) fail('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (see .env.example).');
if (!password || password.length < 12) fail('Set DEMO_USER_PASSWORD (12+ characters) for the demo sign-in accounts.');
if (!args.has('--yes')) fail(`This creates a demo tenant in ${url}. Re-run with --yes to continue.`);

const db = createClient<Database>(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });

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

async function ensureUser(local: string): Promise<{ id: string; email: string }> {
  const email = `${local}@${domain}`;
  const created = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.data.user) return { id: created.data.user.id, email };
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) fail(`list users: ${error.message}`);
    const hit = data.users.find((u) => u.email === email);
    if (hit) return { id: hit.id, email };
    if (data.users.length < 1000) break;
  }
  fail(`could not create or find ${email}: ${created.error?.message ?? 'unknown error'}`);
}

const isoDaysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

// ─── Tenant & structure ─────────────────────────────────────────────────────

const existing = maybe(await db.from('organizations').select('id').eq('slug', 'demo').maybeSingle(), 'check for demo tenant');
if (existing) fail('A tenant with slug "demo" already exists. Delete it first to reseed.');

const org = must(
  await db.from('organizations').insert({ name: 'PeopleCore Demo (synthetic data)', slug: 'demo', is_demo: true }).select('id').single(),
  'create organization',
);
const orgId = org.id;

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

// ─── People ─────────────────────────────────────────────────────────────────

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

const accounts = {
  owner: await ensureUser('demo.owner'),
  hr: await ensureUser('demo.hr'),
  payroll: await ensureUser('demo.payroll'),
  manager: await ensureUser('demo.manager'),
  employee: await ensureUser('demo.employee'),
};

const ceo = await addEmployee({ first: 'Asha', last: 'Varma', dept: 'LEAD', title: 'Chief Executive Officer', loc: 'BLR', managerId: null, joinedDaysAgo: 1400, userId: accounts.owner.id });
const hrHead = await addEmployee({ first: 'Kiran', last: 'Menon', dept: 'HR', title: 'HR Manager', loc: 'BLR', managerId: ceo, joinedDaysAgo: 1100, userId: accounts.hr.id });
const finHead = await addEmployee({ first: 'Farah', last: 'Qureshi', dept: 'FIN', title: 'Finance Manager', loc: 'PUN', managerId: ceo, joinedDaysAgo: 1000, userId: accounts.payroll.id });
const engHead = await addEmployee({ first: 'Rohan', last: 'Iyer', dept: 'ENG', title: 'Engineering Manager', loc: 'BLR', managerId: ceo, joinedDaysAgo: 900, userId: accounts.manager.id });
const salesHead = await addEmployee({ first: 'Meera', last: 'Kulkarni', dept: 'SALES', title: 'Sales Manager', loc: 'PUN', managerId: ceo, joinedDaysAgo: 800 });
await addEmployee({ first: 'Dev', last: 'Nair', dept: 'ENG', title: 'Software Engineer', loc: 'BLR', managerId: engHead, joinedDaysAgo: 400, userId: accounts.employee.id });

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
  // A few future joiners (pre-joining), a few with probation ending soon, one intern.
  const joinedDaysAgo = i % 9 === 0 ? -14 - i : i % 5 === 0 ? 165 : 120 + i * 37;
  await addEmployee({
    first: firsts[i]!, last: lasts[i % lasts.length]!, ...team, joinedDaysAgo,
    probationMonths: joinedDaysAgo < 200 ? 6 : undefined,
    type: i === 7 ? 'intern' : i === 11 ? 'contract' : 'permanent',
  });
}

// ─── Access ─────────────────────────────────────────────────────────────────

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

if (args.has('--platform-admin')) {
  const admin = await ensureUser('demo.platform');
  exec(await db.from('platform_admins').upsert({ user_id: admin.id }), 'grant platform admin');
  console.log(`✓ platform admin: ${admin.email}`);
}

console.log(`✓ Demo tenant created: /app/demo (${seq} synthetic employees)`);
for (const [role, a] of Object.entries(accounts)) console.log(`  ${role.padEnd(9)} ${a.email}`);
console.log('  Password: the DEMO_USER_PASSWORD you supplied.');
