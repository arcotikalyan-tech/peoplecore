import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { inr, monthYear } from '@/lib/format';
import { openPayslipPdf } from '@/lib/payslip-pdf';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { must, useLoad } from '@/lib/use-load';
import { Banner, Button, Card, DetailRow, EmptyState, ErrorState, Page, SkeletonList, space, Text, useTheme } from '@/ui';

interface Line { code: string; name: string; kind: string; amount: number }

/** One month's payslip: net pay, what was earned and deducted, and the PDF to save or share. */
export default function Payslip() {
  const { run } = useLocalSearchParams<{ run: string }>();
  const { workplace } = useSession();
  const { colors } = useTheme();
  const emp = workplace?.employeeId;
  const [downloading, setDownloading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const { data, loading, error, reload } = useLoad(async () => {
    if (!emp || !run) return null;
    const [slip, lines] = await Promise.all([
      supabase.from('payroll_run_employees').select('period_month, gross, deductions, net').eq('run_id', run).eq('employee_id', emp).maybeSingle(),
      supabase.from('payroll_line_items').select('code, name, kind, amount').eq('run_id', run).eq('employee_id', emp).order('kind'),
    ]);
    const s = must(slip);
    if (!s) return null;
    return {
      month: s.period_month, gross: Number(s.gross), deductions: Number(s.deductions), net: Number(s.net),
      lines: (must(lines) as Line[]).map((l) => ({ ...l, amount: Number(l.amount) })),
    };
  }, [emp, run]);
  const earnings = data?.lines.filter((l) => l.kind === 'earning') ?? [];
  const deductions = data?.lines.filter((l) => l.kind === 'deduction') ?? [];
  const other = data?.lines.filter((l) => !earnings.includes(l) && !deductions.includes(l) && l.kind !== 'employer') ?? [];

  const download = async () => {
    if (!workplace || !data || !run) return;
    setDownloading(true);
    setProblem(await openPayslipPdf(workplace.orgId, run, data.month.slice(0, 7)));
    setDownloading(false);
  };

  return (
    <Page onRefresh={reload}>
      {data && <Stack.Screen options={{ title: monthYear(data.month) }} />}
      {loading ? <SkeletonList rows={5} /> : error ? <Card><ErrorState onRetry={() => void reload()} /></Card> : !data ? (
        <Card><EmptyState icon="document-outline" title="Payslip not found" body="It may not be released yet." /></Card>
      ) : (
        <>
          <Card style={{ backgroundColor: colors.primarySoft, borderColor: colors.primarySoft }}>
            <Text variant="footnote" tone="primary" style={{ fontWeight: '600' }}>Net pay · {monthYear(data.month)}</Text>
            <Text variant="largeTitle" tone="primary" style={{ marginTop: 2 }}>{inr(data.net)}</Text>
            <View style={{ flexDirection: 'row', gap: space.xl, marginTop: space.md }}>
              <View><Text variant="caption" tone="muted">Gross</Text><Text variant="headline">{inr(data.gross)}</Text></View>
              <View><Text variant="caption" tone="muted">Deductions</Text><Text variant="headline">{inr(data.deductions)}</Text></View>
            </View>
          </Card>
          <Section title="Earnings" lines={earnings} total={data.gross} />
          {deductions.length > 0 && <Section title="Deductions" lines={deductions} total={data.deductions} minus />}
          {other.length > 0 && <Section title="Other" lines={other} />}
          {problem && <Banner tone="danger" text={problem} />}
          <Button label="Download PDF" size="lg" icon="download-outline" busy={downloading} onPress={() => void download()} />
        </>
      )}
    </Page>
  );
}

function Section({ title, lines, total, minus }: { title: string; lines: Line[]; total?: number; minus?: boolean }) {
  return (
    <Card>
      <Text variant="headline" accessibilityRole="header" style={{ marginBottom: space.xs }}>{title}</Text>
      {lines.map((l, i) => <DetailRow key={l.code + i} label={l.name} value={`${minus ? '−' : ''}${inr(l.amount)}`} last={i === lines.length - 1 && total === undefined} />)}
      {total !== undefined && (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: space.md }}>
          <Text variant="callout" style={{ fontWeight: '700' }}>Total</Text>
          <Text variant="callout" style={{ fontWeight: '700' }}>{minus ? '−' : ''}{inr(total)}</Text>
        </View>
      )}
    </Card>
  );
}
