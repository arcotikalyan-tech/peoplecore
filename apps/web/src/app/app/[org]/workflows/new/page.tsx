import type { Metadata } from 'next';
import { Card, PageHeader } from '@/components/ui/surface';
import { requirePermission } from '@/server/context';
import { saveWorkflowAction } from '../actions';
import { builderOptions } from '../options';
import { WorkflowBuilder } from '../workflow-builder';

export const metadata: Metadata = { title: 'New workflow' };

export default async function NewWorkflowPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await requirePermission(slug, 'workflow.manage', 'org');
  const options = await builderOptions(ctx.org.id);
  return (
    <>
      <PageHeader title="New workflow" description="Choose what starts it, who it applies to, and the steps. It stays off until you switch it on." />
      <Card><WorkflowBuilder action={saveWorkflowAction.bind(null, slug)} options={options} /></Card>
    </>
  );
}
