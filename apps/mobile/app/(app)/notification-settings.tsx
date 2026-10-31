import { useState } from 'react';
import { Linking, Switch } from 'react-native';
import { openPhoneSettings, pushState, pushSupported, turnOffPush, turnOnPush } from '@/lib/push';
import { useSession } from '@/lib/session';
import { SITE_URL } from '@/lib/site';
import { useLoad } from '@/lib/use-load';
import { Banner, ListGroup, ListRow, Page, useTheme } from '@/ui';

/** Push notifications on this phone; which kinds of email you get are chosen on the website. */
export default function NotificationSettings() {
  const { workplace } = useSession();
  const { colors } = useTheme();
  const [busy, setBusy] = useState(false);
  const { data: state, reload } = useLoad(() => pushState(), []);
  const flip = async (on: boolean) => {
    setBusy(true);
    if (on) await turnOnPush();
    else await turnOffPush();
    await reload();
    setBusy(false);
  };
  return (
    <Page>
      {!pushSupported || state === 'unavailable' ? (
        <Banner tone="info" text="This version of the app can’t receive notifications. Everything still appears in your Inbox." />
      ) : state === 'blocked' ? (
        <>
          <Banner tone="warning" title="Blocked in your phone’s settings" text="Allow notifications for PeopleCore in Settings, then come back." />
          <ListGroup><ListRow icon="settings-outline" title="Open phone settings" onPress={openPhoneSettings} /></ListGroup>
        </>
      ) : (
        <ListGroup footer="Approvals, decisions on your requests, payslips and announcements arrive as notifications. Everything also appears in your Inbox.">
          <ListRow icon="notifications-outline" tone="danger" title="Push notifications" subtitle="On this phone"
            right={<Switch value={state === 'on'} disabled={busy || state === undefined} onValueChange={(v) => void flip(v)} accessibilityLabel="Push notifications"
              trackColor={{ true: colors.primary, false: colors.lineStrong }} thumbColor="#fff" />} />
        </ListGroup>
      )}
      <ListGroup footer="Choose which emails you get, by kind, on the website.">
        <ListRow icon="mail-outline" tone="info" title="Email preferences" external
          onPress={() => void Linking.openURL(workplace ? `${SITE_URL}/app/${workplace.slug}/preferences` : SITE_URL)} />
      </ListGroup>
    </Page>
  );
}
