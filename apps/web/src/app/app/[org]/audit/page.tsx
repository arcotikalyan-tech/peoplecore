import type { Metadata } from 'next';
import Link from 'next/link';
import { pageCount } from '@peoplecore/shared';
import { Card, EmptyState, PageHeader } from '@/components/ui/surface';
import { Pagination, Table, Td, Th } from '@/components/ui/table';
import { formatDateTime, humanize } from '@/lib/format';
import { AUDIT_PAGE_SIZE, listAuditEvents } from '@/server/audit';
import { requirePermission } from '@/server/context';
import { namesForUsers } from '@/server/employees';

export const metadata: Metadata = { title: 'Audit log' };

const ACTION_LABELS: Record<string, string> = { insert: 'Created', update: 'Updated', delete: 'Deleted' };

export default async function AuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { org: slug } = await params;
  const ctx = await requirePermission(slug, 'audit.read', 'org');
  const requested = Number.parseInt((await searchParams).page ?? '1', 10);
  const page = Number.isFinite(requested) && requested >= 1 ? Math.min(requested, 10_000) : 1;

  const { rows, total } = await listAuditEvents(ctx.org.id, page);
  const actors = await namesForUsers(ctx.org.id, rows.map((r) => r.actor_user_id).filter((x): x is string => !!x));
  const base = `/app/${slug}/audit`;

  return (
    <>
      <PageHeader title="Audit log" description="Append-only record of changes. Entries cannot be edited or deleted, by anyone." />
      <Card>
        {rows.length === 0 ? (
          <EmptyState title="No audit events" description={page > 1 ? 'This page is past the end of the log.' : undefined} />
        ) : (
          <>
            <Table caption="Audit events">
              <thead>
                <tr><Th>When</Th><Th>Who</Th><Th>Action</Th><Th>Record</Th><Th>Changes</Th></tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const changes = r.changes && typeof r.changes === 'object' && !Array.isArray(r.changes) ? r.changes : null;
                  const isEmployee = r.entity_type === 'employees' && r.entity_id;
                  return (
                    <tr key={r.id} className="align-top">
                      <Td className="whitespace-nowrap text-muted">{formatDateTime(r.occurred_at, ctx.org.timezone)}</Td>
                      <Td>{r.actor_user_id ? (actors.get(r.actor_user_id) ?? <span className="text-muted">User …{r.actor_user_id.slice(-6)}</span>) : <span className="text-muted">System</span>}</Td>
                      <Td>{ACTION_LABELS[r.action] ?? r.action}</Td>
                      <Td>
                        {isEmployee ? (
                          <Link href={`/app/${slug}/employees/${r.entity_id}`} className="text-primary hover:underline">Employee</Link>
                        ) : (
                          humanize(r.entity_type)
                        )}
                      </Td>
                      <Td className="max-w-md">
                        {changes && (
                          <details>
                            <summary className="cursor-pointer text-muted hover:text-fg">
                              {r.action === 'update' ? Object.keys(changes).map(humanize).join(', ') : 'View record'}
                            </summary>
                            <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-subtle p-3 text-xs">{JSON.stringify(changes, null, 2)}</pre>
                          </details>
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            <Pagination page={page} pageCount={pageCount(total, AUDIT_PAGE_SIZE)} total={total} hrefFor={(p) => (p > 1 ? `${base}?page=${p}` : base)} />
          </>
        )}
      </Card>
    </>
  );
}
