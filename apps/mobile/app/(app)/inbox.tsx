import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { decisionMessage, decisionProblem, refusalMessage, type Decision } from '@/lib/decisions';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { Button, Card, colors, Message, s, Screen } from '@/ui';

interface Approval { id: string; summary: string; step_label: string | null; requested_by_name: string; created_at: string; escalated: boolean }
interface Note { id: string; title: string; body: string | null; created_at: string; read_at: string | null }

const when = (iso: string) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

/** The phone's Inbox: approvals waiting for you (approve, or reject with a reason) and your notifications. */
export default function Inbox() {
  const { workplace } = useSession();
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [comments, setComments] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'danger' | 'success'; text: string } | null>(null);

  const load = useCallback(async () => {
    if (!workplace) return;
    const [{ data: pending }, { data: recent }] = await Promise.all([
      supabase.rpc('my_pending_approvals', { p_org: workplace.orgId }),
      supabase.from('notifications').select('id, title, body, created_at, read_at').eq('organization_id', workplace.orgId).order('created_at', { ascending: false }).limit(30),
    ]);
    setApprovals((pending ?? []) as Approval[]);
    setNotes((recent ?? []) as Note[]);
  }, [workplace]);
  useEffect(() => { void load(); }, [load]);

  const decide = async (id: string, decision: Decision) => {
    const comment = comments[id] ?? '';
    const problem = decisionProblem(decision, comment);
    if (problem) return setMessage({ tone: 'danger', text: problem });
    setBusy(id + decision);
    const { data, error } = await supabase.rpc('decide_approval', { p_request: id, p_decision: decision, p_comment: comment.trim() || null });
    setBusy(null);
    setMessage(error ? { tone: 'danger', text: refusalMessage(error) } : { tone: 'success', text: decisionMessage(data as string | null) });
    await load();
  };
  const markRead = async () => {
    if (!workplace) return;
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('organization_id', workplace.orgId).is('read_at', null);
    await load();
  };
  const unread = notes.filter((n) => !n.read_at).length;

  return (
    <ScrollView keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={false} onRefresh={() => void load()} />}>
      <Screen>
        {message && <Message tone={message.tone} text={message.text} />}
        <Card title={`Waiting for you · ${approvals.length}`}>
          {approvals.length === 0 && <Text style={s.muted}>Nothing to approve. 🎉</Text>}
          {approvals.map((a) => (
            <View key={a.id} accessibilityLabel={`Approval: ${a.summary}`} style={{ paddingVertical: 10, borderBottomWidth: 1, borderColor: colors.line }}>
              <Text style={{ fontWeight: '600', color: colors.fg }}>{a.summary}</Text>
              <Text style={s.muted}>{a.requested_by_name} · {when(a.created_at)}{a.step_label ? ` · ${a.step_label}` : ''}{a.escalated ? ' · overdue' : ''}</Text>
              <TextInput accessibilityLabel={`Comment on ${a.summary}`} placeholder="Comment (needed to reject)" placeholderTextColor={colors.muted}
                value={comments[a.id] ?? ''} onChangeText={(v) => setComments({ ...comments, [a.id]: v })} style={[s.input, { marginVertical: 8 }]} />
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 1 }}><Button label="Approve" busy={busy === a.id + 'approve'} onPress={() => void decide(a.id, 'approve')} /></View>
                <View style={{ flex: 1 }}><Button label="Reject" variant="secondary" busy={busy === a.id + 'reject'} onPress={() => void decide(a.id, 'reject')} /></View>
              </View>
            </View>
          ))}
        </Card>
        <Card title={`Notifications${unread ? ` · ${unread} new` : ''}`}>
          {notes.length === 0 && <Text style={s.muted}>No notifications yet.</Text>}
          {notes.map((n) => (
            <View key={n.id} style={s.row}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: n.read_at ? '400' : '600', color: colors.fg }}>{n.title}</Text>
                {n.body ? <Text style={s.muted}>{n.body}</Text> : null}
              </View>
              <Text style={[s.muted, { marginLeft: 8 }]}>{when(n.created_at)}</Text>
            </View>
          ))}
          {unread > 0 && <View style={{ marginTop: 10 }}><Button label="Mark all read" variant="secondary" onPress={() => void markRead()} /></View>}
        </Card>
      </Screen>
    </ScrollView>
  );
}
