import type { ComponentProps, ReactNode } from 'react';
import { cn } from './cn';

/** Label + control + hint + error with aria wiring done once, so every form is accessible by default. */

interface FieldProps {
  name: string;
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  className?: string;
  /** Distinguishes element ids when two forms on one page share a field name. */
  idPrefix?: string;
}

const controlClass = (invalid: boolean) =>
  cn(
    'block w-full rounded-md border bg-surface px-3 text-sm text-fg shadow-xs placeholder:text-muted/70',
    'focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25',
    'disabled:cursor-not-allowed disabled:bg-subtle',
    invalid ? 'border-danger' : 'border-line-strong',
  );

const fieldId = (name: string, idPrefix?: string) => `f-${idPrefix ? `${idPrefix}-` : ''}${name}`;

function FieldShell({ id, label, error, hint, required, className, children }: Omit<FieldProps, 'name'> & { id: string; children: ReactNode }) {
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

function aria(id: string, error?: string, hint?: string) {
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
