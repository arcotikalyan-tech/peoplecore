import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Alert, Card, CardHeader, PageHeader } from '@/components/ui/surface';
import { Table, Td, Th } from '@/components/ui/table';
import { aiServerStatus, aiSettings, aiUsage } from '@/server/ai';
import { getOrgContext } from '@/server/context';
import { saveAiSettingsAction } from './actions';
import { AiSettingsForm } from './ai-settings-form';
import { AGENT_LABEL } from './labels';

export const metadata: Metadata = { title: 'AI assistants' };

const n = (v: number | bigint) => Number(v).toLocaleString('en-IN');

export default async function AiSettingsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await getOrgContext(slug);
  if (!ctx.can('ai.manage', 'org')) notFound();
  const [settings, usage] = await Promise.all([aiSettings(ctx.org.id), aiUsage(ctx.org.id)]);
  const server = aiServerStatus();
  const used = usage.reduce((sum, u) => sum + Number(u.tokens), 0);
  const pct = Math.min(100, Math.round((used / settings.monthly_token_budget) * 100));

  return (
    <>
      <PageHeader title="AI assistants" description="Assistants answer, read documents and draft text. Their output is always a suggestion that a person checks and submits." />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Settings" />
            <AiSettingsForm action={saveAiSettingsAction.bind(null, slug)} enabled={settings.enabled}
              budget={settings.monthly_token_budget} hourly={settings.hourly_limit_per_user} />
          </Card>
          <Card>
            <CardHeader title="This month" description={`${n(used)} of ${n(settings.monthly_token_budget)} tokens (${pct}%)`} />
            <div className="px-5 pt-4">
              <div className="h-2 overflow-hidden rounded-full bg-subtle" role="progressbar" aria-label="Budget used" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-full rounded-full bg-ai" style={{ width: `${pct}%` }} />
              </div>
            </div>
            <Table caption="AI use this month">
              <thead><tr><Th>Assistant</Th><Th>Requests</Th><Th>Failed</Th><Th>Tokens</Th><Th>Helpful</Th><Th>Not helpful</Th><Th>People</Th></tr></thead>
              <tbody>
                {usage.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-sm text-muted">No AI use this month.</td></tr>}
                {usage.map((u) => (
                  <tr key={u.agent}>
                    <Td className="font-medium">{AGENT_LABEL[u.agent] ?? u.agent}</Td>
                    <Td className="tabular-nums">{n(u.runs)}</Td>
                    <Td className="tabular-nums">{n(u.failed)}</Td>
                    <Td className="tabular-nums">{n(u.tokens)}</Td>
                    <Td className="tabular-nums">{n(u.helpful)}</Td>
                    <Td className="tabular-nums">{n(u.not_helpful)}</Td>
                    <Td className="tabular-nums">{n(u.users)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="On this server" />
            <div className="space-y-3 px-5 py-4 text-sm">
              <p>Model provider: <span className="font-medium">{server.label}</span></p>
              {!server.configured && (
                <Alert tone="warning" title="No model provider is configured.">
                  Whoever runs PeopleCore sets ANTHROPIC_API_KEY on the server (see docs/runbooks/ai.md). Until then the assistants say they aren’t set up.
                </Alert>
              )}
            </div>
          </Card>
          <Card>
            <CardHeader title="How data is handled" />
            <ul className="list-disc space-y-2 py-4 pl-9 pr-5 text-sm text-muted">
              <li>Assistants read data as the person asking, so they only see what that person could see.</li>
              <li>Email addresses, phone numbers, PAN, Aadhaar and bank details typed into a question are masked before it is sent.</li>
              <li>Drafts and extracted fields are suggestions. A person checks them and submits the normal form; approvals still apply.</li>
              <li>No assistant can approve, reject, change pay or end employment.</li>
              <li>What was sent and returned is kept for 30 days for troubleshooting, then deleted. Nobody in the organization can read it.</li>
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
