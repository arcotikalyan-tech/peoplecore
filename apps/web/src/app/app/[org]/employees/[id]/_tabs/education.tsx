import { QUALIFICATION_LEVEL_LABELS } from '@peoplecore/shared';
import { qualifications } from '@/server/profile';
import { addQualificationAction, removeProfileRowAction } from '../actions';
import { QualificationForm, RemoveRow } from '../profile-forms';
import { Empty, Panel, type ProfileProps } from './shared';

/** Education: qualifications, newest first. The employee and HR add and remove them. */
export async function EducationTab({ ctx, slug, id, allowed }: ProfileProps) {
  const rows = await qualifications(ctx.org.id, id);
  const canEdit = allowed('employee.personal.update');
  return (
    <Panel title="Educational Info">
      {rows.length === 0 ? <Empty icon="🎓" title="No qualifications added" /> : (
        <ul className="divide-y divide-line" aria-label="Qualifications">
          {rows.map((q) => (
            <li key={q.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
              <div className="flex gap-3">
                <span className="grid size-10 place-items-center rounded-xl bg-primary-soft text-lg" aria-hidden="true">🎓</span>
                <div>
                  <p className="font-medium">{q.degree}{q.specialization && <span className="text-muted"> · {q.specialization}</span>}</p>
                  <p className="text-sm">{q.institution}</p>
                  <p className="text-xs text-muted">
                    {QUALIFICATION_LEVEL_LABELS[q.level as keyof typeof QUALIFICATION_LEVEL_LABELS]}
                    {(q.start_year || q.end_year) && ` · ${q.start_year ?? '…'} – ${q.end_year ?? 'Present'}`}
                    {q.score && ` · ${q.score}`}
                  </p>
                </div>
              </div>
              {canEdit && <RemoveRow action={removeProfileRowAction.bind(null, slug, id)} kind="qualification" id={q.id} label={q.degree} />}
            </li>
          ))}
        </ul>
      )}
      {canEdit && <QualificationForm action={addQualificationAction.bind(null, slug, id)} />}
    </Panel>
  );
}
