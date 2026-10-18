import type { Metadata } from 'next';
import Link from 'next/link';
import { Alert, Card, CardHeader, PageHeader } from '@/components/ui/surface';
import { aiServerStatus, aiSettings } from '@/server/ai';
import { getOrgContext } from '@/server/context';
import { askAction, rateAnswerAction } from './actions';
import { AskForm } from './ask-form';

export const metadata: Metadata = { title: 'Ask HR' };

export default async function AssistantPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await getOrgContext(slug);
  const base = `/app/${slug}`;
  const settings = await aiSettings(ctx.org.id);
  const server = aiServerStatus();
  const ready = ctx.can('ai.use') && settings.enabled && server.configured;

  return (
    <>
      <PageHeader title="Ask HR" description="Questions about leave, attendance, expenses and other policies, answered from your organization’s published policies and knowledge base." />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title="Ask a question" description="The assistant only reads what you can read, cites where the answer comes from, and says so when it can’t find it." />
          {ready ? (
            <AskForm action={askAction.bind(null, slug)} rate={rateAnswerAction.bind(null, slug)} base={base} />
          ) : (
            <div className="px-5 py-4">
              <Alert tone="info" title={!ctx.can('ai.use') ? 'AI assistants aren’t part of your role.' : !settings.enabled ? 'AI assistants are turned off for this organization.' : 'AI isn’t set up on this server yet.'}>
                {ctx.can('ai.manage') && !settings.enabled && <Link className="font-medium text-primary hover:underline" href={`${base}/ai`}>Turn them on →</Link>}
                {!(ctx.can('ai.manage') && !settings.enabled) && <>Browse the <Link className="text-primary hover:underline" href={`${base}/knowledge`}>knowledge base</Link> or <Link className="text-primary hover:underline" href={`${base}/policies`}>policies</Link> instead.</>}
              </Alert>
            </div>
          )}
        </Card>
        <Card>
          <CardHeader title="Good to know" />
          <ul className="list-disc space-y-2 py-4 pl-9 pr-5 text-sm text-muted">
            <li>Answers come only from published policies and knowledge-base articles, never from the internet.</li>
            <li>It can’t see your own records. Your leave balance, payslips and requests are on their own pages.</li>
            <li>Email addresses, phone numbers and ID numbers you type are masked before the question is sent.</li>
            <li>Not found or not sure? <Link className="text-primary hover:underline" href={`${base}/helpdesk`}>Raise a helpdesk ticket</Link>.</li>
          </ul>
        </Card>
      </div>
    </>
  );
}
