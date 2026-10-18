import { Redirect } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Text } from 'react-native';
import { isConfigured } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { Button, Card, Field, Message, s, Screen } from '@/ui';

export default function SignIn() {
  const { session, needsCode, signIn, verifyCode, signOut } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (session && !needsCode) return <Redirect href="/(app)" />;
  const run = async (f: () => Promise<string | null>) => {
    setBusy(true);
    setError(await f());
    setBusy(false);
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <Screen>
        <Text accessibilityRole="header" style={{ fontSize: 26, fontWeight: '700', marginTop: 48 }}>PeopleCore</Text>
        <Text style={s.muted}>Check in, request leave and see your payslips.</Text>
        {!isConfigured && <Message tone="danger" text="This build isn’t connected to a PeopleCore server (EXPO_PUBLIC_SUPABASE_URL)." />}
        {session && needsCode ? (
          <Card title="Two-step verification">
            <Text style={[s.muted, { marginBottom: 12 }]}>Enter the 6-digit code from your authenticator app.</Text>
            <Field label="Authentication code" value={code} onChangeText={setCode} keyboardType="number-pad" autoComplete="one-time-code" maxLength={6} error={error} />
            <Button label="Verify" busy={busy} onPress={() => run(() => verifyCode(code))} />
            <Button label="Use another account" variant="secondary" onPress={() => void signOut()} />
          </Card>
        ) : (
          <Card>
            <Field label="Work email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" />
            <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" error={error} />
            <Button label="Sign in" busy={busy} disabled={!email || !password} onPress={() => run(() => signIn(email, password))} />
          </Card>
        )}
      </Screen>
    </KeyboardAvoidingView>
  );
}
