import Link from 'next/link';
import { buttonClass } from '@/components/ui/button';
import { formatDateTime } from '@/lib/format';
import { exportLog, fyOf, lockedLineTotals, recentRuns } from '@/server/payroll-suite';
import { createClient } from '@/server/supabase';
import { monthLabel } from '../format';
import { Card, inr, Pill, qs, type TabProps } from './shared';

const VIEWS = [{ key: 'filings', label: 'Filings & Challans' }, { key: 'files', label: 'Statutory Files & Reports' }, { key: 'journal', label: 'Journal Voucher' }];

export async function ComplianceTab({ ctx, slug, base, month, run, sp }: TabProps) {
  const m = month.slice(0, 7);
  const view = VIEWS.some((v) => v.key === sp.view) ? sp.view! : 'filings';
  const locked = run?.status === 'locked';
  const canIdentity = ctx.can('employee.identity.read', 'org');
  const [log, runs] = await Promise.all([exportLog(ctx.org.id), recentRuns(ctx.org.id, 24)]);
  const lines = locked ? await lockedLineTotals(ctx.org.id, [run.id]) : [];
  const sum = (...codes: string[]) => lines.filter((l) => codes.includes(l.code)).reduce((s, l) => s + l.amount, 0);
  const fy = fyOf(month);
  const q = Math.floor(((Number(m.slice(5, 7)) + 8) % 12) / 3) + 1; // Apr–Jun = Q1
  const file = (report: string, extra: Record<string, string> = {}) => `/app/${slug}/payroll/statutory?${new URLSearchParams({ report, ...(run ? { run: run.id } : {}), ...extra }).toString()}`;
  const supabase = await createClient();
  const { data: org } = await supabase.from('payroll_settings').select('pt_enabled, pf_enabled, esi_enabled').eq('organization_id', ctx.org.id).maybeSingle();
  const notReady = !locked ? `Lock ${monthLabel(month)} payroll to generate its files.` : !canIdentity ? 'Needs access to identity numbers (PAN, UAN, ESIC).' : null;

  return (
    <div className="space-y-5">
      <nav aria-label="Compliance" className="inline-flex rounded-xl border border-line bg-surface p-1">
        {VIEWS.map((v) => (
          <Link key={v.key} href={qs(base, { tab: 'compliance', month: m, view: v.key })} aria-current={v.key === view ? 'page' : undefined}
            className={`rounded-lg px-3 py-1.5 text-sm ${v.key === view ? 'bg-subtle font-semibold' : 'text-muted hover:text-fg'}`}>{v.label}</Link>
        ))}
      </nav>

      {view === 'filings' && (
        <div className="grid gap-4 md:grid-cols-2">
          {[
            { icon: '🏛', title: 'PF Challan', sub: 'PF ECR (EPFO upload, text) · employee + employer shares', amount: sum('PF', 'EPF_ER', 'EPS_ER'), href: file('pf_ecr'), label: 'Download ECR', on: org?.pf_enabled !== false },
            { icon: '📋', title: 'ESI Challan', sub: 'ESI monthly contribution (CSV)', amount: sum('ESI', 'ESI_ER'), href: file('esi'), label: 'Download', on: org?.esi_enabled !== false },
            { icon: '📊', title: 'TDS Returns', sub: `Form 24Q · Q${q} FY ${fy} (quarterly e-TDS working)`, amount: sum('TDS'), href: `/app/${slug}/payroll/statutory?report=tds24q&fy=${fy}&q=${q}`, label: 'Export 24Q', on: true, always: true },
            { icon: '🪪', title: 'PT Filing', sub: 'Professional tax by state (CSV)', amount: sum('PT'), href: file('pt'), label: 'Download', on: org?.pt_enabled !== false },
          ].map((c) => (
            <section key={c.title} className="lift-soft flex items-start gap-4 rounded-2xl border border-line bg-surface p-5" aria-label={c.title}>
              <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary-soft text-xl">{c.icon}</span>
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold">{c.title}</h3>
                <p className="text-sm text-muted">{c.sub}</p>
                {locked && <p className="mt-1 text-sm">{monthLabel(month)}: <span className="font-semibold tabular-nums">{inr.format(c.amount)}</span></p>}
                {!c.on && <p className="mt-1 text-xs text-muted">Turned off in Settings › PF & ESI.</p>}
              </div>
              {(c.always ? canIdentity : !notReady) && c.on
                ? <a href={c.href} className={buttonClass('secondary', 'sm')} download>{c.label}</a>
                : <span className="max-w-40 text-right text-xs text-muted">{c.always ? 'Needs identity access' : notReady}</span>}
            </section>
          ))}
          {sum('PT') === 0 && locked && <p className="text-xs text-muted md:col-span-2">No professional tax was deducted this month (no state on file, or below the slab).</p>}
        </div>
      )}

      {view === 'files' && (
        <Card title="Statutory Files & Reports">
          <ul className="divide-y divide-line">
            {[
              ['Salary register (all earnings and deductions)', `/app/${slug}/payroll/register?month=${m}`, Boolean(run && run.status !== 'draft')],
              ['PF ECR text file (EPFO unified portal)', file('pf_ecr'), !notReady],
              ['ESI contribution file', file('esi'), !notReady],
              ['Professional tax summary', file('pt'), !notReady],
              ['TDS deducted this month (PAN-wise)', file('tds'), !notReady],
              [`Form 24Q working · Q${q} FY ${fy}`, `/app/${slug}/payroll/statutory?report=tds24q&fy=${fy}&q=${q}`, canIdentity],
              ['Tax declarations (FY)', `/app/${slug}/payroll/declarations-export?fy=${fy}`, true],
              ['Bank advice', run ? `/app/${slug}/payroll/${run.id}/bank-advice` : '', Boolean(locked && ctx.can('employee.bank.read', 'org'))],
            ].map(([label, href, ok]) => (
              <li key={String(label)} className="flex items-center justify-between gap-3 py-3 text-sm">
                <span>{label}</span>
                {ok ? <a href={String(href)} className="text-xs font-medium text-primary hover:underline" download>⬇ Download</a> : <span className="text-xs text-muted">{notReady ?? 'Not available'}</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {view === 'journal' && (
        <Card title="Journal Voucher" action={<span className="text-xs text-muted">Balanced debit/credit entries for your books, per locked run</span>}>
          <ul className="divide-y divide-line text-sm">
            {runs.filter((r) => r.status === 'locked').map((r) => (
              <li key={r.id} className="flex items-center justify-between py-2.5">
                <span className="font-medium">{monthLabel(r.period_month)}</span>
                <span className="tabular-nums text-muted">{inr.format(Number(r.total_employer_cost))} cost</span>
                <a href={`/app/${slug}/payroll/${r.id}/journal`} className="text-xs font-medium text-primary hover:underline" download>⬇ Journal (CSV)</a>
              </li>
            ))}
            {runs.every((r) => r.status !== 'locked') && <li className="py-3 text-muted">No locked runs yet.</li>}
          </ul>
        </Card>
      )}

      <Card title="Audit Log" action={<span className="text-xs text-muted">Last 30 days</span>}>
        {log.length === 0 ? <p className="text-sm text-muted">No audit history in the last 30 days.</p> : (
          <table className="w-full text-sm">
            <thead><tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-muted"><th className="py-2">Date</th><th>Action</th><th>Done by</th><th>Status</th><th className="text-right">Employees</th></tr></thead>
            <tbody className="divide-y divide-line">
              {log.map((l, i) => (
                <tr key={i}>
                  <td className="py-2 text-muted">{formatDateTime(l.at, ctx.org.timezone)}</td>
                  <td className="capitalize">{String(l.report).replace(/_/g, ' ')} downloaded</td>
                  <td>{l.actor}</td>
                  <td><Pill tone="success">Done</Pill></td>
                  <td className="text-right tabular-nums">{l.employees ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
