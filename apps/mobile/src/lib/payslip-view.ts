import type { PayslipLayout } from '@peoplecore/shared/payslip';
import { SITE_URL } from './site';
import { supabase } from './supabase';

export interface PayslipView { month: string; layout: PayslipLayout; logo: string | null }

/**
 * One payslip as the server lays it out (the same labels and values as the PDF and the website; PAN, UAN and
 * account number masked). Null when there is no such payslip for you; throws when the server can't be reached.
 */
export async function loadPayslipView(orgId: string, runId: string): Promise<PayslipView | null> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Sign in again to see your payslip.');
  const res = await fetch(`${SITE_URL}/api/mobile/payslip?org=${encodeURIComponent(orgId)}&run=${encodeURIComponent(runId)}&format=json`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Payslip request failed (${res.status})`);
  return (await res.json()) as PayslipView;
}
