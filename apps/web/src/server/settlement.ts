import 'server-only';
import { createHash } from 'node:crypto';
import { canonicalJson, computeSettlement, SETTLEMENT_VERSION, type SettlementInput } from '@peoplecore/payroll';
import { createClient } from './supabase';

/**
 * Full and final settlement: inputs from the database, the deterministic engine here, stored with a fingerprint
 * of the inputs (as payroll runs are). The database re-checks the inputs on store and on approval.
 */
export async function prepareSettlement(separationId: string, extraLines: SettlementInput['extraLines']) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('settlement_inputs', { p_separation: separationId });
  if (error) return { error } as const;
  const base = data as unknown as Omit<SettlementInput, 'extraLines'>;
  const inputs: SettlementInput = {
    ...base,
    components: base.components.map((c) => ({ ...c, monthly: Number(c.monthly) })),
    encashableLeaveDays: Number(base.encashableLeaveDays),
    extraLines,
  };
  const result = computeSettlement(inputs);
  const blocking = result.exceptions.filter((e) => e.blocking);
  if (blocking.length > 0) return { blocking } as const;
  const hash = createHash('sha256').update(canonicalJson(inputs)).digest('hex');
  const stored = await supabase.rpc('store_settlement', {
    p_separation: separationId, p_engine_version: SETTLEMENT_VERSION, p_inputs: inputs as never, p_inputs_hash: hash, p_lines: result.lines as never,
  });
  if (stored.error) return { error: stored.error } as const;
  return { result } as const;
}
