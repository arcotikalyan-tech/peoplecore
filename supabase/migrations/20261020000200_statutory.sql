-- PeopleCore · Statutory compliance (Kredily's Compliance: overview, calendar, documents, library, regime map, engine).
--
-- The form catalogue and the due-date / applicability engine live in the app (packages/shared/src/statutory.ts);
-- the database keeps what each organization records about them:
-- * statutory_scope: facts the app can't infer (contract labour engaged, factory).
-- * establishment_registrations: PT, LWF and S&E registration numbers per location.
-- * statutory_filings: an obligation marked filed (date, acknowledgement, proof file) or not applicable for a period.
--   Proof files sit in the private statutory-documents bucket (written by the app server only) and are kept at least
--   five years after the period ends: a row with a proof can't be deleted, nor its proof replaced, before then.
-- * statutory_facts: the counts the engine needs (headcount by state, PF/ESI switches and codes, identity gaps).
-- New permission statutory.manage (owners, HR, payroll).

insert into public.permissions (key, module, description, is_sensitive) values
  ('statutory.manage', 'payroll', 'Track statutory registers, returns and filings', false);
insert into app.role_template_permissions (role_key, permission_key, scope) values
  ('owner', 'statutory.manage', 'org'), ('hr_admin', 'statutory.manage', 'org'), ('payroll_admin', 'statutory.manage', 'org');
insert into public.role_permissions (organization_id, role_id, permission_key, scope)
select r.organization_id, r.id, t.permission_key, t.scope
  from app.role_template_permissions t join public.roles r on r.key = t.role_key and r.is_system
 where t.permission_key = 'statutory.manage'
on conflict (role_id, permission_key) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('statutory-documents', 'statutory-documents', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

-- ─── Tables ─────────────────────────────────────────────────────────────────

create table public.statutory_scope (
  organization_id  uuid primary key references public.organizations (id) on delete cascade,
  contract_labour  boolean not null default false,
  factory          boolean not null default false,
  updated_by       uuid default auth.uid(),
  updated_at       timestamptz not null default now()
);
create trigger statutory_scope_touch before update on public.statutory_scope for each row execute function app.touch_updated_at();
create trigger statutory_scope_audit after insert or update on public.statutory_scope for each row execute function app.audit_row();

create table public.establishment_registrations (
  organization_id  uuid not null,
  location_id      uuid primary key,
  pt_number        text check (char_length(pt_number) <= 40),
  pt_enrolment     text check (char_length(pt_enrolment) <= 40),
  lwf_number       text check (char_length(lwf_number) <= 40),
  se_number        text check (char_length(se_number) <= 60),
  updated_by       uuid default auth.uid(),
  updated_at       timestamptz not null default now(),
  foreign key (organization_id, location_id) references public.locations (organization_id, id) on delete cascade
);
create trigger establishment_registrations_touch before update on public.establishment_registrations for each row execute function app.touch_updated_at();
create trigger establishment_registrations_audit after insert or update or delete on public.establishment_registrations for each row execute function app.audit_row();

create table public.statutory_filings (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  form_id          text not null check (form_id ~ '^[A-Z]{2}-[A-Z]{1,3}-[0-9]{2}$'),
  period_start     date not null,
  period_end       date not null,
  due_on           date,
  status           text not null check (status in ('filed', 'not_applicable')),
  filed_on         date,
  reference        text check (char_length(reference) <= 80),
  note             text check (char_length(note) <= 500),
  proof_path       text check (proof_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}$'),
  proof_name       text check (char_length(proof_name) <= 200),
  retain_until     date generated always as ((period_end + interval '5 years')::date) stored,
  recorded_by      uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, form_id, period_start),
  unique (organization_id, id),
  check (period_end >= period_start),
  check (status <> 'filed' or filed_on is not null),
  check ((proof_path is null) = (proof_name is null))
);
create index statutory_filings_org_due_idx on public.statutory_filings (organization_id, due_on);
create trigger statutory_filings_touch before update on public.statutory_filings for each row execute function app.touch_updated_at();
create trigger statutory_filings_audit after insert or update or delete on public.statutory_filings for each row execute function app.audit_row();

-- Proof of filing is retained: no deleting the record, or swapping its proof, until five years after the period.
create function app.statutory_filing_retention() returns trigger language plpgsql set search_path = '' as $$
begin
  if old.proof_path is not null and current_date < old.retain_until
     and (tg_op = 'DELETE' or new.proof_path is distinct from old.proof_path) then
    raise exception 'Proof of filing is kept until %. It can''t be removed or replaced before then.', to_char(old.retain_until, 'DD Mon YYYY')
      using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger statutory_filings_retention before update or delete on public.statutory_filings
  for each row execute function app.statutory_filing_retention();

alter table public.statutory_scope enable row level security;
alter table public.establishment_registrations enable row level security;
alter table public.statutory_filings enable row level security;
create policy statutory_scope_all on public.statutory_scope for all to authenticated
  using (app.has_permission(organization_id, 'statutory.manage')) with check (app.has_permission(organization_id, 'statutory.manage'));
create policy establishment_registrations_all on public.establishment_registrations for all to authenticated
  using (app.has_permission(organization_id, 'statutory.manage')) with check (app.has_permission(organization_id, 'statutory.manage'));
create policy statutory_filings_all on public.statutory_filings for all to authenticated
  using (app.has_permission(organization_id, 'statutory.manage')) with check (app.has_permission(organization_id, 'statutory.manage'));
grant select, insert, update on public.statutory_scope to authenticated;
grant select, insert, update, delete on public.establishment_registrations, public.statutory_filings to authenticated;
grant all on public.statutory_scope, public.establishment_registrations, public.statutory_filings to service_role;

-- ─── Facts for the engine ───────────────────────────────────────────────────

-- Counts only (no identity numbers): employees in scope (active or on notice), by establishment, and the gaps that
-- block filings (PF members without a UAN, ESI members without an ESIC number, anyone without a PAN).
create function public.statutory_facts(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v jsonb;
begin
  if not app.has_permission(p_org, 'statutory.manage') then
    raise exception 'You can''t view statutory compliance.' using errcode = '42501';
  end if;
  with staff as (
    select e.id, e.location_id, coalesce(sp.pf_applicable, true) as pf, coalesce(sp.esi_applicable, false) as esi,
           i.pan, i.uan, i.esic_number
      from public.employees e
      left join public.employee_statutory_profiles sp on sp.employee_id = e.id
      left join restricted.employee_identity i on i.employee_id = e.id
     where e.organization_id = p_org and e.status in ('active', 'on_notice')
  )
  select jsonb_build_object(
    'headcount', (select count(*) from staff),
    'unmapped', (select count(*) from staff s left join public.locations l on l.id = s.location_id where l.state_code is null),
    'establishments', coalesce((
      select jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'city', l.city, 'state', l.state_code,
                                          'headcount', (select count(*) from staff s where s.location_id = l.id),
                                          'pt_number', r.pt_number, 'pt_enrolment', r.pt_enrolment, 'lwf_number', r.lwf_number, 'se_number', r.se_number)
                       order by l.name)
        from public.locations l left join public.establishment_registrations r on r.location_id = l.id
       where l.organization_id = p_org and l.archived_at is null), '[]'::jsonb),
    'pf_members', (select count(*) from staff where pf),
    'pf_missing_uan', (select count(*) from staff where pf and uan is null),
    'esi_members', (select count(*) from staff where esi),
    'esi_missing_number', (select count(*) from staff where esi and esic_number is null),
    'missing_pan', (select count(*) from staff where pan is null),
    'settings', (select jsonb_build_object('pf', coalesce(ps.pf_enabled, true), 'esi', coalesce(ps.esi_enabled, true), 'pt', coalesce(ps.pt_enabled, true))
                   from (select 1) one left join public.payroll_settings ps on ps.organization_id = p_org),
    'company', (select jsonb_build_object('pan', cp.pan is not null, 'tan', cp.tan is not null, 'pf_code', cp.pf_code is not null, 'esi_code', cp.esi_code is not null)
                  from (select 1) one left join public.company_profiles cp on cp.organization_id = p_org),
    'scope', (select jsonb_build_object('contract_labour', coalesce(sc.contract_labour, false), 'factory', coalesce(sc.factory, false))
                from (select 1) one left join public.statutory_scope sc on sc.organization_id = p_org),
    'locked_months', coalesce((select jsonb_agg(to_char(r.period_month, 'YYYY-MM') order by r.period_month)
                                 from public.payroll_runs r where r.organization_id = p_org and r.status = 'locked'), '[]'::jsonb),
    'any_payroll', exists (select 1 from public.payroll_runs r where r.organization_id = p_org and r.status <> 'cancelled')
  ) into v;
  return v;
end $$;
revoke all on function public.statutory_facts(uuid) from public;
grant execute on function public.statutory_facts(uuid) to authenticated;
