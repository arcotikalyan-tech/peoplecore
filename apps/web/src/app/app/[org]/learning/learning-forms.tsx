'use client';

import { ActionForm } from '@/components/action-form';
import { CheckboxGroup, SelectField, TextAreaField, TextField, type Option } from '@/components/ui/fields';
import type { ActionState } from '@/lib/action-state';
import { FORMAT_LABEL } from './labels';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

const FORMAT_OPTIONS: Option[] = Object.entries(FORMAT_LABEL).map(([value, label]) => ({ value, label }));

interface CourseValues {
  id: string; title: string; description: string | null; category: string | null; format: string; url: string | null;
  duration_minutes: number | null; valid_for_months: number | null; self_enroll: boolean; is_active: boolean;
}

export function CourseForm({ action, course }: { action: Action; course?: CourseValues }) {
  return (
    <ActionForm action={action} label={course ? 'Edit course' : 'New course'} submit={course ? 'Save' : 'Add course'}
      hidden={course ? { courseId: course.id } : {}} className="space-y-4 px-5 py-5">
      {(v, e) => (
        <>
          <TextField idPrefix="crs" name="title" label="Title" required defaultValue={v.title ?? course?.title} error={e.title} />
          <TextAreaField idPrefix="crs" name="description" label="What it covers" rows={4} defaultValue={v.description ?? course?.description ?? ''} error={e.description} />
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField idPrefix="crs" name="format" label="Format" options={FORMAT_OPTIONS} defaultValue={v.format ?? course?.format ?? 'online'} />
            <TextField idPrefix="crs" name="category" label="Topic" placeholder="Compliance" defaultValue={v.category ?? course?.category ?? ''} error={e.category} />
            <TextField idPrefix="crs" name="url" label="Link" type="url" placeholder="https://…" defaultValue={v.url ?? course?.url ?? ''} error={e.url} />
            <TextField idPrefix="crs" name="durationMinutes" label="Duration (minutes)" inputMode="numeric"
              defaultValue={v.durationMinutes ?? (course?.duration_minutes != null ? String(course.duration_minutes) : '')} error={e.durationMinutes} />
            <TextField idPrefix="crs" name="validForMonths" label="Valid for (months)" inputMode="numeric" placeholder="Doesn’t expire"
              hint="For training that must be renewed, such as yearly POSH awareness."
              defaultValue={v.validForMonths ?? (course?.valid_for_months != null ? String(course.valid_for_months) : '')} error={e.validForMonths} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="selfEnroll" defaultChecked={v.selfEnroll ? v.selfEnroll === 'on' : (course?.self_enroll ?? true)}
              className="size-4 rounded border-line-strong accent-primary" />
            Anyone can enrol themselves
          </label>
          {course && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="active" defaultChecked={v.active ? v.active === 'on' : course.is_active} className="size-4 rounded border-line-strong accent-primary" />
              Offered (untick to retire the course; history is kept)
            </label>
          )}
        </>
      )}
    </ActionForm>
  );
}

export function AssignCourseForm({ action, courseId, people, departments, today }: {
  action: Action; courseId: string; people: Option[]; departments: Option[] | null; today: string;
}) {
  return (
    <ActionForm action={action} label="Assign this course" submit="Assign" hidden={{ courseId }} className="space-y-4 px-5 py-4">
      {(v, e) => (
        <>
          {departments && (
            <SelectField idPrefix="asg" name="departmentId" label="Everyone in a department" options={departments} placeholder="No department"
              defaultValue={v.departmentId ?? ''} />
          )}
          <CheckboxGroup idPrefix="asg" name="employeeIds" legend={departments ? 'And/or these people' : 'People in your team'}
            options={people} error={e.employeeIds} className="max-h-64 overflow-y-auto" />
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField idPrefix="asg" name="dueOn" label="Due by" type="date" min={today} defaultValue={v.dueOn ?? ''} error={e.dueOn} />
            <label className="flex items-end gap-2 pb-2 text-sm">
              <input type="checkbox" name="mandatory" defaultChecked={v.mandatory ? v.mandatory === 'on' : true} className="size-4 rounded border-line-strong accent-primary" />
              Mandatory
            </label>
          </div>
        </>
      )}
    </ActionForm>
  );
}

export function CompleteForm({ action, enrollmentId, label }: { action: Action; enrollmentId: string; label: string }) {
  return (
    <ActionForm action={action} label={label} submit="Mark complete" hidden={{ enrollmentId, status: 'completed' }} size="sm"
      className="flex flex-wrap items-end gap-2">
      {(v) => <TextField idPrefix={`cmp-${enrollmentId}`} name="note" label="Note" placeholder="Optional" defaultValue={v.note ?? ''} className="w-44" />}
    </ActionForm>
  );
}
