import type { Metadata } from 'next';
import Link from 'next/link';
import { HubTabs } from '@/components/ui/hub';
import { Card, EmptyState, PageHeader } from '@/components/ui/surface';
import { Table, Td, Th } from '@/components/ui/table';
import { formatDate } from '@/lib/format';
import { createClient } from '@/server/supabase';
import { setAccessRequestStatusAction } from '../actions';

export const metadata: Metadata = { title: 'Sign-up requests' };

const STATUSES = ['new', 'contacted', 'onboarded', 'declined'] as const;

export default async function RequestsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab = 'open' } = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.from('access_requests')
    .select('id, company, contact_name, work_email, phone, headcount, message, status, created_at, reviewed_at')
    .order('created_at', { ascending: false }).limit(500);
  const all = data ?? [];
  const open = all.filter((r) => r.status === 'new' || r.status === 'contacted');
  const shown = tab === 'all' ? all : tab === 'closed' ? all.filter((r) => r.status === 'onboarded' || r.status === 'declined') : open;

  return (
    <>
      <PageHeader title="Sign-up requests" description="Companies that asked for a workspace on the website. Create their organization from the request, and it’s marked onboarded." />
      <HubTabs base="/platform/requests" current={tab} label="Requests" tabs={[
        { key: 'open', label: 'Open', count: open.length },
        { key: 'closed', label: 'Onboarded or declined' },
        { key: 'all', label: 'All' },
      ]} />
      <Card>
        {shown.length === 0 ? (
          <EmptyState title={tab === 'open' ? 'No open requests' : 'No requests'} description="Requests from the website’s sign-up page appear here, and every platform administrator is emailed." />
        ) : (
          <Table caption="Sign-up requests">
            <thead>
              <tr><Th>Company</Th><Th>Contact</Th><Th>Team</Th><Th>Received</Th><Th>Status</Th><Th><span className="sr-only">Actions</span></Th></tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id}>
                  <Td><span className="font-medium">{r.company}</span>{r.message && <p className="mt-1 max-w-xs text-xs text-muted">{r.message}</p>}</Td>
                  <Td>{r.contact_name}<p className="text-xs text-muted">{r.work_email}{r.phone ? ` · ${r.phone}` : ''}</p></Td>
                  <Td className="text-muted">{r.headcount ?? '—'}</Td>
                  <Td className="text-muted">{formatDate(r.created_at)}</Td>
                  <Td>
                    <form action={setAccessRequestStatusAction} className="flex items-center gap-2">
                      <input type="hidden" name="id" value={r.id} />
                      <select name="status" defaultValue={r.status} aria-label={`Status of ${r.company}`} className="h-8 rounded-md border border-line bg-surface px-2 text-sm">
                        {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                      <button className="text-sm text-primary hover:underline">Save</button>
                    </form>
                  </Td>
                  <Td className="text-right">
                    {r.status !== 'onboarded' && r.status !== 'declined' && (
                      <Link href={`/platform/organizations/new?request=${r.id}`} className="whitespace-nowrap text-sm font-medium text-primary hover:underline">Create organization</Link>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
