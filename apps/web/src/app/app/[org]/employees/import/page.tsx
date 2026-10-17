import type { Metadata } from 'next';
import Link from 'next/link';
import { IMPORT_COLUMNS } from '@peoplecore/shared';
import { buttonClass } from '@/components/ui/button';
import { Card, CardHeader, PageHeader } from '@/components/ui/surface';
import { requirePermission } from '@/server/context';
import { importEmployeesAction } from './actions';
import { ImportForm } from './import-form';

export const metadata: Metadata = { title: 'Import employees' };

export default async function ImportPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  await requirePermission(slug, 'employee.create', 'org');
  const base = `/app/${slug}/employees`;

  return (
    <>
      <PageHeader
        eyebrow={<Link href={base} className="hover:text-fg">← Employees</Link>}
        title="Import employees"
        description="Check a CSV file first: every row is validated against the same rules as the add form, and nothing is saved until you confirm. One problem stops the whole import, so you never end up with half a file."
        actions={<a href={`${base}/import/template`} className={buttonClass('secondary')} download>Download template</a>}
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)]">
        <Card>
          <CardHeader title="Upload" />
          <ImportForm action={importEmployeesAction.bind(null, slug)} directoryHref={base} />
        </Card>
        <Card>
          <CardHeader title="Columns" description="Headers are matched by name, in any order. Required columns are marked." />
          <ul className="divide-y divide-line text-sm">
            {IMPORT_COLUMNS.map((c) => (
              <li key={c.key} className="flex justify-between gap-3 px-5 py-2">
                <span className="font-medium">{c.header}{c.required && <span className="text-danger" aria-label="required"> *</span>}</span>
                <span className="text-right text-muted">{HINTS[c.key]}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}

const HINTS: Record<(typeof IMPORT_COLUMNS)[number]['key'], string> = {
  employee_code: 'Blank: generated automatically',
  first_name: 'Up to 100 characters',
  middle_name: '',
  last_name: '',
  work_email: 'Must be unique',
  work_phone: 'e.g. +91 98765 43210',
  employment_type: 'Permanent, Contract, Intern, Temporary or Consultant',
  date_of_joining: 'YYYY-MM-DD or DD/MM/YYYY',
  probation_end_date: 'On or after joining',
  department_code: 'An active department’s code',
  designation: 'An active designation’s title',
  location_code: 'An active location’s code',
  manager_code: 'Employee code of the manager (existing, or another row)',
};
