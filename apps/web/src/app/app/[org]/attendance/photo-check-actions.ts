'use server';

import { selfieReview, type SelfieReview } from '@peoplecore/ai';
import { sniffDocumentType } from '@peoplecore/shared';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { ActionState } from '@/lib/action-state';
import { toUserMessage } from '@/lib/db-errors';
import { runAi } from '@/server/ai';
import { getOrgContext } from '@/server/context';
import { readSelfieAndPhoto } from '@/server/document-storage';
import { createClient } from '@/server/supabase';

export interface PhotoCheckState extends ActionState {
  review?: SelfieReview;
}

const asImage = (bytes: Uint8Array | null) => {
  if (!bytes || bytes.byteLength > 2 * 1024 * 1024) return null;
  const type = sniffDocumentType(bytes.subarray(0, 16));
  return type === 'image/jpeg' || type === 'image/png' ? { mediaType: type, data: Buffer.from(bytes).toString('base64') } : null;
};

/**
 * The AI photo check of one punch, for attendance managers: does the check-in photo look live, and does it match
 * the profile photo? A suggestion only; the reviewer decides whether to flag the punch.
 */
export async function checkPunchPhotoAction(orgSlug: string, _prev: PhotoCheckState, formData: FormData): Promise<PhotoCheckState> {
  const ctx = await getOrgContext(orgSlug);
  if (!ctx.can('attendance.manage', 'org')) return { ok: false, message: 'You don’t have permission to do that.' };
  const punchId = z.uuid().safeParse(formData.get('punchId'));
  if (!punchId.success) return { ok: false, message: 'Punch not found.' };
  const supabase = await createClient();
  const { data: path } = await supabase.rpc('punch_selfie', { p_punch: punchId.data });
  const { data: punch } = await supabase.from('attendance_punches').select('employee_id').eq('organization_id', ctx.org.id).eq('id', punchId.data).maybeSingle();
  if (!path || !punch) return { ok: false, message: 'This punch has no photo.' };
  const { data: emp } = await supabase.from('employees').select('photo_path').eq('organization_id', ctx.org.id).eq('id', punch.employee_id).maybeSingle();
  const files = await readSelfieAndPhoto(path, emp?.photo_path ?? null);
  const photo = asImage(files.selfie);
  if (!photo) return { ok: false, message: 'The photo couldn’t be read. Try again later.' };
  const result = await runAi(ctx, selfieReview, { photo, profilePhoto: asImage(files.photo) });
  if (!result.ok) return { ok: false, message: result.message };
  return { ok: true, review: result.output };
}

/** Flags a punch's photo for review, with the reviewer's note (they decide; the AI only suggested). */
export async function flagPunchPhotoAction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(orgSlug);
  const parsed = z.object({ punchId: z.uuid(), note: z.string().trim().min(3, 'Say what looks wrong').max(400) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? 'Check the note.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('flag_punch_photo', { p_punch: parsed.data.punchId, p_note: parsed.data.note });
  if (error) return { ok: false, message: toUserMessage(error) };
  revalidatePath(`/app/${orgSlug}/attendance`);
  return { ok: true, message: 'Flagged for review under Attendance › Approvals.' };
}
