import { useState } from 'react';
import { Linking, View } from 'react-native';
import { confirmCode, startTwoStepSetup, type Setup } from '@/lib/two-step';
import { groupKey } from '@/lib/two-step-rules';
import { Button, Field, Message, s, Text } from '@/ui';

/**
 * Setting up two-step sign-in on the phone itself: open the authenticator app with the setup link (or type the key),
 * then enter the code it shows. Used at sign-in when the organization requires it, and in Account.
 */
export function TwoStepSetup({ onDone, intro }: { onDone: () => void; intro: string }) {
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
        <Text style={[s.muted, { marginBottom: 12 }]}>{intro}</Text>
        {error && <Message tone="danger" text={error} />}
        <Button label="Set up two-step sign-in" busy={busy} onPress={() => void start()} />
      </View>
    );
  }
  return (
    <View>
      <Text style={{ fontWeight: '600', marginBottom: 4 }}>1. Add PeopleCore to your authenticator app</Text>
      <Text style={[s.muted, { marginBottom: 8 }]}>Google Authenticator, Microsoft Authenticator or any app that shows 6-digit codes.</Text>
      <Button label="Open authenticator app" variant="secondary"
        onPress={() => void Linking.openURL(setup.uri).catch(() => setError('No authenticator app opened. Install one, or type the key below into it.'))} />
      <Text style={[s.muted, { marginTop: 10 }]}>Or type this key into the app:</Text>
      <Text selectable accessibilityLabel="Setup key" style={{ fontFamily: 'monospace', fontSize: 16, letterSpacing: 1, marginVertical: 6 }}>{groupKey(setup.secret)}</Text>
      <Text style={{ fontWeight: '600', marginTop: 8, marginBottom: 4 }}>2. Enter the code it shows</Text>
      <Field label="Authentication code" value={code} onChangeText={setCode} keyboardType="number-pad" autoComplete="one-time-code" maxLength={6} error={error} />
      <Button label="Turn on two-step sign-in" busy={busy} disabled={code.trim().length !== 6} onPress={() => void confirm()} />
    </View>
  );
}
