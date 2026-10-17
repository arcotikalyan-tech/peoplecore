import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getOrgContext } from '@/server/context';
import { signDocumentUrl } from '@/server/document-storage';
import { createClient } from '@/server/supabase';

/**
 * Download: the database checks the permission and records the download (document_download), then the
 * browser is sent to a 60-second signed URL. Refusals and unknown ids look the same (404).
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ org: string; id: string; documentId: string }> }) {
  const { org, documentId } = await params;
  if (!z.uuid().safeParse(documentId).success) return new NextResponse('Not found', { status: 404 });
  await getOrgContext(org); // signed-in member of an active organization, or redirected

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('document_download', { p_document: documentId }).maybeSingle();
  if (error || !data) return new NextResponse('Not found', { status: 404 });

  const url = await signDocumentUrl(data.storage_path, data.file_name);
  if (!url) return new NextResponse('The file is not available right now. Please try again.', { status: 503 });
  return NextResponse.redirect(url, { status: 303, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}
