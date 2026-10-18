import type { Metadata } from 'next';
import Link from 'next/link';
import { ACCRUAL_PERIOD_LABELS, todayIn } from '@peoplecore/shared';
import { Badge, Card, CardHeader, PageHeader } from '@/components/ui/surface';
import { Table, Td, Th } from '@/components/ui/table';
import { formatDate } from '@/lib/format';
import { requirePermission } from '@/server/context';
import { managerOptions } from '@/server/employees';
import { getLeaveSetup } from '@/server/leave';
import { addHolidayAction, addPolicyVersionAction, adjustBalanceAction, removeHolidayAction } from '../actions';
import { AdjustBalanceForm, HolidayForm, PolicyVersionForm, RemoveHoliday } from '../leave-forms';

export const metadata: Metadata = { title: 'Leave settings' };

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default async function LeaveSettingsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await requirePermission(slug, 'leave.manage', 'org');
  const today = todayIn(ctx.org.timezone);
  const [setup, employees] = await Promise.all([getLeaveSetup(ctx.org.id), managerOptions(ctx.org.id)]);
  const calendar = setup.calendars.find((c) => !c.location_id);
  const holidays = setup.holidays.filter((h) => h.calendar_id === calendar?.id);
  const currentPolicy = (typeId: string) => setup.policies.find((p) => p.leave_type_id === typeId && p.effective_from <= today);
  const typeOptions = setup.types.filter((t) => t.is_active).map((t) => ({ value: t.id, label: `${t.name} (${t.code})` }));

  return (
    <>
      <PageHeader
        eyebrow={<Link href={`/app/${slug}/leave`} className="hover:text-fg">← Leave</Link>}
        title="Leave settings"
        description="Leave types and their rules, holidays and balance adjustments. Every change is audited."
      />
      <div className="space-y-6">
        <Card>
          <CardHeader title="Leave types" description="Rules are versioned: a new version applies from its start date, earlier periods keep the old rules." />
          <Table caption="Leave types">
            <thead><tr><Th>Code</Th><Th>Name</Th><Th>Accrual</Th><Th>Carry-forward cap</Th><Th>Rules</Th></tr></thead>
            <tbody>
              {setup.types.map((t) => {
                const p = currentPolicy(t.id);
                return (
                  <tr key={t.id}>
                    <Td className="font-mono text-xs">{t.code}</Td>
                    <Td className="font-medium">{t.name}</Td>
                    <Td>{p ? (p.accrual_period === 'none' ? 'None' : `${Number(p.accrual_days)} day(s), ${ACCRUAL_PERIOD_LABELS[p.accrual_period].toLowerCase()}`) : '—'}</Td>
                    <Td className="tabular-nums">{p?.carry_forward_max == null ? 'Unlimited' : Number(p.carry_forward_max)}</Td>
                    <Td className="space-x-1">
                      {!t.is_paid && <Badge>Unpaid</Badge>}
                      {t.allow_half_day && <Badge>Half days</Badge>}
                      {t.allow_negative && <Badge>No balance needed</Badge>}
                      {t.count_all_days && <Badge>Counts weekends</Badge>}
                      {!t.is_active && <Badge tone="danger">Inactive</Badge>}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          <PolicyVersionForm action={addPolicyVersionAction.bind(null, slug)} types={typeOptions} today={today} />
        </Card>

        {calendar && (
          <Card>
            <CardHeader title="Holidays" description={`${calendar.name} · weekly offs: ${calendar.weekly_offs.map((d) => WEEKDAYS[d]).join(', ') || 'none'}`} />
            {holidays.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted">No holidays yet.</p>
            ) : (
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
          </Card>
        )}

        <Card>
          <CardHeader title="Adjust a balance" description="Opening balances and corrections are added to the ledger; nothing is overwritten." />
          <AdjustBalanceForm action={adjustBalanceAction.bind(null, slug)} employees={employees} types={typeOptions} />
        </Card>
      </div>
    </>
  );
}
