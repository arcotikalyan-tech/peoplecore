import type { Metadata } from 'next';
import Link from 'next/link';
import { todayIn } from '@peoplecore/shared';
import { HubTabs, Panel, StatCard, SubTabs } from '@/components/ui/hub';
import { Badge } from '@/components/ui/surface';
import { formatDate, formatDateTime } from '@/lib/format';
import { CD_KINDS, endorsementReason, type CdKind } from '@/lib/insurance';
import { getOrgContext } from '@/server/context';
import { getMyEmployee } from '@/server/employees';
import { createClient } from '@/server/supabase';
import { viewModeFor } from '@/server/view';
import {
  addCdEntryAction, coverAllAction, deleteCdEntryAction, importCoverageAction, lockEndorsementAction, reconcileAction, saveCdSettingsAction, savePolicyAction,
  setCoverageAction,
} from './actions';
import {
  ButtonAction, CdEntryForm, CdSettingsForm, CoverageForm, EndorsementPicker, MyCover, PolicyForm, ReconcileForm, SumInsuredForm, UploadForm, type PickRow, type Policy,
} from './insurance-client';
import { requireModule } from '@/server/modules';
import { allRows } from '@/server/all-rows';

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
  const cd = { perLife: num(policyRow?.premium_per_life), lowBalance: num(policyRow?.cd_low_balance) };

  return (
    <>
      <Header title="Insurance" subtitle="Configure your company group health policy and manage insured members & dependants."
        action={<Link className="rounded-lg border border-line bg-surface px-3 py-2 text-sm hover:bg-subtle" href={`${base}?tab=management`}>Manage members →</Link>} />
      <HubTabs base={base} label="Insurance sections" current={tab} tabs={[{ key: 'details', label: 'Insurance Details' }, { key: 'management', label: 'Insurance Management' }]} />
      {tab === 'details' && <Panel title="Policy Details"><PolicyForm action={savePolicyAction.bind(null, slug)} policy={policy} /></Panel>}
      {tab === 'management' && <Management slug={slug} base={base} sp={sp} policy={policy} cd={cd} tz={ctx.org.timezone} />}
    </>
  );
}

type Cd = { perLife: number | null; lowBalance: number | null };

async function Management({ slug, base, sp, policy, cd, tz }: { slug: string; base: string; sp: Search; policy: Policy | null; cd: Cd; tz: string }) {
  const ctx = await getOrgContext(slug);
  const supabase = await createClient();
  const [roster, syncs, emps, coverage, personal, entries] = await Promise.all([
    supabase.rpc('insurance_endorsement', { p_org: ctx.org.id }).then((r) => r.data ?? []),
    supabase.from('insurance_syncs').select('id, synced_at, additions, deletions').eq('organization_id', ctx.org.id).order('synced_at', { ascending: false }).limit(12).then((r) => r.data ?? []),
    supabase.from('employees').select('id, employee_code, first_name, last_name, employment_type, date_of_joining, status').eq('organization_id', ctx.org.id).neq('status', 'exited').order('employee_code').then((r) => r.data ?? []),
    supabase.from('insurance_coverage').select('employee_id, covered, sum_insured').eq('organization_id', ctx.org.id).then((r) => r.data ?? []),
    supabase.from('employee_personal').select('employee_id, gender').eq('organization_id', ctx.org.id).then((r) => r.data ?? []),
    allRows((a, b) => supabase.from('insurance_cd_entries').select('id, entry_date, kind, amount, lives, sync_id, reference, note, created_at').eq('organization_id', ctx.org.id)
      .order('entry_date').order('created_at').order('id').range(a, b)).then((r) => r.data ?? []),
  ]);
  const lastSync = syncs[0] ?? null;
  const balance = entries.reduce((sum, e) => sum + Number(e.amount), 0);
  const low = cd.lowBalance !== null && balance < cd.lowBalance;
  const additions = roster.filter((r) => r.change === 'addition');
  const deletions = roster.filter((r) => r.change === 'deletion');
  const lives = roster.filter((r) => r.change !== 'deletion').length;
  const view = ['endorsement', 'reconcile', 'members', 'cd'].includes(sp.view ?? '') ? sp.view! : 'endorsement';
  const today = todayIn(tz);
  const picks: PickRow[] = roster.filter((r) => r.change !== 'covered').map((r) => ({
    key: r.key, change: r.change, member: r.member_name, employee: r.employee_name, code: r.employee_code, relationship: r.relationship,
    reason: endorsementReason(r, !lastSync, today), dob: r.date_of_birth, gender: r.gender, sumInsured: num(r.sum_insured), effective: r.effective,
  }));

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="＋ Additions" value={additions.length} note="since last sync" tone="success" />
        <StatCard label="－ Deletions" value={deletions.length} note="since last sync" tone="danger" />
        <StatCard label="❤️ Insured lives" value={lives} note="after this endorsement" tone="primary" />
        <StatCard label="🗓️ Last synced to insurer" value={lastSync ? formatDate(lastSync.synced_at.slice(0, 10)) : 'Not synced'} note={`${additions.length + deletions.length} pending`} />
      </div>
      <SubTabs base={base} label="Insurance management" current={view} extra={{ tab: 'management' }}
        tabs={[{ key: 'endorsement', label: 'Endorsement' }, { key: 'reconcile', label: 'Reconcile with insurer' }, { key: 'members', label: 'All Members' }, { key: 'cd', label: 'CD account' }]} />
      {low && view !== 'cd' && (
        <p role="alert" className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
          ⚠️ The CD balance is {inr.format(balance)}, below your alert level of {inr.format(cd.lowBalance!)}. Top it up before the next endorsement. <Link className="text-primary hover:underline" href={`${base}?tab=management&view=cd`}>CD account →</Link>
        </p>
      )}

      {view === 'endorsement' && (
        <EndorsementPicker key={`${lastSync?.id ?? 'initial'}-${picks.length}`} rows={picks} action={lockEndorsementAction.bind(null, slug)} exportHref={`${base}/export?kind=endorsement`}>
          {!lastSync && <p className="rounded-xl bg-subtle p-3 text-sm">📋 Initial roster. Nothing has been synced with the insurer yet, so everyone covered is listed as an addition. Locking and syncing the first time takes this roster as the baseline; later endorsements show only real changes.</p>}
          {lastSync && <p className="text-sm text-muted">Last synced {formatDateTime(lastSync.synced_at, tz)} ({lastSync.additions} additions, {lastSync.deletions} deletions). Changes you leave out stay pending for the next endorsement.</p>}
        </EndorsementPicker>
      )}

      {view === 'reconcile' && (
        <Panel title="Reconcile with insurer">
          <p className="mb-3 text-sm text-muted">Upload the member list from the insurer or TPA to find people they’re missing and people they still cover who aren’t on your roster.</p>
          <ReconcileForm action={reconcileAction.bind(null, slug)} />
        </Panel>
      )}

      {view === 'members' && <Members slug={slug} base={base} sp={sp} policy={policy} roster={roster} emps={emps} coverage={coverage} personal={personal} />}

      {view === 'cd' && <CdAccount slug={slug} policy={policy} cd={cd} entries={entries} syncs={syncs} lives={lives} balance={balance} low={low} today={today} tz={tz} />}
    </div>
  );
}

type RosterRow = { change: string; key: string; employee_code: string; employee_name: string; member_name: string; relationship: string; date_of_birth: string | null; gender: string | null; sum_insured: number | string | null; effective: string | null };

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

type CdEntry = { id: string; entry_date: string; kind: string; amount: number | string; lives: number | null; sync_id: string | null; reference: string | null; note: string | null };
type Sync = { id: string; synced_at: string; additions: number; deletions: number };

/** Entries oldest first, each with the balance after it. */
function withBalance(entries: CdEntry[]): Array<CdEntry & { balance: number }> {
  const out: Array<CdEntry & { balance: number }> = [];
  let balance = 0;
  for (const e of entries) out.push({ ...e, balance: (balance += Number(e.amount)) });
  return out;
}

/**
 * The CD (cash deposit) account the insurer keeps for the group policy: deposits and refunds in, endorsement charges
 * out, with a running balance, a low-balance warning and a guide to the next charge.
 */
function CdAccount({ slug, policy, cd, entries, syncs, lives, balance, low, today, tz }: {
  slug: string; policy: Policy | null; cd: Cd; entries: CdEntry[]; syncs: Sync[]; lives: number; balance: number; low: boolean; today: string; tz: string;
}) {
  const rows = withBalance(entries).reverse();
  const synced = new Map(syncs.map((s) => [s.id, s]));
  const syncLabel = (s: Sync) => `${formatDateTime(s.synced_at, tz)} · ${s.additions} addition${s.additions === 1 ? '' : 's'}, ${s.deletions} deletion${s.deletions === 1 ? '' : 's'}`;
  const deposits = entries.filter((e) => e.kind === 'deposit');
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="💰 CD balance" value={inr.format(balance)} note={cd.lowBalance !== null ? `alert below ${inr.format(cd.lowBalance)}` : 'no alert level set'} tone={low ? 'danger' : 'success'} />
        <StatCard label="⬇ Last deposit" value={deposits.length ? inr.format(Number(deposits.at(-1)!.amount)) : '—'} note={deposits.length ? formatDate(deposits.at(-1)!.entry_date) : 'none yet'} />
        <StatCard label="🧾 Premium per life" value={cd.perLife !== null ? inr.format(cd.perLife) : 'Not set'} note="annual, for estimates" />
        <StatCard label="❤️ Annual premium" value={cd.perLife !== null ? inr.format(cd.perLife * lives) : '—'} note={`${lives} insured ${lives === 1 ? 'life' : 'lives'} × premium per life`} tone="primary" />
      </div>
      {low && <p role="alert" className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">⚠️ The balance is below your alert level of {inr.format(cd.lowBalance!)}. Top up the CD account so the insurer can process the next endorsement.</p>}
      <Panel title="Record an entry" meta="from the insurer’s statement or debit note">
        <CdEntryForm action={addCdEntryAction.bind(null, slug)} today={today} syncs={syncs.map((s) => ({ id: s.id, label: syncLabel(s), lives: s.additions - s.deletions }))}
          premium={{ perLife: cd.perLife, validFrom: policy?.valid_from ?? null, validTo: policy?.valid_to ?? null }} />
      </Panel>
      <Panel title="CD statement" meta={`${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`} flush>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" aria-label="CD statement">
            <thead className="text-left text-[11px] uppercase tracking-wider text-muted">
              <tr><th className="px-5 py-2">Date</th><th className={th}>Entry</th><th className={th}>Reference</th><th className={th}>Lives</th><th className={`${th} text-right`}>Amount</th><th className={`${th} text-right`}>Balance</th><th className={th} /></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.length === 0 && <tr><td colSpan={7} className="px-5 py-6 text-center text-muted">No entries yet. Record the deposit you made with the insurer to start the statement.</td></tr>}
              {rows.map((e) => {
                const amount = Number(e.amount);
                const sync = e.sync_id ? synced.get(e.sync_id) : undefined;
                return (
                  <tr key={e.id}>
                    <td className="px-5 py-2">{formatDate(e.entry_date)}</td>
                    <td className="px-3"><span className="font-medium">{CD_KINDS[e.kind as CdKind] ?? e.kind}</span>
                      {sync && <span className="block text-xs text-muted">Endorsement of {formatDate(sync.synced_at.slice(0, 10))}</span>}
                      {e.note && <span className="block text-xs text-muted">{e.note}</span>}</td>
                    <td className="px-3">{e.reference ?? '—'}</td><td className="px-3 tabular-nums">{e.lives ?? '—'}</td>
                    <td className={`px-3 text-right tabular-nums ${amount < 0 ? 'text-danger' : 'text-success'}`}>{amount < 0 ? '−' : '+'}{inr.format(Math.abs(amount))}</td>
                    <td className="px-3 text-right font-medium tabular-nums">{inr.format(e.balance)}</td>
                    <td className="px-3"><ButtonAction action={deleteCdEntryAction.bind(null, slug, e.id)} label="Remove" aria={`Remove the ${formatDate(e.entry_date)} ${(CD_KINDS[e.kind as CdKind] ?? e.kind).toLowerCase()}`} variant="secondary" /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title="CD settings"><CdSettingsForm action={saveCdSettingsAction.bind(null, slug)} perLife={cd.perLife} lowBalance={cd.lowBalance} /></Panel>
    </div>
  );
}
