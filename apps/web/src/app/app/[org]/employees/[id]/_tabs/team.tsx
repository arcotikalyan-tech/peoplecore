import Link from 'next/link';
import { Avatar } from '@/components/ui/avatar';
import { createClient } from '@/server/supabase';
import { Empty, Panel, type ProfileProps } from './shared';
import { allRows } from '@/server/all-rows';

interface Row { id: string; name: string; designation: string | null; manager_id: string | null }

/** Team: the reporting line up from this person, and their direct reports. From the colleague directory. */
export async function TeamTab({ ctx, base, id, employee, isSelf }: ProfileProps) {
  const supabase = await createClient();
  const { data } = await allRows((a, b) => supabase.rpc('people_directory', { p_org: ctx.org.id, p_limit: 100_000 }).range(a, b));
  const people = new Map<string, Row>((data ?? []).map((r) => [r.id, r]));
  const canOpen = ctx.can('employee.read', 'org') || ctx.can('employee.read', 'team');

  const chain: Row[] = [];
  let next = employee.manager_employee_id;
  while (next && chain.length < 8 && !chain.some((c) => c.id === next)) {
    const m = people.get(next);
    if (!m) break;
    chain.unshift(m);
    next = m.manager_id;
  }
  const me: Row = people.get(id) ?? { id, name: [employee.first_name, employee.last_name].filter(Boolean).join(' '), designation: null, manager_id: employee.manager_employee_id };
  const reports = [...people.values()].filter((p) => p.manager_id === id);
  const peers = employee.manager_employee_id ? [...people.values()].filter((p) => p.manager_id === employee.manager_employee_id && p.id !== id) : [];

  const person = (p: Row, you = false) => {
    const body = (
      <span className="flex items-center gap-3">
        <Avatar name={p.name} />
        <span className="min-w-0">
          <span className="block truncate font-medium">{p.name}{you && <span className="ml-2 rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-semibold text-primary">{isSelf ? 'YOU' : 'THIS PROFILE'}</span>}</span>
          <span className="block truncate text-xs text-muted">{p.designation ?? '—'}</span>
        </span>
      </span>
    );
    return canOpen && !you ? <Link href={`${base}/employees/${p.id}`} className="block rounded-xl p-2 hover:bg-subtle">{body}</Link> : <div className="p-2">{body}</div>;
  };

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Panel title="Reporting Line">
        <ol className="px-3 py-2" aria-label="Reporting line">
          {chain.map((c) => (
            <li key={c.id}>{person(c)}<span aria-hidden="true" className="ml-6 block h-4 border-l border-line" /></li>
          ))}
          <li>{person(me, true)}</li>
        </ol>
      </Panel>
      <Panel title="Direct Reports" actions={<span className="text-xs text-muted">{reports.length} reportee{reports.length === 1 ? '' : 's'}</span>}>
        {reports.length === 0 ? <Empty icon="👥" title="No direct reports" /> : (
          <ul className="grid gap-1 px-3 py-2 sm:grid-cols-2" aria-label="Direct reports">{reports.map((r) => <li key={r.id}>{person(r)}</li>)}</ul>
        )}
      </Panel>
      {peers.length > 0 && (
        <Panel title="Peers" className="lg:col-span-2">
          <ul className="grid gap-1 px-3 py-2 sm:grid-cols-3" aria-label="Peers">{peers.map((r) => <li key={r.id}>{person(r)}</li>)}</ul>
        </Panel>
      )}
    </div>
  );
}
