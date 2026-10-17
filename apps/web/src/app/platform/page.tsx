import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Brand } from '@/components/brand';
import { Badge, Card, CardHeader, EmptyState, PageHeader } from '@/components/ui/surface';
import { Table, Td, Th } from '@/components/ui/table';
import { formatDate } from '@/lib/format';
import { isPlatformAdmin, requireUser } from '@/server/context';
import { createClient } from '@/server/supabase';
import { CreateOrgForm } from './create-org-form';
import { OrgStatusControl } from './org-status-control';

export const metadata: Metadata = { title: 'Platform console' };

const statusTone = { active: 'success', suspended: 'warning', archived: 'neutral' } as const;

export default async function PlatformPage() {
  const user = await requireUser();
  if (!(await isPlatformAdmin())) notFound();

  // Platform admins can list tenants (organizations RLS) but cannot read tenant data without membership.
  const supabase = await createClient();
  const { data: orgs, error } = await supabase
    .from('organizations')
    .select('id, name, slug, status, is_demo, created_at')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw new Error('Failed to load organizations');

  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <Brand />
            <Badge tone="primary">Platform</Badge>
          </div>
          <div className="flex items-center gap-4 text-sm text-muted">
            <span className="hidden sm:inline">{user.email}</span>
            <Link href="/app" className="hover:text-fg">Workspaces</Link>
            <form action="/auth/signout" method="post">
              <button className="hover:text-fg">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <PageHeader title="Organizations" description="Tenants on this PeopleCore deployment. Opening a tenant requires membership in it." />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Card>
            {orgs.length === 0 ? (
              <EmptyState title="No organizations yet" description="Create the first tenant with the form." />
            ) : (
              <Table caption="Organizations">
                <thead>
                  <tr><Th>Name</Th><Th>URL</Th><Th>Status</Th><Th>Created</Th><Th><span className="sr-only">Actions</span></Th></tr>
                </thead>
                <tbody>
                  {orgs.map((o) => (
                    <tr key={o.id}>
                      <Td className="font-medium">
                        {o.name} {o.is_demo && <Badge tone="warning">Demo</Badge>}
                      </Td>
                      <Td className="font-mono text-xs text-muted">/app/{o.slug}</Td>
                      <Td><Badge tone={statusTone[o.status]}>{o.status}</Badge></Td>
                      <Td className="text-muted">{formatDate(o.created_at)}</Td>
                      <Td className="text-right">
                        {/* key: remount after a status change so the confirmation step resets */}
                        <OrgStatusControl key={o.status} orgId={o.id} name={o.name} status={o.status} />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
          <Card className="self-start">
            <CardHeader title="New organization" description="Seeds the standard roles. The owner manages everything else." />
            <CreateOrgForm />
          </Card>
        </div>
      </main>
    </div>
  );
}
