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
import { penaltyLeaveTypes, rulesSetup } from '@/server/attendance-ops';
import { managerOptions } from '@/server/employees';
import { namesFor } from '@/server/leave';
import { ButtonAction } from '../../settings/settings-client';
import {
  assignRosterAction, assignRotationAction, assignWorkWeekAction, deleteRotationAction, duplicateRuleAction, endRotationAssignmentAction, saveRotationAction,
  saveRuleAction, saveWorkWeekAction, setDefaultRuleAction, setDefaultWorkWeekAction,
} from '../actions';
import { AssignRotationForm, AssignWorkWeekForm, RosterForm, RotationForm, RuleEditor, WorkWeekGrid } from '../attendance-forms';
import { ruleValues, type RuleValues } from '../rule-values';
import { createClient } from '@/server/supabase';
import { hours } from './status';

const NEW_RULE: RuleValues = {
  name: '', description: null, effective_from: null, start_time: '09:30', end_time: '18:30', break_minutes: 60, grace_minutes: 15, early_grace_minutes: 0,
  full_day_minutes: 480, half_day_minutes: 240, verify_selfie: false, verify_geofence: false, verify_ip: false, auto_clock_in: false, auto_clock_out: false,
  overtime_after_minutes: null, comp_off_min_minutes: null, comp_off_auto_approve: true, deduct_absent: false, penalties_enabled: false,
  late_marks_allowed: null, late_interval: 1, late_method: 'half_day', early_marks_allowed: null, early_interval: 1, early_method: 'half_day',
  short_marks_allowed: null, short_interval: 1, short_method: 'half_day_by_duration', penalty_leave_order: [],
};

export async function RulesTab({ ctx, slug, base, view, selected }: { ctx: OrgContext; slug: string; base: string; view: string; selected: string }) {
  const [setup, employees, leaveTypes] = await Promise.all([rulesSetup(ctx.org.id), managerOptions(ctx.org.id), penaltyLeaveTypes(ctx.org.id)]);
  const today = todayIn(ctx.org.timezone);
  const current = ['rules', 'rotations', 'workweek', 'assigned'].includes(view) ? view : 'rules';
  const shiftOptions = setup.shifts.filter((s) => s.is_active).map((s) => ({ value: s.id, label: `${s.name} (${s.code})` }));
  const ruleName = new Map(setup.shifts.map((s) => [s.id, s.name]));
  const kindSwitch = (
    <div role="group" aria-label="Shift type" className="mb-4 inline-flex rounded-lg border border-line p-0.5 text-sm">
      {([['rules', 'Normal shift'], ['rotations', 'Rotational shift']] as const).map(([k, l]) => (
        <Link key={k} href={`${base}?tab=rules&view=${k}`} aria-current={current === k ? 'page' : undefined}
          className={cn('rounded-md px-3 py-1', current === k ? 'bg-primary-soft font-medium text-fg' : 'text-muted hover:text-fg')}>{l}</Link>
      ))}
    </div>
  );
  const rosterCount = new Map<string, number>();
  for (const r of setup.rosters) if (!r.effective_to || r.effective_to >= today) rosterCount.set(r.shift_id, (rosterCount.get(r.shift_id) ?? 0) + 1);
  const weekCount = new Map<string, number>();
  for (const a of setup.weekAssignments) weekCount.set(a.rule_id, (weekCount.get(a.rule_id) ?? 0) + 1);

  return (
    <>
      <SubTabs base={base} label="Rules" current={current} extra={{ tab: 'rules' }} tabs={[
        { key: current === 'rotations' ? 'rotations' : 'rules', label: 'Attendance rules', count: setup.shifts.length }, { key: 'workweek', label: 'Work week', count: setup.weeks.length },
        { key: 'assigned', label: 'Assignments' },
      ]} />

      {current === 'rules' && (() => {
        const rule = selected === 'new' ? null : setup.shifts.find((s) => s.id === selected) ?? setup.shifts[0] ?? null;
        return (
          <>
          {kindSwitch}
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
              action={rule ? (
                <div className="flex flex-wrap items-center gap-2">
                  <ButtonAction action={duplicateRuleAction.bind(null, slug, rule.id)} aria={`Duplicate ${rule.name}`} label="⎘ Duplicate" variant="ghost" />
                  {!rule.is_default && <ActionForm action={setDefaultRuleAction.bind(null, slug)} label={`Make ${rule.name} the default rule`} submit="Set as default" size="sm" variant="secondary" hidden={{ ruleId: rule.id }} className="flex" />}
                </div>
              ) : undefined}>
              {rule?.effective_from && <p className="mb-3 text-xs text-muted">Effective {formatDate(rule.effective_from)} for the people assigned to it.</p>}
              <RuleEditor key={rule?.id ?? 'new'} action={saveRuleAction.bind(null, slug)} leaveTypes={leaveTypes} rule={rule ? ruleValues(rule) : NEW_RULE} />
            </Panel>
          </div>
          </>
        );
      })()}

      {current === 'rotations' && (
        <>
          {kindSwitch}
          <Rotations ctx={ctx} slug={slug} shifts={shiftOptions} employees={employees} today={today} ruleName={ruleName} />
        </>
      )}

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

/** Rotating shifts: a pattern that advances every N days; people on a rotation get the shift for the day from it. */
async function Rotations({ ctx, slug, shifts, employees, today, ruleName }: {
  ctx: OrgContext; slug: string; shifts: Array<{ value: string; label: string }>; employees: Awaited<ReturnType<typeof managerOptions>>; today: string; ruleName: Map<string, string>;
}) {
  const supabase = await createClient();
  const [rotations, assigned] = await Promise.all([
    supabase.from('shift_rotations').select('id, name, pattern, period_days, start_date').eq('organization_id', ctx.org.id).order('name').then((r) => r.data ?? []),
    supabase.from('rotation_assignments').select('id, employee_id, rotation_id, effective_from, effective_to').eq('organization_id', ctx.org.id).order('effective_from', { ascending: false }).then((r) => r.data ?? []),
  ]);
  const names = await namesFor(ctx.org.id, assigned.map((a) => a.employee_id));
  return (
    <div className="space-y-5">
      <Panel title="Rotational shifts" meta="people on a rotation get the day’s shift from its pattern; an explicit rule assignment still wins for its dates" flush>
        {rotations.length === 0 ? <p className="px-5 pb-2 text-sm text-muted">No rotations yet. Create one below from two or more rules.</p> : (
          <ul className="divide-y divide-line" aria-label="Rotations">
            {rotations.map((r) => {
              const people = assigned.filter((a) => a.rotation_id === r.id && (!a.effective_to || a.effective_to >= today));
              return (
                <li key={r.id} className="px-5 py-3">
                  <details>
                    <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-3">
                      <span><span className="font-medium">{r.name}</span>
                        <span className="block text-xs text-muted">{r.pattern.map((id) => ruleName.get(id) ?? '—').join(' → ')} · switches every {r.period_days} day{r.period_days === 1 ? '' : 's'} · from {formatDate(r.start_date)}</span></span>
                      <span className="text-xs text-muted">{people.length} {people.length === 1 ? 'person' : 'people'} · <span className="text-primary">Edit</span></span>
                    </summary>
                    <div className="mt-3 space-y-3 rounded-xl border border-line">
                      <RotationForm action={saveRotationAction.bind(null, slug)} shifts={shifts} today={today} rotation={r} />
                      {people.length > 0 && (
                        <ul className="divide-y divide-line border-t border-line text-sm" aria-label={`People on ${r.name}`}>
                          {people.map((a) => (
                            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2">
                              <span>{names.get(a.employee_id) ?? '—'} <span className="text-xs text-muted">from {formatDate(a.effective_from)}{a.effective_to ? ` until ${formatDate(a.effective_to)}` : ''}</span></span>
                              {!a.effective_to && <ButtonAction action={endRotationAssignmentAction.bind(null, slug, a.id, today)} aria={`End ${names.get(a.employee_id) ?? 'this person'}’s rotation`} label="End today" variant="ghost" />}
                            </li>
                          ))}
                        </ul>
                      )}
                      <div className="border-t border-line px-5 py-3">
                        <ButtonAction action={deleteRotationAction.bind(null, slug, r.id)} aria={`Remove rotation ${r.name}`} label="Remove rotation" variant="ghost" />
                      </div>
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
      <Panel title="New rotation" flush>
        <RotationForm action={saveRotationAction.bind(null, slug)} shifts={shifts} today={today} />
      </Panel>
      {rotations.length > 0 && (
        <Panel title="Assign a rotation" flush>
          <AssignRotationForm action={assignRotationAction.bind(null, slug)} rotations={rotations.map((r) => ({ value: r.id, label: r.name }))} employees={employees} today={today} />
        </Panel>
      )}
    </div>
  );
}
