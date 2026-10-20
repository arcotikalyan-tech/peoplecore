-- PeopleCore · Mileage claims (Kredily's "Log mileage", auto-calculated per km).
--
-- * expense_settings gains the mileage rate (₹ per km) and an on/off switch.
-- * expense_items records the distance and the rate used, so the amount can always be explained.
-- * log_mileage adds a trip to the employee's draft mileage claim for that month (creating the claim and the
--   organization's MILEAGE category — no receipt needed — if missing) at the current rate.

alter table public.expense_settings
  add column mileage_enabled boolean not null default true,
  add column mileage_rate numeric(8,2) not null default 12 check (mileage_rate > 0 and mileage_rate <= 1000);
alter table public.expense_items
  add column distance_km numeric(8,1) check (distance_km > 0 and distance_km <= 5000),
  add column rate_per_km numeric(8,2) check (rate_per_km > 0);

create function public.log_mileage(p_org uuid, p_date date, p_km numeric, p_from text, p_to text, p_purpose text default null) returns uuid
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
revoke all on function public.log_mileage(uuid, date, numeric, text, text, text) from public;
grant execute on function public.log_mileage(uuid, date, numeric, text, text, text) to authenticated;
