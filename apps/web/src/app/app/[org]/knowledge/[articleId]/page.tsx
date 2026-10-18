import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ButtonLink } from '@/components/ui/button';
import { Badge, Card, CardHeader, PageHeader } from '@/components/ui/surface';
import { formatDate } from '@/lib/format';
import { getOrgContext } from '@/server/context';
import { getArticle } from '@/server/helpdesk';
import { saveArticleAction } from '../../helpdesk/actions';
import { ArticleForm } from '../../helpdesk/helpdesk-forms';

export const metadata: Metadata = { title: 'Article' };

export default async function ArticlePage({ params, searchParams }: { params: Promise<{ org: string; articleId: string }>; searchParams: Promise<{ edit?: string }> }) {
  const { org: slug, articleId } = await params;
  const editing = (await searchParams).edit === '1';
  const ctx = await getOrgContext(slug);
  const article = /^[0-9a-f-]{36}$/i.test(articleId) ? await getArticle(ctx.org.id, articleId) : null;
  if (!article) notFound();
  const editor = ctx.can('helpdesk.manage', 'org');
  const base = `/app/${slug}/knowledge`;

  return (
    <>
      <PageHeader eyebrow={article.category ?? 'Knowledge base'} title={article.title}
        description={`Updated ${formatDate(article.updated_at)}`}
        actions={<>
          {!article.published && <Badge tone="warning">Draft</Badge>}
          {editor && !editing && <ButtonLink href={`${base}/${article.id}?edit=1`} variant="secondary">Edit</ButtonLink>}
          <ButtonLink href={base} variant="ghost">All articles</ButtonLink>
        </>} />
      {editing && editor ? (
        <Card><CardHeader title="Edit article" /><ArticleForm action={saveArticleAction.bind(null, slug)} article={article} /></Card>
      ) : (
        <Card>
          <div className="max-w-3xl whitespace-pre-line px-5 py-5 text-sm leading-7">{article.body}</div>
          <p className="border-t border-line px-5 py-3 text-sm text-muted">
            Didn’t answer your question? <Link className="text-primary hover:underline" href={`/app/${slug}/helpdesk`}>Raise a ticket</Link>.
          </p>
        </Card>
      )}
    </>
  );
}
