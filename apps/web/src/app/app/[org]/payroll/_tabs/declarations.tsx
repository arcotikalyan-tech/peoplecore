import Link from 'next/link';
import { ActionForm } from '@/components/action-form';
import { buttonClass } from '@/components/ui/button';
import { formatDate } from '@/lib/format';
import { declarations, fyOf, payrollPeople, payrollSettings } from '@/server/payroll-suite';
import { createClient } from '@/server/supabase';
import { bulkApproveDeclarationsAction, reviewDeclarationAction } from '../suite-actions';
import { ReviewDeclarationForm } from './forms';
import { Card, inr, Pill, qs, type TabProps } from './shared';

const VIEWS = [
  { key: 'scheme', label: 'Tax Scheme', sections: [] as string[] },
  { key: 'hra', label: 'HRA', sections: ['hra'] },
  { key: 'deductions', label: 'Deductions', sections: ['80C', '80CCD1B', '80D_self', '80D_parents', '80E', '80G', '80TTA', 'other'] },
  { key: 'house', label: 'House Property', sections: ['24B'] },
  { key: 'lta', label: 'LTA', sections: ['lta'] },
  { key: 'prev', label: 'Prev Employer', sections: ['prev_employer'] },
  { key: 'reimb', label: 'Reimbursements', sections: [] },
  { key: 'forms', label: 'Forms', sections: [] },
];
const STATUS_TONE = { draft: 'muted', submitted: 'warning', approved: 'success', rejected: 'danger' } as const;

export async function DeclarationsTab({ ctx, slug, base, month, prepares, sp }: TabProps) {
  const m = month.slice(0, 7);
  const current = fyOf(month);
  const start = Number(current.slice(0, 4));
  const years = [start + 1, start, start - 1, start - 2].map((y) => `${y}-${String((y + 1) % 100).padStart(2, '0')}`);
  const fy = years.includes(sp.fy ?? '') ? sp.fy! : current;
  const view = VIEWS.some((v) => v.key === sp.view) ? sp.view! : 'scheme';
  const [decls, people, settings] = await Promise.all([declarations(ctx.org.id, fy), payrollPeople(ctx.org.id, month), payrollSettings(ctx.org.id)]);
  const byEmp = new Map(decls.map((d) => [d.employee_id, d]));
  const href = (extra: Record<string, string>) => qs(base, { tab: 'declarations', month: m, fy, ...extra });
  const submitted = decls.filter((d) => d.status === 'submitted').length;
  const sections = VIEWS.find((v) => v.key === view)!.sections;
  const open = decls.find((d) => d.id === sp.decl);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">Financial Year</span>
          {years.map((y) => (
            <Link key={y} href={href({ fy: y, view })} aria-current={y === fy ? 'true' : undefined}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${y === fy ? 'border-primary bg-primary-soft text-primary' : 'border-line text-muted'}`}>{y.replace('-', ' – 20')}</Link>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={`/app/${slug}/payroll/declarations-export?fy=${fy}`} className={buttonClass('secondary', 'sm')} download>⬇ Export</a>
          <span className="inline-flex items-center rounded-md border border-line px-3 text-xs text-muted" title="Proof documents are uploaded by employees in Documents">
            Window: {settings?.declaration_open ? `open${settings.declaration_until ? ` until ${formatDate(settings.declaration_until)}` : ''}` : 'closed'}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Declaration sections" className="inline-flex flex-wrap rounded-xl border border-line bg-surface p-1">
          {VIEWS.map((v) => (
            <Link key={v.key} href={href({ view: v.key })} aria-current={v.key === view ? 'page' : undefined}
              className={`rounded-lg px-3 py-1.5 text-sm ${v.key === view ? 'bg-subtle font-semibold' : 'text-muted hover:text-fg'}`}>
              {v.label}{v.key === 'forms' && <span className="ml-1 text-danger" aria-hidden="true">●</span>}
            </Link>
          ))}
        </nav>
        {prepares && submitted > 0 && <ActionForm action={bulkApproveDeclarationsAction.bind(null, slug)} label="Bulk approve" submit={`✓ Bulk Approve (${submitted})`} size="sm" hidden={{ fy }} className="inline-flex" />}
      </div>

      {open && prepares && (
        <Card title={`Review · ${people.find((p) => p.id === open.employee_id)?.name ?? 'Employee'} · ${open.regime === 'old' ? 'Old' : 'New'} regime`}
          action={<Link href={href({ view })} className="text-xs text-muted">Close</Link>}>
          {open.tax_declaration_items.length === 0 ? <p className="mb-3 text-sm text-muted">The employee chose the {open.regime} regime with nothing to declare.</p> : (
            <ReviewDeclarationForm action={reviewDeclarationAction.bind(null, slug)} declarationId={open.id}
              items={open.tax_declaration_items.map((i) => ({ id: i.id, label: i.label, section: i.section, declared: Number(i.declared), approved: i.approved === null ? null : Number(i.approved), status: i.status }))} />
          )}
          {open.tax_declaration_items.length === 0 && <ReviewDeclarationForm action={reviewDeclarationAction.bind(null, slug)} declarationId={open.id} items={[]} />}
        </Card>
      )}

      {view === 'scheme' && (
        <Card title={`Tax Scheme · FY ${fy}`} action={<span className="text-xs text-muted">{decls.length} of {people.length} declared · default {settings?.default_regime ?? 'new'} regime</span>}>
          <Table head={['Employee', 'Regime', 'Status', 'Declared', 'Approved', 'Submitted', '']}>
            {people.map((p) => {
              const d = byEmp.get(p.id);
              const items = d?.tax_declaration_items ?? [];
              return (
                <tr key={p.id}>
                  <td className="py-2"><span className="font-medium">{p.name}</span><span className="block text-xs text-muted">{p.code}</span></td>
                  <td className="capitalize">{d?.regime ?? <span className="text-muted">{settings?.default_regime ?? 'new'} (default)</span>}</td>
                  <td>{d ? <Pill tone={STATUS_TONE[d.status]}>{d.status}</Pill> : <Pill>Not declared</Pill>}</td>
                  <td className="tabular-nums">{items.length ? inr.format(items.reduce((s, i) => s + Number(i.declared), 0)) : '—'}</td>
                  <td className="tabular-nums">{items.some((i) => i.approved !== null) ? inr.format(items.reduce((s, i) => s + Number(i.approved ?? 0), 0)) : '—'}</td>
                  <td className="text-muted">{d?.submitted_at ? formatDate(d.submitted_at.slice(0, 10)) : '—'}</td>
                  <td className="text-right">{d && d.status !== 'draft' && prepares && <Link href={href({ view, decl: d.id })} className="text-xs font-medium text-primary">{d.status === 'submitted' ? 'Review' : 'Open'}</Link>}</td>
                </tr>
              );
            })}
          </Table>
        </Card>
      )}

      {sections.length > 0 && (() => {
        const rows = decls.flatMap((d) => d.tax_declaration_items.filter((i) => sections.includes(i.section)).map((i) => ({ d, i })));
        return (
          <Card title={`${VIEWS.find((v) => v.key === view)!.label} · FY ${fy}`} action={<span className="text-xs text-muted">{rows.length} item{rows.length === 1 ? '' : 's'}</span>}>
            {rows.length === 0 ? <p className="text-sm text-muted">Nothing declared here yet.</p> : (
              <Table head={['Employee', 'Item', 'Details', 'Declared', 'Approved', 'Status', '']}>
                {rows.map(({ d, i }) => (
                  <tr key={i.id}>
                    <td className="py-2 font-medium">{people.find((p) => p.id === d.employee_id)?.name ?? '—'}</td>
                    <td>{i.label}</td>
                    <td className="text-xs text-muted">{Object.entries((i.details ?? {}) as Record<string, string>).map(([k, v]) => `${k}: ${v}`).join(' · ') || (i.tds ? `TDS ${inr.format(Number(i.tds))}` : '—')}</td>
                    <td className="tabular-nums">{inr.format(Number(i.declared))}</td>
                    <td className="tabular-nums">{i.approved === null ? '—' : inr.format(Number(i.approved))}</td>
                    <td><Pill tone={i.status === 'approved' ? 'success' : i.status === 'rejected' ? 'danger' : 'warning'}>{i.status}</Pill></td>
                    <td className="text-right">{prepares && d.status !== 'draft' && <Link href={href({ view, decl: d.id })} className="text-xs font-medium text-primary">Review</Link>}</td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        );
      })()}

      {view === 'reimb' && <Reimbursements orgId={ctx.org.id} fy={fy} people={people} />}

      {view === 'forms' && (
        <Card title={`Forms · FY ${fy}`}>
          <p className="mb-3 text-sm text-muted">Form 12BB lists what each employee declared (with landlord and lender details). Form 16 (Part B) summarises the year’s salary, exemptions, deductions and TDS from locked payroll runs.</p>
          <Table head={['Employee', 'Declaration', 'Form 12BB', 'Form 16 Part B']}>
            {people.map((p) => (
              <tr key={p.id}>
                <td className="py-2"><span className="font-medium">{p.name}</span><span className="block text-xs text-muted">{p.code}</span></td>
                <td>{byEmp.get(p.id) ? <Pill tone={STATUS_TONE[byEmp.get(p.id)!.status]}>{byEmp.get(p.id)!.status}</Pill> : <Pill>Not declared</Pill>}</td>
                <td>{byEmp.get(p.id) ? <Link href={`/app/${slug}/payroll/forms/${p.id}?fy=${fy}&form=12bb`} className="text-xs font-medium text-primary">View / print</Link> : <span className="text-xs text-muted">—</span>}</td>
                <td><Link href={`/app/${slug}/payroll/forms/${p.id}?fy=${fy}&form=16`} className="text-xs font-medium text-primary">View / print</Link></td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </div>
  );
}

async function Reimbursements({ orgId, fy, people }: { orgId: string; fy: string; people: Array<{ id: string; name: string; code: string }> }) {
  const supabase = await createClient();
  const from = `${fy.slice(0, 4)}-04-01`;
  const to = `${Number(fy.slice(0, 4)) + 1}-03-31`;
  const { data } = await supabase.from('expense_claims').select('employee_id, total, status, created_at').eq('organization_id', orgId)
    .in('status', ['approved', 'paid']).gte('created_at', from).lte('created_at', `${to}T23:59:59`);
  const by = new Map<string, { paid: number; due: number; n: number }>();
  for (const c of data ?? []) {
    const r = by.get(c.employee_id) ?? { paid: 0, due: 0, n: 0 };
    if (c.status === 'paid') r.paid += Number(c.total); else r.due += Number(c.total);
    r.n += 1;
    by.set(c.employee_id, r);
  }
  return (
    <Card title={`Reimbursements · FY ${fy}`} action={<span className="text-xs text-muted">Approved expense claims are paid tax-free with payroll</span>}>
      {by.size === 0 ? <p className="text-sm text-muted">No reimbursements this year.</p> : (
        <Table head={['Employee', 'Claims', 'Paid with payroll', 'Due next run']}>
          {people.filter((p) => by.has(p.id)).map((p) => (
            <tr key={p.id}>
              <td className="py-2 font-medium">{p.name}</td>
              <td className="tabular-nums">{by.get(p.id)!.n}</td>
              <td className="tabular-nums">{inr.format(by.get(p.id)!.paid)}</td>
              <td className="tabular-nums">{inr.format(by.get(p.id)!.due)}</td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="scroll-thin overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead><tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-muted">{head.map((h, i) => <th key={i} className="py-2 pr-3 font-semibold">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}
