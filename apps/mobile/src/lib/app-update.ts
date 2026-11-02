import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { SITE_URL } from './site';
import { within } from './timeout';

/** Where the team installs the Android app (deploy/publish-android.sh publishes each build there). */
export const UPDATE_PAGE = `${SITE_URL}/android`;

/** The published version code when it's newer than the installed one; null otherwise, or for an unnumbered build. */
export function newerVersion(published: unknown, installed: number | null | undefined): number | null {
  const code = (published as { versionCode?: unknown } | null)?.versionCode;
  return installed && typeof code === 'number' && Number.isInteger(code) && code > installed ? code : null;
}

const HOUR = 3_600_000;
let last: { at: number; code: Promise<number | null> } | null = null;

/**
 * A newer Android build's version code, once one is published. Asks the website at most once an hour (screens call
 * this every time they come into view); never on the web build or a development build, which have no version code.
 */
export function availableUpdate(): Promise<number | null> {
  const installed = Constants.expoConfig?.android?.versionCode;
  if (Platform.OS !== 'android' || !installed) return Promise.resolve(null);
  if (!last || Date.now() - last.at > HOUR) {
    const ask = fetch(`${SITE_URL}/android/latest.json`).then((r) => (r.ok ? r.json() : null)).then((j: unknown) => newerVersion(j, installed));
    last = { at: Date.now(), code: within(ask, 10_000, null) };
  }
  return last.code;
}
