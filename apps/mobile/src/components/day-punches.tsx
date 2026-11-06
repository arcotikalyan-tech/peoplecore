import { useEffect, useState } from 'react';
import { Image, Linking, Pressable, StyleSheet, View } from 'react-native';
import { loadDayPunches, punchPhotoUrl, type DayPunch } from '@/lib/day-punches';
import { clock } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useLoad } from '@/lib/use-load';
import { Button, ErrorState, IconTile, radius, Skeleton, SkeletonList, space, Text, useTheme } from '@/ui';

/**
 * One person's punches on a day: what each was and when, its photo, and where it was made with its pin in Google Maps.
 * For yourself, your team, or everyone if you're HR: the database decides, and `hideWhenEmpty` shows nothing to anyone
 * else. Nothing reaches Google until the button is pressed.
 */
export function DayPunches({ employeeId, date, title, refresh, hideWhenEmpty = false }: {
  employeeId: string; date: string; title?: string; refresh?: number; hideWhenEmpty?: boolean;
}) {
  const { workplace } = useSession();
  const orgId = workplace?.orgId;
  const tz = workplace?.timezone ?? 'Asia/Kolkata';
  const { data, loading, error, reload } = useLoad(
    async () => (orgId ? loadDayPunches(orgId, employeeId, date, tz) : []),
    [orgId, employeeId, date, tz, refresh],
  );
  if (loading) return hideWhenEmpty ? null : <SkeletonList rows={2} />;
  if (error) return hideWhenEmpty ? null : <ErrorState onRetry={() => void reload()} />;
  if (!data?.length) return hideWhenEmpty ? null : <Text variant="footnote" tone="muted">No punches on this day.</Text>;
  return (
    <View>
      {title && <Text variant="headline" style={{ marginBottom: space.xs }}>{title}</Text>}
      {data.map((p, i) => <PunchRow key={p.id} punch={p} tz={tz} first={i === 0} />)}
    </View>
  );
}

function PunchRow({ punch, tz, first }: { punch: DayPunch; tz: string; first: boolean }) {
  const { colors } = useTheme();
  const [photo, setPhoto] = useState<string | null>(null);
  const [asked, setAsked] = useState(false);
  const [big, setBig] = useState(false);
  useEffect(() => {
    if (!punch.hasPhoto) return;
    let current = true;
    void punchPhotoUrl(punch.id).then((url) => { if (current) { setPhoto(url); setAsked(true); } });
    return () => { current = false; };
  }, [punch.id, punch.hasPhoto]);

  const when = clock(punch.at, tz);
  const { place } = punch;
  return (
    <View accessibilityLabel={`${punch.label} at ${when}`} style={[{ paddingVertical: space.md }, !first && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.line }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        {!punch.hasPhoto ? <IconTile icon="time-outline" tone="neutral" size={48} />
          : photo ? (
            <Pressable accessibilityRole="button" accessibilityLabel={`${punch.label} photo at ${when}`} accessibilityState={{ expanded: big }} onPress={() => setBig((b) => !b)}>
              <Image source={{ uri: photo }} accessibilityIgnoresInvertColors style={{ width: 48, height: 48, borderRadius: radius.md, backgroundColor: colors.subtle }} />
            </Pressable>
          ) : asked ? <IconTile icon="image-outline" tone="neutral" size={48} /> : <Skeleton width={48} height={48} />}
        <View style={{ flex: 1 }}>
          <Text variant="callout" style={{ fontWeight: '600' }}>{punch.label} · {when}</Text>
          <Text variant="caption" tone="muted">{place ? [place.coords, place.accuracy?.replace(/ /g, ' ')].filter(Boolean).join(' · ') : 'No location recorded'}</Text>
        </View>
        {place && (
          <Button label="Map" variant="tonal" size="sm" icon="location-outline"
            accessibilityLabel={`${punch.label} at ${when}, in Google Maps`} onPress={() => void Linking.openURL(place.mapsUrl)} />
        )}
      </View>
      {big && photo && (
        <Image source={{ uri: photo }} accessibilityLabel={`${punch.label} photo at ${when}, full size`} resizeMode="contain"
          style={{ width: '100%', aspectRatio: 1, marginTop: space.md, borderRadius: radius.md, backgroundColor: colors.subtle }} />
      )}
    </View>
  );
}
