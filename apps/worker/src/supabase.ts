import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@peoplecore/db/types';
import type { ClaimedJob, QueueClient } from './queue.ts';

/**
 * Service-role client (bypasses RLS). The worker only calls functions that are granted to service_role
 * and check their own inputs; it never acts on behalf of a user.
 */
export function serviceClient(): SupabaseClient<Database> {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SECRET_KEY (see apps/worker/.env.example).');
  return createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function supabaseQueue(db: SupabaseClient<Database>): QueueClient {
  return {
    async claim(worker, limit, leaseSeconds) {
      const { data, error } = await db.rpc('worker_claim_jobs', { p_worker: worker, p_limit: limit, p_lease_seconds: leaseSeconds });
      if (error) throw new Error(`claim failed: ${error.message}`);
      return (data ?? []) as ClaimedJob[];
    },
    async complete(id, worker) {
      const { error } = await db.rpc('worker_complete_job', { p_id: id, p_worker: worker });
      if (error) throw new Error(`complete failed: ${error.message}`);
    },
    async fail(id, worker, message) {
      const { data, error } = await db.rpc('worker_fail_job', { p_id: id, p_worker: worker, p_error: message });
      if (error) throw new Error(`fail failed: ${error.message}`);
      return data as 'retry' | 'dead' | null;
    },
    async enqueue(org, kind, payload, key) {
      const { error } = await db.rpc('worker_enqueue_job', { p_org: org as string, p_kind: kind, p_payload: payload as Json, p_key: key });
      if (error) throw new Error(`enqueue failed: ${error.message}`);
    },
  };
}
