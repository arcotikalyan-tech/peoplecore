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

export function Avatar({ name, size = 'md', className }: { name: string; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-grid shrink-0 place-items-center rounded-full font-semibold',
        size === 'sm' ? 'size-7 text-[11px]' : size === 'lg' ? 'size-12 text-base' : 'size-9 text-xs',
        tone(name),
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
