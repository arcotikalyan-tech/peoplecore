import { isSignatureLine, paragraphs } from '@/lib/letters';

export interface Letterhead {
  headerStyle: string;
  footerStyle: string;
  headerUrl?: string | null;
  footerUrl?: string | null;
  company: string;
  address?: string | null;
}

/** A letter on the organization's letterhead: header art, body paragraphs, the signature where its tag sits, footer. */
export function LetterPaper({ body, head, signatureUrl, compact = false }: { body: string; head: Letterhead; signatureUrl?: string | null; compact?: boolean }) {
  return (
    <article aria-label="Letter" className={`letter-paper mx-auto flex w-full max-w-[794px] flex-col bg-white text-[#1d1d1f] shadow-sm ring-1 ring-black/10 ${compact ? 'min-h-[520px] text-[12px]' : 'min-h-[1123px] text-[14px]'}`}>
      {head.headerStyle === 'custom' && head.headerUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
        <img src={head.headerUrl} alt={`${head.company} letterhead`} className="w-full" />
      ) : head.headerStyle === 'classic' ? (
        <header className="flex items-end justify-between border-b-4 border-[#4f46e5] px-12 pb-4 pt-10">
          <span className="text-2xl font-extrabold tracking-[0.2em] text-[#4f46e5] uppercase">{head.company || 'Company'}</span>
          {head.address && <span className="max-w-[45%] text-right text-[11px] leading-snug text-[#555]">{head.address}</span>}
        </header>
      ) : null}
      <div className={`flex-1 space-y-4 leading-relaxed ${compact ? 'px-8 py-6' : 'px-12 py-10'}`}>
        {paragraphs(body).map((lines, i) => (
          <p key={i}>
            {lines.map((line, j) => isSignatureLine(line) ? (
              signatureUrl
                // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
                ? <img key={j} src={signatureUrl} alt="Signature" className="my-1 block h-14 w-auto" />
                : <span key={j} className="my-1 block h-12" aria-hidden="true" />
            ) : (
              <span key={j} className="block min-h-[1em]">
                {line.split(/(\[[a-z0-9 ]+\])/g).map((part, k) => /^\[[a-z0-9 ]+\]$/.test(part)
                  ? <mark key={k} className="rounded bg-amber-100 px-0.5 text-amber-800">{part}</mark>
                  : part)}
              </span>
            ))}
          </p>
        ))}
      </div>
      {head.footerStyle === 'custom' && head.footerUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
        <img src={head.footerUrl} alt="" className="w-full" />
      ) : head.footerStyle === 'band' ? (
        <footer className="bg-[#4f46e5] px-12 py-3 text-center text-[10px] tracking-[0.3em] text-white uppercase">{head.company}</footer>
      ) : null}
    </article>
  );
}
