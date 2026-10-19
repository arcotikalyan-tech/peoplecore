/**
 * Appearance preferences, kept in cookies (per browser, no account data): the theme (auto, light, dark), the
 * scene (auto follows the local time of day) and the weather tint. "Auto" is light by day and dark at night.
 * The same rules run in a tiny inline script before the first paint (themeBootScript) and in the theme menu.
 */

export const THEMES = ['auto', 'light', 'dark'] as const;
export const SCENES = ['auto', 'dawn', 'morning', 'midday', 'afternoon', 'dusk', 'night'] as const;
export const WEATHERS = ['clear', 'cloudy', 'rain', 'storm', 'fog', 'snow', 'haze'] as const;
export type ThemePref = (typeof THEMES)[number];
export type ScenePref = (typeof SCENES)[number];
export type Weather = (typeof WEATHERS)[number];
export type Scene = Exclude<ScenePref, 'auto'>;

export const THEME_LABELS: Record<ThemePref, string> = { auto: 'Auto', light: 'Light', dark: 'Dark' };
export const SCENE_LABELS: Record<ScenePref, string> = {
  auto: 'Auto', dawn: 'Dawn', morning: 'Morning', midday: 'Midday', afternoon: 'Afternoon', dusk: 'Dusk', night: 'Night',
};
export const WEATHER_LABELS: Record<Weather, string> = {
  clear: 'Clear', cloudy: 'Cloudy', rain: 'Rain', storm: 'Storm', fog: 'Fog', snow: 'Snow', haze: 'Haze',
};

export const COOKIE = { theme: 'pc-theme', scene: 'pc-scene', weather: 'pc-weather' } as const;

/** Dawn 5–7, morning 7–11, midday 11–14, afternoon 14–17, dusk 17–19, night 19–5. */
export function sceneForHour(hour: number): Scene {
  if (hour >= 5 && hour < 7) return 'dawn';
  if (hour >= 7 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 14) return 'midday';
  if (hour >= 14 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 19) return 'dusk';
  return 'night';
}

/** The theme and scene to show now. Auto theme: light from 6:00 to 18:59, dark otherwise. */
export function resolveAppearance(pref: { theme: ThemePref; scene: ScenePref }, hour: number) {
  const scene: Scene = pref.scene === 'auto' ? sceneForHour(hour) : pref.scene;
  const theme: 'light' | 'dark' = pref.theme === 'auto' ? (hour >= 6 && hour < 19 ? 'light' : 'dark') : pref.theme;
  return { theme, scene };
}

export const asTheme = (v: string | undefined): ThemePref => (THEMES as readonly string[]).includes(v ?? '') ? (v as ThemePref) : 'auto';
export const asScene = (v: string | undefined): ScenePref => (SCENES as readonly string[]).includes(v ?? '') ? (v as ScenePref) : 'auto';
export const asWeather = (v: string | undefined): Weather => (WEATHERS as readonly string[]).includes(v ?? '') ? (v as Weather) : 'clear';

/** Runs in <head> before paint: applies the preferences with the browser's local hour. Self-contained. */
export const themeBootScript = `(function(){try{var c={};document.cookie.split('; ').forEach(function(p){var i=p.indexOf('=');c[p.slice(0,i)]=p.slice(i+1)});
var t=c['${COOKIE.theme}']||'auto',s=c['${COOKIE.scene}']||'auto',h=new Date().getHours();
var sc=s!=='auto'?s:(h>=5&&h<7?'dawn':h>=7&&h<11?'morning':h>=11&&h<14?'midday':h>=14&&h<17?'afternoon':h>=17&&h<19?'dusk':'night');
var th=t==='light'||t==='dark'?t:(h>=6&&h<19?'light':'dark');var d=document.documentElement;d.dataset.theme=th;d.dataset.scene=sc;d.dataset.weather=c['${COOKIE.weather}']||'clear';}catch(e){}})();`;
