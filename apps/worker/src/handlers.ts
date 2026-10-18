import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@peoplecore/db/types';
import type { Handlers } from './queue.ts';

/** Job handlers. Each must be safe to run more than once (jobs are retried after failures and crashes). */
export function handlers(db: SupabaseClient<Database>): Handlers {
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
    // Every hire gets the organization's default onboarding plan (once).
    'event:employee.hired': async (job, log) => {
      const employee = job.payload.subject_id;
      if (typeof employee !== 'string') throw new Error('employee.hired without an employee id');
      const { data, error } = await db.rpc('worker_start_onboarding', { p_employee: employee });
      if (error) throw new Error(error.message);
      log('onboarding.start', { employee, result: data });
    },
    // Domain events without a dedicated consumer yet: acknowledged, so the queue stays clean.
    'event:*': async (job, log) => {
      log('event.seen', { kind: job.kind, subject_id: job.payload.subject_id });
    },
  };
}
