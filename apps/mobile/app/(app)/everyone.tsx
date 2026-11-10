import { todayIn } from '@peoplecore/shared/dates';
import { useState } from 'react';
import { Linking, ScrollView } from 'react-native';
import { DayPunches } from '@/components/day-punches';
import { TEAM_TONE, TeamFigures, teamLine, teamToday } from '@/components/desks';
import { loadOrgToday } from '@/lib/org-today';
import { useSession } from '@/lib/session';
import { SITE_URL } from '@/lib/site';
import { supabase } from '@/lib/supabase';
import { useLoad } from '@/lib/use-load';
import { Avatar, Button, Card, EmptyState, ErrorState, Field, ListGroup, ListRow, Page, Pill, Segmented, Sheet, SkeletonList, space } from '@/ui';

type View = 'all' | 'in' | 'not_in' | 'leave';
const SHOWS: Record<View, (group: string) => boolean> = {
  all: () => true,
  in: (g) => g === 'in' || g === 'out',
  not_in: (g) => g === 'not_in' || g === 'absent',
  leave: (g) => g === 'leave',
};

/**
 * Everyone today (owners and HR, who read the whole organization's attendance): each person's status from today's
 * punches, leave and requests, with check-in, check-out, time at work and breaks; a tap shows the day's punches with
 * photos and location. The same rows as My team, for the whole organization.
 */
export default function Everyone() {
  const { workplace } = useSession();
  const tz = workplace?.timezone ?? 'Asia/Kolkata';
  const today = todayIn(tz);
  const [view, setView] = useState<View>('all');
  const [query, setQuery] = useState('');
  const [person, setPerson] = useState<{ id: string; name: string } | null>(null);
  const { data, loading, error, reload } = useLoad(async () => {
    if (!workplace) return null;
    const people = await supabase.rpc('my_org_context', { p_slug: workplace.slug })
      .then((r) => ((r.data as { grants?: Array<{ permission_key: string; scope: string }> } | null)?.grants ?? []).some((g) => g.permission_key === 'employee.read' && g.scope === 'org'));
    return loadOrgToday(workplace.orgId, workplace.employeeId ?? null, today, people);
  }, [workplace, today]);

  const rows = data ? teamToday({ reports: 0, members: data.members, away: [], events: [], reviews: [] }, new Date()) : [];
  const count = (v: View) => rows.filter((r) => SHOWS[v](r.group)).length;
  const words = query.trim().toLowerCase();
  const shown = rows.filter((r) => SHOWS[view](r.group)
    && (!words || `${r.member.name} ${r.member.code} ${r.member.title ?? ''}`.toLowerCase().includes(words)));
  const profile = (id: string) => workplace && void Linking.openURL(`${SITE_URL}/app/${workplace.slug}/employees/${id}?tab=attendance`);

  return (
    <Page onRefresh={reload}>
      {loading ? <SkeletonList rows={6} /> : error ? <Card><ErrorState onRetry={() => void reload()} /></Card> : rows.length === 0 ? (
        <Card><EmptyState icon="people-outline" title="No one to show yet" body="Add employees on the website, and each person’s day shows here." /></Card>
      ) : (
        <>
          <TeamFigures rows={rows} />
          <Segmented<View> value={view} onChange={setView} options={[
            { value: 'all', label: 'All', count: rows.length }, { value: 'in', label: 'In', count: count('in') },
            { value: 'not_in', label: 'Not in', count: count('not_in') }, { value: 'leave', label: 'Leave', count: count('leave') },
          ]} />
          {rows.length > 8 && (
            <Field label="Search" placeholder="Name, employee code or title" value={query} onChangeText={setQuery} autoCorrect={false} returnKeyType="search" />
          )}
          {shown.length === 0
            ? <Card><EmptyState compact icon="search-outline" title="No one here" body={words ? 'No one matches that search.' : 'No one is in this group right now.'} /></Card>
            : (
              <ListGroup title={`${shown.length} ${shown.length === 1 ? 'person' : 'people'}`} footer="Tap someone for today’s punches, with photos and location.">
                {shown.map((r) => (
                  <ListRow key={r.member.id} leading={<Avatar name={r.member.name} size={34} />} title={r.member.name}
                    subtitle={teamLine(r, tz)} right={<Pill label={r.label} tone={TEAM_TONE[r.tone]} />} onPress={() => setPerson({ id: r.member.id, name: r.member.name })} />
                ))}
              </ListGroup>
            )}
        </>
      )}

      <Sheet visible={!!person} onClose={() => setPerson(null)} title={person?.name ?? ''}>
        {person && (
          <>
            <ScrollView style={{ maxHeight: 460 }}>
              <DayPunches employeeId={person.id} date={today} title="Today’s punches" />
            </ScrollView>
            <Button label="Full attendance on the website" variant="ghost" size="sm" style={{ marginTop: space.md }} onPress={() => profile(person.id)} />
          </>
        )}
      </Sheet>
    </Page>
  );
}
