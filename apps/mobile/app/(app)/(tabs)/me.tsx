import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, View } from 'react-native';
import { loadProfile } from '@/lib/profile';
import { pushState, pushSupported } from '@/lib/push';
import { useSession } from '@/lib/session';
import { SITE_URL } from '@/lib/site';
import { useLoad } from '@/lib/use-load';
import { appVersion } from '@/lib/version';
import { Avatar, Button, Card, ListGroup, ListRow, Page, Sheet, space, TabHeader, Text, useTheme } from '@/ui';

const APPEARANCE = { system: 'Automatic', light: 'Light', dark: 'Dark' } as const;

/**
 * Me: who you are (opens your profile), your things (payslips, holidays, directory, announcements), your
 * organizations, settings, help, and signing out (asked first).
 */
export default function Me() {
  const { workplace, workplaces, hasAuthenticator, signOut, session } = useSession();
  const { appearance } = useTheme();
  const [confirming, setConfirming] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const off = new Set(workplace?.off ?? []);
  const emp = workplace?.employeeId;

  const { data, reload } = useLoad(async () => ({
    profile: workplace && emp ? await loadProfile(workplace.orgId, emp).catch(() => null) : null,
    push: pushSupported ? await pushState() : null,
  }), [workplace, emp]);
  const p = data?.profile;

  return (
    <Page tab onRefresh={reload} header={<TabHeader title="Me" />}>
      <Card onPress={() => router.push('/profile')} accessibilityLabel="My profile">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.lg }}>
          <Avatar name={workplace?.employeeName ?? session?.user.email} size={60} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text variant="title3" numberOfLines={1}>{workplace?.employeeName ?? session?.user.email ?? 'You'}</Text>
            <Text variant="footnote" tone="muted" numberOfLines={1}>{[p?.designation, p?.department].filter(Boolean).join(' · ') || session?.user.email}</Text>
            <Text variant="caption" tone="faint" numberOfLines={1}>{[p?.code, workplace?.orgName].filter(Boolean).join(' · ')}</Text>
          </View>
          <Text variant="footnote" tone="primary" style={{ fontWeight: '600' }}>View</Text>
        </View>
      </Card>

      <ListGroup title="My work">
        {emp && !off.has('payroll') && <ListRow icon="wallet-outline" tone="success" title="Payslips" onPress={() => router.push('/payslips')} />}
        {emp && !off.has('attendance') && <ListRow icon="document-text-outline" tone="warning" title="Attendance requests" subtitle="Correct a day, work from home, on duty" onPress={() => router.push('/attendance-request')} />}
        {!off.has('holidays') && <ListRow icon="sunny-outline" tone="accent" title="Holidays" onPress={() => router.push('/holidays')} />}
        <ListRow icon="people-outline" tone="info" title="Directory" onPress={() => router.push('/directory')} />
        {!off.has('engagement') && <ListRow icon="megaphone-outline" tone="danger" title="Announcements" onPress={() => router.push('/announcements')} />}
      </ListGroup>

      {workplaces.length > 1 && (
        <ListGroup title="Organization">
          <ListRow icon="business-outline" tone="primary" title="Switch organization" value={workplace?.orgName} onPress={() => router.push('/organizations')} />
        </ListGroup>
      )}

      <ListGroup title="Settings">
        <ListRow icon="shield-checkmark-outline" tone="success" title="Sign-in & security" value={hasAuthenticator ? 'Two-step on' : 'Two-step off'} onPress={() => router.push('/security')} />
        {pushSupported && <ListRow icon="notifications-outline" tone="danger" title="Notifications" value={data?.push === 'on' ? 'On' : data?.push ? 'Off' : null} onPress={() => router.push('/notification-settings')} />}
        <ListRow icon="contrast-outline" tone="neutral" title="Appearance" value={APPEARANCE[appearance]} onPress={() => router.push('/appearance')} />
      </ListGroup>

      <ListGroup title="Help">
        <ListRow icon="globe-outline" tone="info" title="Open PeopleCore on the web" subtitle="Everything else: expenses, helpdesk, documents and more" external
          onPress={() => void Linking.openURL(workplace ? `${SITE_URL}/app/${workplace.slug}` : SITE_URL)} />
        <ListRow icon="information-circle-outline" tone="neutral" title="About PeopleCore" onPress={() => router.push('/about')} />
      </ListGroup>

      <ListGroup>
        <ListRow icon="log-out-outline" title="Sign out" destructive onPress={() => setConfirming(true)} />
      </ListGroup>
      <Text variant="caption" tone="faint" style={{ textAlign: 'center' }}>{appVersion()}</Text>

      <Sheet visible={confirming} onClose={() => setConfirming(false)} title="Sign out?">
        <Text variant="callout" tone="muted" style={{ marginBottom: space.lg }}>
          You’ll need your password to sign in again. Punches not sent yet stay on this phone and are sent the next time you sign in.
        </Text>
        <View style={{ gap: space.sm }}>
          <Button label="Sign out" variant="danger" busy={leaving} onPress={() => { setLeaving(true); void signOut().finally(() => setLeaving(false)); }} />
          <Button label="Cancel" variant="ghost" onPress={() => setConfirming(false)} />
        </View>
      </Sheet>
    </Page>
  );
}
