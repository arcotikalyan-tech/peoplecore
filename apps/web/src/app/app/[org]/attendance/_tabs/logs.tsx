import Link from 'next/link';
import { addDays } from '@peoplecore/shared';
import { ActionForm } from '@/components/action-form';
import { Avatar } from '@/components/ui/avatar';
import { buttonClass } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { Panel, SubTabs } from '@/components/ui/hub';
import { Badge } from '@/components/ui/surface';
import { Pagination, Table, Td, Th } from '@/components/ui/table';
import { formatDate } from '@/lib/format';
import type { OrgContext } from '@/server/context';
import { compOffLog, monthGrid, overtimeLog, peopleDay, penaltyLog, structureNames } from '@/server/attendance-ops';
import { namesFor } from '@/server/leave';
import { decideOvertimeAction, revertCompOffAction, revertPenaltyAction, runPenaltiesAction } from '../actions';
import { clock, hours, LEGEND, StatusChip } from './status';

export interface LogParams {
  view: string;
  date: string;
  month: string;
  q: string;
  dept: string;
  page: number;
}

export async function LogsTab({ ctx, slug, orgBase, base, today, p }: { ctx: OrgContext; slug: string; orgBase: string; base: string; today: string; p: LogParams }) {
  const view = ['daily', 'calendar', 'penalty', 'compoff', 'overtime'].includes(p.view) ? p.view : 'daily';
  const manage = ctx.can('attendance.manage', 'org');
  return (
    <>
      <SubTabs base={base} label="Logs" current={view} extra={{ tab: 'logs' }} tabs={[
        { key: 'daily', label: 'Daily log' }, { key: 'calendar', label: 'Month calendar' }, { key: 'penalty', label: 'Penalties' },
        { key: 'compoff', label: 'Comp-off' }, { key: 'overtime', label: 'Overtime' },
      ]} />
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
              <Td className="tabular-nums">{time(r.firstIn)}</Td>
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
  const rows = await penaltyLog(ctx.org.id, p.month);
  const names = await namesFor(ctx.org.id, rows.map((r) => r.employee_id));
  const month = p.month.slice(0, 7);
  return (
    <Panel title="Penalties" meta={new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })} flush
      action={manage ? (
        <ActionForm action={runPenaltiesAction.bind(null, slug)} label="Apply penalties for the month" submit="Apply for this month" size="sm" variant="secondary"
          hidden={{ month }} className="flex items-center gap-2" />
      ) : undefined}>
      <form method="get" action={base} className="mb-3 flex items-end gap-2 px-5" aria-label="Choose the month">
        <input type="hidden" name="tab" value="logs" /><input type="hidden" name="view" value="penalty" />
        <label className="text-sm"><span className="mb-1 block font-medium">Month</span>
          <input type="month" name="month" defaultValue={month} max={today.slice(0, 7)} className="h-9 rounded-md border border-line-strong bg-surface px-2.5" /></label>
        <button className={buttonClass('secondary')}>Show</button>
      </form>
      <p className="px-5 pb-3 text-sm text-muted">Late marks beyond each rule’s monthly allowance become loss-of-pay days in that month’s payroll. A reverted penalty stays reverted when the month is applied again.</p>
      <Table caption="Penalties">
        <thead><tr><Th>Employee</Th><Th>Penalty</Th><Th>Occurrences</Th><Th>Loss of pay</Th><Th>Applied</Th><Th>Status</Th>{manage && <Th />}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <Td className="font-medium">{names.get(r.employee_id) ?? '—'}</Td>
              <Td>Late marks<span className="block text-xs text-muted">{r.detail}</span></Td>
              <Td className="tabular-nums">{r.occurrences}</Td>
              <Td className="tabular-nums">{r.days} day{r.days === 1 ? '' : 's'}</Td>
              <Td className="text-muted">{formatDate(r.applied_at.slice(0, 10))}</Td>
              <Td>{r.reverted_at ? <Badge>Reverted</Badge> : <Badge tone="danger">Applied</Badge>}</Td>
              {manage && <Td>{!r.reverted_at && <ActionForm action={revertPenaltyAction.bind(null, slug)} label={`Revert penalty for ${names.get(r.employee_id) ?? 'employee'}`} submit="Revert" size="sm" variant="ghost" hidden={{ penaltyId: r.id }} className="flex" />}</Td>}
            </tr>
          ))}
          {rows.length === 0 && <tr><Td className="py-8 text-center text-muted">No penalties this month.</Td></tr>}
        </tbody>
      </Table>
    </Panel>
  );
}

async function CompOff({ ctx, slug, today, manage }: { ctx: OrgContext; slug: string; today: string; manage: boolean }) {
  const rows = await compOffLog(ctx.org.id, addDays(today, -90), today);
  const names = await namesFor(ctx.org.id, rows.map((r) => r.employee_id));
  return (
    <Panel title="Comp-off" meta="last 90 days" flush>
      <p className="px-5 pb-3 text-sm text-muted">Credited automatically for work on a weekly off or holiday, under rules that allow comp-off. The days go straight to the person’s comp-off leave balance.</p>
      <Table caption="Comp-off credits">
        <thead><tr><Th>Employee</Th><Th>Worked on</Th><Th>Credited</Th><Th>Status</Th>{manage && <Th />}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.employee_id}-${r.work_date}`}>
              <Td className="font-medium">{names.get(r.employee_id) ?? '—'}</Td>
              <Td>{formatDate(r.work_date)}</Td>
              <Td className="tabular-nums">{r.days} day{r.days === 1 ? '' : 's'}</Td>
              <Td>{r.status === 'reverted' ? <Badge>Reverted</Badge> : <Badge tone="success">Credited</Badge>}</Td>
              {manage && <Td>{r.status === 'credited' && <ActionForm action={revertCompOffAction.bind(null, slug)} label={`Revert comp-off for ${names.get(r.employee_id) ?? 'employee'} on ${r.work_date}`} submit="Revert" size="sm" variant="ghost" hidden={{ employeeId: r.employee_id, workDate: r.work_date }} className="flex" />}</Td>}
            </tr>
          ))}
          {rows.length === 0 && <tr><Td className="py-8 text-center text-muted">No comp-off credited in the last 90 days.</Td></tr>}
        </tbody>
      </Table>
    </Panel>
  );
}

async function Overtime({ ctx, slug, today }: { ctx: OrgContext; slug: string; today: string }) {
  const rows = await overtimeLog(ctx.org.id, addDays(today, -90), today);
  const names = await namesFor(ctx.org.id, rows.map((r) => r.employee_id));
  const pending = rows.filter((r) => r.status === 'pending');
  return (
    <Panel title="Overtime" meta={`${pending.length} waiting · last 90 days`} flush>
      <p className="px-5 pb-3 text-sm text-muted">Time worked beyond a full day plus the rule’s overtime threshold. Managers approve or reject it; people can’t decide their own.</p>
      <Table caption="Overtime">
        <thead><tr><Th>Employee</Th><Th>Day</Th><Th>Overtime</Th><Th>Status</Th><Th /></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.employee_id}-${r.work_date}`}>
              <Td className="font-medium">{names.get(r.employee_id) ?? '—'}</Td>
              <Td>{formatDate(r.work_date)}</Td>
              <Td className="tabular-nums">{hours(r.minutes)}</Td>
              <Td>{r.status === 'pending' ? <Badge tone="warning">Waiting</Badge> : r.status === 'approved' ? <Badge tone="success">Approved</Badge> : <Badge tone="danger">Rejected</Badge>}</Td>
              <Td>{r.status === 'pending' && (
                <div className="flex gap-1.5">
                  <ActionForm action={decideOvertimeAction.bind(null, slug)} label={`Approve overtime for ${names.get(r.employee_id) ?? 'employee'} on ${r.work_date}`} submit="Approve" size="sm" hidden={{ employeeId: r.employee_id, workDate: r.work_date, decision: 'approve' }} className="flex" />
                  <ActionForm action={decideOvertimeAction.bind(null, slug)} label={`Reject overtime for ${names.get(r.employee_id) ?? 'employee'} on ${r.work_date}`} submit="Reject" size="sm" variant="ghost" hidden={{ employeeId: r.employee_id, workDate: r.work_date, decision: 'reject' }} className="flex" />
                </div>
              )}</Td>
            </tr>
          ))}
          {rows.length === 0 && <tr><Td className="py-8 text-center text-muted">No overtime in the last 90 days.</Td></tr>}
        </tbody>
      </Table>
    </Panel>
  );
}
