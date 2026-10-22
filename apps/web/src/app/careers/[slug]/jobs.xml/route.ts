import { NextResponse, type NextRequest } from 'next/server';
import { indeedFeed } from '@/lib/job-feed';
import { publicOrigin } from '@/lib/public-origin';
import { createClient } from '@/server/supabase';

/**
 * The organization's open, published jobs as an XML feed in Indeed's format, for job boards that read feeds. Public
 * like the careers page: public_job_feed returns only what the careers page shows.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!/^[a-z0-9-]{3,50}$/.test(slug)) return new NextResponse('Not found', { status: 404 });
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('public_job_feed', { p_org_slug: slug });
  if (error) return new NextResponse('The feed is unavailable right now.', { status: 503 });
  const xml = indeedFeed(data, { origin: publicOrigin(request), slug, now: new Date() });
  return new NextResponse(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=900' } });
}
