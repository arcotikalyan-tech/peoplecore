/**
 * Live smoke test of the seeded demo tenant against a real Supabase project.
 *
 *   corepack pnpm --filter @peoplecore/web verify:demo [--app http://localhost:3000]
 *
 * Signs in as each demo account with the *publishable* key (exactly like the app) and compares what each
 * can see with ground truth read through the secret key. With --app it also loads the main pages from a
 * running PeopleCore server as each account and checks that the right data appears and the wrong data
 * never does. Read-only, except for one write that RLS must refuse (removed again if it ever succeeds).
 */
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@peoplecore/db/types';
import { readMfaSecrets } from './lib/demo-mfa.ts';
import { totp } from './lib/totp.ts';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secretKey = process.env.SUPABASE_SECRET_KEY;
const password = process.env.DEMO_USER_PASSWORD;
const domain = process.env.DEMO_EMAIL_DOMAIN ?? 'example.test';
const argv = process.argv.slice(2);
const appUrl = argv.includes('--app') ? argv[argv.indexOf('--app') + 1] : undefined;

if (!url || !publishableKey || !secretKey || !password) {
  console.error('✗ Needs NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY and DEMO_USER_PASSWORD.');
  process.exit(1);
}

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (!ok) failures += 1;
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` (${detail})` : ''}`);
}
const sameSet = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x));

// ─── Ground truth via the secret key ────────────────────────────────────────

const admin = createClient<Database>(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: org } = await admin.from('organizations').select('id').eq('slug', 'demo').eq('is_demo', true).maybeSingle();
if (!org) {
  console.error('✗ No demo tenant found. Run seed:demo first.');
  process.exit(1);
}
const { data: everyone, error: everyoneError } = await admin
  .from('employees')
  .select('id, user_id, manager_employee_id, employee_code')
  .eq('organization_id', org.id);
if (everyoneError || !everyone) {
  console.error(`✗ Could not read ground truth: ${everyoneError?.message}`);
  process.exit(1);
}
const allIds = new Set(everyone.map((e) => e.id));
const employeeOf = (userId: string) => everyone.find((e) => e.user_id === userId);
const codeOf = (id: string) => everyone.find((e) => e.id === id)!.employee_code;

/** Everyone below `rootId` in the reporting tree (direct and indirect). */
function reportingLine(rootId: string): Set<string> {
  const out = new Set<string>();
  const queue = [rootId];
  while (queue.length) {
    const current = queue.shift()!;
    for (const e of everyone!) {
      if (e.manager_employee_id === current && !out.has(e.id)) {
        out.add(e.id);
        queue.push(e.id);
      }
    }
  }
  return out;
}

// ─── Sessions, exactly as the app creates them (publishable key + auth cookies) ──

function makeClient(jar: Map<string, string>) {
  return createServerClient<Database>(url!, publishableKey!, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => {
        for (const c of cookies) {
          if (c.value) jar.set(c.name, c.value);
          else jar.delete(c.name);
        }
      },
    },
  });
}
type Client = ReturnType<typeof makeClient>;

const mfaSecrets = await readMfaSecrets();

/** Password sign-in, then the second factor for accounts that have one (unless secondFactor is false). */
async function signIn(local: string, { secondFactor = true } = {}): Promise<{ client: Client; userId: string; cookie: string } | null> {
  const jar = new Map<string, string>();
  const client = makeClient(jar);
  const email = `${local}@${domain}`;
  const { data, error } = await client.auth.signInWithPassword({ email, password: password! });
  if (error || !data.user) return null;
  const factor = mfaSecrets[email];
  if (secondFactor && factor) {
    const { error: mfaError } = await client.auth.mfa.challengeAndVerify({ factorId: factor.factorId, code: totp(factor.secret) });
    if (mfaError) return null;
  }
  return { client, userId: data.user.id, cookie: [...jar].map(([n, v]) => `${n}=${v}`).join('; ') };
}

async function visibleIds(client: Client): Promise<Set<string>> {
  const { data, error } = await client.from('employees').select('id').eq('organization_id', org!.id);
  if (error) throw new Error(`employees query failed: ${error.message}`);
  return new Set(data.map((r) => r.id));
}

// ─── Data access checks ─────────────────────────────────────────────────────

console.log(`Demo tenant: ${everyone.length} employees\n`);
console.log('Data access (RLS on the live database):');

const sessions = {
  owner: await signIn('demo.owner'),
  hr: await signIn('demo.hr'),
  payroll: await signIn('demo.payroll'),
  manager: await signIn('demo.manager'),
  employee: await signIn('demo.employee'),
  platform: await signIn('demo.platform'),
};
for (const [role, s] of Object.entries(sessions)) {
  if (role !== 'platform') check(`${role} can sign in`, s !== null);
}
const { owner, hr, payroll, manager, employee, platform } = sessions;
if (!owner || !hr || !payroll || !manager || !employee) {
  console.error('\n✗ Some demo accounts could not sign in. Is DEMO_USER_PASSWORD the one used for seed:demo?');
  process.exit(1);
}

for (const [role, s] of [['owner', owner], ['hr', hr], ['payroll', payroll]] as const) {
  const seen = await visibleIds(s.client);
  check(`${role} sees the whole organization`, sameSet(seen, allIds), `${seen.size}/${allIds.size}`);
}

const managerSelf = employeeOf(manager.userId)!;
const managerExpected = new Set([managerSelf.id, ...reportingLine(managerSelf.id)]);
const managerSeen = await visibleIds(manager.client);
check('manager sees exactly themselves + their reporting line', sameSet(managerSeen, managerExpected), `${managerSeen.size} people`);

const employeeSelf = employeeOf(employee.userId)!;
const employeeSeen = await visibleIds(employee.client);
check('employee sees only their own record', sameSet(employeeSeen, new Set([employeeSelf.id])), `${employeeSeen.size} visible`);

const hrPasswordOnly = await signIn('demo.hr', { secondFactor: false });
// Where the company requires two-step, a password-only session gets no permissions at all; otherwise roles apply as usual.
const twoStepRequired = (await admin.from('org_controls').select('require_mfa').eq('organization_id', org.id).maybeSingle()).data?.require_mfa ?? false;
const hrPasswordOnlySeen = hrPasswordOnly ? await visibleIds(hrPasswordOnly.client) : new Set<string>();
if (twoStepRequired) check('HR with a password only (no second step) sees nobody while the company requires two-step', hrPasswordOnlySeen.size === 0, `${hrPasswordOnlySeen.size} visible`);
else check('HR with a password only sees the whole organization (two-step is off for the company)', sameSet(hrPasswordOnlySeen, allIds), `${hrPasswordOnlySeen.size}/${allIds.size}`);

const auditCount = async (c: Client) => (await c.from('audit_events').select('id', { count: 'exact', head: true }).eq('organization_id', org.id)).count ?? 0;
check('HR can read the audit log', (await auditCount(hr.client)) > 0);
check('employee cannot read the audit log', (await auditCount(employee.client)) === 0);

const forged = await employee.client
  .from('departments')
  .insert({ organization_id: org.id, code: 'HACK', name: 'Should be refused' })
  .select('id')
  .maybeSingle();
check('employee cannot change the organization structure', forged.error?.code === '42501', forged.error?.code ?? 'insert succeeded!');
if (forged.data) await admin.from('departments').delete().eq('id', forged.data.id);

const { data: hrGrants } = await hr.client.rpc('my_permissions', { p_org: org.id });
check('HR holds employee.create', Boolean(hrGrants?.some((g) => g.permission_key === 'employee.create' && g.scope === 'org')));

const anon = createClient<Database>(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
const anonRead = await anon.from('employees').select('id').limit(1);
check('anonymous requests are refused', anonRead.error?.code === '42501', anonRead.error?.code ?? `${anonRead.data?.length} rows returned!`);

if (platform) {
  const orgs = await platform.client.from('organizations').select('id').eq('id', org.id);
  check('platform admin can see the tenant exists', orgs.data?.length === 1);
  const seen = await visibleIds(platform.client);
  check('platform admin cannot read tenant employees', seen.size === 0, `${seen.size} visible`);
}

// ─── Pages, as each account (optional) ──────────────────────────────────────

if (appUrl) {
  console.log(`\nPages served by ${appUrl}:`);

  async function page(path: string, cookie?: string) {
    const res = await fetch(new URL(path, appUrl), {
      headers: cookie ? { cookie } : {},
      redirect: 'manual',
      signal: AbortSignal.timeout(90_000),
    });
    // React separates adjacent text nodes with <!-- -->; remove them so visible text can be matched.
    const body = (await res.text()).replaceAll('<!-- -->', '');
    return { status: res.status, location: res.headers.get('location') ?? '', body };
  }
  const healthy = (p: { status: number; body: string }) => p.status < 500 && !p.body.includes('Something went wrong');

  async function shows(name: string, path: string, cookie: string, mustInclude: string[], mustExclude: string[] = []) {
    const p = await page(path, cookie);
    const missing = mustInclude.filter((t) => !p.body.includes(t));
    const leaked = mustExclude.filter((t) => p.body.includes(t));
    const detail = [p.status !== 200 && `HTTP ${p.status}`, missing.length && `missing ${missing.join(', ')}`, leaked.length && `LEAKED ${leaked.join(', ')}`]
      .filter(Boolean)
      .join('; ');
    check(name, healthy(p) && missing.length === 0 && leaked.length === 0, detail || undefined);
  }

  if (hrPasswordOnly) {
    const pending = await page('/app/demo/employees', hrPasswordOnly.cookie);
    check('HR, who uses two-step, is asked for the code before any page', [302, 303, 307].includes(pending.status) && pending.location.includes('/mfa'), `HTTP ${pending.status}`);
  }

  const anonPage = await page('/app/demo');
  check('signed-out visitor is sent to sign-in', [302, 303, 307].includes(anonPage.status) && anonPage.location.includes('/login'), `HTTP ${anonPage.status}`);

  const ceo = everyone.find((e) => !e.manager_employee_id)!;
  const someReport = [...reportingLine(managerSelf.id)][0]!;
  const notInManagerLine = everyone.find((e) => !managerExpected.has(e.id))!;
  const total = (n: number) => `${n.toLocaleString('en-IN')} result${n === 1 ? '' : 's'}`;

  await shows('owner: dashboard', '/app/demo', owner.cookie, ['Active employees', 'Upcoming joiners']);
  await shows('owner: employee directory lists everyone', '/app/demo/employees', owner.cookie, [total(allIds.size)]);
  await shows('owner: search', `/app/demo/employees?q=${encodeURIComponent('asha')}`, owner.cookie, [codeOf(ceo.id)]);
  await shows('owner: an employee profile', `/app/demo/employees/${someReport}`, owner.cookie, [codeOf(someReport), 'Employment history', 'Activity']);
  await shows('owner: add-employee form', '/app/demo/employees/new', owner.cookie, ['Create employee']);
  await shows('owner: organization structure', '/app/demo/structure', owner.cookie, ['Engineering', 'Bengaluru office']);
  await shows('owner: audit log', '/app/demo/audit', owner.cookie, ['Append-only record of changes']);

  await shows('manager: directory shows only their line', '/app/demo/employees', manager.cookie, [total(managerExpected.size)]);
  await shows('manager: a report’s profile', `/app/demo/employees/${someReport}`, manager.cookie, [codeOf(someReport)]);
  await shows('manager: someone outside their line is hidden', `/app/demo/employees/${notInManagerLine.id}`, manager.cookie, ['Page not found'], [codeOf(notInManagerLine.id)]);

  await shows('employee: dashboard shows their profile', '/app/demo', employee.cookie, ['My profile', codeOf(employeeSelf.id)]);
  await shows('employee: own profile', `/app/demo/employees/${employeeSelf.id}`, employee.cookie, [codeOf(employeeSelf.id)]);
  await shows('employee: CEO profile is hidden', `/app/demo/employees/${ceo.id}`, employee.cookie, ['Page not found'], [codeOf(ceo.id)]);
  await shows('employee: audit log is hidden', '/app/demo/audit', employee.cookie, ['Page not found'], ['Append-only record of changes']);
  await shows('employee: add-employee form is hidden', '/app/demo/employees/new', employee.cookie, ['Page not found'], ['Create employee']);

  if (platform) {
    await shows('platform admin: console', '/platform', platform.cookie, ['Tenants on this PeopleCore deployment', 'PeopleCore Demo (synthetic data)']);
    await shows('platform admin: cannot open the tenant', '/app/demo', platform.cookie, ['Page not found'], ['every person and record here is synthetic']);
  }
  await shows('owner (not platform admin): console is hidden', '/platform', owner.cookie, ['Page not found'], ['Tenants on this PeopleCore deployment']);
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
