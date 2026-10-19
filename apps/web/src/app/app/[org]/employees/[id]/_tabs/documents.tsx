import Link from 'next/link';
import { DOCUMENT_PROOFS, DOCUMENT_PROOF_LABELS, type DocumentCategory } from '@peoplecore/shared';
import { SubTabs } from '@/components/ui/hub';
import { Badge, Card, CardHeader } from '@/components/ui/surface';
import { formatDate, formatDateTime } from '@/lib/format';
import { namesForUsers } from '@/server/employees';
import { policiesFor, profileDocuments } from '@/server/profile';
import type { IdentitySummary } from '@/server/sensitive';
import { deleteDocumentAction, revealIdentityAction, saveIdentityAction, uploadDocumentAction, verifyDocumentAction } from '../actions';
import { DocumentsPanel } from '../documents-panel';
import { IdentityPanel } from '../sensitive-panels';
import { Empty, Panel, type ProfileProps } from './shared';

const VIEWS: Record<string, { label: string; categories: DocumentCategory[] }> = {
  ids: { label: 'IDs', categories: ['identity', 'address'] },
  certifications: { label: 'Certifications', categories: ['education'] },
  work: { label: 'Work', categories: ['employment', 'contract', 'medical', 'other'] },
};
const formatBytes = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`);

/** Documents: IDs (with what each proves, and identity numbers), certifications, work documents, policies. */
export async function DocumentsTab(p: ProfileProps & { identity: IdentitySummary | null }) {
  const { ctx, slug, base, id, sp, allowed, isSelf, identity, href } = p;
  const view = sp.view && (sp.view in VIEWS || sp.view === 'policy') ? sp.view : 'ids';
  const tabs = [...Object.entries(VIEWS).map(([key, v]) => ({ key, label: v.label })), { key: 'policy', label: 'Policy' }];
  const canRead = allowed('employee.document.read');

  if (view === 'policy') {
    const policies = await policiesFor(ctx.org.id, id);
    return (
      <>
        <SubTabs base={href('documents').split('?')[0]!} extra={{ tab: 'documents' }} tabs={tabs} current={view} label="Document sections" />
        <Panel title="Policies">
          {policies.length === 0 ? <Empty icon="📋" title="No policies" /> : (
            <ul className="divide-y divide-line" aria-label="Policies">
              {policies.map((x) => (
                <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                  <span><span className="font-medium">{x.title}</span> <span className="text-xs text-muted">v{x.version} · published {formatDate(x.published_at.slice(0, 10))}</span></span>
                  {x.acknowledged_at ? <Badge tone="success">Acknowledged {formatDate(x.acknowledged_at.slice(0, 10))}</Badge>
                    : x.requires_acknowledgement ? <Badge tone="warning">Not acknowledged</Badge> : <Badge>For information</Badge>}
                </li>
              ))}
            </ul>
          )}
          {isSelf && <p className="border-t border-line px-5 py-3 text-sm"><Link className="text-primary hover:underline" href={`${base}/policies`}>Read and acknowledge policies →</Link></p>}
        </Panel>
      </>
    );
  }

  const docs = canRead ? await profileDocuments(ctx.org.id, id) : [];
  const actors = await namesForUsers(ctx.org.id, docs.map((d) => d.uploaded_by).filter((x): x is string => !!x));
  const categories = VIEWS[view]!.categories;
  const rows = docs.filter((d) => categories.includes(d.category)).map((d) => ({
    id: d.id, category: d.category, title: d.title, fileName: d.file_name, size: formatBytes(d.size_bytes),
    uploaded: formatDateTime(d.created_at, ctx.org.timezone), uploadedBy: d.uploaded_by ? (actors.get(d.uploaded_by) ?? null) : null,
    proves: d.proves, verified: !!d.verified_at,
  }));
  const canVerify = ctx.can('employee.document.delete', 'org') && !isSelf;

  return (
    <>
      <SubTabs base={href('documents').split('?')[0]!} extra={{ tab: 'documents' }} tabs={tabs} current={view} label="Document sections" />
      <div className="space-y-5">
        {view === 'ids' && canRead && (
          <Panel title="Proofs — what your documents cover">
            <ul className="grid gap-3 px-5 py-4 sm:grid-cols-4" aria-label="Proof coverage">
              {DOCUMENT_PROOFS.map((proof) => {
                const by = docs.filter((d) => d.proves.includes(proof));
                return (
                  <li key={proof} className="rounded-xl border border-line p-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted">{DOCUMENT_PROOF_LABELS[proof]}</p>
                    <p className={`mt-1 text-sm ${by.length ? 'text-success' : 'text-muted'}`}>{by.length ? `✓ ${by.map((d) => d.title).join(', ')}` : 'No proof linked'}</p>
                  </li>
                );
              })}
            </ul>
          </Panel>
        )}
        {view === 'ids' && identity && (
          <Card>
            <CardHeader title="Identity numbers" description="PAN, Aadhaar (last 4), PF, ESIC and passport. Restricted access." />
            <IdentityPanel key={`identity:${identity.updated_at ?? 'none'}`} summary={identity}
              reveal={revealIdentityAction.bind(null, slug, id)} save={saveIdentityAction.bind(null, slug, id)} />
          </Card>
        )}
        {canRead ? (
          <Card>
            <CardHeader title="Documents" description="Stored privately. Every download is recorded." />
            <DocumentsPanel documents={rows} downloadHref={`${base}/employees/${id}/documents`} categories={categories} proofs={view === 'ids'}
              empty={view === 'ids' ? 'No ID documents' : view === 'certifications' ? 'No certifications' : 'No work documents'}
              upload={allowed('employee.document.upload') ? uploadDocumentAction.bind(null, slug, id) : undefined}
              remove={allowed('employee.document.delete') ? deleteDocumentAction.bind(null, slug, id) : undefined}
              verify={canVerify ? verifyDocumentAction.bind(null, slug, id) : undefined} />
          </Card>
        ) : !identity && <Empty icon="🔒" title="You can’t see this person’s documents." />}
      </div>
    </>
  );
}
