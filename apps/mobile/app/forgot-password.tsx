import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text } from 'react-native';
import { requestPasswordReset } from '@/lib/account';
import { Button, Card, colors, Field, Message, s } from '@/ui';

/** "Forgot password?": emails a link that opens the website to choose a new password. */
export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const send = async () => {
    setBusy(true);
    setResult(await requestPasswordReset(email));
    setBusy(false);
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 20, gap: 16 }} keyboardShouldPersistTaps="handled">
        <Text accessibilityRole="header" style={{ fontSize: 24, fontWeight: '700', color: colors.fg }}>Reset your password</Text>
        <Card>
          {result?.ok ? <Message tone="success" text={result.message} /> : (
            <>
              <Text style={[s.muted, { marginBottom: 12 }]}>We’ll email you a link to choose a new password. It works once and expires in an hour.</Text>
              <Field label="Work email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address"
                placeholder="you@company.com" error={result && !result.ok ? result.message : null} />
              <Button label="Email me a reset link" busy={busy} disabled={!email} onPress={() => void send()} />
            </>
          )}
        </Card>
        <Button label="Back to sign in" variant="secondary" onPress={() => router.replace('/sign-in')} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
