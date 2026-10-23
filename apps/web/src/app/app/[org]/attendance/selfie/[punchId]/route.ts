import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getOrgContext } from '@/server/context';
import { signSelfieUrl } from '@/server/document-storage';
import { createClient } from '@/server/supabase';

/**
 * The check-in photo of one punch, for people who may see that punch (punch_selfie: the employee, their reporting
 * line, attendance admins): a short-lived link to the private file. Anyone else gets "not found".
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ org: string; punchId: string }> }) {
  const { org: slug, punchId } = await params;
  if (!z.uuid().safeParse(punchId).success) return new NextResponse('Not found', { status: 404 });
  await getOrgContext(slug);
  const supabase = await createClient();
  const { data: path, error } = await supabase.rpc('punch_selfie', { p_punch: punchId });
  if (error || !path) return new NextResponse('Not found', { status: 404 });
  const url = await signSelfieUrl(path);
  if (!url) return new NextResponse('Not found', { status: 404 });
  return NextResponse.redirect(url, { headers: { 'Cache-Control': 'private, no-store' } });
}
