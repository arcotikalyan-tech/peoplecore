-- PeopleCore · Personal-data deletion requests (Kredily's Directory › People › Deletion requests).
--
-- An employee asks for optional personal data to be erased: contact details (personal email and phones), addresses,
-- family members, emergency contacts, custom fields. HR (employee.personal.update, org-wide) approves — the data is
-- erased at once — or rejects with a reason. Records the law requires keeping (identity numbers, bank details for
-- salary, payroll, tax and statutory filings, the employment record) are never part of a request.

create table public.data_deletion_requests (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  employee_id      uuid not null,
  scope            text[] not null check (cardinality(scope) > 0 and scope <@ '{contact,address,family,emergency,custom}'::text[]),
  reason           text check (char_length(reason) <= 1000),
  status           text not null default 'pending' check (status in ('pending', 'completed', 'rejected')),
  decision_note    text check (char_length(decision_note) <= 500),
  requested_by     uuid default auth.uid(),
  decided_by       uuid,
  decided_at       timestamptz,
  created_at       timestamptz not null default now(),
  foreign key (organization_id, employee_id) references public.employees (organization_id, id) on delete cascade
);
create unique index data_deletion_requests_open_uq on public.data_deletion_requests (employee_id) where status = 'pending';
create trigger data_deletion_requests_audit after insert or update on public.data_deletion_requests for each row execute function app.audit_row();

alter table public.data_deletion_requests enable row level security;
create policy data_deletion_requests_select on public.data_deletion_requests for select to authenticated
  using (app.is_own_employee(employee_id) or app.has_permission(organization_id, 'employee.personal.update'));
grant select on public.data_deletion_requests to authenticated;
grant all on public.data_deletion_requests to service_role;

create function public.request_data_deletion(p_org uuid, p_scope text[], p_reason text default null) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_emp uuid;
  v_id  uuid;
begin
  select id into v_emp from public.employees where organization_id = p_org and user_id = auth.uid();
  if v_emp is null then raise exception 'You need an employee record to ask for this.' using errcode = '42501'; end if;
  if p_scope is null or cardinality(p_scope) = 0 or not (p_scope <@ '{contact,address,family,emergency,custom}'::text[]) then
    raise exception 'Choose what to erase.' using errcode = '22023';
  end if;
  if exists (select 1 from public.data_deletion_requests where employee_id = v_emp and status = 'pending') then
    raise exception 'You already have a request waiting for HR.' using errcode = '23505';
  end if;
  insert into public.data_deletion_requests (organization_id, employee_id, scope, reason)
  values (p_org, v_emp, (select array_agg(distinct s order by s) from unnest(p_scope) s), left(nullif(trim(p_reason), ''), 1000))
  returning id into v_id;
  perform app.notify_permission_holders(p_org, 'employee.personal.update', 'privacy.deletion_request', 'Personal-data deletion request to review', '/employees?tab=deletion', auth.uid());
  return v_id;
end $$;

create function public.decide_data_deletion(p_request uuid, p_approve boolean, p_note text default null) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  r      public.data_deletion_requests;
  v_user uuid;
begin
  select * into r from public.data_deletion_requests where id = p_request for update;
  if r.id is null or not app.has_permission(r.organization_id, 'employee.personal.update') then raise exception 'Request not found.' using errcode = 'P0002'; end if;
  if r.status <> 'pending' then raise exception 'This request has already been decided.' using errcode = '22023'; end if;
  if app.is_own_employee(r.employee_id) then raise exception 'Someone else in HR must decide your own request.' using errcode = '42501'; end if;
  if not p_approve and char_length(trim(coalesce(p_note, ''))) < 3 then raise exception 'Give the employee a reason.' using errcode = '22023'; end if;
  if p_approve then
    if 'contact' = any (r.scope) then
      update public.employee_personal set personal_email = null, personal_phone = null, alternate_phone = null where employee_id = r.employee_id;
    end if;
    if 'address' = any (r.scope) then
      update public.employee_personal set address_line1 = null, address_line2 = null, city = null, state_code = null, postal_code = null,
             perm_same_as_current = false, perm_address_line1 = null, perm_address_line2 = null, perm_city = null, perm_state_code = null, perm_postal_code = null
       where employee_id = r.employee_id;
    end if;
    if 'family' = any (r.scope) then delete from public.employee_family_members where employee_id = r.employee_id; end if;
    if 'emergency' = any (r.scope) then delete from public.emergency_contacts where employee_id = r.employee_id; end if;
    if 'custom' = any (r.scope) then delete from public.employee_custom_values where employee_id = r.employee_id; end if;
  end if;
  update public.data_deletion_requests set status = case when p_approve then 'completed' else 'rejected' end,
         decision_note = left(nullif(trim(p_note), ''), 500), decided_by = auth.uid(), decided_at = now()
   where id = r.id;
  select user_id into v_user from public.employees where id = r.employee_id;
  perform app.notify(r.organization_id, v_user, 'privacy.deletion_request',
    case when p_approve then 'Your personal data was erased as requested' else 'Your data-deletion request was declined' end, nullif(trim(p_note), ''), '/preferences');
end $$;

revoke all on function public.request_data_deletion(uuid, text[], text), public.decide_data_deletion(uuid, boolean, text) from public;
grant execute on function public.request_data_deletion(uuid, text[], text), public.decide_data_deletion(uuid, boolean, text) to authenticated;
