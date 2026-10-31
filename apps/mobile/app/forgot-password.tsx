import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { requestPasswordReset } from '@/lib/account';
import { Banner, Button, Card, Field, space, Text, useTheme } from '@/ui';

/** "Forgot password?": emails a link that opens the website to choose a new password. */
export default function ForgotPassword() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const send = async () => {
    setBusy(true);
    setResult(await requestPasswordReset(email));
    setBusy(false);
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: colors.canvas }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: space.xl, paddingTop: insets.top + space.xl, gap: space.lg }} keyboardShouldPersistTaps="handled">
        <Text variant="title" accessibilityRole="header">Reset your password</Text>
        <Card>
          {result?.ok ? <Banner tone="success" text={result.message} /> : (
            <>
              <Text variant="footnote" tone="muted" style={{ marginBottom: space.lg }}>We’ll email you a link to choose a new password. It works once and expires in an hour.</Text>
              <Field label="Work email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address"
                placeholder="you@company.com" error={result && !result.ok ? result.message : null} />
              <Button label="Email me a reset link" size="lg" busy={busy} disabled={!email} onPress={() => void send()} />
            </>
          )}
        </Card>
        <Button label="Back to sign in" variant="ghost" icon="arrow-back" onPress={() => router.replace('/sign-in')} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
