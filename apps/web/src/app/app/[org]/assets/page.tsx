import type { Metadata } from 'next';
import Link from 'next/link';
import { todayIn } from '@peoplecore/shared';
import { ActionForm } from '@/components/action-form';
import { ButtonLink, buttonClass } from '@/components/ui/button';
import { Badge, Card, CardHeader, PageHeader } from '@/components/ui/surface';
import { Table, Td, Th } from '@/components/ui/table';
import { formatDate } from '@/lib/format';
import { ASSET_STATUSES, assetCounts, employeeAssets, listAccess, listAssets, listSystems, type AssetStatus } from '@/server/assets';
import { getOrgContext } from '@/server/context';
import { colleagueNames } from '@/server/engagement';
import { employeeNames, getMyEmployee } from '@/server/employees';
import { acknowledgeAssetAction } from './actions';
import { ASSET_STATUS_LABEL, ASSET_TONE } from './tone';

export const metadata: Metadata = { title: 'Assets' };

export default async function AssetsPage({ params, searchParams }: {
  params: Promise<{ org: string }>; searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const { org: slug } = await params;
  const sp = await searchParams;
  const status = ASSET_STATUSES.find((s) => s === sp.status);
  const q = (sp.q ?? '').trim().slice(0, 80);
  const ctx = await getOrgContext(slug);
  const me = await getMyEmployee(ctx.org.id, ctx.user.id);
  const manages = ctx.can('asset.manage', 'org');
  const [inventory, counts, mine, myAccess, systems] = await Promise.all([
    manages ? listAssets(ctx.org.id, { status, q }) : Promise.resolve([]),
    manages ? assetCounts(ctx.org.id) : Promise.resolve(null),
    me ? employeeAssets(ctx.org.id, me.id) : Promise.resolve([]),
    me ? listAccess(ctx.org.id, { employeeId: me.id, active: true }) : Promise.resolve([]),
    listSystems(ctx.org.id, true),
  ]);
  const ownsSystem = !!me && systems.some((s) => s.is_active && s.owner_employee_id === me.id);
  const holders = inventory.flatMap((a) => (a.issue ? [a.issue.employee_id] : []));
  const [colleagues, people] = await Promise.all([colleagueNames(ctx.org.id), employeeNames(ctx.org.id, holders)]);
  const name = (id: string) => people.get(id) ?? colleagues.get(id) ?? '—';
  const systemName = new Map(systems.map((s) => [s.id, s.name]));
  const today = todayIn(ctx.org.timezone);
  const base = `/app/${slug}/assets`;
  const filtered = !!status || !!q;

  return (
    <>
      <PageHeader title="Assets" description="Equipment issued to people, and the systems they can sign in to."
        actions={<>
          {(manages || ownsSystem) && <ButtonLink href={`${base}/access`} variant="secondary">System access</ButtonLink>}
          {manages && <ButtonLink href={`${base}/new`}>Add asset</ButtonLink>}
        </>} />

      {counts && (
        <dl className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {ASSET_STATUSES.map((s) => (
            <Link key={s} href={status === s ? base : `${base}?status=${s}`}
              className={`rounded-lg border bg-surface px-4 py-3 hover:bg-subtle ${status === s ? 'border-primary' : 'border-line'}`}>
              <dt className="text-xs text-muted">{ASSET_STATUS_LABEL[s]}</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums">{counts[s]}</dd>
            </Link>
          ))}
        </dl>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          {manages && (
            <Card>
              <CardHeader title={status ? `${ASSET_STATUS_LABEL[status]} assets` : 'All assets'}
                actions={filtered ? <Link className="text-sm text-primary hover:underline" href={base}>Clear filters</Link> : undefined} />
              <form role="search" action={base} className="flex flex-wrap gap-2 border-b border-line px-5 py-3">
                {status && <input type="hidden" name="status" value={status} />}
                <label htmlFor="asset-q" className="sr-only">Search assets</label>
                <input id="asset-q" name="q" type="search" defaultValue={q} placeholder="Tag, name, serial or type"
                  className="h-9 min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-3 text-sm" />
                <button type="submit" className={buttonClass('secondary', 'sm')}>Search</button>
              </form>
              <Table caption="Assets">
                <thead><tr><Th>Tag</Th><Th>Asset</Th><Th>Status</Th><Th>With</Th><Th>Due back</Th></tr></thead>
                <tbody>
                  {inventory.length === 0 && (
                    <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-muted">
                      {filtered ? 'No assets match.' : 'No assets yet. Add your first laptop, phone or ID card.'}
                    </td></tr>
                  )}
                  {inventory.map((a) => (
                    <tr key={a.id}>
                      <Td className="tabular-nums text-muted">{a.tag}</Td>
                      <Td className="font-medium">
                        <Link className="text-primary hover:underline" href={`${base}/${a.id}`}>{a.name}</Link>
                        <span className="block text-xs font-normal text-muted">{[a.category, a.serial_number].filter(Boolean).join(' · ')}</span>
                      </Td>
                      <Td>
                        <span className="flex flex-wrap gap-1">
                          <Badge tone={ASSET_TONE[a.status as AssetStatus]}>{ASSET_STATUS_LABEL[a.status as AssetStatus]}</Badge>
                          {a.issue && !a.issue.acknowledged_at && <Badge tone="warning">Not confirmed</Badge>}
                        </span>
                      </Td>
                      <Td>{a.issue ? name(a.issue.employee_id) : <span className="text-muted">—</span>}</Td>
                      <Td className="text-muted">
                        {a.issue?.due_back_on ? (
                          <span className="flex flex-wrap items-center gap-1">
                            {formatDate(a.issue.due_back_on)}
                            {a.issue.due_back_on < today && <Badge tone="danger">Overdue</Badge>}
                          </span>
                        ) : '—'}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              {inventory.length === 300 && <p className="px-5 py-3 text-xs text-muted">Showing the first 300. Search or filter to narrow it down.</p>}
            </Card>
          )}

          {me && (
            <Card>
              <CardHeader title="Your assets" description="Equipment the organization has issued to you." />
              {mine.length === 0 ? <p className="px-5 py-4 text-sm text-muted">Nothing issued to you.</p> : (
                <ul className="divide-y divide-line" aria-label="Your assets">
                  {mine.map((i) => (
                    <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
                      <div>
                        <p className="font-medium">{i.asset.name} <span className="font-normal text-muted">{i.asset.tag}</span></p>
                        <p className="mt-0.5 text-xs text-muted">
                          {[i.asset.category, i.asset.serial_number && `Serial ${i.asset.serial_number}`, `Issued ${formatDate(i.assigned_at)}`,
                            i.due_back_on && !i.returned_at && `Due back ${formatDate(i.due_back_on)}`,
                            i.returned_at && `Returned ${formatDate(i.returned_at)}`].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      {i.returned_at ? <Badge>Returned</Badge> : i.acknowledged_at ? <Badge tone="success">Confirmed</Badge> : (
                        <ActionForm action={acknowledgeAssetAction.bind(null, slug)} label={`Confirm receipt of ${i.asset.name}`} submit="I have it"
                          hidden={{ assignmentId: i.id }} size="sm" className="flex flex-wrap items-center gap-3" />
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>

        {me && (
          <div className="space-y-6">
            <Card>
              <CardHeader title="Your system access" description="Accounts recorded for you. They are revoked when you leave." />
              {myAccess.length === 0 ? <p className="px-5 py-4 text-sm text-muted">No access recorded.</p> : (
                <ul className="divide-y divide-line" aria-label="Your system access">
                  {myAccess.map((g) => (
                    <li key={g.id} className="px-5 py-3 text-sm">
                      <p className="font-medium">{systemName.get(g.system_id) ?? 'System'}</p>
                      <p className="mt-0.5 text-xs text-muted">{[g.account, g.access_level, `Since ${formatDate(g.granted_at)}`].filter(Boolean).join(' · ')}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <p className="text-sm text-muted">
              Something broken or missing? <Link className="text-primary hover:underline" href={`/app/${slug}/helpdesk`}>Raise a ticket</Link>.
            </p>
          </div>
        )}
      </div>
    </>
  );
}
