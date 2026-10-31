import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { Alert, Card, CardHeader, PageHeader } from '@/components/ui/surface';
import { planSummary } from '@/lib/plans';
import { platformPlans, platformSettings } from '@/server/platform';
import { createClient } from '@/server/supabase';
import { CreateOrgForm } from './create-org-form';

export const metadata: Metadata = { title: 'New organization' };

export default async function NewOrganizationPage({ searchParams }: { searchParams: Promise<{ request?: string }> }) {
  const { request } = await searchParams;
  const [plans, settings, host] = await Promise.all([platformPlans(), platformSettings(), headers().then((h) => h.get('host') ?? 'hrms.tazq.io')]);
  const supabase = await createClient();
  const { data: req } = request && /^[0-9a-f-]{36}$/.test(request)
    ? await supabase.from('access_requests').select('id, company, contact_name, work_email, headcount').eq('id', request).maybeSingle()
    : { data: null };
  const offered = plans.filter((p) => p.is_active);

  return (
    <>
      <PageHeader title="New organization" eyebrow={<Link href="/platform/organizations" className="hover:text-fg">← Organizations</Link>}
        description="Sets up the workspace with the standard roles, its plan and trial, and emails the owner." />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardHeader title="Organization" />
          {req && <div className="px-5 pt-4"><Alert tone="info" title={`From the sign-up request by ${req.contact_name} (${req.headcount ?? 'size not given'})`}>It’s marked onboarded once the organization is created.</Alert></div>}
          <CreateOrgForm host={host} defaultPlan={offered.some((p) => p.code === settings.defaultPlan) ? settings.defaultPlan : (offered[0]?.code ?? '')}
            plans={offered.map((p) => ({ code: p.code, label: `${p.name} · ${planSummary(p)}`, trialDays: p.trial_days }))}
            prefill={req ? { name: req.company, ownerEmail: req.work_email, requestId: req.id } : undefined} />
        </Card>
        <Card className="self-start">
          <CardHeader title="What happens next" />
          <ol className="list-decimal space-y-2 px-5 py-4 pl-9 text-sm text-muted">
            <li>The workspace is created with the standard roles (owner, HR, payroll, managers, employees…).</li>
            <li>The owner is emailed: a link to choose their password if they’re new, and a welcome email with the plan and trial.</li>
            <li>They sign in and follow the setup checklist: company details, locations, holidays, leave, attendance, employees and payroll.</li>
            <li>Change the plan, trial or billing any time from the organization’s page.</li>
          </ol>
        </Card>
      </div>
    </>
  );
}
