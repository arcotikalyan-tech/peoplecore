import 'server-only';
import { createClient } from './supabase';

export interface SetupStep { key: string; group: string; title: string; done: boolean; note: string; href: string }

/** Readiness checks from live data (Settings › Setup wizard and the Onboarding hub). Counts use the viewer's rights. */
export async function setupChecks(orgId: string, slug: string): Promise<SetupStep[]> {
  const supabase = await createClient();
  const year = new Date().getUTCFullYear();
  function base(table: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a generic count over many tables
    return (supabase.from(table as any) as any).select('*', { count: 'exact', head: true }).eq('organization_id', orgId);
  }
  const n = async (table: string, f?: (q: ReturnType<typeof base>) => ReturnType<typeof base>) => {
    const q = base(table);
    const { count } = await (f ? f(q) : q);
    return (count as number | null) ?? 0;
  };
  const [profile, locations, departments, designations, employees, managed, members, leaveTypes, holidays, shifts, salaries, flows, cards] = await Promise.all([
    supabase.from('company_profiles').select('legal_name, pan').eq('organization_id', orgId).maybeSingle().then((r) => r.data),
    n('locations'), n('departments'), n('designations'), n('employees', (q) => q.neq('status', 'exited')), n('employees', (q) => q.not('manager_employee_id', 'is', null)),
    n('organization_members'), n('leave_types', (q) => q.eq('is_active', true)), n('holidays', (q) => q.gte('holiday_date', `${year}-01-01`)),
    n('shifts'), n('compensation_records'), n('approval_flows'), n('id_card_designs'),
  ]);
  const app = `/app/${slug}`;
  return [
    { key: 'company', group: 'Company', title: 'Company details', done: !!profile?.legal_name && !!profile?.pan, note: profile?.pan ? 'Legal name and PAN set' : 'Add the legal name and PAN', href: `${app}/company` },
    { key: 'locations', group: 'Company', title: 'Offices and locations', done: locations > 0, note: `${locations} location${locations === 1 ? '' : 's'}`, href: `${app}/company?tab=offices` },
    { key: 'structure', group: 'Company', title: 'Departments and designations', done: departments > 0 && designations > 0, note: `${departments} departments · ${designations} designations`, href: `${app}/company?tab=departments` },
    { key: 'employees', group: 'People', title: 'Employees added', done: employees > 1, note: `${employees} employee${employees === 1 ? '' : 's'}`, href: `${app}/employees` },
    { key: 'managers', group: 'People', title: 'Reporting managers', done: managed > 0, note: `${managed} with a manager`, href: `${app}/employees` },
    { key: 'members', group: 'People', title: 'People invited to sign in', done: members > 1, note: `${members} member${members === 1 ? '' : 's'}`, href: `${app}/onboarding?tab=activation` },
    { key: 'leave', group: 'Time', title: 'Leave types', done: leaveTypes > 0, note: `${leaveTypes} active`, href: `${app}/leave?tab=rules` },
    { key: 'holidays', group: 'Time', title: `Holidays for ${year}`, done: holidays > 0, note: `${holidays} holidays`, href: `${app}/holidays?tab=list` },
    { key: 'attendance', group: 'Time', title: 'Shifts and attendance rules', done: shifts > 0, note: `${shifts} shift${shifts === 1 ? '' : 's'}`, href: `${app}/attendance?tab=rules` },
    { key: 'salaries', group: 'Pay', title: 'Salaries assigned', done: salaries > 0, note: `${salaries} salary record${salaries === 1 ? '' : 's'}`, href: `${app}/payroll?tab=people` },
    { key: 'flows', group: 'Workflows', title: 'Approval flows', done: flows > 0, note: `${flows} flows`, href: `${app}/workflows` },
    { key: 'idcards', group: 'Workflows', title: 'ID card design', done: cards > 0, note: cards ? 'Designed' : 'Not yet', href: `${app}/idstudio` },
  ];
}
