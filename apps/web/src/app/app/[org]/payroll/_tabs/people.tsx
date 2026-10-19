import Link from 'next/link';
import { ActionForm } from '@/components/action-form';
import { formatDate } from '@/lib/format';
import { components as loadComponents, payrollPeople, revisions, structures as loadStructures } from '@/server/payroll-suite';
import { decideRevisionAction, salaryAction, saveStructureAction, structureFlagAction } from '../suite-actions';
import { BreakupPreview, DecisionForm, SalaryForm, StructureEditor } from './forms';
import { calcText, Card, inr, Pill, qs, type TabProps } from './shared';

const VIEWS = [{ key: 'structures', label: 'Salary Structures' }, { key: 'salaries', label: 'Salary View' }, { key: 'revisions', label: 'Salary Revisions' }];

export async function PeopleTab({ ctx, slug, base, month, today, approves, sp }: TabProps) {
  const m = month.slice(0, 7);
  const view = VIEWS.some((v) => v.key === sp.view) ? sp.view! : 'structures';
  const editsPay = ctx.can('compensation.update', 'org');
  const [list, comps, people, revs] = await Promise.all([loadStructures(ctx.org.id), loadComponents(ctx.org.id), payrollPeople(ctx.org.id, month), revisions(ctx.org.id)]);
  const href = (extra: Record<string, string>) => qs(base, { tab: 'people', month: m, ...extra });
  const pendingCount = revs.filter((r) => r.status === 'pending').length;

  return (
    <div className="space-y-5">
      <nav aria-label="People & Salaries" className="inline-flex rounded-xl border border-line bg-surface p-1">
        {VIEWS.map((v) => (
          <Link key={v.key} href={href({ view: v.key })} aria-current={v.key === view ? 'page' : undefined}
            className={`rounded-lg px-3 py-1.5 text-sm ${v.key === view ? 'bg-subtle font-semibold' : 'text-muted hover:text-fg'}`}>
            {v.label}{v.key === 'revisions' && pendingCount > 0 && <span className="ml-1.5 rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-fg">{pendingCount}</span>}
          </Link>
        ))}
      </nav>

      {view === 'structures' && (() => {
        const active = list.filter((s) => !s.archived_at);
        const current = sp.structure === 'new' ? null : list.find((s) => s.id === sp.structure) ?? active[0] ?? null;
        const editing = sp.edit === '1' || sp.structure === 'new';
        const byId = new Map(comps.map((c) => [c.id, c]));
        const assigned = (id: string) => people.filter((p) => p.structureId === id).length;
        return (
          <div className="grid gap-5 lg:grid-cols-[22rem_minmax(0,1fr)]">
            <div className="space-y-2">
              {editsPay && <Link href={href({ view: 'structures', structure: 'new' })} className="flex h-10 items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-fg">＋ Create New Structure</Link>}
              <ul className="lift-soft overflow-hidden rounded-2xl border border-line bg-surface">
                {list.map((s) => (
                  <li key={s.id}>
                    <Link href={href({ view: 'structures', structure: s.id })} aria-current={current?.id === s.id ? 'true' : undefined}
                      className={`block border-l-4 px-4 py-3 ${current?.id === s.id ? 'border-primary bg-primary-soft/50' : 'border-transparent hover:bg-subtle/50'} ${s.archived_at ? 'opacity-50' : ''}`}>
                      <span className="block font-semibold">{s.name}{s.is_default && <span className="ml-2 text-xs text-primary">★ Default</span>}</span>
                      <span className="text-xs text-muted">{s.is_system ? 'System' : 'Custom'} · {s.pay_basis === 'monthly' ? 'Monthly' : s.pay_basis === 'daily' ? 'Daily wage' : 'Hourly wage'} · {assigned(s.id)} assigned{s.archived_at ? ' · archived' : ''}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
            <Card>
              {editing && editsPay ? (
                <>
                  <h2 className="mb-4 text-lg font-semibold">{current ? `Edit ${current.name}` : 'New salary structure'}</h2>
                  <StructureEditor action={saveStructureAction.bind(null, slug)} structure={current} components={comps.filter((c) => c.is_active)} />
                </>
              ) : current ? (
                <div className="space-y-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div><h2 className="text-lg font-semibold">{current.name}</h2><p className="text-sm italic text-muted">{current.description || 'No description'}</p></div>
                    {editsPay && (
                      <div className="flex flex-wrap gap-2">
                        {!current.is_default && <ActionForm action={structureFlagAction.bind(null, slug)} label="Set default" submit="☆ Set Default" size="sm" variant="secondary" hidden={{ structureId: current.id, op: 'default' }} className="inline-flex" />}
                        <Link href={href({ view: 'salaries', structure: current.id })} className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-semibold text-primary-fg">👥 Assign</Link>
                        <Link href={href({ view: 'structures', structure: current.id, edit: '1' })} className="inline-flex h-8 items-center rounded-md border border-line px-3 text-xs font-medium">✎ Edit</Link>
                        {!current.is_default && <ActionForm action={structureFlagAction.bind(null, slug)} label="Archive" submit={current.archived_at ? 'Restore' : 'Archive'} size="sm" variant="ghost"
                          hidden={{ structureId: current.id, op: current.archived_at ? 'restore' : 'archive' }} className="inline-flex" />}
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="mb-2 flex justify-between text-[11px] font-semibold uppercase tracking-wider text-muted"><span>Component formula</span><span className="normal-case tracking-normal">Click Edit to modify</span></div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <table className="w-full overflow-hidden rounded-xl border border-line text-sm">
                        <thead><tr className="bg-subtle/60 text-left text-[11px] uppercase tracking-wider text-muted"><th className="px-3 py-2">Earning</th><th className="px-3">Calculation</th></tr></thead>
                        <tbody className="divide-y divide-line">
                          {current.lines.map((l) => <tr key={l.component_id}><td className="px-3 py-2.5 font-medium">{byId.get(l.component_id)?.name}</td><td className="px-3 font-mono text-xs text-muted">{calcText(l.calc, l.value)}</td></tr>)}
                        </tbody>
                      </table>
                      <table className="w-full overflow-hidden rounded-xl border border-line text-sm">
                        <thead><tr className="bg-subtle/60 text-left text-[11px] uppercase tracking-wider text-muted"><th className="px-3 py-2">Deduction</th><th className="px-3">Calculation</th></tr></thead>
                        <tbody className="divide-y divide-line">
                          {['PF Employer', 'ESI Employer', 'Professional Tax', 'Income Tax (TDS)'].map((d) => <tr key={d}><td className="px-3 py-2.5 font-medium">{d}</td><td className="px-3 font-mono text-xs text-muted">SYSTEM CALCULATED</td></tr>)}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <BreakupPreview structure={current} components={comps} />
                </div>
              ) : <p className="text-sm text-muted">No salary structures yet.</p>}
            </Card>
          </div>
        );
      })()}

      {view === 'salaries' && (() => {
        const sName = new Map(list.map((s) => [s.id, s.name]));
        const filtered = sp.filter === 'nosalary' ? people.filter((p) => !p.ctc) : people;
        const pre = sp.employee ?? (sp.filter === 'nosalary' ? filtered[0]?.id : undefined);
        const preHasSalary = people.find((p) => p.id === pre)?.ctc;
        return (
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <Card title="Salary View" action={<span className="text-xs text-muted">As of the end of {m} · {filtered.length} employees{sp.filter === 'nosalary' ? ' without a salary' : ''}{sp.filter && <Link href={href({ view: 'salaries' })} className="ml-2 text-primary">Show all</Link>}</span>}>
              <div className="scroll-thin overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead><tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-muted"><th className="py-2">Employee</th><th>Structure</th><th className="text-right">Annual CTC</th><th className="text-right">Monthly gross</th><th className="pl-4">Since</th><th /></tr></thead>
                  <tbody className="divide-y divide-line">
                    {filtered.map((p) => (
                      <tr key={p.id}>
                        <td className="py-2"><span className="font-medium">{p.name}</span><span className="block text-xs text-muted">{p.code}{p.designation ? ` · ${p.designation}` : ''}</span></td>
                        <td>{p.structureId ? sName.get(p.structureId) : p.ctc ? <span className="text-muted">Custom</span> : <Pill tone="warning">No salary</Pill>}</td>
                        <td className="text-right tabular-nums">{p.ctc ? inr.format(p.ctc) : '—'}</td>
                        <td className="text-right tabular-nums">{p.ctc ? `${inr.format(p.monthlyGross)}${p.payBasis !== 'monthly' ? ` / ${p.payBasis === 'daily' ? 'day' : 'hr'}` : ''}` : '—'}</td>
                        <td className="pl-4 text-muted">{p.compensationFrom ? formatDate(p.compensationFrom) : '—'}</td>
                        <td className="text-right">{editsPay && <Link href={href({ view: 'salaries', employee: p.id, ...(sp.filter ? { filter: sp.filter } : {}) })} className="text-xs font-medium text-primary">{p.ctc ? 'Revise' : 'Assign'}</Link>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            {editsPay ? (
              <Card title={preHasSalary ? 'Revise salary' : 'Assign salary'}>
                <SalaryForm key={pre ?? 'none'} action={salaryAction.bind(null, slug)} today={today} revising={Boolean(preHasSalary)}
                  employees={people.map((p) => ({ value: p.id, label: `${p.name} · ${p.code}${p.ctc ? '' : ' (no salary)'}` }))}
                  structures={list.filter((s) => !s.archived_at).map((s) => ({ value: s.id, label: s.name, basis: s.pay_basis }))}
                  defaultEmployee={pre} defaultStructure={sp.structure ?? list.find((s) => s.is_default)?.id} />
              </Card>
            ) : <Card><p className="text-sm text-muted">Salaries are set by payroll administrators.</p></Card>}
          </div>
        );
      })()}

      {view === 'revisions' && (
        <Card title="Salary Revisions" action={<span className="text-xs text-muted">Proposed by payroll · signed off by another approver · arrears added automatically</span>}>
          {revs.length === 0 ? <p className="text-sm text-muted">No revisions yet. Revise a salary from the Salary View.</p> : (
            <div className="scroll-thin overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead><tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-muted"><th className="py-2">Employee</th><th>Effective</th><th className="text-right">Current</th><th className="text-right">New</th><th className="text-right">Change</th><th className="pl-4">Reason</th><th>Status</th><th>Arrears</th><th /></tr></thead>
                <tbody className="divide-y divide-line">
                  {revs.map((r) => {
                    const p = people.find((x) => x.id === r.employee_id);
                    const prev = Number(r.previous_annual_ctc ?? 0);
                    const next = Number(r.annual_ctc);
                    return (
                      <tr key={r.id}>
                        <td className="py-2 font-medium">{p?.name ?? 'Former employee'}</td>
                        <td>{formatDate(r.effective_from)}</td>
                        <td className="text-right tabular-nums">{inr.format(prev)}</td>
                        <td className="text-right tabular-nums">{inr.format(next)}</td>
                        <td className={`text-right tabular-nums ${next >= prev ? 'text-success' : 'text-danger'}`}>{prev ? `${next >= prev ? '+' : ''}${(((next - prev) / prev) * 100).toFixed(1)}%` : '—'}</td>
                        <td className="max-w-56 truncate pl-4 text-muted" title={r.reason}>{r.reason}{r.decision_note && <span className="block text-xs">“{r.decision_note}”</span>}</td>
                        <td><Pill tone={r.status === 'approved' ? 'success' : r.status === 'pending' ? 'warning' : r.status === 'rejected' ? 'danger' : 'muted'}>{r.status === 'pending' ? 'Pending sign-off' : r.status}</Pill></td>
                        <td className="tabular-nums">{Number(r.arrears) ? inr.format(Number(r.arrears)) : '—'}</td>
                        <td>{r.status === 'pending' && <DecisionForm action={decideRevisionAction.bind(null, slug)} hidden={{ revisionId: r.id }} approveLabel="Sign off"
                          canDecide={approves && r.requested_by !== ctx.user.id} canWithdraw={r.requested_by === ctx.user.id} />}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
