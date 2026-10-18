import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, Card, CardHeader, PageHeader } from '@/components/ui/surface';
import { Table, Td, Th } from '@/components/ui/table';
import { formatDate } from '@/lib/format';
import { requirePermission } from '@/server/context';
import { namesFor } from '@/server/leave';
import { getCycles, getTeamReviews } from '@/server/performance';
import { calibrateAction, createCycleAction, cycleStepAction } from '../actions';
import { CalibrateForm, CycleForm, SmallAction } from '../performance-forms';

export const metadata: Metadata = { title: 'Review cycles' };

export default async function CyclesPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await requirePermission(slug, 'performance.manage', 'org');
  const [cycles, reviews] = await Promise.all([getCycles(ctx.org.id), getTeamReviews(ctx.org.id, null)]);
  const names = await namesFor(ctx.org.id, reviews.map((r) => r.employee_id));

  return (
    <>
      <PageHeader eyebrow={<Link href={`/app/${slug}/performance`} className="hover:text-fg">← Performance</Link>} title="Review cycles"
        description="Activate to open self reviews; calibrate after manager reviews; share to release results to employees." />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          {cycles.map((c) => {
            const rs = reviews.filter((r) => r.cycle_id === c.id);
            const dist = [5, 4, 3, 2, 1].map((n) => ({ n, count: rs.filter((r) => r.final_rating === n).length }));
            return (
              <Card key={c.id}>
                <CardHeader title={c.name} description={`${formatDate(c.period_start)} – ${formatDate(c.period_end)} · ${rs.length} reviews`}
                  actions={<Badge tone={c.status === 'shared' ? 'success' : c.status === 'active' ? 'warning' : 'neutral'}>{c.status}</Badge>} />
                {c.status !== 'draft' && (
                  <p className="px-5 pt-3 text-sm text-muted" aria-label={`Rating distribution for ${c.name}`}>
                    Final ratings: {dist.map((d) => `${d.n}★ ${d.count}`).join(' · ')}
                  </p>
                )}
                {rs.length > 0 && (
                  <Table caption={`Reviews in ${c.name}`}>
                    <thead><tr><Th>Employee</Th><Th>Status</Th><Th>Self</Th><Th>Manager</Th><Th>Final</Th></tr></thead>
                    <tbody>
                      {rs.map((r) => (
                        <tr key={r.id}>
                          <Td className="font-medium">{names.get(r.employee_id) ?? '—'}</Td>
                          <Td>{r.status.replace('_', ' ')}</Td>
                          <Td className="tabular-nums">{r.self_rating ?? '—'}</Td>
                          <Td className="tabular-nums">{r.manager_rating ?? '—'}</Td>
                          <Td>
                            {(c.status === 'active' || c.status === 'calibration') && (r.status === 'manager_submitted' || r.status === 'calibrated')
                              ? <CalibrateForm action={calibrateAction.bind(null, slug)} reviewId={r.id} current={r.final_rating} name={names.get(r.employee_id) ?? ''} />
                              : <span className="tabular-nums">{r.final_rating ?? '—'}</span>}
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                )}
                <div className="flex gap-2 border-t border-line px-5 py-4">
                  {c.status === 'draft' && <SmallAction action={cycleStepAction.bind(null, slug)} label={`Activate ${c.name}`} submit="Activate" hidden={{ cycleId: c.id, step: 'activate' }} />}
                  {(c.status === 'active' || c.status === 'calibration') && <SmallAction action={cycleStepAction.bind(null, slug)} label={`Share ${c.name}`} submit="Share results" hidden={{ cycleId: c.id, step: 'share' }} />}
                </div>
              </Card>
            );
          })}
          {cycles.length === 0 && <Card><p className="px-5 py-4 text-sm text-muted">No review cycles yet.</p></Card>}
        </div>
        <Card><CardHeader title="New cycle" /><CycleForm action={createCycleAction.bind(null, slug)} /></Card>
      </div>
    </>
  );
}
