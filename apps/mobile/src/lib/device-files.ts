import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';

/**
 * Files this app leaves on the phone (audit MOB-09): payslip PDFs downloaded to open or share, and punch selfies (the
 * camera's copy and the smaller one sent). They're deleted once they're no longer needed: a selfie when no waiting punch
 * refers to it, payslips before the next download and at sign-out, everything at sign-out except selfies of punches
 * still waiting to be sent (they belong to their punch, which goes when the phone is back online).
 */

/** Folders in the cache where punch photos are made: the camera's copy, and the resized one that is sent. */
export const PHOTO_DIRS = ['ImagePicker', 'ImageManipulator'] as const;

export interface CacheListing {
  /** File names directly in the cache folder. */
  root: string[];
  /** File names in each photo folder. */
  photos: Partial<Record<(typeof PHOTO_DIRS)[number], string[]>>;
}

/** Which cached files can go: payslip PDFs and/or punch photos, never a photo a waiting punch still needs. Pure, for tests. */
export function filesToDelete(cache: string, listing: CacheListing, keep: readonly string[], what: { payslips: boolean; photos: boolean }): string[] {
  const kept = new Set(keep);
  const out: string[] = [];
  if (what.payslips) for (const name of listing.root) if (/^payslip-.*\.pdf$/.test(name)) out.push(`${cache}${name}`);
  if (what.photos) {
    for (const dir of PHOTO_DIRS) {
      for (const name of listing.photos[dir] ?? []) {
        const uri = `${cache}${dir}/${name}`;
        if (!kept.has(uri)) out.push(uri);
      }
    }
  }
  return out;
}

async function list(dir: string): Promise<string[]> {
  try {
    return await FileSystem.readDirectoryAsync(dir);
  } catch {
    return []; // not made yet
  }
}

/** Deletes what `filesToDelete` picks. Never throws: a file that can't go now is tried again next time. */
export async function clearDeviceFiles(keep: readonly string[], what: { payslips: boolean; photos: boolean }): Promise<number> {
  const cache = FileSystem.cacheDirectory;
  if (Platform.OS === 'web' || !cache) return 0;
  const listing: CacheListing = { root: what.payslips ? await list(cache) : [], photos: {} };
  if (what.photos) for (const dir of PHOTO_DIRS) listing.photos[dir] = await list(`${cache}${dir}`);
  const doomed = filesToDelete(cache, listing, keep, what);
  await Promise.all(doomed.map((uri) => FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined)));
  return doomed.length;
}
