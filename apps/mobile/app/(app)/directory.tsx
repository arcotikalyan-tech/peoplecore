import { todayIn } from '@peoplecore/shared/dates';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { Linking, ScrollView, TextInput, View } from 'react-native';
import { DayPunches } from '@/components/day-punches';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { useLoad } from '@/lib/use-load';
import { Avatar, Button, Card, DetailRow, EmptyState, ErrorState, ListGroup, ListRow, Page, radius, Sheet, SkeletonList, space, Text, useTheme } from '@/ui';

interface Person { id: string; name: string; department: string | null; designation: string | null; location?: string | null; work_email?: string | null; work_phone?: string | null }

/**
 * The people directory: search by name, department or role; tap someone for their work email and phone (what the
 * organization's directory settings let you see) and to call or write to them.
 */
export default function Directory() {
  const { workplace } = useSession();
  const { colors } = useTheme();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState<Person | null>(null);
  useEffect(() => { const t = setTimeout(() => setDebounced(query.trim()), 300); return () => clearTimeout(t); }, [query]);

  const { data, loading, error, reload } = useLoad(async () => {
    if (!workplace) return [] as Person[];
    const full = await supabase.rpc('people_directory', { p_org: workplace.orgId, p_query: debounced || undefined, p_limit: 60 });
    if (!full.error) return (full.data ?? []) as Person[];
    // Directory limited to managers or HR: colleagues' names and roles only.
    const basic = await supabase.rpc('colleague_directory', { p_org: workplace.orgId, p_query: debounced || undefined, p_limit: 60 });
    if (basic.error) throw basic.error;
    return (basic.data ?? []) as Person[];
  }, [workplace, debounced]);

  return (
    <Page onRefresh={reload}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: colors.surface, borderRadius: radius.md,
        borderWidth: 1, borderColor: colors.lineStrong, paddingHorizontal: space.md, minHeight: 48 }}>
        <Ionicons name="search" size={18} color={colors.muted} />
        <TextInput value={query} onChangeText={setQuery} placeholder="Search name, team or role" placeholderTextColor={colors.faint}
          accessibilityLabel="Search the directory" autoCorrect={false} returnKeyType="search" clearButtonMode="while-editing"
          style={{ flex: 1, fontSize: 15, color: colors.fg, paddingVertical: 10 }} />
      </View>
      {loading ? <SkeletonList rows={6} /> : error ? <Card><ErrorState onRetry={() => void reload()} /></Card> : !data?.length ? (
        <Card><EmptyState icon="people-outline" title={debounced ? 'No one matches' : 'No colleagues to show'} body={debounced ? 'Try part of a name, or a team.' : undefined} /></Card>
      ) : (
        <ListGroup footer={data.length >= 60 ? 'Showing the first 60. Search to narrow it down.' : undefined}>
          {data.map((p) => (
            <ListRow key={p.id} leading={<Avatar name={p.name} size={40} />} title={p.name}
              subtitle={[p.designation, p.department].filter(Boolean).join(' · ') || null} onPress={() => setOpen(p)} />
          ))}
        </ListGroup>
      )}

      <Sheet visible={!!open} onClose={() => setOpen(null)} title={open?.name ?? ''}>
        {open && (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.md }}>
              <Avatar name={open.name} size={52} />
              <View style={{ flex: 1 }}>
                <Text variant="callout" style={{ fontWeight: '600' }}>{open.designation ?? 'Colleague'}</Text>
                <Text variant="footnote" tone="muted">{[open.department, open.location].filter(Boolean).join(' · ')}</Text>
              </View>
            </View>
            {open.work_email && <DetailRow label="Work email" value={open.work_email} />}
            {open.work_phone && <DetailRow label="Work phone" value={open.work_phone} last />}
            <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.lg }}>
              {open.work_phone && <Button label="Call" icon="call-outline" variant="tonal" style={{ flex: 1 }} onPress={() => void Linking.openURL(`tel:${open.work_phone}`)} />}
              {open.work_email && <Button label="Email" icon="mail-outline" variant="tonal" style={{ flex: 1 }} onPress={() => void Linking.openURL(`mailto:${open.work_email}`)} />}
            </View>
            {!open.work_email && !open.work_phone && <Text variant="footnote" tone="muted">Contact details aren’t shared in your organization’s directory.</Text>}
            {/* Only for yourself, your team, or everyone if you're HR: what the database lets you read. */}
            <ScrollView style={{ maxHeight: 340, marginTop: space.md }}>
              <DayPunches employeeId={open.id} date={todayIn(workplace?.timezone ?? 'Asia/Kolkata')} title="Today’s punches" hideWhenEmpty />
            </ScrollView>
          </>
        )}
      </Sheet>
    </Page>
  );
}
