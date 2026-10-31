import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { Button, ListGroup, ListRow, Page, Sheet, space, Text, useToast } from '@/ui';

/** Sign-in & security: your sign-in email, password, two-step sign-in, and signing out your other devices. */
export default function Security() {
  const { session, hasAuthenticator, twoStepRequired } = useSession();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const signOutOthers = async () => {
    setBusy(true);
    const { error } = await supabase.auth.signOut({ scope: 'others' });
    setBusy(false);
    setConfirming(false);
    toast(error ? 'That didn’t work. Try again.' : 'Signed out on your other devices.', error ? 'danger' : 'success');
  };
  return (
    <Page>
      <ListGroup title="Sign-in">
        <ListRow icon="mail-outline" tone="info" title="Email" value={session?.user.email ?? '—'} />
        <ListRow icon="key-outline" tone="warning" title="Change password" onPress={() => router.push('/change-password')} />
      </ListGroup>
      <ListGroup title="Protection" footer={twoStepRequired ? 'Your organization requires two-step sign-in for everyone.' : 'A code from an authenticator app after your password, so a leaked password alone can’t open your account.'}>
        <ListRow icon="shield-checkmark-outline" tone="success" title="Two-step sign-in" value={hasAuthenticator ? 'On' : 'Off'} onPress={() => router.push('/two-step')} />
      </ListGroup>
      <ListGroup title="Devices" footer="Signed in on a shared computer or lost a phone? Sign out everywhere except here.">
        <ListRow icon="phone-portrait-outline" tone="neutral" title="Sign out on other devices" onPress={() => setConfirming(true)} />
      </ListGroup>

      <Sheet visible={confirming} onClose={() => setConfirming(false)} title="Sign out other devices?">
        <Text variant="callout" tone="muted" style={{ marginBottom: space.lg }}>Every other browser and phone signed in to your account is signed out. This phone stays signed in.</Text>
        <View style={{ gap: space.sm }}>
          <Button label="Sign out other devices" variant="danger" busy={busy} onPress={() => void signOutOthers()} />
          <Button label="Cancel" variant="ghost" onPress={() => setConfirming(false)} />
        </View>
      </Sheet>
    </Page>
  );
}
