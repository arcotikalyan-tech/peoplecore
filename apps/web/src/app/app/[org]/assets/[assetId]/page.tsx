import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { todayIn } from '@peoplecore/shared';
import { ActionForm } from '@/components/action-form';
import { ButtonLink } from '@/components/ui/button';
import { Badge, Card, CardHeader, DetailList, PageHeader } from '@/components/ui/surface';
import { formatDate } from '@/lib/format';
import { assetHistory, getAsset, type AssetStatus } from '@/server/assets';
import { requirePermission } from '@/server/context';
import { employeeNames, managerOptions } from '@/server/employees';
import { getStructure, structureOptions } from '@/server/structure';
import { deleteAssetAction, issueAssetAction, returnAssetAction, saveAssetAction, setAssetStatusAction } from '../actions';
import { AssetForm, AssetStatusForm, IssueAssetForm, ReturnAssetForm } from '../assets-forms';
import { ASSET_STATUS_LABEL, ASSET_TONE } from '../tone';

export const metadata: Metadata = { title: 'Asset' };

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });

export default async function AssetPage({ params, searchParams }: {
  params: Promise<{ org: string; assetId: string }>; searchParams: Promise<{ edit?: string }>;
}) {
  const { org: slug, assetId } = await params;
  const editing = (await searchParams).edit === '1';
  const ctx = await requirePermission(slug, 'asset.manage', 'org');
  const asset = /^[0-9a-f-]{36}$/i.test(assetId) ? await getAsset(ctx.org.id, assetId) : null;
  if (!asset) notFound();
  const [history, structure, people] = await Promise.all([
    assetHistory(ctx.org.id, asset.id),
    getStructure(ctx.org.id),
    asset.status === 'in_stock' ? managerOptions(ctx.org.id) : Promise.resolve([]),
  ]);
  const names = await employeeNames(ctx.org.id, history.map((h) => h.employee_id));
  const open = history.find((h) => !h.returned_at) ?? null;
  const location = structure.locations.find((l) => l.id === asset.location_id)?.name;
  const today = todayIn(ctx.org.timezone);
  const base = `/app/${slug}/assets`;
  const status = asset.status as AssetStatus;

  return (
    <>
      <PageHeader eyebrow={`${asset.category} · ${asset.tag}`} title={asset.name}
        actions={<>
          <Badge tone={ASSET_TONE[status]}>{ASSET_STATUS_LABEL[status]}</Badge>
          {!editing && <ButtonLink href={`${base}/${asset.id}?edit=1`} variant="secondary">Edit</ButtonLink>}
          <ButtonLink href={base} variant="ghost">All assets</ButtonLink>
        </>} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          {editing ? (
            <Card>
              <CardHeader title="Edit asset" />
              <AssetForm action={saveAssetAction.bind(null, slug)} locations={structureOptions(structure).locations}
                asset={{ ...asset, purchase_cost: asset.purchase_cost === null ? null : Number(asset.purchase_cost) }} />
            </Card>
          ) : (
            <Card>
              <CardHeader title="Details" />
              <div className="px-5 py-4">
                <DetailList items={[
                  { label: 'Tag', value: asset.tag },
                  { label: 'Serial number', value: asset.serial_number ?? '—' },
                  { label: 'Location', value: location ?? '—' },
                  { label: 'Purchased', value: [asset.purchased_on && formatDate(asset.purchased_on), asset.purchase_cost !== null && inr.format(Number(asset.purchase_cost))].filter(Boolean).join(' · ') || '—' },
                  { label: 'Warranty until', value: asset.warranty_until
                    ? <span className="flex flex-wrap items-center gap-1">{formatDate(asset.warranty_until)}{asset.warranty_until < today && <Badge>Expired</Badge>}</span>
                    : '—' },
                  { label: 'Notes', value: asset.notes ? <span className="whitespace-pre-line">{asset.notes}</span> : '—' },
                ]} />
              </div>
            </Card>
          )}

          <Card>
            <CardHeader title="Issue history" description="Every time it changed hands. Kept even after the asset is retired." />
            {history.length === 0 ? <p className="px-5 py-4 text-sm text-muted">Never issued.</p> : (
              <ol className="divide-y divide-line" aria-label="Issue history">
                {history.map((h) => (
                  <li key={h.id} className="px-5 py-3 text-sm">
                    <p className="flex flex-wrap items-center gap-2">
                      <Link className="font-medium text-primary hover:underline" href={`/app/${slug}/employees/${h.employee_id}`}>{names.get(h.employee_id) ?? 'Employee'}</Link>
                      {!h.returned_at && (h.acknowledged_at ? <Badge tone="success">Confirmed</Badge> : <Badge tone="warning">Not confirmed</Badge>)}
                      {!h.returned_at && h.due_back_on && h.due_back_on < today && <Badge tone="danger">Overdue</Badge>}
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      {[`Issued ${formatDate(h.assigned_at)}`, h.condition_out, h.due_back_on && `due back ${formatDate(h.due_back_on)}`].filter(Boolean).join(' · ')}
                    </p>
                    {h.returned_at && (
                      <p className="mt-0.5 text-xs text-muted">{[`Returned ${formatDate(h.returned_at)}`, h.condition_in].filter(Boolean).join(' · ')}</p>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          {status === 'in_stock' && (
            <Card>
              <CardHeader title="Issue" description="They’ll be asked to confirm they have it." />
              <IssueAssetForm action={issueAssetAction.bind(null, slug)} assetId={asset.id} people={people} today={today} />
            </Card>
          )}
          {open && (
            <Card>
              <CardHeader title="Take back" description={`With ${names.get(open.employee_id) ?? 'an employee'} since ${formatDate(open.assigned_at)}.`} />
              <ReturnAssetForm action={returnAssetAction.bind(null, slug)} assetId={asset.id} />
            </Card>
          )}
          {!open && (
            <Card>
              <CardHeader title="Status" />
              <AssetStatusForm action={setAssetStatusAction.bind(null, slug)} assetId={asset.id} status={status} />
              {history.length === 0 && (
                <ActionForm action={deleteAssetAction.bind(null, slug)} label="Delete asset" submit="Delete asset" hidden={{ assetId: asset.id }}
                  variant="ghost" size="sm" className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-3" />
              )}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
