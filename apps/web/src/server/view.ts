import 'server-only';
import { cookies } from 'next/headers';
import type { ViewMode } from '@/components/shell/nav-model';
import type { OrgContext } from './context';

const ADMIN_PERMISSIONS = ['employee.read', 'leave.approve', 'attendance.read', 'payroll.prepare', 'payroll.approve', 'recruitment.read', 'org.manage', 'member.manage'] as const;

/** Whether this person administers anything beyond themselves, so the Admin / Me switch means something. */
export function hasAdminView(ctx: OrgContext) {
  return ADMIN_PERMISSIONS.some((p) => ctx.can(p, 'org') || ctx.can(p, 'team'));
}

/** Admin view unless the person chose "Me" (the view switch writes the cookie). Display only: RLS enforces. */
export async function viewModeFor(ctx: OrgContext): Promise<ViewMode> {
  if (!hasAdminView(ctx)) return 'self';
  return (await cookies()).get('pc-view')?.value === 'self' ? 'self' : 'admin';
}
