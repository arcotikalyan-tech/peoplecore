import type { Metadata } from 'next';
import { Card, CardHeader, PageHeader } from '@/components/ui/surface';
import { requirePermission } from '@/server/context';
import { colleagueOptions } from '@/server/engagement';
import { getHelpdeskSettings, getTicketCategories } from '@/server/helpdesk';
import { saveCategoryAction, saveHelpdeskSettingsAction } from '../actions';
import { CategoryForm, HelpdeskSettingsForm } from '../helpdesk-forms';

export const metadata: Metadata = { title: 'Helpdesk settings' };

export default async function HelpdeskSettingsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await requirePermission(slug, 'helpdesk.manage', 'org');
  const [categories, assignees, settings] = await Promise.all([getTicketCategories(ctx.org.id, true), colleagueOptions(ctx.org.id), getHelpdeskSettings(ctx.org.id)]);
  const action = saveCategoryAction.bind(null, slug);

  return (
    <>
      <PageHeader title="Helpdesk settings"
        description="Response targets for each priority, and categories: route a category to one person (for example IT access to your IT lead). They see and work only their tickets; unrouted tickets go to helpdesk staff." />
      <Card className="mb-6">
        <CardHeader title="Response targets" description="How soon someone should respond, by priority. A ticket that passes its target is flagged and helpdesk staff are told." />
        <HelpdeskSettingsForm action={saveHelpdeskSettingsAction.bind(null, slug)} settings={settings} />
      </Card>
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
