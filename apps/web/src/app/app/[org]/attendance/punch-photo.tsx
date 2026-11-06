import { cn } from '@/components/ui/cn';

/** A punch's selfie, small; a click opens it full size. Both go through the route that checks who may see it. */
export function PunchPhoto({ slug, punchId, label, className }: { slug: string; punchId: string; label: string; className?: string }) {
  const src = `/app/${slug}/attendance/selfie/${punchId}`;
  return (
    <a href={src} target="_blank" rel="noreferrer" aria-label={label} className="inline-block">
      {/* eslint-disable-next-line @next/next/no-img-element -- a short-lived private link behind a permission check */}
      <img src={src} alt={label} loading="lazy" className={cn('size-10 rounded-md object-cover', className)} />
    </a>
  );
}
