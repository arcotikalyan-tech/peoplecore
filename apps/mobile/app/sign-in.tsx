import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { Image, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import logoMark from '../assets/logo-mark.png';
import { useSession } from '@/lib/session';
import { SITE_URL } from '@/lib/site';
import { isConfigured } from '@/lib/supabase';
import { TwoStepSetup } from '@/two-step-setup';
import { Banner, Button, Card, Field, PasswordField, space, Text, useTheme } from '@/ui';

export default function SignIn() {
  const { session, needsCode, hasAuthenticator, signIn, verifyCode, signOut, reload } = useSession();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
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
  const step = session && needsCode ? (hasAuthenticator ? 'code' : 'setup') : 'password';

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: colors.canvas }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: space.xl, paddingTop: insets.top + space.xl, gap: space.xl }} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: 'center' }}>
          <Image source={logoMark} style={{ width: 72, height: 72 }} accessibilityIgnoresInvertColors />
          <Text variant="largeTitle" accessibilityRole="header" style={{ marginTop: space.lg }}>
            People<Text style={{ color: colors.brand }}>Core</Text>
          </Text>
          <Text variant="callout" tone="muted" style={{ marginTop: space.xs, textAlign: 'center' }}>
            {step === 'password' ? 'Welcome back. Sign in to your workspace.' : 'One more step to keep your account safe.'}
          </Text>
        </View>
        {!isConfigured && <Banner tone="danger" text="This build isn’t connected to a PeopleCore server (EXPO_PUBLIC_SUPABASE_URL)." />}
        {step === 'setup' ? (
          <Card>
            <Text variant="headline" style={{ marginBottom: space.sm }}>Set up two-step sign-in</Text>
            <TwoStepSetup intro="Your organization asks everyone to use two-step sign-in: after your password, a 6-digit code from an authenticator app. Setup takes a minute."
              onDone={() => void reload()} />
            <Button label="Use another account" variant="ghost" style={{ marginTop: space.sm }} onPress={() => void signOut()} />
          </Card>
        ) : step === 'code' ? (
          <Card>
            <Text variant="headline" style={{ marginBottom: 4 }}>Two-step verification</Text>
            <Text variant="footnote" tone="muted" style={{ marginBottom: space.lg }}>Enter the 6-digit code from your authenticator app.</Text>
            <Field label="Authentication code" value={code} onChangeText={setCode} keyboardType="number-pad" autoComplete="one-time-code" maxLength={6} error={error}
              style={{ fontSize: 22, letterSpacing: 6, textAlign: 'center' }} />
            <Button label="Verify" size="lg" busy={busy} disabled={code.trim().length !== 6} onPress={() => run(() => verifyCode(code))} />
            <Button label="Use another account" variant="ghost" style={{ marginTop: space.sm }} onPress={() => void signOut()} />
          </Card>
        ) : (
          <Card>
            <Field label="Work email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" placeholder="you@company.com" />
            <PasswordField label="Password" value={password} onChangeText={setPassword} autoComplete="password" error={error} />
            <Button label="Sign in" size="lg" busy={busy} disabled={!email || !password} onPress={() => run(() => signIn(email, password))} />
            <Pressable accessibilityRole="link" onPress={() => router.push('/forgot-password')} hitSlop={8} style={{ alignItems: 'center', paddingTop: space.lg }}>
              <Text variant="callout" tone="primary" style={{ fontWeight: '600' }}>Forgot password?</Text>
            </Pressable>
          </Card>
        )}
        {step === 'password' && (
          <View style={{ alignItems: 'center', gap: space.md }}>
            <Text variant="footnote" tone="muted" style={{ textAlign: 'center' }}>First time? Open the invitation email from your company to choose a password.</Text>
            <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(`${SITE_URL}/signup`)} hitSlop={8}>
              <Text variant="footnote" tone="muted">New to PeopleCore? <Text tone="primary" style={{ fontWeight: '600' }}>Sign up</Text></Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
