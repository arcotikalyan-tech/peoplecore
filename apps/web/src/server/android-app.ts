import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { downloadsDir } from '@/lib/env';

/**
 * The Android app as the team installs it, from /android (there is no store listing yet). deploy/publish-android.sh
 * uploads each build to the server's /opt/peoplecore/downloads/android, mounted read-only at APP_DOWNLOADS_DIR, with
 * latest.json describing it; the page, the download and the installed apps' update check all read that. Without the
 * folder (development, CI) nothing is published.
 */
const Release = z.object({
  versionCode: z.number().int().positive(),
  version: z.string().min(1).max(40),
  commit: z.string().regex(/^[0-9a-f]{7,40}$/),
  publishedAt: z.iso.datetime(),
  // A name inside the folder, never a path.
  file: z.string().regex(/^PeopleCore-\d+\.apk$/),
  size: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

export type AndroidApp = z.infer<typeof Release> & { path: string };

export async function latestAndroidApp(): Promise<AndroidApp | null> {
  const root = downloadsDir();
  if (!root) return null;
  const dir = path.join(root, 'android');
  try {
    const release = Release.parse(JSON.parse(await readFile(path.join(dir, 'latest.json'), 'utf8')));
    const file = path.join(dir, release.file);
    const found = await stat(file);
    // A size that doesn't match is a broken upload: offer nothing rather than an app that won't install.
    return found.isFile() && found.size === release.size ? { ...release, path: file } : null;
  } catch {
    return null;
  }
}
