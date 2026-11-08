-- PeopleCore · Suspended members can't log mileage, answer a held claim or ask for data deletion (audit SEC-08).
--
-- These three checked only that the caller had an employee record, so someone whose membership was suspended could still
-- use them. Each now requires current membership (app.is_member, which also applies the organization's two-step rule).
-- Otherwise the same as their earlier definitions (20261020000700, 20261019001200, 20261020000800).

create or replace function public.log_mileage(p_org uuid, p_date date, p_km numeric, p_from text, p_to text, p_purpose text default null) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_emp    uuid;
  v_on     boolean;
  v_rate   numeric;
  v_cat    uuid;
  v_claim  uuid;
  v_title  text := 'Mileage · ' || to_char(p_date, 'Mon YYYY');
  v_item   uuid := gen_random_uuid();
begin
  if not app.is_member(p_org) then raise exception 'not authorized' using errcode = '42501'; end if;
  select id into v_emp from public.employees where organization_id = p_org and user_id = auth.uid() and status in ('active', 'on_notice');
  if v_emp is null then raise exception 'You need an employee record to claim mileage.' using errcode = '42501'; end if;
  select coalesce(s.mileage_enabled, true), coalesce(s.mileage_rate, 12) into v_on, v_rate
    from (select 1) one left join public.expense_settings s on s.organization_id = p_org;
  if not v_on then raise exception 'Mileage claims are switched off.' using errcode = '22023'; end if;
  if p_km is null or p_km <= 0 or p_km > 5000 then raise exception 'Enter the distance in km (up to 5,000).' using errcode = '22023'; end if;
  if p_date is null or p_date > app.org_today(p_org) then raise exception 'Choose the date of the trip (not in the future).' using errcode = '22023'; end if;
  if char_length(trim(coalesce(p_from, ''))) < 2 or char_length(trim(coalesce(p_to, ''))) < 2 then raise exception 'Enter where you went from and to.' using errcode = '22023'; end if;

  select id into v_cat from public.expense_categories where organization_id = p_org and code = 'MILEAGE';
  if v_cat is null then
    insert into public.expense_categories (organization_id, code, name, requires_receipt) values (p_org, 'MILEAGE', 'Mileage', false) returning id into v_cat;
  end if;
  select id into v_claim from public.expense_claims where employee_id = v_emp and status = 'draft' and title = v_title order by created_at desc limit 1;
  if v_claim is null then v_claim := public.create_expense_claim(p_org, v_title); end if;
  perform public.add_expense_item(p_claim => v_claim, p_id => v_item, p_category => v_cat, p_date => p_date, p_amount => round(p_km * v_rate, 2),
    p_merchant => left(trim(p_from) || ' → ' || trim(p_to), 120), p_description => left(nullif(trim(p_purpose), ''), 500));
  update public.expense_items set distance_km = round(p_km, 1), rate_per_km = v_rate where id = v_item;
  return v_claim;
end $$;

create or replace function public.reply_expense_claim(p_claim uuid, p_reply text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_c public.expense_claims;
  v_user uuid;
begin
  select * into v_c from public.expense_claims where id = p_claim and status = 'pending' and held_at is not null for update;
  if v_c.id is null or not app.is_member(v_c.organization_id)
     or not exists (select 1 from public.employees e where e.id = v_c.employee_id and e.user_id = auth.uid()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if nullif(btrim(p_reply), '') is null then raise exception 'Write your answer.' using errcode = '22023'; end if;
  update public.expense_claims set held_at = null, hold_reply = left(btrim(p_reply), 500) where id = p_claim;
  for v_user in select app.current_approvers(v_c.approval_request_id) loop
    perform app.notify(v_c.organization_id, v_user, 'expense.replied', 'Information added: ' || left(v_c.title, 150), null, '/expenses/' || p_claim);
  end loop;
end $$;

create or replace function public.request_data_deletion(p_org uuid, p_scope text[], p_reason text default null) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_emp uuid;
  v_id  uuid;
begin
  if not app.is_member(p_org) then raise exception 'not authorized' using errcode = '42501'; end if;
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

revoke all on function public.log_mileage(uuid, date, numeric, text, text, text) from public, anon;
grant execute on function public.log_mileage(uuid, date, numeric, text, text, text) to authenticated;
revoke all on function public.reply_expense_claim(uuid, text) from public, anon;
grant execute on function public.reply_expense_claim(uuid, text) to authenticated, service_role;
revoke all on function public.request_data_deletion(uuid, text[], text) from public, anon;
grant execute on function public.request_data_deletion(uuid, text[], text) to authenticated;
