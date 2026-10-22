import 'server-only';
import { applicableForms, evaluate, isStateCode, STAT_FORMS, type ScopeFacts, type StateCode } from '@peoplecore/shared';
import { createClient } from './supabase';

export interface Establishment {
  id: string; name: string; city: string | null; state: string | null; headcount: number;
  pt_number: string | null; pt_enrolment: string | null; lwf_number: string | null; se_number: string | null;
}

export interface StatutoryFacts {
  headcount: number;
  unmapped: number;
  establishments: Establishment[];
  pf_members: number; pf_missing_uan: number;
  esi_members: number; esi_missing_number: number;
  missing_pan: number;
  settings: { pf: boolean; esi: boolean; pt: boolean };
  company: { pan: boolean; tan: boolean; pf_code: boolean; esi_code: boolean };
  scope: { contract_labour: boolean; factory: boolean };
  locked_months: string[];
  any_payroll: boolean;
  /** TDS was deducted from a vendor payment (Form 26Q and 16A apply). */
  vendor_tds?: boolean;
}

export interface Filing {
  id: string; form_id: string; period_start: string; period_end: string; due_on: string | null; status: 'filed' | 'not_applicable';
  filed_on: string | null; reference: string | null; note: string | null; proof_name: string | null; retain_until: string;
}

/** The organization's facts (counts only, checked against statutory.manage in the database) and the engine's inputs. */
export async function statutoryFacts(orgId: string): Promise<StatutoryFacts> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('statutory_facts', { p_org: orgId });
  if (error) throw new Error(error.message);
  return data as unknown as StatutoryFacts;
}

export function scopeOf(f: StatutoryFacts): ScopeFacts {
  const byState: Partial<Record<StateCode, number>> = {};
  for (const e of f.establishments) {
    if (isStateCode(e.state) && e.headcount > 0) byState[e.state] = (byState[e.state] ?? 0) + e.headcount;
  }
  return {
    headcount: f.headcount, byState,
    pfEnabled: f.settings.pf, pfCode: f.company.pf_code, esiEnabled: f.settings.esi, esiCode: f.company.esi_code, ptEnabled: f.settings.pt,
    tds: f.any_payroll || f.company.tan, vendorTds: f.vendor_tds ?? false, contractLabour: f.scope.contract_labour, factory: f.scope.factory,
  };
}

export const evaluations = (s: ScopeFacts, today: string) => STAT_FORMS.map((form) => evaluate(form, s, today));
export const applicable = applicableForms;

export async function statutoryFilings(orgId: string): Promise<Filing[]> {
  const supabase = await createClient();
  const { data } = await supabase.from('statutory_filings')
    .select('id, form_id, period_start, period_end, due_on, status, filed_on, reference, note, proof_name, retain_until')
    .eq('organization_id', orgId).order('period_start', { ascending: false });
  return (data ?? []) as Filing[];
}

/** Data-quality alerts: what would make a filing wrong or impossible. */
export function alerts(f: StatutoryFacts, s: ScopeFacts, applicableIds: Set<string>): Array<{ tone: 'warning' | 'danger'; text: string }> {
  const out: Array<{ tone: 'warning' | 'danger'; text: string }> = [];
  if (f.unmapped > 0) out.push({ tone: 'warning', text: `${f.unmapped} employee${f.unmapped === 1 ? ' has' : 's have'} no work location with a state, so state forms leave them out.` });
  if (applicableIds.has('IN-P-01') && !f.company.pf_code) out.push({ tone: 'danger', text: 'EPF applies but the company has no PF establishment code (Company Profile › Statutory).' });
  if (applicableIds.has('IN-P-01') && f.pf_missing_uan > 0) out.push({ tone: 'warning', text: `${f.pf_missing_uan} PF member${f.pf_missing_uan === 1 ? '' : 's'} without a UAN — the ECR can't include them.` });
  if (applicableIds.has('IN-E-01') && !f.company.esi_code) out.push({ tone: 'danger', text: 'ESI applies but the company has no ESI employer code.' });
  if (applicableIds.has('IN-E-01') && f.esi_missing_number > 0) out.push({ tone: 'warning', text: `${f.esi_missing_number} ESI member${f.esi_missing_number === 1 ? '' : 's'} without an ESIC number.` });
  if (s.tds && !f.company.tan) out.push({ tone: 'danger', text: 'Salaries are paid but the company has no TAN — TDS returns need one.' });
  if (s.tds && f.missing_pan > 0) out.push({ tone: 'warning', text: `${f.missing_pan} employee${f.missing_pan === 1 ? '' : 's'} without a PAN — TDS for them is at the higher rate and Form 24Q flags them.` });
  for (const e of f.establishments) {
    if (!e.headcount || !isStateCode(e.state)) continue;
    if (applicableIds.has(`${e.state}-PT-02`) && !e.pt_number) out.push({ tone: 'warning', text: `${e.name}: no professional tax registration number on file.` });
    if (applicableIds.has(`${e.state}-LWF-01`) && !e.lwf_number) out.push({ tone: 'warning', text: `${e.name}: no labour welfare fund registration number on file.` });
  }
  return out;
}
