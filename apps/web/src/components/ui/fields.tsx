import type { ComponentProps, ReactNode } from 'react';
import { cn } from './cn';

/** Label + control + hint + error with aria wiring done once, so every form is accessible by default. */

export interface FieldProps {
  name: string;
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  className?: string;
  /** Distinguishes element ids when two forms on one page share a field name. */
  idPrefix?: string;
}

export const controlClass = (invalid: boolean) =>
  cn(
    'block w-full rounded-md border bg-surface px-3 text-sm text-fg shadow-xs placeholder:text-muted/70',
    'focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25',
    'disabled:cursor-not-allowed disabled:bg-subtle',
    invalid ? 'border-danger' : 'border-line-strong',
  );

export const fieldId = (name: string, idPrefix?: string) => `f-${idPrefix ? `${idPrefix}-` : ''}${name}`;

export function FieldShell({ id, label, error, hint, required, className, children }: Omit<FieldProps, 'name'> & { id: string; children: ReactNode }) {
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-fg">
        {label}
        {required && (
          <span className="text-danger" aria-hidden="true">
            {' '}*
          </span>
        )}
      </label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export function aria(id: string, error?: string, hint?: string) {
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ');
  return { id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy || undefined };
}

export function TextField({
  name, label, error, hint, required, className, idPrefix, ...input
}: FieldProps & Omit<ComponentProps<'input'>, 'name' | 'id'>) {
  const id = fieldId(name, idPrefix);
  return (
    <FieldShell {...{ id, label, error, hint, required, className }}>
      <input name={name} required={required} className={cn(controlClass(!!error), 'h-10')} {...aria(id, error, hint)} {...input} />
    </FieldShell>
  );
}

export interface Option {
  value: string;
  label: string;
}

export function SelectField({
  name, label, error, hint, required, className, idPrefix, options, placeholder, ...select
}: FieldProps & Omit<ComponentProps<'select'>, 'name' | 'id'> & { options: readonly Option[]; placeholder?: string }) {
  const id = fieldId(name, idPrefix);
  return (
    <FieldShell {...{ id, label, error, hint, required, className }}>
      <select name={name} required={required} className={cn(controlClass(!!error), 'h-10 pr-8')} {...aria(id, error, hint)} {...select}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

export function TextAreaField({
  name, label, error, hint, required, className, idPrefix, ...textarea
}: FieldProps & Omit<ComponentProps<'textarea'>, 'name' | 'id'>) {
  const id = fieldId(name, idPrefix);
  return (
    <FieldShell {...{ id, label, error, hint, required, className }}>
      <textarea name={name} required={required} className={cn(controlClass(!!error), 'py-2')} rows={3} {...aria(id, error, hint)} {...textarea} />
    </FieldShell>
  );
}

export interface CheckboxOption extends Option {
  description?: string | null;
  disabled?: boolean;
}

/** A labelled group of checkboxes sharing one name (read server-side with formData.getAll). */
export function CheckboxGroup({
  name, legend, options, defaultValues, error, hint, idPrefix, className,
}: {
  name: string;
  legend: string;
  options: readonly CheckboxOption[];
  defaultValues?: readonly string[];
  error?: string;
  hint?: string;
  idPrefix?: string;
  className?: string;
}) {
  const id = fieldId(name, idPrefix);
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined;
  return (
    <fieldset className={className} aria-describedby={describedBy}>
      <legend className="mb-1.5 text-sm font-medium text-fg">{legend}</legend>
      <div className="space-y-2">
        {options.map((o) => (
          <label key={o.value} className={cn('flex items-start gap-2 text-sm', o.disabled && 'opacity-60')}>
            <input
              type="checkbox"
              name={name}
              value={o.value}
              defaultChecked={defaultValues?.includes(o.value)}
              disabled={o.disabled}
              className="mt-0.5 size-4 shrink-0 rounded border-line-strong accent-primary"
            />
            <span>
              <span className="font-medium text-fg">{o.label}</span>
              {o.description && <span className="block text-xs text-muted">{o.description}</span>}
            </span>
          </label>
        ))}
      </div>
      {hint && <p id={`${id}-hint`} className="mt-1 text-xs text-muted">{hint}</p>}
      {error && <p id={`${id}-error`} className="mt-1 text-xs font-medium text-danger">{error}</p>}
    </fieldset>
  );
}
