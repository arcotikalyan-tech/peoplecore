import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { EMPLOYMENT_TYPE_LABELS } from '@peoplecore/shared';
import { Brand } from '@/components/brand';
import { Card } from '@/components/ui/surface';
import { createClient } from '@/server/supabase';
import { applyAction } from './actions';
import { ApplyForm } from './apply-form';

export const metadata: Metadata = { title: 'Apply' };

export default async function JobPage({ params }: { params: Promise<{ slug: string; jobId: string }> }) {
  const { slug, jobId } = await params;
  if (!/^[a-z0-9-]{3,50}$/.test(slug) || !z.uuid().safeParse(jobId).success) notFound();
  const supabase = await createClient();
  const { data: jobs, error } = await supabase.rpc('public_job_postings', { p_org_slug: slug });
  if (error) throw new Error('Failed to load the position');
  const job = jobs.find((j) => j.requisition_id === jobId);
  if (!job) notFound();

  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <Brand />
      <p className="mt-8 text-sm"><Link href={`/careers/${slug}`} className="text-muted hover:text-fg">← All positions at {job.organization_name}</Link></p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">{job.title}</h1>
      <p className="mt-1 text-sm text-muted">{[job.department, job.location, EMPLOYMENT_TYPE_LABELS[job.employment_type]].filter(Boolean).join(' · ')}</p>
      {job.description && <p className="mt-6 whitespace-pre-line text-sm leading-6">{job.description}</p>}
      <Card className="mt-8">
        <div className="px-5 py-5">
          <h2 className="mb-4 text-base font-semibold">Apply for this position</h2>
          <ApplyForm action={applyAction.bind(null, slug)} requisitionId={job.requisition_id} organization={job.organization_name} />
        </div>
      </Card>
    </main>
  );
}
