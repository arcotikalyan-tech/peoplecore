import { Redirect } from 'expo-router';
import { useState } from 'react';
import { Image, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { isConfigured } from '@/lib/supabase';
import logoMark from '../assets/logo-mark.png';
import { useSession } from '@/lib/session';
import { Button, Card, colors, Field, Message, PasswordField, s } from '@/ui';

/** The website, for sign-up (accounts are created by the company, so new companies ask there). */
const SITE_URL = process.env.EXPO_PUBLIC_SITE_URL ?? 'https://hrms.tazq.io';

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
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 20, gap: 16 }} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: 'center', marginBottom: 8 }}>
          <Image source={logoMark} style={{ width: 88, height: 88 }} accessibilityIgnoresInvertColors />
          <Text accessibilityRole="header" style={{ fontSize: 28, fontWeight: '700', color: colors.fg, marginTop: 12 }}>
            People<Text style={{ color: '#0a66f0' }}>Core</Text>
          </Text>
          <Text style={[s.muted, { marginTop: 4, textAlign: 'center' }]}>
            {session && needsCode ? 'One more step to keep your account safe.' : 'Welcome back. Sign in to your workspace.'}
          </Text>
        </View>
        {!isConfigured && <Message tone="danger" text="This build isn’t connected to a PeopleCore server (EXPO_PUBLIC_SUPABASE_URL)." />}
        {session && needsCode ? (
          <Card title="Two-step verification">
            <Text style={[s.muted, { marginBottom: 12 }]}>Enter the 6-digit code from your authenticator app.</Text>
            <Field label="Authentication code" value={code} onChangeText={setCode} keyboardType="number-pad" autoComplete="one-time-code" maxLength={6} error={error} />
            <Button label="Verify" busy={busy} onPress={() => run(() => verifyCode(code))} />
            <View style={{ height: 8 }} />
            <Button label="Use another account" variant="secondary" onPress={() => void signOut()} />
          </Card>
        ) : (
          <Card>
            <Field label="Work email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" placeholder="you@company.com" />
            <PasswordField label="Password" value={password} onChangeText={setPassword} autoComplete="password" error={error} />
            <Button label="Sign in" busy={busy} disabled={!email || !password} onPress={() => run(() => signIn(email, password))} />
          </Card>
        )}
        <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(`${SITE_URL}/signup`)} style={{ alignItems: 'center', paddingVertical: 8 }}>
          <Text style={s.muted}>New to PeopleCore? <Text style={{ color: colors.primary, fontWeight: '600' }}>Sign up</Text></Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
