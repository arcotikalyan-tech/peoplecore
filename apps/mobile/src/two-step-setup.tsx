import { useState } from 'react';
import { Linking, View } from 'react-native';
import { confirmCode, startTwoStepSetup, type Setup } from '@/lib/two-step';
import { groupKey } from '@/lib/two-step-rules';
import { Banner, Button, Field, radius, space, Text, useTheme } from '@/ui';

/**
 * Setting up two-step sign-in on the phone itself: open the authenticator app with the setup link (or type the key),
 * then enter the code it shows. Used at sign-in when the organization requires it, and in Sign-in & security.
 */
export function TwoStepSetup({ onDone, intro }: { onDone: () => void; intro: string }) {
  const { colors } = useTheme();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setBusy(true);
    setError(null);
    const r = await startTwoStepSetup();
    if ('error' in r) setError(r.error);
    else setSetup(r);
    setBusy(false);
  };
  const confirm = async () => {
    if (!setup) return;
    setBusy(true);
    const problem = await confirmCode(setup.factorId, code);
    setBusy(false);
    if (problem) setError(problem);
    else onDone();
  };

  if (!setup) {
    return (
      <View>
        <Text variant="callout" tone="muted" style={{ marginBottom: space.lg }}>{intro}</Text>
        {error && <Banner tone="danger" text={error} style={{ marginBottom: space.md }} />}
        <Button label="Set up two-step sign-in" busy={busy} onPress={() => void start()} />
      </View>
    );
  }
  return (
    <View>
      <Text variant="callout" style={{ fontWeight: '600', marginBottom: 4 }}>1. Add PeopleCore to your authenticator app</Text>
      <Text variant="footnote" tone="muted" style={{ marginBottom: space.md }}>Google Authenticator, Microsoft Authenticator or any app that shows 6-digit codes.</Text>
      <Button label="Open authenticator app" variant="tonal" icon="open-outline"
        onPress={() => void Linking.openURL(setup.uri).catch(() => setError('No authenticator app opened. Install one, or type the key below into it.'))} />
      <Text variant="footnote" tone="muted" style={{ marginTop: space.md }}>Or type this key into the app:</Text>
      <View style={{ backgroundColor: colors.subtle, borderRadius: radius.md, padding: space.md, marginVertical: space.sm }}>
        <Text selectable accessibilityLabel="Setup key" style={{ fontFamily: 'monospace', fontSize: 16, letterSpacing: 1, textAlign: 'center' }}>{groupKey(setup.secret)}</Text>
      </View>
      <Text variant="callout" style={{ fontWeight: '600', marginTop: space.md, marginBottom: space.sm }}>2. Enter the code it shows</Text>
      <Field label="Authentication code" value={code} onChangeText={setCode} keyboardType="number-pad" autoComplete="one-time-code" maxLength={6} error={error} />
      <Button label="Turn on two-step sign-in" busy={busy} disabled={code.trim().length !== 6} onPress={() => void confirm()} />
    </View>
  );
}
