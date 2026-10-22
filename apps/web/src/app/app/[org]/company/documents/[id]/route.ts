import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getOrgContext } from '@/server/context';
import { COMPANY_BUCKET, signDocumentUrl } from '@/server/document-storage';
import { createClient } from '@/server/supabase';

/** Downloads a company proof: the row is read as the caller (RLS: org.manage or audit.read), then a short-lived link. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ org: string; id: string }> }) {
  const { org, id } = await params;
  const ctx = await getOrgContext(org);
  if (!z.uuid().safeParse(id).success) return new NextResponse('Not found', { status: 404 });
  const supabase = await createClient();
  const { data } = await supabase.from('company_documents').select('storage_path, file_name').eq('id', id).eq('organization_id', ctx.org.id).maybeSingle();
  if (!data) return new NextResponse('Not found', { status: 404 });
  const url = await signDocumentUrl(data.storage_path, data.file_name, COMPANY_BUCKET);
  if (!url) return new NextResponse('The file is not available right now.', { status: 503 });
  return NextResponse.redirect(url, { headers: { 'Cache-Control': 'no-store' } });
}
