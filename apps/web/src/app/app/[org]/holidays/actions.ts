'use server';

import { revalidatePath } from 'next/cache';
import { parseCsv } from '@peoplecore/shared';
import { z } from 'zod';
import { formValues, invalid, type ActionState } from '@/lib/action-state';
import { toUserMessage } from '@/lib/db-errors';
import { getOrgContext } from '@/server/context';
import { flash } from '@/server/flash';
import { createClient } from '@/server/supabase';

/** Holiday calendars, holidays and optional-holiday choices. leave.manage edits calendars (RLS); everyone chooses their own. */

const DENIED: ActionState = { ok: false, message: 'You don’t have permission to do that.' };
const optional = <T extends z.ZodType>(schema: T) => z.preprocess((v) => (v === '' ? undefined : v), schema.optional());
const back = (slug: string) => { revalidatePath(`/app/${slug}/holidays`, 'layout'); revalidatePath(`/app/${slug}/leave`, 'layout'); };

export async function addHolidayAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  if (!ctx.can('leave.manage', 'org')) return DENIED;
  const parsed = z.object({
    calendarId: z.uuid({ error: 'Choose a calendar' }),
    date: z.iso.date({ error: 'Enter a valid date' }),
    name: z.string().trim().min(2, 'Name the holiday').max(80),
    description: optional(z.string().trim().max(200)),
    kind: z.enum(['public', 'optional']),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.from('holidays').insert({
    organization_id: ctx.org.id, calendar_id: v.calendarId, holiday_date: v.date, name: v.name, description: v.description ?? null, is_optional: v.kind === 'optional',
  });
  if (error) return { ok: false, message: error.code === '23505' ? 'There is already a holiday on that date.' : toUserMessage(error), values: formValues(formData) };
  back(slug);
  return { ok: true, message: `${v.name} added.` };
}

export async function removeHolidayAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  if (!ctx.can('leave.manage', 'org')) return DENIED;
  const id = z.uuid().safeParse(formData.get('holidayId'));
  if (!id.success) return { ok: false, message: 'Holiday not found.' };
  const supabase = await createClient();
  const { error } = await supabase.from('holidays').delete().eq('organization_id', ctx.org.id).eq('id', id.data);
  if (error) return { ok: false, message: toUserMessage(error) };
  back(slug);
  await flash('Holiday removed.');
  return { ok: true, message: 'Holiday removed.' };
}

/** CSV with date (YYYY-MM-DD), name, and optionally type (public/optional) and description. */
export async function importHolidaysAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  if (!ctx.can('leave.manage', 'org')) return DENIED;
  const calendarId = z.uuid().safeParse(formData.get('calendarId'));
  const file = formData.get('file');
  if (!calendarId.success) return { ok: false, message: 'Choose a calendar.' };
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: 'Choose a CSV file.' };
  let rows: string[][];
  try { rows = parseCsv(await file.text()); } catch (e) { return { ok: false, message: e instanceof Error ? e.message : 'The file could not be read.' }; }
  const [head, ...body] = rows;
  const col = (k: string) => (head ?? []).findIndex((h) => h.trim().toLowerCase() === k);
  const [di, ni, ti, de] = ['date', 'name', 'type', 'description'].map(col) as [number, number, number, number];
  if (di < 0 || ni < 0) return { ok: false, message: 'The file needs date and name columns.' };
  const problems: string[] = [];
  const records = body.flatMap((r, i) => {
    if (r.every((c) => !c.trim())) return [];
    const date = (r[di] ?? '').trim(); const name = (r[ni] ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) problems.push(`Line ${i + 2}: date must be YYYY-MM-DD.`);
    if (name.length < 2) problems.push(`Line ${i + 2}: name is missing.`);
    return [{ organization_id: ctx.org.id, calendar_id: calendarId.data, holiday_date: date, name: name.slice(0, 80),
      is_optional: ti >= 0 && /^(optional|restricted|yes)$/i.test((r[ti] ?? '').trim()), description: de >= 0 ? (r[de] ?? '').trim().slice(0, 200) || null : null }];
  });
  if (problems.length) return { ok: false, message: `Nothing imported. ${problems.slice(0, 3).join(' ')}` };
  const supabase = await createClient();
  const { error } = await supabase.from('holidays').upsert(records, { onConflict: 'calendar_id,holiday_date' });
  if (error) return { ok: false, message: `Nothing imported. ${toUserMessage(error)}` };
  back(slug);
  return { ok: true, message: `Imported ${records.length} holiday${records.length === 1 ? '' : 's'}.` };
}

/** Copy a year's holidays to the next year on the same dates (for fixed-date holidays; edit the rest). */
export async function copyYearAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  if (!ctx.can('leave.manage', 'org')) return DENIED;
  const parsed = z.object({ calendarId: z.uuid(), year: z.coerce.number().int().min(2000).max(2200) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: 'Choose a calendar and year.' };
  const { calendarId, year } = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.from('holidays').select('holiday_date, name, is_optional, description')
    .eq('organization_id', ctx.org.id).eq('calendar_id', calendarId).gte('holiday_date', `${year}-01-01`).lte('holiday_date', `${year}-12-31`);
  if (error) return { ok: false, message: toUserMessage(error) };
  const rows = (data ?? []).filter((h) => h.holiday_date.slice(5) !== '02-29').map((h) => ({
    organization_id: ctx.org.id, calendar_id: calendarId, holiday_date: `${year + 1}${h.holiday_date.slice(4)}`, name: h.name, is_optional: h.is_optional, description: h.description,
  }));
  if (rows.length === 0) return { ok: false, message: `No holidays in ${year} to copy.` };
  const { error: e2 } = await supabase.from('holidays').upsert(rows, { onConflict: 'calendar_id,holiday_date', ignoreDuplicates: true });
  if (e2) return { ok: false, message: toUserMessage(e2) };
  back(slug);
  return { ok: true, message: `Copied ${rows.length} holidays to ${year + 1}. Move festivals that change date.` };
}

export async function saveCalendarAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  if (!ctx.can('leave.manage', 'org')) return DENIED;
  const parsed = z.object({
    calendarId: optional(z.uuid()),
    locationId: optional(z.uuid()),
    name: z.string().trim().min(2, 'Name the calendar').max(80),
    optionalLimit: z.coerce.number({ error: 'Enter a number' }).int().min(0, '0 to 20').max(20, '0 to 20'),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error, formData);
  const v = parsed.data;
  const offs = formData.getAll('off').map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  const supabase = await createClient();
  const row = { name: v.name, optional_limit: v.optionalLimit, weekly_offs: offs };
  const { error } = v.calendarId
    ? await supabase.from('holiday_calendars').update(row).eq('organization_id', ctx.org.id).eq('id', v.calendarId)
    : await supabase.from('holiday_calendars').insert({ ...row, organization_id: ctx.org.id, location_id: v.locationId ?? null });
  if (error) return { ok: false, message: error.code === '23505' ? 'That location already has its own calendar.' : toUserMessage(error), values: formValues(formData) };
  back(slug);
  return { ok: true, message: v.calendarId ? 'Calendar saved.' : `Calendar ${v.name} added.` };
}

export async function deleteCalendarAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getOrgContext(slug);
  if (!ctx.can('leave.manage', 'org')) return DENIED;
  const id = z.uuid().safeParse(formData.get('calendarId'));
  if (!id.success) return { ok: false, message: 'Calendar not found.' };
  const supabase = await createClient();
  const { error } = await supabase.from('holiday_calendars').delete().eq('organization_id', ctx.org.id).eq('id', id.data).not('location_id', 'is', null);
  if (error) return { ok: false, message: toUserMessage(error) };
  back(slug);
  await flash('Calendar removed. That location follows the default calendar again.');
  return { ok: true, message: 'Calendar removed.' };
}

export async function chooseOptionalAction(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await getOrgContext(slug);
  const parsed = z.object({ holidayId: z.uuid(), choose: z.enum(['yes', 'no']) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: 'Holiday not found.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('choose_optional_holiday', { p_holiday: parsed.data.holidayId, p_choose: parsed.data.choose === 'yes' });
  if (error) return { ok: false, message: toUserMessage(error) };
  back(slug);
  return { ok: true, message: parsed.data.choose === 'yes' ? 'Added to your holidays.' : 'Removed.' };
}
