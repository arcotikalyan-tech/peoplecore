import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import { Platform } from 'react-native';
import { SITE_URL } from './site';
import { within } from './timeout';

/** The page offering the Android app (deploy/publish-android.sh publishes each build there), if the app can't update itself. */
export const UPDATE_PAGE = `${SITE_URL}/android`;

/** A published Android build newer than this one. */
export interface AppRelease { versionCode: number; size: number }

/** The published build when it's newer than the installed one; null otherwise, or for an unnumbered build. */
export function newerRelease(published: unknown, installed: number | null | undefined): AppRelease | null {
  const { versionCode, size } = (published ?? {}) as { versionCode?: unknown; size?: unknown };
  if (!installed || typeof versionCode !== 'number' || !Number.isInteger(versionCode) || versionCode <= installed) return null;
  return typeof size === 'number' && Number.isInteger(size) && size > 0 ? { versionCode, size } : null;
}

const installedVersion = () => Constants.expoConfig?.android?.versionCode;

const askWebsite = () => fetch(`${SITE_URL}/android/latest.json`).then((r) => (r.ok ? r.json() as Promise<unknown> : null));

const apkFile = /^PeopleCore-\d+\.apk$/;

/** Removes downloaded versions from the phone's cache: an installed one, or one a newer build has replaced. */
async function clearDownloads(keep?: string): Promise<void> {
  const dir = FileSystem.cacheDirectory;
  if (!dir) return;
  const names = await FileSystem.readDirectoryAsync(dir);
  await Promise.all(names.filter((n) => apkFile.test(n) && n !== keep).map((n) => FileSystem.deleteAsync(dir + n, { idempotent: true })));
}

const HOUR = 3_600_000;
let last: { at: number; release: Promise<AppRelease | null> } | null = null;

/**
 * A newer Android build, once one is published. Asks the website at most once an hour (screens call this every time
 * they come into view); never on the web build or a development build, which have no version code.
 */
export function availableUpdate(): Promise<AppRelease | null> {
  const installed = installedVersion();
  if (Platform.OS !== 'android' || !installed) return Promise.resolve(null);
  if (!last || Date.now() - last.at > HOUR) {
    const ask = askWebsite().then((published) => {
      const release = newerRelease(published, installed);
      // The website answered and nothing is waiting, so a version downloaded earlier is installed by now.
      if (published && !release) void clearDownloads().catch(() => undefined);
      return release;
    });
    last = { at: Date.now(), release: within(ask, 10_000, null) };
  }
  return last.release;
}

/**
 * Downloads the newest build into the phone's cache. Asks the website again first: /android/download always serves the
 * newest, which may be newer than when the app last asked. `done` gives the file, or null once cancelled, and fails if
 * the file didn't arrive whole. (Android checks it's signed with the installed app's key before updating.)
 */
export function downloadUpdate(onProgress: (written: number, total: number) => void): { done: Promise<string | null>; cancel: () => void } {
  let task: FileSystem.DownloadResumable | null = null;
  let cancelled = false;
  const run = async () => {
    const release = newerRelease(await askWebsite(), installedVersion());
    if (!release) throw new Error('No newer version to download.');
    const name = `PeopleCore-${release.versionCode}.apk`;
    const target = `${FileSystem.cacheDirectory}${name}`;
    await clearDownloads(name);
    const before = await FileSystem.getInfoAsync(target);
    if (cancelled) return null;
    if (before.exists && before.size === release.size) return target;
    task = FileSystem.createDownloadResumable(`${SITE_URL}/android/download`, target, {}, (p) => onProgress(p.totalBytesWritten, release.size));
    const res = await task.downloadAsync();
    if (cancelled || !res) return null;
    const after = await FileSystem.getInfoAsync(target);
    if (res.status === 200 && after.exists && after.size === release.size) return target;
    await FileSystem.deleteAsync(target, { idempotent: true });
    throw new Error('The download didn’t finish.');
  };
  return {
    done: run().catch((e: unknown) => { if (cancelled) return null; throw e; }),
    cancel: () => { cancelled = true; void task?.cancelAsync().catch(() => undefined); },
  };
}

/** Opens Android's own install screen for a downloaded build; finishes when the person comes back from it. */
export async function installUpdate(file: string): Promise<void> {
  const FLAG_GRANT_READ_URI_PERMISSION = 1;
  await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
    data: await FileSystem.getContentUriAsync(file),
    type: 'application/vnd.android.package-archive',
    flags: FLAG_GRANT_READ_URI_PERMISSION,
  });
}
