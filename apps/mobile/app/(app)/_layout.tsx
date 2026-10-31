import * as Notifications from 'expo-notifications';
import { Redirect, router, Stack } from 'expo-router';
import { useEffect } from 'react';
import { CountsProvider } from '@/lib/counts';
import { pushSupported, syncPush } from '@/lib/push';
import { screenFor } from '@/lib/push-links';
import { useSession } from '@/lib/session';
import { TodayProvider } from '@/lib/today';
import { useTheme } from '@/ui';

/**
 * The signed-in app: five tabs, and the screens they open on top with a back button (forms rise as sheets on iOS).
 */
export default function AppLayout() {
  const { loading, session, needsCode, workplace, switchWorkplace } = useSession();
  const { colors } = useTheme();
  const ready = !loading && !!session && !needsCode;
  const userId = session?.user.id;

  // Signed in: register this phone for notifications (asks the first time), and again whenever its token changes.
  useEffect(() => {
    if (!ready || !pushSupported) return;
    void syncPush();
    const sub = Notifications.addPushTokenListener((t) => void syncPush(String(t.data)));
    return () => sub.remove();
  }, [ready, userId]);

  // A tapped notification opens its screen, also when the tap started the app (handled once).
  useEffect(() => {
    if (!ready || !pushSupported) return;
    const open = async (r: Notifications.NotificationResponse | null) => {
      if (!r) return;
      Notifications.clearLastNotificationResponse(); // first, so switching organization below doesn't open it twice
      const data = r.notification.request.content.data;
      if (typeof data?.org === 'string' && data.org !== workplace?.slug) await switchWorkplace(data.org);
      router.navigate(screenFor(data?.link));
    };
    void open(Notifications.getLastNotificationResponse());
    const sub = Notifications.addNotificationResponseReceivedListener((r) => void open(r));
    return () => sub.remove();
  }, [ready, workplace?.slug, switchWorkplace]);

  if (!loading && (!session || needsCode)) return <Redirect href="/sign-in" />;
  return (
    <CountsProvider>
      <TodayProvider>
        <Stack screenOptions={{
          headerStyle: { backgroundColor: colors.surface }, headerTintColor: colors.fg, headerShadowVisible: false,
          headerTitleStyle: { fontWeight: '600', fontSize: 17 }, headerBackButtonDisplayMode: 'minimal',
          contentStyle: { backgroundColor: colors.canvas },
        }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false, title: 'Home' }} />
          <Stack.Screen name="apply-leave" options={{ title: 'Apply for leave', presentation: 'modal' }} />
          <Stack.Screen name="attendance-request" options={{ title: 'Attendance request', presentation: 'modal' }} />
          <Stack.Screen name="payslips" options={{ title: 'Payslips' }} />
          <Stack.Screen name="payslip" options={{ title: 'Payslip' }} />
          <Stack.Screen name="holidays" options={{ title: 'Holidays' }} />
          <Stack.Screen name="directory" options={{ title: 'Directory' }} />
          <Stack.Screen name="announcements" options={{ title: 'Announcements' }} />
          <Stack.Screen name="profile" options={{ title: 'My profile' }} />
          <Stack.Screen name="organizations" options={{ title: 'Your organizations' }} />
          <Stack.Screen name="security" options={{ title: 'Sign-in & security' }} />
          <Stack.Screen name="change-password" options={{ title: 'Change password', presentation: 'modal' }} />
          <Stack.Screen name="two-step" options={{ title: 'Two-step sign-in' }} />
          <Stack.Screen name="notification-settings" options={{ title: 'Notifications' }} />
          <Stack.Screen name="appearance" options={{ title: 'Appearance' }} />
          <Stack.Screen name="about" options={{ title: 'About' }} />
        </Stack>
      </TodayProvider>
    </CountsProvider>
  );
}
