import { todayIn } from '@peoplecore/shared/dates';
import { useState } from 'react';
import { Linking } from 'react-native';
import { TEAM_TONE, TeamFigures, teamLine, TeamRoleBanner, teamToday } from '@/components/desks';
import { loadDesks } from '@/lib/desks';
import { dateRange, days, relativeDay } from '@/lib/format';
import { useSession } from '@/lib/session';
import { SITE_URL } from '@/lib/site';
import { supabase } from '@/lib/supabase';
import { useLoad } from '@/lib/use-load';
import { Avatar, Card, EmptyState, ErrorState, ListGroup, ListRow, Page, Pill, ProgressBar, Segmented, SkeletonList, Text, type IconName, type Tone } from '@/ui';

type View = 'today' | 'away' | 'coming' | 'month';
interface Birthday { employee_id: string; name: string; next_birthday: string }

const EVENT: Record<string, [IconName, Tone]> = {
  anniversary: ['ribbon-outline', 'accent'], probation: ['document-text-outline', 'warning'], last_day: ['exit-outline', 'neutral'],
  joining: ['person-add-outline', 'info'], birthday: ['gift-outline', 'accent'],
};

/**
 * My team (managers): who is in today with their check-in, check-out, time at work and breaks; who is away in the next
 * two weeks; what is coming up (birthdays, work anniversaries, probation ends, last days, joiners, reviews to rate);
 * and the month so far. The same team as the website's dashboard: direct and indirect reports, read as the manager.
 */
export default function Team() {
  const { workplace } = useSession();
  const tz = workplace?.timezone ?? 'Asia/Kolkata';
  const today = todayIn(tz);
  const [view, setView] = useState<View>('today');
  const { data, loading, error, reload } = useLoad(async () => {
    if (!workplace) return null;
    const [desks, birthdays] = await Promise.all([
      loadDesks(workplace.orgId, workplace.slug, today),
      supabase.rpc('upcoming_birthdays', { p_org: workplace.orgId, p_days: 30 }).then((r) => (r.data ?? []) as Birthday[], () => [] as Birthday[]),
    ]);
    return { team: desks.team, birthdays };
  }, [workplace, today]);

  const team = data?.team ?? null;
  const rows = team ? teamToday(team, new Date()) : [];
  const ids = new Set(rows.map((r) => r.member.id));
  const thisYear = Number(today.slice(0, 4));
  const coming = team ? [
    ...team.events.map((e) => ({
      key: `${e.kind}-${e.employee_id}`, kind: e.kind, name: e.name, on: e.on,
      text: e.kind === 'anniversary' ? `${e.detail} year${e.detail === '1' ? '' : 's'} at work`
        : e.kind === 'probation' ? (e.on < today ? 'Probation ended: confirm or extend' : 'Probation ends')
          : e.kind === 'last_day' ? (e.detail === 'submitted' ? 'Resigned: waiting for approval' : 'Last working day')
            : e.detail ? `Joins as ${e.detail}` : 'Joins',
      urgent: e.kind === 'probation' && e.on < today,
    })),
    ...(data?.birthdays ?? []).filter((b) => ids.has(b.employee_id))
      .map((b) => ({ key: `b-${b.employee_id}`, kind: 'birthday', name: b.name, on: b.next_birthday, text: 'Birthday', urgent: false })),
  ].sort((a, b) => a.on.localeCompare(b.on) || a.name.localeCompare(b.name)) : [];
  const profile = (id: string) => workplace && void Linking.openURL(`${SITE_URL}/app/${workplace.slug}/employees/${id}?tab=attendance`);

  return (
    <Page onRefresh={reload}>
      {loading ? <SkeletonList rows={6} /> : error ? <Card><ErrorState onRetry={() => void reload()} /></Card> : !team || rows.length === 0 ? (
        team && team.reports > 0 ? <TeamRoleBanner reports={team.reports} />
          : <Card><EmptyState icon="people-outline" title="No one reports to you" body="When HR makes you someone’s reporting manager, your team shows here." /></Card>
      ) : (
        <>
          <Segmented<View> value={view} onChange={setView} options={[
            { value: 'today', label: 'Today' }, { value: 'away', label: 'Away', count: team.away.length },
            { value: 'coming', label: 'Coming up' }, { value: 'month', label: 'Month' },
          ]} />

          {view === 'today' && (
            <>
              <TeamFigures rows={rows} />
              <ListGroup title={`${rows.length} ${rows.length === 1 ? 'person' : 'people'}`} footer="Tap someone to open their attendance on the website.">
                {rows.map((r) => (
                  <ListRow key={r.member.id} leading={<Avatar name={r.member.name} size={34} />} title={r.member.name}
                    subtitle={teamLine(r, tz)} right={<Pill label={r.label} tone={TEAM_TONE[r.tone]} />} onPress={() => profile(r.member.id)} />
                ))}
              </ListGroup>
            </>
          )}

          {view === 'away' && (team.away.length === 0
            ? <Card><EmptyState icon="airplane-outline" title="Nobody away" body="No one in your team is away in the next two weeks." /></Card>
            : (
              <ListGroup title="Next two weeks">
                {team.away.map((a) => (
                  <ListRow key={`${a.employee_id}-${a.start}-${a.what}`} leading={<Avatar name={a.name} size={34} />} title={a.name}
                    subtitle={`${a.what} · ${a.start === a.end ? relativeDay(a.start, today) : dateRange(a.start, a.end, thisYear)} · ${days(Number(a.days))}`}
                    right={a.status === 'pending' ? <Pill label="Waiting" tone="warning" /> : a.start <= today ? <Pill label="Away now" tone="info" /> : undefined} />
                ))}
              </ListGroup>
            ))}

          {view === 'coming' && (
            <>
              {team.reviews.map((r) => {
                const total = r.not_started + r.to_rate + r.done;
                return (
                  <Card key={r.cycle}>
                    <Text variant="headline">{r.cycle}</Text>
                    <Text variant="footnote" tone={r.to_rate ? 'warning' : 'muted'} style={{ marginVertical: 6 }}>
                      {r.to_rate ? `${r.to_rate} self review${r.to_rate === 1 ? '' : 's'} in: yours to rate${r.manager_due ? ` by ${relativeDay(r.manager_due, today)}` : ''}` : `${r.done} of ${total} rated`}
                    </Text>
                    <ProgressBar value={total ? Math.round((r.done / total) * 100) : 0} label={`${r.cycle}: ${r.done} of ${total} rated`} />
                  </Card>
                );
              })}
              {coming.length === 0
                ? <Card><EmptyState icon="calendar-outline" title="Nothing coming up" body="No birthdays, anniversaries, probation ends or last days in the next 30 days." /></Card>
                : (
                  <ListGroup title="Next 30 days">
                    {coming.map((c) => (
                      <ListRow key={c.key} icon={EVENT[c.kind]![0]} tone={c.urgent ? 'danger' : EVENT[c.kind]![1]} title={c.name} subtitle={c.text}
                        value={relativeDay(c.on, today)} />
                    ))}
                  </ListGroup>
                )}
            </>
          )}

          {view === 'month' && (
            <ListGroup title="This month so far" footer="Present out of working days so far (weekly offs and holidays aside).">
              {team.members.map((m) => (
                <ListRow key={m.id} leading={<Avatar name={m.name} size={34} />} title={m.name}
                  subtitle={`Present ${Number(m.month.present)} of ${m.month.expected} · late ${m.month.late} · leave ${Number(m.month.leave)} · absent ${m.month.absent}`}
                  right={m.month.absent > 0 ? <Pill label={`${m.month.absent} absent`} tone="danger" /> : m.month.late > 0 ? <Pill label={`${m.month.late} late`} tone="warning" /> : undefined} />
              ))}
            </ListGroup>
          )}
        </>
      )}
    </Page>
  );
}

