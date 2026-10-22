'use client';

import { useActionState, useState } from 'react';
import { FormMessage } from '@/components/form-message';
import { SubmitButton } from '@/components/submit-button';
import { CARD_FIELDS, CARD_TYPE_LABELS, FIELDS_FOR, TEMPLATES, type CardDesign, type CardType } from '@/lib/id-cards';
import { initialActionState, type ActionState } from '@/lib/action-state';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;
const input = 'h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-sm';
const check = 'size-4 rounded border-line-strong accent-primary';

function Swatch({ t, primary, accent }: { t: (typeof TEMPLATES)[number]; primary: string; accent: string }) {
  return (
    <span aria-hidden className="relative block h-24 w-16 overflow-hidden rounded-md border border-line bg-white" style={{ background: t.tint ? `${primary}14` : '#fff' }}>
      {t.header === 'side' ? <span className="absolute inset-y-0 left-0 w-2" style={{ background: primary }} />
        : t.header !== 'none' && <span className="absolute inset-x-0 top-0" style={{ height: t.header === 'full' ? '45%' : '22%', background: t.header === 'wave' ? `linear-gradient(160deg, ${primary}, ${accent})` : primary, borderBottomLeftRadius: t.header === 'wave' ? '50% 30%' : 0, borderBottomRightRadius: t.header === 'wave' ? '50% 30%' : 0 }} />}
      <span className="absolute left-1/2 top-[38%] size-6 -translate-x-1/2 border-2" style={{ background: accent, borderColor: primary, borderRadius: t.photo === 'circle' ? 9999 : t.photo === 'rounded' ? 6 : 1, left: t.align === 'left' ? '35%' : '50%' }} />
      <span className="absolute inset-x-2 top-[68%] h-1 rounded bg-black/30" /><span className="absolute inset-x-3 top-[76%] h-1 rounded bg-black/15" />
      <span className="absolute inset-x-0 bottom-0 h-1" style={{ background: accent }} />
    </span>
  );
}

/** L1 — Templates: start a design from one, or apply one to the design being edited. */
export function TemplatePicker({ action, design, mode }: { action: Action; design: CardDesign | null; mode: 'create' | 'apply' }) {
  const [state, formAction] = useActionState(action, initialActionState);
  const primary = design?.primary_color ?? '#4f46e5';
  const accent = design?.accent_color ?? '#f97066';
  return (
    <form action={formAction} aria-label={mode === 'create' ? 'New design' : 'Choose template'} className="space-y-4">
      <FormMessage state={state} />
      {design && <input type="hidden" name="designId" value={design.id} />}
      {mode === 'create' && (
        <div className="flex flex-wrap items-end gap-4">
          <label className="block w-full max-w-sm text-sm"><span className="mb-1 block font-medium">Design name</span><input name="name" required defaultValue={state.ok ? '' : state.values?.name ?? ''} placeholder="Head office cards" aria-label="Design name" className={input} /></label>
          <fieldset className="flex gap-2 text-sm" aria-label="Card type"><legend className="sr-only">Card type</legend>
            {(['id', 'visiting'] as const).map((k) => (
              <label key={k} className="flex cursor-pointer items-center gap-2 rounded-lg border border-line px-3 py-2 has-[:checked]:border-primary has-[:checked]:bg-primary-soft">
                <input type="radio" name="cardType" value={k} defaultChecked={(state.values?.cardType ?? 'id') === k} className="accent-primary" />{k === 'id' ? '🪪' : '📇'} {CARD_TYPE_LABELS[k]}
              </label>
            ))}
          </fieldset>
        </div>
      )}
      <fieldset><legend className="mb-2 text-sm font-medium">Template · {TEMPLATES.length} layouts</legend>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-8">
          {TEMPLATES.map((t) => (
            <label key={t.key} className="flex cursor-pointer flex-col items-center gap-1 rounded-xl border border-line p-2 text-xs has-[:checked]:border-primary has-[:checked]:bg-primary-soft">
              <input type="radio" name="template" value={t.key} defaultChecked={(design?.template ?? 'classic') === t.key} className="sr-only" />
              <Swatch t={t} primary={primary} accent={accent} />{t.name}
            </label>
          ))}
        </div>
      </fieldset>
      <SubmitButton>{mode === 'create' ? 'Create design' : 'Apply template'}</SubmitButton>
    </form>
  );
}

/** L2 — Fields and layout, and up to four custom lines (for example "Access: all floors"). */
export function FieldsForm({ action, design }: { action: Action; design: CardDesign }) {
  const [state, formAction] = useActionState(action, initialActionState);
  const kind = (design.card_type === 'visiting' ? 'visiting' : 'id') as CardType;
  const [lines, setLines] = useState(Math.max(design.custom_fields.length, 0));
  return (
    <form action={formAction} aria-label="Fields and layout" className="space-y-4">
      <FormMessage state={state} />
      <input type="hidden" name="designId" value={design.id} />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm"><span className="mb-1 block font-medium">Design name</span><input name="name" defaultValue={design.name} aria-label="Design name" className={input} /></label>
        {kind === 'id' ? (
          <label className="text-sm"><span className="mb-1 block font-medium">Orientation</span>
            <select name="orientation" defaultValue={design.orientation} aria-label="Orientation" className={input}><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></label>
        ) : <input type="hidden" name="orientation" value="landscape" />}
      </div>
      <fieldset><legend className="mb-2 text-sm font-medium">Fields on the {CARD_TYPE_LABELS[kind].toLowerCase()}</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {CARD_FIELDS.filter(([k]) => FIELDS_FOR[kind].includes(k)).map(([k, label]) => (
            <label key={k} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm"><input type="checkbox" name="field" value={k} defaultChecked={design.fields.includes(k)} className={check} />{label}</label>
          ))}
        </div>
      </fieldset>
      <fieldset className="space-y-2"><legend className="mb-1 text-sm font-medium">Custom lines</legend>
        <p className="text-xs text-muted">Printed on every card as given, for example “Access · All floors” or “Shift · General”.</p>
        {Array.from({ length: lines }, (_, i) => (
          <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-2">
            <input name="customLabel" defaultValue={design.custom_fields[i]?.label ?? ''} maxLength={30} placeholder="Label" aria-label={`Custom line ${i + 1} label`} className={input} />
            <input name="customValue" defaultValue={design.custom_fields[i]?.value ?? ''} maxLength={60} placeholder="Value" aria-label={`Custom line ${i + 1} value`} className={input} />
          </div>
        ))}
        {lines < 4 && <button type="button" onClick={() => setLines((n) => n + 1)} className="text-sm text-primary">＋ Add field</button>}
      </fieldset>
      {kind === 'id' && <label className="flex items-center gap-2 text-sm"><input type="hidden" name="photoField" value="1" /><input type="checkbox" name="showPhoto" defaultChecked={design.show_photo} className={check} />Show the photo (initials until photos are added)</label>}
      <SubmitButton>Save fields</SubmitButton>
    </form>
  );
}

/** L3 — Advanced: colours, logo, QR and the back of the card. */
export function AdvancedForm({ action, design }: { action: Action; design: CardDesign }) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} aria-label="Advanced" className="space-y-4">
      <FormMessage state={state} />
      <input type="hidden" name="designId" value={design.id} />
      <div className="grid gap-3 sm:grid-cols-3">
        {([['primary', 'Primary colour', design.primary_color], ['accent', 'Accent colour', design.accent_color], ['text', 'Text colour', design.text_color]] as const).map(([n, l, v]) => (
          <label key={n} className="text-sm"><span className="mb-1 block font-medium">{l}</span><input type="color" name={n} defaultValue={v} aria-label={l} className="h-10 w-full cursor-pointer rounded-md border border-line-strong bg-surface p-1" /></label>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm"><span className="mb-1 block font-medium">Logo (PNG or JPEG, up to 1 MB)</span><input type="file" name="logo" accept="image/png,image/jpeg" aria-label="Logo" className="block w-full text-sm" /></label>
        <label className="text-sm"><span className="mb-1 block font-medium">QR code holds</span>
          <select name="qrContent" defaultValue={design.qr_content} aria-label="QR code holds" className={input}><option value="vcard">Contact card (vCard)</option><option value="employee_code">Employee ID only</option></select></label>
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" name="showLogo" defaultChecked={design.show_logo} className={check} />Show the logo</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="showQr" defaultChecked={design.show_qr} className={check} />Show a QR code</label>
      </div>
      <label className="block text-sm"><span className="mb-1 block font-medium">Back of the card</span>
        <textarea name="backText" rows={3} defaultValue={design.back_text ?? ''} placeholder="If found, please return to …" aria-label="Back of the card" className="w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm" /></label>
      <SubmitButton>Save design</SubmitButton>
    </form>
  );
}

export function SmallAction({ action, fields, label, aria, variant = 'ghost' }: { action: Action; fields: Record<string, string>; label: string; aria: string; variant?: 'ghost' | 'secondary' }) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} aria-label={aria} className="inline-flex items-center gap-2">
      {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {state.message && <span role={state.ok ? 'status' : 'alert'} className={`text-xs ${state.ok ? 'text-success' : 'text-danger'}`}>{state.message}</span>}
      <SubmitButton size="sm" variant={variant} pendingLabel="…">{label}</SubmitButton>
    </form>
  );
}

export function PrintButton() {
  return <button type="button" onClick={() => window.print()} className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-fg print:hidden">🖨 Print</button>;
}
