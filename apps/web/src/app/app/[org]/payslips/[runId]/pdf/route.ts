import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getOrgContext } from '@/server/context';
import { getMyEmployee } from '@/server/employees';
import { payslipFile } from '@/server/payslip-file';
import { createClient } from '@/server/supabase';

/** One payslip as a PDF. Same reads as the payslip page, as the signed-in user: RLS decides whose slip they get. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ org: string; runId: string }> }) {
  const { org: slug, runId } = await params;
  const requested = req.nextUrl.searchParams.get('employee');
  if (!z.uuid().safeParse(runId).success || (requested && !z.uuid().safeParse(requested).success)) return new NextResponse('Not found', { status: 404 });
  const ctx = await getOrgContext(slug);
  const employeeId = requested ?? (await getMyEmployee(ctx.org.id, ctx.user.id))?.id;
  if (!employeeId) return new NextResponse('Not found', { status: 404 });
  const file = await payslipFile(await createClient(), ctx.org.id, ctx.org.name, runId, employeeId);
  if (!file) return new NextResponse('Not found', { status: 404 });
  return new NextResponse(Buffer.from(file.pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${file.fileName}"`,
      'Cache-Control': 'no-store',
    },
  });
}
