import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCounts } from '@/lib/counts';
import { useSession } from '@/lib/session';
import { useTheme, type IconName } from '@/ui';

const TABS: Array<{ name: string; title: string; icon: IconName; active: IconName; module?: string }> = [
  { name: 'index', title: 'Home', icon: 'home-outline', active: 'home' },
  { name: 'attendance', title: 'Attendance', icon: 'time-outline', active: 'time', module: 'attendance' },
  { name: 'leave', title: 'Leave', icon: 'calendar-outline', active: 'calendar', module: 'leave' },
  { name: 'inbox', title: 'Inbox', icon: 'file-tray-outline', active: 'file-tray' },
  { name: 'me', title: 'Me', icon: 'person-circle-outline', active: 'person-circle' },
];

/**
 * Five destinations with their labels always shown. The Inbox's count is only what waits for a decision (unread
 * notifications show on Home's bell instead). A tab whose module the organization switched off isn't shown.
 */
export default function TabsLayout() {
  const { colors } = useTheme();
  const { approvals } = useCounts();
  const { workplace } = useSession();
  const insets = useSafeAreaInsets();
  const waiting = approvals;
  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarActiveTintColor: colors.primary, tabBarInactiveTintColor: colors.muted,
      tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.line, height: 60 + insets.bottom, paddingTop: 6, paddingBottom: Math.max(insets.bottom, Platform.OS === 'android' ? 8 : 0) },
      tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      tabBarBadgeStyle: { backgroundColor: colors.danger, color: '#fff', fontSize: 10, fontWeight: '700' },
    }}>
      {TABS.map((t) => (
        <Tabs.Screen key={t.name} name={t.name} options={{
          title: t.title, href: t.module && workplace?.off.includes(t.module) ? null : undefined, tabBarAccessibilityLabel: t.name === 'inbox' && waiting ? `Inbox, ${waiting} waiting` : t.title,
          tabBarBadge: t.name === 'inbox' && waiting ? (waiting > 99 ? '99+' : waiting) : undefined,
          // The tint colors above are strings; React Native 0.88's ColorValue also allows null and numbers.
          tabBarIcon: ({ color, focused }) => <Ionicons name={focused ? t.active : t.icon} color={typeof color === 'string' ? color : undefined} size={24} />,
        }} />
      ))}
    </Tabs>
  );
}
