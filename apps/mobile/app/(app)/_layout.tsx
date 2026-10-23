import Ionicons from '@expo/vector-icons/Ionicons';
import * as Notifications from 'expo-notifications';
import { Redirect, router, Tabs } from 'expo-router';
import { useEffect } from 'react';
import { Pressable } from 'react-native';
import { pushSupported, syncPush } from '@/lib/push';
import { screenFor } from '@/lib/push-links';
import { useSession } from '@/lib/session';
import { colors } from '@/ui';

export default function AppLayout() {
  const { loading, session, needsCode } = useSession();
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
    const open = (r: Notifications.NotificationResponse | null) => {
      if (!r) return;
      router.navigate(screenFor(r.notification.request.content.data?.link));
      Notifications.clearLastNotificationResponse();
    };
    open(Notifications.getLastNotificationResponse());
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, [ready]);

  if (!loading && (!session || needsCode)) return <Redirect href="/sign-in" />;
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: colors.primary, headerTitleStyle: { fontWeight: '600' } }}>
      <Tabs.Screen name="index" options={{ title: 'Today', tabBarAccessibilityLabel: 'Today', tabBarIcon: ({ color, size }) => <Ionicons name="time-outline" color={color} size={size} /> }} />
      <Tabs.Screen name="inbox" options={{ title: 'Inbox', tabBarAccessibilityLabel: 'Inbox', tabBarIcon: ({ color, size }) => <Ionicons name="mail-unread-outline" color={color} size={size} /> }} />
      <Tabs.Screen name="leave" options={{ title: 'Leave', tabBarAccessibilityLabel: 'Leave', tabBarIcon: ({ color, size }) => <Ionicons name="calendar-outline" color={color} size={size} /> }} />
      <Tabs.Screen name="payslips" options={{ title: 'Payslips', tabBarAccessibilityLabel: 'Payslips', tabBarIcon: ({ color, size }) => <Ionicons name="wallet-outline" color={color} size={size} /> }} />
      <Tabs.Screen name="requests" options={{
        href: null, title: 'Attendance requests',
        headerLeft: () => (
          <Pressable accessibilityRole="button" accessibilityLabel="Back to Today" hitSlop={8} onPress={() => router.navigate('/(app)')} style={{ paddingHorizontal: 16 }}>
            <Ionicons name="arrow-back" size={22} color={colors.fg} />
          </Pressable>
        ),
      }} />
      <Tabs.Screen name="account" options={{ title: 'Account', tabBarAccessibilityLabel: 'Account', tabBarIcon: ({ color, size }) => <Ionicons name="person-circle-outline" color={color} size={size} /> }} />
    </Tabs>
  );
}
