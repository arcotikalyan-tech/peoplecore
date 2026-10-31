import { todayIn } from '@peoplecore/shared/dates';
import { useState } from 'react';
import { View } from 'react-native';
import { ago, plainText } from '@/lib/format';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { must, useLoad } from '@/lib/use-load';
import { Button, Card, EmptyState, ErrorState, Page, Pill, SkeletonList, space, Text, useToast } from '@/ui';

interface Announcement { id: string; title: string; body: string; requires_ack: boolean; published_at: string; expires_at: string | null }

/** Company announcements, newest first; the ones that ask for it are acknowledged from here. */
export default function Announcements() {
  const { workplace } = useSession();
  const toast = useToast();
  const emp = workplace?.employeeId;
  const today = todayIn(workplace?.timezone ?? 'Asia/Kolkata');
  const [busy, setBusy] = useState<string | null>(null);
  const { data, loading, error, reload } = useLoad(async () => {
    if (!workplace) return { list: [] as Announcement[], acked: new Set<string>() };
    const [list, acks] = await Promise.all([
      supabase.from('announcements').select('id, title, body, requires_ack, published_at, expires_at').eq('organization_id', workplace.orgId).order('published_at', { ascending: false }).limit(50),
      emp ? supabase.from('announcement_acknowledgements').select('announcement_id').eq('employee_id', emp) : Promise.resolve({ data: [], error: null }),
    ]);
    return {
      list: (must(list) as Announcement[]).filter((a) => !a.expires_at || a.expires_at >= today),
      acked: new Set(((acks.data ?? []) as Array<{ announcement_id: string }>).map((a) => a.announcement_id)),
    };
  }, [workplace, emp, today]);

  const acknowledge = async (id: string) => {
    setBusy(id);
    const { error: e } = await supabase.rpc('acknowledge_announcement', { p_announcement: id });
    setBusy(null);
    toast(e ? 'Couldn’t acknowledge. Try again.' : 'Acknowledged.', e ? 'danger' : 'success');
    if (!e) await reload();
  };

  return (
    <Page onRefresh={reload}>
      {loading ? <SkeletonList rows={4} /> : error ? <Card><ErrorState onRetry={() => void reload()} /></Card> : !data?.list.length ? (
        <Card><EmptyState icon="megaphone-outline" title="No announcements" body="News from your company appears here." /></Card>
      ) : data.list.map((a) => {
        const done = data.acked.has(a.id);
        return (
          <Card key={a.id} accessibilityLabel={a.title}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.xs }}>
              <Text variant="caption" tone="muted" style={{ flex: 1 }}>{ago(a.published_at)}</Text>
              {a.requires_ack && <Pill label={done ? 'Acknowledged' : 'Please acknowledge'} tone={done ? 'success' : 'warning'} />}
            </View>
            <Text variant="title3" accessibilityRole="header">{a.title}</Text>
            <Text variant="body" tone="muted" style={{ marginTop: space.sm }}>{plainText(a.body)}</Text>
            {a.requires_ack && !done && emp && (
              <Button label="I’ve read this" variant="tonal" icon="checkmark-circle-outline" style={{ marginTop: space.lg }} busy={busy === a.id} onPress={() => void acknowledge(a.id)} />
            )}
          </Card>
        );
      })}
    </Page>
  );
}
