-- PeopleCore · Group health insurance (Kredily's Insurance).
--
-- * One group policy per organization: insurer, policy number and validity; key benefits (maternity limits,
--   room rent, cover type, sum insured flat or by grade); additional benefits (wellness, e-consultation, health
--   check-up, pre-existing diseases, waivers, ambulance, pre/post hospitalisation, the claim process). Each field can
--   be hidden from employees (hidden_fields).
-- * Coverage per employee (covered or not, sum insured, from when). The insured roster is the covered employees
--   plus the family members their cover type includes: spouse and children (ESC), and parents too (ESCP).
-- * Endorsements: the roster is compared with the snapshot taken when the last endorsement was locked and synced
--   with the insurer — additions (joiners, new dependants) and deletions (exits, removed dependants).
-- * insurance.manage (owners and HR) keeps the policy, coverage and endorsements. Employees see their own cover.

insert into public.permissions (key, module, description, is_sensitive) values
  ('insurance.manage', 'benefits', 'Manage the group health policy, coverage and insurer endorsements', true);
insert into app.role_template_permissions (role_key, permission_key, scope) values
  ('owner', 'insurance.manage', 'org'), ('hr_admin', 'insurance.manage', 'org');
insert into public.role_permissions (organization_id, role_id, permission_key, scope)
select r.organization_id, r.id, t.permission_key, t.scope
  from app.role_template_permissions t join public.roles r on r.key = t.role_key and r.is_system
 where t.permission_key = 'insurance.manage'
on conflict (role_id, permission_key) do nothing;

-- ─── Policy ─────────────────────────────────────────────────────────────────

create table public.insurance_policies (
  organization_id        uuid primary key references public.organizations (id) on delete cascade,
  insurer                text check (char_length(insurer) between 2 and 120),
  policy_number          text check (char_length(policy_number) between 1 and 60),
  valid_from             date,
  valid_to               date,
  maternity_normal       numeric(12,2) check (maternity_normal >= 0),
  maternity_csection     numeric(12,2) check (maternity_csection >= 0),
  room_rent_normal_pct   smallint check (room_rent_normal_pct between 1 and 10),
  room_rent_icu_pct      smallint check (room_rent_icu_pct between 1 and 10),
  cover_type             text not null default 'ESC' check (cover_type in ('ESC', 'ESCP')),
  sum_insured            numeric(12,2) check (sum_insured > 0),
  sum_insured_type       text not null default 'fixed' check (sum_insured_type in ('fixed', 'grade')),
  wellness               boolean not null default true,
  e_consultation         boolean not null default true,
  health_checkup         boolean not null default true,
  pre_existing_covered   boolean not null default true,
  waiting_period_waived  boolean not null default true,
  exclusions_waived      boolean not null default true,
  pre_post_hospitalisation boolean not null default true,
  ambulance_per_incident numeric(12,2) check (ambulance_per_incident >= 0),
  claim_process          text check (char_length(claim_process) <= 2000),
  hidden_fields          text[] not null default '{}' check (cardinality(hidden_fields) <= 30),
  updated_at             timestamptz not null default now(),
  check (valid_to is null or valid_from is null or valid_to > valid_from)
);
create trigger insurance_policies_touch before update on public.insurance_policies for each row execute function app.touch_updated_at();
create trigger insurance_policies_audit after insert or update on public.insurance_policies for each row execute function app.audit_row();

-- ─── Coverage and endorsements ──────────────────────────────────────────────

create table public.insurance_coverage (
  organization_id  uuid not null,
  employee_id      uuid not null,
  covered          boolean not null default true,
  sum_insured      numeric(12,2) check (sum_insured > 0),
  covered_from     date,
  updated_at       timestamptz not null default now(),
  primary key (employee_id),
  foreign key (organization_id, employee_id) references public.employees (organization_id, id) on delete cascade
);
create index insurance_coverage_org_idx on public.insurance_coverage (organization_id);
create trigger insurance_coverage_touch before update on public.insurance_coverage for each row execute function app.touch_updated_at();
create trigger insurance_coverage_audit after insert or update or delete on public.insurance_coverage for each row execute function app.audit_row();

create table public.insurance_syncs (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  synced_at        timestamptz not null default now(),
  synced_by        uuid default auth.uid(),
  roster           jsonb not null,
  additions        int not null,
  deletions        int not null
);
create index insurance_syncs_org_idx on public.insurance_syncs (organization_id, synced_at desc);

alter table public.insurance_policies enable row level security;
alter table public.insurance_coverage enable row level security;
alter table public.insurance_syncs enable row level security;
-- The policy is shown to members (hidden fields are removed by my_insurance; the page reads through it).
create policy insurance_policies_select on public.insurance_policies for select to authenticated
  using (app.has_permission(organization_id, 'insurance.manage'));
create policy insurance_policies_write on public.insurance_policies for all to authenticated
  using (app.has_permission(organization_id, 'insurance.manage')) with check (app.has_permission(organization_id, 'insurance.manage'));
create policy insurance_coverage_select on public.insurance_coverage for select to authenticated
  using (app.has_permission(organization_id, 'insurance.manage') or app.is_own_employee(employee_id));
create policy insurance_coverage_write on public.insurance_coverage for all to authenticated
  using (app.has_permission(organization_id, 'insurance.manage')) with check (app.has_permission(organization_id, 'insurance.manage'));
create policy insurance_syncs_select on public.insurance_syncs for select to authenticated
  using (app.has_permission(organization_id, 'insurance.manage'));
grant select, insert, update on public.insurance_policies to authenticated;
grant select, insert, update, delete on public.insurance_coverage to authenticated;
grant select on public.insurance_syncs to authenticated;
grant all on public.insurance_policies, public.insurance_coverage, public.insurance_syncs to service_role;

-- The insured roster now: covered current employees and the dependants their cover type includes.
-- key is stable per person (the employee or family member id), so endorsements compare rosters by key.
create function app.insurance_roster(p_org uuid)
returns table (key text, employee_id uuid, employee_code text, employee_name text, member_name text, relationship text,
               date_of_birth date, gender text, sum_insured numeric, effective date)
language sql stable security definer set search_path = '' as $$
  with pol as (select coalesce((select cover_type from public.insurance_policies where organization_id = p_org), 'ESC') as cover_type,
                      (select sum_insured from public.insurance_policies where organization_id = p_org) as sum_insured),
  cov as (
    select e.id, e.employee_code, trim(concat_ws(' ', e.first_name, e.last_name)) as name, e.date_of_joining,
           c.sum_insured, c.covered_from
      from public.insurance_coverage c join public.employees e on e.id = c.employee_id
     where c.organization_id = p_org and c.covered and e.status in ('active', 'on_notice'))
  select cov.id::text, cov.id, cov.employee_code, cov.name, cov.name, 'self', p.date_of_birth, p.gender::text,
         coalesce(cov.sum_insured, pol.sum_insured), coalesce(cov.covered_from, cov.date_of_joining)
    from cov cross join pol left join public.employee_personal p on p.employee_id = cov.id
  union all
  select f.id::text, cov.id, cov.employee_code, cov.name, f.name,
         case when f.relationship in ('father', 'mother', 'father_in_law', 'mother_in_law') then 'parent' else f.relationship end,
         f.date_of_birth, f.gender::text, coalesce(cov.sum_insured, pol.sum_insured), greatest(coalesce(cov.covered_from, cov.date_of_joining), f.created_at::date)
    from cov cross join pol join public.employee_family_members f on f.employee_id = cov.id
   where f.relationship in ('spouse', 'child')
      or (pol.cover_type = 'ESCP' and f.relationship in ('father', 'mother', 'father_in_law', 'mother_in_law'))
  order by 3, 6 desc, 5;
$$;
revoke all on function app.insurance_roster(uuid) from public;

-- For insurance managers: the roster and what changed since the last locked endorsement.
create function public.insurance_endorsement(p_org uuid)
returns table (change text, key text, employee_id uuid, employee_code text, employee_name text, member_name text, relationship text,
               date_of_birth date, gender text, sum_insured numeric, effective date)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_last jsonb;
begin
  if not app.has_permission(p_org, 'insurance.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select roster into v_last from public.insurance_syncs where organization_id = p_org order by synced_at desc limit 1;
  return query
    select case when v_last is null or not (v_last ? r.key) then 'addition' else 'covered' end, r.*
      from app.insurance_roster(p_org) r
    union all
    select 'deletion', x.key, (x.value ->> 'employee_id')::uuid, x.value ->> 'employee_code', x.value ->> 'employee_name',
           x.value ->> 'member_name', x.value ->> 'relationship', null::date, null::text, null::numeric, null::date
      from jsonb_each(coalesce(v_last, '{}'::jsonb)) x
     where not exists (select 1 from app.insurance_roster(p_org) r where r.key = x.key);
end $$;

-- Lock the endorsement: snapshot the roster as sent to the insurer.
create function public.lock_insurance_endorsement(p_org uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_roster jsonb;
  v_add    int;
  v_del    int;
begin
  if not app.has_permission(p_org, 'insurance.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select count(*) filter (where change = 'addition'), count(*) filter (where change = 'deletion') into v_add, v_del
    from public.insurance_endorsement(p_org);
  if v_add + v_del = 0 then
    raise exception 'Nothing has changed since the last endorsement.' using errcode = '22023';
  end if;
  select coalesce(jsonb_object_agg(r.key, jsonb_build_object('employee_id', r.employee_id, 'employee_code', r.employee_code,
           'employee_name', r.employee_name, 'member_name', r.member_name, 'relationship', r.relationship)), '{}'::jsonb)
    into v_roster from app.insurance_roster(p_org) r;
  insert into public.insurance_syncs (organization_id, roster, additions, deletions) values (p_org, v_roster, v_add, v_del);
  return jsonb_build_object('additions', v_add, 'deletions', v_del);
end $$;

-- The signed-in employee's cover: the policy fields shown to employees, and their insured members.
create function public.my_insurance(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_emp    uuid;
  v_policy jsonb;
begin
  select id into v_emp from public.employees where organization_id = p_org and user_id = auth.uid() and app.is_member(p_org);
  if v_emp is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.insurance_coverage where employee_id = v_emp and covered) then
    return jsonb_build_object('covered', false);
  end if;
  select to_jsonb(p) - 'organization_id' - 'hidden_fields' - 'updated_at' - coalesce(p.hidden_fields, '{}') into v_policy
    from public.insurance_policies p where p.organization_id = p_org;
  return jsonb_build_object('covered', true, 'policy', v_policy,
    'members', coalesce((select jsonb_agg(jsonb_build_object('name', r.member_name, 'relationship', r.relationship, 'dateOfBirth', r.date_of_birth,
                                                             'sumInsured', r.sum_insured, 'effective', r.effective))
                           from app.insurance_roster(p_org) r where r.employee_id = v_emp), '[]'::jsonb));
end $$;

revoke all on function public.insurance_endorsement(uuid) from public, anon;
revoke all on function public.lock_insurance_endorsement(uuid) from public, anon;
revoke all on function public.my_insurance(uuid) from public, anon;
grant execute on function public.insurance_endorsement(uuid) to authenticated, service_role;
grant execute on function public.lock_insurance_endorsement(uuid) to authenticated, service_role;
grant execute on function public.my_insurance(uuid) to authenticated, service_role;
