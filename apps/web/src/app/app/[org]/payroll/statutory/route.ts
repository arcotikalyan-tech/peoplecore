import { NextResponse, type NextRequest } from 'next/server';
import { toCsv } from '@peoplecore/shared';
import { z } from 'zod';
import { getOrgContext } from '@/server/context';
import { createClient } from '@/server/supabase';

/**
 * Statutory files for a locked run (PF ECR, ESI, PT, TDS), and the quarterly Form 24Q working. Rows come from
 * payroll_statutory_rows, which checks payroll staff with identity access and records every download.
 * Formats follow the portals' published layouts; the rule sets behind the amounts are not professionally validated.
 */
const whole = (n: number | string) => String(Math.round(Number(n)));

export async function GET(req: NextRequest, { params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await getOrgContext(org);
  const sp = req.nextUrl.searchParams;
  const report = sp.get('report') ?? '';
  const supabase = await createClient();
  const send = (body: string, name: string, type = 'text/csv') => new NextResponse(body, {
    headers: { 'Content-Type': `${type}; charset=utf-8`, 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' },
  });

  if (report === 'tds24q') {
    const fy = sp.get('fy') ?? '';
    const q = Number(sp.get('q'));
    if (!/^\d{4}-\d{2}$/.test(fy) || ![1, 2, 3, 4].includes(q)) return new NextResponse('Bad request', { status: 400 });
    const start = Number(fy.slice(0, 4));
    const months = [0, 1, 2].map((i) => { const mm = 4 + (q - 1) * 3 + i; return mm > 12 ? `${start + 1}-${String(mm - 12).padStart(2, '0')}-01` : `${start}-${String(mm).padStart(2, '0')}-01`; });
    const { data: runs } = await supabase.from('payroll_runs').select('id, period_month, locked_at').eq('organization_id', ctx.org.id).eq('status', 'locked').in('period_month', months);
    const rows: string[][] = [];
    for (const r of runs ?? []) {
      const { data, error } = await supabase.rpc('payroll_statutory_rows', { p_run: r.id, p_report: 'tds' });
      if (error) return new NextResponse(error.code === '42501' ? 'Not found' : error.message, { status: error.code === '42501' ? 404 : 409 });
      for (const x of data) rows.push([x.employee_code, x.employee_name, x.pan ?? 'PANNOTAVBL', r.period_month.slice(0, 7), whole(x.taxable), whole(x.tds), (r.locked_at ?? '').slice(0, 10)]);
    }
    return send(toCsv(['Employee code', 'Employee name', 'PAN', 'Month', 'Amount paid / credited', 'TDS deducted', 'Date of deduction'], rows), `form24q-${fy}-Q${q}.csv`);
  }

  const run = sp.get('run') ?? '';
  if (!z.uuid().safeParse(run).success || !['pf_ecr', 'esi', 'pt', 'tds'].includes(report)) return new NextResponse('Bad request', { status: 400 });
  const { data, error } = await supabase.rpc('payroll_statutory_rows', { p_run: run, p_report: report });
  if (error) return new NextResponse(error.code === '22023' ? error.message : 'Not found', { status: error.code === '22023' ? 409 : 404 });
  const { data: r } = await supabase.from('payroll_runs').select('period_month').eq('id', run).maybeSingle();
  const m = r?.period_month?.slice(0, 7) ?? 'run';

  if (report === 'pf_ecr') {
    // EPFO ECR 2.0: UAN#~#Name#~#Gross#~#EPF wages#~#EPS wages#~#EDLI wages#~#EPF (EE)#~#EPS (ER)#~#EPF-EPS diff (ER)#~#NCP days#~#Refund
    const lines = data.filter((x) => Number(x.pf_employee) > 0).map((x) => {
      const wages = Number(x.pf_wages);
      return [x.uan ?? 'UAN_MISSING', x.employee_name.toUpperCase(), whole(x.gross), whole(wages), whole(Math.min(wages, 15000)), whole(Math.min(wages, 15000)),
        whole(x.pf_employee), whole(x.eps_employer), whole(x.epf_employer), whole(x.lop_days), '0'].join('#~#');
    });
    return send(lines.join('\n') + '\n', `pf-ecr-${m}.txt`, 'text/plain');
  }
  if (report === 'esi') {
    return send(toCsv(['IP Number', 'IP Name', 'No of Days for which wages paid', 'Total Monthly Wages', 'Employee contribution', 'Employer contribution', 'Reason Code', 'Last Working Day'],
      data.filter((x) => Number(x.esi_employee) > 0).map((x) => [x.esic_number ?? 'IP_MISSING', x.employee_name, whole(x.payable_days), whole(x.esi_wages), whole(x.esi_employee), whole(x.esi_employer), '', ''])), `esi-${m}.csv`);
  }
  if (report === 'pt') {
    return send(toCsv(['Employee code', 'Employee name', 'State', 'Gross', 'Professional tax'],
      data.map((x) => [x.employee_code, x.employee_name, x.pt_state ?? '', whole(x.gross), whole(x.pt)])), `professional-tax-${m}.csv`);
  }
  return send(toCsv(['Employee code', 'Employee name', 'PAN', 'Taxable salary', 'TDS'],
    data.map((x) => [x.employee_code, x.employee_name, x.pan ?? 'PANNOTAVBL', whole(x.taxable), whole(x.tds)])), `tds-${m}.csv`);
}
