-- PeopleCore · People directory (Kredily parity): what employees can see about colleagues, probation confirmation,
-- and a directory function that respects those choices.
--
-- * directory_settings: per organization, which colleague fields every member sees (department, designation, work
--   email, work phone, location). HR keeps full access through the employees table and RLS as before.
-- * employees.confirmed_on: the day probation was confirmed. confirm_probation needs employee.update.
-- * people_directory: active colleagues for any member, with only the allowed fields, tenure in years (not the
--   joining date) and the manager's id for the org chart.

create table public.directory_settings (
  organization_id  uuid primary key references public.organizations (id) on delete cascade,
  show_department  boolean not null default true,
  show_designation boolean not null default true,
  show_email       boolean not null default false,
  show_phone       boolean not null default false,
  show_location    boolean not null default true,
  updated_by       uuid default auth.uid(),
  updated_at       timestamptz not null default now()
);
create trigger directory_settings_touch before update on public.directory_settings for each row execute function app.touch_updated_at();
create trigger directory_settings_audit after insert or update on public.directory_settings for each row execute function app.audit_row();
insert into public.directory_settings (organization_id) select id from public.organizations on conflict do nothing;

create function app.directory_settings_default() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.directory_settings (organization_id) values (new.id) on conflict do nothing;
  return null;
end $$;
create trigger organizations_directory_settings after insert on public.organizations
  for each row execute function app.directory_settings_default();

alter table public.directory_settings enable row level security;
create policy directory_settings_select on public.directory_settings for select to authenticated using (app.is_member(organization_id));
create policy directory_settings_update on public.directory_settings for update to authenticated
  using (app.has_permission(organization_id, 'org.manage')) with check (app.has_permission(organization_id, 'org.manage'));
grant select on public.directory_settings to authenticated;
grant update (show_department, show_designation, show_email, show_phone, show_location, updated_by) on public.directory_settings to authenticated;
grant all on public.directory_settings to service_role;

-- ─── Probation confirmation ─────────────────────────────────────────────────

alter table public.employees add column confirmed_on date;
alter table public.employees add constraint employees_confirmed_after_joining check (confirmed_on is null or confirmed_on >= date_of_joining);

create function public.confirm_probation(p_org uuid, p_employees uuid[], p_date date default null) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_n integer;
  v_on date := coalesce(p_date, app.org_today(p_org));
begin
  if not app.has_permission(p_org, 'employee.update') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.employees set confirmed_on = greatest(v_on, date_of_joining)
   where organization_id = p_org and id = any (p_employees) and confirmed_on is null and status in ('active', 'on_notice');
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.confirm_probation(uuid, uuid[], date) from public, anon;
grant execute on function public.confirm_probation(uuid, uuid[], date) to authenticated, service_role;

-- ─── The directory every member sees ────────────────────────────────────────

create function public.people_directory(p_org uuid, p_query text default null, p_limit integer default 500)
returns table (id uuid, name text, department text, designation text, location text, work_email text, work_phone text,
               tenure_years numeric, manager_id uuid)
language sql stable security definer set search_path = '' as $$
  select e.id, concat_ws(' ', e.first_name, e.middle_name, e.last_name),
         case when s.show_department then d.name end,
         case when s.show_designation then g.title end,
         case when s.show_location then l.name end,
         case when s.show_email then e.work_email end,
         case when s.show_phone then e.work_phone end,
         round(greatest(0, app.org_today(p_org) - e.date_of_joining) / 365.25, 1),
         e.manager_employee_id
    from public.employees e
    join public.directory_settings s on s.organization_id = e.organization_id
    left join public.departments d on d.id = e.department_id
    left join public.designations g on g.id = e.designation_id
    left join public.locations l on l.id = e.location_id
   where app.is_member(p_org) and e.organization_id = p_org and e.status in ('active', 'on_notice')
     and (coalesce(btrim(p_query), '') = ''
          or lower(concat_ws(' ', e.first_name, e.middle_name, e.last_name, d.name, g.title)) like '%' || lower(btrim(p_query)) || '%')
   order by e.first_name, e.last_name
   limit least(greatest(coalesce(p_limit, 500), 1), 2000);
$$;
revoke all on function public.people_directory(uuid, text, integer) from public, anon;
grant execute on function public.people_directory(uuid, text, integer) to authenticated, service_role;

-- ─── Profile gaps (for HR's "needs attention") ──────────────────────────────

-- Which identity and bank details are on file, as yes/no only. Needs employee.identity.read; bank presence is
-- reported only to holders of employee.bank.read.
create function public.people_profile_gaps(p_org uuid)
returns table (employee_id uuid, has_pan boolean, has_uan boolean, has_aadhaar boolean, has_bank boolean)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_bank boolean := app.has_permission(p_org, 'employee.bank.read');
begin
  if not app.has_permission(p_org, 'employee.identity.read') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return query
    select e.id, i.pan is not null, i.uan is not null, i.aadhaar_last4 is not null,
           case when v_bank then exists (select 1 from restricted.employee_bank_accounts b where b.employee_id = e.id and b.archived_at is null) end
      from public.employees e
      left join restricted.employee_identity i on i.employee_id = e.id
     where e.organization_id = p_org and e.status <> 'exited';
end $$;
revoke all on function public.people_profile_gaps(uuid) from public, anon;
grant execute on function public.people_profile_gaps(uuid) to authenticated, service_role;
