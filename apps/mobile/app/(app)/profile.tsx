import Ionicons from '@expo/vector-icons/Ionicons';
import { Linking, View } from 'react-native';
import { longDate } from '@/lib/calendar';
import { loadCompleteness, loadProfile, PROFILE_PARTS } from '@/lib/profile';
import { useSession } from '@/lib/session';
import { SITE_URL } from '@/lib/site';
import { useLoad } from '@/lib/use-load';
import { Avatar, Button, Card, EmptyState, ErrorState, ListGroup, ListRow, Page, Pill, ProgressBar, SkeletonList, space, Text, useTheme } from '@/ui';

const TYPE: Record<string, string> = { permanent: 'Permanent', contract: 'Contract', intern: 'Intern', temporary: 'Temporary', consultant: 'Consultant' };
const STATUS: Record<string, string> = { pre_joining: 'Joining soon', active: 'Active', on_notice: 'On notice', exited: 'Exited' };

/** Your employee profile: work details, contact, and what HR still needs from you (filled in on the website). */
export default function Profile() {
  const { workplace, session } = useSession();
  const { colors } = useTheme();
  const emp = workplace?.employeeId;
  const { data, loading, error, reload } = useLoad(async () => {
    if (!workplace || !emp) return null;
    const [profile, completeness] = await Promise.all([loadProfile(workplace.orgId, emp), loadCompleteness(workplace.orgId).catch(() => null)]);
    return { profile, completeness };
  }, [workplace, emp]);
  const p = data?.profile;
  const done = data?.completeness ? PROFILE_PARTS.filter((x) => data.completeness![x.key]).length : 0;
  const edit = () => workplace && emp && void Linking.openURL(`${SITE_URL}/app/${workplace.slug}/employees/${emp}?tab=personal`);

  if (!emp) {
    return (
      <Page>
        <Card><EmptyState icon="id-card-outline" title="No employee profile yet" body={`You’re signed in as ${session?.user.email ?? 'yourself'}. HR links your sign-in to your employee record.`} /></Card>
      </Page>
    );
  }
  return (
    <Page onRefresh={reload}>
      {loading ? <SkeletonList rows={5} /> : error || !p ? <Card><ErrorState onRetry={() => void reload()} /></Card> : (
        <>
          <View style={{ alignItems: 'center', gap: space.xs, paddingVertical: space.md }}>
            <Avatar name={p.name} size={84} />
            <Text variant="title" style={{ marginTop: space.sm, textAlign: 'center' }}>{p.name}</Text>
            <Text variant="callout" tone="muted" style={{ textAlign: 'center' }}>{[p.designation, p.department].filter(Boolean).join(' · ') || 'Employee'}</Text>
            <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.xs }}>
              <Pill label={p.code} tone="neutral" />
              <Pill label={STATUS[p.status] ?? p.status} tone={p.status === 'active' ? 'success' : 'warning'} />
            </View>
          </View>

          {data?.completeness && (
            <Card>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: space.sm }}>
                <Text variant="headline">Profile</Text>
                <Text variant="headline" tone={done === PROFILE_PARTS.length ? 'success' : 'warning'}>{done} of {PROFILE_PARTS.length}</Text>
              </View>
              <ProgressBar value={(done / PROFILE_PARTS.length) * 100} tone={done === PROFILE_PARTS.length ? 'success' : 'warning'} label="Profile completeness" />
              <View style={{ marginTop: space.md, gap: space.sm }}>
                {PROFILE_PARTS.map((x) => {
                  const ok = data.completeness![x.key];
                  return (
                    <View key={x.key} accessible accessibilityLabel={`${x.label}: ${ok ? 'filled in' : 'missing'}`} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                      <Ionicons name={ok ? 'checkmark-circle' : 'ellipse-outline'} size={18} color={ok ? colors.success : colors.faint} />
                      <Text variant="callout" style={{ flex: 1 }}>{x.label}</Text>
                      {!ok && <Text variant="caption" tone="warning" style={{ fontWeight: '600' }}>Missing</Text>}
                    </View>
                  );
                })}
              </View>
              {done < PROFILE_PARTS.length && (
                <Button label="Complete on the website" variant="tonal" icon="open-outline" size="sm" style={{ marginTop: space.lg }} onPress={edit} />
              )}
            </Card>
          )}

          <ListGroup title="Work">
            <ListRow icon="id-card-outline" title="Employee ID" value={p.code} />
            {p.designation && <ListRow icon="briefcase-outline" title="Designation" value={p.designation} />}
            {p.department && <ListRow icon="layers-outline" title="Department" value={p.department} />}
            {p.manager && <ListRow icon="person-outline" title="Reports to" value={p.manager} />}
            {p.location && <ListRow icon="location-outline" title="Office" value={p.location} />}
            <ListRow icon="calendar-outline" title="Joined" value={longDate(p.joinedOn)} />
            <ListRow icon="ribbon-outline" title="Employment" value={TYPE[p.employmentType] ?? p.employmentType} />
          </ListGroup>

          <ListGroup title="Contact" footer="To change your details, edit your profile on the website; some changes need HR’s approval.">
            <ListRow icon="mail-outline" tone="info" title="Work email" value={p.workEmail ?? '—'} onPress={p.workEmail ? () => void Linking.openURL(`mailto:${p.workEmail}`) : undefined} />
            {p.workPhone && <ListRow icon="call-outline" tone="info" title="Work phone" value={p.workPhone} />}
            <ListRow icon="log-in-outline" tone="info" title="Sign-in email" value={session?.user.email ?? '—'} />
          </ListGroup>
          <Button label="Edit profile on the website" variant="outline" icon="open-outline" onPress={edit} />
        </>
      )}
    </Page>
  );
}
