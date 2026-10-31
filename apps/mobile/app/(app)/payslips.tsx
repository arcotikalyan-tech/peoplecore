import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { inr, monthYear } from '@/lib/format';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { must, useLoad } from '@/lib/use-load';
import { Button, Card, EmptyState, ErrorState, ListGroup, ListRow, Page, SkeletonList, space, Text } from '@/ui';

interface Slip { run_id: string; period_month: string; gross: number; deductions: number; net: number }

/** India's financial year (April to March) a month falls in, as "2026–27". */
const fy = (iso: string) => {
  const y = Number(iso.slice(0, 4));
  const start = Number(iso.slice(5, 7)) >= 4 ? y : y - 1;
  return `${start}–${String(start + 1).slice(2)}`;
};

/**
 * Payslips once payroll is locked for the month (RLS: only your own, only released runs). Amounts stay hidden until
 * you choose to show them, as on a shared screen.
 */
export default function Payslips() {
  const { workplace } = useSession();
  const emp = workplace?.employeeId;
  const [shown, setShown] = useState(false);
  const { data, loading, error, reload } = useLoad(async () => {
    if (!emp) return [] as Slip[];
    const rows = must(await supabase.from('payroll_run_employees').select('run_id, period_month, gross, deductions, net')
      .eq('employee_id', emp).order('period_month', { ascending: false }).limit(36)) as Slip[];
    return rows.map((x) => ({ ...x, gross: Number(x.gross), deductions: Number(x.deductions), net: Number(x.net) }));
  }, [emp]);
  const money = (n: number) => (shown ? inr(n) : '₹ • • • •');
  const year = data?.[0] ? fy(data[0].period_month) : null;
  const inYear = data?.filter((s) => fy(s.period_month) === year) ?? [];
  const groups = [...new Set((data ?? []).map((s) => fy(s.period_month)))];

  return (
    <Page onRefresh={reload}>
      {loading ? <SkeletonList rows={4} /> : error ? <Card><ErrorState onRetry={() => void reload()} /></Card> : !data?.length ? (
        <Card><EmptyState icon="wallet-outline" title="No payslips yet" body="Your payslip appears here once payroll is locked for the month. You’ll get a notification." /></Card>
      ) : (
        <>
          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <View style={{ flex: 1 }}>
                <Text variant="footnote" tone="muted">Financial year {year} · {inYear.length} month{inYear.length === 1 ? '' : 's'}</Text>
                <Text variant="figure" style={{ marginTop: 2 }}>{money(inYear.reduce((t, s) => t + s.net, 0))}</Text>
                <Text variant="caption" tone="muted">Net pay so far</Text>
              </View>
              <Button label={shown ? 'Hide' : 'Show'} variant="tonal" size="sm" icon={shown ? 'eye-off-outline' : 'eye-outline'}
                accessibilityLabel={shown ? 'Hide amounts' : 'Show amounts'} onPress={() => setShown((v) => !v)} />
            </View>
            <View style={{ flexDirection: 'row', marginTop: space.lg, gap: space.lg }}>
              <View style={{ flex: 1 }}>
                <Text variant="caption" tone="muted">Gross</Text>
                <Text variant="headline">{money(inYear.reduce((t, s) => t + s.gross, 0))}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="caption" tone="muted">Deductions</Text>
                <Text variant="headline">{money(inYear.reduce((t, s) => t + s.deductions, 0))}</Text>
              </View>
            </View>
          </Card>
          {groups.map((g) => (
            <ListGroup key={g} title={`FY ${g}`}>
              {data.filter((s) => fy(s.period_month) === g).map((s) => (
                <ListRow key={s.run_id} icon="document-text-outline" tone="success" title={monthYear(s.period_month)}
                  subtitle={shown ? `Gross ${inr(s.gross)} · Deductions ${inr(s.deductions)}` : 'Tap to open'} value={money(s.net)}
                  accessibilityLabel={`${monthYear(s.period_month)} payslip${shown ? `, net ${inr(s.net)}` : ''}`}
                  onPress={() => router.push(`/payslip?run=${s.run_id}`)} />
              ))}
            </ListGroup>
          ))}
        </>
      )}
    </Page>
  );
}
