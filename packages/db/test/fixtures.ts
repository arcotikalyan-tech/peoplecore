import type { TestDatabase } from '../src/harness.ts';
import type { RoleKey } from '@peoplecore/shared';

/**
 * Two synthetic tenants. All people and emails are fictional (example.test).
 *
 * Org A reporting line:  manager ─▶ lead ─▶ ic        peer (reports to nobody)
 */
export interface Fixture {
  orgA: string;
  orgB: string;
  users: Record<
    'ownerA' | 'hrA' | 'payrollA' | 'recruiterA' | 'auditorA' | 'managerA' | 'leadA' | 'icA' | 'peerA' | 'ownerB' | 'employeeB' | 'outsider',
    string
  >;
  employees: Record<'managerA' | 'leadA' | 'icA' | 'peerA' | 'employeeB', string>;
  deptA: string;
  deptB: string;
}

async function addMember(t: TestDatabase, org: string, userId: string, roles: RoleKey[]) {
  const { rows } = await t.db.query<{ id: string }>(
    `insert into organization_members (organization_id, user_id, status) values ($1, $2, 'active') returning id`,
    [org, userId],
  );
  for (const role of roles) {
    await t.db.query(
      `insert into member_roles (organization_id, member_id, role_id)
       select $1, $2, id from roles where organization_id = $1 and key = $3`,
      [org, rows[0]!.id, role],
    );
  }
}

async function addEmployee(
  t: TestDatabase,
  org: string,
  code: string,
  firstName: string,
  userId: string | null,
  managerId: string | null,
): Promise<string> {
  const { rows } = await t.db.query<{ id: string }>(
    `insert into employees (organization_id, employee_code, first_name, last_name, work_email, user_id,
                            status, employment_type, date_of_joining, manager_employee_id)
     values ($1, $2, $3, 'Demo', lower($3) || '@example.test', $4, 'active', 'permanent', '2024-01-01', $5)
     returning id`,
    [org, code, firstName, userId, managerId],
  );
  return rows[0]!.id;
}

export async function buildFixture(t: TestDatabase): Promise<Fixture> {
  const org = async (name: string, slug: string) =>
    (await t.db.query<{ id: string }>(`insert into organizations (name, slug, is_demo) values ($1, $2, true) returning id`, [name, slug]))
      .rows[0]!.id;
  const orgA = await org('Demo Org A', 'demo-a');
  const orgB = await org('Demo Org B', 'demo-b');
  // Org A has switched two-step sign-in on (Settings › Controls); org B keeps the default, off.
  await t.db.query('update org_controls set require_mfa = true where organization_id = $1', [orgA]);

  const names = ['ownerA', 'hrA', 'payrollA', 'recruiterA', 'auditorA', 'managerA', 'leadA', 'icA', 'peerA', 'ownerB', 'employeeB', 'outsider'] as const;
  const users = {} as Fixture['users'];
  for (const n of names) users[n] = await t.createUser(`${n.toLowerCase()}@example.test`);

  await addMember(t, orgA, users.ownerA, ['owner']);
  await addMember(t, orgA, users.hrA, ['hr_admin']);
  await addMember(t, orgA, users.payrollA, ['payroll_admin']);
  await addMember(t, orgA, users.recruiterA, ['recruiter']);
  await addMember(t, orgA, users.auditorA, ['auditor']);
  await addMember(t, orgA, users.managerA, ['manager', 'employee']);
  await addMember(t, orgA, users.leadA, ['employee']);
  await addMember(t, orgA, users.icA, ['employee']);
  await addMember(t, orgA, users.peerA, ['employee']);
  await addMember(t, orgB, users.ownerB, ['owner']);
  await addMember(t, orgB, users.employeeB, ['employee']);

  const managerA = await addEmployee(t, orgA, 'A-001', 'Mira', users.managerA, null);
  const leadA = await addEmployee(t, orgA, 'A-002', 'Lalit', users.leadA, managerA);
  const icA = await addEmployee(t, orgA, 'A-003', 'Ishan', users.icA, leadA);
  const peerA = await addEmployee(t, orgA, 'A-004', 'Pia', users.peerA, null);
  const employeeB = await addEmployee(t, orgB, 'B-001', 'Bela', users.employeeB, null);

  const dept = async (o: string) =>
    (await t.db.query<{ id: string }>(`insert into departments (organization_id, code, name) values ($1, 'ENG', 'Engineering') returning id`, [o]))
      .rows[0]!.id;

  return {
    orgA, orgB, users,
    employees: { managerA, leadA, icA, peerA, employeeB },
    deptA: await dept(orgA),
    deptB: await dept(orgB),
  };
}
