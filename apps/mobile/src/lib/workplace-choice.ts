/** One organization the person belongs to, as `my_organizations` lists it. */
export interface OrgChoice {
  id: string;
  name: string;
  slug: string;
  status: string;
}

/**
 * The organization the app opens in: the one chosen last on this phone while it is still active, else the first
 * active one. People in more than one switch under Me › Switch organization (or by tapping another organization's notification).
 */
export function pickWorkplace(orgs: OrgChoice[] | null | undefined, preferred: string | null): OrgChoice | null {
  const active = (orgs ?? []).filter((o) => o.status === 'active');
  return active.find((o) => o.id === preferred || o.slug === preferred) ?? active[0] ?? null;
}

/** The parts of the open workplace that HR or an owner can change while the app is open. */
export interface WorkplaceFacts {
  orgId: string;
  orgName: string;
  slug: string;
  timezone: string;
  employeeId: string | null;
  employeeName: string | null;
  off: string[];
}

/**
 * Whether a re-read of the workplace found nothing new (the app then keeps the object it has, so screens don't reload).
 * An employee record HR added, a name, a module switched on or off: each counts as new.
 */
export function sameWorkplace(a: WorkplaceFacts | null, b: WorkplaceFacts | null): boolean {
  if (!a || !b) return a === b;
  return a.orgId === b.orgId && a.orgName === b.orgName && a.slug === b.slug && a.timezone === b.timezone
    && a.employeeId === b.employeeId && a.employeeName === b.employeeName
    && a.off.length === b.off.length && a.off.every((m) => b.off.includes(m));
}
