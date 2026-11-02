import { directOnly, NO_DESKS, roleDesks, type Desks, type DeskSection } from '@peoplecore/shared/desks';
import { supabase } from './supabase';
import { must } from './use-load';

type Grants = Parameters<typeof roleDesks>[0];

/**
 * The person's desks, as on the website's dashboard (dashboard_desks, read as them): their team, and the desks their
 * work calls for (HR, payroll, finance, hiring, audit, devices), from the grants my_org_context returns. Someone who
 * reads the whole organization gets their direct reports as their team.
 */
export async function loadDesks(orgId: string, slug: string, today: string): Promise<Desks> {
  const read = async (sections: DeskSection[]) =>
    must(await supabase.rpc('dashboard_desks', { p_org: orgId, p_today: today, p_sections: sections })) as Partial<Desks>;
  const [mine, context] = await Promise.all([read(['team']), supabase.rpc('my_org_context', { p_slug: slug }).then(must)]);
  const grants = ((context as { grants?: Grants } | null)?.grants ?? []) as Grants;
  const roles = roleDesks(grants);
  const rest = roles.length ? await read(roles) : {};
  const wholeOrg = grants.some((g) => g.permission_key === 'employee.read' && g.scope === 'org');
  const team = mine.team ? (wholeOrg ? directOnly(mine.team) : mine.team) : null;
  return { ...NO_DESKS, ...rest, team };
}
