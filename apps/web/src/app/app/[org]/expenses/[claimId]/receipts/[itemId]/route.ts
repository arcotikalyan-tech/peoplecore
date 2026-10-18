import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getOrgContext } from '@/server/context';
import { RECEIPT_BUCKET, signDocumentUrl } from '@/server/document-storage';
import { createClient } from '@/server/supabase';

/** Receipt download: expense_receipt checks the caller can see the claim; then a 60-second signed URL. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ org: string; itemId: string }> }) {
  const { org, itemId } = await params;
  if (!z.uuid().safeParse(itemId).success) return new NextResponse('Not found', { status: 404 });
  await getOrgContext(org);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('expense_receipt', { p_item: itemId }).maybeSingle();
  if (error || !data) return new NextResponse('Not found', { status: 404 });
  const url = await signDocumentUrl(data.receipt_path, data.receipt_name ?? 'receipt', RECEIPT_BUCKET);
  if (!url) return new NextResponse('The receipt is not available right now.', { status: 503 });
  return NextResponse.redirect(url, { status: 303, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}
