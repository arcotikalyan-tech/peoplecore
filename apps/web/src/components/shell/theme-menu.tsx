'use client';

import { useEffect, useRef, useState } from 'react';
import { type LucideIcon, Cloud, CloudFog, CloudLightning, CloudRain, CloudSun, Haze, Moon, MonitorSmartphone, Snowflake, Sun, Sunrise, Sunset } from 'lucide-react';
import { cn } from '@/components/ui/cn';
import {
  COOKIE, resolveAppearance, SCENE_LABELS, SCENES, THEME_LABELS, THEMES, WEATHER_LABELS, WEATHERS, type ScenePref, type ThemePref, type Weather,
} from '@/lib/theme';

export interface Appearance { theme: ThemePref; scene: ScenePref; weather: Weather }

const YEAR = 60 * 60 * 24 * 365;
const save = (name: string, value: string) => { document.cookie = `${name}=${value}; path=/; max-age=${YEAR}; samesite=lax`; };

/** Applies the preferences to <html> with the local hour (the same rule as the boot script). */
function apply(a: Appearance) {
  const now = resolveAppearance(a, new Date().getHours());
  const d = document.documentElement;
  d.dataset.theme = now.theme;
  d.dataset.scene = now.scene;
  d.dataset.weather = a.weather;
  return now;
}

const THEME_ICONS = { auto: MonitorSmartphone, light: Sun, dark: Moon };
const SCENE_ICONS = { auto: MonitorSmartphone, dawn: Sunrise, morning: CloudSun, midday: Sun, afternoon: Sun, dusk: Sunset, night: Moon };
const WEATHER_ICONS = { clear: Sun, cloudy: Cloud, rain: CloudRain, storm: CloudLightning, fog: CloudFog, snow: Snowflake, haze: Haze };

function useAppearance(initial: Appearance) {
  const [a, setA] = useState(initial);
  const [shown, setShown] = useState<{ theme: 'light' | 'dark'; scene: string } | null>(null);
  useEffect(() => {
    const tick = () => setShown(apply(a));
    const first = window.setTimeout(tick, 0);
    // "Auto" follows the clock while the page stays open.
    const id = window.setInterval(tick, 60_000);
    return () => { window.clearTimeout(first); window.clearInterval(id); };
  }, [a]);
  const update = (patch: Partial<Appearance>) => {
    const next = { ...a, ...patch };
    if (patch.theme) save(COOKIE.theme, patch.theme);
    if (patch.scene) save(COOKIE.scene, patch.scene);
    if (patch.weather) save(COOKIE.weather, patch.weather);
    setA(next);
  };
  return { a, shown, update };
}

function Choices<T extends string>({ legend, values, labels, icons, current, onPick, columns }: {
  legend: string; values: readonly T[]; labels: Record<T, string>; icons: Record<T, LucideIcon>; current: T; onPick: (v: T) => void; columns: string;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">{legend}</legend>
      <div className={cn('grid gap-1.5', columns)} role="radiogroup" aria-label={legend}>
        {values.map((v) => {
          const Icon: LucideIcon = icons[v];
          const on = v === current;
          return (
            <button key={v} type="button" role="radio" aria-checked={on} onClick={() => onPick(v)}
              className={cn('flex flex-col items-center gap-1 rounded-lg border px-2 py-2 text-xs transition-colors',
                on ? 'border-primary bg-primary-soft text-primary' : 'border-line text-muted hover:border-line-strong hover:text-fg')}>
              <Icon className="size-4" aria-hidden="true" />{labels[v]}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function Panel({ a, shown, update }: ReturnType<typeof useAppearance>) {
  return (
    <div className="space-y-4">
      <Choices legend="Theme" values={THEMES} labels={THEME_LABELS} icons={THEME_ICONS} current={a.theme} onPick={(theme) => update({ theme })} columns="grid-cols-3" />
      {a.theme === 'auto' && <p className="-mt-2 text-xs text-muted">Light from 6 am to 7 pm, dark at night{shown ? ` — ${shown.theme} now` : ''}.</p>}
      <Choices legend="Scene" values={SCENES} labels={SCENE_LABELS} icons={SCENE_ICONS} current={a.scene} onPick={(scene) => update({ scene })} columns="grid-cols-4" />
      <Choices legend="Weather" values={WEATHERS} labels={WEATHER_LABELS} icons={WEATHER_ICONS} current={a.weather} onPick={(weather) => update({ weather })} columns="grid-cols-4" />
    </div>
  );
}

/** The top bar's appearance button and menu. */
export function ThemeMenu({ initial }: { initial: Appearance }) {
  const state = useAppearance(initial);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);
  const Icon = state.shown?.theme === 'light' ? Sun : Moon;
  return (
    <div ref={box} className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="dialog" aria-label="Appearance"
        className="grid size-9 place-items-center rounded-lg text-muted hover:bg-subtle hover:text-fg">
        <Icon className="size-[18px]" />
      </button>
      {open && (
        <div role="dialog" aria-label="Appearance" className="absolute right-0 top-11 z-50 w-80 rounded-xl border border-line bg-raised p-4 shadow-xl">
          <Panel {...state} />
        </div>
      )}
    </div>
  );
}

/** The same choices on the preferences page. */
export function AppearanceSettings({ initial }: { initial: Appearance }) {
  return <Panel {...useAppearance(initial)} />;
}
