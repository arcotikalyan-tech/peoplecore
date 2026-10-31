import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, PageHeader } from '@/components/ui/surface';
import { platformOrgs, platformPlans } from '@/server/platform';
import { PlanForm } from '../plan-form';

export const metadata: Metadata = { title: 'Edit plan' };

export default async function EditPlanPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const [plans, orgs] = await Promise.all([platformPlans(), platformOrgs()]);
  const plan = plans.find((p) => p.code === code);
  if (!plan) notFound();
  const on = orgs.filter((o) => o.plan_code === code).length;
  return (
    <>
      <PageHeader title={`Edit ${plan.name}`} eyebrow={<Link href="/platform/plans" className="hover:text-fg">← Plans</Link>}
        description={on ? `${on} organization${on === 1 ? ' is' : 's are'} on this plan: changes apply to ${on === 1 ? 'it' : 'them'} straight away.` : 'No organization is on this plan yet.'} />
      <Card className="p-5"><PlanForm plan={plan} /></Card>
    </>
  );
}
