import { describe, expect, it, vi } from 'vitest';
import { newerVersion } from '../src/lib/app-update';

vi.mock('expo-constants', () => ({ default: {} }));
vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));

describe('the update offer on Home', () => {
  it('names a published build newer than the installed one', () => {
    expect(newerVersion({ versionCode: 215, version: '0.1.0' }, 210)).toBe(215);
  });

  it('stays quiet for the same or an older build, an answer it can’t read, or a build without a number', () => {
    expect(newerVersion({ versionCode: 210 }, 210)).toBeNull();
    expect(newerVersion({ versionCode: 200 }, 210)).toBeNull();
    expect(newerVersion({ versionCode: '215' }, 210)).toBeNull();
    expect(newerVersion({ error: 'The Android app isn’t published yet.' }, 210)).toBeNull();
    expect(newerVersion(null, 210)).toBeNull();
    expect(newerVersion({ versionCode: 215 }, undefined)).toBeNull();
  });
});
