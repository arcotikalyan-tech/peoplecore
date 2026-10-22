import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/surface';
import { getOrgContext } from '@/server/context';
import { orgSetup } from '@/server/setup';
import { SetupChecklist } from './checklist';

export const metadata: Metadata = { title: 'Organization setup' };

/** Organization setup, for the owner and HR (org.manage or onboarding.manage): every step with its progress. */
export default async function SetupPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await getOrgContext(slug);
  if (!ctx.can('org.manage', 'org') && !ctx.can('onboarding.manage', 'org')) notFound();
  const progress = await orgSetup(ctx.org.id);
  if (!progress) notFound();
  return (
    <>
      <PageHeader title="Organization setup" description={`What ${ctx.org.name} needs before everyone starts using PeopleCore for attendance, leave and payroll.`} />
      <div className="max-w-4xl">
        <SetupChecklist slug={slug} orgName={ctx.org.name} progress={progress} />
      </div>
    </>
  );
}
