'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { sniffDocumentType } from '@peoplecore/shared';
import type { ActionState } from '@/lib/action-state';
import { toUserMessage } from '@/lib/db-errors';
import { getOrgContext } from '@/server/context';
import { IMAGE_BUCKET, removeDocumentFile, storeDocumentFile } from '@/server/document-storage';
import { createClient } from '@/server/supabase';

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const DENIED: ActionState = { ok: false, message: 'You don’t have permission to do that.' };

/** A JPEG or PNG under 2 MB, its type read from the file itself. */
async function readImage(formData: FormData, field: string): Promise<{ bytes: Uint8Array; type: 'image/jpeg' | 'image/png' } | { error: string }> {
  const file = formData.get(field);
  if (!(file instanceof File) || file.size === 0) return { error: 'Choose a picture first.' };
  if (file.size > MAX_IMAGE_BYTES) return { error: 'Use a picture under 2 MB.' };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffDocumentType(bytes.subarray(0, 16));
  return type === 'image/jpeg' || type === 'image/png' ? { bytes, type } : { error: 'Use a JPEG or PNG picture.' };
}

/**
 * Sets an employee's profile photo: their own, or anyone's for people who may update employees. Checked here before
 * anything is stored; set_employee_photo stays the authority (and the self-edit block applies), and the file is
 * removed again if it refuses.
 */
export async function setPhotoAction(slug: string, employeeId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  if (!z.uuid().safeParse(employeeId).success) return DENIED;
  const supabase = await createClient();
  const { data: emp } = await supabase.from('employees').select('id, user_id').eq('organization_id', ctx.org.id).eq('id', employeeId).maybeSingle();
  if (!emp || !(emp.user_id === ctx.user.id || ctx.can('employee.update'))) return DENIED;
  const image = await readImage(formData, 'photo');
  if ('error' in image) return { ok: false, message: image.error };

  const path = `${ctx.org.id}/${employeeId}/${randomUUID()}`;
  if (!(await storeDocumentFile(path, image.bytes, image.type, IMAGE_BUCKET))) return { ok: false, message: 'The photo couldn’t be saved. Try again.' };
  const { data: old, error } = await supabase.rpc('set_employee_photo', { p_employee: employeeId, p_path: path });
  if (error) {
    await removeDocumentFile(path, IMAGE_BUCKET);
    return { ok: false, message: toUserMessage(error) };
  }
  if (old) await removeDocumentFile(old, IMAGE_BUCKET);
  revalidatePath(`/app/${slug}`, 'layout');
  return { ok: true, message: 'Photo saved.' };
}

export async function removePhotoAction(slug: string, employeeId: string): Promise<ActionState> {
  await getOrgContext(slug);
  if (!z.uuid().safeParse(employeeId).success) return DENIED;
  const supabase = await createClient();
  const { data: old, error } = await supabase.rpc('set_employee_photo', { p_employee: employeeId, p_path: null as unknown as string });
  if (error) return { ok: false, message: toUserMessage(error) };
  if (old) await removeDocumentFile(old, IMAGE_BUCKET);
  revalidatePath(`/app/${slug}`, 'layout');
  return { ok: true, message: 'Photo removed.' };
}

/** The company logo (org.manage), shown in the app for everyone in the organization. */
export async function setLogoAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  if (!ctx.can('org.manage', 'org')) return DENIED;
  const image = await readImage(formData, 'logo');
  if ('error' in image) return { ok: false, message: image.error };
  const path = `${ctx.org.id}/logo/${randomUUID()}`;
  if (!(await storeDocumentFile(path, image.bytes, image.type, IMAGE_BUCKET))) return { ok: false, message: 'The logo couldn’t be saved. Try again.' };
  const supabase = await createClient();
  const { data: old, error } = await supabase.rpc('set_company_logo', { p_org: ctx.org.id, p_path: path });
  if (error) {
    await removeDocumentFile(path, IMAGE_BUCKET);
    return { ok: false, message: toUserMessage(error) };
  }
  if (old) await removeDocumentFile(old, IMAGE_BUCKET);
  revalidatePath(`/app/${slug}`, 'layout');
  return { ok: true, message: 'Logo saved.' };
}

export async function removeLogoAction(slug: string): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  if (!ctx.can('org.manage', 'org')) return DENIED;
  const supabase = await createClient();
  const { data: old, error } = await supabase.rpc('set_company_logo', { p_org: ctx.org.id, p_path: null as unknown as string });
  if (error) return { ok: false, message: toUserMessage(error) };
  if (old) await removeDocumentFile(old, IMAGE_BUCKET);
  revalidatePath(`/app/${slug}`, 'layout');
  return { ok: true, message: 'Logo removed.' };
}
