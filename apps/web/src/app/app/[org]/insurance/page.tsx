import type { Metadata } from 'next';
import Link from 'next/link';
import { HubTabs, Panel, StatCard, SubTabs } from '@/components/ui/hub';
import { Badge } from '@/components/ui/surface';
import { formatDate, formatDateTime } from '@/lib/format';
import { getOrgContext } from '@/server/context';
import { getMyEmployee } from '@/server/employees';
import { createClient } from '@/server/supabase';
import { viewModeFor } from '@/server/view';
import { coverAllAction, importCoverageAction, lockEndorsementAction, reconcileAction, savePolicyAction, setCoverageAction } from './actions';
import { ButtonAction, CoverageForm, MyCover, PolicyForm, ReconcileForm, SumInsuredForm, UploadForm, type Policy } from './insurance-client';
import { requireModule } from '@/server/modules';

export const metadata: Metadata = { title: 'Insurance' };

type Search = Record<string, string | undefined>;
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const th = 'px-3 py-2 font-semibold';
const TYPE: Record<string, string> = { permanent: 'Full Time', contract: 'On Contract', intern: 'Intern', temporary: 'Part Time', consultant: 'Consultant' };
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

function Header({ title, subtitle, action }: { title: string; subtitle: string; action?: React.ReactNode }) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <div className="flex items-center gap-2"><h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">Group health</span></div>
        <p className="mt-1 text-sm text-muted">{subtitle}</p>
      </div>
      {action}
    </header>
  );
}

/** Group health insurance (Kredily's Insurance): the policy, coverage, endorsements and reconciliation; My Insurance. */
export default async function InsurancePage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<Search> }) {
  const { org: slug } = await params;
  const sp = await searchParams;
  const ctx = await getOrgContext(slug);
  await requireModule(ctx.org.id, 'insurance');
  const base = `/app/${slug}/insurance`;
  const supabase = await createClient();
  const manages = ctx.can('insurance.manage', 'org') && (await viewModeFor(ctx)) === 'admin';

  if (!manages) {
    const me = await getMyEmployee(ctx.org.id, ctx.user.id);
    const mine = me ? (await supabase.rpc('my_insurance', { p_org: ctx.org.id })).data as { covered: boolean; policy?: Partial<Policy>; members?: Array<{ name: string; relationship: string; dateOfBirth: string | null; sumInsured: number | null }> } | null : null;
    return (
      <>
        <Header title="My Insurance" subtitle="Your company-provided group health cover and insured dependants." />
        {!mine?.covered ? (
          <Panel title="Cover">
            <div className="py-6 text-center"><p className="text-3xl" aria-hidden>🛡️</p><p className="mt-2 font-semibold">No active insurance</p>
              <p className="mt-1 text-sm text-muted">You are not currently enrolled in a company group health policy. Reach out to HR for details.</p></div>
          </Panel>
        ) : (
          <Panel title="Your group health cover">
            <MyCover policy={mine.policy ?? {}} members={mine.members ?? []} />
            <p className="mt-4 text-xs text-muted">Dependants come from the family details in <Link className="text-primary hover:underline" href={`/app/${slug}/employees/${me!.id}?tab=family`}>your profile</Link>.</p>
          </Panel>
        )}
      </>
    );
  }

  const tab = sp.tab === 'management' ? 'management' : 'details';
  const { data: policyRow } = await supabase.from('insurance_policies').select('*').eq('organization_id', ctx.org.id).maybeSingle();
  const policy: Policy | null = policyRow ? {
    ...policyRow, maternity_normal: num(policyRow.maternity_normal), maternity_csection: num(policyRow.maternity_csection), sum_insured: num(policyRow.sum_insured),
    ambulance_per_incident: num(policyRow.ambulance_per_incident),
  } : null;

  return (
    <>
      <Header title="Insurance" subtitle="Configure your company group health policy and manage insured members & dependants."
        action={<Link className="rounded-lg border border-line bg-surface px-3 py-2 text-sm hover:bg-subtle" href={`${base}?tab=management`}>Manage members →</Link>} />
      <HubTabs base={base} label="Insurance sections" current={tab} tabs={[{ key: 'details', label: 'Insurance Details' }, { key: 'management', label: 'Insurance Management' }]} />
      {tab === 'details' && <Panel title="Policy Details"><PolicyForm action={savePolicyAction.bind(null, slug)} policy={policy} /></Panel>}
      {tab === 'management' && <Management slug={slug} base={base} sp={sp} policy={policy} tz={ctx.org.timezone} />}
    </>
  );
}

async function Management({ slug, base, sp, policy, tz }: { slug: string; base: string; sp: Search; policy: Policy | null; tz: string }) {
  const ctx = await getOrgContext(slug);
  const supabase = await createClient();
  const [roster, lastSync, emps, coverage, personal] = await Promise.all([
    supabase.rpc('insurance_endorsement', { p_org: ctx.org.id }).then((r) => r.data ?? []),
    supabase.from('insurance_syncs').select('synced_at, additions, deletions').eq('organization_id', ctx.org.id).order('synced_at', { ascending: false }).limit(1).then((r) => r.data?.[0] ?? null),
    supabase.from('employees').select('id, employee_code, first_name, last_name, employment_type, date_of_joining, status').eq('organization_id', ctx.org.id).neq('status', 'exited').order('employee_code').then((r) => r.data ?? []),
    supabase.from('insurance_coverage').select('employee_id, covered, sum_insured').eq('organization_id', ctx.org.id).then((r) => r.data ?? []),
    supabase.from('employee_personal').select('employee_id, gender').eq('organization_id', ctx.org.id).then((r) => r.data ?? []),
  ]);
  const additions = roster.filter((r) => r.change === 'addition');
  const deletions = roster.filter((r) => r.change === 'deletion');
  const lives = roster.filter((r) => r.change !== 'deletion').length;
  const view = ['endorsement', 'reconcile', 'members'].includes(sp.view ?? '') ? sp.view! : 'endorsement';

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="＋ Additions" value={additions.length} note="since last sync" tone="success" />
        <StatCard label="－ Deletions" value={deletions.length} note="since last sync" tone="danger" />
        <StatCard label="❤️ Insured lives" value={lives} note="after this endorsement" tone="primary" />
        <StatCard label="🗓️ Last synced to insurer" value={lastSync ? formatDate(lastSync.synced_at.slice(0, 10)) : 'Not synced'} note={`${additions.length + deletions.length} pending`} />
      </div>
      <SubTabs base={base} label="Insurance management" current={view} extra={{ tab: 'management' }}
        tabs={[{ key: 'endorsement', label: 'Endorsement' }, { key: 'reconcile', label: 'Reconcile with insurer' }, { key: 'members', label: 'All Members' }]} />

      {view === 'endorsement' && (
        <>
          <Panel title="Endorsement" meta={`${additions.length + deletions.length} pending changes`}
            action={<span className="flex flex-wrap items-center gap-2">
              <a className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-subtle" href={`${base}/export?kind=endorsement`} download>⬇ Export endorsement</a>
              <ButtonAction action={lockEndorsementAction.bind(null, slug)} label="Lock & mark synced" aria="Lock endorsement" pending="Locking…" />
            </span>}>
            {!lastSync && <p className="rounded-xl bg-subtle p-3 text-sm">📋 Initial roster. Nothing has been synced with the insurer yet, so everyone covered is listed as an addition. Locking and syncing the first time takes this roster as the baseline; later endorsements show only real changes.</p>}
            {lastSync && <p className="text-sm text-muted">Last synced {formatDateTime(lastSync.synced_at, tz)} ({lastSync.additions} additions, {lastSync.deletions} deletions).</p>}
          </Panel>
          <Panel title={`＋ Additions · ${additions.length}`} meta="new joiners, newborns, marriages, dependant adds — from employee records" flush>
            <RosterTable rows={additions} label="Additions" empty="No additions pending." />
          </Panel>
          <Panel title={`－ Deletions · ${deletions.length}`} meta="exits and dependant removals" flush>
            <RosterTable rows={deletions} label="Deletions" empty="No deletions pending — all synced." />
          </Panel>
        </>
      )}

      {view === 'reconcile' && (
        <Panel title="Reconcile with insurer">
          <p className="mb-3 text-sm text-muted">Upload the member list from the insurer or TPA to find people they’re missing and people they still cover who aren’t on your roster.</p>
          <ReconcileForm action={reconcileAction.bind(null, slug)} />
        </Panel>
      )}

      {view === 'members' && <Members slug={slug} base={base} sp={sp} policy={policy} roster={roster} emps={emps} coverage={coverage} personal={personal} />}
    </div>
  );
}

type RosterRow = { change: string; key: string; employee_code: string; employee_name: string; member_name: string; relationship: string; date_of_birth: string | null; gender: string | null; sum_insured: number | string | null; effective: string | null };

function RosterTable({ rows, label, empty }: { rows: RosterRow[]; label: string; empty: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" aria-label={label}>
        <thead className="text-left text-[11px] uppercase tracking-wider text-muted"><tr><th className="px-5 py-2">Member</th><th className={th}>Employee</th><th className={th}>Relationship</th><th className={th}>Date of birth</th><th className={th}>Gender</th><th className={`${th} text-right`}>Sum insured</th><th className={th}>Effective</th></tr></thead>
        <tbody className="divide-y divide-line">
          {rows.length === 0 && <tr><td colSpan={7} className="px-5 py-6 text-center text-muted">{empty}</td></tr>}
          {rows.map((r) => (
            <tr key={`${r.change}-${r.key}`}>
              <td className="px-5 py-2 font-medium">{r.member_name}</td><td className="px-3">{r.employee_name} <span className="text-xs text-muted">{r.employee_code}</span></td>
              <td className="px-3 capitalize">{r.relationship}</td><td className="px-3">{r.date_of_birth ? formatDate(r.date_of_birth) : '—'}</td>
              <td className="px-3 capitalize">{r.gender ?? '—'}</td><td className="px-3 text-right tabular-nums">{r.sum_insured ? inr.format(Number(r.sum_insured)) : '—'}</td>
              <td className="px-3">{r.effective ? formatDate(r.effective) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Members({ slug, base, sp, policy, roster, emps, coverage, personal }: {
  slug: string; base: string; sp: Search; policy: Policy | null; roster: RosterRow[];
  emps: Array<{ id: string; employee_code: string; first_name: string; last_name: string | null; employment_type: string; date_of_joining: string; status: string }>;
  coverage: Array<{ employee_id: string; covered: boolean; sum_insured: number | string | null }>; personal: Array<{ employee_id: string; gender: string | null }>;
}) {
  const cov = new Map(coverage.map((c) => [c.employee_id, c]));
  const gender = new Map(personal.map((p) => [p.employee_id, p.gender]));
  const deps = (code: string, rel: string) => roster.filter((r) => r.change !== 'deletion' && r.employee_code === code && r.relationship === rel).length;
  const rows = emps.filter((e) => {
    const c = cov.get(e.id);
    if (sp.coverage === 'covered' && !c?.covered) return false;
    if (sp.coverage === 'not' && c?.covered) return false;
    if (sp.type && e.employment_type !== sp.type) return false;
    if (sp.gender && gender.get(e.id) !== sp.gender) return false;
    return true;
  });
  const sel = 'h-9 rounded-lg border border-line bg-surface px-2 text-sm';
  const covered = emps.filter((e) => cov.get(e.id)?.covered).length;
  return (
    <Panel title="Insured Members" meta={`${emps.length} employees · ${covered} covered`} flush
      action={<span className="flex flex-wrap items-center gap-2">
        <ButtonAction action={coverAllAction.bind(null, slug)} label="Cover everyone not yet listed" aria="Cover all employees" variant="secondary" />
        <a className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-subtle" href={`${base}/export`} download>⬇ Export</a>
      </span>}>
      <form method="get" action={base} className="flex flex-wrap items-end gap-2 px-5 py-3" aria-label="Filter members">
        <input type="hidden" name="tab" value="management" /><input type="hidden" name="view" value="members" />
        <select name="coverage" defaultValue={sp.coverage ?? ''} aria-label="Coverage" className={sel}><option value="">All coverage</option><option value="covered">Covered</option><option value="not">Not covered</option></select>
        <select name="type" defaultValue={sp.type ?? ''} aria-label="Employment type" className={sel}><option value="">All types</option>{Object.entries(TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select name="gender" defaultValue={sp.gender ?? ''} aria-label="Gender" className={sel}><option value="">All genders</option><option value="male">Male</option><option value="female">Female</option><option value="transgender">Transgender</option><option value="non_binary">Non-binary</option></select>
        <button type="submit" className="h-9 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-fg">⨁ Filter</button>
      </form>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" aria-label="Insured members">
          <thead className="text-left text-[11px] uppercase tracking-wider text-muted">
            <tr><th className="px-5 py-2">ID</th><th className={th}>Employee</th><th className={th}>Policy covered</th><th className={th}>Type</th><th className={th}>Gender</th><th className={th}>Date of joining</th><th className={th}>Sum insured</th><th className={th}>Policy no.</th><th className={th}>Spouse</th><th className={th}>Children</th><th className={th}>Parents</th><th className={th} /></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((e) => {
              const c = cov.get(e.id);
              const name = [e.first_name, e.last_name].filter(Boolean).join(' ');
              const on = !!c?.covered;
              return (
                <tr key={e.id}>
                  <td className="px-5 py-2 tabular-nums">{e.employee_code}</td><td className="px-3 font-medium">{name}</td>
                  <td className="px-3">{on ? <Badge tone="success">● Yes</Badge> : <span className="text-muted">○ No</span>}</td>
                  <td className="px-3">{TYPE[e.employment_type] ?? e.employment_type}</td><td className="px-3 capitalize">{gender.get(e.id)?.replace('_', '-') ?? '—'}</td>
                  <td className="px-3">{formatDate(e.date_of_joining)}</td>
                  <td className="px-3">{on ? <SumInsuredForm action={setCoverageAction.bind(null, slug)} employeeId={e.id} name={name} sumInsured={num(c?.sum_insured) ?? null} /> : '—'}</td>
                  <td className="px-3">{on ? policy?.policy_number ?? '—' : '—'}</td>
                  <td className="px-3 tabular-nums">{on ? deps(e.employee_code, 'spouse') : '—'}</td><td className="px-3 tabular-nums">{on ? deps(e.employee_code, 'child') : '—'}</td>
                  <td className="px-3 tabular-nums">{on ? deps(e.employee_code, 'parent') : '—'}</td>
                  <td className="px-3"><CoverageForm action={setCoverageAction.bind(null, slug)} employeeId={e.id} name={name} covered={on} sumInsured={num(c?.sum_insured) ?? null} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="px-5 pt-4"><UploadForm action={importCoverageAction.bind(null, slug)} label="Upload active list" hint="employee_code, covered (yes/no), sum_insured, covered_from" /></div>
    </Panel>
  );
}
