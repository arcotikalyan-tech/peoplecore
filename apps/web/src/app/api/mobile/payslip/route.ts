import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { APP_CORS, appCaller } from '@/server/app-token';
import { payslipFile } from '@/server/payslip-file';

/**
 * The phone app's payslip download: the same PDF as the website's, for the signed-in person's own payslip (their
 * token; RLS only returns payslips of released runs that are theirs). ?org=<id>&run=<id>.
 */
export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: APP_CORS });
}

export async function GET(request: NextRequest) {
  const ids = z.object({ org: z.uuid(), run: z.uuid() }).safeParse({ org: request.nextUrl.searchParams.get('org'), run: request.nextUrl.searchParams.get('run') });
  if (!ids.success) return new NextResponse('Not found', { status: 404, headers: APP_CORS });
  const caller = await appCaller(request);
  if (!caller) return new NextResponse('Sign in again.', { status: 401, headers: APP_CORS });
  const { supabase, userId } = caller;
  const [{ data: me }, { data: org }] = await Promise.all([
    supabase.from('employees').select('id').eq('organization_id', ids.data.org).eq('user_id', userId).maybeSingle(),
    supabase.from('organizations').select('name').eq('id', ids.data.org).maybeSingle(),
  ]);
  if (!me || !org) return new NextResponse('Not found', { status: 404, headers: APP_CORS });
  const file = await payslipFile(supabase, ids.data.org, org.name, ids.data.run, me.id);
  if (!file) return new NextResponse('Not found', { status: 404, headers: APP_CORS });
  return new NextResponse(Buffer.from(file.pdf), {
    headers: { ...APP_CORS, 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${file.fileName}"`, 'Cache-Control': 'no-store' },
  });
}
