import type { Metadata } from 'next';
import Link from 'next/link';
import { ButtonLink, buttonClass } from '@/components/ui/button';
import { Badge, Card, CardHeader, PageHeader } from '@/components/ui/surface';
import { getOrgContext } from '@/server/context';
import { listArticles, searchKnowledge } from '@/server/helpdesk';
import { requireModule } from '@/server/modules';

export const metadata: Metadata = { title: 'Knowledge base' };

export default async function KnowledgePage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<{ q?: string }> }) {
  const { org: slug } = await params;
  const q = ((await searchParams).q ?? '').trim().slice(0, 200);
  const ctx = await getOrgContext(slug);
  await requireModule(ctx.org.id, 'knowledge');
  const editor = ctx.can('helpdesk.manage', 'org');
  const [results, all] = await Promise.all([searchKnowledge(ctx.org.id, q), editor ? listArticles(ctx.org.id) : Promise.resolve([])]);
  const drafts = new Set(all.filter((a) => !a.published).map((a) => a.id));
  const base = `/app/${slug}/knowledge`;

  return (
    <>
      <PageHeader title="Knowledge base" description="Answers to common questions about pay, leave, attendance and tools."
        actions={<>
          <ButtonLink href={`/app/${slug}/helpdesk`} variant="secondary">Raise a ticket</ButtonLink>
          {editor && <ButtonLink href={`${base}/new`}>New article</ButtonLink>}
        </>} />
      <form role="search" className="mb-6 flex max-w-xl gap-2" action={base}>
        <label htmlFor="kb-q" className="sr-only">Search articles</label>
        <input id="kb-q" name="q" type="search" defaultValue={q} placeholder="Search, e.g. payslip or VPN"
          className="h-10 flex-1 rounded-md border border-line-strong bg-surface px-3 text-sm" />
        <button type="submit" className={buttonClass('primary')}>Search</button>
      </form>
      <Card>
        <CardHeader title={q ? `Results for “${q}”` : 'Articles'} />
        {results.length === 0 ? (
          <p className="px-5 py-4 text-sm text-muted">{q ? 'Nothing matches. Try other words, or raise a ticket.' : 'No articles yet.'}</p>
        ) : (
          <ul className="divide-y divide-line" aria-label="Articles">
            {results.map((a) => (
              <li key={a.id} className="px-5 py-3">
                <Link href={`${base}/${a.id}`} className="font-medium text-primary hover:underline">{a.title}</Link>
                <span className="ml-2 inline-flex gap-1 align-middle">
                  {a.category && <Badge>{a.category}</Badge>}
                  {drafts.has(a.id) && <Badge tone="warning">Draft</Badge>}
                </span>
                <p className="mt-1 line-clamp-2 text-sm text-muted">{a.snippet}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {editor && drafts.size > 0 && <p className="mt-3 text-xs text-muted">Drafts are visible only to helpdesk staff.</p>}
    </>
  );
}
