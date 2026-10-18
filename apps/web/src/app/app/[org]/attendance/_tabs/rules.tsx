import Link from 'next/link';
import { todayIn } from '@peoplecore/shared';
import { ActionForm } from '@/components/action-form';
import { buttonClass } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { Panel, SubTabs } from '@/components/ui/hub';
import { Badge } from '@/components/ui/surface';
import { Table, Td, Th } from '@/components/ui/table';
import { formatDate } from '@/lib/format';
import type { OrgContext } from '@/server/context';
import { rulesSetup } from '@/server/attendance-ops';
import { managerOptions } from '@/server/employees';
import { namesFor } from '@/server/leave';
import {
  assignRosterAction, assignWorkWeekAction, saveRuleAction, saveWorkWeekAction, setDefaultRuleAction, setDefaultWorkWeekAction,
} from '../actions';
import { AssignWorkWeekForm, RosterForm, RuleEditor, WorkWeekGrid, type RuleValues } from '../attendance-forms';
import { hours } from './status';

const NEW_RULE: RuleValues = {
  name: '', description: null, start_time: '09:30', end_time: '18:30', break_minutes: 60, grace_minutes: 15, early_grace_minutes: 0,
  full_day_minutes: 480, half_day_minutes: 240, verify_selfie: false, verify_geofence: false, verify_ip: false,
  overtime_after_minutes: null, comp_off_min_minutes: null, late_marks_allowed: null, late_penalty_days: 0.5,
};

export async function RulesTab({ ctx, slug, base, view, selected }: { ctx: OrgContext; slug: string; base: string; view: string; selected: string }) {
  const [setup, employees] = await Promise.all([rulesSetup(ctx.org.id), managerOptions(ctx.org.id)]);
  const today = todayIn(ctx.org.timezone);
  const current = ['rules', 'workweek', 'assigned'].includes(view) ? view : 'rules';
  const rosterCount = new Map<string, number>();
  for (const r of setup.rosters) if (!r.effective_to || r.effective_to >= today) rosterCount.set(r.shift_id, (rosterCount.get(r.shift_id) ?? 0) + 1);
  const weekCount = new Map<string, number>();
  for (const a of setup.weekAssignments) weekCount.set(a.rule_id, (weekCount.get(a.rule_id) ?? 0) + 1);

  return (
    <>
      <SubTabs base={base} label="Rules" current={current} extra={{ tab: 'rules' }} tabs={[
        { key: 'rules', label: 'Attendance rules', count: setup.shifts.length }, { key: 'workweek', label: 'Work week', count: setup.weeks.length },
        { key: 'assigned', label: 'Assignments' },
      ]} />

      {current === 'rules' && (() => {
        const rule = selected === 'new' ? null : setup.shifts.find((s) => s.id === selected) ?? setup.shifts[0] ?? null;
        return (
          <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
            <Panel title="Rules" flush>
              <ul className="space-y-1 px-2" aria-label="Attendance rules">
                {setup.shifts.map((s) => (
                  <li key={s.id}>
                    <Link href={`${base}?tab=rules&view=rules&rule=${s.id}`} aria-current={rule?.id === s.id ? 'page' : undefined}
                      className={cn('block rounded-lg border px-3 py-2.5 text-sm', rule?.id === s.id ? 'border-primary/50 bg-primary-soft' : 'border-transparent hover:bg-subtle')}>
                      <span className="flex items-center gap-2 font-medium">{s.name}{s.is_default && <Badge tone="primary">Default</Badge>}</span>
                      <span className="text-xs text-muted">{s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)} · {s.is_default ? 'everyone else' : `${rosterCount.get(s.id) ?? 0} assigned`}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              <div className="px-4 pt-3"><Link href={`${base}?tab=rules&view=rules&rule=new`} className={buttonClass('secondary', 'sm', 'w-full')}>+ New rule</Link></div>
            </Panel>
            <Panel title={rule ? rule.name : 'New attendance rule'}
              meta={rule ? `${hours(rule.full_day_minutes)} full day · ${hours(rule.half_day_minutes)} half day` : undefined}
              action={rule && !rule.is_default ? (
                <ActionForm action={setDefaultRuleAction.bind(null, slug)} label={`Make ${rule.name} the default rule`} submit="Set as default" size="sm" variant="secondary" hidden={{ ruleId: rule.id }} className="flex" />
              ) : undefined}>
              <RuleEditor key={rule?.id ?? 'new'} action={saveRuleAction.bind(null, slug)} rule={rule ? {
                id: rule.id, name: rule.name, description: rule.description, start_time: rule.start_time, end_time: rule.end_time,
                break_minutes: rule.break_minutes, grace_minutes: rule.grace_minutes, early_grace_minutes: rule.early_grace_minutes,
                full_day_minutes: rule.full_day_minutes, half_day_minutes: rule.half_day_minutes, verify_selfie: rule.verify_selfie,
                verify_geofence: rule.verify_geofence, verify_ip: rule.verify_ip, overtime_after_minutes: rule.overtime_after_minutes,
                comp_off_min_minutes: rule.comp_off_min_minutes, late_marks_allowed: rule.late_marks_allowed, late_penalty_days: Number(rule.late_penalty_days),
              } : NEW_RULE} />
            </Panel>
          </div>
        );
      })()}

      {current === 'workweek' && (() => {
        const week = selected === 'new' ? null : setup.weeks.find((w) => w.id === selected) ?? setup.weeks[0] ?? null;
        return (
          <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
            <Panel title="Work weeks" flush>
              <p className="px-5 pb-2 text-xs text-muted">Without a default, the holiday calendar’s weekly offs apply.</p>
              <ul className="space-y-1 px-2" aria-label="Work weeks">
                {setup.weeks.map((w) => (
                  <li key={w.id}>
                    <Link href={`${base}?tab=rules&view=workweek&rule=${w.id}`} aria-current={week?.id === w.id ? 'page' : undefined}
                      className={cn('block rounded-lg border px-3 py-2.5 text-sm', week?.id === w.id ? 'border-primary/50 bg-primary-soft' : 'border-transparent hover:bg-subtle')}>
                      <span className="flex items-center gap-2 font-medium">{w.name}{w.is_default && <Badge tone="primary">Default</Badge>}</span>
                      <span className="text-xs text-muted">{weekCount.get(w.id) ?? 0} assigned</span>
                    </Link>
                  </li>
                ))}
              </ul>
              <div className="px-4 pt-3"><Link href={`${base}?tab=rules&view=workweek&rule=new`} className={buttonClass('secondary', 'sm', 'w-full')}>+ New work week</Link></div>
            </Panel>
            <div className="space-y-5">
              <Panel title={week ? week.name : 'New work week'} meta={week?.description ?? undefined}
                action={week && !week.is_default ? (
                  <ActionForm action={setDefaultWorkWeekAction.bind(null, slug)} label={`Make ${week.name} the default work week`} submit="Set as default" size="sm" variant="secondary" hidden={{ weekId: week.id }} className="flex" />
                ) : undefined}>
                <WorkWeekGrid key={week?.id ?? 'new'} action={saveWorkWeekAction.bind(null, slug)} id={week?.id} name={week?.name} description={week?.description}
                  pattern={week?.pattern ?? ['WWWWWOO', 'WWWWWOO', 'WWWWWOO', 'WWWWWOO', 'WWWWWOO']} />
              </Panel>
              <Panel title="Assign a work week">
                <AssignWorkWeekForm action={assignWorkWeekAction.bind(null, slug)} today={today} employees={employees}
                  weeks={setup.weeks.map((w) => ({ value: w.id, label: w.name }))} />
              </Panel>
            </div>
          </div>
        );
      })()}

      {current === 'assigned' && <Assigned ctx={ctx} slug={slug} setup={setup} employees={employees} today={today} />}
    </>
  );
}

async function Assigned({ ctx, slug, setup, employees, today }: {
  ctx: OrgContext; slug: string; setup: Awaited<ReturnType<typeof rulesSetup>>; employees: Awaited<ReturnType<typeof managerOptions>>; today: string;
}) {
  const names = await namesFor(ctx.org.id, [...setup.rosters.map((r) => r.employee_id), ...setup.weekAssignments.map((a) => a.employee_id)]);
  const ruleName = new Map(setup.shifts.map((s) => [s.id, s.name]));
  const weekName = new Map(setup.weeks.map((w) => [w.id, w.name]));
  return (
    <div className="space-y-5">
      <Panel title="Rule assignments" meta="everyone else follows the default rule" flush>
        {setup.rosters.length > 0 && (
          <Table caption="Shift assignments">
            <thead><tr><Th>Employee</Th><Th>Rule</Th><Th>From</Th><Th>Until</Th></tr></thead>
            <tbody>
              {setup.rosters.map((r) => (
                <tr key={r.id}>
                  <Td className="font-medium">{names.get(r.employee_id) ?? '—'}</Td>
                  <Td>{ruleName.get(r.shift_id)}</Td>
                  <Td>{formatDate(r.effective_from)}</Td>
                  <Td>{r.effective_to ? formatDate(r.effective_to) : 'Open-ended'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <RosterForm action={assignRosterAction.bind(null, slug)} employees={employees} today={today}
          shifts={setup.shifts.filter((s) => s.is_active).map((s) => ({ value: s.id, label: `${s.name} (${s.code})` }))} />
      </Panel>
      <Panel title="Work week assignments" flush>
        {setup.weekAssignments.length === 0 ? <p className="px-5 py-4 text-sm text-muted">No one has an assigned work week.</p> : (
          <Table caption="Work week assignments">
            <thead><tr><Th>Employee</Th><Th>Work week</Th><Th>From</Th></tr></thead>
            <tbody>
              {setup.weekAssignments.map((a) => (
                <tr key={a.id}>
                  <Td className="font-medium">{names.get(a.employee_id) ?? '—'}</Td>
                  <Td>{weekName.get(a.rule_id)}</Td>
                  <Td>{formatDate(a.effective_from)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </div>
  );
}
