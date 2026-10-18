import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { legalName, todayIn } from '@peoplecore/shared';
import { ButtonLink } from '@/components/ui/button';
import { formatDate } from '@/lib/format';
import { getOrgContext } from '@/server/context';
import { getEmployee, getMyEmployee } from '@/server/employees';
import { getSeparation } from '@/server/separations';
import { getStructure } from '@/server/structure';
import { PrintButton } from './print-button';

export const metadata: Metadata = { title: 'Letter' };

/** Relieving and experience letters, rendered for printing (or saving as PDF from the browser). */
export default async function LetterPage({ params }: { params: Promise<{ org: string; separationId: string; kind: string }> }) {
  const { org: slug, separationId, kind } = await params;
  if (kind !== 'relieving' && kind !== 'experience') notFound();
  const ctx = await getOrgContext(slug);
  const s = /^[0-9a-f-]{36}$/i.test(separationId) ? await getSeparation(ctx.org.id, separationId) : null;
  if (!s) notFound();
  const me = await getMyEmployee(ctx.org.id, ctx.user.id);
  const hr = ctx.can('separation.manage', 'org');
  const allowed = (hr && (s.status === 'approved' || s.status === 'completed')) || (me?.id === s.employee_id && s.status === 'completed');
  if (!allowed) notFound();
  const [employee, structure] = await Promise.all([getEmployee(ctx.org.id, s.employee_id), getStructure(ctx.org.id)]);
  if (!employee) notFound();
  const name = legalName(employee);
  const designation = structure.designations.find((d) => d.id === employee.designation_id)?.title;
  const department = structure.departments.find((d) => d.id === employee.department_id)?.name;
  const role = [designation, department && `in ${department}`].filter(Boolean).join(' ') || 'an employee';
  const draft = s.status !== 'completed';

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center gap-3 print:hidden">
        <PrintButton />
        <ButtonLink href={`/app/${slug}/separations/${s.id}`} variant="ghost">Back</ButtonLink>
        {draft && <span className="text-sm text-warning">Draft: the employee hasn’t left yet.</span>}
      </div>
      <article className="mx-auto max-w-2xl space-y-6 rounded-lg border border-line bg-surface p-10 text-[15px] leading-7 print:border-0 print:p-0">
        <header className="flex items-start justify-between gap-6">
          <p className="text-lg font-semibold">{ctx.org.name}</p>
          <p className="text-sm text-muted">{formatDate(todayIn(ctx.org.timezone))}</p>
        </header>
        <h1 className="text-xl font-semibold">{kind === 'relieving' ? 'Relieving letter' : 'Experience letter'}</h1>
        <p>To whom it may concern,</p>
        {kind === 'relieving' ? (
          <p>
            This is to confirm that <strong>{name}</strong> (employee code {employee.employee_code}), {role}, has been relieved of all duties
            with {ctx.org.name} with effect from the close of business on <strong>{formatDate(s.last_working_day)}</strong>
            {s.type === 'resignation' ? `, following their resignation dated ${formatDate(s.submitted_on)}` : ''}.
            All handover and clearance formalities {draft ? 'are in progress' : 'have been completed'}.
          </p>
        ) : (
          <p>
            This is to certify that <strong>{name}</strong> (employee code {employee.employee_code}) worked with {ctx.org.name} as {role} from{' '}
            <strong>{formatDate(employee.date_of_joining)}</strong> to <strong>{formatDate(s.last_working_day)}</strong>.
          </p>
        )}
        <p>We thank {name} for their contribution and wish them the very best.</p>
        <div className="pt-10">
          <p className="font-medium">For {ctx.org.name}</p>
          <p className="text-muted">Human Resources</p>
        </div>
        <footer className="border-t border-line pt-4 text-xs text-muted">Issued through PeopleCore. Reference {s.id.slice(0, 8).toUpperCase()}.</footer>
      </article>
    </>
  );
}
