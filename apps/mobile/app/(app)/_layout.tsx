import Ionicons from '@expo/vector-icons/Ionicons';
import { Redirect, Tabs } from 'expo-router';
import { useSession } from '@/lib/session';
import { colors } from '@/ui';

export default function AppLayout() {
  const { loading, session, needsCode } = useSession();
  if (!loading && (!session || needsCode)) return <Redirect href="/sign-in" />;
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: colors.primary, headerTitleStyle: { fontWeight: '600' } }}>
      <Tabs.Screen name="index" options={{ title: 'Today', tabBarAccessibilityLabel: 'Today', tabBarIcon: ({ color, size }) => <Ionicons name="time-outline" color={color} size={size} /> }} />
      <Tabs.Screen name="inbox" options={{ title: 'Inbox', tabBarAccessibilityLabel: 'Inbox', tabBarIcon: ({ color, size }) => <Ionicons name="mail-unread-outline" color={color} size={size} /> }} />
      <Tabs.Screen name="leave" options={{ title: 'Leave', tabBarAccessibilityLabel: 'Leave', tabBarIcon: ({ color, size }) => <Ionicons name="calendar-outline" color={color} size={size} /> }} />
      <Tabs.Screen name="payslips" options={{ title: 'Payslips', tabBarAccessibilityLabel: 'Payslips', tabBarIcon: ({ color, size }) => <Ionicons name="wallet-outline" color={color} size={size} /> }} />
      <Tabs.Screen name="account" options={{ title: 'Account', tabBarAccessibilityLabel: 'Account', tabBarIcon: ({ color, size }) => <Ionicons name="person-circle-outline" color={color} size={size} /> }} />
    </Tabs>
  );
}
