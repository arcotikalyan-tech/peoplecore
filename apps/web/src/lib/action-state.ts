import { fieldErrors } from '@peoplecore/shared';
import type { z } from 'zod';

/** Result returned by form server actions and consumed by useActionState. */
export interface ActionState {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
  /** Echo of submitted values so the form keeps user input after a failed submit. */
  values?: Record<string, string>;
}

export const initialActionState: ActionState = { ok: false };

export function formValues(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === 'string' && !k.startsWith('$')) out[k] = v;
  return out;
}

export function invalid(error: z.ZodError, formData: FormData): ActionState {
  return { ok: false, message: 'Please fix the highlighted fields.', fieldErrors: fieldErrors(error), values: formValues(formData) };
}

/** Reads repeated form fields (checkbox groups), which Object.fromEntries would collapse to one value. */
export function formDataAll(formData: FormData, name: string): string[] {
  return formData.getAll(name).filter((v): v is string => typeof v === 'string' && v !== '');
}

/**
 * For RPC parameters without a SQL default: an absent optional value must be sent as null. (supabase-js drops
 * undefined keys, and PostgREST then can't find a function with that set of named arguments.)
 */
export function sqlNull<T>(value: T | undefined | null): T {
  return (value ?? null) as T;
}
