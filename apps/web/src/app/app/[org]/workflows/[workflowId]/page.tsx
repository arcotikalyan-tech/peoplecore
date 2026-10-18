import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/action-form';
import { ButtonLink } from '@/components/ui/button';
import { Badge, Card, CardHeader, PageHeader } from '@/components/ui/surface';
import { Table, Td, Th } from '@/components/ui/table';
import { formatDateTime } from '@/lib/format';
import { requirePermission } from '@/server/context';
import { employeeNames } from '@/server/employees';
import { getWorkflow, workflowRuns } from '@/server/workflows';
import { saveWorkflowAction, stopRunAction } from '../actions';
import { builderOptions } from '../options';
import { WorkflowBuilder, type Condition, type Step } from '../workflow-builder';

export const metadata: Metadata = { title: 'Workflow' };

const RUN_TONE = { running: 'primary', waiting: 'primary', completed: 'success', failed: 'danger', stopped: 'neutral' } as const;
const STEP_TONE: Record<string, 'neutral' | 'primary' | 'success' | 'danger' | 'warning'> = {
  done: 'success', skipped: 'neutral', waiting: 'primary', failed: 'danger', rejected: 'warning',
};

export default async function WorkflowPage({ params }: { params: Promise<{ org: string; workflowId: string }> }) {
  const { org: slug, workflowId } = await params;
  const ctx = await requirePermission(slug, 'workflow.manage', 'org');
  const w = /^[0-9a-f-]{36}$/i.test(workflowId) ? await getWorkflow(ctx.org.id, workflowId) : null;
  if (!w) notFound();
  const [options, runs] = await Promise.all([builderOptions(ctx.org.id), workflowRuns(ctx.org.id, w.id)]);
  const names = await employeeNames(ctx.org.id, runs.flatMap((r) => (r.subject_employee_id ? [r.subject_employee_id] : [])));
  const tz = ctx.org.timezone;

  return (
    <>
      <PageHeader eyebrow={`Version ${w.version.version}`} title={w.name}
        actions={<>
          {w.is_active ? <Badge tone="success">On</Badge> : <Badge>Off</Badge>}
          <ButtonLink href={`/app/${slug}/workflows`} variant="ghost">All workflows</ButtonLink>
        </>} />
      <div className="space-y-6">
        <Card>
          <CardHeader title="Definition" description="Saving creates a new version. Runs already started keep the version they began with." />
          <WorkflowBuilder action={saveWorkflowAction.bind(null, slug)} options={options}
            workflow={{ id: w.id, name: w.name, trigger: w.trigger_event, active: w.is_active,
              conditions: w.version.conditions as unknown as Condition[], steps: w.version.steps as unknown as Step[] }} />
        </Card>
        <Card>
          <CardHeader title="Recent runs" description="The last 50." />
          <Table caption="Runs">
            <thead><tr><Th>Started</Th><Th>For</Th><Th>Status</Th><Th>Steps</Th><Th><span className="sr-only">Stop</span></Th></tr></thead>
            <tbody>
              {runs.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-muted">No runs yet.</td></tr>}
              {runs.map((r) => (
                <tr key={r.id}>
                  <Td className="text-muted">{formatDateTime(r.started_at, tz)}</Td>
                  <Td>{r.subject_employee_id ? (names.get(r.subject_employee_id) ?? 'Employee') : '—'}</Td>
                  <Td>
                    <Badge tone={RUN_TONE[r.status]}>{r.status[0]!.toUpperCase() + r.status.slice(1)}</Badge>
                    {r.error && <span className="mt-1 block text-xs text-danger">{r.error}</span>}
                  </Td>
                  <Td>
                    <span className="flex flex-wrap gap-1">
                      {r.steps.map((s) => <Badge key={s.step_no} tone={STEP_TONE[s.status] ?? 'neutral'}>{s.step_no + 1}. {s.kind}: {s.status}</Badge>)}
                    </span>
                  </Td>
                  <Td>
                    {(r.status === 'running' || r.status === 'waiting') && (
                      <ActionForm action={stopRunAction.bind(null, slug)} label="Stop run" submit="Stop" hidden={{ runId: r.id }} variant="ghost" size="sm"
                        className="inline-flex items-center gap-2" />
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>
    </>
  );
}
