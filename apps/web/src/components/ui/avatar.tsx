import { cn } from './cn';

/** Initials on a colour picked from the name, so the same person always gets the same colour. */
const TONES = [
  'bg-[#f26b55] text-white', 'bg-[#7c6cff] text-white', 'bg-[#2fb47c] text-white', 'bg-[#e0a43a] text-black',
  'bg-[#4a9df8] text-white', 'bg-[#d4569a] text-white', 'bg-[#17a2b8] text-white', 'bg-[#8d6e63] text-white',
];

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts.at(-1)![0] : '')).toUpperCase();
}

function tone(name: string) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return TONES[h % TONES.length];
}

/** A profile photo when there is one (a short-lived signed link), otherwise initials. */
export function Avatar({ name, size = 'md', className, src }: { name: string; size?: 'sm' | 'md' | 'lg'; className?: string; src?: string | null }) {
  const box = size === 'sm' ? 'size-7 text-[11px]' : size === 'lg' ? 'size-12 text-base' : 'size-9 text-xs';
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element -- signed storage links change every request; next/image would cache them
    return <img src={src} alt="" aria-hidden="true" className={cn('inline-block shrink-0 rounded-full bg-subtle object-cover', box, className)} />;
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-grid shrink-0 place-items-center rounded-full font-semibold',
        box,
        tone(name),
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
