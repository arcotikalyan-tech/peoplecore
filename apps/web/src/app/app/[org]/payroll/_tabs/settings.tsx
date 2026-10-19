import Link from 'next/link';
import { ruleSetSchema } from '@peoplecore/payroll';
import { bankSettings, components, payrollPeople, payrollSettings, readiness } from '@/server/payroll-suite';
import { createClient } from '@/server/supabase';
import { saveComponentAction, saveSettingsAction } from '../suite-actions';
import { BankSettingsForm, ComponentForm, DeclarationWindowForm, PaySettingsForm, StatutorySettingsForm } from './forms';
import { Card, inr, Pill, qs, type TabProps } from './shared';

const CARDS = [
  { key: 'pay', icon: '⚙️', title: 'Pay Settings', sub: 'Cycle · payout date · LOP · payslip YTD' },
  { key: 'pfesi', icon: '🏛', title: 'PF & ESI', sub: 'Statutory rules + per-employee overrides' },
  { key: 'pt', icon: '🪪', title: 'Professional Tax', sub: 'Per-state rules + employee overview' },
  { key: 'components', icon: '💼', title: 'Components', sub: 'Base · recurring · variable · adhoc' },
  { key: 'payout', icon: '🏦', title: 'Payout / Bank', sub: 'Per-employee bank · IFSC' },
  { key: 'declarations', icon: '📚', title: 'Declaration Window', sub: 'Monthly/yearly window · proof deadline' },
  { key: 'bank', icon: '🏦', title: 'Bank Integration', sub: 'HDFC · ICICI · SBI · NEFT advice file' },
  { key: 'payslip', icon: '🧾', title: 'Payslip Format', sub: 'Template gallery · default' },
];

export async function SettingsTab({ ctx, slug, base, month, prepares, approves, sp }: TabProps) {
  const m = month.slice(0, 7);
  const view = CARDS.some((c) => c.key === sp.view) ? sp.view! : null;
  const href = (v?: string, extra: Record<string, string> = {}) => qs(base, { tab: 'settings', month: m, ...(v ? { view: v } : {}), ...extra });
  const settings = await payrollSettings(ctx.org.id);
  const save = saveSettingsAction.bind(null, slug);
  const editsPay = ctx.can('compensation.update', 'org');

  if (!view) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {CARDS.map((c) => (
          <Link key={c.key} href={href(c.key)} className="lift flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5">
            <span aria-hidden="true" className="grid size-11 place-items-center rounded-xl bg-primary-soft text-xl">{c.icon}</span>
            <span><span className="block font-semibold">{c.title}</span><span className="block text-sm text-muted">{c.sub}</span></span>
            <span className="mt-auto text-sm font-medium text-primary">Configure →</span>
          </Link>
        ))}
      </div>
    );
  }
  const card = CARDS.find((c) => c.key === view)!;
  const readOnly = <p className="text-sm text-muted">Only payroll administrators can change this.</p>;

  return (
    <div className="space-y-4">
      <Link href={href()} className="text-sm text-muted hover:text-fg">← All settings</Link>
      <Card title={`${card.icon} ${card.title}`} action={<span className="text-xs text-muted">{card.sub}</span>}>
        {view === 'pay' && settings && (prepares ? <PaySettingsForm action={save} s={settings} /> : readOnly)}
        {view === 'declarations' && settings && (prepares ? <DeclarationWindowForm action={save} s={settings} /> : readOnly)}
        {view === 'bank' && (approves ? <BankSettingsForm action={save} s={await bankSettings(ctx.org.id)} /> : <p className="text-sm text-muted">Only payroll approvers manage the company’s bank account.</p>)}
        {view === 'pfesi' && settings && <PfEsi ctx={ctx} slug={slug} month={month} canEdit={prepares} form={<StatutorySettingsForm action={save} s={settings} />} />}
        {view === 'pt' && <ProfessionalTax ctx={ctx} month={month} />}
        {view === 'components' && <Components orgId={ctx.org.id} slug={slug} canEdit={editsPay} open={sp.component} href={(id) => href('components', { component: id })} />}
        {view === 'payout' && <BankOverview ctx={ctx} slug={slug} month={month} />}
        {view === 'payslip' && settings && (
          <div className="space-y-5">
            <ul className="grid gap-4 md:grid-cols-3">
              {[['modern', 'Modern', 'Brand colour header, earnings and deductions side by side, net pay highlighted.'],
                ['classic', 'Classic', 'Traditional bordered table, company letterhead, amount in words.'],
                ['compact', 'Compact', 'One block, small type: fits two payslips on a page.']].map(([k, t, d]) => (
                <li key={k} className={`rounded-2xl border p-4 ${settings.payslip_template === k ? 'border-primary ring-2 ring-primary/30' : 'border-line'}`}>
                  <div aria-hidden="true" className="mb-3 space-y-1.5 rounded-lg border border-line bg-subtle/50 p-3">
                    <div className={`h-3 rounded ${k === 'modern' ? 'bg-primary' : k === 'classic' ? 'border border-line-strong bg-surface' : 'bg-line-strong'}`} />
                    <div className="grid grid-cols-2 gap-1.5">{Array.from({ length: k === 'compact' ? 4 : 6 }, (_, i) => <div key={i} className="h-1.5 rounded bg-line" />)}</div>
                    <div className={`ml-auto h-2.5 w-1/3 rounded ${k === 'modern' ? 'bg-success' : 'bg-line-strong'}`} />
                  </div>
                  <p className="font-semibold">{t} {settings.payslip_template === k && <Pill tone="primary">Default</Pill>}</p>
                  <p className="text-xs text-muted">{d}</p>
                </li>
              ))}
            </ul>
            {prepares ? <PaySettingsForm action={save} s={settings} /> : readOnly}
          </div>
        )}
      </Card>
    </div>
  );
}

async function PfEsi({ ctx, slug, month, canEdit, form }: { ctx: TabProps['ctx']; slug: string; month: string; canEdit: boolean; form: React.ReactNode }) {
  const supabase = await createClient();
  const [people, { data: profiles }] = await Promise.all([
    payrollPeople(ctx.org.id, month),
    supabase.from('employee_statutory_profiles').select('employee_id, pf_applicable, esi_applicable, pt_state').eq('organization_id', ctx.org.id),
  ]);
  const by = new Map((profiles ?? []).map((p) => [p.employee_id, p]));
  return (
    <div className="space-y-5">
      {canEdit ? form : <p className="text-sm text-muted">Only payroll administrators can change this.</p>}
      <div>
        <h3 className="mb-2 text-sm font-semibold">Per-employee overrides</h3>
        <table className="w-full text-sm">
          <thead><tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-muted"><th className="py-2">Employee</th><th>PF</th><th>ESI</th><th>PT state</th><th>Monthly gross</th><th /></tr></thead>
          <tbody className="divide-y divide-line">
            {people.map((p) => {
              const s = by.get(p.id);
              return (
                <tr key={p.id}>
                  <td className="py-2 font-medium">{p.name}</td>
                  <td>{s?.pf_applicable === false ? <Pill>Opted out</Pill> : <Pill tone="success">Applies</Pill>}</td>
                  <td>{s?.esi_applicable === true ? <Pill tone="success">Applies</Pill> : s?.esi_applicable === false ? <Pill>No</Pill> : <span className="text-xs text-muted">By wage ({p.monthlyGross <= 21000 && p.ctc ? 'eligible' : 'not eligible'})</span>}</td>
                  <td>{s?.pt_state ?? <span className="text-xs text-muted">From location</span>}</td>
                  <td className="tabular-nums">{p.ctc ? inr.format(p.monthlyGross) : '—'}</td>
                  <td className="text-right"><Link href={`/app/${slug}/employees/${p.id}#compensation`} className="text-xs font-medium text-primary">Edit</Link></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

async function ProfessionalTax({ ctx, month }: { ctx: TabProps['ctx']; month: string }) {
  const supabase = await createClient();
  const [{ data: sets }, people, { data: profiles }, { data: locs }] = await Promise.all([
    supabase.from('statutory_rule_sets').select('code, effective_from, effective_to, rules, validated').order('effective_from', { ascending: false }),
    payrollPeople(ctx.org.id, month),
    supabase.from('employee_statutory_profiles').select('employee_id, pt_state').eq('organization_id', ctx.org.id),
    supabase.from('locations').select('name, state_code').eq('organization_id', ctx.org.id),
  ]);
  const set = (sets ?? []).find((s) => s.effective_from <= month && (!s.effective_to || s.effective_to >= month)) ?? sets?.[0];
  const rules = set ? ruleSetSchema.safeParse(set.rules) : null;
  const locState = new Map((locs ?? []).map((l) => [l.name, l.state_code]));
  const own = new Map((profiles ?? []).map((p) => [p.employee_id, p.pt_state]));
  const counts = new Map<string, number>();
  for (const p of people) {
    const st = own.get(p.id) ?? (p.location ? locState.get(p.location) : null) ?? 'No state';
    counts.set(st, (counts.get(st) ?? 0) + 1);
  }
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div>
        <h3 className="mb-2 text-sm font-semibold">State slabs · {set?.code}{set && !set.validated && <span className="ml-2 text-xs font-normal text-warning">not professionally validated</span>}</h3>
        {rules?.success ? Object.entries(rules.data.pt).map(([state, slabs]) => (
          <table key={state} className="mb-3 w-full text-sm">
            <caption className="py-1 text-left text-xs font-semibold text-muted">{state}</caption>
            <tbody className="divide-y divide-line">
              {slabs.map((s, i) => <tr key={i}><td className="py-1.5">{inr.format(s.min)} – {s.max === null ? 'above' : inr.format(s.max)}</td><td className="text-right tabular-nums">{inr.format(s.amount)}{s.februaryAmount !== undefined && <span className="text-xs text-muted"> (Feb {inr.format(s.februaryAmount)})</span>}</td></tr>)}
            </tbody>
          </table>
        )) : <p className="text-sm text-muted">No rules loaded.</p>}
      </div>
      <div>
        <h3 className="mb-2 text-sm font-semibold">Employees by PT state</h3>
        <ul className="divide-y divide-line text-sm">
          {[...counts.entries()].map(([st, n]) => (
            <li key={st} className="flex justify-between py-2"><span>{st}{st !== 'No state' && rules?.success && !rules.data.pt[st] && <span className="ml-2 text-xs text-danger">no rules — payroll will stop</span>}</span><span className="tabular-nums">{n}</span></li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted">The state comes from the employee’s work location (Company › Locations), or an override on their profile.</p>
      </div>
    </div>
  );
}

async function Components({ orgId, slug, canEdit, open, href }: { orgId: string; slug: string; canEdit: boolean; open?: string; href: (id: string) => string }) {
  const list = await components(orgId);
  const action = saveComponentAction.bind(null, slug);
  return (
    <div className="space-y-4">
      <table className="w-full text-sm">
        <thead><tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-muted"><th className="py-2">Component</th><th>Type</th><th>Category</th><th>Taxable</th><th>PF wage</th><th>Status</th><th /></tr></thead>
        <tbody className="divide-y divide-line">
          {list.map((c) => (
            <tr key={c.id}>
              <td className="py-2"><span className="font-medium">{c.name}</span> <span className="text-xs text-muted">{c.code}</span></td>
              <td className="capitalize">{c.kind}</td>
              <td className="capitalize">{c.category}</td>
              <td>{c.taxable ? 'Yes' : 'No'}</td>
              <td>{c.pf_wage ? 'Yes' : 'No'}</td>
              <td>{c.is_active ? <Pill tone="success">Active</Pill> : <Pill>Inactive</Pill>}</td>
              <td className="text-right">{canEdit && <Link href={href(c.id)} className="text-xs font-medium text-primary">Edit</Link>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {canEdit && open && list.find((c) => c.id === open) && (
        <div className="rounded-xl border border-line p-4"><ComponentForm action={action} component={list.find((c) => c.id === open)} /></div>
      )}
      {canEdit && <div className="rounded-xl border border-dashed border-line p-4"><p className="mb-3 text-sm font-semibold">Add a component</p><ComponentForm action={action} /></div>}
    </div>
  );
}

async function BankOverview({ ctx, slug, month }: { ctx: TabProps['ctx']; slug: string; month: string }) {
  const [people, ready] = await Promise.all([payrollPeople(ctx.org.id, month), readiness(ctx.org.id)]);
  return (
    <table className="w-full text-sm">
      <thead><tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-muted"><th className="py-2">Employee</th><th>Bank</th><th>IFSC</th><th>Account</th><th>Payment mode</th><th /></tr></thead>
      <tbody className="divide-y divide-line">
        {people.map((p) => {
          const r = ready.get(p.id);
          return (
            <tr key={p.id}>
              <td className="py-2 font-medium">{p.name}</td>
              <td>{r?.bank ?? <Pill tone="warning">Missing</Pill>}</td>
              <td className="font-mono text-xs">{r?.ifsc ?? '—'}</td>
              <td className="font-mono text-xs">{r?.last4 ? `••${r.last4}` : '—'}</td>
              <td>{r?.bank ? 'Bank Transfer' : 'Cheque / cash'}</td>
              <td className="text-right"><Link href={`/app/${slug}/employees/${p.id}`} className="text-xs font-medium text-primary">{r?.bank ? 'Change' : 'Add'}</Link></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
