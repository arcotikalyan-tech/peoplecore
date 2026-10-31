import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator } from 'react-native';
import { useSession } from '@/lib/session';
import { Avatar, ListGroup, ListRow, Page, useTheme, useToast } from '@/ui';

/** For people in more than one organization: the app shows one at a time, remembered on this phone. */
export default function Organizations() {
  const { workplace, workplaces, switchWorkplace } = useSession();
  const { colors } = useTheme();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <Page>
      <ListGroup footer="The app shows one organization at a time. Notifications from the others still arrive, and open their organization.">
        {workplaces.map((o) => {
          const current = o.id === workplace?.orgId;
          return (
            <ListRow key={o.id} leading={<Avatar name={o.name} size={36} />} title={o.name} subtitle={current ? 'Open now' : null}
              accessibilityLabel={current ? `${o.name}, open now` : `Switch to ${o.name}`}
              right={busy === o.id ? <ActivityIndicator color={colors.primary} /> : current ? <Ionicons name="checkmark-circle" size={22} color={colors.primary} /> : undefined}
              onPress={current ? undefined : () => {
                setBusy(o.id);
                void switchWorkplace(o.id).then(() => { toast(`Switched to ${o.name}.`); router.navigate('/'); }).finally(() => setBusy(null));
              }} />
          );
        })}
      </ListGroup>
    </Page>
  );
}
