import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { payslipLayout } from '@peoplecore/shared/payslip';
import { PayslipSheet } from '@/components/payslip-sheet';
import { buttonClass } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/surface';
import { getOrgContext } from '@/server/context';
import { signImageUrls } from '@/server/document-storage';
import { getMyEmployee } from '@/server/employees';
import { payslipData } from '@/server/payslip-file';
import { createClient } from '@/server/supabase';
import { monthLabel } from '../../payroll/format';

export const metadata: Metadata = { title: 'Payslip' };

/** One payslip. Your own by default; payroll staff can open anyone's from the run (?employee=). RLS decides. */
export default async function PayslipPage({ params, searchParams }: { params: Promise<{ org: string; runId: string }>; searchParams: Promise<{ employee?: string }> }) {
  const { org: slug, runId } = await params;
  const { employee: requested } = await searchParams;
  if (!z.uuid().safeParse(runId).success || (requested && !z.uuid().safeParse(requested).success)) notFound();
  const ctx = await getOrgContext(slug);
  const employeeId = requested ?? (await getMyEmployee(ctx.org.id, ctx.user.id))?.id;
  if (!employeeId) notFound();
  const slip = await payslipData(await createClient(), ctx.org.id, ctx.org.name, runId, employeeId, { full: false });
  if (!slip) notFound();
  const logo = slip.logoPath ? (await signImageUrls([slip.logoPath])).get(slip.logoPath) ?? null : null;

  return (
    <>
      <PageHeader eyebrow={<Link href={`/app/${slug}/payslips?tab=payslips`} className="hover:text-fg">← My Pay</Link>}
        title={`Payslip · ${monthLabel(slip.data.periodMonth)}`}
        description={`${slip.data.employee.name} · ${slip.data.employee.code} · PAN, UAN and account number show in full in the PDF.`}
        actions={<a href={`/app/${slug}/payslips/${runId}/pdf${requested ? `?employee=${requested}` : ''}`} download className={buttonClass('secondary')}>Download PDF</a>} />
      <PayslipSheet layout={payslipLayout(slip.data)} logo={logo} />
    </>
  );
}
