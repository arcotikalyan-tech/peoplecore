'use client';

import { useActionState } from 'react';
import { DOCUMENT_CATEGORIES, DOCUMENT_CATEGORY_LABELS, DOCUMENT_PROOFS, DOCUMENT_PROOF_LABELS, type DocumentCategory, type DocumentProof } from '@peoplecore/shared';
import { FormMessage } from '@/components/form-message';
import { SubmitButton } from '@/components/submit-button';
import { Badge } from '@/components/ui/surface';
import { CheckboxGroup, SelectField, TextField } from '@/components/ui/fields';
import { initialActionState, type ActionState } from '@/lib/action-state';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export interface DocumentRow {
  id: string;
  category: DocumentCategory;
  title: string;
  fileName: string;
  size: string;
  uploaded: string;
  uploadedBy: string | null;
  proves?: string[];
  verified?: boolean;
}

const proofOptions = DOCUMENT_PROOFS.map((p) => ({ value: p, label: DOCUMENT_PROOF_LABELS[p] }));

function VerifyButton({ action, document }: { action: Action; document: DocumentRow }) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} className="inline">
      <input type="hidden" name="documentId" value={document.id} />
      <input type="hidden" name="verified" value={document.verified ? 'no' : 'yes'} />
      <SubmitButton size="sm" variant="ghost" pendingLabel="Saving…" aria-label={`${document.verified ? 'Unverify' : 'Verify'} ${document.title}`}>
        {document.verified ? 'Unverify' : '✓ Verify'}
      </SubmitButton>
      {!state.ok && state.message && <span role="alert" className="ml-2 text-xs font-medium text-danger">{state.message}</span>}
    </form>
  );
}

function DeleteButton({ action, document }: { action: Action; document: DocumentRow }) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} className="inline">
      <input type="hidden" name="documentId" value={document.id} />
      <SubmitButton size="sm" variant="ghost" pendingLabel="Deleting…" aria-label={`Delete ${document.title}`}>Delete</SubmitButton>
      {!state.ok && state.message && <span role="alert" className="ml-2 text-xs font-medium text-danger">{state.message}</span>}
    </form>
  );
}

export function DocumentsPanel({
  documents, downloadHref, upload, remove, verify, categories = DOCUMENT_CATEGORIES, proofs = false, empty = 'No documents yet.',
}: {
  documents: DocumentRow[];
  /** Base URL; the document id is appended. */
  downloadHref: string;
  upload?: Action;
  remove?: Action;
  verify?: Action;
  categories?: readonly DocumentCategory[];
  /** Ask what the document proves (IDs tab). */
  proofs?: boolean;
  empty?: string;
}) {
  return (
    <>
      {documents.length === 0 ? (
        <p className="px-5 py-4 text-sm text-muted">{empty}</p>
      ) : (
        <ul className="divide-y divide-line" aria-label="Documents">
          {documents.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-fg">{d.title}</p>
                <p className="text-xs text-muted">
                  {DOCUMENT_CATEGORY_LABELS[d.category]} · {d.fileName} · {d.size} · {d.uploaded}
                  {d.uploadedBy && ` by ${d.uploadedBy}`}
                </p>
                <p className="mt-1 flex flex-wrap gap-1 text-[11px]">
                  {d.verified !== undefined && (
                    <Badge tone={d.verified ? 'success' : 'warning'}>{d.verified ? '✓ Verified' : 'Pending verification'}</Badge>
                  )}
                  {(d.proves ?? []).map((p) => (
                    <span key={p} className="rounded-full bg-subtle px-2 py-0.5 text-muted">{DOCUMENT_PROOF_LABELS[p as DocumentProof] ?? p}</span>
                  ))}
                </p>
              </div>
              <div className="flex items-center gap-1">
                {/* A plain link: the route checks access, records the download and redirects to a short-lived URL. */}
                <a href={`${downloadHref}/${d.id}`} className="rounded-md px-3 py-1.5 text-sm font-medium text-primary hover:bg-subtle"
                  aria-label={`Download ${d.title}`}>
                  Download
                </a>
                {verify && <VerifyButton action={verify} document={d} />}
                {remove && <DeleteButton action={remove} document={d} />}
              </div>
            </li>
          ))}
        </ul>
      )}
      {upload && <UploadForm action={upload} categories={categories} proofs={proofs} />}
    </>
  );
}

function UploadForm({ action, categories, proofs }: { action: Action; categories: readonly DocumentCategory[]; proofs: boolean }) {
  const categoryOptions = categories.map((c) => ({ value: c, label: DOCUMENT_CATEGORY_LABELS[c] }));
  const [state, formAction] = useActionState(action, initialActionState);
  // React resets the form after each submission; failed submissions restore the typed values (the file
  // has to be chosen again, browsers don't allow setting it).
  const v = state.ok ? {} : (state.values ?? {});
  const e = state.fieldErrors ?? {};
  return (
    <form action={formAction} noValidate aria-label="Upload a document" className="space-y-3 border-t border-line bg-subtle/40 px-5 py-4">
      <FormMessage state={state} />
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField idPrefix="doc" name="category" label="Category" required options={categoryOptions} placeholder="Choose…"
          defaultValue={v.category ?? ''} error={e.category} />
        <TextField idPrefix="doc" name="title" label="Title" required placeholder="Offer letter" defaultValue={v.title} error={e.title} />
      </div>
      <TextField idPrefix="doc" name="file" label="File" type="file" required accept="application/pdf,image/jpeg,image/png"
        hint="PDF, JPEG or PNG, up to 5 MB." error={e.file} className="[&_input]:py-2 [&_input]:h-auto" />
      {proofs && <CheckboxGroup idPrefix="doc" name="proves" legend="This document is proof of" options={proofOptions} />}
      <SubmitButton pendingLabel="Uploading…">Upload</SubmitButton>
    </form>
  );
}
