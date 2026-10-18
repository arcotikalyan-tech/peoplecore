import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@peoplecore/db/types';
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
