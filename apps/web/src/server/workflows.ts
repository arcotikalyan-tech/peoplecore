import 'server-only';
import { createClient } from './supabase';

/** Workflow definitions, versions and runs (workflow.manage only; RLS returns nothing to anyone else). */

export async function workflowTriggers() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('workflow_trigger_catalog');
  if (error) throw new Error(`Failed to load triggers (${error.code})`);
  return data;
}

export async function listWorkflows(orgId: string) {
  const supabase = await createClient();
  const [defs, versions, runs] = await Promise.all([
    supabase.from('workflow_definitions').select('id, name, trigger_event, is_active, current_version_id, updated_at').eq('organization_id', orgId).order('name'),
    supabase.from('workflow_versions').select('id, version').eq('organization_id', orgId),
    supabase.from('workflow_runs').select('definition_id, status').eq('organization_id', orgId)
      .gte('started_at', new Date(Date.now() - 30 * 86_400_000).toISOString()).limit(5000),
  ]);
  if (defs.error || versions.error || runs.error) throw new Error('Failed to load workflows');
  const version = new Map(versions.data.map((v) => [v.id, v.version]));
  return defs.data.map((d) => {
    const mine = runs.data.filter((r) => r.definition_id === d.id);
    return {
      ...d,
      version: d.current_version_id ? (version.get(d.current_version_id) ?? null) : null,
      runs: mine.length,
      failed: mine.filter((r) => r.status === 'failed').length,
      waiting: mine.filter((r) => r.status === 'waiting').length,
    };
  });
}

export async function getWorkflow(orgId: string, id: string) {
  const supabase = await createClient();
  const { data: def, error } = await supabase.from('workflow_definitions')
    .select('id, name, trigger_event, is_active, current_version_id').eq('organization_id', orgId).eq('id', id).maybeSingle();
  if (error) throw new Error(`Failed to load the workflow (${error.code})`);
  if (!def?.current_version_id) return null;
  const { data: ver, error: vErr } = await supabase.from('workflow_versions').select('id, version, conditions, steps, created_at')
    .eq('id', def.current_version_id).single();
  if (vErr) throw new Error(`Failed to load the workflow (${vErr.code})`);
  return { ...def, version: ver };
}

export async function workflowRuns(orgId: string, definitionId: string) {
  const supabase = await createClient();
  const { data: runs, error } = await supabase.from('workflow_runs')
    .select('id, version_id, subject_employee_id, status, current_step, error, started_at, finished_at')
    .eq('organization_id', orgId).eq('definition_id', definitionId).order('started_at', { ascending: false }).limit(50);
  if (error) throw new Error(`Failed to load runs (${error.code})`);
  if (runs.length === 0) return [];
  const { data: steps, error: sErr } = await supabase.from('workflow_run_steps').select('run_id, step_no, kind, status, detail')
    .in('run_id', runs.map((r) => r.id)).order('step_no');
  if (sErr) throw new Error(`Failed to load runs (${sErr.code})`);
  return runs.map((r) => ({ ...r, steps: steps.filter((s) => s.run_id === r.id) }));
}
