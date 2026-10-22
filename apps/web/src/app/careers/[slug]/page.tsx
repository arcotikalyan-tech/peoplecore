import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EMPLOYMENT_TYPE_LABELS } from '@peoplecore/shared';
import { Brand } from '@/components/brand';
import { Card } from '@/components/ui/surface';
import { createClient } from '@/server/supabase';

export const metadata: Metadata = { title: 'Careers' };

/** Public careers page: open, published positions (public_job_postings; no sign-in, no table access). */
export default async function CareersPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!/^[a-z0-9-]{3,50}$/.test(slug)) notFound();
  const supabase = await createClient();
  const { data: jobs, error } = await supabase.rpc('public_job_postings', { p_org_slug: slug });
  if (error) throw new Error('Failed to load open positions');
  const org = jobs[0]?.organization_name;

  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <Brand />
      <h1 className="mt-8 text-2xl font-semibold tracking-tight">{org ? `Careers at ${org}` : 'Careers'}</h1>
      <p className="mt-1 text-sm text-muted">{jobs.length ? `${jobs.length} open position${jobs.length === 1 ? '' : 's'}` : 'There are no open positions right now.'}</p>
      <ul className="mt-6 space-y-3" aria-label="Open positions">
        {jobs.map((j) => (
          <li key={j.requisition_id}>
            <Card>
              <Link href={`/careers/${slug}/${j.requisition_id}`} className="block px-5 py-4 hover:bg-subtle">
                <p className="font-medium">{j.title}</p>
                <p className="text-sm text-muted">{[j.department, j.location, EMPLOYMENT_TYPE_LABELS[j.employment_type]].filter(Boolean).join(' · ')}</p>
              </Link>
            </Card>
          </li>
        ))}
      </ul>
      {jobs.length > 0 && <p className="mt-8 text-xs text-muted">For job boards: <a className="text-primary hover:underline" href={`/careers/${slug}/jobs.xml`}>jobs feed (XML)</a></p>}
    </main>
  );
}
