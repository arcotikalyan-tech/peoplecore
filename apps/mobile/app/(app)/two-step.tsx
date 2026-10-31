import { useState } from 'react';
import { View } from 'react-native';
import { useSession } from '@/lib/session';
import { turnOffTwoStep } from '@/lib/two-step';
import { TwoStepSetup } from '@/two-step-setup';
import { Banner, Button, Card, IconTile, Page, Sheet, space, Text, useToast } from '@/ui';

/** Two-step sign-in for yourself: set it up here with an authenticator app, or turn it off (unless required). */
export default function TwoStep() {
  const { hasAuthenticator, twoStepRequired, reload } = useSession();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const turnOff = async () => {
    setBusy(true);
    const p = await turnOffTwoStep();
    setBusy(false);
    setConfirming(false);
    if (p) return setProblem(p);
    toast('Two-step sign-in is off.');
    await reload();
  };
  return (
    <Page keyboard>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.md }}>
          <IconTile icon={hasAuthenticator ? 'shield-checkmark' : 'shield-outline'} tone={hasAuthenticator ? 'success' : 'neutral'} size={44} />
          <View style={{ flex: 1 }}>
            <Text variant="headline">{hasAuthenticator ? 'Two-step sign-in is on' : 'Two-step sign-in is off'}</Text>
            <Text variant="footnote" tone="muted">{hasAuthenticator ? 'Signing in asks for a code from your authenticator app.' : 'Your password alone opens your account.'}</Text>
          </View>
        </View>
        {hasAuthenticator ? (
          twoStepRequired
            ? <Banner tone="info" text="Your organization requires it for everyone, so it can’t be turned off." />
            : <Button label="Turn off" variant="outline" onPress={() => setConfirming(true)} />
        ) : (
          <TwoStepSetup intro="Add a code from an authenticator app, so a leaked password alone can’t open your account."
            onDone={() => { toast('Two-step sign-in is on.'); void reload(); }} />
        )}
        {problem && <Banner tone="danger" text={problem} style={{ marginTop: space.md }} />}
      </Card>
      <Sheet visible={confirming} onClose={() => setConfirming(false)} title="Turn off two-step sign-in?">
        <Text variant="callout" tone="muted" style={{ marginBottom: space.lg }}>Your password alone will open your account.</Text>
        <View style={{ gap: space.sm }}>
          <Button label="Turn off" variant="danger" busy={busy} onPress={() => void turnOff()} />
          <Button label="Keep it on" variant="ghost" onPress={() => setConfirming(false)} />
        </View>
      </Sheet>
    </Page>
  );
}
