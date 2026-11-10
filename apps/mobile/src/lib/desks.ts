import { directOnly, NO_DESKS, roleDesks, type Desks, type DeskSection } from '@peoplecore/shared/desks';
import { loadOrgToday, type OrgToday } from './org-today';
import { supabase } from './supabase';
import { must } from './use-load';

type Grants = Parameters<typeof roleDesks>[0];

/**
 * The person's desks, as on the website's dashboard (dashboard_desks, read as them): their team, and the desks their
 * work calls for (HR, payroll, finance, hiring, audit, devices), from the grants my_org_context returns. Someone who
 * reads the whole organization's attendance (an owner, HR) also gets the organization today, and their direct reports
 * as their team. `withOrg` asks for the organization (Home and Everyone today); My team leaves it out.
 */
export async function loadDesks(orgId: string, slug: string, today: string, withOrg?: { me: string | null }): Promise<Desks & { org: OrgToday | null }> {
  const read = async (sections: DeskSection[]) =>
    must(await supabase.rpc('dashboard_desks', { p_org: orgId, p_today: today, p_sections: sections })) as Partial<Desks>;
  const [mine, context] = await Promise.all([read(['team']), supabase.rpc('my_org_context', { p_slug: slug }).then(must)]);
  const grants = ((context as { grants?: Grants } | null)?.grants ?? []) as Grants;
  const org = (key: string) => grants.some((g) => g.permission_key === key && g.scope === 'org');
  const roles = roleDesks(grants);
  const [rest, everyone] = await Promise.all([
    roles.length ? read(roles) : {},
    withOrg && org('attendance.read') ? loadOrgToday(orgId, withOrg.me, today, org('employee.read')) : null,
  ]);
  const team = mine.team ? (org('employee.read') ? directOnly(mine.team) : mine.team) : null;
  return { ...NO_DESKS, ...rest, team, org: everyone };
}
