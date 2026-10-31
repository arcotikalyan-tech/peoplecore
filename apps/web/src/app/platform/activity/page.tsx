import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, EmptyState, PageHeader } from '@/components/ui/surface';
import { Table, Td, Th } from '@/components/ui/table';
import { formatDateTime } from '@/lib/format';
import { describeActivity } from '@/lib/platform-activity';
import { platformActivity, platformOrgs } from '@/server/platform';

export const metadata: Metadata = { title: 'Activity' };

export default async function ActivityPage() {
  const [activity, orgs] = await Promise.all([platformActivity(null, 300), platformOrgs()]);
  const orgName = new Map(orgs.map((o) => [o.id, o.name]));
  return (
    <>
      <PageHeader title="Activity" description="Platform-level changes, newest first: organizations created, edited, suspended; plans and billing; platform administrators and settings; support access. The latest 300." />
      <Card>
        {activity.length === 0 ? <EmptyState title="No activity yet" /> : (
          <Table caption="Platform activity">
            <thead><tr><Th>When</Th><Th>What happened</Th><Th>Organization</Th><Th>By</Th></tr></thead>
            <tbody>
              {activity.map((a) => (
                <tr key={a.id}>
                  <Td className="whitespace-nowrap text-muted">{formatDateTime(a.occurred_at, 'Asia/Kolkata')}</Td>
                  <Td>{describeActivity(a)}</Td>
                  <Td>{a.organization_id
                    ? (orgName.has(a.organization_id) ? <Link href={`/platform/organizations/${a.organization_id}`} className="hover:underline">{orgName.get(a.organization_id)}</Link> : <span className="text-muted">Deleted</span>)
                    : <span className="text-muted">Platform</span>}</Td>
                  <Td className="text-muted">{a.actor_email ?? 'System'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
