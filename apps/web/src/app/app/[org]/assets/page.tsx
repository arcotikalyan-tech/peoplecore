import type { Metadata } from 'next';
import Link from 'next/link';
import { todayIn } from '@peoplecore/shared';
import { HubTabs } from '@/components/ui/hub';
import { assetCategories, assetIssues, assetRepairs, assetRequests, employeeAssets, listAccess, listAssets, listSystems } from '@/server/assets';
import { getOrgContext } from '@/server/context';
import { getMyEmployee } from '@/server/employees';
import { getStructure } from '@/server/structure';
import { createClient } from '@/server/supabase';
import { viewModeFor } from '@/server/view';
import { CategoriesTab, DuesTab, HubTab, RegisterTab, RepairsTab, RequestsTab, type AdminProps } from './_tabs/admin';
import { MyAssetsTab, MyRequestsTab } from './_tabs/mine';

export const metadata: Metadata = { title: 'Assets' };

type Search = Record<string, string | undefined>;
const btn = 'rounded-lg border border-line bg-surface px-3 py-2 text-sm hover:bg-subtle';

/**
 * Assets (Kredily's Asset Management and My Assets). Asset managers: hub, asset register (filters, import, export),
 * requests, categories, repairs and dues. Everyone: the assets issued to them, their system access, and requests.
 */
export default async function AssetsPage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<Search> }) {
  const { org: slug } = await params;
  const sp = await searchParams;
  const ctx = await getOrgContext(slug);
  const base = `/app/${slug}/assets`;
  const today = todayIn(ctx.org.timezone);
  const manages = ctx.can('asset.manage', 'org') && (await viewModeFor(ctx)) === 'admin';
  const me = await getMyEmployee(ctx.org.id, ctx.user.id);
  const categories = await assetCategories(ctx.org.id);

  if (!manages) {
    const [mine, requests, access, systems] = await Promise.all([
      me ? employeeAssets(ctx.org.id, me.id) : Promise.resolve([]),
      me ? assetRequests(ctx.org.id, me.id) : Promise.resolve([]),
      me ? listAccess(ctx.org.id, { employeeId: me.id, active: true }) : Promise.resolve([]),
      listSystems(ctx.org.id, true),
    ]);
    const ownsSystem = !!me && systems.some((s) => s.is_active && s.owner_employee_id === me.id);
    const held = mine.filter((i) => !i.returned_at);
    const tabs = [{ key: 'mine', label: '✦ My Assets', count: held.length }, { key: 'requests', label: 'My Requests', count: requests.filter((r) => r.status === 'pending').length }];
    const tab = tabs.some((t) => t.key === sp.tab) ? sp.tab! : 'mine';
    return (
      <>
        <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">My Assets</h1>
            <p className="mt-1 text-sm text-muted">Equipment issued to you, the systems you can sign in to, and what you’ve asked for.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {ownsSystem && <Link className={btn} href={`${base}/access`}>System access</Link>}
            <Link className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-fg" href={`${base}?tab=requests`}>＋ Request Asset</Link>
          </div>
        </header>
        <HubTabs base={base} label="Asset sections" tabs={tabs} current={tab} />
        {tab === 'mine' && <MyAssetsTab slug={slug} mine={mine} access={access} systems={systems} />}
        {tab === 'requests' && <MyRequestsTab slug={slug} requests={requests} categories={categories} hasEmployee={!!me} />}
      </>
    );
  }

  const supabase = await createClient();
  const [assets, requests, repairs, issues, structure, people] = await Promise.all([
    listAssets(ctx.org.id), assetRequests(ctx.org.id), assetRepairs(ctx.org.id), assetIssues(ctx.org.id, { limit: 1000 }), getStructure(ctx.org.id),
    supabase.from('employees').select('id, employee_code, first_name, last_name').eq('organization_id', ctx.org.id).then((r) => r.data ?? []),
  ]);
  const pendingRequests = requests.filter((r) => r.status === 'pending' || r.status === 'approved').length;
  const tabs = [
    { key: 'hub', label: '✦ Hub' }, { key: 'register', label: 'Asset Register', count: assets.length }, { key: 'requests', label: 'Requests', count: pendingRequests },
    { key: 'categories', label: 'Categories' }, { key: 'repairs', label: 'Repairs', count: repairs.filter((r) => !r.completed_on).length },
    { key: 'dues', label: 'Dues', count: issues.filter((x) => x.recovery_status === 'pending').length },
  ];
  const tab = tabs.some((t) => t.key === sp.tab) ? sp.tab! : 'hub';
  const props: AdminProps = {
    slug, base, today, sp, assets, categories, requests, repairs, issues,
    people: new Map(people.map((p) => [p.id, { code: p.employee_code, name: [p.first_name, p.last_name].filter(Boolean).join(' ') }])),
    locations: structure.locations.map((l) => ({ id: l.id, name: l.name })),
  };

  return (
    <>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Asset Management</h1>
          <p className="mt-1 text-sm text-muted">Hardware and equipment: who has what, requests, repairs and dues.</p>
        </div>
        <nav aria-label="Asset actions" className="flex flex-wrap gap-2">
          <Link className={btn} href={`${base}/access`}>System access</Link>
          <Link className={btn} href={`${base}?tab=register#import`}>⬆ Import</Link>
          <a className={btn} href={`${base}/export`} download>⬇ Export</a>
          <Link className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-fg" href={`${base}/new`}>＋ Add Asset</Link>
        </nav>
      </header>
      <HubTabs base={base} label="Asset sections" tabs={tabs} current={tab} />
      {tab === 'hub' && <HubTab {...props} />}
      {tab === 'register' && <RegisterTab {...props} />}
      {tab === 'requests' && <RequestsTab {...props} />}
      {tab === 'categories' && <CategoriesTab {...props} />}
      {tab === 'repairs' && <RepairsTab {...props} />}
      {tab === 'dues' && <DuesTab {...props} />}
    </>
  );
}
