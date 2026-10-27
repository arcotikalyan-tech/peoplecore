import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@peoplecore/db/types';
import { archiveAuditDays } from './audit-archive.ts';
import { mailerFromEnv, sendBatch, type OutgoingEmail } from './email.ts';
import type { Handlers, Log } from './queue.ts';

/** Job handlers. Each must be safe to run more than once (jobs are retried after failures and crashes). */
export function handlers(db: SupabaseClient<Database>): Handlers {
  // Workflows triggered by a domain event (ADR-008); once per workflow and event, so retries are safe.
  const startWorkflows = async (eventId: unknown, log: Log) => {
    if (typeof eventId !== 'number') return;
    const { data, error } = await db.rpc('worker_start_workflows', { p_event: eventId });
    if (error) throw new Error(error.message);
    if ((data as { started?: number } | null)?.started) log('workflows.start', { event_id: eventId, ...(data as Record<string, unknown>) });
  };
  return {
    'core_hr.daily': async (_job, log) => {
      const { data, error } = await db.rpc('worker_daily_core_hr');
      if (error) throw new Error(error.message);
      log('core_hr.daily', data as Record<string, unknown>);
    },
    // Yesterday's audit events, per organization, to the archive (catching up on missed days, 50 at a time).
    'audit.archive': async (_job, log) => {
      await archiveAuditDays(db, log);
    },
    'org.closures': async (_job, log) => {
      const { data, error } = await db.rpc('worker_close_organizations');
      if (error) throw new Error(error.message);
      if ((data as { closed?: number } | null)?.closed) log('org.closures', data as Record<string, unknown>);
    },
    'leave.accrual': async (_job, log) => {
      const { data, error } = await db.rpc('worker_leave_accrual');
      if (error) throw new Error(error.message);
      log('leave.accrual', data as Record<string, unknown>);
    },
    'attendance.daily': async (_job, log) => {
      const { data, error } = await db.rpc('worker_attendance_daily');
      if (error) throw new Error(error.message);
      log('attendance.daily', data as Record<string, unknown>);
    },
    // Punches to question (impossible travel, a rough location, far outside the shift): flags for review, never verdicts.
    'attendance.anomalies': async (_job, log) => {
      const { data, error } = await db.rpc('worker_attendance_anomalies');
      if (error) throw new Error(error.message);
      const r = data as Record<string, number> | null;
      if (r && Object.values(r).some((n) => n > 0)) log('attendance.anomalies', r);
    },
    'helpdesk.sla': async (_job, log) => {
      const { data, error } = await db.rpc('worker_helpdesk_sla');
      if (error) throw new Error(error.message);
      log('helpdesk.sla', data as Record<string, unknown>);
    },
    'assets.returns': async (_job, log) => {
      const { data, error } = await db.rpc('worker_asset_returns');
      if (error) throw new Error(error.message);
      log('assets.returns', data as Record<string, unknown>);
    },
    'approvals.escalate': async (_job, log) => {
      const { data, error } = await db.rpc('worker_approval_escalations');
      if (error) throw new Error(error.message);
      log('approvals.escalate', data as Record<string, unknown>);
    },
    'learning.daily': async (_job, log) => {
      const { data, error } = await db.rpc('worker_learning');
      if (error) throw new Error(error.message);
      log('learning.daily', data as Record<string, unknown>);
    },
    'separations.daily': async (_job, log) => {
      const { data, error } = await db.rpc('worker_separations');
      if (error) throw new Error(error.message);
      log('separations.daily', data as Record<string, unknown>);
    },
    // Personal data past its retention period after someone leaves: rows are removed in the database, then the
    // document files here. (A failed file removal fails the job; the paths stay in retention_actions for follow-up.)
    'retention.daily': async (_job, log) => {
      const { data, error } = await db.rpc('worker_retention');
      if (error) throw new Error(error.message);
      const result = data as { actions: number; storagePaths: string[] };
      if (result.storagePaths.length > 0) {
        const removed = await db.storage.from('employee-documents').remove(result.storagePaths);
        if (removed.error) throw new Error(`retention: removing ${result.storagePaths.length} file(s) failed: ${removed.error.message}`);
      }
      log('retention.daily', { actions: result.actions, files: result.storagePaths.length });
    },
    // Candidates whose consent has expired are erased exactly as a recruiter's "Erase" would (audited).
    'recruitment.retention': async (_job, log) => {
      const { data, error } = await db.rpc('worker_candidate_retention');
      if (error) throw new Error(error.message);
      log('recruitment.retention', data as Record<string, unknown>);
    },
    'reports.schedules': async (_job, log) => {
      const { data, error } = await db.rpc('worker_report_schedules');
      if (error) throw new Error(error.message);
      log('reports.schedules', data as Record<string, unknown>);
    },
    // Queued notification emails (migration 20261022000200), over SMTP when it is configured.
    'notifications.email': async (_job, log) => {
      const mailer = mailerFromEnv();
      if (!mailer) return;  // not configured: emails wait in the outbox and expire after two days
      // Batches of 50 until the outbox is empty or three minutes have passed (the job may run four), so publishing
      // payslips to a thousand people goes out in one run rather than 50 every quarter of an hour.
      const until = Date.now() + 180_000;
      while (Date.now() < until) {
        const { data, error } = await db.rpc('worker_claim_emails', { p_limit: 50 });
        if (error) throw new Error(error.message);
        const emails = (data ?? []) as OutgoingEmail[];
        if (emails.length === 0) return;
        const r = await sendBatch(emails, mailer, async (id, ok, message) => {
          const { error: e } = await db.rpc('worker_email_result', { p_id: id, p_ok: ok, p_error: message ?? undefined });
          if (e) throw new Error(e.message);
        });
        log('notifications.email', r);
        if (emails.length < 50) return;
      }
    },
    'notifications.celebrations': async (_job, log) => {
      const { data, error } = await db.rpc('worker_celebration_emails');
      if (error) throw new Error(error.message);
      const r = data as { birthday_emails?: number; anniversary_emails?: number } | null;
      if (r?.birthday_emails || r?.anniversary_emails) log('notifications.celebrations', r as Record<string, unknown>);
    },
    'attendance.auto_clock': async (_job, log) => {
      const { data, error } = await db.rpc('worker_attendance_auto_clock');
      if (error) throw new Error(error.message);
      const r = data as { clocked_in?: number; clocked_out?: number } | null;
      if (r?.clocked_in || r?.clocked_out) log('attendance.auto_clock', r as Record<string, unknown>);
    },
    'attendance.deductions': async (_job, log) => {
      const { data, error } = await db.rpc('worker_attendance_deductions');
      if (error) throw new Error(error.message);
      if ((data as { organizations?: number } | null)?.organizations) log('attendance.deductions', data as Record<string, unknown>);
    },
    'attendance.reminders': async (_job, log) => {
      const { data, error } = await db.rpc('worker_attendance_reminders');
      if (error) throw new Error(error.message);
      log('attendance.reminders', data as Record<string, unknown>);
    },
    'learning.rules': async (_job, log) => {
      const { data, error } = await db.rpc('worker_learning_rules');
      if (error) throw new Error(error.message);
      log('learning.rules', data as Record<string, unknown>);
    },
    'timesheet.reminders': async (_job, log) => {
      const { data, error } = await db.rpc('worker_timesheet_reminders');
      if (error) throw new Error(error.message);
      log('timesheet.reminders', data as Record<string, unknown>);
    },
    'ai.retention': async (_job, log) => {
      const { data, error } = await db.rpc('worker_ai_retention');
      if (error) throw new Error(error.message);
      log('ai.retention', data as Record<string, unknown>);
    },
    'workflows.resume': async (_job, log) => {
      const { data, error } = await db.rpc('worker_resume_workflows');
      if (error) throw new Error(error.message);
      log('workflows.resume', data as Record<string, unknown>);
    },
    // Every hire gets the organization's default onboarding plan (once).
    'event:employee.hired': async (job, log) => {
      const employee = job.payload.subject_id;
      if (typeof employee !== 'string') throw new Error('employee.hired without an employee id');
      const { data, error } = await db.rpc('worker_start_onboarding', { p_employee: employee });
      if (error) throw new Error(error.message);
      log('onboarding.start', { employee, result: data });
      await startWorkflows(job.payload.event_id, log);
    },
    // Any other domain event: start the organization's workflows for it (most events have none).
    'event:*': async (job, log) => {
      log('event.seen', { kind: job.kind, subject_id: job.payload.subject_id });
      await startWorkflows(job.payload.event_id, log);
    },
  };
}
