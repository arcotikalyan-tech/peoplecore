'use client';

import { useActionState, useMemo, useState } from 'react';
import {
  ACCOUNT_EMAIL_KEYS, ACCOUNT_EMAILS, accountEmail, DEFAULT_EMAIL_LAYOUT, EMAIL_VARIABLES, layoutProblems, renderEmail, templateProblems,
  type AccountEmailKey, type AccountEmailText, type EmailLayout,
} from '@peoplecore/shared';
import { FormMessage } from '@/components/form-message';
import { SubmitButton } from '@/components/submit-button';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { fieldId, TextAreaField, TextField } from '@/components/ui/fields';
import { Badge, Card, CardHeader } from '@/components/ui/surface';
import { initialActionState, type ActionState } from '@/lib/action-state';
import { resetEmailTemplateAction, saveEmailLayoutAction, saveEmailTemplateAction, sendTestEmailAction } from './actions';
import { sampleMessage, sampleValues } from './samples';

type Item = 'layout' | AccountEmailKey | 'notification';
type Field = keyof AccountEmailText;

/** Platform › Email templates: the shared layout, each account email's words, and a live preview of either. */
export function EmailTemplatesEditor({ layout, texts, edited, email, origin, from }: {
  layout: EmailLayout;
  texts: Record<AccountEmailKey, AccountEmailText>;
  edited: AccountEmailKey[];
  /** The administrator's address, for the example values and test emails. */
  email: string;
  /** The app's address, for the logo and example links. */
  origin: string;
  /** The sender's address (EMAIL_FROM). */
  from: string | null;
}) {
  const [item, setItem] = useState<Item>('layout');
  const [draftLayout, setDraftLayout] = useState(layout);
  const [drafts, setDrafts] = useState(texts);
  const [phone, setPhone] = useState(false);

  const previewKey: AccountEmailKey | 'notification' = item === 'layout' ? 'notification' : item;
  const preview = useMemo(() => {
    if (previewKey === 'notification') return renderEmail(draftLayout, sampleMessage(draftLayout.brandName, origin), { appUrl: origin });
    const s = sampleValues(previewKey, email, draftLayout.brandName, origin);
    return renderEmail(draftLayout, accountEmail(previewKey, drafts[previewKey], s.values, s), { appUrl: origin });
  }, [previewKey, draftLayout, drafts, email, origin]);

  const items: Array<{ id: Item; label: string; badge?: string }> = [
    { id: 'layout', label: 'Layout (every email)' },
    ...ACCOUNT_EMAIL_KEYS.map((k) => ({ id: k, label: ACCOUNT_EMAILS[k].label, badge: edited.includes(k) ? 'Edited' : undefined })),
    { id: 'notification', label: 'Notifications' },
  ];

  return (
    <div className="space-y-4">
      <nav aria-label="Emails" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
        {items.map((i) => (
          <button
            key={i.id} type="button" onClick={() => setItem(i.id)} aria-current={item === i.id ? 'page' : undefined}
            className={cn('inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-sm',
              item === i.id ? 'border-primary bg-primary-soft font-medium text-fg' : 'border-line text-muted hover:text-fg')}
          >
            {i.label}
            {i.badge && <Badge tone="primary">{i.badge}</Badge>}
          </button>
        ))}
      </nav>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          {item === 'layout' && <LayoutForm draft={draftLayout} onChange={setDraftLayout} saved={layout} />}
          {item === 'notification' && <NotificationsCard layout={draftLayout} />}
          {item !== 'layout' && item !== 'notification' && (
            <TemplateForm
              key={item} emailKey={item} draft={drafts[item]} layout={draftLayout} edited={edited.includes(item)}
              onChange={(t) => setDrafts((d) => ({ ...d, [item]: t }))}
              onReset={() => setDrafts((d) => ({ ...d, [item]: ACCOUNT_EMAILS[item].defaults }))}
            />
          )}
        </div>

        <section aria-label="Preview" className="min-w-0 lg:sticky lg:top-4 lg:self-start">
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
              <div className="min-w-0 text-sm">
                <p className="truncate"><span className="text-muted">From </span>{draftLayout.brandName}{from ? ` <${from}>` : ''}</p>
                <p className="truncate font-medium" data-testid="preview-subject">{preview.subject}</p>
              </div>
              <div className="flex gap-1" role="group" aria-label="Preview width">
                <Button size="sm" variant={phone ? 'ghost' : 'secondary'} aria-pressed={!phone} onClick={() => setPhone(false)}>Desktop</Button>
                <Button size="sm" variant={phone ? 'secondary' : 'ghost'} aria-pressed={phone} onClick={() => setPhone(true)}>Phone</Button>
              </div>
            </div>
            <div className="bg-subtle p-3">
              {/* No scripts in the preview (sandbox); the email is the same HTML that is sent. */}
              <iframe
                title="Email preview" sandbox="" srcDoc={preview.html}
                className={cn('mx-auto block h-[620px] w-full rounded-md border border-line bg-white', phone && 'max-w-[390px]')}
              />
            </div>
            <p className="px-4 py-2 text-xs text-muted">Example values: {email}, {'“Acme Technologies”'}, invited by Ravi Kumar. Links in the preview and test emails don’t work.</p>
          </Card>
        </section>
      </div>
    </div>
  );
}

/** The layout's fields as hidden inputs, so a test email uses what is on screen. */
function LayoutInputs({ layout }: { layout: EmailLayout }) {
  return (
    <>
      <input type="hidden" name="brandName" value={layout.brandName} />
      <input type="hidden" name="accentColor" value={layout.accentColor} />
      <input type="hidden" name="logoUrl" value={layout.logoUrl ?? ''} />
      {layout.showBrandName && <input type="hidden" name="showBrandName" value="on" />}
      <input type="hidden" name="footerText" value={layout.footerText} />
      <input type="hidden" name="supportEmail" value={layout.supportEmail ?? ''} />
      <input type="hidden" name="address" value={layout.address ?? ''} />
    </>
  );
}

function LayoutForm({ draft, onChange, saved }: { draft: EmailLayout; onChange: (l: EmailLayout) => void; saved: EmailLayout }) {
  const [latest, setLatest] = useState<'save' | 'test'>('save');
  const [state, action] = useActionState(async (p: ActionState, fd: FormData) => { setLatest('save'); return saveEmailLayoutAction(p, fd); }, initialActionState);
  const [testState, testAction] = useActionState(async (p: ActionState, fd: FormData) => { setLatest('test'); return sendTestEmailAction(p, fd); }, initialActionState);
  // The server checks the same rules; showing them as you type keeps the errors current.
  const e: Partial<Record<string, string>> = layoutProblems(draft);
  const set = <K extends keyof EmailLayout>(k: K, v: EmailLayout[K]) => onChange({ ...draft, [k]: v });
  const changed = JSON.stringify(draft) !== JSON.stringify(saved);

  return (
    <Card>
      <CardHeader title="Layout" description="The frame around every email PeopleCore sends, for every organization: invitations, password resets, approvals, payslips and the rest." />
      <form action={action} noValidate className="space-y-4 px-5 pb-5">
        <FormMessage state={latest === 'test' ? testState : state} />
        <input type="hidden" name="key" value="notification" />
        <TextField name="brandName" label="Brand name" required maxLength={60} value={draft.brandName} onChange={(ev) => set('brandName', ev.target.value)} error={e.brandName} hint="Shown at the top, as the sender’s name and on the buttons (“Open in …”)." />
        <div className="grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)]">
          <div>
            <label htmlFor="f-accentPicker" className="mb-1.5 block text-sm font-medium text-fg">Colour</label>
            <input id="f-accentPicker" type="color" aria-label="Pick the accent colour" value={/^#[0-9a-fA-F]{6}$/.test(draft.accentColor) ? draft.accentColor : DEFAULT_EMAIL_LAYOUT.accentColor}
              onChange={(ev) => set('accentColor', ev.target.value)} className="h-10 w-16 cursor-pointer rounded-md border border-line-strong bg-surface p-1" />
          </div>
          <TextField name="accentColor" label="Accent colour (hex)" required value={draft.accentColor} onChange={(ev) => set('accentColor', ev.target.value)} error={e.accentColor} hint="Buttons and links. Button text turns dark on light colours." />
        </div>
        <TextField name="logoUrl" label="Logo address" type="url" placeholder="https://…/logo.png" value={draft.logoUrl ?? ''} onChange={(ev) => set('logoUrl', ev.target.value || null)} error={e.logoUrl}
          hint="Optional: an https link to a PNG or JPEG, shown 32 pixels high. Empty: the PeopleCore mark. Logos on other sites may not show in this preview, but do in emails." />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="showBrandName" checked={draft.showBrandName} onChange={(ev) => set('showBrandName', ev.target.checked)} className="size-4 rounded border-line-strong" />
          Show the brand name next to the logo
        </label>
        <TextAreaField name="footerText" label="Footer" rows={2} maxLength={500} value={draft.footerText} onChange={(ev) => set('footerText', ev.target.value)} error={e.footerText} hint="Under every email. Leave empty for none." />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField name="supportEmail" label="Support email" type="email" value={draft.supportEmail ?? ''} onChange={(ev) => set('supportEmail', ev.target.value || null)} error={e.supportEmail} hint="Optional: “Questions? …” in the footer." />
          <TextField name="address" label="Postal address" maxLength={200} value={draft.address ?? ''} onChange={(ev) => set('address', ev.target.value || null)} error={e.address} hint="Optional, one line." />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={() => onChange(DEFAULT_EMAIL_LAYOUT)}>Use the standard layout</Button>
          <div className="flex flex-wrap gap-2">
            <SubmitButton variant="secondary" formAction={testAction} pendingLabel="Sending…">Send me a test</SubmitButton>
            <SubmitButton disabled={!changed || Object.keys(e).length > 0}>{changed ? 'Save layout' : 'Saved'}</SubmitButton>
          </div>
        </div>
      </form>
    </Card>
  );
}

function TemplateForm({ emailKey, draft, layout, edited, onChange, onReset }: {
  emailKey: AccountEmailKey; draft: AccountEmailText; layout: EmailLayout; edited: boolean;
  onChange: (t: AccountEmailText) => void; onReset: () => void;
}) {
  const def = ACCOUNT_EMAILS[emailKey];
  const [latest, setLatest] = useState<'save' | 'test' | 'reset'>('save');
  const [state, action] = useActionState(async (p: ActionState, fd: FormData) => { setLatest('save'); return saveEmailTemplateAction(p, fd); }, initialActionState);
  const [testState, testAction] = useActionState(async (p: ActionState, fd: FormData) => { setLatest('test'); return sendTestEmailAction(p, fd); }, initialActionState);
  const [resetState, resetAction] = useActionState(async (p: ActionState, fd: FormData) => {
    setLatest('reset');
    const r = await resetEmailTemplateAction(p, fd);
    if (r.ok) onReset();
    return r;
  }, initialActionState);
  const [last, setLast] = useState<Field>('body');
  const e: Partial<Record<string, string>> = templateProblems(emailKey, draft);
  const set = (k: Field, v: string) => onChange({ ...draft, [k]: v });
  const message = latest === 'test' ? testState : latest === 'reset' ? resetState : state;

  /** Puts {{variable}} where the cursor was in the field last used. */
  function insert(variable: string) {
    const field = last;
    const el = document.getElementById(fieldId(field)) as HTMLInputElement | HTMLTextAreaElement | null;
    const value = draft[field] ?? '';
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const token = `{{${variable}}}`;
    set(field, value.slice(0, start) + token + value.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  const bind = (k: Field) => ({
    value: draft[k] ?? '',
    onFocus: () => setLast(k),
    onChange: (ev: { target: { value: string } }) => set(k, ev.target.value),
    error: e[k],
  });

  return (
    <Card>
      <CardHeader
        title={def.label}
        description={def.when}
        actions={<Badge tone={edited ? 'primary' : 'neutral'}>{edited ? 'Edited' : 'Standard text'}</Badge>}
      />
      <form action={action} noValidate className="space-y-4 px-5 pb-5">
        <FormMessage state={message} />
        <input type="hidden" name="key" value={emailKey} />
        <LayoutInputs layout={layout} />
        <TextField name="subject" label="Subject" required maxLength={150} {...bind('subject')} />
        <TextField name="heading" label="Heading" required maxLength={150} {...bind('heading')} />
        <TextAreaField name="body" label="Message" required rows={6} maxLength={4000} {...bind('body')} hint="A blank line starts a new paragraph. **Two stars** make text bold." />
        {def.link && <TextField name="button" label="Button" required maxLength={40} {...bind('button')} hint="The link itself is added by PeopleCore." />}
        {!def.link && <p className="text-sm text-muted">The code is shown in a box under the message.</p>}
        <TextAreaField name="note" label="Small print" rows={2} maxLength={1000} {...bind('note')} hint="Under the button, in small grey text. Optional." />
        <div>
          <p className="mb-1.5 text-sm font-medium text-fg">Fill-ins</p>
          <ul className="flex flex-wrap gap-1.5" aria-label="Fill-ins you can use">
            {def.variables.map((v) => (
              <li key={v}>
                <button type="button" onClick={() => insert(v)} title={`Insert into the field you last used: ${EMAIL_VARIABLES[v]}`}
                  className="rounded-md border border-line bg-subtle px-2 py-1 font-mono text-xs hover:border-primary">
                  {`{{${v}}}`}
                </button>
                <span className="sr-only">{EMAIL_VARIABLES[v]}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-muted">{def.variables.map((v) => `{{${v}}}: ${EMAIL_VARIABLES[v].toLowerCase()}`).join(' · ')}</p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          {edited ? (
            <SubmitButton variant="ghost" size="sm" formAction={resetAction} pendingLabel="Resetting…">Back to the standard text</SubmitButton>
          ) : (
            <Button variant="ghost" size="sm" onClick={onReset}>Undo my changes</Button>
          )}
          <div className="flex flex-wrap gap-2">
            <SubmitButton variant="secondary" formAction={testAction} pendingLabel="Sending…">Send me a test</SubmitButton>
            <SubmitButton disabled={Object.keys(e).length > 0}>Save</SubmitButton>
          </div>
        </div>
      </form>
    </Card>
  );
}

function NotificationsCard({ layout }: { layout: EmailLayout }) {
  const [testState, testAction] = useActionState(sendTestEmailAction, initialActionState);
  return (
    <Card>
      <CardHeader title="Notifications" description="Approvals, decisions, payslips, helpdesk replies, birthdays, sign-up alerts and the rest." />
      <form action={testAction} className="space-y-3 px-5 pb-5 text-sm">
        <FormMessage state={testState} />
        <p>Each organization chooses which of these go out in Settings › Notifications. Their words come from the app (who asked, what for, the approver’s comment), so they aren’t edited here. They use the layout: the brand, logo, colour and footer, with the organization’s name above the heading and an “Open in {layout.brandName}” button.</p>
        <input type="hidden" name="key" value="notification" />
        <LayoutInputs layout={layout} />
        <div className="flex justify-end">
          <SubmitButton variant="secondary" pendingLabel="Sending…">Send me an example</SubmitButton>
        </div>
      </form>
    </Card>
  );
}
