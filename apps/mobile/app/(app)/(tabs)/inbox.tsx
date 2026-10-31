import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useCounts } from '@/lib/counts';
import { decisionMessage, decisionProblem, refusalMessage } from '@/lib/decisions';
import { ago } from '@/lib/format';
import { screenFor } from '@/lib/push-links';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { must, useLoad } from '@/lib/use-load';
import {
  Avatar, Banner, Button, Card, EmptyState, ErrorState, Field, IconTile, LinkButton, Page, Pill, Segmented, Sheet, SkeletonList, space, TabHeader, Text,
  useTheme, useToast, type IconName, type Tone,
} from '@/ui';

interface Approval { id: string; subject_type: string; summary: string; step_label: string | null; requested_by_name: string; on_behalf_of_name: string | null; created_at: string; escalated: boolean }
interface Note { id: string; kind: string; title: string; body: string | null; link: string | null; created_at: string; read_at: string | null }

const KIND: Record<string, [IconName, Tone]> = {
  approval: ['checkmark-done-outline', 'primary'], leave: ['airplane-outline', 'info'], attendance: ['time-outline', 'warning'],
  payroll: ['wallet-outline', 'success'], expense: ['receipt-outline', 'success'], loan: ['cash-outline', 'success'],
  asset: ['laptop-outline', 'neutral'], helpdesk: ['help-buoy-outline', 'info'], announcement: ['megaphone-outline', 'danger'],
  learning: ['school-outline', 'accent'], performance: ['trophy-outline', 'accent'], letter: ['document-text-outline', 'neutral'],
  grievance: ['shield-checkmark-outline', 'warning'], timesheet: ['stopwatch-outline', 'info'],
};
const kindOf = (kind: string): [IconName, Tone] => KIND[kind.split('.')[0] ?? ''] ?? ['notifications-outline', 'neutral'];

/**
 * The Inbox: requests waiting for your decision (approve, or reject with a reason, as on the website) and your
 * notifications. Tapping a notification marks it read and opens its screen.
 */
export default function Inbox() {
  const { workplace } = useSession();
  const { colors } = useTheme();
  const toast = useToast();
  const counts = useCounts();
  const params = useLocalSearchParams<{ view?: string }>();
  const [view, setView] = useState<'approvals' | 'notifications'>(params.view === 'notifications' ? 'notifications' : 'approvals');
  const [rejecting, setRejecting] = useState<Approval | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // Chosen by a link, or by tapping a segment; otherwise the Inbox opens where something is.
  const chosen = useRef(false);
  const choose = (v: 'approvals' | 'notifications') => { chosen.current = true; setView(v); };
  useEffect(() => { if (params.view === 'notifications' || params.view === 'approvals') choose(params.view); }, [params.view]);

  const { data, loading, error, reload } = useLoad(async () => {
    if (!workplace) return { approvals: [] as Approval[], notes: [] as Note[] };
    const [pending, recent] = await Promise.all([
      supabase.rpc('my_pending_approvals', { p_org: workplace.orgId }),
      supabase.from('notifications').select('id, kind, title, body, link, created_at, read_at').eq('organization_id', workplace.orgId).order('created_at', { ascending: false }).limit(50),
    ]);
    return { approvals: must(pending) as Approval[], notes: must(recent) as Note[] };
  }, [workplace]);
  useEffect(() => {
    if (!chosen.current && data) setView(data.approvals.length ? 'approvals' : 'notifications');
  }, [data]);
  const refresh = () => Promise.all([reload(), counts.refresh()]);

  const decide = async (a: Approval, decision: 'approve' | 'reject', comment = '') => {
    const p = decisionProblem(decision, comment);
    if (p) return setProblem(p);
    setBusy(a.id + decision);
    const { data: r, error: e } = await supabase.rpc('decide_approval', { p_request: a.id, p_decision: decision, p_comment: comment.trim() || null });
    setBusy(null);
    if (e) {
      if (decision === 'reject') setProblem(refusalMessage(e));
      else toast(refusalMessage(e), 'danger');
      return;
    }
    setRejecting(null);
    setReason('');
    toast(decisionMessage(r as string | null));
    await refresh();
  };
  const open = async (n: Note) => {
    if (!n.read_at) {
      await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', n.id);
      void refresh();
    }
    const screen = screenFor(n.link);
    if (screen !== '/(app)/(tabs)/inbox') router.navigate(screen);
  };
  const markAllRead = async () => {
    if (!workplace) return;
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('organization_id', workplace.orgId).is('read_at', null);
    await refresh();
  };
  const unread = data?.notes.filter((n) => !n.read_at).length ?? 0;
  const approvals = data?.approvals ?? [];

  return (
    <Page tab onRefresh={refresh} header={
      <TabHeader title="Inbox" subtitle={approvals.length ? `${approvals.length} waiting for your decision` : unread ? `${unread} unread` : 'You’re all caught up'}
        right={view === 'notifications' && unread > 0 ? <LinkButton label="Mark all read" onPress={() => void markAllRead()} /> : undefined} />
    }>
      <Segmented value={view} onChange={choose} options={[
        { value: 'approvals', label: 'Approvals', count: approvals.length },
        { value: 'notifications', label: 'Notifications', count: unread },
      ]} />

      {loading ? <SkeletonList rows={4} /> : error ? <Card><ErrorState onRetry={() => void refresh()} /></Card> : view === 'approvals' ? (
        approvals.length === 0 ? (
          <Card><EmptyState icon="checkmark-done-circle-outline" title="Nothing to approve" body="Leave, attendance and expense requests from your team appear here for your decision." /></Card>
        ) : (
          <View style={{ gap: space.md }}>
            {approvals.map((a) => (
              <Card key={a.id} accessibilityLabel={`Approval: ${a.summary}, from ${a.requested_by_name}`}>
                <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'center' }}>
                  <Avatar name={a.requested_by_name} size={40} />
                  <View style={{ flex: 1 }}>
                    <Text variant="callout" style={{ fontWeight: '600' }} numberOfLines={1}>{a.requested_by_name}</Text>
                    <Text variant="caption" tone="muted">{ago(a.created_at)}{a.step_label ? ` · ${a.step_label}` : ''}</Text>
                  </View>
                  {a.escalated && <Pill label="Overdue" tone="danger" />}
                </View>
                <Text variant="body" style={{ marginTop: space.md, fontWeight: '500' }}>{a.summary}</Text>
                {a.on_behalf_of_name && <Text variant="footnote" tone="muted" style={{ marginTop: 2 }}>On behalf of {a.on_behalf_of_name}</Text>}
                <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.lg }}>
                  <Button label="Reject" variant="outline" size="sm" style={{ flex: 1 }} icon="close"
                    onPress={() => { setProblem(null); setReason(''); setRejecting(a); }} />
                  <Button label="Approve" size="sm" style={{ flex: 1 }} icon="checkmark" busy={busy === a.id + 'approve'} onPress={() => void decide(a, 'approve')} />
                </View>
              </Card>
            ))}
          </View>
        )
      ) : (data?.notes.length ?? 0) === 0 ? (
        <Card><EmptyState icon="notifications-off-outline" title="No notifications yet" body="Decisions on your requests, payslips and company news show up here." /></Card>
      ) : (
        <Card padded={false}>
          {data!.notes.map((n, i) => {
            const [icon, tone] = kindOf(n.kind);
            return (
              <Pressable key={n.id} accessibilityRole="button" accessibilityLabel={`${n.read_at ? '' : 'Unread. '}${n.title}. ${n.body ?? ''}`}
                onPress={() => void open(n)} android_ripple={{ color: colors.line }}
                style={({ pressed }) => [{ flexDirection: 'row', gap: space.md, padding: space.lg, backgroundColor: pressed ? colors.subtle : n.read_at ? 'transparent' : colors.primarySoft },
                  i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.line }]}>
                <IconTile icon={icon} tone={tone} size={36} />
                <View style={{ flex: 1 }}>
                  <Text variant="callout" style={{ fontWeight: n.read_at ? '500' : '700' }}>{n.title}</Text>
                  {n.body ? <Text variant="footnote" tone="muted" numberOfLines={3}>{n.body}</Text> : null}
                  <Text variant="caption" tone="faint" style={{ marginTop: 4 }}>{ago(n.created_at)}</Text>
                </View>
                {!n.read_at && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary, marginTop: 6 }} />}
              </Pressable>
            );
          })}
        </Card>
      )}

      <Sheet visible={!!rejecting} onClose={() => setRejecting(null)} title="Reject this request?">
        {rejecting && (
          <>
            <Text variant="callout" tone="muted" style={{ marginBottom: space.lg }}>{rejecting.summary} · {rejecting.requested_by_name}</Text>
            <Field label="Reason" value={reason} onChangeText={setReason} placeholder="They’ll see this with the decision" multiline autoFocus />
            {problem && <Banner tone="danger" text={problem} style={{ marginBottom: space.md }} />}
            <View style={{ gap: space.sm }}>
              <Button label="Reject" variant="danger" busy={busy === rejecting.id + 'reject'} onPress={() => void decide(rejecting, 'reject', reason)} />
              <Button label="Keep it" variant="ghost" onPress={() => setRejecting(null)} />
            </View>
          </>
        )}
      </Sheet>
    </Page>
  );
}
