import type { PayslipLayout } from '@peoplecore/shared/payslip';

/**
 * The payslip on screen, laid out like the PDF (one format for every organization): letterhead, the month, the
 * employee's details in two columns, earnings beside deductions with the days and payment, totals, net salary and the
 * notes. Wider than a phone, so it scrolls sideways there rather than reflowing.
 */
export function PayslipSheet({ layout: L, logo }: { layout: PayslipLayout; logo?: string | null }) {
  const rows = Math.max(6, L.earnings.length, L.deductions.length);
  const cell = 'border-line-strong px-1.5 py-[3px]';
  const pair = ([label, value]: [string, string]) => (
    <div key={label} className="grid grid-cols-[minmax(0,9.5rem)_0.75rem_minmax(0,1fr)]"><span>{label}</span><span>:</span><span>{value}</span></div>
  );
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface p-3 sm:p-5" role="region" aria-label="Payslip" tabIndex={0}>
      <div className="min-w-[720px] text-[13px] leading-snug">
        <div className="border border-line-strong">
          <div className="flex items-start gap-4 p-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element -- a signed storage URL */}
            {logo && <img src={logo} alt="" className="max-h-16 max-w-[17rem] object-contain" />}
            <div>
              <p className="text-lg font-bold">{L.company}</p>
              {L.address.map((a) => <p key={a} className="text-xs">{a}</p>)}
            </div>
          </div>
          <p className="mt-6 whitespace-pre pb-1 text-center font-bold text-blue-700 dark:text-blue-400">{L.title}</p>
          <div className="grid grid-cols-2 gap-x-4 border-t border-line-strong px-2 py-1.5">
            <div>{L.left.map(pair)}</div>
            <div>{L.right.map(pair)}</div>
          </div>
          <table className="w-full table-fixed border-collapse border-t border-line-strong">
            <caption className="sr-only">Earnings and deductions</caption>
            <colgroup><col className="w-[22%]" /><col className="w-[11%]" /><col className="w-[22%]" /><col className="w-[11%]" /><col className="w-[34%]" /></colgroup>
            <tbody>
              {/* The heading row sits in the body so the days-and-payment panel can span it and every line. */}
              <tr className="h-6 border-b border-line-strong text-left font-normal">
                <th scope="col" className={`${cell} border-r font-normal`}>EARNINGS</th>
                <th scope="col" className={`${cell} border-r text-center font-normal`}>Amount (Rs.)</th>
                <th scope="col" className={`${cell} border-r font-normal`}>DEDUCTIONS</th>
                <th scope="col" className={`${cell} border-r text-center font-normal`}>Amount (Rs.)</th>
                <td rowSpan={rows + 1} className="border-b-0 align-top">
                  <div className="space-y-1 px-2 py-1.5">{L.days.map(pair)}</div>
                  <div className="space-y-1 border-t border-line-strong px-2 py-1.5">{L.payment.map(pair)}</div>
                </td>
              </tr>
              {Array.from({ length: rows }, (_, i) => (
                <tr key={i} className="h-6">
                  <td className={`${cell} border-r`}>{L.earnings[i]?.[0]}</td>
                  <td className={`${cell} border-r text-right tabular-nums`}>{L.earnings[i]?.[1]}</td>
                  <td className={`${cell} border-r`}>{L.deductions[i]?.[0]}</td>
                  <td className={`${cell} border-r text-right tabular-nums`}>{L.deductions[i]?.[1]}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="grid grid-cols-[33%_33%_34%] border-t border-line-strong font-bold">
            <span className={`${cell} border-r text-right`}>Total Earnings Rs. <span className="tabular-nums">{L.totals.earnings}</span></span>
            <span className={`${cell} border-r text-right`}>Total Deductions Rs. <span className="tabular-nums">{L.totals.deductions}</span></span>
            <span className={`${cell} text-right`}>Net Salary Rs. <span className="tabular-nums">{L.totals.net}</span></span>
          </div>
          <div className="grid h-9 grid-cols-[60%_40%] border-t border-line-strong"><span className="border-r border-line-strong" /><span /></div>
          <div className="space-y-0.5 border-t border-line-strong px-1.5 py-1 text-xs font-bold">{L.notes.map((n) => <p key={n}>{n}</p>)}</div>
        </div>
        <div className="mt-8 space-y-2 text-xs text-muted">
          {L.foot.map((f) => <p key={f.text} className={f.italic ? 'italic' : undefined}>{f.text}</p>)}
        </div>
      </div>
    </div>
  );
}
