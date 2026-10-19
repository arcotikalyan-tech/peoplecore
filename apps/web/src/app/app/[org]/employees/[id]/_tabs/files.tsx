import Link from 'next/link';
import { Badge } from '@/components/ui/surface';
import { formatDateTime, humanize } from '@/lib/format';
import { myFiles } from '@/server/profile';
import { Empty, Panel, type ProfileProps } from './shared';

const REPORTS: Record<string, string> = {
  pf_ecr: 'PF ECR', esi: 'ESI contribution', pt: 'Professional tax', tds: 'TDS working', tds24q: 'TDS 24Q working', register: 'Pay register',
  bank_advice: 'Bank advice', journal: 'Payroll journal',
};

/** File Manager: the files the signed-in user generated or downloaded, newest first. Only their own. */
export async function FilesTab({ ctx, base }: ProfileProps) {
  const rows = await myFiles(ctx.org.id);
  const describe = (r: (typeof rows)[number]) => {
    const m = (r.metadata ?? {}) as Record<string, unknown>;
    if (r.action === 'export' && r.entity_type === 'employees') return { name: 'Employee export', format: String(m.format ?? 'csv').toUpperCase(), href: `${base}/employees/export` };
    if (r.action === 'payroll_export') return { name: REPORTS[String(m.report)] ?? humanize(String(m.report ?? 'Payroll export')), format: m.report === 'pf_ecr' ? 'TXT' : 'CSV', href: `${base}/payroll?tab=compliance` };
    if (r.action === 'bank_file_export') return { name: 'Bank transfer file', format: 'CSV', href: `${base}/payroll?tab=payout` };
    if (r.action === 'download' && typeof m.employee_id === 'string' && r.entity_id) return { name: 'Employee document', format: 'FILE', href: `${base}/employees/${m.employee_id}/documents/${r.entity_id}` };
    return { name: humanize(r.entity_type), format: '—', href: null };
  };
  return (
    <Panel title="File Manager">
      <p className="px-5 pt-1 text-sm text-muted">Exports and downloads you made. Files are generated fresh from the current data when you download them again.</p>
      {rows.length === 0 ? <Empty icon="🗂️" title="No files yet" /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" aria-label="Files">
            <thead className="text-left text-[11px] uppercase tracking-wider text-muted"><tr><th className="px-5 py-2">Request type</th><th className="px-3">Format</th><th className="px-3">Scheduled on</th><th className="px-3">Status</th><th className="px-3">Actions</th></tr></thead>
            <tbody className="divide-y divide-line">
              {rows.map((r, i) => {
                const d = describe(r);
                return (
                  <tr key={`${r.occurred_at}${i}`}>
                    <td className="px-5 py-2 font-medium">{d.name}</td>
                    <td className="px-3">{d.format}</td>
                    <td className="px-3">{formatDateTime(r.occurred_at, ctx.org.timezone)}</td>
                    <td className="px-3"><Badge tone="success">Success</Badge></td>
                    <td className="px-3">{d.href ? <Link className="text-primary hover:underline" href={d.href} aria-label={`Get ${d.name} again`}>☁ Get again</Link> : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
