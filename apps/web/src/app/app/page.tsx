import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Brand } from '@/components/brand';
import { ButtonLink } from '@/components/ui/button';
import { Badge, Card, EmptyState } from '@/components/ui/surface';
import { isPlatformAdmin, requireUser } from '@/server/context';
import { createClient } from '@/server/supabase';

export const metadata: Metadata = { title: 'Choose organization' };

export default async function OrganizationPicker() {
  const user = await requireUser();
  const supabase = await createClient();

  // Membership first: platform admins can *see* every organization row, but only open their own.
  const { data: memberships, error } = await supabase
    .from('organization_members')
    .select('organization_id')
    .eq('user_id', user.id)
    .eq('status', 'active');
  if (error) throw new Error('Failed to load memberships');

  const ids = memberships.map((m) => m.organization_id);
  const { data: orgs, error: orgError } = ids.length
    ? await supabase.from('organizations').select('id, name, slug, is_demo').in('id', ids).order('name')
    : { data: [], error: null };
  if (orgError) throw new Error('Failed to load organizations');

  const platformAdmin = await isPlatformAdmin();
  if (orgs.length === 1 && !platformAdmin) redirect(`/app/${orgs[0]!.slug}`);

  return (
    <main className="mx-auto max-w-lg px-4 py-16">
      <Brand />
      <h1 className="mt-8 text-xl font-semibold tracking-tight">Choose an organization</h1>
      <p className="mt-1 text-sm text-muted">Signed in as {user.email}</p>
      <Card className="mt-6">
        {orgs.length === 0 ? (
          <EmptyState
            title="You’re not a member of any organization yet"
            description="Ask your HR administrator to invite you. If you were just invited, open the link in your invitation email."
          />
        ) : (
          <ul className="divide-y divide-line">
            {orgs.map((o) => (
              <li key={o.id}>
                <Link href={`/app/${o.slug}`} className="flex items-center justify-between gap-3 px-5 py-4 hover:bg-subtle">
                  <span className="font-medium">{o.name}</span>
                  {o.is_demo && <Badge tone="warning">Demo</Badge>}
                </Link>
              </li>
            ))}
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
