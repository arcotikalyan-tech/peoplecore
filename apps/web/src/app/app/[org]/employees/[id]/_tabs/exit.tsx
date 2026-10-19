import Link from 'next/link';
import { EMPLOYMENT_TYPE_LABELS } from '@peoplecore/shared';
import { Badge } from '@/components/ui/surface';
import { formatDate, humanize } from '@/lib/format';
import { separationFor } from '@/server/profile';
import { resignAction } from '../../../separations/actions';
import { ResignForm } from '../../../separations/separation-forms';
import { Fields, Panel, type ProfileProps } from './shared';

/** E-Exit: apply for resignation (self), or the status of the exit in progress. */
export async function ExitTab({ ctx, id, slug, base, employee, isSelf, today, structure, noticeDays }: ProfileProps & { noticeDays: number }) {
  const separation = await separationFor(ctx.org.id, id);
  const open = separation && ['submitted', 'approved'].includes(separation.status);
  const noticeEnd = (() => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + noticeDays); return d.toISOString().slice(0, 10); })();
  return (
    <div className="space-y-5">
      <Panel title="E-Exit" actions={<Badge tone="primary">Beta</Badge>}>
        <Fields items={[
          { label: 'ID', value: employee.employee_code },
          { label: 'Employee name', value: [employee.first_name, employee.last_name].filter(Boolean).join(' ') },
          { label: 'Department', value: structure.departments.find((d) => d.id === employee.department_id)?.name ?? null },
          { label: 'Joining date', value: formatDate(employee.date_of_joining) },
          { label: 'Probation end date', value: employee.probation_end_date ? formatDate(employee.probation_end_date) : null },
          { label: 'Employee type', value: EMPLOYMENT_TYPE_LABELS[employee.employment_type] },
          { label: 'Notice period', value: `${noticeDays} days` },
        ]} />
      </Panel>
      {separation && (open || !isSelf) ? (
        <Panel title="Exit in progress">
          <Fields items={[
            { label: 'Type', value: humanize(separation.type) },
            { label: 'Status', value: humanize(separation.status) },
            { label: 'Submitted on', value: formatDate(separation.submitted_on) },
            { label: 'Last working day', value: formatDate(separation.last_working_day) },
          ]} />
          <p className="border-t border-line px-5 py-3 text-sm"><Link className="text-primary hover:underline" href={`${base}/separations/${separation.id}`}>Open the exit →</Link></p>
        </Panel>
      ) : isSelf && employee.status !== 'exited' ? (
        <Panel title="Apply for Resignation">
          <p className="px-5 pt-1 text-sm text-muted">Start your exit. Your manager and HR are notified and guide you through clearance.</p>
          <ResignForm action={resignAction.bind(null, slug)} today={today} noticeDays={noticeDays} noticeEnd={noticeEnd} />
        </Panel>
      ) : !isSelf && ctx.can('separation.manage', 'org') ? (
        <Panel title="Start an exit"><p className="px-5 py-3 text-sm"><Link className="text-primary hover:underline" href={`${base}/separations`}>Start an exit for this person in Separations →</Link></p></Panel>
      ) : null}
    </div>
  );
}
