import type { Metadata } from 'next';
import { Card, CardHeader, PageHeader } from '@/components/ui/surface';
import { requirePermission } from '@/server/context';
import { saveArticleAction } from '../../helpdesk/actions';
import { ArticleForm } from '../../helpdesk/helpdesk-forms';

export const metadata: Metadata = { title: 'New article' };

export default async function NewArticlePage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  await requirePermission(slug, 'helpdesk.manage', 'org');
  return (
    <>
      <PageHeader title="New article" description="Write answers once; employees find them before raising a ticket." />
      <Card><CardHeader title="Article" /><ArticleForm action={saveArticleAction.bind(null, slug)} /></Card>
    </>
  );
}
