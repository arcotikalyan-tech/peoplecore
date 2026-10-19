import type { Metadata } from 'next';
import { PageHeader } from '@/components/ui/surface';
import { requirePermission } from '@/server/context';
import { DepartmentsSection, DesignationsSection, LocationsSection } from './sections';

export const metadata: Metadata = { title: 'Organization structure' };

export default async function StructurePage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await requirePermission(slug, 'org.read');
  const canManage = ctx.can('org.manage');
  return (
    <>
      <PageHeader
        title="Organization structure"
        description={canManage
          ? 'Departments, designations and locations used across PeopleCore. Items in use can’t be archived. Every change is audited.'
          : 'Read-only view of your organization’s structure.'}
      />
      <div className="space-y-6">
        <DepartmentsSection ctx={ctx} slug={slug} />
        <DesignationsSection ctx={ctx} slug={slug} />
        <LocationsSection ctx={ctx} slug={slug} />
      </div>
    </>
  );
}
