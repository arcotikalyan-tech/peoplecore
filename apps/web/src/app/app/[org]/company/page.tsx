import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/action-form';
import { HubTabs, SubTabs } from '@/components/ui/hub';
import { formatDate } from '@/lib/format';
import { requirePermission } from '@/server/context';
import { listMembers } from '@/server/members';
import { createClient } from '@/server/supabase';
import { DepartmentsSection, DesignationsSection, LocationsSection } from '../structure/sections';
import {
  archiveCustomFieldAction, removeCompanyDocumentAction, removeRowAction, saveAddressAction, saveCompanyAction, saveCustomFieldAction, saveGradeAction, saveOfficerAction,
  setDesignationGradeAction, uploadCompanyDocumentAction,
} from './actions';
import { COMPANY_PROOFS, ENTITY_TYPES } from './company-data';
import { AddressForm, CustomFieldForm, DetailsForm, GradeForm, GradeSelect, OfficerForm, ProofUploadForm, StatutoryForm, type Profile } from './company-forms';
import { ButtonAction } from '../settings/settings-client';

export const metadata: Metadata = { title: 'Company Profile' };

const TABS = [
  { key: 'overview', label: 'Overview' }, { key: 'address', label: 'Address' }, { key: 'fields', label: 'Employee Custom Fields' },
  { key: 'department', label: 'Department' }, { key: 'designation', label: 'Designation' }, { key: 'announcements', label: 'Announcements' },
  { key: 'policies', label: 'Policies' }, { key: 'admin', label: 'Admin' }, { key: 'statutory', label: 'Statutory' },
];
const ADMIN_ROLES = ['owner', 'hr_admin', 'hr_executive', 'payroll_admin', 'finance_admin', 'vendor_admin', 'attendance_device_admin', 'auditor', 'partner'];

function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="lift-soft rounded-2xl border border-line bg-surface p-5" aria-label={title}>
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2"><h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted">{title}</h2>{action}</header>
      {children}
    </section>
  );
}
function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return <div><dt className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</dt><dd className="mt-1 text-sm font-medium">{value || <span className="text-muted">—</span>}</dd></div>;
}

/** Company Profile (as Kredily): details, offices, custom fields, structure, announcements, policies, admins, statutory. */
export default async function CompanyPage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { org: slug } = await params;
  const sp = await searchParams;
  const ctx = await requirePermission(slug, 'org.read');
  const tab = TABS.some((t) => t.key === sp.tab) ? sp.tab! : 'overview';
  const base = `/app/${slug}/company`;
  const manage = ctx.can('org.manage', 'org');
  const supabase = await createClient();
  const { data: row } = await supabase.from('company_profiles').select('*').eq('organization_id', ctx.org.id).maybeSingle();
  const p: Profile = { legal_name: ctx.org.name, brand_name: null, email: null, phone: null, website: null, industry: null, social: {}, entity_type: null, cin: null, llpin: null,
    incorporated_on: null, pan: null, tan: null, gstin: null, pf_code: null, esi_code: null, ...(row ? { ...row, social: (row.social ?? {}) as Record<string, string> } : {}) };
  const save = saveCompanyAction.bind(null, slug);
  const remove = (table: string, id: string, label: string) => manage && (
    <ActionForm action={removeRowAction.bind(null, slug)} label={`Remove ${label}`} submit="🗑" size="sm" variant="ghost" hidden={{ table, id }} className="inline-flex" />
  );
  if (!ctx.can('org.read')) notFound();

  return (
    <>
      <header className="mb-4"><h1 className="text-xl font-semibold tracking-tight">Company Profile</h1></header>
      <HubTabs base={base} label="Company profile sections" tabs={TABS} current={tab} />

      {tab === 'overview' && await (async () => {
        const [emps, depts, desigs, locs] = await Promise.all([
          supabase.from('employees').select('id', { count: 'exact', head: true }).eq('organization_id', ctx.org.id).in('status', ['active', 'on_notice']),
          supabase.from('departments').select('id', { count: 'exact', head: true }).eq('organization_id', ctx.org.id).is('archived_at', null),
          supabase.from('designations').select('id', { count: 'exact', head: true }).eq('organization_id', ctx.org.id).is('archived_at', null),
          supabase.from('locations').select('id', { count: 'exact', head: true }).eq('organization_id', ctx.org.id).is('archived_at', null),
        ]);
        const checks = [p.legal_name, p.brand_name, p.email, p.phone, p.website, p.industry, p.entity_type, p.pan, p.tan];
        const complete = Math.round((checks.filter(Boolean).length / checks.length) * 100);
        const since = (await supabase.from('organizations').select('created_at').eq('id', ctx.org.id).single()).data?.created_at.slice(0, 4);
        return (
          <div className="space-y-5">
            <section className="lift-soft flex flex-wrap items-center gap-5 rounded-2xl border border-line bg-surface p-6" aria-label="Company">
              <span aria-hidden="true" className="grid size-16 place-items-center rounded-2xl bg-primary text-2xl font-semibold text-primary-fg">{(p.brand_name ?? p.legal_name ?? ctx.org.name)[0]}</span>
              <div className="min-w-0 flex-1">
                <h2 className="text-xl font-semibold">{p.legal_name ?? ctx.org.name}</h2>
                <p className="text-sm text-muted">{p.industry ? `🏭 ${p.industry} · ` : ''}{slug}</p>
                <p className="mt-1 flex flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-wider"><span className="rounded-full bg-primary-soft px-2 py-0.5 text-primary">Active since {since}</span><span className="rounded-full bg-subtle px-2 py-0.5 text-muted">India</span></p>
              </div>
              <div className="text-center"><p className="text-3xl font-semibold text-primary">{complete}%</p><p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Profile complete</p></div>
            </section>
            <div className="grid gap-3 sm:grid-cols-5">
              {[['👥', emps.count ?? 0, 'Employees', `/app/${slug}/employees`], ['🏢', depts.count ?? 0, 'Departments', `${base}?tab=department`], ['💼', desigs.count ?? 0, 'Designations', `${base}?tab=designation`],
                ['📍', locs.count ?? 0, 'Locations', `${base}?tab=address`], ['📅', since, 'Active since', null]].map(([i, n, l, h]) => {
                const body = <><span aria-hidden="true" className="text-xl">{i}</span><span className="block text-2xl font-semibold tabular-nums">{n}</span><span className="text-xs text-muted">{l}</span></>;
                return h ? <Link key={String(l)} href={String(h)} className="lift rounded-2xl border border-line bg-surface p-4">{body}</Link> : <div key={String(l)} className="rounded-2xl border border-line bg-surface p-4">{body}</div>;
              })}
            </div>
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
              <Panel title="Company details">
                {manage && sp.edit === 'details' ? <DetailsForm action={save} p={p} /> : (
                  <>
                    <dl className="grid gap-4 sm:grid-cols-2">
                      <Field label="Registered company name" value={p.legal_name} /><Field label="Brand name" value={p.brand_name} />
                      <Field label="Company official email" value={p.email} /><Field label="Company official contact" value={p.phone} />
                      <Field label="Website" value={p.website} /><Field label="Domain name" value={slug} /><Field label="Industry type" value={p.industry} />
                    </dl>
                    {manage && <Link href={`${base}?tab=overview&edit=details`} className="mt-4 inline-block text-sm font-medium text-primary">✎ Edit profile</Link>}
                  </>
                )}
              </Panel>
              <div className="space-y-5">
                <Panel title="Profile completeness">
                  <div className="h-2 rounded-full bg-subtle"><div className="h-2 rounded-full bg-success" style={{ width: `${complete}%` }} /></div>
                  <p className="mt-2 text-sm text-muted">{checks.filter((c) => !c).length} item{checks.filter((c) => !c).length === 1 ? '' : 's'} left to reach a complete profile.</p>
                </Panel>
                <Panel title="Social profile">
                  {Object.keys(p.social).length === 0 ? <p className="text-sm text-muted">No social profiles linked.</p> : (
                    <ul className="space-y-1 text-sm">{Object.entries(p.social).map(([k, v]) => <li key={k}><a href={v} target="_blank" rel="noreferrer" className="text-primary hover:underline">{k}</a></li>)}</ul>
                  )}
                </Panel>
              </div>
            </div>
          </div>
        );
      })()}

      {tab === 'address' && await (async () => {
        const { data: addresses } = await supabase.from('company_addresses').select('*').eq('organization_id', ctx.org.id).order('created_at');
        const reg = addresses?.find((a) => a.kind === 'registered');
        const corp = addresses?.find((a) => a.kind === 'corporate');
        const custom = (addresses ?? []).filter((a) => a.kind === 'custom' || a.kind === 'branch');
        const show = (a: NonNullable<typeof reg>) => <p className="text-sm">{[a.line1, a.line2].filter(Boolean).join(', ')}<br />{[a.city, a.state, a.country, a.pincode].filter(Boolean).join(', ')}</p>;
        return (
          <div className="space-y-5">
            <div className="grid gap-5 lg:grid-cols-2">
              <Panel title="Registered office" action={reg && <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-semibold text-primary">Primary</span>}>
                {reg && sp.edit !== 'registered' ? <>{show(reg)}{manage && <Link href={`${base}?tab=address&edit=registered`} className="mt-3 inline-block text-sm text-primary">✎ Edit</Link>}</>
                  : manage ? <AddressForm action={saveAddressAction.bind(null, slug)} kind="registered" label="Registered office" address={reg} /> : <p className="text-sm text-muted">Not added yet.</p>}
              </Panel>
              <Panel title="Corporate office">
                {corp && sp.edit !== 'corporate' ? <>{show(corp)}{manage && <span className="mt-3 flex gap-3"><Link href={`${base}?tab=address&edit=corporate`} className="text-sm text-primary">✎ Edit</Link>{remove('company_addresses', corp.id, 'corporate office')}</span>}</>
                  : manage ? <AddressForm action={saveAddressAction.bind(null, slug)} kind="corporate" label="Corporate office" address={corp} /> : <p className="text-sm text-muted">Not added yet.</p>}
              </Panel>
            </div>
            <Panel title="Custom addresses">
              {custom.length === 0 ? <p className="mb-3 text-sm text-muted">📍 No custom addresses yet.</p> : (
                <ul className="mb-4 grid gap-3 sm:grid-cols-2">{custom.map((a) => <li key={a.id} className="rounded-xl border border-line p-3"><p className="font-medium">{a.label ?? 'Address'}</p>{show(a)}{remove('company_addresses', a.id, a.label ?? 'address')}</li>)}</ul>
              )}
              {manage && <AddressForm action={saveAddressAction.bind(null, slug)} kind="custom" label="Add address" />}
            </Panel>
            <LocationsSection ctx={ctx} slug={slug} />
          </div>
        );
      })()}

      {tab === 'fields' && await (async () => {
        const { data: fields } = await supabase.from('employee_custom_fields').select('*').eq('organization_id', ctx.org.id).order('position').order('created_at');
        return (
          <Panel title="Custom employee fields">
            {(fields ?? []).length === 0 ? <p className="mb-4 text-sm text-muted">No custom fields available.</p> : (
              <table className="mb-5 w-full text-sm">
                <thead><tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-muted"><th className="py-2">Field</th><th>Type</th><th>Options</th><th>Required</th><th>Employee edits</th><th /></tr></thead>
                <tbody className="divide-y divide-line">
                  {(fields ?? []).map((f) => (
                    <tr key={f.id} className={f.archived_at ? 'opacity-50' : ''}>
                      <td className="py-2 font-medium">{f.label}</td><td className="capitalize">{f.field_type === 'select' ? 'List' : f.field_type}</td>
                      <td className="text-muted">{f.options.join(', ') || '—'}</td><td>{f.required ? 'Yes' : 'No'}</td><td>{f.editable_by_employee ? 'Yes' : 'No'}</td>
                      <td className="text-right">{manage && <ActionForm action={archiveCustomFieldAction.bind(null, slug)} label={`${f.archived_at ? 'Restore' : 'Archive'} ${f.label}`} submit={f.archived_at ? 'Restore' : 'Archive'} size="sm" variant="ghost" hidden={{ id: f.id, restore: f.archived_at ? '1' : '' }} className="inline-flex" />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {manage && <div className="rounded-xl border border-dashed border-line p-4"><CustomFieldForm action={saveCustomFieldAction.bind(null, slug)} /></div>}
            <p className="mt-3 text-xs text-muted">Fields appear on every employee’s profile under “Custom fields”.</p>
          </Panel>
        );
      })()}

      {tab === 'department' && <DepartmentsSection ctx={ctx} slug={slug} />}

      {tab === 'designation' && await (async () => {
        const view = sp.view === 'grades' ? 'grades' : 'designations';
        const [{ data: grades }, { data: desigs }] = await Promise.all([
          supabase.from('grades').select('id, name, rank, description').eq('organization_id', ctx.org.id).order('rank').order('name'),
          supabase.from('designations').select('id, title, grade_id').eq('organization_id', ctx.org.id).is('archived_at', null).order('title'),
        ]);
        return (
          <div className="space-y-4">
            <SubTabs base={base} label="Designation sections" current={view} extra={{ tab: 'designation' }} tabs={[{ key: 'designations', label: 'Designations' }, { key: 'grades', label: 'Grades', count: grades?.length ?? 0 }]} />
            {view === 'designations' ? (
              <>
                <DesignationsSection ctx={ctx} slug={slug} />
                {manage && (grades ?? []).length > 0 && (
                  <Panel title="Grade for each designation">
                    <ul className="divide-y divide-line">{(desigs ?? []).map((d) => <li key={d.id} className="flex items-center justify-between py-2 text-sm"><span>{d.title}</span><GradeSelect action={setDesignationGradeAction.bind(null, slug)} designationId={d.id} current={d.grade_id} grades={grades ?? []} /></li>)}</ul>
                  </Panel>
                )}
              </>
            ) : (
              <Panel title="Grades">
                {(grades ?? []).length === 0 ? <p className="mb-4 text-sm text-muted">No grades yet. Grades group designations into levels (L1, L2…).</p> : (
                  <ul className="mb-4 divide-y divide-line">{(grades ?? []).map((g) => <li key={g.id} className="flex items-center justify-between py-2 text-sm"><span><b>{g.name}</b> <span className="text-muted">{g.description}</span></span><span className="flex items-center gap-3"><span className="text-xs text-muted">{(desigs ?? []).filter((d) => d.grade_id === g.id).length} designations</span>{remove('grades', g.id, g.name)}</span></li>)}</ul>
                )}
                {manage && <GradeForm action={saveGradeAction.bind(null, slug)} />}
              </Panel>
            )}
          </div>
        );
      })()}

      {tab === 'announcements' && await (async () => {
        const { data } = await supabase.from('announcements').select('id, title, published_at, requires_ack, expires_at').eq('organization_id', ctx.org.id).order('published_at', { ascending: false }).limit(50);
        return (
          <Panel title="Announcements" action={ctx.can('announcement.manage', 'org') && <Link href={`/app/${slug}/engagement`} className="rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-fg">+ New</Link>}>
            {(data ?? []).length === 0 ? <p className="text-sm text-muted">No announcements yet.</p> : (
              <ul className="divide-y divide-line">{(data ?? []).map((a) => <li key={a.id} className="flex justify-between py-2 text-sm"><Link href={`/app/${slug}/engagement`} className="font-medium hover:text-primary">{a.title}</Link><span className="text-xs text-muted">{formatDate(a.published_at.slice(0, 10))}{a.requires_ack ? ' · needs acknowledgement' : ''}</span></li>)}</ul>
            )}
          </Panel>
        );
      })()}

      {tab === 'policies' && await (async () => {
        const { data } = await supabase.from('policy_documents').select('id, title, version, published_at, requires_acknowledgement, retired_at').eq('organization_id', ctx.org.id).is('retired_at', null).order('title');
        return (
          <Panel title="Company policies" action={ctx.can('policy.manage', 'org') && <Link href={`/app/${slug}/policies`} className="rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-fg">Add Policy</Link>}>
            {(data ?? []).length === 0 ? <p className="text-sm text-muted">📄 No policies defined.</p> : (
              <table className="w-full text-sm"><thead><tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-muted"><th className="py-2">Policy</th><th>Version</th><th>Published</th><th>Actions</th></tr></thead>
                <tbody className="divide-y divide-line">{(data ?? []).map((d) => <tr key={d.id}><td className="py-2 font-medium">📄 {d.title}</td><td>v{d.version}</td><td className="text-muted">{formatDate(d.published_at.slice(0, 10))}</td><td><Link href={`/app/${slug}/policies`} className="text-xs text-primary">Open</Link></td></tr>)}</tbody></table>
            )}
          </Panel>
        );
      })()}

      {tab === 'admin' && await (async () => {
        if (!ctx.can('member.manage', 'org')) return <Panel title="Admins"><p className="text-sm text-muted">Only people who manage members can see the admin list.</p></Panel>;
        const [members, { data: roles }] = await Promise.all([listMembers(ctx.org.id), supabase.from('roles').select('id, key, name').eq('organization_id', ctx.org.id)]);
        const roleName = new Map((roles ?? []).map((r) => [r.id, r]));
        const admins = members.filter((m) => m.role_ids.some((id) => ADMIN_ROLES.includes(roleName.get(id)?.key ?? '')));
        return (
          <Panel title="Admins" action={<Link href={`/app/${slug}/members`} className="rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-fg">Manage members</Link>}>
            <table className="w-full text-sm"><thead><tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-muted"><th className="py-2">Name</th><th>Email</th><th>Roles</th><th>Last sign-in</th></tr></thead>
              <tbody className="divide-y divide-line">{admins.map((m) => (
                <tr key={m.member_id}><td className="py-2 font-medium">{m.employee_name ?? '—'}</td><td className="text-muted">{m.email}</td>
                  <td>{m.role_ids.map((id) => roleName.get(id)).filter((r) => r && ADMIN_ROLES.includes(r.key)).map((r) => r!.name).join(', ')}</td>
                  <td className="text-muted">{m.last_sign_in_at ? formatDate(m.last_sign_in_at.slice(0, 10)) : 'Never'}</td></tr>
              ))}</tbody></table>
          </Panel>
        );
      })()}

      {tab === 'statutory' && await (async () => {
        const view = ['director', 'auditor', 'secretary'].includes(sp.view ?? '') ? sp.view! : 'director';
        const { data: officers, error } = await supabase.from('company_officers').select('*').eq('organization_id', ctx.org.id).order('created_at');
        const ids = [p.entity_type, p.cin ?? p.llpin, p.incorporated_on, p.pan, p.tan, p.gstin];
        const done = ids.filter(Boolean).length;
        const directors = (officers ?? []).filter((o) => o.kind === 'director').length;
        return (
          <div className="space-y-5">
            <section className="lift-soft flex flex-wrap items-center gap-4 rounded-2xl border border-line bg-surface p-5" aria-label="Statutory & compliance">
              <span aria-hidden="true" className="grid size-12 place-items-center rounded-xl bg-primary-soft text-xl text-primary">§</span>
              <div className="flex-1"><h2 className="font-semibold">Statutory & compliance</h2><p className="text-sm text-muted">{done} of {ids.length} identifiers on file · {directors} director(s)</p></div>
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${done === ids.length ? 'bg-success-soft text-success' : 'bg-warning-soft text-warning'}`}>{Math.round((done / ids.length) * 100)}% {done === ids.length ? 'FILING-READY' : 'COMPLETE'}</span>
            </section>
            <Panel title="Company ID">
              {manage && sp.edit === 'ids' ? <StatutoryForm action={save} p={p} /> : (
                <>
                  <dl className="grid gap-4 sm:grid-cols-3">
                    <Field label="Entity type" value={ENTITY_TYPES.find((t) => t.value === p.entity_type)?.label} /><Field label="CIN / LLPIN" value={p.cin ?? p.llpin} />
                    <Field label="Date of incorporation" value={p.incorporated_on && formatDate(p.incorporated_on)} /><Field label="Company PAN" value={p.pan} />
                    <Field label="Company TAN" value={p.tan} /><Field label="GST" value={p.gstin} /><Field label="PF code" value={p.pf_code} /><Field label="ESI code" value={p.esi_code} />
                  </dl>
                  {manage && <Link href={`${base}?tab=statutory&edit=ids`} className="mt-4 inline-block text-sm text-primary">✎ Edit</Link>}
                </>
              )}
            </Panel>
            <Panel title="People on record">
              <SubTabs base={base} label="Officers" current={view} extra={{ tab: 'statutory' }} tabs={[{ key: 'director', label: 'Directors' }, { key: 'auditor', label: 'Auditors' }, { key: 'secretary', label: 'Company Secretary' }]} />
              {error || !officers ? <p className="text-sm text-muted">Visible to organization admins and auditors.</p> : (
                <>
                  <table className="mb-4 w-full text-sm"><thead><tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-muted"><th className="py-2">Name</th><th>Email ID</th><th>{view === 'director' ? 'DIN' : 'Membership'}</th><th>Phone number</th><th /></tr></thead>
                    <tbody className="divide-y divide-line">
                      {officers.filter((o) => o.kind === view).map((o) => <tr key={o.id}><td className="py-2 font-medium">{o.name}{o.firm && <span className="block text-xs text-muted">{o.firm}</span>}</td><td>{o.email ?? '—'}</td><td>{o.identifier ?? '—'}</td><td>{o.phone ?? '—'}</td><td className="text-right">{remove('company_officers', o.id, o.name)}</td></tr>)}
                      {officers.filter((o) => o.kind === view).length === 0 && <tr><td colSpan={5} className="py-3 text-muted">None added.</td></tr>}
                    </tbody></table>
                  {manage && <OfficerForm action={saveOfficerAction.bind(null, slug)} kind={view as 'director' | 'auditor' | 'secretary'} />}
                </>
              )}
            </Panel>
            {await (async () => {
              const { data: docs } = await supabase.from('company_documents').select('id, kind, file_name, uploaded_at').eq('organization_id', ctx.org.id).order('uploaded_at', { ascending: false });
              if (!manage && (docs ?? []).length === 0) return null;
              return (
                <Panel title="Proofs">
                  <p className="mb-3 text-sm text-muted">Copies of the company’s registrations, kept privately: organization admins add them; auditors can read them.</p>
                  <ul className="divide-y divide-line" aria-label="Company proofs">
                    {COMPANY_PROOFS.map(({ kind, label }) => {
                      const latest = (docs ?? []).filter((d) => d.kind === kind);
                      return (
                        <li key={kind} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                          <span className="min-w-48"><span className="font-medium">{label}</span>
                            {latest.length ? latest.map((d) => (
                              <span key={d.id} className="block text-xs text-muted">
                                <a href={`/app/${slug}/company/documents/${d.id}`} className="text-primary hover:underline">📎 {d.file_name}</a> · uploaded {formatDate(d.uploaded_at.slice(0, 10))}
                                {manage && <span className="ml-2 inline-block align-middle"><ButtonAction action={removeCompanyDocumentAction.bind(null, slug, d.id)} aria={`Remove ${d.file_name}`} label="Remove" variant="ghost" /></span>}
                              </span>
                            )) : <span className="block text-xs text-muted">Not uploaded</span>}
                          </span>
                          {manage && <ProofUploadForm action={uploadCompanyDocumentAction.bind(null, slug)} kind={kind} label={label} replace={latest.length > 0} />}
                        </li>
                      );
                    })}
                  </ul>
                </Panel>
              );
            })()}
            <Panel title="Bank account info"><p className="text-sm text-muted">The salary debit account lives in <Link href={`/app/${slug}/payroll?tab=settings&view=bank`} className="text-primary hover:underline">Payroll › Settings › Bank Integration</Link>.</p></Panel>
          </div>
        );
      })()}
    </>
  );
}
