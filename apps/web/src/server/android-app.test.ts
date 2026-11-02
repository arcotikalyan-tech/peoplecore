import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as download } from '@/app/android/download/route';
import { GET as latest } from '@/app/android/latest.json/route';
import { latestAndroidApp } from './android-app';

const APK = Buffer.from('PK\u0003\u0004 not really an app');
const manifest = (over: Record<string, unknown> = {}) => ({
  versionCode: 215, version: '0.1.0', commit: '2b26a60', publishedAt: '2026-11-02T12:00:00Z',
  file: 'PeopleCore-215.apk', size: APK.length, sha256: 'a'.repeat(64), ...over,
});

describe('the Android app offered at /android', () => {
  let root = '';
  const publish = async (m: object, files: Record<string, Buffer> = { 'PeopleCore-215.apk': APK }) => {
    await mkdir(path.join(root, 'android'), { recursive: true });
    await writeFile(path.join(root, 'android', 'latest.json'), JSON.stringify(m));
    for (const [name, body] of Object.entries(files)) await writeFile(path.join(root, 'android', name), body);
  };

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'pc-downloads-'));
    vi.stubEnv('APP_DOWNLOADS_DIR', root);
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  });

  it('is the build latest.json names, once its file is there in full', async () => {
    await publish(manifest());
    expect(await latestAndroidApp()).toMatchObject({ versionCode: 215, file: 'PeopleCore-215.apk', path: path.join(root, 'android', 'PeopleCore-215.apk') });
    await publish(manifest({ size: APK.length + 1 }));
    expect(await latestAndroidApp()).toBeNull();
  });

  it('is nothing without the folder, without latest.json, or when latest.json points outside the folder', async () => {
    vi.stubEnv('APP_DOWNLOADS_DIR', '');
    expect(await latestAndroidApp()).toBeNull();
    vi.stubEnv('APP_DOWNLOADS_DIR', root);
    expect(await latestAndroidApp()).toBeNull();
    await writeFile(path.join(root, 'secret.apk'), APK);
    await publish(manifest({ file: '../secret.apk' }), {});
    expect(await latestAndroidApp()).toBeNull();
  });

  it('downloads as an APK and tells the installed apps its version, at the address the visitor used', async () => {
    await publish(manifest());
    const file = await download();
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toBe('application/vnd.android.package-archive');
    expect(file.headers.get('content-disposition')).toBe('attachment; filename="PeopleCore-215.apk"');
    expect(Buffer.from(await file.arrayBuffer())).toEqual(APK);

    const info = await latest(new NextRequest('http://0.0.0.0:3000/android/latest.json', { headers: { 'x-forwarded-host': 'hrms.tazq.io', 'x-forwarded-proto': 'https' } }));
    expect(await info.json()).toMatchObject({ versionCode: 215, page: 'https://hrms.tazq.io/android', download: 'https://hrms.tazq.io/android/download' });
  });

  it('answers not found while nothing is published', async () => {
    expect((await download()).status).toBe(404);
    expect((await latest(new NextRequest('http://localhost:3000/android/latest.json'))).status).toBe(404);
  });
});
