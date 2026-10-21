'use client';

import { Eye, EyeOff } from 'lucide-react';
import { useState, type ComponentProps } from 'react';
import { cn } from './cn';
import { aria, controlClass, FieldShell, fieldId, type FieldProps } from './fields';

/** A password input with a show / hide button, so people can check what they typed. */
export function PasswordField({
  name, label, error, hint, required, className, idPrefix, ...input
}: FieldProps & Omit<ComponentProps<'input'>, 'name' | 'id' | 'type'>) {
  const id = fieldId(name, idPrefix);
  const [visible, setVisible] = useState(false);
  return (
    <FieldShell {...{ id, label, error, hint, required, className }}>
      <div className="relative">
        <input name={name} type={visible ? 'text' : 'password'} required={required} className={cn(controlClass(!!error), 'h-10 pr-10')} {...aria(id, error, hint)} {...input} />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          className="absolute inset-y-0 right-0 grid w-10 place-items-center rounded-r-md text-muted hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
        >
          {visible ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
        </button>
      </div>
    </FieldShell>
  );
}
