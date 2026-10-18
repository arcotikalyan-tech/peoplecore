'use server';

import { randomUUID, createHash } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { checkDocumentFile, safeFileName } from '@peoplecore/shared';
import { z } from 'zod';
import { formValues, sqlNull, type ActionState } from '@/lib/action-state';
import { toUserMessage } from '@/lib/db-errors';
import { getOrgContext } from '@/server/context';
import { RECEIPT_BUCKET, removeDocumentFile, storeDocumentFile } from '@/server/document-storage';
import { createClient } from '@/server/supabase';

/** Expense actions. The database checks ownership, drafts, category rules and approvals. */

export async function createClaimAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(orgSlug);
  const title = z.string().trim().min(2, 'Give the claim a title').max(120).safeParse(formData.get('title'));
  if (!title.success) return { ok: false, fieldErrors: { title: 'Give the claim a title' }, values: formValues(formData) };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('create_expense_claim', { p_org: ctx.org.id, p_title: title.data });
  if (error) return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  redirect(`/app/${orgSlug}/expenses/${data}`);
}

const itemSchema = z.object({
  claimId: z.uuid(),
  categoryId: z.uuid({ error: 'Choose a category' }),
  expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date'),
  amount: z.coerce.number({ error: 'Enter the amount' }).positive('Enter the amount').max(9_999_999),
  merchant: z.string().trim().max(120).optional(),
  description: z.string().trim().max(500).optional(),
});

export async function addItemAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(orgSlug);
  const parsed = itemSchema.safeParse(Object.fromEntries([...formData.entries()].filter(([k]) => k !== 'receipt')));
  if (!parsed.success) {
    const fe = Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message]));
    return { ok: false, message: 'Please fix the highlighted fields.', fieldErrors: fe, values: formValues(formData) };
  }
  const v = parsed.data;
  const supabase = await createClient();
  // Only the owner's draft can take items; check before any file is stored (the database checks again).
  const { data: claim } = await supabase.from('expense_claims').select('id, status, employee_id').eq('organization_id', ctx.org.id).eq('id', v.claimId).maybeSingle();
  if (!claim || claim.status !== 'draft') return { ok: false, message: 'Only your own draft claims can take new expenses.' };

  const id = randomUUID();
  let path: string | null = null;
  let receiptName: string | null = null;
  let receiptHash: string | null = null;
  const file = formData.get('receipt');
  if (file instanceof File && file.size > 0) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const check = checkDocumentFile(bytes.byteLength, bytes.subarray(0, 16));
    if (!check.ok) return { ok: false, message: 'Please fix the highlighted fields.', fieldErrors: { receipt: check.message }, values: formValues(formData) };
    path = `${ctx.org.id}/${v.claimId}/${id}`;
    receiptName = safeFileName(file.name);
    receiptHash = createHash('sha256').update(bytes).digest('hex');
    if (!(await storeDocumentFile(path, bytes, check.type, RECEIPT_BUCKET))) {
      return { ok: false, message: 'The receipt could not be stored. Please try again.', values: formValues(formData) };
    }
  }
  const { error } = await supabase.rpc('add_expense_item', {
    p_claim: v.claimId, p_id: id, p_category: v.categoryId, p_date: v.expenseDate, p_amount: v.amount,
    p_merchant: sqlNull(v.merchant || undefined), p_description: sqlNull(v.description || undefined),
    p_receipt_name: sqlNull(receiptName), p_receipt_hash: sqlNull(receiptHash),
  });
  if (error) {
    if (path) await removeDocumentFile(path, RECEIPT_BUCKET);
    return { ok: false, message: toUserMessage(error), values: formValues(formData) };
  }
  revalidatePath(`/app/${orgSlug}/expenses/${v.claimId}`);
  return { ok: true, message: 'Expense added.' };
}

export async function removeItemAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(orgSlug);
  const parsed = z.object({ itemId: z.uuid(), claimId: z.uuid() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: 'Invalid request.' };
  const supabase = await createClient();
  const { data: path, error } = await supabase.rpc('remove_expense_item', { p_item: parsed.data.itemId });
  if (error) return { ok: false, message: toUserMessage(error) };
  if (path) await removeDocumentFile(path, RECEIPT_BUCKET);
  revalidatePath(`/app/${orgSlug}/expenses/${parsed.data.claimId}`);
  return { ok: true, message: 'Removed.' };
}

export async function submitClaimAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(orgSlug);
  const id = z.uuid().safeParse(formData.get('claimId'));
  if (!id.success) return { ok: false, message: 'Invalid request.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('submit_expense_claim', { p_claim: id.data });
  if (error) return { ok: false, message: toUserMessage(error) };
  revalidatePath(`/app/${orgSlug}`, 'layout');
  return { ok: true, message: 'Submitted. Your manager approves first, then finance.' };
}
