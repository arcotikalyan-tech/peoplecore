import { formatDate } from '@/lib/format';
import { myRule } from '@/server/attendance-ops';
import { createClient } from '@/server/supabase';
import { Empty, Fields, Panel, type ProfileProps } from './shared';

export const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const CELL: Record<string, { cls: string; label: string }> = {
  W: { cls: 'bg-success/20 text-success', label: 'Working Day' },
  O: { cls: 'bg-subtle text-muted', label: 'Weekly Off' },
  H: { cls: 'bg-warning/25 text-warning', label: 'Half Day' },
};

/** A work week pattern: five rows (week of the month) × seven days. */
export function WeekGrid({ pattern }: { pattern: string[] }) {
  return (
    <div className="px-5 py-4">
      <table className="w-full max-w-xl table-fixed text-center text-xs" aria-label="Work week">
        <thead><tr><th className="w-8" />{DAYS.map((d) => <th key={d} className="py-1 font-semibold text-muted">{d}</th>)}</tr></thead>
        <tbody>
          {pattern.map((row, i) => (
            <tr key={i}>
              <th className="py-1 text-muted">{i + 1}</th>
              {[...row].map((c, j) => (
                <td key={j} className="p-0.5"><span className={`block rounded-md py-2 font-semibold ${CELL[c]?.cls ?? ''}`} title={CELL[c]?.label}>{c === 'W' ? '' : c === 'H' ? '½' : '—'}<span className="sr-only">{CELL[c]?.label}</span></span></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="mt-3 flex flex-wrap gap-4 text-xs text-muted">
        {Object.values(CELL).map((c) => <li key={c.label} className="flex items-center gap-1.5"><span className={`inline-block size-3 rounded ${c.cls}`} />{c.label}</li>)}
      </ul>
    </div>
  );
}

/** Work Week: the rule that applies to this person (their assignment, else the organization's default). */
export async function WorkWeekTab({ ctx, id, today }: ProfileProps) {
  const { week } = await myRule(ctx.org.id, id, today);
  const supabase = await createClient();
  const { data: assigned } = await supabase.from('work_week_assignments').select('effective_from').eq('employee_id', id)
    .lte('effective_from', today).order('effective_from', { ascending: false }).limit(1).maybeSingle();
  if (!week) return <Panel title="Work Week"><Empty icon="📅" title="No work week rule applies yet"><p className="text-xs text-muted">HR sets work weeks in Attendance › Settings.</p></Empty></Panel>;
  const halfDay = week.pattern.some((r: string) => r.includes('H'));
  return (
    <Panel title={week.name}>
      <Fields items={[
        { label: 'Description', value: week.description },
        { label: 'Effective date', value: assigned?.effective_from ? formatDate(assigned.effective_from) : 'Organization default' },
        { label: 'Rule settings', value: halfDay ? 'Half Day' : 'Full days only' },
      ]} />
      <WeekGrid pattern={week.pattern} />
    </Panel>
  );
}
