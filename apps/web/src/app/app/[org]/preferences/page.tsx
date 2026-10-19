import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { AppearanceSettings } from '@/components/shell/theme-menu';
import { Panel } from '@/components/ui/hub';
import { PageHeader } from '@/components/ui/surface';
import { asScene, asTheme, asWeather, COOKIE } from '@/lib/theme';
import { getOrgContext } from '@/server/context';

export const metadata: Metadata = { title: 'My preferences' };

/** Personal preferences for this browser: appearance (theme, time-of-day scene, weather tint). */
export default async function PreferencesPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  await getOrgContext(slug);
  const jar = await cookies();
  return (
    <>
      <PageHeader title="My preferences" description="How PeopleCore looks for you on this device." />
      <div className="max-w-xl">
        <Panel title="Appearance" meta="Auto is light by day and dark at night">
          <AppearanceSettings initial={{
            theme: asTheme(jar.get(COOKIE.theme)?.value), scene: asScene(jar.get(COOKIE.scene)?.value), weather: asWeather(jar.get(COOKIE.weather)?.value),
          }} />
        </Panel>
      </div>
    </>
  );
}
