import type { Metadata } from 'next';
import Link from 'next/link';
import { isIsoDate, pageCount } from '@peoplecore/shared';
import { ActionForm } from '@/components/action-form';
import { buttonClass } from '@/components/ui/button';
import { Card, CardHeader, EmptyState, PageHeader } from '@/components/ui/surface';
import { Pagination, Table, Td, Th } from '@/components/ui/table';
import { formatDateTime, humanize } from '@/lib/format';
import { AUDIT_EXPORT_MAX, AUDIT_PAGE_SIZE, auditArchiveSummary, listAuditEvents, type AuditRange } from '@/server/audit';
import { requirePermission } from '@/server/context';
import { namesForUsers } from '@/server/employees';
import { verifyAuditArchiveAction } from './actions';

export const metadata: Metadata = { title: 'Audit log' };

const ACTION_LABELS: Record<string, string> = { insert: 'Created', update: 'Updated', delete: 'Deleted' };

export default async function AuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ page?: string; from?: string; to?: string }>;
}) {
  const { org: slug } = await params;
  const ctx = await requirePermission(slug, 'audit.read', 'org');
  const sp = await searchParams;
  const requested = Number.parseInt(sp.page ?? '1', 10);
  const page = Number.isFinite(requested) && requested >= 1 ? Math.min(requested, 10_000) : 1;
  const range: AuditRange = { from: isIsoDate(sp.from ?? '') ? sp.from : undefined, to: isIsoDate(sp.to ?? '') ? sp.to : undefined };

  const [{ rows, total }, archive] = await Promise.all([listAuditEvents(ctx.org.id, page, range, ctx.org.timezone), auditArchiveSummary(ctx.org.id)]);
  const actors = await namesForUsers(ctx.org.id, rows.map((r) => r.actor_user_id).filter((x): x is string => !!x));
  const base = `/app/${slug}/audit`;
  const query = (extra: Record<string, string>) => {
    const q = new URLSearchParams({ ...(range.from ? { from: range.from } : {}), ...(range.to ? { to: range.to } : {}), ...extra }).toString();
    return q ? `?${q}` : '';
  };
  const tooMany = total > AUDIT_EXPORT_MAX;

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Append-only record of changes. Entries cannot be edited or deleted, by anyone."
        actions={total > 0 && !tooMany ? <a href={`${base}/export${query({})}`} download className={buttonClass('secondary')}>Download CSV</a> : undefined}
      />
      <Card>
        <form method="get" action={base} className="flex flex-wrap items-end gap-3 px-5 pt-4" aria-label="Choose the period">
          <label className="text-sm">
            <span className="mb-1 block text-muted">From</span>
            <input type="date" name="from" defaultValue={range.from} className="h-9 rounded-md border border-line-strong bg-surface px-2 text-sm" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-muted">To</span>
            <input type="date" name="to" defaultValue={range.to} className="h-9 rounded-md border border-line-strong bg-surface px-2 text-sm" />
          </label>
          <button className="h-9 rounded-md border border-line px-3 text-sm hover:bg-subtle">Show</button>
          {(range.from || range.to) && <Link href={base} className="h-9 px-1 text-sm leading-9 text-primary hover:underline">All dates</Link>}
          {tooMany && <p className="w-full text-sm text-muted">{total.toLocaleString('en-IN')} entries: choose a shorter period to download them (at most {AUDIT_EXPORT_MAX.toLocaleString('en-IN')} at a time).</p>}
        </form>
        {rows.length === 0 ? (
          <EmptyState title="No audit events" description={page > 1 ? 'This page is past the end of the log.' : range.from || range.to ? 'Nothing was recorded in this period.' : undefined} />
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
            <Pagination page={page} pageCount={pageCount(total, AUDIT_PAGE_SIZE)} total={total} hrefFor={(p) => `${base}${query(p > 1 ? { page: String(p) } : {})}`} />
          </>
        )}
      </Card>
      <Card className="mt-6">
        <CardHeader title="Daily archive"
          description="Each day’s entries are also copied to a separate archive, with a chain of fingerprints (hashes) linking every day to the one before. Checking it shows whether any archived day was changed or removed since." />
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 text-sm">
          <p className="text-muted">
            {archive.latest ? <>{archive.days} day{archive.days === 1 ? '' : 's'} archived, up to {formatDateTime(`${archive.latest}T00:00:00Z`, 'UTC').split(',')[0]} (UTC).</> : 'Nothing archived yet: the first day is archived the morning after it ends (UTC).'}
          </p>
          <ActionForm action={verifyAuditArchiveAction.bind(null, slug)} label="Check the archive" submit="Check the last 30 days" variant="secondary" size="sm"
            className="flex flex-wrap items-center gap-3" />
        </div>
      </Card>
    </>
  );
}
