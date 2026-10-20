import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { formatDate } from '@/lib/format';
import { getOrgContext } from '@/server/context';
import { employeeNames } from '@/server/employees';
import { learnSettings } from '@/server/learn';
import { createClient } from '@/server/supabase';

export const metadata: Metadata = { title: 'Certificate' };

/** A printable certificate for a completed enrolment the viewer may see (their own, their line's, or HR). */
export default async function CertificatePage({ params }: { params: Promise<{ org: string; enrollmentId: string }> }) {
  const { org: slug, enrollmentId } = await params;
  if (!z.uuid().safeParse(enrollmentId).success) notFound();
  const ctx = await getOrgContext(slug);
  const supabase = await createClient();
  const { data: x } = await supabase.from('course_enrollments').select('id, course_id, employee_id, status, completed_at, valid_until')
    .eq('organization_id', ctx.org.id).eq('id', enrollmentId).maybeSingle();
  if (!x || x.status !== 'completed' || !x.completed_at) notFound();
  const [{ data: course }, names, s] = await Promise.all([
    supabase.from('courses').select('title, duration_minutes').eq('id', x.course_id).maybeSingle(),
    employeeNames(ctx.org.id, [x.employee_id]),
    learnSettings(ctx.org.id),
  ]);
  const accent = s.certificate_accent;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex justify-between print:hidden"><Link href={`/app/${slug}/learning/${x.course_id}`} className="text-sm text-primary">← Course</Link><span className="text-xs text-muted">Use your browser’s Print to save as PDF.</span></div>
      <div className="rounded-2xl border-8 bg-white p-10 text-center text-[#16161b]" style={{ borderColor: accent }}>
        <p className="text-xs font-semibold uppercase tracking-[0.3em]" style={{ color: accent }}>Certificate of completion</p>
        <p className="mt-6 text-sm text-[#5f5f6c]">This certifies that</p>
        <p className="mt-2 text-3xl font-semibold">{names.get(x.employee_id) ?? 'Employee'}</p>
        <p className="mt-4 text-sm text-[#5f5f6c]">has completed</p>
        <p className="mt-2 text-2xl font-semibold" style={{ color: accent }}>{course?.title}</p>
        <p className="mt-4 text-sm text-[#5f5f6c]">on {formatDate(x.completed_at)}{x.valid_until ? ` · valid until ${formatDate(x.valid_until)}` : ''}</p>
        <div className="mt-10 flex items-end justify-between text-left text-sm">
          <div><p className="font-semibold">{ctx.org.name}</p><p className="text-xs text-[#5f5f6c]">Certificate ID {x.id.slice(0, 8).toUpperCase()}</p></div>
          {s.signature_name && <div className="text-right"><p className="border-t border-[#d4d1e3] pt-1 font-semibold">{s.signature_name}</p><p className="text-xs text-[#5f5f6c]">{s.signature_title ?? ''}</p></div>}
        </div>
      </div>
    </div>
  );
}
