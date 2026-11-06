import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { APP_CORS, appCaller } from '@/server/app-token';
import { signSelfieUrl } from '@/server/document-storage';

/**
 * A punch's photo for the phone app: a short-lived link to the private file, for people who may see that punch
 * (punch_selfie, as them: the employee, their reporting line, whoever reads attendance for the organization). Anyone
 * else gets "not found", as on the website. ?punch=<id>.
 */
export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: APP_CORS });
}

export async function GET(request: NextRequest) {
  const headers = { ...APP_CORS, 'Cache-Control': 'private, no-store' };
  const punch = z.uuid().safeParse(request.nextUrl.searchParams.get('punch'));
  if (!punch.success) return new NextResponse('Not found', { status: 404, headers });
  const caller = await appCaller(request);
  if (!caller) return new NextResponse('Sign in again.', { status: 401, headers });
  const { data: path, error } = await caller.supabase.rpc('punch_selfie', { p_punch: punch.data });
  if (error || !path) return new NextResponse('Not found', { status: 404, headers });
  const url = await signSelfieUrl(path);
  if (!url) return new NextResponse('Not found', { status: 404, headers });
  return NextResponse.json({ url }, { headers });
}
