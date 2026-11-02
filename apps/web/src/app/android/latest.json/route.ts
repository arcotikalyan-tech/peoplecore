import { NextResponse, type NextRequest } from 'next/server';
import { publicOrigin } from '@/lib/public-origin';
import { latestAndroidApp } from '@/server/android-app';

export const dynamic = 'force-dynamic';

/** Which Android build is the latest: the installed apps compare its versionCode with their own to offer the update. */
export async function GET(request: NextRequest) {
  const app = await latestAndroidApp();
  if (!app) return NextResponse.json({ error: 'The Android app isn’t published yet.' }, { status: 404 });
  const origin = publicOrigin(request);
  return NextResponse.json({
    versionCode: app.versionCode, version: app.version, commit: app.commit, publishedAt: app.publishedAt, size: app.size, sha256: app.sha256,
    page: `${origin}/android`, download: `${origin}/android/download`,
  }, { headers: { 'Cache-Control': 'no-cache' } });
}
