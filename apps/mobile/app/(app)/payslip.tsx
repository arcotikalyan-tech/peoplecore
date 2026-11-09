import type { PayslipLayout } from '@peoplecore/shared/payslip';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Image, View } from 'react-native';
import { monthYear } from '@/lib/format';
import { openPayslipPdf } from '@/lib/payslip-pdf';
import { loadPayslipView } from '@/lib/payslip-view';
import { useSession } from '@/lib/session';
import { useLoad } from '@/lib/use-load';
import { Banner, Button, Card, EmptyState, ErrorState, Page, SkeletonList, space, Text, useTheme } from '@/ui';

/**
 * One month's payslip in the one payslip format (as the PDF and the website): letterhead, the month, the employee's
 * details, earnings, deductions, the days and payment, the totals and net salary, the notes. The website's sheet puts
 * earnings beside deductions; a phone is too narrow, so here they follow each other. Then the PDF to save or share.
 */
export default function Payslip() {
  const { run } = useLocalSearchParams<{ run: string }>();
  const { workplace } = useSession();
  const [downloading, setDownloading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const { data, loading, error, reload } = useLoad(async () => (workplace && run ? loadPayslipView(workplace.orgId, run) : null), [workplace?.orgId, run]);

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
          <Sheet layout={data.layout} logo={data.logo} />
          {problem && <Banner tone="danger" text={problem} />}
          <Button label="Download PDF" size="lg" icon="download-outline" busy={downloading} onPress={() => void download()} />
          <Text variant="caption" tone="muted">The PDF shows the PAN, UAN and account number in full.</Text>
          {data.layout.foot.map((f) => <Text key={f.text} variant="caption" tone="muted" style={f.italic ? { fontStyle: 'italic' } : undefined}>{f.text}</Text>)}
        </>
      )}
    </Page>
  );
}

function Sheet({ layout: L, logo }: { layout: PayslipLayout; logo: string | null }) {
  const { colors } = useTheme();
  const line = { borderColor: colors.lineStrong, borderTopWidth: 1 } as const;
  const Pair = ({ label, value, bold }: { label: string; value: string; bold?: boolean }) => (
    <View style={{ flexDirection: 'row', paddingVertical: 2 }} accessible accessibilityLabel={`${label}: ${value || 'none'}`}>
      <Text variant="footnote" style={{ width: 132, fontWeight: bold ? '700' : '400' }}>{label}</Text>
      <Text variant="footnote" style={{ width: 12 }}>:</Text>
      <Text variant="footnote" style={{ flex: 1, fontWeight: bold ? '700' : '400' }}>{value}</Text>
    </View>
  );
  const Lines = ({ title, rows }: { title: string; rows: Array<[string, string]> }) => (
    <View style={line} accessibilityRole="list" accessibilityLabel={title}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: space.sm, paddingVertical: 4, borderBottomWidth: 1, borderColor: colors.lineStrong }}>
        <Text variant="footnote">{title}</Text><Text variant="footnote">Amount (Rs.)</Text>
      </View>
      {rows.map(([name, amount], i) => (
        <View key={name + i} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.md, paddingHorizontal: space.sm, paddingVertical: 3 }}>
          <Text variant="footnote" style={{ flex: 1 }}>{name}</Text><Text variant="footnote" style={{ fontVariant: ['tabular-nums'] }}>{amount}</Text>
        </View>
      ))}
    </View>
  );
  return (
    <View style={{ borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface, borderRadius: 4 }} accessibilityLabel="Payslip">
      <View style={{ flexDirection: 'row', gap: space.md, padding: space.sm, alignItems: 'flex-start' }}>
        {logo && <Image source={{ uri: logo }} style={{ width: 96, height: 36 }} resizeMode="contain" accessibilityIgnoresInvertColors />}
        <View style={{ flex: 1 }}>
          <Text variant="headline" style={{ fontWeight: '700' }}>{L.company}</Text>
          {L.address.map((a) => <Text key={a} variant="caption">{a}</Text>)}
        </View>
      </View>
      <Text variant="footnote" style={{ textAlign: 'center', fontWeight: '700', color: colors.info, paddingVertical: space.sm }}>{L.title.replace(/ {2}/g, ' ')}</Text>
      <View style={[line, { padding: space.sm }]}>
        {[...L.left.slice(0, 1), ...L.right.slice(0, 1), ...L.left.slice(1, 3), ...L.right.slice(1, 3), ...L.left.slice(3), ...L.right.slice(3)].map(([l, v]) => <Pair key={l} label={l} value={v} />)}
      </View>
      <Lines title="EARNINGS" rows={L.earnings} />
      <View style={[line, { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: space.sm, paddingVertical: 4 }]}>
        <Text variant="footnote" style={{ fontWeight: '700' }}>Total Earnings Rs. {L.totals.earnings}</Text>
      </View>
      <Lines title="DEDUCTIONS" rows={L.deductions} />
      <View style={[line, { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: space.sm, paddingVertical: 4 }]}>
        <Text variant="footnote" style={{ fontWeight: '700' }}>Total Deductions Rs. {L.totals.deductions}</Text>
      </View>
      <View style={[line, { padding: space.sm }]}>{L.days.map(([l, v]) => <Pair key={l} label={l} value={v} />)}</View>
      <View style={[line, { padding: space.sm }]}>{L.payment.map(([l, v]) => <Pair key={l} label={l} value={v} />)}</View>
      <View style={[line, { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: space.sm, paddingVertical: 6 }]}>
        <Text variant="callout" style={{ fontWeight: '700' }}>Net Salary Rs. {L.totals.net}</Text>
      </View>
      <View style={[line, { padding: space.sm, gap: 2 }]}>{L.notes.map((n) => <Text key={n} variant="caption" style={{ fontWeight: '700' }}>{n}</Text>)}</View>
    </View>
  );
}
