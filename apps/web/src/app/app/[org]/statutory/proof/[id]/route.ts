import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getOrgContext } from '@/server/context';
import { signDocumentUrl, STATUTORY_BUCKET } from '@/server/document-storage';
import { createClient } from '@/server/supabase';

/** Proof of a filing: the row is read through RLS (statutory.manage), then a 60-second signed URL. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ org: string; id: string }> }) {
  const { org, id } = await params;
  if (!z.uuid().safeParse(id).success) return new NextResponse('Not found', { status: 404 });
  const ctx = await getOrgContext(org);
  const supabase = await createClient();
  const { data } = await supabase.from('statutory_filings').select('proof_path, proof_name').eq('organization_id', ctx.org.id).eq('id', id).maybeSingle();
  if (!data?.proof_path) return new NextResponse('Not found', { status: 404 });
  const url = await signDocumentUrl(data.proof_path, data.proof_name ?? 'proof', STATUTORY_BUCKET);
  if (!url) return new NextResponse('The file is not available right now.', { status: 503 });
  return NextResponse.redirect(url, { status: 303, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}
