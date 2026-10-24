/** One organization the person belongs to, as `my_organizations` lists it. */
export interface OrgChoice {
  id: string;
  name: string;
  slug: string;
  status: string;
}

/**
 * The organization the app opens in: the one chosen last on this phone while it is still active, else the first
 * active one. People in more than one switch in Account settings (or by tapping another organization's notification).
 */
export function pickWorkplace(orgs: OrgChoice[] | null | undefined, preferred: string | null): OrgChoice | null {
  const active = (orgs ?? []).filter((o) => o.status === 'active');
  return active.find((o) => o.id === preferred || o.slug === preferred) ?? active[0] ?? null;
}
