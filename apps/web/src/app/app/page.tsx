import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Brand } from '@/components/brand';
import { ButtonLink } from '@/components/ui/button';
import { Alert, Badge, Card, EmptyState } from '@/components/ui/surface';
import { isPlatformAdmin, requirePasswordSet, requireUser } from '@/server/context';
import { createClient } from '@/server/supabase';

export const metadata: Metadata = { title: 'Choose organization' };

export default async function OrganizationPicker({ searchParams }: { searchParams: Promise<{ suspended?: string }> }) {
  const user = await requireUser();
  const supabase = await createClient();

  // First visit after an invitation: activate pending memberships (idempotent, audited).
  const { error: acceptError } = await supabase.rpc('accept_invitations');
  if (acceptError) throw new Error('Failed to accept invitations');
  await requirePasswordSet('/app');

  // The caller's own memberships, including suspended organizations. (Platform admins can *see* every
  // organization row, but only open those they belong to.)
  const { data: orgs, error } = await supabase.rpc('my_organizations');
  if (error) throw new Error('Failed to load organizations');

  const platformAdmin = await isPlatformAdmin();
  const { suspended } = await searchParams;
  const suspendedOrg = suspended ? orgs.find((o) => o.slug === suspended && o.status !== 'active') : undefined;
  if (orgs.length === 1 && orgs[0]!.status === 'active' && !platformAdmin && !suspendedOrg) redirect(`/app/${orgs[0]!.slug}`);

  return (
    <main className="mx-auto max-w-lg px-4 py-16">
      <Brand />
      <h1 className="mt-8 text-xl font-semibold tracking-tight">Choose an organization</h1>
      <p className="mt-1 text-sm text-muted">Signed in as {user.email}</p>
      {suspendedOrg && (
        <div className="mt-6">
          <Alert tone="warning" title={`Access to ${suspendedOrg.name} is suspended`}>
            Your organization’s PeopleCore account has been suspended, so its records can’t be opened right now. Contact your HR
            administrator or PeopleCore support.
          </Alert>
        </div>
      )}
      <Card className="mt-6">
        {orgs.length === 0 ? (
          <EmptyState
            title="You’re not a member of any organization yet"
            description="Ask your HR administrator to invite you. If you were just invited, open the link in your invitation email."
          />
        ) : (
          <ul className="divide-y divide-line">
            {orgs.map((o) =>
              o.status === 'active' ? (
                <li key={o.id}>
                  <Link href={`/app/${o.slug}`} className="flex items-center justify-between gap-3 px-5 py-4 hover:bg-subtle">
                    <span className="font-medium">{o.name}</span>
                    {o.is_demo && <Badge tone="warning">Demo</Badge>}
                  </Link>
                </li>
              ) : (
                <li key={o.id} className="flex items-center justify-between gap-3 px-5 py-4">
                  <span className="font-medium text-muted">{o.name}</span>
                  <Badge tone="neutral">{o.status === 'suspended' ? 'Suspended' : 'Archived'}</Badge>
                </li>
              ),
            )}
          </ul>
        )}
      </Card>
      <div className="mt-6 flex items-center justify-between">
        {platformAdmin ? <ButtonLink href="/platform" variant="secondary" size="sm">Platform console</ButtonLink> : <span />}
        <form action="/auth/signout" method="post">
          <button className="text-sm text-muted hover:text-fg">Sign out</button>
        </form>
      </div>
    </main>
  );
}
