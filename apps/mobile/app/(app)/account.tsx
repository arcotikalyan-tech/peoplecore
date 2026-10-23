import { PASSWORD_HINT } from '@peoplecore/shared/password';
import { useCallback, useEffect, useState } from 'react';
import { Linking, RefreshControl, ScrollView, Text, View } from 'react-native';
import { changePassword, type FieldErrors } from '@/lib/account';
import { openPhoneSettings, pushState, pushSupported, turnOffPush, turnOnPush, type PushState } from '@/lib/push';
import { useSession } from '@/lib/session';
import { SITE_URL } from '@/lib/site';
import { supabase } from '@/lib/supabase';
import { turnOffTwoStep } from '@/lib/two-step';
import { appVersion } from '@/lib/version';
import { TwoStepSetup } from '@/two-step-setup';
import { Button, Card, colors, Message, PasswordField, s, Screen } from '@/ui';

type Completeness = Record<'personal' | 'blood_group' | 'address' | 'emergency' | 'identity' | 'bank', boolean>;

const PROFILE: Array<{ key: keyof Completeness; label: string }> = [
  { key: 'personal', label: 'Personal details' }, { key: 'blood_group', label: 'Blood group' }, { key: 'address', label: 'Address' },
  { key: 'emergency', label: 'Emergency contact' }, { key: 'identity', label: 'PAN' }, { key: 'bank', label: 'Bank account' },
];

/**
 * Account settings on the phone (the website's Account settings): who you are and how complete your profile is,
 * your password, two-step sign-in, and signing out.
 */
export default function Account() {
  const { session, workplace, hasAuthenticator, twoStepRequired, reload, signOut } = useSession();
  const email = session?.user.email ?? '';
  const [profile, setProfile] = useState<Completeness | null>(null);
  const [form, setForm] = useState({ current: '', password: '', confirm: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<{ tone: 'danger' | 'success' | 'muted'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  const [push, setPush] = useState<PushState | null>(null);

  const load = useCallback(async () => {
    setPush(await pushState());
    if (!workplace?.employeeId) return setProfile(null);
    const { data } = await supabase.rpc('my_profile_completeness', { p_org: workplace.orgId });
    setProfile((data as Completeness | null) ?? null);
  }, [workplace]);
  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    setBusy('password');
    const r = await changePassword(email, form.current, form.password, form.confirm);
    setBusy(null);
    setErrors(r.fields ?? {});
    setMessage({ tone: r.ok ? 'success' : 'danger', text: r.message });
    if (r.ok) setForm({ current: '', password: '', confirm: '' });
  };
  const turnOff = async () => {
    setBusy('two-step');
    const problem = await turnOffTwoStep();
    setBusy(null);
    setConfirmOff(false);
    setMessage(problem ? { tone: 'danger', text: problem } : { tone: 'success', text: 'Two-step sign-in is off. Your password alone opens your account.' });
    await reload();
  };
  const signOutOthers = async () => {
    setBusy('others');
    const { error } = await supabase.auth.signOut({ scope: 'others' });
    setBusy(null);
    setMessage(error ? { tone: 'danger', text: 'That didn’t work. Try again.' } : { tone: 'success', text: 'Signed out on your other devices.' });
  };
  const switchPush = async (on: boolean) => {
    setBusy('push');
    if (on) setPush(await turnOnPush());
    else {
      await turnOffPush();
      setPush('off');
    }
    setBusy(null);
  };
  const done = profile ? PROFILE.filter((p) => profile[p.key]).length : 0;
  const web = (path: string) => void Linking.openURL(`${SITE_URL}${path}`);

  return (
    <ScrollView keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={false} onRefresh={() => void load()} />}>
      <Screen>
        <Card title="Account">
          <View style={s.row}><Text style={s.muted}>Name</Text><Text>{workplace?.employeeName ?? '—'}</Text></View>
          <View style={s.row}><Text style={s.muted}>Sign-in email</Text><Text selectable>{email}</Text></View>
          <View style={[s.row, { borderBottomWidth: 0 }]}><Text style={s.muted}>Organization</Text><Text>{workplace?.orgName ?? '—'}</Text></View>
          {!workplace?.employeeId && <Text style={[s.muted, { marginTop: 8 }]}>Your sign-in isn’t linked to an employee profile yet. HR links it, after which you can punch in, apply for leave and see your pay.</Text>}
        </Card>

        {profile && workplace?.employeeId && (
          <Card title={`Your profile · ${done} of ${PROFILE.length}`}>
            <Text style={[s.muted, { marginBottom: 6 }]}>HR and payroll need these to pay you and reach you in an emergency.</Text>
            {PROFILE.map((p) => (
              <View key={p.key} style={s.row} accessibilityLabel={`${p.label}: ${profile[p.key] ? 'filled in' : 'missing'}`}>
                <Text>{p.label}</Text>
                <Text style={{ color: profile[p.key] ? colors.success : colors.warning }}>{profile[p.key] ? '✓ Done' : 'Missing'}</Text>
              </View>
            ))}
            {done < PROFILE.length && <View style={{ marginTop: 10 }}><Button label="Complete on the website" variant="secondary"
              onPress={() => web(`/app/${workplace.slug}/employees/${workplace.employeeId}?tab=personal`)} /></View>}
          </Card>
        )}

        {message && <Message tone={message.tone} text={message.text} />}

        <Card title="Password">
          <PasswordField label="Current password" value={form.current} onChangeText={(v) => setForm({ ...form, current: v })} autoComplete="current-password" error={errors.current} />
          <PasswordField label="New password" value={form.password} onChangeText={(v) => setForm({ ...form, password: v })} autoComplete="new-password" error={errors.password} />
          <Text style={[s.muted, { marginTop: -8, marginBottom: 10 }]}>{PASSWORD_HINT}</Text>
          <PasswordField label="Confirm new password" value={form.confirm} onChangeText={(v) => setForm({ ...form, confirm: v })} autoComplete="new-password" error={errors.confirm} />
          <Button label="Change password" busy={busy === 'password'} onPress={() => void save()} />
        </Card>

        <Card title={`Two-step sign-in · ${hasAuthenticator ? 'On' : 'Off'}`}>
          {hasAuthenticator ? (
            <>
              <Text style={{ marginBottom: 8 }}>✓ Your sign-in asks for a code from your authenticator app.</Text>
              {twoStepRequired ? <Text style={s.muted}>Your organization requires it for everyone.</Text>
                : confirmOff ? (
                  <>
                    <Text style={[s.muted, { marginBottom: 8 }]}>Your password alone will open your account.</Text>
                    <Button label="Yes, turn it off" busy={busy === 'two-step'} onPress={() => void turnOff()} />
                    <View style={{ height: 8 }} />
                    <Button label="Keep it on" variant="secondary" onPress={() => setConfirmOff(false)} />
                  </>
                ) : <Button label="Turn off" variant="secondary" onPress={() => setConfirmOff(true)} />}
            </>
          ) : (
            <TwoStepSetup intro="Add a code from an authenticator app, so a leaked password alone can’t open your account."
              onDone={() => { setMessage({ tone: 'success', text: 'Two-step sign-in is on.' }); void reload(); }} />
          )}
        </Card>

        {pushSupported && push && (
          <Card title={`Notifications on this phone · ${push === 'on' ? 'On' : 'Off'}`}>
            {push === 'on' ? (
              <>
                <Text style={{ marginBottom: 8 }}>✓ Approvals, decisions on your requests and payslips arrive as notifications.</Text>
                <Button label="Turn off" variant="secondary" busy={busy === 'push'} onPress={() => void switchPush(false)} />
              </>
            ) : push === 'blocked' ? (
              <>
                <Text style={[s.muted, { marginBottom: 8 }]}>Notifications for PeopleCore are blocked in your phone’s settings.</Text>
                <Button label="Open phone settings" variant="secondary" onPress={openPhoneSettings} />
              </>
            ) : push === 'unavailable' ? (
              <Text style={s.muted}>This version of the app can’t receive notifications yet. Everything still appears in your Inbox.</Text>
            ) : (
              <>
                <Text style={[s.muted, { marginBottom: 8 }]}>Get approvals, decisions on your requests and payslips as notifications. Everything also appears in your Inbox.</Text>
                <Button label="Turn on" busy={busy === 'push'} onPress={() => void switchPush(true)} />
              </>
            )}
          </Card>
        )}

        <Card title="Signed-in devices">
          <Text style={[s.muted, { marginBottom: 10 }]}>Signed in on a shared computer or lost a phone? Sign out everywhere except here.</Text>
          <Button label="Sign out on other devices" variant="secondary" busy={busy === 'others'} onPress={() => void signOutOthers()} />
        </Card>

        <Button label="Sign out" variant="secondary" onPress={() => void signOut()} />
        <Text style={[s.muted, { textAlign: 'center', marginTop: 12, fontSize: 12 }]}>{appVersion()}</Text>
      </Screen>
    </ScrollView>
  );
}
