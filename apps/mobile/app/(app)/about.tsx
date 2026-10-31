import { Image, Linking, View } from 'react-native';
import logoMark from '../../assets/logo-mark.png';
import { SITE_URL } from '@/lib/site';
import { appVersion } from '@/lib/version';
import { ListGroup, ListRow, Page, space, Text, useTheme } from '@/ui';

/** Which build this is (compare with the website's Account settings), and where to read about PeopleCore. */
export default function About() {
  const { colors } = useTheme();
  return (
    <Page>
      <View style={{ alignItems: 'center', gap: space.sm, paddingVertical: space.xl }}>
        <Image source={logoMark} style={{ width: 72, height: 72 }} accessibilityIgnoresInvertColors />
        <Text variant="title">People<Text style={{ color: colors.brand }}>Core</Text></Text>
        <Text variant="footnote" tone="muted" selectable style={{ textAlign: 'center' }}>{appVersion()}</Text>
      </View>
      <ListGroup>
        <ListRow icon="globe-outline" tone="info" title="PeopleCore website" external onPress={() => void Linking.openURL(SITE_URL)} />
        <ListRow icon="lock-closed-outline" tone="success" title="Security" external onPress={() => void Linking.openURL(`${SITE_URL}/security`)} />
        <ListRow icon="document-text-outline" tone="neutral" title="Compliance" external onPress={() => void Linking.openURL(`${SITE_URL}/compliance`)} />
      </ListGroup>
      <Text variant="caption" tone="faint" style={{ textAlign: 'center' }}>Your data is read as you: you see only what your role allows, as on the website.</Text>
    </Page>
  );
}
