import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HubTabs, Panel } from '@/components/ui/hub';
import { Badge } from '@/components/ui/surface';
import { formatDateTime } from '@/lib/format';
import { MODULES, NOTIFICATION_CATEGORIES } from '@/lib/modules';
import { getOrgContext, type OrgContext } from '@/server/context';
import { disabledModules, orgControls } from '@/server/modules';
import { setupChecks } from '@/server/setup';
import { createClient } from '@/server/supabase';
import {
  cancelClosureAction, createRoleAction, deleteRoleAction, grantSupportAction, requestClosureAction, revokeSupportAction, saveControlsAction, saveModulesAction,
  setPayrollShortcutAction, setRequireMfaAction, saveNotificationsAction, setRolePermissionAction,
} from './actions';
import { ButtonAction, ClosureForm, ControlsForm, RoleForm, ScopeCell, SupportForm, ToggleList } from './settings-client';
import { saveDirectorySettingsAction } from '../employees/people-actions';
import { DirectorySettingsForm } from '../employees/people-client';
import { directorySettings } from '@/server/people';

export const metadata: Metadata = { title: 'Settings' };

type Search = Record<string, string | undefined>;

/**
 * Settings (Kredily's Settings and the CEO's settings): a hub of every setting, roles and permissions, the module
 * selector, controls, notifications, the setup wizard (readiness checklist), support access and bank integration.
 */
export default async function SettingsPage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<Search> }) {
  const { org: slug } = await params;
  const sp = await searchParams;
  const ctx = await getOrgContext(slug);
  if (!ctx.can('org.manage', 'org') && !ctx.can('role.manage', 'org')) notFound();
  const base = `/app/${slug}/settings`;
  const owner = ctx.can('role.manage', 'org');
  const tabs = [
    { key: 'hub', label: '✦ Hub' }, { key: 'setup', label: 'Setup wizard' }, { key: 'roles', label: 'Roles & permissions' }, { key: 'modules', label: 'Module selector' },
    { key: 'controls', label: 'Controls' }, { key: 'notifications', label: 'Notifications' }, ...(owner ? [{ key: 'support', label: 'Support access' }] : []),
  ];
  const tab = tabs.some((t) => t.key === sp.tab) ? sp.tab! : 'hub';
  return (
    <>
      <header className="mb-5"><h1 className="text-2xl font-semibold tracking-tight">Settings</h1><p className="mt-1 text-sm text-muted">How {ctx.org.name} is set up: modules, access, controls and notifications.</p></header>
      <HubTabs base={base} label="Settings sections" tabs={tabs} current={tab} />
      {tab === 'hub' && <Hub slug={slug} base={base} owner={owner} />}
      {tab === 'setup' && <Setup ctx={ctx} slug={slug} />}
      {tab === 'roles' && <Roles ctx={ctx} slug={slug} owner={owner} />}
      {tab === 'modules' && (
        <Panel title="Module selector" meta="Switched-off modules disappear from navigation for everyone; their data is kept.">
          {await (async () => {
            const off = await disabledModules(ctx.org.id);
            return <ToggleList action={saveModulesAction.bind(null, slug)} label="Modules" name="module" submit="Save modules"
              items={MODULES.map((m) => ({ key: m.key, label: m.label, group: m.group, on: !off.has(m.key) }))} />;
          })()}
        </Panel>
      )}
      {tab === 'controls' && <ControlsTab slug={slug} ctx={ctx} owner={ctx.can('role.manage', 'org')} />}
      {tab === 'notifications' && (
        <Panel title="Notifications" meta="Switch a category off to stop those notifications for everyone in the organization.">
          {await (async () => {
            const supabase = await createClient();
            const { data } = await supabase.from('notification_settings').select('category, enabled').eq('organization_id', ctx.org.id);
            const off = new Set((data ?? []).filter((d) => !d.enabled).map((d) => d.category));
            return <ToggleList action={saveNotificationsAction.bind(null, slug)} label="Notification categories" name="category" submit="Save notifications"
              items={NOTIFICATION_CATEGORIES.map(([k, l, n]) => ({ key: k, label: l, note: n, on: !off.has(k) }))} />;
          })()}
        </Panel>
      )}
      {tab === 'support' && owner && <Support ctx={ctx} slug={slug} />}
    </>
  );
}

function Hub({ slug, base, owner }: { slug: string; base: string; owner: boolean }) {
  const app = `/app/${slug}`;
  const cards = [
    { icon: '🏢', title: 'Company profile', note: 'Details, offices, departments, designations, statutory IDs', href: `${app}/company` },
    { icon: '🧭', title: 'Setup wizard', note: 'What’s ready and what’s left', href: `${base}?tab=setup` },
    { icon: '🛡', title: 'Roles & permissions', note: 'What each role can do; custom roles', href: `${base}?tab=roles` },
    { icon: '👥', title: 'Members', note: 'Invite people and assign roles', href: `${app}/members` },
    { icon: '🧩', title: 'Module selector', note: 'Turn modules on or off', href: `${base}?tab=modules` },
    { icon: '🎛', title: 'Controls', note: 'Self-edits, salary history, birthdays', href: `${base}?tab=controls` },
    { icon: '🔔', title: 'Notifications', note: 'Which notifications people get', href: `${base}?tab=notifications` },
    { icon: '📅', title: 'Work week', note: 'Working, half and off days per week', href: `${app}/attendance?tab=rules` },
    { icon: '🌴', title: 'Holiday calendars', note: 'Per location, weekly offs, optional holidays', href: `${app}/holidays?tab=rules` },
    { icon: '🏦', title: 'Bank integration', note: 'Salary bank file format and debit account', href: `${app}/payroll?tab=settings&view=bank` },
    { icon: '🔁', title: 'Approval workflows', note: 'Who approves what, escalation', href: `${app}/workflows` },
    ...(owner ? [{ icon: '🛟', title: 'Support access', note: 'Let PeopleCore support look, for a while', href: `${base}?tab=support` }] : []),
  ];
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Settings">
      {cards.map((c) => (
        <li key={c.title}><Link href={c.href} className="lift flex items-start gap-3 rounded-xl border border-line bg-surface p-4">
          <span aria-hidden className="text-2xl">{c.icon}</span><span><span className="block font-medium">{c.title}</span><span className="block text-xs text-muted">{c.note}</span></span>
        </Link></li>
      ))}
    </ul>
  );
}

async function Setup({ ctx, slug }: { ctx: OrgContext; slug: string }) {
  const steps = await setupChecks(ctx.org.id, slug);
  const done = steps.filter((s) => s.done).length;
  const groups = [...new Set(steps.map((s) => s.group))];
  return (
    <div className="space-y-5">
      <Panel title="Readiness" meta={`${done} of ${steps.length} ready`}>
        <div className="h-2 rounded-full bg-subtle" role="progressbar" aria-valuenow={Math.round((done / steps.length) * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Setup progress">
          <div className="h-2 rounded-full bg-primary" style={{ width: `${(done / steps.length) * 100}%` }} />
        </div>
        <p className="mt-2 text-sm text-muted">Import many employees at once from a CSV on the People page.</p>
      </Panel>
      <div className="grid gap-5 lg:grid-cols-2">
        {groups.map((g) => (
          <Panel key={g} title={g} flush>
            <ul className="divide-y divide-line" aria-label={`${g} setup`}>
              {steps.filter((s) => s.group === g).map((s) => (
                <li key={s.title} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                  <span className="flex items-center gap-3"><span aria-hidden className={`grid size-6 place-items-center rounded-full text-xs ${s.done ? 'bg-success-soft text-success' : 'bg-subtle text-muted'}`}>{s.done ? '✓' : '·'}</span>
                    <span><span className="block font-medium">{s.title}</span><span className="block text-xs text-muted">{s.note}</span></span></span>
                  <Link className="text-primary hover:underline" href={s.href}>{s.done ? 'Review' : 'Set up'} →</Link>
                </li>
              ))}
            </ul>
          </Panel>
        ))}
      </div>
    </div>
  );
}

async function Roles({ ctx, slug, owner }: { ctx: OrgContext; slug: string; owner: boolean }) {
  const supabase = await createClient();
  const [roles, grants, perms, assigned] = await Promise.all([
    supabase.from('roles').select('id, key, name, description, is_system, requires_mfa').eq('organization_id', ctx.org.id).order('is_system', { ascending: false }).order('name').then((r) => r.data ?? []),
    supabase.from('role_permissions').select('role_id, permission_key, scope').eq('organization_id', ctx.org.id).then((r) => r.data ?? []),
    supabase.from('permissions').select('key, module, description, is_sensitive').order('module').order('key').then((r) => r.data ?? []),
    supabase.from('member_roles').select('role_id').eq('organization_id', ctx.org.id).then((r) => r.data ?? []),
  ]);
  const scope = new Map(grants.map((g) => [`${g.role_id}|${g.permission_key}`, g.scope as string]));
  const count = (id: string) => assigned.filter((a) => a.role_id === id).length;
  const modules = [...new Set(perms.map((p) => p.module))];
  return (
    <div className="space-y-5">
      <Panel title="Roles" meta={`${roles.length}`} flush>
        <ul className="divide-y divide-line" aria-label="Roles">
          {roles.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
              <span><span className="font-medium">{r.name}</span> {r.is_system ? <Badge>Built-in</Badge> : <Badge tone="primary">Custom</Badge>} {r.requires_mfa && <Badge tone="warning">Two-step sign-in</Badge>}
                <span className="block text-xs text-muted">{r.description ?? ''} · {count(r.id)} member{count(r.id) === 1 ? '' : 's'} · {grants.filter((g) => g.role_id === r.id).length} permissions</span></span>
              {owner && !r.is_system && count(r.id) === 0 && <DeleteRole slug={slug} roleId={r.id} name={r.name} />}
            </li>
          ))}
        </ul>
      </Panel>
      {owner && <Panel title="Create a custom role"><RoleForm action={createRoleAction.bind(null, slug)} roles={roles.map((r) => ({ id: r.id, name: r.name }))} /></Panel>}
      <Panel title="Capability matrix" meta={owner ? 'Built-in roles are fixed; change custom roles here.' : 'Read only'} flush>
        <div className="overflow-x-auto">
          <table className="w-full text-xs" aria-label="Capability matrix">
            <thead className="sticky top-0 bg-surface text-left text-[10px] uppercase tracking-wider text-muted">
              <tr><th className="px-4 py-2">Permission</th>{roles.map((r) => <th key={r.id} className="px-2 py-2 text-center">{r.name}</th>)}</tr>
            </thead>
            {modules.map((m) => (
              <tbody key={m} className="divide-y divide-line">
                <tr><td colSpan={roles.length + 1} className="bg-subtle px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">{m.replace('_', ' ')}</td></tr>
                {perms.filter((p) => p.module === m).map((p) => (
                  <tr key={p.key}>
                    <td className="px-4 py-1.5"><span className="font-medium">{p.description}</span>{p.is_sensitive && <span className="ml-1 text-warning" title="Sensitive">●</span>}<span className="block text-[10px] text-muted">{p.key}</span></td>
                    {roles.map((r) => {
                      const s = scope.get(`${r.id}|${p.key}`) ?? null;
                      return (
                        <td key={r.id} className="px-2 py-1.5 text-center">
                          {owner && !r.is_system
                            ? <ScopeCell action={setRolePermissionAction.bind(null, slug)} roleId={r.id} permission={p.key} scope={s} label={`${r.name}: ${p.key}`} />
                            : s ? <span className={`rounded px-1.5 py-0.5 ${s === 'org' ? 'bg-primary-soft text-primary' : 'bg-subtle'}`}>{s}</span> : <span className="text-muted">—</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      </Panel>
    </div>
  );
}

function DeleteRole({ slug, roleId, name }: { slug: string; roleId: string; name: string }) {
  return <ButtonAction action={async (prev) => { 'use server'; const fd = new FormData(); fd.set('roleId', roleId); return deleteRoleAction(slug, prev, fd); }} label="Delete" aria={`Delete role ${name}`} variant="ghost" />;
}

async function Support({ ctx, slug }: { ctx: OrgContext; slug: string }) {
  const supabase = await createClient();
  const { data } = await supabase.from('support_access_windows').select('id, reason, starts_at, expires_at, revoked_at').eq('organization_id', ctx.org.id).order('starts_at', { ascending: false }).limit(20);
  const now = new Date().toISOString();
  const open = (data ?? []).find((w) => !w.revoked_at && w.expires_at > now);
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Panel title="Support access" meta="PeopleCore support can see a summary of your organization only while a window is open. Every look is recorded in your audit log.">
        {open ? (
          <div className="space-y-3 text-sm">
            <p><Badge tone="warning">Open</Badge> until {formatDateTime(open.expires_at, ctx.org.timezone)} — {open.reason}</p>
            <ButtonAction action={revokeSupportAction.bind(null, slug)} label="Close support access now" aria="Close support access" variant="danger" />
          </div>
        ) : <SupportForm action={grantSupportAction.bind(null, slug)} />}
      </Panel>
      <Panel title="History" flush>
        <ul className="divide-y divide-line text-sm" aria-label="Support access history">
          {(data ?? []).length === 0 && <li className="px-5 py-4 text-muted">Never opened.</li>}
          {(data ?? []).map((w) => (
            <li key={w.id} className="px-5 py-2.5"><span className="font-medium">{w.reason}</span>
              <span className="block text-xs text-muted">{formatDateTime(w.starts_at, ctx.org.timezone)} → {formatDateTime(w.revoked_at ?? w.expires_at, ctx.org.timezone)}{w.revoked_at ? ' (closed)' : w.expires_at < now ? ' (expired)' : ''}</span></li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

async function ControlsTab({ slug, ctx, owner }: { slug: string; ctx: OrgContext; owner: boolean }) {
  const orgId = ctx.org.id;
  const supabase = await createClient();
  const [c, dir, grants, { data: org }] = await Promise.all([
    orgControls(orgId), directorySettings(orgId),
    supabase.from('role_permissions').select('permission_key, scope, roles!inner(key)').eq('organization_id', orgId)
      .in('permission_key', ['payroll.approve', 'compensation.read']).in('roles.key', ['hr_admin', 'manager']),
    supabase.from('organizations').select('name, closes_on').eq('id', orgId).maybeSingle(),
  ]);
  const has = (role: string, permission: string) => (grants.data ?? []).some((g) => g.permission_key === permission && (g.roles as unknown as { key: string }).key === role);
  const shortcut = (key: 'hr_payroll_lock' | 'manager_pay_view', on: boolean, title: string, note: string) => (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-line p-4 text-sm">
      <p className="max-w-xl"><span className="block font-medium">{title} <Badge tone={on ? 'success' : 'neutral'}>{on ? 'On' : 'Off'}</Badge></span><span className="block text-xs text-muted">{note}</span></p>
      <ButtonAction action={setPayrollShortcutAction.bind(null, slug, key, !on)} aria={title} label={on ? 'Switch off' : 'Switch on'} />
    </div>
  );
  return (
    <div className="space-y-5">
      <Panel title="Controls"><ControlsForm action={saveControlsAction.bind(null, slug)} c={c} /></Panel>
      <Panel title="Directory" meta="Who can browse the directory and what colleagues see. The same settings are under People › Settings.">
        <DirectorySettingsForm action={saveDirectorySettingsAction.bind(null, slug)} s={dir} canEdit={ctx.can('org.manage', 'org')} />
      </Panel>
      {owner && (
        <Panel title="Payroll access" meta="Shortcuts for the role matrix under Roles & permissions.">
          <div className="space-y-3">
            {shortcut('hr_payroll_lock', has('hr_admin', 'payroll.approve'), 'HR administrators can approve and lock payroll', 'Payroll staff prepare the run; with this on, HR can also be the second pair of eyes that approves and locks it.')}
            {shortcut('manager_pay_view', has('manager', 'compensation.read'), 'Reporting managers see their team’s salaries', 'Salaries are sensitive. Managers don’t need two-step sign-in by default, so turn this on only if your managers use it.')}
          </div>
        </Panel>
      )}
      {owner && (
        <Panel title="Two-step sign-in">
          <div className="flex flex-wrap items-center justify-between gap-4 text-sm">
            <p className="max-w-xl">
              {c.require_mfa
                ? 'Required for owners, HR, payroll and auditors: they enter a code from an authenticator app before they see sensitive records.'
                : 'Optional: owners, HR, payroll and auditors sign in with their password alone. Anyone can still turn it on for themselves under My preferences.'}
              <span className="mt-1 block text-xs text-muted">Recommended on. These roles can see every salary, bank account and ID number.</span>
            </p>
            <ButtonAction action={setRequireMfaAction.bind(null, slug, !c.require_mfa)} aria="Two-step sign-in requirement" label={c.require_mfa ? 'Make optional' : 'Require it'} variant={c.require_mfa ? 'danger' : 'secondary'} />
          </div>
        </Panel>
      )}
      {owner && !ctx.org.is_demo && org && (
        <Panel title="Close the company" meta="Everyone loses access on the closing day. You can cancel until then.">
          {org.closes_on ? (
            <div className="flex flex-wrap items-center justify-between gap-4 text-sm">
              <p role="status"><b>{ctx.org.name}</b> closes on <b>{org.closes_on}</b>. Payroll and statutory records are kept for their legal retention period, then erased.</p>
              <ButtonAction action={cancelClosureAction.bind(null, slug)} aria="Cancel closing the company" label="Cancel closing" />
            </div>
          ) : (
            <div className="space-y-3 text-sm">
              <p className="max-w-2xl text-muted">Closing stops all access for everyone 30 days from today. Payroll, tax and statutory records are kept for the period the law requires and then erased; ask support if you need them sooner.</p>
              <ClosureForm action={requestClosureAction.bind(null, slug)} name={org.name} />
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}
