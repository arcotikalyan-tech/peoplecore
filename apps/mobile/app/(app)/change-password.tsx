import { PASSWORD_HINT } from '@peoplecore/shared/password';
import { router } from 'expo-router';
import { useState } from 'react';
import { changePassword, type FieldErrors } from '@/lib/account';
import { useSession } from '@/lib/session';
import { Banner, Button, Page, PasswordField, useToast } from '@/ui';

/** Changing your password: the current one first; other devices are signed out afterwards. */
export default function ChangePassword() {
  const { session } = useSession();
  const toast = useToast();
  const [form, setForm] = useState({ current: '', password: '', confirm: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const r = await changePassword(session?.user.email ?? '', form.current, form.password, form.confirm);
    setBusy(false);
    setErrors(r.fields ?? {});
    if (!r.ok) return setProblem(r.message);
    toast(r.message);
    if (router.canGoBack()) router.back();
    else router.replace('/security');
  };
  return (
    <Page keyboard>
      <PasswordField label="Current password" value={form.current} onChangeText={(v) => setForm({ ...form, current: v })} autoComplete="current-password" error={errors.current} />
      <PasswordField label="New password" value={form.password} onChangeText={(v) => setForm({ ...form, password: v })} autoComplete="new-password" error={errors.password} hint={PASSWORD_HINT} />
      <PasswordField label="Confirm new password" value={form.confirm} onChangeText={(v) => setForm({ ...form, confirm: v })} autoComplete="new-password" error={errors.confirm} />
      {problem && <Banner tone="danger" text={problem} />}
      <Button label="Change password" size="lg" busy={busy} disabled={!form.current || !form.password || !form.confirm} onPress={() => void save()} />
    </Page>
  );
}
