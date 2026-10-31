import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, PageHeader } from '@/components/ui/surface';
import { PlanForm } from '../plan-form';

export const metadata: Metadata = { title: 'New plan' };

export default function NewPlanPage() {
  return (
    <>
      <PageHeader title="New plan" eyebrow={<Link href="/platform/plans" className="hover:text-fg">← Plans</Link>}
        description="Organizations can be moved to it once it’s added." />
      <Card className="p-5"><PlanForm plan={null} /></Card>
    </>
  );
}
