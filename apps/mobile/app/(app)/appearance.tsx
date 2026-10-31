import Ionicons from '@expo/vector-icons/Ionicons';
import { ListGroup, ListRow, Page, useTheme, type IconName } from '@/ui';
import type { Appearance } from '@/theme';

const OPTIONS: Array<{ value: Appearance; label: string; note: string; icon: IconName }> = [
  { value: 'system', label: 'Automatic', note: 'Follows your phone’s light or dark setting', icon: 'phone-portrait-outline' },
  { value: 'light', label: 'Light', note: 'Indigo on white', icon: 'sunny-outline' },
  { value: 'dark', label: 'Dark', note: 'Coral on near-black, easier at night', icon: 'moon-outline' },
];

/** Light, dark, or following the phone; remembered on this phone. */
export default function AppearanceScreen() {
  const { appearance, setAppearance, colors } = useTheme();
  return (
    <Page>
      <ListGroup title="Theme">
        {OPTIONS.map((o) => (
          <ListRow key={o.value} icon={o.icon} tone="neutral" title={o.label} subtitle={o.note} accessibilityLabel={`${o.label}${appearance === o.value ? ', selected' : ''}`}
            right={appearance === o.value ? <Ionicons name="checkmark-circle" size={22} color={colors.primary} /> : <Ionicons name="ellipse-outline" size={22} color={colors.lineStrong} />}
            onPress={() => setAppearance(o.value)} />
        ))}
      </ListGroup>
    </Page>
  );
}
