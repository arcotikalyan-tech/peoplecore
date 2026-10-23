import Link from 'next/link';
import { addDays, attendanceCycle, attendanceCycleMonth, PENALTY_KIND_LABELS, PENALTY_METHOD_LABELS, type PenaltyKind, type PenaltyMethod } from '@peoplecore/shared';
import { ActionForm } from '@/components/action-form';
import { Avatar } from '@/components/ui/avatar';
import { buttonClass } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { Panel, SubTabs } from '@/components/ui/hub';
import { Badge } from '@/components/ui/surface';
import { Pagination, Table, Td, Th } from '@/components/ui/table';
import { formatDate } from '@/lib/format';
import type { OrgContext } from '@/server/context';
import { compOffLog, monthGrid, overtimeLog, peopleDay, penaltyLeaveTypes, penaltyLog, rulesSetup, savedViews, structureNames } from '@/server/attendance-ops';
import { namesFor } from '@/server/leave';
import { ButtonAction } from '../../settings/settings-client';
import { compOffBoardAction, deleteViewAction, overtimeBoardAction, penaltyBoardAction, runPenaltiesAction, saveViewAction } from '../actions';
import { SaveViewForm, SelectBoard } from '../automation-client';
import { clock, hours, LEGEND, StatusChip } from './status';

export interface LogParams {
  view: string;
  date: string;
  month: string;
  /** Whether the month came from the address (otherwise the penalty log opens on the current cycle). */
  monthSet?: boolean;
  q: string;
  dept: string;
  page: number;
}

export async function LogsTab({ ctx, slug, orgBase, base, today, p }: { ctx: OrgContext; slug: string; orgBase: string; base: string; today: string; p: LogParams }) {
  const view = ['daily', 'calendar', 'penalty', 'compoff', 'overtime'].includes(p.view) ? p.view : 'daily';
  const manage = ctx.can('attendance.manage', 'org');
  const views = await savedViews(ctx.org.id, 'attendance.logs');
  const current: Record<string, string> = {
    tab: 'logs', view, ...(view === 'daily' ? { date: p.date } : p.monthSet ? { month: p.month.slice(0, 7) } : {}),
    ...(p.q ? { q: p.q } : {}), ...(p.dept ? { dept: p.dept } : {}),
  };
  return (
    <>
      <SubTabs base={base} label="Logs" current={view} extra={{ tab: 'logs' }} tabs={[
        { key: 'daily', label: 'Daily log' }, { key: 'calendar', label: 'Month calendar' }, { key: 'penalty', label: 'Penalties' },
        { key: 'compoff', label: 'Comp-off' }, { key: 'overtime', label: 'Overtime' },
      ]} />
      <details className="mb-4 rounded-xl border border-line bg-surface px-4 py-2 text-sm">
        <summary className="cursor-pointer font-medium">★ Saved views{views.length ? ` (${views.length})` : ''}</summary>
        <div className="space-y-3 py-3">
          {views.length > 0 && (
            <ul className="flex flex-wrap gap-2" aria-label="Saved views">
              {views.map((v) => (
                <li key={v.id} className="flex items-center gap-1 rounded-full border border-line pl-3">
                  <Link href={`${base}?${new URLSearchParams(v.params)}`} className="py-1 font-medium hover:underline">{v.name}</Link>
                  <ButtonAction action={deleteViewAction.bind(null, slug, v.id)} aria={`Remove view ${v.name}`} label="✕" variant="ghost" />
                </li>
              ))}
            </ul>
          )}
          <SaveViewForm action={saveViewAction.bind(null, slug, 'attendance.logs')} params={current} />
        </div>
      </details>
      {view === 'daily' && <Daily ctx={ctx} orgBase={orgBase} base={base} today={today} p={p} />}
      {view === 'calendar' && <Calendar ctx={ctx} orgBase={orgBase} base={base} p={p} />}
      {view === 'penalty' && <Penalties ctx={ctx} slug={slug} base={base} today={today} p={p} manage={manage} />}
      {view === 'compoff' && <CompOff ctx={ctx} slug={slug} today={today} manage={manage} />}
      {view === 'overtime' && <Overtime ctx={ctx} slug={slug} today={today} />}
    </>
  );
}

function Filters({ base, view, p, dateField, depts }: { base: string; view: string; p: LogParams; dateField: 'date' | 'month'; depts: Array<{ id: string; name: string }> }) {
  return (
    <form method="get" action={base} className="mb-4 flex flex-wrap items-end gap-3" aria-label="Filter the log">
      <input type="hidden" name="tab" value="logs" />
      <input type="hidden" name="view" value={view} />
      <label className="text-sm">
        <span className="mb-1 block font-medium">{dateField === 'date' ? 'Day' : 'Month'}</span>
        <input type={dateField} name={dateField} defaultValue={dateField === 'date' ? p.date : p.month.slice(0, 7)} className="h-9 rounded-md border border-line-strong bg-surface px-2.5" />
      </label>
      <label className="min-w-48 flex-1 text-sm">
        <span className="mb-1 block font-medium">Search</span>
        <input name="q" defaultValue={p.q} placeholder="Name, code or email" className="h-9 w-full rounded-md border border-line-strong bg-surface px-2.5" />
      </label>
      <label className="text-sm">
        <span className="mb-1 block font-medium">Department</span>
        <select name="dept" defaultValue={p.dept} className="h-9 rounded-md border border-line-strong bg-surface px-2.5">
          <option value="">All departments</option>
          {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </label>
      <button className={buttonClass('secondary')}>Show</button>
    </form>
  );
}

async function Daily({ ctx, orgBase, base, today, p }: { ctx: OrgContext; orgBase: string; base: string; today: string; p: LogParams }) {
  const date = p.date <= today ? p.date : today;
  const [log, names] = await Promise.all([
    peopleDay(ctx.org.id, date, { q: p.q || undefined, departmentId: p.dept || undefined, page: p.page }),
    structureNames(ctx.org.id),
  ]);
  const dept = new Map(names.departments.map((d) => [d.id, d.name]));
  const time = clock(ctx.org.timezone);
  const qs = (page: number) => `${base}?${new URLSearchParams({ tab: 'logs', view: 'daily', date, q: p.q, dept: p.dept, page: String(page) })}`;
  return (
    <Panel title="Daily log" meta={formatDate(date)} flush
      action={<div className="flex gap-2">
        <Link className={buttonClass('ghost', 'sm')} href={`${base}?tab=logs&view=daily&date=${addDays(date, -1)}`}>‹ Previous</Link>
        {date < today && <Link className={buttonClass('ghost', 'sm')} href={`${base}?tab=logs&view=daily&date=${addDays(date, 1)}`}>Next ›</Link>}
      </div>}>
      <div className="px-5"><Filters base={base} view="daily" p={{ ...p, date }} dateField="date" depts={names.departments} /></div>
      <Table caption={`Attendance on ${formatDate(date)}`}>
        <thead><tr><Th>Employee</Th><Th>Department</Th><Th>In</Th><Th>Out</Th><Th>Worked</Th><Th>Late</Th><Th>Early out</Th><Th>Overtime</Th><Th>Status</Th></tr></thead>
        <tbody>
          {log.rows.map((r) => (
            <tr key={r.id}>
              <Td><Link href={`${orgBase}/employees/${r.id}`} className="flex items-center gap-2.5 font-medium hover:underline"><Avatar name={r.name} size="sm" /><span>{r.name}<span className="block text-xs font-normal text-muted">{r.code}</span></span></Link></Td>
              <Td className="text-muted">{r.departmentId ? dept.get(r.departmentId) ?? '—' : '—'}</Td>
              {/* In and out open the day's punches (with their check-in photos) on the person's profile. */}
              <Td className="tabular-nums">{r.firstIn
                ? <Link href={`${orgBase}/employees/${r.id}?tab=attendance&view=logs&date=${date}`} className="hover:underline" aria-label={`Punches of ${r.name} on ${formatDate(date)}`}>{time(r.firstIn)}</Link>
                : time(r.firstIn)}</Td>
              <Td className="tabular-nums">{time(r.lastOut)}</Td>
              <Td className="tabular-nums">{hours(r.worked)}</Td>
              <Td className={cn('tabular-nums', r.late ? 'text-warning' : 'text-muted')}>{r.late ? `${r.late} min` : '—'}</Td>
              <Td className={cn('tabular-nums', r.earlyOut ? 'text-warning' : 'text-muted')}>{r.earlyOut ? `${r.earlyOut} min` : '—'}</Td>
              <Td className="tabular-nums text-muted">{r.overtime ? hours(r.overtime) : '—'}</Td>
              <Td><StatusChip status={r.status} />{r.regularized && <span className="ml-1.5 text-xs text-muted">regularized</span>}</Td>
            </tr>
          ))}
          {log.rows.length === 0 && <tr><Td className="py-8 text-center text-muted">No one matches.</Td></tr>}
        </tbody>
      </Table>
      <div className="px-5 pt-3"><Pagination page={log.page} pageCount={log.pages} total={log.total} hrefFor={qs} /></div>
      <p className="px-5 pb-3 text-xs text-muted">{LEGEND}</p>
    </Panel>
  );
}

async function Calendar({ ctx, orgBase, base, p }: { ctx: OrgContext; orgBase: string; base: string; p: LogParams }) {
  const [grid, names] = await Promise.all([
    monthGrid(ctx.org.id, p.month, { q: p.q || undefined, departmentId: p.dept || undefined, page: p.page }),
    structureNames(ctx.org.id),
  ]);
  const days: string[] = [];
  for (let d = grid.first; d <= grid.last; d = addDays(d, 1)) days.push(d);
  const qs = (page: number) => `${base}?${new URLSearchParams({ tab: 'logs', view: 'calendar', month: p.month.slice(0, 7), q: p.q, dept: p.dept, page: String(page) })}`;
  const monthLabel = new Date(`${grid.first}T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return (
    <Panel title="Month calendar" meta={monthLabel} flush>
      <div className="px-5"><Filters base={base} view="calendar" p={p} dateField="month" depts={names.departments} /></div>
      <div className="scroll-thin overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <caption className="sr-only">Attendance in {monthLabel}</caption>
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 z-10 border-b border-line bg-surface px-4 py-2 text-left font-medium text-muted">Employee</th>
              {days.map((d) => {
                const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
                return <th key={d} scope="col" className={cn('border-b border-line px-0.5 py-2 text-center font-medium', dow === 0 || dow === 6 ? 'text-muted/60' : 'text-muted')}>{Number(d.slice(8))}</th>;
              })}
            </tr>
          </thead>
          <tbody>
            {grid.rows.map((r) => (
              <tr key={r.id}>
                <th scope="row" className="sticky left-0 z-10 whitespace-nowrap border-b border-line bg-surface px-4 py-1.5 text-left font-medium">
                  <Link href={`${orgBase}/employees/${r.id}`} className="hover:underline">{r.name}</Link>
                </th>
                {days.map((d) => <td key={d} className="border-b border-line px-0.5 py-1 text-center">{r.days.has(d) ? <StatusChip status={r.days.get(d)!} code className="min-w-7 px-0.5 text-[10px]" /> : <span className="text-muted/40">·</span>}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-5 pt-3"><Pagination page={grid.page} pageCount={grid.pages} total={grid.total} hrefFor={qs} /></div>
      <p className="px-5 pb-3 text-xs text-muted">{LEGEND}</p>
    </Panel>
  );
}

async function Penalties({ ctx, slug, base, today, p, manage }: { ctx: OrgContext; slug: string; base: string; today: string; p: LogParams; manage: boolean }) {
  const setup = await rulesSetup(ctx.org.id);
  const startDay = setup.settings?.cycle_start_day ?? 1;
  const month = p.monthSet ? `${p.month.slice(0, 7)}-01` : attendanceCycleMonth(today, startDay);
  const [rows, leaveTypes] = await Promise.all([penaltyLog(ctx.org.id, month), penaltyLeaveTypes(ctx.org.id)]);
  const names = await namesFor(ctx.org.id, rows.map((r) => r.employee_id));
  const leaveName = new Map(leaveTypes.map((t) => [t.value, t.label]));
  const cycle = attendanceCycle(month, startDay);
  const label = new Date(`${month}T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const fmt = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  return (
    <Panel title="Penalties" meta={`${label} cycle · ${formatDate(cycle.from)} – ${formatDate(cycle.to)}`} flush
      action={<div className="flex flex-wrap items-center gap-2">
        <a href={`${base}/penalties/export?month=${month.slice(0, 7)}`} className={buttonClass('ghost', 'sm')} download>⬇ Export</a>
        {manage && <ActionForm action={runPenaltiesAction.bind(null, slug)} label="Apply penalties for the cycle" submit="Apply for this cycle" size="sm" variant="secondary"
          hidden={{ month: month.slice(0, 7) }} className="flex items-center gap-2" />}
      </div>}>
      <form method="get" action={base} className="mb-3 flex items-end gap-2 px-5" aria-label="Choose the cycle">
        <input type="hidden" name="tab" value="logs" /><input type="hidden" name="view" value="penalty" />
        <label className="text-sm"><span className="mb-1 block font-medium">Cycle (the month it ends in)</span>
          <input type="month" name="month" defaultValue={month.slice(0, 7)} className="h-9 rounded-md border border-line-strong bg-surface px-2.5" /></label>
        <button className={buttonClass('secondary')}>Show</button>
      </form>
      <p className="px-5 pb-3 text-sm text-muted">Late coming, early leaving and short hours beyond each rule’s allowance, and absent days under automatic deduction. Deductions come out of the rule’s leave types first, then loss of pay in the cycle’s payroll. A reverted penalty gives its leave back and stays reverted when the cycle is applied again.</p>
      <SelectBoard action={penaltyBoardAction.bind(null, slug)} label="Penalties" empty="No penalties in this cycle."
        columns={['Employee', 'Anomaly', 'Penalty', 'Deducted from', 'Deduction', 'Applied', 'Status']}
        buttons={[{ op: 'revert', label: '↺ Revert selected' }]}
        rows={rows.map((r) => ({
          value: r.id, selectable: manage && !r.reverted_at, label: `${names.get(r.employee_id) ?? 'employee'} ${PENALTY_KIND_LABELS[r.kind as PenaltyKind] ?? r.kind}`,
          cells: [
            <span key="n" className="font-medium">{names.get(r.employee_id) ?? '—'}</span>,
            <span key="a">{PENALTY_KIND_LABELS[r.kind as PenaltyKind] ?? r.kind}<span className="block text-xs text-muted">{r.detail}</span></span>,
            <span key="m" className="text-muted">{r.method ? PENALTY_METHOD_LABELS[r.method as PenaltyMethod] : '—'}</span>,
            <span key="f" className="text-xs">{[...r.leave_split.map((x) => `${leaveName.get(x.leaveTypeId) ?? 'Leave'} ${fmt(Number(x.days))}`), r.days > 0 ? `Loss of pay ${fmt(r.days)}` : null].filter(Boolean).join(' · ') || '—'}</span>,
            <span key="d" className="tabular-nums">{fmt(r.total_days)} day{r.total_days === 1 ? '' : 's'}</span>,
            <span key="t" className="text-muted">{formatDate(r.applied_at.slice(0, 10))}</span>,
            r.reverted_at ? <Badge key="s">Reverted</Badge> : <Badge key="s" tone="danger">Applied</Badge>,
          ],
        }))} />
    </Panel>
  );
}

async function CompOff({ ctx, slug, today, manage }: { ctx: OrgContext; slug: string; today: string; manage: boolean }) {
  const rows = await compOffLog(ctx.org.id, addDays(today, -90), today);
  const names = await namesFor(ctx.org.id, rows.map((r) => r.employee_id));
  const time = clock(ctx.org.timezone);
  const decides = manage || ctx.can('attendance.approve');
  const pending = rows.filter((r) => r.status === 'pending').length;
  const STATUS: Record<string, React.ReactNode> = {
    pending: <Badge tone="warning">Waiting</Badge>, credited: <Badge tone="success">Credited</Badge>, rejected: <Badge tone="danger">Rejected</Badge>, reverted: <Badge>Reverted</Badge>,
  };
  return (
    <Panel title="Comp-off" meta={`${pending} waiting · last 90 days`} flush>
      <p className="px-5 pb-3 text-sm text-muted">Earned for work on a weekly off or holiday under rules that allow comp-off. Rules that approve it automatically credit the leave balance straight away; the rest wait here for HR or the manager.</p>
      <SelectBoard action={compOffBoardAction.bind(null, slug)} label="Comp-off" empty="No comp-off in the last 90 days."
        columns={['Employee', 'Worked on', 'In', 'Out', 'Worked', 'Comp-off', 'Status']}
        buttons={[{ op: 'approve', label: '✓ Approve', variant: 'primary' }, { op: 'reject', label: '✗ Reject' }, ...(manage ? [{ op: 'revert', label: '↺ Revert', variant: 'ghost' as const }] : [])]}
        rows={rows.map((r) => ({
          value: `${r.employee_id}:${r.work_date}`, label: `${names.get(r.employee_id) ?? 'employee'} ${r.work_date}`,
          selectable: (r.status === 'pending' && decides) || (r.status === 'credited' && manage),
          cells: [
            <span key="n" className="font-medium">{names.get(r.employee_id) ?? '—'}</span>, formatDate(r.work_date), time(r.first_in), time(r.last_out),
            <span key="w" className="tabular-nums">{hours(r.worked)}</span>, `${r.days} day${r.days === 1 ? '' : 's'}`, STATUS[r.status] ?? r.status,
          ],
        }))} />
    </Panel>
  );
}

async function Overtime({ ctx, slug, today }: { ctx: OrgContext; slug: string; today: string }) {
  const rows = await overtimeLog(ctx.org.id, addDays(today, -90), today);
  const names = await namesFor(ctx.org.id, rows.map((r) => r.employee_id));
  const pending = rows.filter((r) => r.status === 'pending');
  return (
    <Panel title="Overtime" meta={`${pending.length} waiting · last 90 days`} flush>
      <p className="px-5 pb-3 text-sm text-muted">Time worked beyond a full day plus the rule’s overtime threshold. Managers approve or reject it, one at a time or together; people can’t decide their own.</p>
      <SelectBoard action={overtimeBoardAction.bind(null, slug)} label="Overtime" empty="No overtime in the last 90 days."
        columns={['Employee', 'Day', 'Overtime', 'Status']}
        buttons={[{ op: 'approve', label: '✓ Approve', variant: 'primary' }, { op: 'reject', label: '✗ Reject' }]}
        rows={rows.map((r) => ({
          value: `${r.employee_id}:${r.work_date}`, label: `${names.get(r.employee_id) ?? 'employee'} ${r.work_date}`, selectable: r.status === 'pending',
          cells: [
            <span key="n" className="font-medium">{names.get(r.employee_id) ?? '—'}</span>, formatDate(r.work_date), <span key="h" className="tabular-nums">{hours(r.minutes)}</span>,
            r.status === 'pending' ? <Badge key="s" tone="warning">Waiting</Badge> : r.status === 'approved' ? <Badge key="s" tone="success">Approved</Badge> : <Badge key="s" tone="danger">Rejected</Badge>,
          ],
        }))} />
    </Panel>
  );
}
