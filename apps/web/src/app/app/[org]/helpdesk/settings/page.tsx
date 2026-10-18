import type { Metadata } from 'next';
import { Card, CardHeader, PageHeader } from '@/components/ui/surface';
import { requirePermission } from '@/server/context';
import { colleagueOptions } from '@/server/engagement';
import { getTicketCategories } from '@/server/helpdesk';
import { saveCategoryAction } from '../actions';
import { CategoryForm } from '../helpdesk-forms';

export const metadata: Metadata = { title: 'Helpdesk categories' };

export default async function HelpdeskSettingsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await requirePermission(slug, 'helpdesk.manage', 'org');
  const [categories, assignees] = await Promise.all([getTicketCategories(ctx.org.id, true), colleagueOptions(ctx.org.id)]);
  const action = saveCategoryAction.bind(null, slug);

  return (
    <>
      <PageHeader title="Helpdesk categories"
        description="Route a category to one person (for example IT access to your IT lead). They see and work only their tickets; unrouted tickets go to helpdesk staff." />
      <Card>
        <CardHeader title="Categories" />
        <div className="divide-y divide-line">
          {categories.map((c) => <CategoryForm key={c.id} action={action} category={c} assignees={assignees} />)}
        </div>
      </Card>
      <Card className="mt-6">
        <CardHeader title="Add a category" />
        <CategoryForm action={action} assignees={assignees} />
      </Card>
    </>
  );
}
