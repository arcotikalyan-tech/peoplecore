import { randomUUID } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { sniffDocumentType } from '@peoplecore/shared';
import { toUserMessage } from '@/lib/db-errors';
import { APP_CORS, appCaller } from '@/server/app-token';
import { removeDocumentFile, SELFIE_BUCKET, storeDocumentFile } from '@/server/document-storage';

/**
 * A check-in or check-out from the phone app with a selfie (when the attendance rule asks for one): the website's
 * punchAction for the app. The app sends its sign-in token; the punch is recorded as that person (record_punch, RLS),
 * and the photo is stored by the server in the private bucket under their own employee folder, only after the token
 * and their employee record check out. Files never reach storage any other way. Punches without a photo go straight
 * from the app to record_punch.
 */

const MAX_BYTES = 2 * 1024 * 1024;
const fields = z.object({
  clientId: z.string().regex(/^[A-Za-z0-9_-]{8,80}$/),
  orgId: z.uuid(),
  punchedAt: z.iso.datetime({ offset: true }).optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  accuracy: z.coerce.number().int().min(0).max(100000).optional(),
});

const CORS = APP_CORS;
const reply = (status: number, body: { ok: boolean; message?: string; id?: string; permanent?: boolean }) =>
  NextResponse.json(body, { status, headers: { ...CORS, 'Cache-Control': 'no-store' } });

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(request: NextRequest) {
  const caller = await appCaller(request);
  if (!caller) return reply(401, { ok: false, message: 'Sign in again.', permanent: false });
  const { supabase, userId } = caller;

  const form = await request.formData().catch(() => null);
  if (!form) return reply(400, { ok: false, message: 'Couldn’t read the punch.', permanent: true });
  const parsed = fields.safeParse(Object.fromEntries([...form.entries()].filter(([k, v]) => k !== 'selfie' && v !== '')));
  if (!parsed.success) return reply(400, { ok: false, message: 'Couldn’t read the punch.', permanent: true });
  const p = parsed.data;

  const file = form.get('selfie');
  if (!(file instanceof File) || file.size === 0) return reply(400, { ok: false, message: 'Take a selfie to check in.', permanent: true });
  if (file.size > MAX_BYTES) return reply(400, { ok: false, message: 'The photo is too large. Please take it again.', permanent: true });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffDocumentType(bytes.subarray(0, 16));
  if (type !== 'image/jpeg' && type !== 'image/png') return reply(400, { ok: false, message: 'Take a photo (JPEG or PNG).', permanent: true });

  // Their own active employee record in that organization, read as them.
  const { data: me } = await supabase.from('employees').select('id').eq('organization_id', p.orgId).eq('user_id', userId)
    .in('status', ['active', 'on_notice']).maybeSingle();
  if (!me) return reply(403, { ok: false, message: 'Your account isn’t linked to an active employee record.', permanent: true });

  const path = `${p.orgId}/${me.id}/${randomUUID()}`;
  if (!(await storeDocumentFile(path, bytes, type, SELFIE_BUCKET))) return reply(503, { ok: false, message: 'The selfie couldn’t be stored. It will be sent again.', permanent: false });
  const ip = (request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || '').slice(0, 64) || undefined;
  const { data: id, error } = await supabase.rpc('record_punch', {
    p_client_id: p.clientId, p_punched_at: p.punchedAt, p_method: 'mobile', p_latitude: p.latitude, p_longitude: p.longitude,
    p_accuracy_m: p.accuracy, p_org: p.orgId, p_ip: ip, p_selfie_path: path,
  });
  if (error) {
    await removeDocumentFile(path, SELFIE_BUCKET);
    const permanent = error.code === '22023' || error.code === '42501' || error.code === 'P0001';
    return reply(permanent ? 400 : 503, { ok: false, message: toUserMessage(error), permanent });
  }
  return reply(200, { ok: true, id: id as string });
}
