import 'server-only';
import { EMPLOYMENT_TYPE_LABELS, PERMISSIONS, type PermissionKey } from '@peoplecore/shared';
import { memberDirectory } from '@/server/approvals';
import { managerOptions } from '@/server/employees';
import { listCourses } from '@/server/learning';
import { getStructure, structureOptions } from '@/server/structure';
import { workflowTriggers } from '@/server/workflows';
import type { BuilderOptions } from './workflow-builder';

/** Groups a workflow can notify: holders of these permissions org-wide. */
const GROUPS: PermissionKey[] = ['workflow.manage', 'member.manage', 'onboarding.manage', 'payroll.prepare', 'asset.manage', 'learning.manage', 'helpdesk.manage'];

export async function builderOptions(orgId: string): Promise<BuilderOptions> {
  const [triggers, structure, courses, members, people] = await Promise.all([
    workflowTriggers(), getStructure(orgId), listCourses(orgId), memberDirectory(orgId), managerOptions(orgId),
  ]);
  const s = structureOptions(structure);
  return {
    triggers: triggers.map((t) => ({ value: t.event_type, label: t.label, aboutEmployee: t.about_employee })),
    departments: s.departments, locations: s.locations, designations: s.designations,
    employmentTypes: Object.entries(EMPLOYMENT_TYPE_LABELS).map(([value, label]) => ({ value, label })),
    courses: courses.filter((c) => c.is_active).map((c) => ({ value: c.id, label: c.title })),
    groups: GROUPS.map((k) => ({ value: k, label: `People who can: ${PERMISSIONS[k].description.toLowerCase()}` })),
    members: members.map((m) => ({ value: m.user_id, label: m.name })),
    people,
  };
}
