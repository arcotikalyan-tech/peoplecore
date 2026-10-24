import type { ReactNode } from 'react';
import { parseAnnouncement, type Inline } from '@/lib/announcement-format';

function inline(nodes: Inline[]): ReactNode[] {
  return nodes.map((n, i) => {
    if (n.kind === 'text') return n.text;
    if (n.kind === 'link') return <a key={i} href={n.href} target="_blank" rel="noopener noreferrer nofollow" className="text-primary underline underline-offset-2">{inline(n.children)}</a>;
    return n.kind === 'bold' ? <strong key={i} className="font-semibold">{inline(n.children)}</strong> : <em key={i}>{inline(n.children)}</em>;
  });
}

/** An announcement's text with its light formatting (see announcement-format.ts), built from elements, never from HTML. */
export function FormattedText({ text, className }: { text: string; className?: string }) {
  return (
    <div className={className}>
      {parseAnnouncement(text).map((b, i) => {
        if (b.kind === 'heading') return <h3 key={i} className="mt-3 text-base font-semibold first:mt-0">{inline(b.children)}</h3>;
        if (b.kind === 'paragraph') return <p key={i} className="mt-2 first:mt-0">{b.lines.map((l, j) => <span key={j}>{j > 0 && <br />}{inline(l)}</span>)}</p>;
        const items = b.items.map((it, j) => <li key={j}>{inline(it)}</li>);
        return b.kind === 'bullets'
          ? <ul key={i} className="mt-2 list-disc space-y-1 pl-5 first:mt-0">{items}</ul>
          : <ol key={i} className="mt-2 list-decimal space-y-1 pl-5 first:mt-0">{items}</ol>;
      })}
    </div>
  );
}
