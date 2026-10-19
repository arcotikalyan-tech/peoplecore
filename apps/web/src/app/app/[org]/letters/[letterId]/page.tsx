import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { legalName } from '@peoplecore/shared';
import { Badge } from '@/components/ui/surface';
import { formatDate } from '@/lib/format';
import { getOrgContext } from '@/server/context';
import { signImageUrl } from '@/server/document-storage';
import { getEmployee } from '@/server/employees';
import { letterById, letterhead } from '@/server/letters';
import { PrintButton } from '../../separations/[separationId]/letter/[kind]/print-button';
import { letterStatusAction, releaseLettersAction } from '../actions';
import { LetterPaper } from '../letter-view';
import { LetterStatusForm, ReleaseForm } from '../letters-client';

export const metadata: Metadata = { title: 'Letter' };

/** One letter on the letterhead, to print or save as PDF. HR releases or discards drafts and cancels released ones. */
export default async function LetterPage({ params }: { params: Promise<{ org: string; letterId: string }> }) {
  const { org: slug, letterId } = await params;
  if (!z.uuid().safeParse(letterId).success) notFound();
  const ctx = await getOrgContext(slug);
  // RLS: HR sees every letter; the employee only their own released ones.
  const letter = await letterById(letterId);
  if (!letter || letter.organization_id !== ctx.org.id) notFound();
  const hr = ctx.can('letter.manage', 'org');
  const [head, employee] = await Promise.all([letterhead(ctx.org.id, ctx.org.name), hr ? getEmployee(ctx.org.id, letter.employee_id) : Promise.resolve(null)]);
  const sig = letter.signatory as { signature_path?: string | null };
  const signatureUrl = sig.signature_path ? await signImageUrl(sig.signature_path) : null;
  const base = `/app/${slug}/letters`;

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center gap-3 print:hidden">
        <Link className="text-sm text-muted hover:text-fg" href={hr ? `${base}?tab=requests&view=released` : base}>← Letters</Link>
        <h1 className="text-lg font-semibold">{letter.letter_type}{employee ? ` · ${legalName(employee)}` : ''}</h1>
        <Badge tone={letter.status === 'released' ? 'success' : letter.status === 'draft' ? 'primary' : 'neutral'}>{letter.status}</Badge>
        {letter.released_at && <span className="text-xs text-muted">Released {formatDate(letter.released_at.slice(0, 10))}</span>}
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {hr && letter.status === 'draft' && <><ReleaseForm action={releaseLettersAction.bind(null, slug)} ids={[letter.id]} /><LetterStatusForm action={letterStatusAction.bind(null, slug)} id={letter.id} op="delete" label="Discard" /></>}
          {hr && letter.status === 'released' && <LetterStatusForm action={letterStatusAction.bind(null, slug)} id={letter.id} op="cancel" label="Cancel letter" />}
          {letter.status !== 'cancelled' && <PrintButton />}
        </span>
      </div>
      {letter.status === 'cancelled' && <p className="mb-4 rounded-xl border border-line bg-subtle px-4 py-2 text-sm print:hidden">This letter was cancelled and is no longer valid.</p>}
      <div className="overflow-x-auto print:overflow-visible"><LetterPaper body={letter.body} head={head} signatureUrl={signatureUrl} /></div>
    </>
  );
}
