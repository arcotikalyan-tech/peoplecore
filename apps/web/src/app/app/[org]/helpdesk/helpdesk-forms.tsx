'use client';

import { ActionForm } from '@/components/action-form';
import { SelectField, TextAreaField, TextField, type Option } from '@/components/ui/fields';
import type { ActionState } from '@/lib/action-state';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export const PRIORITY_OPTIONS: Option[] = [
  { value: 'low', label: 'Low (3 days)' },
  { value: 'normal', label: 'Normal (1 day)' },
  { value: 'high', label: 'High (8 hours)' },
  { value: 'urgent', label: 'Urgent (4 hours)' },
];
const STATUS_OPTIONS: Option[] = [
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'waiting', label: 'Waiting on requester' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
];

export function RaiseTicketForm({ action, categories }: { action: Action; categories: Option[] }) {
  return (
    <ActionForm action={action} label="Raise a ticket" submit="Raise ticket" className="space-y-4 px-5 py-5">
      {(v, e) => (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField idPrefix="tkt" name="categoryId" label="Category" required options={categories} placeholder="Choose…" defaultValue={v.categoryId ?? ''} error={e.categoryId} />
            <SelectField idPrefix="tkt" name="priority" label="Priority" options={PRIORITY_OPTIONS} defaultValue={v.priority ?? 'normal'} />
          </div>
          <TextField idPrefix="tkt" name="subject" label="Subject" required placeholder="Payslip for September is missing" defaultValue={v.subject} error={e.subject} />
          <TextAreaField idPrefix="tkt" name="description" label="Details" required rows={4} defaultValue={v.description} error={e.description} />
        </>
      )}
    </ActionForm>
  );
}

export function ReplyForm({ action, ticketId, agent }: { action: Action; ticketId: string; agent: boolean }) {
  return (
    <ActionForm action={action} label="Reply" submit="Send" hidden={{ ticketId }} className="space-y-3 border-t border-line px-5 py-4">
      {(v, e) => (
        <>
          <TextAreaField idPrefix="reply" name="body" label="Reply" required rows={3} defaultValue={v.body} error={e.body} />
          {agent && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="internal" defaultChecked={v.internal === 'on'} className="size-4 rounded border-line-strong accent-primary" />
              Internal note (the requester won’t see it)
            </label>
          )}
        </>
      )}
    </ActionForm>
  );
}

/** Agents change status, priority and assignee; an assignee without helpdesk access changes the status only. */
export function UpdateTicketForm({ action, ticketId, status, priority, assigneeId, assignees }: {
  action: Action; ticketId: string; status: string; priority: string; assigneeId: string | null; assignees: Option[] | null;
}) {
  return (
    <ActionForm action={action} label="Update ticket" submit="Update" hidden={{ ticketId }} className="space-y-3 px-5 py-4">
      {(v) => (
        <>
          <SelectField idPrefix="upd" name="status" label="Status" options={STATUS_OPTIONS} defaultValue={v.status ?? status} />
          {assignees && (
            <>
              <SelectField idPrefix="upd" name="priority" label="Priority" options={PRIORITY_OPTIONS} defaultValue={v.priority ?? priority}
                hint="Changing it resets the SLA from when the ticket was raised." />
              <SelectField idPrefix="upd" name="assigneeId" label="Assignee" options={assignees} placeholder={assigneeId ? 'Keep current' : 'Unassigned'} defaultValue={v.assigneeId ?? ''} />
            </>
          )}
        </>
      )}
    </ActionForm>
  );
}

export function CategoryForm({ action, category, assignees }: {
  action: Action; category?: { id: string; name: string; default_assignee_id: string | null; is_active: boolean }; assignees: Option[];
}) {
  const id = category?.id ?? 'new';
  return (
    <ActionForm action={action} label={category ? `Category ${category.name}` : 'Add a category'} submit={category ? 'Save' : 'Add'}
      hidden={category ? { categoryId: category.id } : {}} variant={category ? 'secondary' : 'primary'} size="sm"
      className="grid items-end gap-3 px-5 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto]">
      {(v, e) => (
        <>
          <TextField idPrefix={`cat-${id}`} name="name" label="Name" required defaultValue={v.name ?? category?.name} error={e.name} />
          <SelectField idPrefix={`cat-${id}`} name="assigneeId" label="Routed to" options={assignees} placeholder="Helpdesk staff"
            defaultValue={v.assigneeId ?? category?.default_assignee_id ?? ''} />
          {category ? (
            <label className="flex h-10 items-center gap-2 text-sm">
              <input type="checkbox" name="active" defaultChecked={category.is_active} className="size-4 rounded border-line-strong accent-primary" />
              Active
            </label>
          ) : <span />}
        </>
      )}
    </ActionForm>
  );
}

export function ArticleForm({ action, article }: { action: Action; article?: { id: string; title: string; category: string | null; body: string; published: boolean } }) {
  return (
    <ActionForm action={action} label={article ? 'Edit article' : 'New article'} submit="Save article"
      hidden={article ? { articleId: article.id } : {}} className="space-y-4 px-5 py-5">
      {(v, e) => (
        <>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <TextField idPrefix="kb" name="title" label="Title" required defaultValue={v.title ?? article?.title} error={e.title} />
            <TextField idPrefix="kb" name="category" label="Topic" placeholder="Payroll" defaultValue={v.category ?? article?.category ?? ''} />
          </div>
          <TextAreaField idPrefix="kb" name="body" label="Article" required rows={10} defaultValue={v.body ?? article?.body} error={e.body} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="published" defaultChecked={v.published ? v.published === 'on' : (article?.published ?? true)}
              className="size-4 rounded border-line-strong accent-primary" />
            Published (everyone in the organization can read it)
          </label>
        </>
      )}
    </ActionForm>
  );
}
