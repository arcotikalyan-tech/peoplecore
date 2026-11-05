import { beforeEach, describe, expect, it, vi } from 'vitest';

const fs = vi.hoisted(() => ({
  cacheDirectory: 'file:///cache/',
  files: new Map<string, number>(),
  download: { status: 200, size: 0 as number | null },
  cancelAsync: vi.fn(async () => undefined),
}));

vi.mock('expo-constants', () => ({ default: { expoConfig: { android: { versionCode: 210 } } } }));
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-intent-launcher', () => ({ startActivityAsync: vi.fn(async () => ({ resultCode: 0 })) }));
vi.mock('expo-file-system/legacy', () => ({
  get cacheDirectory() { return fs.cacheDirectory; },
  readDirectoryAsync: async () => [...fs.files.keys()].map((f) => f.replace(fs.cacheDirectory, '')),
  deleteAsync: async (f: string) => { fs.files.delete(f); },
  getInfoAsync: async (f: string) => (fs.files.has(f) ? { exists: true, size: fs.files.get(f) } : { exists: false }),
  getContentUriAsync: async (f: string) => f.replace('file:///cache/', 'content://in.peoplecore.app/'),
  createDownloadResumable: (_url: string, target: string, _options: object, progress: (p: { totalBytesWritten: number }) => void) => ({
    cancelAsync: fs.cancelAsync,
    downloadAsync: async () => {
      if (fs.download.size === null) return undefined; // cancelled
      progress({ totalBytesWritten: fs.download.size });
      fs.files.set(target, fs.download.size);
      return { status: fs.download.status };
    },
  }),
}));

const APK = 'file:///cache/PeopleCore-215.apk';
const answers = (body: unknown, ok = true) => vi.stubGlobal('fetch', vi.fn(async () => ({ ok, json: async () => body })));
// A fresh module each time: availableUpdate remembers its answer for an hour.
const load = async () => { vi.resetModules(); return import('../src/lib/app-update'); };
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  fs.files.clear();
  fs.download = { status: 200, size: 47_000_000 };
  fs.cancelAsync.mockClear();
});

describe('the update offer on Home', () => {
  it('names a published build newer than the installed one', async () => {
    const { newerRelease } = await load();
    expect(newerRelease({ versionCode: 215, size: 47_000_000, version: '0.1.0' }, 210)).toEqual({ versionCode: 215, size: 47_000_000 });
  });

  it('stays quiet for the same or an older build, an answer it can’t read, or a build without a number', async () => {
    const { newerRelease } = await load();
    expect(newerRelease({ versionCode: 210, size: 1 }, 210)).toBeNull();
    expect(newerRelease({ versionCode: 200, size: 1 }, 210)).toBeNull();
    expect(newerRelease({ versionCode: '215', size: 1 }, 210)).toBeNull();
    expect(newerRelease({ versionCode: 215 }, 210)).toBeNull();
    expect(newerRelease({ error: 'The Android app isn’t published yet.' }, 210)).toBeNull();
    expect(newerRelease(null, 210)).toBeNull();
    expect(newerRelease({ versionCode: 215, size: 1 }, undefined)).toBeNull();
  });

  it('removes a downloaded version once the website says nothing newer is waiting, but not when it can’t tell', async () => {
    fs.files.set(APK, 47_000_000);
    fs.files.set('file:///cache/payslip-2026-10.pdf', 10);
    answers({}, false);
    await (await load()).availableUpdate();
    await settle();
    expect(fs.files.has(APK)).toBe(true);
    answers({ versionCode: 210, size: 1 });
    await (await load()).availableUpdate();
    await settle();
    expect(fs.files.has(APK)).toBe(false);
    expect(fs.files.has('file:///cache/payslip-2026-10.pdf')).toBe(true);
  });
});

describe('downloading the update', () => {
  beforeEach(() => answers({ versionCode: 215, size: 47_000_000 }));

  it('gives the file once it has arrived whole, reporting progress and removing older downloads', async () => {
    fs.files.set('file:///cache/PeopleCore-212.apk', 58_000_000);
    const progress = vi.fn();
    expect(await (await load()).downloadUpdate(progress).done).toBe(APK);
    expect(progress).toHaveBeenCalledWith(47_000_000, 47_000_000);
    expect(fs.files.has('file:///cache/PeopleCore-212.apk')).toBe(false);
  });

  it('uses a whole download already on the phone, and replaces a partial one', async () => {
    const { downloadUpdate } = await load();
    fs.files.set(APK, 47_000_000);
    const progress = vi.fn();
    expect(await downloadUpdate(progress).done).toBe(APK);
    expect(progress).not.toHaveBeenCalled();
    fs.files.set(APK, 1_000);
    expect(await downloadUpdate(progress).done).toBe(APK);
    expect(fs.files.get(APK)).toBe(47_000_000);
  });

  it('fails and leaves nothing behind when the file is short or the server refuses', async () => {
    const { downloadUpdate } = await load();
    fs.download = { status: 200, size: 1_000 };
    await expect(downloadUpdate(vi.fn()).done).rejects.toThrow();
    expect(fs.files.has(APK)).toBe(false);
    fs.download = { status: 404, size: 47_000_000 };
    await expect(downloadUpdate(vi.fn()).done).rejects.toThrow();
    expect(fs.files.has(APK)).toBe(false);
  });

  it('fails when the website has nothing newer or can’t be reached', async () => {
    const { downloadUpdate } = await load();
    answers({ versionCode: 210, size: 1 });
    await expect(downloadUpdate(vi.fn()).done).rejects.toThrow();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    await expect(downloadUpdate(vi.fn()).done).rejects.toThrow();
  });

  it('ends quietly when cancelled', async () => {
    fs.download = { status: 200, size: null };
    const download = (await load()).downloadUpdate(vi.fn());
    await settle();
    download.cancel();
    expect(await download.done).toBeNull();
    expect(fs.cancelAsync).toHaveBeenCalled();
  });

  it('hands over nothing when cancelled just as a whole download is found, so the installer stays closed', async () => {
    fs.files.set(APK, 47_000_000);
    const download = (await load()).downloadUpdate(vi.fn());
    download.cancel();
    expect(await download.done).toBeNull();
    expect(fs.files.has(APK)).toBe(true);
  });
});

describe('installing the update', () => {
  it('opens Android’s install screen with read access to the file', async () => {
    const launcher = await import('expo-intent-launcher');
    await (await load()).installUpdate(APK);
    expect(launcher.startActivityAsync).toHaveBeenCalledWith('android.intent.action.VIEW', {
      data: 'content://in.peoplecore.app/PeopleCore-215.apk', type: 'application/vnd.android.package-archive', flags: 1,
    });
  });
});
