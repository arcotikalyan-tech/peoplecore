import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ButtonLink } from '@/components/ui/button';
import { Badge, Card, CardHeader, PageHeader } from '@/components/ui/surface';
import { Table, Td, Th } from '@/components/ui/table';
import { formatDate } from '@/lib/format';
import { listAccess, listSystems } from '@/server/assets';
import { getOrgContext } from '@/server/context';
import { colleagueNames, colleagueOptions } from '@/server/engagement';
import { employeeNames, getMyEmployee, managerOptions } from '@/server/employees';
import { grantAccessAction, revokeAccessAction, saveSystemAction } from '../actions';
import { GrantAccessForm, RevokeAccessForm, SystemForm } from '../assets-forms';

export const metadata: Metadata = { title: 'System access' };

/** The access register: HR sees every system; a system's owner sees and keeps the register for theirs. */
export default async function AccessPage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<{ system?: string }> }) {
  const { org: slug } = await params;
  const ctx = await getOrgContext(slug);
  const me = await getMyEmployee(ctx.org.id, ctx.user.id);
  const manages = ctx.can('asset.manage', 'org');
  const systems = await listSystems(ctx.org.id, true);
  const mine = manages ? systems : systems.filter((s) => me && s.owner_employee_id === me.id);
  if (!manages && mine.length === 0) notFound();
  const { system: systemParam } = await searchParams;
  const selected = mine.find((s) => s.id === systemParam) ?? null;

  const [grants, people, colleagues] = await Promise.all([
    listAccess(ctx.org.id, { systemId: selected?.id, active: true }),
    manages ? managerOptions(ctx.org.id) : colleagueOptions(ctx.org.id),
    colleagueNames(ctx.org.id),
  ]);
  const hrNames = manages ? await employeeNames(ctx.org.id, grants.map((g) => g.employee_id)) : new Map<string, string>();
  const name = (id: string) => hrNames.get(id) ?? colleagues.get(id) ?? '—';
  const systemName = new Map(systems.map((s) => [s.id, s.name]));
  const base = `/app/${slug}/assets/access`;
  const active = mine.filter((s) => s.is_active);

  return (
    <>
      <PageHeader title="System access" description="Who has an account in which system. Revoke access here when someone changes role or leaves."
        actions={manages ? <ButtonLink href={`/app/${slug}/assets`} variant="ghost">Assets</ButtonLink> : undefined} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card>
            <CardHeader title={selected ? `Active access: ${selected.name}` : 'Active access'}
              actions={selected ? <Link className="text-sm text-primary hover:underline" href={base}>All systems</Link> : undefined} />
            {mine.length > 1 && (
              <nav aria-label="Systems" className="flex flex-wrap gap-2 border-b border-line px-5 py-3 text-sm">
                {mine.map((s) => (
                  <Link key={s.id} href={`${base}?system=${s.id}`}
                    className={`rounded-full border px-3 py-1 ${selected?.id === s.id ? 'border-primary text-primary' : 'border-line text-muted hover:text-fg'}`}>
                    {s.name}
                  </Link>
                ))}
              </nav>
            )}
            <Table caption="Active access">
              <thead><tr><Th>Person</Th><Th>System</Th><Th>Account</Th><Th>Since</Th><Th><span className="sr-only">Revoke</span></Th></tr></thead>
              <tbody>
                {grants.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-muted">No active access recorded.</td></tr>}
                {grants.map((g) => (
                  <tr key={g.id}>
                    <Td className="font-medium">{name(g.employee_id)}</Td>
                    <Td>{systemName.get(g.system_id) ?? '—'}</Td>
                    <Td>{g.account}{g.access_level && <span className="block text-xs text-muted">{g.access_level}</span>}</Td>
                    <Td className="text-muted">{formatDate(g.granted_at)}</Td>
                    <Td>
                      <RevokeAccessForm action={revokeAccessAction.bind(null, slug)} grantId={g.id}
                        label={`Revoke ${g.account} in ${systemName.get(g.system_id) ?? 'system'}`} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>

          {manages && (
            <Card>
              <CardHeader title="Systems" description="An owner (for example the IT lead) can record and revoke access to their system without HR rights." />
              <ul className="divide-y divide-line" aria-label="Systems">
                {systems.map((s) => (
                  <li key={s.id} className="flex items-center gap-2">
                    <div className="flex-1"><SystemForm action={saveSystemAction.bind(null, slug)} system={s} people={people} /></div>
                    {!s.is_active && <span className="pr-5"><Badge>Not in use</Badge></span>}
                  </li>
                ))}
              </ul>
              <div className="border-t border-line">
                <SystemForm action={saveSystemAction.bind(null, slug)} people={people} />
              </div>
            </Card>
          )}
        </div>

        <Card>
          <CardHeader title="Record access" description="Record an account once it has been created in the system." />
          {active.length === 0
            ? <p className="px-5 py-4 text-sm text-muted">Add a system first.</p>
            : <GrantAccessForm action={grantAccessAction.bind(null, slug)} people={people} systems={active.map((s) => ({ value: s.id, label: s.name }))} />}
        </Card>
      </div>
    </>
  );
}
