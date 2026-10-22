import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getOrgContext } from '@/server/context';
import { HELPDESK_BUCKET, signDocumentUrl } from '@/server/document-storage';
import { createClient } from '@/server/supabase';

/** A ticket file: ticket_file checks the caller may see it (requesters: not internal files); then a 60-second signed URL. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ org: string; fileId: string }> }) {
  const { org, fileId } = await params;
  if (!z.uuid().safeParse(fileId).success) return new NextResponse('Not found', { status: 404 });
  await getOrgContext(org);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('ticket_file', { p_id: fileId }).maybeSingle();
  if (error || !data) return new NextResponse('Not found', { status: 404 });
  const url = await signDocumentUrl(data.path, data.name, HELPDESK_BUCKET);
  if (!url) return new NextResponse('The file is not available right now.', { status: 503 });
  return NextResponse.redirect(url, { status: 303, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}
