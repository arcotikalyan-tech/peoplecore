import Link from 'next/link';
import { EMPLOYMENT_TYPE_LABELS } from '@peoplecore/shared';
import { Badge } from '@/components/ui/surface';
import { formatDate, humanize } from '@/lib/format';
import { reviewsFor } from '@/server/profile';
import { Empty, Fields, Panel, type ProfileProps } from './shared';

/** PMS: the self-appraisal header and every review cycle this person is in. */
export async function PmsTab({ ctx, id, employee, base, isSelf, structure, noticeDays }: ProfileProps & { noticeDays: number }) {
  const reviews = await reviewsFor(ctx.org.id, id);
  const department = structure.departments.find((d) => d.id === employee.department_id)?.name ?? null;
  return (
    <div className="space-y-5">
      <Panel title="Performance Management · Self Appraisal">
        <Fields items={[
          { label: 'ID', value: employee.employee_code },
          { label: 'Employee name', value: [employee.first_name, employee.last_name].filter(Boolean).join(' ') },
          { label: 'Department', value: department },
          { label: 'Joining date', value: formatDate(employee.date_of_joining) },
          { label: 'Probation end date', value: employee.probation_end_date ? formatDate(employee.probation_end_date) : null },
          { label: 'Employee type', value: EMPLOYMENT_TYPE_LABELS[employee.employment_type] },
          { label: 'Notice period', value: `${noticeDays} days` },
        ]} />
      </Panel>
      <Panel title="Review Cycles">
        {reviews.length === 0 ? <Empty icon="⭐" title="No review cycles yet" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" aria-label="Review cycles">
              <thead className="text-left text-[11px] uppercase tracking-wider text-muted"><tr><th className="px-5 py-2">S.No.</th><th className="px-3">Review cycle name</th><th className="px-3">Status</th><th className="px-3">Evaluation start</th><th className="px-3">Evaluation end</th><th className="px-3">Final rating</th></tr></thead>
              <tbody className="divide-y divide-line">
                {reviews.map((r, i) => (
                  <tr key={r.id}>
                    <td className="px-5 py-2">{i + 1}</td>
                    <td className="px-3 font-medium">{isSelf || ctx.can('performance.read', 'org') ? <Link className="hover:underline" href={`${base}/performance`}>{r.cycle?.name ?? 'Review'}</Link> : (r.cycle?.name ?? 'Review')}</td>
                    <td className="px-3"><Badge tone={r.status === 'calibrated' ? 'success' : r.status === 'not_started' ? 'neutral' : 'primary'}>{humanize(r.status)}</Badge></td>
                    <td className="px-3">{r.cycle ? formatDate(r.cycle.period_start) : '—'}</td>
                    <td className="px-3">{r.cycle ? formatDate(r.cycle.period_end) : '—'}</td>
                    <td className="px-3">{r.final_rating ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
