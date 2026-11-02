import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { NextResponse } from 'next/server';
import { latestAndroidApp } from '@/server/android-app';

export const dynamic = 'force-dynamic';

/** The latest Android build's APK, for anyone (it holds no secrets; signing in decides what each person sees). */
export async function GET() {
  const app = await latestAndroidApp();
  if (!app) return new NextResponse('The Android app isn’t published yet.', { status: 404 });
  return new NextResponse(Readable.toWeb(createReadStream(app.path)) as ReadableStream<Uint8Array>, {
    headers: {
      'Content-Type': 'application/vnd.android.package-archive',
      'Content-Disposition': `attachment; filename="${app.file}"`,
      'Content-Length': String(app.size),
      'Cache-Control': 'no-store',
    },
  });
}
