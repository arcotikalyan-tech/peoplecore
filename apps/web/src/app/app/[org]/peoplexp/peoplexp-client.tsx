'use client';

import { useActionState, useState, type ReactNode } from 'react';
import { FormMessage } from '@/components/form-message';
import { SubmitButton } from '@/components/submit-button';
import { SelectField, TextAreaField, TextField } from '@/components/ui/fields';
import { initialActionState, type ActionState } from '@/lib/action-state';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;
type Counted = ActionState & { n?: number };
type Opt = { value: string; label: string };

function useCounted(action: Action) {
  const [state, formAction] = useActionState<Counted, FormData>(async (prev, fd) => ({ ...(await action(prev, fd)), n: (prev.n ?? 0) + 1 }), initialActionState);
  return { state, formAction, n: state.n ?? 0, v: state.ok ? {} : (state.values ?? {}), e: state.fieldErrors ?? {} };
}
const checkbox = 'size-4 rounded border-line-strong accent-primary';
const AUDIENCES: Opt[] = [{ value: 'org', label: '🌐 Whole organization' }, { value: 'department', label: '🏢 My department' }, { value: 'location', label: '📍 My location' }, { value: 'team', label: '👥 My team' }];

export function PostComposer({ action, canAnnounce }: { action: Action; canAnnounce: boolean }) {
  const { state, formAction, n, v, e } = useCounted(action);
  const kinds: Opt[] = [{ value: 'general', label: '💬 General' }, { value: 'classified', label: '🏷️ Classifieds' }, ...(canAnnounce ? [{ value: 'announcement', label: '📢 Announcement' }] : []), { value: 'celebration', label: '🎉 Celebration' }];
  return (
    <form action={formAction} noValidate aria-label="New post" className="space-y-3">
      <FormMessage state={state} />
      <div key={n} className="space-y-3">
        <TextAreaField idPrefix="post" name="body" label="Share a win — your team wants to celebrate with you!" rows={3} defaultValue={v.body ?? ''} error={e.body} />
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField idPrefix="post" name="kind" label="Type" defaultValue={v.kind ?? 'general'} options={kinds} />
          <SelectField idPrefix="post" name="audience" label="Post to" defaultValue={v.audience ?? 'org'} options={AUDIENCES} />
        </div>
      </div>
      <SubmitButton size="sm">➤ Post</SubmitButton>
    </form>
  );
}

export function RecognizeForm({ action, people, badges, pointsOn }: { action: Action; people: Opt[]; badges: Array<{ id: string; label: string; points: number }>; pointsOn: boolean }) {
  const { state, formAction, n, v, e } = useCounted(action);
  const [q, setQ] = useState('');
  // The selection belongs to one round of the form: after a successful send (n changes) it starts empty again.
  const [sel, setSel] = useState<{ n: number; ids: Set<string> }>({ n: 0, ids: new Set() });
  const round = state.ok ? n : sel.n;
  const picked = sel.n === round ? sel.ids : new Set<string>();
  const shown = people.filter((p) => p.label.toLowerCase().includes(q.toLowerCase())).slice(0, 40);
  const toggle = (id: string) => { const x = new Set(picked); if (x.has(id)) x.delete(id); else x.add(id); setSel({ n: round, ids: x }); };
  return (
    <form action={formAction} noValidate aria-label="Recognize" className="space-y-3" onSubmit={() => undefined}>
      <FormMessage state={state} />
      {[...picked].map((id) => <input key={id} type="hidden" name="recipientId" value={id} />)}
      <div key={n} className="space-y-3">
        <div>
          <TextField idPrefix="rec" name="q" label="Who are you recognising?" value={q} onChange={(ev) => setQ(ev.target.value)} placeholder="Search colleagues" />
          <div className="scroll-thin mt-2 flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
            {shown.map((p) => (
              <button key={p.value} type="button" aria-pressed={picked.has(p.value)} onClick={() => toggle(p.value)}
                className={`rounded-full border px-2.5 py-1 text-xs ${picked.has(p.value) ? 'border-primary bg-primary-soft text-primary' : 'border-line text-muted hover:text-fg'}`}>{p.label}</button>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted">{picked.size} selected</p>
        </div>
        <fieldset><legend className="mb-1.5 text-sm font-medium">Badge</legend>
          <div className="flex flex-wrap gap-2">{badges.map((b, i) => (
            <label key={b.id} className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary-soft">
              <input type="radio" name="badgeId" value={b.id} defaultChecked={(v.badgeId ?? badges[0]?.id) === b.id || (!v.badgeId && i === 0)} className="accent-primary" />{b.label}{pointsOn ? <span className="text-xs text-muted">· {b.points} pts</span> : null}
            </label>
          ))}</div>
          {e.badgeId && <p className="mt-1 text-xs text-danger">{e.badgeId}</p>}
        </fieldset>
        <TextAreaField idPrefix="rec" name="message" label="What did they do?" rows={3} defaultValue={v.message ?? ''} error={e.message} />
        <SelectField idPrefix="rec" name="audience" label="Post to" defaultValue={v.audience ?? 'org'} options={AUDIENCES} />
      </div>
      <SubmitButton size="sm">🏅 Recognize</SubmitButton>
    </form>
  );
}

export function PulseWidget({ action, current, moods }: { action: Action; current: number | null; moods: ReadonlyArray<{ mood: number; emoji: string; label: string }> }) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} aria-label="Pulse check-in" className="space-y-2">
      <p className="text-sm font-medium">● Pulse · How’s your vibe today?</p>
      <div className="flex flex-wrap gap-2">
        {moods.map((m) => (
          <button key={m.mood} name="mood" value={m.mood} aria-pressed={current === m.mood}
            className={`flex flex-col items-center rounded-lg border px-3 py-1.5 text-xs ${current === m.mood ? 'border-primary bg-primary-soft text-primary' : 'border-line text-muted hover:text-fg'}`}>
            <span className="text-xl" aria-hidden="true">{m.emoji}</span>{m.label}
          </button>
        ))}
      </div>
      {state.message && <p className={`text-xs ${state.ok ? 'text-success' : 'text-danger'}`}>{state.message}</p>}
      <p className="text-[11px] text-muted">Your answer is private; HR only sees totals for groups of three or more.</p>
    </form>
  );
}

export function Reactions({ action, postId, counts, mine }: { action: Action; postId: string; counts: Record<string, number>; mine: string[] }) {
  const [, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} aria-label="React" className="flex flex-wrap gap-1">
      <input type="hidden" name="postId" value={postId} />
      {['👏', '❤️', '🎉', '😂', '💡'].map((em) => (
        <button key={em} name="emoji" value={em} aria-pressed={mine.includes(em)} aria-label={`React ${em}`}
          className={`rounded-full border px-2 py-0.5 text-xs ${mine.includes(em) ? 'border-primary bg-primary-soft' : 'border-line hover:bg-subtle'}`}>{em}{counts[em] ? ` ${counts[em]}` : ''}</button>
      ))}
    </form>
  );
}

export function CommentForm({ action, postId }: { action: Action; postId: string }) {
  const { state, formAction, n } = useCounted(action);
  return (
    <form action={formAction} noValidate aria-label="Comment" className="flex gap-2">
      <input type="hidden" name="postId" value={postId} />
      <input key={n} name="body" placeholder="Write a comment…" aria-label="Comment" className="h-8 min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-2 text-sm" />
      <SubmitButton size="sm" variant="ghost" pendingLabel="…">Reply</SubmitButton>
      {!state.ok && state.message && <span role="alert" className="text-xs text-danger">{state.message}</span>}
    </form>
  );
}

/** One-button forms (delete, approve/reject, fulfil, redeem). Extra buttons send name/value pairs. */
export function Buttons({ action, hidden, label, buttons, note, confirm }: {
  action: Action; hidden: Record<string, string>; label: string; buttons: Array<{ text: string; name?: string; value?: string; variant?: 'primary' | 'secondary' | 'ghost' | 'danger' }>;
  note?: string; confirm?: string;
}) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} aria-label={label} className="inline-flex flex-wrap items-center gap-1" onSubmit={(ev) => { if (confirm && !window.confirm(confirm)) ev.preventDefault(); }}>
      {Object.entries(hidden).map(([k, val]) => <input key={k} type="hidden" name={k} value={val} />)}
      {note && <input name="note" placeholder={note} aria-label={note} className="h-8 w-40 rounded-md border border-line-strong bg-surface px-2 text-xs" />}
      {buttons.map((b) => <SubmitButton key={b.text} size="sm" variant={b.variant ?? 'ghost'} name={b.name} value={b.value} pendingLabel="…">{b.text}</SubmitButton>)}
      {state.message && <span role={state.ok ? 'status' : 'alert'} className={`text-xs ${state.ok ? 'text-success' : 'text-danger'}`}>{state.message}</span>}
    </form>
  );
}

function Simple({ action, label, submit, children, variant = 'primary' }: { action: Action; label: string; submit: string; children: (v: Record<string, string>, e: Record<string, string>) => ReactNode; variant?: 'primary' | 'secondary' }) {
  const { state, formAction, n, v, e } = useCounted(action);
  return (
    <form action={formAction} noValidate aria-label={label} className="space-y-3">
      <FormMessage state={state} />
      <div key={n} className="space-y-3">{children(v, e)}</div>
      <SubmitButton size="sm" variant={variant}>{submit}</SubmitButton>
    </form>
  );
}

export function NominateForm({ action, people, values }: { action: Action; people: Opt[]; values: Opt[] }) {
  return (
    <Simple action={action} label="Nominate" submit="🏅 Nominate">{(v, e) => (
      <>
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField idPrefix="nom" name="nomineeId" label="Colleague" required defaultValue={v.nomineeId ?? ''} options={people} placeholder="Choose…" error={e.nomineeId} />
          <SelectField idPrefix="nom" name="valueId" label="For living the value" required defaultValue={v.valueId ?? ''} options={values} placeholder="Choose…" error={e.valueId} />
        </div>
        <TextAreaField idPrefix="nom" name="reason" label="Why" rows={3} defaultValue={v.reason ?? ''} error={e.reason} />
      </>
    )}</Simple>
  );
}

export function OkrForm({ action, quarter, values, people, okr }: {
  action: Action; quarter: string; values: Opt[]; people: Opt[];
  okr?: { id: string; title: string; value_id: string | null; owner_employee_id: string | null; target: number; current: number; unit: string };
}) {
  const p = `okr-${okr?.id ?? 'new'}`;
  return (
    <Simple action={action} label={okr ? `OKR ${okr.title}` : 'New OKR'} submit={okr ? 'Update' : '＋ New OKR'} variant={okr ? 'secondary' : 'primary'}>{(v, e) => (
      <>
        {okr && <input type="hidden" name="okrId" value={okr.id} />}
        <input type="hidden" name="quarter" value={quarter} />
        <div className="grid gap-3 sm:grid-cols-3">
          <TextField idPrefix={p} name="title" label="Objective" required className="sm:col-span-3" defaultValue={v.title ?? okr?.title ?? ''} error={e.title} />
          <SelectField idPrefix={p} name="valueId" label="Culture value" defaultValue={v.valueId ?? okr?.value_id ?? ''} options={[{ value: '', label: 'None' }, ...values]} />
          <SelectField idPrefix={p} name="ownerId" label="Owner" defaultValue={v.ownerId ?? okr?.owner_employee_id ?? ''} options={[{ value: '', label: 'None' }, ...people]} />
          <TextField idPrefix={p} name="unit" label="Unit" defaultValue={v.unit ?? okr?.unit ?? '%'} />
          <TextField idPrefix={p} name="current" label="Current" inputMode="decimal" defaultValue={v.current ?? String(okr?.current ?? 0)} />
          <TextField idPrefix={p} name="target" label="Target" inputMode="decimal" required defaultValue={v.target ?? (okr ? String(okr.target) : '')} error={e.target} />
        </div>
      </>
    )}</Simple>
  );
}

export function ValueForm({ action, value }: { action: Action; value?: { id: string; name: string; emoji: string; description: string | null } }) {
  const p = `val-${value?.id ?? 'new'}`;
  return (
    <Simple action={action} label={value ? `Value ${value.name}` : 'New value'} submit={value ? 'Save' : '＋ Add value'} variant={value ? 'secondary' : 'primary'}>{(v, e) => (
      <div className="grid gap-3 sm:grid-cols-[5rem_minmax(0,1fr)_minmax(0,2fr)]">
        {value && <input type="hidden" name="valueId" value={value.id} />}
        <TextField idPrefix={p} name="emoji" label="Emoji" defaultValue={v.emoji ?? value?.emoji ?? '⭐'} />
        <TextField idPrefix={p} name="name" label="Value" required defaultValue={v.name ?? value?.name ?? ''} error={e.name} />
        <TextField idPrefix={p} name="description" label="What it means" defaultValue={v.description ?? value?.description ?? ''} />
      </div>
    )}</Simple>
  );
}

export function BadgeForm({ action, values, badge }: { action: Action; values: Opt[]; badge?: { id: string; name: string; emoji: string; points: number; value_id: string | null; active: boolean } }) {
  const p = `bdg-${badge?.id ?? 'new'}`;
  return (
    <Simple action={action} label={badge ? `Badge ${badge.name}` : 'New badge'} submit={badge ? 'Save' : '＋ Add badge'} variant={badge ? 'secondary' : 'primary'}>{(v, e) => (
      <div className="grid gap-3 sm:grid-cols-[5rem_minmax(0,1fr)_7rem_minmax(0,1fr)_8rem]">
        {badge && <input type="hidden" name="badgeId" value={badge.id} />}
        <TextField idPrefix={p} name="emoji" label="Emoji" defaultValue={v.emoji ?? badge?.emoji ?? '🏅'} />
        <TextField idPrefix={p} name="name" label="Badge" required defaultValue={v.name ?? badge?.name ?? ''} error={e.name} />
        <TextField idPrefix={p} name="points" label="Points" inputMode="numeric" defaultValue={v.points ?? String(badge?.points ?? 10)} error={e.points} />
        <SelectField idPrefix={p} name="valueId" label="Value" defaultValue={v.valueId ?? badge?.value_id ?? ''} options={[{ value: '', label: 'None' }, ...values]} />
        <SelectField idPrefix={p} name="active" label="Status" defaultValue={v.active ?? String(badge?.active ?? true)} options={[{ value: 'true', label: 'Active' }, { value: 'false', label: 'Retired' }]} />
      </div>
    )}</Simple>
  );
}

export function RewardForm({ action, reward }: { action: Action; reward?: { id: string; name: string; description: string | null; cost: number; stock: number | null; active: boolean } }) {
  const p = `rwd-${reward?.id ?? 'new'}`;
  return (
    <Simple action={action} label={reward ? `Reward ${reward.name}` : 'New reward'} submit={reward ? 'Save' : '＋ Add reward'} variant={reward ? 'secondary' : 'primary'}>{(v, e) => (
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_7rem_7rem_8rem]">
        {reward && <input type="hidden" name="rewardId" value={reward.id} />}
        <TextField idPrefix={p} name="name" label="Reward" required defaultValue={v.name ?? reward?.name ?? ''} error={e.name} />
        <TextField idPrefix={p} name="description" label="Description" defaultValue={v.description ?? reward?.description ?? ''} />
        <TextField idPrefix={p} name="cost" label="Cost (pts)" inputMode="numeric" required defaultValue={v.cost ?? (reward ? String(reward.cost) : '')} error={e.cost} />
        <TextField idPrefix={p} name="stock" label="Stock" inputMode="numeric" placeholder="∞" defaultValue={v.stock ?? (reward?.stock ?? '').toString()} />
        <SelectField idPrefix={p} name="active" label="Status" defaultValue={v.active ?? String(reward?.active ?? true)} options={[{ value: 'true', label: 'Available' }, { value: 'false', label: 'Hidden' }]} />
      </div>
    )}</Simple>
  );
}

export function AdjustForm({ action, people }: { action: Action; people: Opt[] }) {
  return (
    <Simple action={action} label="Adjust points" submit="Adjust" variant="secondary">{(v, e) => (
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem_minmax(0,1fr)]">
        <SelectField idPrefix="adj" name="employeeId" label="Person" required defaultValue={v.employeeId ?? ''} options={people} placeholder="Choose…" error={e.employeeId} />
        <TextField idPrefix="adj" name="delta" label="Points (±)" inputMode="numeric" defaultValue={v.delta ?? ''} error={e.delta} />
        <TextField idPrefix="adj" name="note" label="Reason" defaultValue={v.note ?? ''} error={e.note} />
      </div>
    )}</Simple>
  );
}

export function RulesForm({ action, s }: { action: Action; s: { daily_recognition_limit: number; daily_points_limit: number; high_value_threshold: number; require_approval: boolean; points_enabled: boolean; notify_recipient: boolean; notify_manager: boolean } }) {
  const box = (name: string, label: string, hint: string, checked: boolean) => (
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" name={name} defaultChecked={checked} className={`mt-0.5 ${checkbox}`} /><span><span className="font-medium">{label}</span><span className="block text-xs text-muted">{hint}</span></span></label>
  );
  return (
    <Simple action={action} label="Recognition settings" submit="💾 Save changes">{(v, e) => (
      <>
        <div className="grid gap-3 sm:grid-cols-3">
          <TextField idPrefix="rules" name="dailyRecognitions" label="Daily recognition limit (per person)" inputMode="numeric" defaultValue={v.dailyRecognitions ?? String(s.daily_recognition_limit)} error={e.dailyRecognitions} />
          <TextField idPrefix="rules" name="dailyPoints" label="Daily points limit (per person)" inputMode="numeric" defaultValue={v.dailyPoints ?? String(s.daily_points_limit)} error={e.dailyPoints} />
          <TextField idPrefix="rules" name="threshold" label="High-value threshold (points)" inputMode="numeric" defaultValue={v.threshold ?? String(s.high_value_threshold)} error={e.threshold} />
        </div>
        {box('requireApproval', 'Require approval for high-value badges', 'Badges at or above the threshold wait for an admin before they’re posted and credited.', s.require_approval)}
        {box('pointsEnabled', 'Points & rewards', 'Off: recognitions (badge + message) still post, but no points are credited.', s.points_enabled)}
        {box('notifyRecipient', 'Notify the person recognised', 'An inbox notification with the badge and message.', s.notify_recipient)}
        {box('notifyManager', 'Notify their manager', 'So managers see their team’s wins.', s.notify_manager)}
      </>
    )}</Simple>
  );
}
