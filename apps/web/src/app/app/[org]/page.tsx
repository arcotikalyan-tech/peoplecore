import type { Metadata } from 'next';
import Link from 'next/link';
import { addDays, legalName, todayIn } from '@peoplecore/shared';
import { ButtonLink } from '@/components/ui/button';
import { Alert, Card, CardHeader, EmptyState, PageHeader } from '@/components/ui/surface';
import { formatDate } from '@/lib/format';
import { getOrgContext } from '@/server/context';
import { myWork, needsAttention } from '@/server/dashboard';
import { countEmployees, getMyEmployee, probationDue, upcomingJoiners } from '@/server/employees';
import { getStructure } from '@/server/structure';

export const metadata: Metadata = { title: 'Dashboard' };

export default async function Dashboard({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await getOrgContext(slug);
  const orgId = ctx.org.id;
  const base = `/app/${slug}`;
  const today = todayIn(ctx.org.timezone);
  const in30 = addDays(today, 30);
  const canSeeWorkforce = ctx.can('employee.read', 'org') || ctx.can('employee.read', 'team');

  const [me, workforce, structure] = await Promise.all([
    getMyEmployee(orgId, ctx.user.id),
    canSeeWorkforce
      ? Promise.all([
          countEmployees(orgId, { status: 'active' }),
          countEmployees(orgId, { status: 'pre_joining' }),
          countEmployees(orgId, { status: 'on_notice' }),
          countEmployees(orgId, { probationEndsBetween: [today, in30] }),
          upcomingJoiners(orgId),
          probationDue(orgId, today, in30),
        ])
      : null,
    ctx.can('org.manage') ? getStructure(orgId) : null,
  ]);

  const needsSetup = structure && structure.departments.length === 0;
  const [work, attention] = await Promise.all([myWork(orgId, me?.id ?? null, today), needsAttention(ctx, today)]);
  const monthName = (iso: string) => new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
  const RUN_STATUS: Record<string, string> = { draft: 'Draft', computed: 'Computed, to approve', approved: 'Approved, to lock', locked: 'Locked' };

  return (
    <>
      <PageHeader
        eyebrow={ctx.org.name}
        title="Dashboard"
        actions={ctx.can('employee.create') && <ButtonLink href={`${base}/employees/new`}>Add employee</ButtonLink>}
      />

      {needsSetup && (
        <div className="mb-6">
          <Alert tone="info" title="Set up your organization">
            Add departments, designations and locations first, so new employees can be placed correctly.{' '}
            <Link href={`${base}/structure`} className="font-medium text-primary hover:underline">Open organization setup →</Link>
          </Alert>
        </div>
      )}

      <section aria-label="Needs your attention" className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Waiting for your approval" value={work.approvals} href={`${base}/inbox`} />
        <Stat label="Your open tasks" value={work.tasks} href={`${base}/inbox`} />
        {attention.openTickets !== undefined && (
          <Stat label="Open helpdesk tickets" value={attention.openTickets} href={`${base}/helpdesk`}
            note={attention.breachedTickets ? `${attention.breachedTickets} past their SLA` : undefined} />
        )}
        {attention.openSeparations !== undefined && <Stat label="Exits in progress" value={attention.openSeparations} href={`${base}/separations`} />}
        {attention.overdueTraining !== undefined && <Stat label="Overdue training" value={attention.overdueTraining} href={`${base}/learning`} />}
        {attention.settlementsToApprove !== undefined && attention.settlementsToApprove !== 0 && (
          <Stat label="Settlements to approve" value={attention.settlementsToApprove} href={`${base}/separations`} />
        )}
        {attention.latestRun !== undefined && (
          <Stat label={attention.latestRun ? `Payroll, ${monthName(attention.latestRun.period_month)}` : 'Payroll'}
            value={attention.latestRun ? (RUN_STATUS[attention.latestRun.status] ?? attention.latestRun.status) : 'No runs yet'} href={`${base}/payroll`} />
        )}
      </section>

      {workforce && (
        <>
          {!ctx.can('employee.read', 'org') && (
            <p className="mb-3 text-sm text-muted">Figures include only the people in your reporting line.</p>
          )}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Active employees" value={workforce[0]} href={`${base}/employees?status=active`} />
            <Stat label="Pre-joining" value={workforce[1]} href={`${base}/employees?status=pre_joining`} />
            <Stat label="On notice" value={workforce[2]} href={`${base}/employees?status=on_notice`} />
            <Stat label="Probation ending ≤ 30 days" value={workforce[3]} />
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="Upcoming joiners" description="Employees in pre-joining, by joining date" />
              <PeopleList
                base={base}
                empty="No upcoming joiners."
                rows={workforce[4].map((e) => ({ id: e.id, name: legalName(e), meta: `Joins ${formatDate(e.date_of_joining)}` }))}
              />
            </Card>
            <Card>
              <CardHeader title="Probation reviews due" description="Probation ending in the next 30 days" />
              <PeopleList
                base={base}
                empty="No probation reviews due in the next 30 days."
                rows={workforce[5].map((e) => ({ id: e.id, name: legalName(e), meta: `Ends ${formatDate(e.probation_end_date)}` }))}
              />
            </Card>
          </div>
        </>
      )}

      {me && work.training.length > 0 && (
        <Card className="mt-6">
          <CardHeader title="Your training" actions={<ButtonLink href={`${base}/learning`} variant="secondary" size="sm">Open</ButtonLink>} />
          <ul className="divide-y divide-line text-sm" aria-label="Your training">
            {work.training.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                <span className="font-medium">{t.title}{t.mandatory && <span className="ml-2 text-xs text-muted">Mandatory</span>}</span>
                <span className={t.overdue ? 'font-medium text-danger' : 'text-muted'}>{t.dueOn ? `${t.overdue ? 'Overdue since' : 'Due'} ${formatDate(t.dueOn)}` : 'No due date'}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {me && (
        <Card className="mt-6">
          <CardHeader title="My profile" actions={<ButtonLink href={`${base}/employees/${me.id}`} variant="secondary" size="sm">View</ButtonLink>} />
          <p className="px-5 py-4 text-sm">
            {legalName(me)} · <span className="text-muted">{me.employee_code}</span>
          </p>
        </Card>
      )}

      {!workforce && !me && (
        <Card>
          <EmptyState title="Nothing to show yet" description="Your HR team hasn’t linked an employee profile to your account." />
        </Card>
      )}
    </>
  );
}

function Stat({ label, value, href, note }: { label: string; value: number | string | null; href?: string; note?: string }) {
  const body = (
    <>
      <p className="text-sm text-muted">{label}</p>
      <p className={`mt-2 font-semibold tabular-nums tracking-tight ${typeof value === 'string' ? 'text-lg' : 'text-3xl'}`}>
        {value === null ? '—' : typeof value === 'number' ? value.toLocaleString('en-IN') : value}
      </p>
      {note && <p className="mt-1 text-xs font-medium text-danger">{note}</p>}
    </>
  );
  return href ? (
    <Link href={href} className="rounded-lg border border-line bg-surface p-5 shadow-xs transition-colors hover:border-line-strong">
      {body}
    </Link>
  ) : (
    <div className="rounded-lg border border-line bg-surface p-5 shadow-xs">{body}</div>
  );
}

function PeopleList({ rows, base, empty }: { rows: Array<{ id: string; name: string; meta: string }>; base: string; empty: string }) {
  if (rows.length === 0) return <p className="px-5 py-6 text-sm text-muted">{empty}</p>;
  return (
    <ul className="divide-y divide-line">
      {rows.map((r) => (
        <li key={r.id}>
          <Link href={`${base}/employees/${r.id}`} className="flex items-center justify-between gap-3 px-5 py-3 text-sm hover:bg-subtle">
            <span className="font-medium">{r.name}</span>
            <span className="text-muted">{r.meta}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
