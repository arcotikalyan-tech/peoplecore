import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/ui/surface';
import { requirePermission } from '@/server/context';
import { managerOptions } from '@/server/employees';
import { getStructure, structureOptions } from '@/server/structure';
import { createEmployeeAction } from '../actions';
import { EmployeeForm } from './employee-form';

export const metadata: Metadata = { title: 'Add employee' };

export default async function NewEmployeePage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await requirePermission(slug, 'employee.create');
  const [structure, managers] = await Promise.all([getStructure(ctx.org.id), managerOptions(ctx.org.id)]);
  const base = `/app/${slug}/employees`;

  return (
    <>
      <PageHeader
        eyebrow={<Link href={base} className="hover:text-fg">← Employees</Link>}
        title="Add employee"
        description="Creates the employee record and their first employment-history entry. Changes are audited."
      />
      <EmployeeForm
        action={createEmployeeAction.bind(null, slug)}
        cancelHref={base}
        options={{ ...structureOptions(structure), managers }}
      />
    </>
  );
}
