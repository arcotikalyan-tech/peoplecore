import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import {
  APPLICATION_STAGE_LABELS,
  APPLICATION_STAGES,
  CANDIDATE_SOURCE_LABELS,
  EMPLOYMENT_TYPE_LABELS,
  REQUISITION_STATUS_LABELS,
  type CandidateSource,
} from '@peoplecore/shared';
import { Badge, Card, CardHeader, DetailList, PageHeader } from '@/components/ui/surface';
import { formatDate, formatDateTime } from '@/lib/format';
import { getOrgContext } from '@/server/context';
import { employeeNames } from '@/server/employees';
import { getPipeline, getRequisition } from '@/server/recruitment';
import { getStructure } from '@/server/structure';
import { addCandidateAction, eraseCandidateAction, hireAction, moveApplicationAction, setRequisitionStatusAction } from '../actions';
import { AddCandidateForm, PipelineCard, RequisitionStatusForm } from '../recruitment-forms';

export const metadata: Metadata = { title: 'Requisition' };

export default async function RequisitionPage({ params }: { params: Promise<{ org: string; id: string }> }) {
  const { org: slug, id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const ctx = await getOrgContext(slug);
  if (!ctx.can('recruitment.read')) notFound();
  const req = await getRequisition(ctx.org.id, id); // RLS: null when not visible
  if (!req) notFound();

  const [pipeline, structure, names] = await Promise.all([
    getPipeline(ctx.org.id, id),
    getStructure(ctx.org.id),
    employeeNames(ctx.org.id, req.hiring_manager_employee_id ? [req.hiring_manager_employee_id] : []),
  ]);
  const canManage = ctx.can('recruitment.manage', 'org');
  const canHire = canManage && ctx.can('employee.create', 'org');
  // Structure lists hold active items only, so a miss means the item was archived.
  const dept = new Map(structure.departments.map((d) => [d.id, d.name]));
  const desig = new Map(structure.designations.map((d) => [d.id, d.title]));
  const loc = new Map(structure.locations.map((l) => [l.id, l.name]));
  const lookup = (m: Map<string, string>, k: string | null) => (k ? (m.get(k) ?? 'Archived') : null);
  const base = `/app/${slug}`;

  return (
    <>
      <PageHeader
        eyebrow={<Link href={`${base}/recruitment`} className="hover:text-fg">← Recruitment</Link>}
        title={req.title}
        description={`${req.code} · ${EMPLOYMENT_TYPE_LABELS[req.employment_type]} · ${req.openings} opening${req.openings === 1 ? '' : 's'}`}
        actions={<Badge tone={req.status === 'open' ? 'success' : 'neutral'}>{REQUISITION_STATUS_LABELS[req.status]}</Badge>}
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          {APPLICATION_STAGES.map((stage) => {
            const entries = pipeline.filter((p) => p.stage === stage);
            if (entries.length === 0 && (stage === 'rejected' || stage === 'withdrawn' || stage === 'hired')) return null;
            return (
              <Card key={stage}>
                <CardHeader title={APPLICATION_STAGE_LABELS[stage]} description={`${entries.length}`} />
                {entries.length === 0 ? (
                  <p className="px-5 py-4 text-sm text-muted">No one at this stage.</p>
                ) : (
                  <ul className="divide-y divide-line" aria-label={APPLICATION_STAGE_LABELS[stage]}>
                    {entries.map((p) => (
                      <li key={p.id} className="space-y-2 px-5 py-4">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <p className="font-medium">{p.candidate.name}</p>
                          <p className="text-xs text-muted">since {formatDateTime(p.stageChangedAt, ctx.org.timezone)}</p>
                        </div>
                        <p className="text-sm text-muted">
                          {[p.candidate.email, p.candidate.phone, CANDIDATE_SOURCE_LABELS[p.candidate.source as CandidateSource], p.candidate.company].filter(Boolean).join(' · ')}
                        </p>
                        {p.note && <p className="text-sm">{p.note}</p>}
                        {p.employeeId && (
                          <Link className="text-sm text-primary hover:underline" href={`${base}/employees/${p.employeeId}`}>View employee record</Link>
                        )}
                        {canManage && (
                          <PipelineCard
                            entry={{ id: p.id, stage: p.stage, candidateId: p.candidate.id, name: p.candidate.name }}
                            move={moveApplicationAction.bind(null, slug)}
                            hire={canHire ? hireAction.bind(null, slug) : undefined}
                            erase={eraseCandidateAction.bind(null, slug)}
                            canHire={canHire}
                          />
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            );
          })}
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Details" />
            <DetailList items={[
              { label: 'Department', value: lookup(dept, req.department_id) },
              { label: 'Designation', value: lookup(desig, req.designation_id) },
              { label: 'Location', value: lookup(loc, req.location_id) },
              { label: 'Hiring manager', value: req.hiring_manager_employee_id ? (names.get(req.hiring_manager_employee_id) ?? null) : null },
              { label: 'Opened', value: formatDate(req.created_at) },
              { label: 'Description', value: req.description },
            ]} />
            {canManage && (
              <div className="border-t border-line px-5 py-4">
                <RequisitionStatusForm action={setRequisitionStatusAction.bind(null, slug, id)} status={req.status} />
              </div>
            )}
          </Card>
          {canManage && req.status === 'open' && (
            <Card>
              <CardHeader title="Add candidate" description="Candidates already on file (same email or phone) are reused, not duplicated." />
              <AddCandidateForm action={addCandidateAction.bind(null, slug, id)} />
            </Card>
          )}
          {canManage && !canHire && (
            <p className="text-sm text-muted">Hiring creates an employee record, so HR completes it from the Offer stage.</p>
          )}
        </div>
      </div>
    </>
  );
}
