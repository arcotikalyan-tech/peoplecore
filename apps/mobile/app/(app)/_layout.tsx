import { Redirect, Tabs } from 'expo-router';
import { useSession } from '@/lib/session';
import { colors } from '@/ui';

export default function AppLayout() {
  const { loading, session, needsCode } = useSession();
  if (!loading && (!session || needsCode)) return <Redirect href="/sign-in" />;
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: colors.primary, headerTitleStyle: { fontWeight: '600' } }}>
      <Tabs.Screen name="index" options={{ title: 'Today', tabBarAccessibilityLabel: 'Today' }} />
      <Tabs.Screen name="leave" options={{ title: 'Leave', tabBarAccessibilityLabel: 'Leave' }} />
      <Tabs.Screen name="payslips" options={{ title: 'Payslips', tabBarAccessibilityLabel: 'Payslips' }} />
    </Tabs>
  );
}
