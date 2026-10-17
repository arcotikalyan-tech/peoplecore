/**
 * Permission catalog and default role templates.
 *
 * Source of truth for the UI and for docs/05-permissions.md. The database seed
 * (supabase/migrations/*_rbac_seed.sql) must match this file exactly; the test in
 * packages/db/test/rbac-catalog.test.ts enforces it.
 */

export type PermissionScope = 'org' | 'team' | 'self';

interface PermissionDef {
  module: string;
  description: string;
  sensitive?: boolean;
}

export const PERMISSIONS = {
  'org.read': { module: 'org', description: 'View organization structure' },
  'org.manage': { module: 'org', description: 'Manage organization settings and structure' },
  'member.manage': { module: 'org', description: 'Invite, suspend and remove members' },
  'role.manage': { module: 'org', description: 'Create roles and assign them to members' },
  'audit.read': { module: 'org', description: 'View audit trail' },

  'employee.read': { module: 'core_hr', description: 'View employee work profiles' },
  'employee.create': { module: 'core_hr', description: 'Create employees' },
  'employee.update': { module: 'core_hr', description: 'Edit employees and assignments' },
  'employee.export': { module: 'core_hr', description: 'Export employee data' },
  'employee.personal.read': { module: 'core_hr', description: 'View personal details', sensitive: true },
  'employee.identity.read': { module: 'core_hr', description: 'View identity documents', sensitive: true },
  'employee.bank.read': { module: 'core_hr', description: 'View bank details', sensitive: true },
  'employee.personal.update': { module: 'core_hr', description: 'Edit personal details and emergency contacts', sensitive: true },
  'employee.identity.update': { module: 'core_hr', description: 'Edit identity numbers (PAN, UAN, ESIC, passport)', sensitive: true },
  'employee.bank.update': { module: 'core_hr', description: 'Change bank accounts', sensitive: true },
  'employee.document.read': { module: 'core_hr', description: 'View and download employee documents', sensitive: true },
  'employee.document.upload': { module: 'core_hr', description: 'Upload employee documents', sensitive: true },
  'employee.document.delete': { module: 'core_hr', description: 'Delete employee documents', sensitive: true },

  'compensation.read': { module: 'payroll', description: 'View compensation', sensitive: true },
  'compensation.update': { module: 'payroll', description: 'Change compensation', sensitive: true },
  'payroll.prepare': { module: 'payroll', description: 'Prepare payroll runs (maker)' },
  'payroll.approve': { module: 'payroll', description: 'Approve payroll runs (checker)', sensitive: true },

  'recruitment.read': { module: 'recruitment', description: 'View requisitions and candidates' },
  'recruitment.manage': { module: 'recruitment', description: 'Manage requisitions, candidates and offers' },

  'attendance.read': { module: 'attendance', description: 'View attendance' },
  'attendance.approve': { module: 'attendance', description: 'Approve regularizations' },
  'leave.approve': { module: 'leave', description: 'Approve leave' },
  'expense.approve': { module: 'expenses', description: 'Approve expense claims' },

  'grievance.read': { module: 'employee_relations', description: 'View grievance cases', sensitive: true },
  'ai.use': { module: 'ai', description: 'Use AI assistants' },
} as const satisfies Record<string, PermissionDef>;

export type PermissionKey = keyof typeof PERMISSIONS;

export const ROLE_KEYS = [
  'owner',
  'hr_admin',
  'recruiter',
  'payroll_admin',
  'department_head',
  'manager',
  'employee',
  'auditor',
] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

interface RoleTemplate {
  name: string;
  description: string;
  /**
   * Permission that lets someone grant or revoke this role (besides role.manage, which grants any role).
   * Administrative roles are owner-only; everyday roles can be assigned by HR (member.manage).
   */
  assignableWith: 'role.manage' | 'member.manage';
  /** Only effective once the user has completed two-factor sign-in (session aal2). */
  requiresMfa: boolean;
  grants: Partial<Record<PermissionKey, PermissionScope>>;
}

export const ROLE_TEMPLATES: Record<RoleKey, RoleTemplate> = {
  owner: {
    name: 'Organization owner',
    description: 'Full administrative control of the organization',
    assignableWith: 'role.manage',
    requiresMfa: true,
    grants: {
      'employee.personal.update': 'org', 'employee.identity.update': 'org', 'employee.bank.update': 'org',
      'employee.document.read': 'org', 'employee.document.upload': 'org', 'employee.document.delete': 'org',
      'org.read': 'org', 'org.manage': 'org', 'member.manage': 'org', 'role.manage': 'org', 'audit.read': 'org',
      'employee.read': 'org', 'employee.create': 'org', 'employee.update': 'org', 'employee.export': 'org',
      'employee.personal.read': 'org', 'employee.identity.read': 'org', 'employee.bank.read': 'org',
      'compensation.read': 'org', 'payroll.approve': 'org',
      'recruitment.read': 'org', 'recruitment.manage': 'org',
      'attendance.read': 'org', 'attendance.approve': 'org', 'leave.approve': 'org', 'expense.approve': 'org',
      'grievance.read': 'org', 'ai.use': 'org',
    },
  },
  hr_admin: {
    name: 'HR administrator',
    description: 'Manages employees, structure and HR operations',
    assignableWith: 'role.manage',
    requiresMfa: true,
    grants: {
      'employee.personal.update': 'org', 'employee.identity.update': 'org',
      'employee.document.read': 'org', 'employee.document.upload': 'org', 'employee.document.delete': 'org',
      'org.read': 'org', 'org.manage': 'org', 'member.manage': 'org', 'audit.read': 'org',
      'employee.read': 'org', 'employee.create': 'org', 'employee.update': 'org', 'employee.export': 'org',
      'employee.personal.read': 'org', 'employee.identity.read': 'org',
      'recruitment.read': 'org', 'recruitment.manage': 'org',
      'attendance.read': 'org', 'attendance.approve': 'org', 'leave.approve': 'org',
      'grievance.read': 'org', 'ai.use': 'org',
    },
  },
  recruiter: {
    name: 'Recruiter',
    description: 'Manages requisitions, candidates and offers',
    assignableWith: 'member.manage',
    requiresMfa: false,
    // Directory access (name/department/designation only) arrives with a restricted view in Phase 2b.
    grants: { 'org.read': 'org', 'recruitment.read': 'org', 'recruitment.manage': 'org', 'ai.use': 'org' },
  },
  payroll_admin: {
    name: 'Payroll / finance administrator',
    description: 'Prepares payroll and manages compensation',
    assignableWith: 'role.manage',
    requiresMfa: true,
    grants: {
      'employee.bank.update': 'org',
      'org.read': 'org', 'employee.read': 'org', 'employee.export': 'org',
      'employee.identity.read': 'org', 'employee.bank.read': 'org',
      'compensation.read': 'org', 'compensation.update': 'org',
      'payroll.prepare': 'org', 'payroll.approve': 'org',
      'attendance.read': 'org', 'expense.approve': 'org', 'ai.use': 'org',
    },
  },
  department_head: {
    name: 'Department head',
    description: 'Leads a department; sees their reporting line',
    assignableWith: 'member.manage',
    requiresMfa: false,
    grants: {
      'org.read': 'org', 'employee.read': 'team', 'recruitment.read': 'team',
      'attendance.read': 'team', 'attendance.approve': 'team', 'leave.approve': 'team', 'expense.approve': 'team',
      'ai.use': 'org',
    },
  },
  manager: {
    name: 'Reporting manager',
    description: 'Approves requests for direct and indirect reports',
    assignableWith: 'member.manage',
    requiresMfa: false,
    grants: {
      'org.read': 'org', 'employee.read': 'team', 'recruitment.read': 'team',
      'attendance.read': 'team', 'attendance.approve': 'team', 'leave.approve': 'team', 'expense.approve': 'team',
      'ai.use': 'org',
    },
  },
  employee: {
    name: 'Employee',
    description: 'Self-service access to own records',
    assignableWith: 'member.manage',
    requiresMfa: false,
    grants: {
      'employee.personal.update': 'self',
      'employee.document.read': 'self', 'employee.document.upload': 'self',
      'org.read': 'org', 'employee.read': 'self', 'employee.personal.read': 'self',
      'employee.identity.read': 'self', 'employee.bank.read': 'self', 'compensation.read': 'self',
      'attendance.read': 'self', 'grievance.read': 'self', 'ai.use': 'org',
    },
  },
  auditor: {
    name: 'Auditor (read-only)',
    description: 'Read-only access for audit and compliance review',
    assignableWith: 'role.manage',
    requiresMfa: true,
    grants: {
      'org.read': 'org', 'audit.read': 'org', 'employee.read': 'org', 'employee.export': 'org',
      'compensation.read': 'org', 'recruitment.read': 'org', 'attendance.read': 'org',
    },
  },
};

/** A granted permission for the current user in one organization. */
export interface Grant {
  permission_key: string;
  scope: PermissionScope;
}

export function hasGrant(grants: readonly Grant[], key: PermissionKey, scope?: PermissionScope): boolean {
  return grants.some((g) => g.permission_key === key && (scope === undefined || g.scope === scope));
}
