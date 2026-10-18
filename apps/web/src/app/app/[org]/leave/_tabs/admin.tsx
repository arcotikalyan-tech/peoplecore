import Link from 'next/link';
import { MONTH_NAMES, type LeaveStatus } from '@peoplecore/shared';
import { BarChart, SplitBar } from '@/components/ui/charts';
import { buttonClass } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { Panel, StatCard, SubTabs } from '@/components/ui/hub';
import { formatDate } from '@/lib/format';
import type { OrgContext } from '@/server/context';
import { getInbox } from '@/server/inbox';
import {
  getBalanceSheet, getLedger, getLeaveSettings, getRequestsBoard, getRules, leaveCycle, leaveEmployees, ledgerMonths, type LeaveRule,
} from '@/server/leave-ops';
import { getLeaveSetup } from '@/server/leave';
import {
  addHolidayAction, applyLeaveAction, assignLeaveRuleAction, cancelLeaveAction, decideLeaveAction, importAssignmentsAction, recalculateLeaveAction,
  removeAssignmentsAction, removeHolidayAction, saveLeaveRuleAction, saveLeaveSettingsAction, setBalanceAction,
} from '../actions';
import {
  ApplyLeaveForm, ApprovalsBoard, AssignmentsBoard, AssignRuleForm, BalanceEditor, HolidayForm, ImportAssignmentsForm, LeaveRuleEditor,
  LeaveSettingsForm, RemoveHoliday, RowApprove, RunButton, type BoardRow, type RuleValues,
} from '../leave-forms';
import { CategoryIcon, num, riskOf, ruleFacts, shortDate, STATUS_TONE, statusLabel } from './common';

type Ctx = { ctx: OrgContext; slug: string; base: string; today: string };

const NEW_RULE: RuleValues = {
  name: '', category: 'custom', shortName: '', description: '', annualDays: 12, countWeekends: false, countHolidays: false, accrueOverYear: true,
  creditOnPresentDays: false, accrualFrequency: 'monthly', accrualTiming: 'start', carryForward: false, carryForwardMax: null, encashable: false,
  appliesDuringProbation: true, allowedOnNotice: true, maxPerMonth: null, maxContinuous: null, allowNegative: false, allowHalfDay: true, isPaid: true,
  allowFuture: true, futureNoticeDays: 0, allowBackdated: true, backdatedMaxDays: null, nextYearUntil: null, appliesTo: 'everyone',
};

function ruleValues(r: LeaveRule): RuleValues {
  const p = r.policy;
  return {
    typeId: r.id, name: r.name, category: r.category, shortName: r.short_name ?? '', description: r.description ?? '', annualDays: p?.annual_days ?? 0,
    countWeekends: r.count_weekends, countHolidays: r.count_holidays, accrueOverYear: p ? p.accrual_period !== 'yearly' : true,
    creditOnPresentDays: p?.credit_on_present_days ?? false,
    accrualFrequency: p && ['monthly', 'quarterly', 'half_yearly'].includes(p.accrual_period) ? p.accrual_period : 'monthly',
    accrualTiming: p?.accrual_timing ?? 'start', carryForward: p ? p.carry_forward_max !== 0 : false, carryForwardMax: p?.carry_forward_max ?? null,
    encashable: r.encashable, appliesDuringProbation: p?.accrue_during_probation ?? true, allowedOnNotice: p?.allowed_on_notice ?? true,
    maxPerMonth: p?.max_per_month ?? null, maxContinuous: p?.max_continuous ?? null, allowNegative: r.allow_negative, allowHalfDay: r.allow_half_day,
    isPaid: r.is_paid, allowFuture: p?.allow_future ?? true, futureNoticeDays: p?.future_notice_days ?? 0, allowBackdated: p?.allow_backdated ?? true,
    backdatedMaxDays: p?.backdated_max_days ?? null, nextYearUntil: p?.next_year_until ?? null, appliesTo: r.applies_to,
  };
}

// ─── Hub ────────────────────────────────────────────────────────────────────

export async function AdminHub({ ctx, slug, base, today }: Ctx) {
  const settings = await getLeaveSettings(ctx.org.id);
  const cycle = leaveCycle(today, settings.year_start_month);
  const [requests, { rules }, emps, inbox] = await Promise.all([
    getRequestsBoard(ctx.org.id, { from: cycle.start, to: cycle.end }, 2000), getRules(ctx.org.id, today), leaveEmployees(ctx.org.id),
    getInbox(ctx.org.id, null),
  ]);
  const typeName = new Map(rules.map((r) => [r.id, r.name]));
  const typeCat = new Map(rules.map((r) => [r.id, r.category]));
  const month = today.slice(0, 7);
  const pending = requests.filter((r) => r.status === 'pending');
  const onLeave = requests.filter((r) => r.status === 'approved' && r.start_date <= today && r.end_date >= today);
  const approvedMonth = requests.filter((r) => r.status === 'approved' && (r.decided_at ?? '').slice(0, 7) === month);
  const mine = new Set(inbox.approvals.filter((a) => a.subject_type === 'leave_request').map((a) => a.id));
  const actionable = pending.filter((r) => r.approval_request_id && mine.has(r.approval_request_id));

  const thisMonth = requests.filter((r) => r.status !== 'cancelled' && r.status !== 'rejected' && r.start_date.slice(0, 7) === month);
  const hot = [...rules].map((t) => ({ t, n: thisMonth.filter((r) => r.leave_type_id === t.id).length })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n);
  const qStart = `${today.slice(0, 5)}${String(Math.floor((Number(today.slice(5, 7)) - 1) / 3) * 3 + 1).padStart(2, '0')}-01`;
  const quarter = requests.filter((r) => r.status === 'approved' && r.end_date >= qStart && r.start_date <= today);
  const byDept = new Map<string, number>();
  for (const r of quarter) { const d = emps.byId.get(r.employee_id)?.department ?? 'No department'; byDept.set(d, (byDept.get(d) ?? 0) + r.days); }
  const approved = requests.filter((r) => r.status === 'approved');
  const byType = rules.map((t) => ({ label: t.short_name ?? t.code, value: approved.filter((r) => r.leave_type_id === t.id).reduce((s, r) => s + r.days, 0) })).filter((x) => x.value > 0);
  const m0 = Number(cycle.start.slice(5, 7)) - 1;
  const volume = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(Number(cycle.start.slice(0, 4)), m0 + i, 1)).toISOString().slice(0, 7);
    return { label: MONTH_NAMES[(m0 + i) % 12]!.slice(0, 3).toUpperCase(), value: d > month ? null : approved.filter((r) => r.start_date.slice(0, 7) === d).reduce((s, r) => s + r.days, 0) };
  });
  const tones = ['success', 'info', 'warning', 'danger', 'muted'] as const;

  return (
    <div className="space-y-5">
      <section aria-label="Today" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary-soft/40 px-5 py-4">
        <p className="text-sm"><span className="font-semibold">{pending.length} request{pending.length === 1 ? '' : 's'} awaiting approval</span>
          {' · '}{onLeave.length} on leave today · {approvedMonth.length} approved this month. Review the queue or run the carry-forward.</p>
        <div className="flex gap-2">
          <Link href={`${base}?tab=approvals&status=pending`} className={buttonClass('secondary', 'sm')}>Review queue</Link>
          <Link href={`${base}?tab=accruals`} className={buttonClass('secondary', 'sm')}>Run carry-forward</Link>
        </div>
      </section>
      <section aria-label="Leave this cycle" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="On leave today" value={onLeave.length} note="approved & active today" tone="info" />
        <StatCard label="Pending org-wide" value={pending.length} note="awaiting approval" tone="warning" href={`${base}?tab=approvals&status=pending`} />
        <StatCard label="Approved (month)" value={approvedMonth.length} note="this month" tone="success" />
        <StatCard label="Total requests" value={requests.length} note={`this cycle (${cycle.label})`} tone="primary" />
      </section>
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Latest pending requests" action={<Link href={`${base}?tab=approvals&status=pending`} className="text-sm text-primary hover:underline">See all →</Link>} flush>
          {pending.length === 0 ? <p className="px-5 py-4 text-sm text-muted">Nothing waiting.</p> : (
            <ul className="space-y-2 px-4 pb-2" aria-label="Latest pending requests">
              {pending.slice(0, 5).map((r) => {
                const e = emps.byId.get(r.employee_id);
                return (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line p-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <CategoryIcon category={typeCat.get(r.leave_type_id) ?? 'custom'} size="sm" />
                      <div className="min-w-0 text-sm">
                        <p><span className="font-medium">{e?.name ?? '—'}</span> <span className="text-xs text-muted">· {typeName.get(r.leave_type_id)}{e?.department ? ` · ${e.department}` : ''}</span></p>
                        <p className="text-xs text-muted">{r.start_date} → {r.end_date} · <span className="font-medium text-fg">{num(r.days)}d</span>{r.reason ? ` · ${r.reason}` : ''}</p>
                        <p className="text-xs text-muted">Applied {shortDate(r.created_at.slice(0, 10))}</p>
                      </div>
                    </div>
                    {r.approval_request_id && mine.has(r.approval_request_id) && (
                      <span className="flex items-center gap-1">
                        <RowApprove action={decideLeaveAction.bind(null, slug)} approvalId={r.approval_request_id} label={`${e?.name ?? ''} ${typeName.get(r.leave_type_id)} ${r.start_date}`} />
                        <Link href={`${base}?tab=approvals&status=pending`} className="rounded-md bg-danger/15 px-2 py-1 text-xs font-medium text-danger">✕ Reject</Link>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
        <Panel title="Hot leave types" meta="this month">
          {hot.length === 0 ? <p className="text-sm text-muted">No leave this month yet.</p> : (
            <ul className="space-y-3" aria-label="Hot leave types">
              {hot.map(({ t, n }, i) => (
                <li key={t.id} className="grid grid-cols-[120px_1fr_24px] items-center gap-3 text-sm">
                  <span className="truncate">{t.name}</span>
                  <span className="h-1.5 overflow-hidden rounded-full bg-subtle"><span className={cn('block h-full', i % 2 ? 'bg-warning' : 'bg-success')} style={{ width: `${(n / hot[0]!.n) * 100}%` }} /></span>
                  <span className="text-right tabular-nums">{n}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
      <Panel title="Org actions">
        <ul className="grid gap-3 sm:grid-cols-3" aria-label="Org actions">
          <li><Link href={`${base}?tab=approvals&status=pending`} className="block rounded-xl border border-line p-4 hover:border-line-strong"><span className="font-medium">Bulk approve</span><span className="block text-xs text-muted">{actionable.length} waiting for you</span></Link></li>
          <li><Link href={`${base}?tab=rules`} className="block rounded-xl border border-line p-4 hover:border-line-strong"><span className="font-medium">Edit leave rules</span><span className="block text-xs text-muted">{rules.filter((r) => r.is_active).length} rules · assign directly</span></Link></li>
          <li><Link href={`${base}?tab=accruals`} className="block rounded-xl border border-line p-4 hover:border-line-strong"><span className="font-medium">Close cycle</span><span className="block text-xs text-muted">{shortDate(cycle.start)} → {shortDate(cycle.end)}</span></Link></li>
        </ul>
      </Panel>
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Leave by department" meta="this quarter, days">
          {byDept.size === 0 ? <p className="text-sm text-muted">No approved leave this quarter.</p> : (
            <BarChart label="Approved leave days by department this quarter" data={[...byDept.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, value]) => ({ label, value }))} format={num} />
          )}
        </Panel>
        <Panel title="Leave type distribution" meta={`approved days, ${cycle.label}`}>
          {byType.length === 0 ? <p className="text-sm text-muted">No approved leave this cycle.</p> : (
            <SplitBar label="Approved leave days by type" parts={byType.map((p, i) => ({ ...p, tone: tones[i % tones.length]! }))} />
          )}
        </Panel>
      </div>
      <Panel title="Monthly org-wide volume" meta="approved leave days by start month">
        <BarChart label="Approved leave days per month" data={volume} format={num} empty="No approved leave this cycle." />
      </Panel>
    </div>
  );
}

// ─── Approvals ──────────────────────────────────────────────────────────────

export async function ApprovalsTab({ ctx, slug, base, today, sp }: Ctx & { sp: Record<string, string | undefined> }) {
  const settings = await getLeaveSettings(ctx.org.id);
  const cycle = leaveCycle(today, settings.year_start_month);
  const filter = { status: sp.status || undefined, typeId: sp.type || undefined, from: sp.from || undefined, to: sp.to || undefined };
  const [rows, { rules }, emps, inbox] = await Promise.all([
    getRequestsBoard(ctx.org.id, filter, 1000), getRules(ctx.org.id, today), leaveEmployees(ctx.org.id), getInbox(ctx.org.id, null),
  ]);
  const typeName = new Map(rules.map((r) => [r.id, r.name]));
  const mine = new Set(inbox.approvals.filter((a) => a.subject_type === 'leave_request').map((a) => a.id));
  const manage = ctx.can('leave.manage', 'org');
  const q = (sp.q ?? '').trim().toLowerCase();
  const filtered = rows.filter((r) => {
    const e = emps.byId.get(r.employee_id);
    return (!sp.dept || e?.departmentId === sp.dept) && (!q || `${e?.name ?? ''} ${e?.code ?? ''}`.toLowerCase().includes(q));
  });
  const page = Math.max(1, Number(sp.page) || 1);
  const size = [25, 50, 100].includes(Number(sp.size)) ? Number(sp.size) : 50;
  const shown = filtered.slice((page - 1) * size, page * size);
  const board: BoardRow[] = shown.map((r) => {
    const e = emps.byId.get(r.employee_id);
    const s = r.status as LeaveStatus;
    return {
      id: r.id, approvalId: r.approval_request_id, canDecide: s === 'pending' && !!r.approval_request_id && mine.has(r.approval_request_id),
      code: e?.code ?? '—', name: e?.name ?? '—', department: e?.department ?? '—', type: typeName.get(r.leave_type_id) ?? '—',
      from: shortDate(r.start_date), to: shortDate(r.end_date), days: r.days, reason: r.reason, status: statusLabel(s), statusTone: STATUS_TONE[s],
      actionedBy: r.actionedBy, comment: r.comment,
      canCancel: manage && (s === 'pending' || s === 'approved'), cancelLabel: s === 'approved' ? 'Revoke' : 'Cancel',
    };
  });
  const qs = (extra: Record<string, string>) => `${base}?${new URLSearchParams({ tab: 'approvals', ...Object.fromEntries(Object.entries(sp).filter(([k, v]) => v && k !== 'tab')) as Record<string, string>, ...extra })}`;
  const pages = Math.max(1, Math.ceil(filtered.length / size));
  return (
    <div className="space-y-5">
      <form method="get" action={base} aria-label="Filter leave requests" className="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-surface p-4">
        <input type="hidden" name="tab" value="approvals" />
        <label className="text-sm"><span className="mb-1 block text-xs text-muted">Search</span>
          <input name="q" defaultValue={sp.q ?? ''} placeholder="Name or ID" className="h-9 w-44 rounded-lg border border-line bg-surface px-2" /></label>
        <label className="text-sm"><span className="mb-1 block text-xs text-muted">Status</span>
          <select name="status" defaultValue={sp.status ?? ''} className="h-9 rounded-lg border border-line bg-surface px-2">
            <option value="">All</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="cancelled">Cancelled</option>
          </select></label>
        <label className="text-sm"><span className="mb-1 block text-xs text-muted">Leave type</span>
          <select name="type" defaultValue={sp.type ?? ''} className="h-9 rounded-lg border border-line bg-surface px-2">
            <option value="">All</option>{rules.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select></label>
        <label className="text-sm"><span className="mb-1 block text-xs text-muted">Department</span>
          <select name="dept" defaultValue={sp.dept ?? ''} className="h-9 rounded-lg border border-line bg-surface px-2">
            <option value="">All</option>{emps.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select></label>
        <label className="text-sm"><span className="mb-1 block text-xs text-muted">From</span><input type="date" name="from" defaultValue={sp.from ?? cycle.start} className="h-9 rounded-lg border border-line bg-surface px-2" /></label>
        <label className="text-sm"><span className="mb-1 block text-xs text-muted">To</span><input type="date" name="to" defaultValue={sp.to ?? ''} className="h-9 rounded-lg border border-line bg-surface px-2" /></label>
        <button className={buttonClass('secondary', 'sm', 'h-9')}>Filter</button>
        <a href={`${base}/export?${new URLSearchParams({ kind: 'requests', ...(sp.status ? { status: sp.status } : {}), ...(sp.type ? { type: sp.type } : {}), ...(sp.from ? { from: sp.from } : {}), ...(sp.to ? { to: sp.to } : {}) })}`}
          className={buttonClass('secondary', 'sm', 'ml-auto h-9')}>⬇ Export</a>
      </form>
      <Panel title="Leave requests" meta={`${filtered.length}`} flush>
        <ApprovalsBoard decideAction={decideLeaveAction.bind(null, slug)} cancelAction={cancelLeaveAction.bind(null, slug)} rows={board} />
        <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
          <span className="text-muted">{filtered.length ? `${(page - 1) * size + 1}–${Math.min(page * size, filtered.length)}` : '0–0'} of {filtered.length}</span>
          <span className="flex items-center gap-1">
            {page > 1 && <Link href={qs({ page: '1' })} className={buttonClass('ghost', 'sm')} aria-label="First page">«</Link>}
            {page > 1 && <Link href={qs({ page: String(page - 1) })} className={buttonClass('ghost', 'sm')} aria-label="Previous page">‹</Link>}
            <span className="px-2 tabular-nums">{page} / {pages}</span>
            {page < pages && <Link href={qs({ page: String(page + 1) })} className={buttonClass('ghost', 'sm')} aria-label="Next page">›</Link>}
            {page < pages && <Link href={qs({ page: String(pages) })} className={buttonClass('ghost', 'sm')} aria-label="Last page">»</Link>}
          </span>
          <span className="flex gap-1">{[25, 50, 100].map((n) => <Link key={n} href={qs({ size: String(n), page: '1' })} aria-current={n === size ? 'page' : undefined} className={cn('rounded-md px-2 py-1 text-xs', n === size ? 'bg-subtle font-semibold' : 'text-muted')}>{n} / page</Link>)}</span>
        </nav>
      </Panel>
      {manage && (
        <Panel title="Apply leave for an employee" meta="HR applying on someone’s behalf isn’t held to the rule’s timing limits">
          <ApplyLeaveForm action={applyLeaveAction.bind(null, slug)} today={today} title="Apply leave for an employee"
            employees={emps.list.map((e) => ({ value: e.id, label: `${e.name} (${e.code})` }))}
            types={rules.filter((r) => r.is_active).map((r) => ({ value: r.id, label: r.name }))} />
        </Panel>
      )}
    </div>
  );
}

// ─── Rules and assignments ──────────────────────────────────────────────────

export async function RulesTab({ ctx, slug, base, today, view, selected }: Ctx & { view: string; selected: string }) {
  const [{ rules, assignments }, emps] = await Promise.all([getRules(ctx.org.id, today), leaveEmployees(ctx.org.id)]);
  const current = ['rules', 'assignments', 'assign'].includes(view) ? view : 'rules';
  const active = rules.filter((r) => r.is_active);
  const everyone = active.filter((r) => r.applies_to === 'everyone');
  const byEmp = new Map<string, string[]>();
  for (const a of assignments) {
    const t = active.find((r) => r.id === a.leave_type_id && r.applies_to === 'assigned');
    if (t) byEmp.set(a.employee_id, [...(byEmp.get(a.employee_id) ?? []), t.name]);
  }
  const pick = emps.list.map((e) => {
    const ruleNames = [...everyone.map((r) => r.name), ...(byEmp.get(e.id) ?? [])];
    return { id: e.id, code: e.code, name: e.name, department: e.department, rules: ruleNames.length, ruleNames };
  });
  const editing = selected === 'new' ? null : rules.find((r) => r.id === selected);

  return (
    <>
      <SubTabs base={base} label="Leave rules" current={current === 'assign' ? 'assignments' : current} extra={{ tab: 'rules' }}
        tabs={[{ key: 'rules', label: 'Leave rules', count: active.length }, { key: 'assignments', label: 'Assignments' }]} />

      {current === 'rules' && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <p className="max-w-3xl text-sm text-muted">Each leave rule defines one leave type (accrual, carry-forward, encashment…). Edit a rule, then assign it from the <span className="font-medium text-fg">Assignments</span> tab — no policy bundle needed.</p>
            <Link href={`${base}?tab=rules&rule=new`} className={buttonClass('primary', 'sm')}>+ New leave rule</Link>
          </div>
          {(selected === 'new' || editing) && (
            <Panel title={editing ? `Edit rule · ${editing.name}` : 'New leave rule'} action={<Link href={`${base}?tab=rules`} className="text-sm text-muted hover:text-fg">Close</Link>}>
              <LeaveRuleEditor key={editing?.id ?? 'new'} action={saveLeaveRuleAction.bind(null, slug)} rule={editing ? ruleValues(editing) : NEW_RULE} />
            </Panel>
          )}
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Leave rules">
            {rules.map((r) => (
              <li key={r.id} className={cn('flex flex-col rounded-xl border bg-surface p-4', editing?.id === r.id ? 'border-primary/60' : 'border-line', !r.is_active && 'opacity-60')}>
                <div className="flex items-start justify-between gap-2">
                  <CategoryIcon category={r.category} />
                  <span className="flex gap-1">
                    <Link href={`${base}?tab=rules&rule=${r.id}`} className="rounded-full border border-line px-2.5 py-0.5 text-xs hover:border-line-strong" aria-label={`Edit ${r.name}`}>✎ Edit</Link>
                    <Link href={`${base}?tab=rules&view=assign&rule=${r.id}`} className="rounded-full border border-line px-2.5 py-0.5 text-xs hover:border-line-strong" aria-label={`Assign ${r.name}`}>Assign</Link>
                  </span>
                </div>
                <h3 className="mt-3 font-semibold">{r.name}{r.short_name && <span className="ml-2 rounded bg-subtle px-1.5 py-0.5 text-[10px] font-semibold text-muted">{r.short_name}</span>}</h3>
                <p className="mt-1 line-clamp-3 text-sm text-muted">{r.description ?? 'No description yet.'}</p>
                <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 border-t border-line pt-3 text-sm">
                  {ruleFacts(r).map(([k, v]) => <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd className="font-medium">{v}</dd></div>)}
                </dl>
                <p className="mt-auto pt-3 text-xs text-muted">{r.applies_to === 'everyone' ? `Applies to everyone (${r.assignedCount})` : `Assigned to ${r.assignedCount} employee${r.assignedCount === 1 ? '' : 's'}`}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {current === 'assign' && (() => {
        const r = rules.find((x) => x.id === selected);
        return (
          <Panel title="Assign leave rules" flush>
            {r?.applies_to === 'everyone' && (
              <p className="mx-5 mb-3 rounded-lg bg-info/10 px-3 py-2 text-sm text-info">{r.name} already applies to everyone. To choose people, edit it and set “Who gets it” to “Only employees it’s assigned to”.</p>
            )}
            <AssignRuleForm action={assignLeaveRuleAction.bind(null, slug)} rules={active.filter((x) => x.applies_to === 'assigned').map((x) => ({ value: x.id, label: x.name }))}
              employees={pick} today={today} ruleId={r?.applies_to === 'assigned' ? r.id : undefined} />
          </Panel>
        );
      })()}

      {current === 'assignments' && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <p className="max-w-3xl text-sm text-muted">Which leave rules each employee is on. Assign rules, bulk-delete, or import from a sheet — download the template.</p>
            <span className="flex gap-2">
              <Link href={`${base}?tab=rules&view=assign`} className={buttonClass('primary', 'sm')}>Assign rules</Link>
              <a href={`${base}/export?kind=assignments`} className={buttonClass('secondary', 'sm')}>⬇ Export</a>
            </span>
          </div>
          <Panel title="Assignments" meta={`${pick.length} employees`} flush>
            <AssignmentsBoard removeAction={removeAssignmentsAction.bind(null, slug)} rows={pick}
              rules={active.filter((x) => x.applies_to === 'assigned').map((x) => ({ value: x.id, label: x.name }))} />
          </Panel>
          <Panel title="Import assignments" meta="CSV: Employee code, Leave rule, Effective from">
            <ImportAssignmentsForm action={importAssignmentsAction.bind(null, slug)} templateHref={`${base}/export?kind=template`} />
          </Panel>
        </div>
      )}
    </>
  );
}

// ─── Balances ───────────────────────────────────────────────────────────────

export async function BalancesTab({ ctx, slug, base, today, q, employee }: Ctx & { q: string; employee: string }) {
  const settings = await getLeaveSettings(ctx.org.id);
  const cycle = leaveCycle(today, settings.year_start_month);
  const [sheet, { rules }, emps] = await Promise.all([getBalanceSheet(ctx.org.id, cycle.start), getRules(ctx.org.id, today), leaveEmployees(ctx.org.id)]);
  const manage = ctx.can('leave.manage', 'org');
  const types = rules.filter((r) => r.is_active);
  const cell = new Map(sheet.map((s) => [`${s.employee_id}:${s.leave_type_id}`, s]));
  const ids = [...new Set(sheet.map((s) => s.employee_id))];
  const yearShare = (Date.parse(today) - Date.parse(cycle.start)) / (Date.parse(cycle.end) - Date.parse(cycle.start) + 86_400_000);
  const needle = q.trim().toLowerCase();
  const rows = ids.map((id) => emps.byId.get(id)).filter((e): e is NonNullable<typeof e> => !!e)
    .filter((e) => !needle || `${e.name} ${e.code}`.toLowerCase().includes(needle))
    .sort((a, b) => a.code.localeCompare(b.code));
  const editing = employee ? emps.byId.get(employee) : undefined;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-3">
        <form method="get" action={base} className="flex flex-1 items-center gap-2" aria-label="Search balances">
          <input type="hidden" name="tab" value="balances" />
          <input type="search" name="q" defaultValue={q} placeholder="Search name or ID…" aria-label="Search name or ID" className="h-9 min-w-48 flex-1 rounded-lg border border-line bg-surface px-3 text-sm" />
        </form>
        {manage && <RunButton action={recalculateLeaveAction.bind(null, slug)} label="↻ Recalculate" pending="Recalculating org balances…" />}
        <a href={`${base}/export?kind=balances`} className={buttonClass('secondary', 'sm')}>⬇ Export</a>
      </div>
      {editing && manage && (
        <Panel title={`Edit leave balance · ${editing.name}`} meta={`${editing.code} · ${cycle.label}`} action={<Link href={`${base}?tab=balances`} className="text-sm text-muted hover:text-fg">Close</Link>}>
          <BalanceEditor action={setBalanceAction.bind(null, slug)} employeeId={editing.id} employeeName={editing.name}
            rows={types.filter((t) => cell.get(`${editing.id}:${t.id}`)?.applies || (cell.get(`${editing.id}:${t.id}`)?.balance ?? 0) !== 0).map((t) => {
              const c = cell.get(`${editing.id}:${t.id}`)!;
              return { typeId: t.id, name: t.name, carried: c.carried, credited: c.credited, applied: c.applied, penalty: c.penalty, other: c.other };
            })} />
        </Panel>
      )}
      <Panel title="Balances" meta={`available days · ${cycle.label}`} flush>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <caption className="sr-only">Leave balances</caption>
            <thead className="border-y border-line text-left text-[11px] uppercase tracking-wider text-muted">
              <tr><th className="px-5 py-2">ID</th><th className="py-2">Employee</th><th className="py-2">Dept</th>
                {types.map((t) => <th key={t.id} className="py-2 pr-3 text-right">{t.name}</th>)}
                <th className="py-2 pr-3 text-right">Used %</th><th className="py-2">Risk</th>{manage && <th className="py-2 pr-5 text-right">Action</th>}</tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((e) => {
                const cells = types.map((t) => cell.get(`${e.id}:${t.id}`));
                const paid = cells.filter((c, i) => c && !types[i]!.allow_negative && (c.applies || c.balance !== 0));
                const entitled = paid.reduce((s, c) => s + c!.carried + c!.credited, 0);
                const used = paid.reduce((s, c) => s + c!.applied, 0);
                const usedPct = entitled > 0 ? Math.round((used / entitled) * 100) : 0;
                const overCap = cells.some((c, i) => {
                  const cap = types[i]!.policy?.carry_forward_max;
                  return !!c && cap !== null && cap !== undefined && c.balance > cap && !types[i]!.allow_negative;
                });
                const risk = riskOf({ anyPolicy: cells.some((c) => c?.applies), entitled, usedPct, yearShare, overCap });
                return (
                  <tr key={e.id}>
                    <td className="px-5 py-2.5 font-mono text-xs text-muted">{e.code}</td>
                    <td className="py-2.5 font-medium">{e.name}</td>
                    <td className="py-2.5 text-muted">{e.department ?? '—'}</td>
                    {cells.map((c, i) => (
                      <td key={types[i]!.id} className={cn('py-2.5 pr-3 text-right tabular-nums', !c?.applies && 'text-muted')}>
                        {c && (c.applies || c.balance !== 0) ? (types[i]!.allow_negative ? `${num(c.applied)} used` : (c.balance - c.pending).toFixed(2)) : '0'}
                      </td>
                    ))}
                    <td className="py-2.5 pr-3 text-right tabular-nums">{usedPct}%</td>
                    <td className={cn('py-2.5 text-xs font-medium', risk.tone)}>{risk.label}</td>
                    {manage && <td className="py-2.5 pr-5 text-right"><Link href={`${base}?tab=balances&employee=${e.id}`} className="rounded-full border border-line px-2.5 py-0.5 text-xs hover:border-line-strong" aria-label={`Edit balance of ${e.name}`}>✎ Edit</Link></td>}
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={types.length + 6} className="py-8 text-center text-muted">No employees match.</td></tr>}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

// ─── Accruals ───────────────────────────────────────────────────────────────

export async function AccrualLedger({ orgId, employeeId, today, cycleStart, label }: { orgId: string; employeeId: string; today: string; cycleStart: string; label: string }) {
  const [ledger, { rules }, sheet] = await Promise.all([getLedger(employeeId), getRules(orgId, today), getBalanceSheet(orgId, cycleStart, employeeId)]);
  const applies = new Map(sheet.map((s) => [s.leave_type_id, s.applies || s.balance !== 0]));
  const types = rules.filter((r) => r.is_active && applies.get(r.id));
  const m0 = Number(cycleStart.slice(5, 7)) - 1;
  const heads = Array.from({ length: 12 }, (_, i) => MONTH_NAMES[(m0 + i) % 12]!.slice(0, 3));
  if (types.length === 0) return <p className="text-sm text-muted">No leave rules apply.</p>;
  return (
    <div className="space-y-4">
      {types.map((t) => {
        const months = ledgerMonths(ledger, t.id, cycleStart, today);
        const row = (name: string, pick: (m: NonNullable<(typeof months)[number]>) => number, dash = true) => (
          <tr><th scope="row" className="whitespace-nowrap py-2 pr-4 text-left font-normal text-muted">{name}</th>
            {months.map((m, i) => <td key={i} className="py-2 pr-3 text-right tabular-nums">{m === null ? '-' : dash && pick(m) === 0 ? '-' : pick(m).toFixed(2)}</td>)}</tr>
        );
        return (
          <section key={t.id} aria-label={`${t.name} ledger`} className="rounded-xl border border-line bg-surface p-4">
            <header className="mb-3 flex items-center gap-3"><CategoryIcon category={t.category} size="sm" />
              <div><h3 className="font-semibold">{t.name}</h3><p className="text-xs text-muted">Accrual · {ruleFacts(t)[1][1]} · {label}</p></div></header>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <caption className="sr-only">{t.name}: month-by-month ledger</caption>
                <thead className="text-[11px] uppercase tracking-wider text-muted"><tr><th className="py-1 text-left">Details</th>{heads.map((h) => <th key={h} className="py-1 pr-3 text-right">{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-line">
                  {row('Credited leaves', (m) => m.credited)}
                  {row('Applied leaves', (m) => m.applied, false)}
                  {row('Penalty deduction', (m) => m.penalty)}
                  {row('Closing balance', (m) => m.closing, false)}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}

export async function AccrualsTab({ ctx, slug, base, today, employee }: Ctx & { employee: string }) {
  const settings = await getLeaveSettings(ctx.org.id);
  const cycle = leaveCycle(today, settings.year_start_month);
  const emps = await leaveEmployees(ctx.org.id);
  const chosen = emps.byId.get(employee) ?? emps.list[0];
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-semibold">Accrual ledger</h2>
          <p className="text-sm text-muted">Month-by-month accrual for the selected employee — credited, applied, penalty and closing balance.</p>
        </div>
        {ctx.can('leave.manage', 'org') && <RunButton action={recalculateLeaveAction.bind(null, slug)} label="↻ Run carry-forward" pending="Running…" />}
      </div>
      <form method="get" action={base} className="flex flex-wrap items-end gap-2" aria-label="Choose an employee">
        <input type="hidden" name="tab" value="accruals" />
        <label className="text-sm"><span className="mb-1 block text-xs text-muted">Employee</span>
          <select name="employee" defaultValue={chosen?.id ?? ''} className="h-9 min-w-64 rounded-lg border border-line bg-surface px-2">
            {emps.list.map((e) => <option key={e.id} value={e.id}>{e.name} ({e.code})</option>)}
          </select></label>
        <button className={buttonClass('secondary', 'sm', 'h-9')}>Show</button>
        <span className="ml-auto text-xs text-muted">Leave year {formatDate(cycle.start)} – {formatDate(cycle.end)}{settings.carry_forward_expiry !== 'never' ? ' · carried leave expires at year end' : ''}</span>
      </form>
      {chosen ? <AccrualLedger orgId={ctx.org.id} employeeId={chosen.id} today={today} cycleStart={cycle.start} label={cycle.label} /> : <p className="text-sm text-muted">No employees yet.</p>}
    </div>
  );
}

// ─── Settings ───────────────────────────────────────────────────────────────

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export async function SettingsTab({ ctx, slug }: Ctx) {
  const [settings, setup] = await Promise.all([getLeaveSettings(ctx.org.id), getLeaveSetup(ctx.org.id)]);
  const calendar = setup.calendars.find((c) => !c.location_id);
  const holidays = setup.holidays.filter((h) => h.calendar_id === calendar?.id);
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Panel title="Leave settings">
        <LeaveSettingsForm action={saveLeaveSettingsAction.bind(null, slug)} settings={settings} />
      </Panel>
      {calendar && (
        <Panel title="Holidays" meta={`${calendar.name} · weekly offs: ${calendar.weekly_offs.map((d) => WEEKDAYS[d]).join(', ') || 'none'}`} flush>
          {holidays.length === 0 ? <p className="px-5 py-4 text-sm text-muted">No holidays yet.</p> : (
            <ul className="divide-y divide-line" aria-label="Holidays">
              {holidays.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                  <span><span className="font-medium">{h.name}</span>{h.is_optional && <span className="text-muted"> (optional)</span>}</span>
                  <span className="flex items-center gap-3 text-muted">{formatDate(h.holiday_date)}
                    <RemoveHoliday action={removeHolidayAction.bind(null, slug)} holidayId={h.id} name={h.name} />
                  </span>
                </li>
              ))}
            </ul>
          )}
          <HolidayForm action={addHolidayAction.bind(null, slug, calendar.id)} />
        </Panel>
      )}
    </div>
  );
}
