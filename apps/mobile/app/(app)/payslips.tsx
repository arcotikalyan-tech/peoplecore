import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { Card, colors, s, Screen } from '@/ui';

interface Slip { run_id: string; period_month: string; gross: number; deductions: number; net: number }
interface Line { code: string; name: string; kind: string; amount: number }

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const month = (iso: string) => new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));

/** Payslips once a run is locked (RLS: only the employee's own, and only released runs). */
export default function Payslips() {
  const { workplace } = useSession();
  const [slips, setSlips] = useState<Slip[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const emp = workplace?.employeeId;

  const load = useCallback(async () => {
    if (!emp) return;
    const { data } = await supabase.from('payroll_run_employees').select('run_id, period_month, gross, deductions, net')
      .eq('employee_id', emp).order('period_month', { ascending: false }).limit(24);
    setSlips(((data ?? []) as Slip[]).map((x) => ({ ...x, gross: Number(x.gross), deductions: Number(x.deductions), net: Number(x.net) })));
  }, [emp]);
  useEffect(() => { void load(); }, [load]);

  const show = async (runId: string) => {
    if (open === runId) return setOpen(null);
    setOpen(runId);
    const { data } = await supabase.from('payroll_line_items').select('code, name, kind, amount').eq('run_id', runId).eq('employee_id', emp!).order('kind');
    setLines(((data ?? []) as Line[]).map((l) => ({ ...l, amount: Number(l.amount) })));
  };

  return (
    <ScrollView>
      <Screen>
        {slips.length === 0 && <Card><Text style={s.muted}>No payslips yet. They appear here once payroll is locked for the month.</Text></Card>}
        {slips.map((p) => (
          <Card key={p.run_id}>
            <Pressable accessibilityRole="button" accessibilityLabel={`${month(p.period_month)}, net ${inr(p.net)}`} onPress={() => void show(p.run_id)} style={s.row}>
              <Text style={{ fontWeight: '600' }}>{month(p.period_month)}</Text>
              <Text style={{ fontWeight: '600', color: colors.primary }}>{inr(p.net)}</Text>
            </Pressable>
            {open === p.run_id && (
              <View accessibilityLabel={`${month(p.period_month)} payslip`}>
                {lines.filter((l) => l.kind !== 'employer').map((l) => (
                  <View key={l.code} style={s.row}><Text>{l.name}</Text><Text>{l.kind === 'deduction' ? `−${inr(l.amount)}` : inr(l.amount)}</Text></View>
                ))}
                <View style={s.row}><Text style={s.muted}>Gross {inr(p.gross)} · Deductions {inr(p.deductions)}</Text></View>
              </View>
            )}
          </Card>
        ))}
      </Screen>
    </ScrollView>
  );
}
