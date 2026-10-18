/**
 * Load test (Phase 8) against the LOCAL Supabase stack only: it runs inside the local database container
 * (`supabase start`), never against a URL, so it cannot touch the live project.
 *
 * Seeds a synthetic demo tenant "load-test" (default 50,000 employees in 25 departments, 500 managers with
 * about 100 reports each), then measures the employee-directory queries under row-level security with
 * pgbench: as HR (whole organization), as a manager (their reporting line) and as an employee (themselves).
 * Prints P50 and P95 per query; the target is P95 under 300 ms for list queries (docs/08-roadmap.md).
 *
 *   node scripts/load-test.ts [--employees 50000] [--runs 200] [--clients 4] [--keep]
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const arg = (name: string, fallback: number) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : fallback;
};
const EMPLOYEES = arg('employees', 50_000);
const RUNS = arg('runs', 200);
const CLIENTS = arg('clients', 4);
const KEEP = process.argv.includes('--keep');
const TARGET_MS = 300;

const projectId = readFileSync(new URL('../../../supabase/config.toml', import.meta.url), 'utf8').match(/^project_id\s*=\s*"([^"]+)"/m)?.[1];
const container = `supabase_db_${projectId}`;

function docker(args: string[], input?: string) {
  return execFileSync('docker', args, { input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}
const psql = (sql: string) => docker(['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt'], sql).trim();

try {
  docker(['inspect', '--format', '{{.State.Running}}', container]);
} catch {
  console.error(`The local database container ${container} isn't running. Start it with: npx supabase start`);
  process.exit(2);
}

const cleanup = `
  delete from public.employment_records where organization_id in (select id from public.organizations where slug = 'load-test' and is_demo);
  delete from public.organizations where slug = 'load-test' and is_demo;
  delete from auth.users where email in ('load.hr@example.test', 'load.manager@example.test', 'load.employee@example.test');`;

console.log(`Seeding ${EMPLOYEES.toLocaleString('en-IN')} synthetic employees in the local stack…`);
const started = Date.now();
const ids = psql(`
  ${cleanup}
  create temporary table load_ids (k text primary key, v uuid);
  do $$
  declare
    v_org uuid;
    v_user uuid;
    v_member uuid;
    v_role record;
  begin
    insert into public.organizations (name, slug, is_demo) values ('Load test (synthetic)', 'load-test', true) returning id into v_org;
    insert into load_ids values ('org', v_org);
    insert into public.departments (organization_id, code, name) select v_org, 'D' || g, 'Department ' || g from generate_series(1, 25) g;
    insert into public.locations (organization_id, code, name) select v_org, 'L' || g, 'Office ' || g from generate_series(1, 5) g;
    -- Managers first (no manager), then everyone else reporting to one of them.
    insert into public.employees (organization_id, employee_code, first_name, last_name, work_email, status, employment_type,
                                  date_of_joining, department_id, location_id)
    select v_org, 'L-' || lpad(g::text, 6, '0'),
           (array['Asha','Ravi','Meera','Arjun','Kavya','Rohan','Isha','Vikram','Neha','Aditya','Pooja','Sanjay'])[1 + g % 12],
           (array['Iyer','Nair','Sharma','Reddy','Kumar','Das','Patel','Menon','Rao','Singh'])[1 + (g / 12) % 10] || ' ' || g,
           'load' || g || '@example.test', 'active', 'permanent', date '2020-01-01' + (g % 2000),
           (select id from public.departments where organization_id = v_org and code = 'D' || (1 + g % 25)),
           (select id from public.locations where organization_id = v_org and code = 'L' || (1 + g % 5))
      from generate_series(1, ${EMPLOYEES}) g;
    -- Number everyone once, then join on the numbers (a hash join, not a scan per row).
    with n as (select id, substr(employee_code, 3)::int as k from public.employees where organization_id = v_org)
    update public.employees e set manager_employee_id = m.id
      from n c join n m on m.k = 1 + (c.k % 500)
     where e.id = c.id and c.k > 500;

    for v_role in select * from (values ('hr', 'load.hr@example.test', array['hr_admin'], null::text),
                                         ('manager', 'load.manager@example.test', array['manager', 'employee'], 'L-000001'),
                                         ('employee', 'load.employee@example.test', array['employee'], 'L-001001')) r(k, email, roles, code) loop
      insert into auth.users (id, aud, role, email) values (gen_random_uuid(), 'authenticated', 'authenticated', v_role.email) returning id into v_user;
      insert into public.organization_members (organization_id, user_id, status) values (v_org, v_user, 'active') returning id into v_member;
      insert into public.member_roles (organization_id, member_id, role_id)
      select v_org, v_member, id from public.roles where organization_id = v_org and key = any (v_role.roles);
      if v_role.code is not null then
        update public.employees set user_id = v_user where organization_id = v_org and employee_code = v_role.code;
      end if;
      insert into load_ids values (v_role.k, v_user);
    end loop;
    insert into load_ids select 'dept', id from public.departments where organization_id = v_org and code = 'D7';
  end $$;
  analyze public.employees;
  select string_agg(k || '=' || v, ' ') from load_ids;`);
const id = Object.fromEntries(ids.split(/\s+/).map((kv) => kv.split('=')));
console.log(`  seeded in ${((Date.now() - started) / 1000).toFixed(1)} s`);

const COLUMNS = 'id, employee_code, first_name, middle_name, last_name, work_email, status, employment_type, date_of_joining, probation_end_date, department_id, designation_id';
const asUser = (user: string, body: string) => `BEGIN;
SELECT set_config('request.jwt.claim.sub', '${user}', true), set_config('request.jwt.claims', '{"sub":"${user}","role":"authenticated","aal":"aal2"}', true);
SET LOCAL ROLE authenticated;
${body}
COMMIT;
`;
const list = (where = '') => `SELECT ${COLUMNS} FROM public.employees WHERE organization_id = '${id.org}'${where} ORDER BY first_name, last_name, id LIMIT 25 OFFSET 0;`;
const count = (where = '') => `SELECT count(*) FROM public.employees WHERE organization_id = '${id.org}'${where};`;
const search = ` AND search_text ILIKE '%reddy 4%'`;
const dept = ` AND department_id = '${id.dept}'`;

const scenarios: Array<[string, string, string]> = [
  ['HR: directory, first page', id.hr!, list()],
  ['HR: directory count', id.hr!, count()],
  ['HR: search by name', id.hr!, list(search) + '\n' + count(search)],
  ['HR: one department', id.hr!, list(dept) + '\n' + count(dept)],
  ['Manager: their line, first page', id.manager!, list()],
  ['Manager: their line, count', id.manager!, count()],
  ['Employee: directory (themselves)', id.employee!, list() + '\n' + count()],
];

const results: Array<{ name: string; p50: number; p95: number }> = [];
for (const [name, user, body] of scenarios) {
  docker(['exec', '-i', container, 'sh', '-c', 'cat > /tmp/load.sql'], asUser(user, body));
  docker(['exec', container, 'sh', '-c', 'rm -f /tmp/pgbench_log*']);
  docker(['exec', container, 'pgbench', '-U', 'postgres', '-d', 'postgres', '-n', '-c', String(CLIENTS), '-j', String(Math.min(CLIENTS, 4)),
    '-t', String(Math.ceil(RUNS / CLIENTS)), '-f', '/tmp/load.sql', '-l', '--log-prefix=/tmp/pgbench_log']);
  const log = docker(['exec', container, 'sh', '-c', 'cat /tmp/pgbench_log*']);
  const ms = log.trim().split('\n').map((l) => Number(l.split(' ')[2]) / 1000).sort((a, b) => a - b);
  const at = (q: number) => ms[Math.min(ms.length - 1, Math.floor(q * ms.length))]!;
  results.push({ name, p50: at(0.5), p95: at(0.95) });
  console.log(`  ${name.padEnd(36)} P50 ${at(0.5).toFixed(1).padStart(7)} ms   P95 ${at(0.95).toFixed(1).padStart(7)} ms`);
}

if (!KEEP) psql(cleanup);
const slow = results.filter((r) => r.p95 >= TARGET_MS);
console.log(slow.length ? `✗ ${slow.length} quer${slow.length === 1 ? 'y' : 'ies'} at or over the ${TARGET_MS} ms P95 target` : `✓ every query under the ${TARGET_MS} ms P95 target`);
process.exit(slow.length ? 1 : 0);
