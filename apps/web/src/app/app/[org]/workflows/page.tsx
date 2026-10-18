import type { Metadata } from 'next';
import Link from 'next/link';
import { ButtonLink } from '@/components/ui/button';
import { Badge, Card, CardHeader, PageHeader } from '@/components/ui/surface';
import { Table, Td, Th } from '@/components/ui/table';
import { requirePermission } from '@/server/context';
import { listWorkflows, workflowTriggers } from '@/server/workflows';

export const metadata: Metadata = { title: 'Workflows' };

export default async function WorkflowsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await requirePermission(slug, 'workflow.manage', 'org');
  const [workflows, triggers] = await Promise.all([listWorkflows(ctx.org.id), workflowTriggers()]);
  const label = new Map(triggers.map((t) => [t.event_type, t.label]));
  const base = `/app/${slug}/workflows`;

  return (
    <>
      <PageHeader title="Workflows" description="Things that should happen automatically when something happens: welcome joiners, give managers tasks, assign training, ask for approvals."
        actions={<ButtonLink href={`${base}/new`}>New workflow</ButtonLink>} />
      <Card>
        <CardHeader title="Your workflows" description="Runs in the last 30 days" />
        <Table caption="Workflows">
          <thead><tr><Th>Workflow</Th><Th>Starts when</Th><Th>Status</Th><Th>Runs</Th></tr></thead>
          <tbody>
            {workflows.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-sm text-muted">No workflows yet.</td></tr>}
            {workflows.map((w) => (
              <tr key={w.id}>
                <Td className="font-medium">
                  <Link className="text-primary hover:underline" href={`${base}/${w.id}`}>{w.name}</Link>
                  {w.version && <span className="block text-xs font-normal text-muted">Version {w.version}</span>}
                </Td>
                <Td>{label.get(w.trigger_event) ?? w.trigger_event}</Td>
                <Td>{w.is_active ? <Badge tone="success">On</Badge> : <Badge>Off</Badge>}</Td>
                <Td className="tabular-nums">
                  {w.runs}
                  {w.waiting > 0 && <span className="ml-2"><Badge tone="primary">{w.waiting} waiting</Badge></span>}
                  {w.failed > 0 && <span className="ml-2"><Badge tone="danger">{w.failed} failed</Badge></span>}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
