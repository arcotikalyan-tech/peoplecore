-- The Office network rule on phones (audit SEC-04). The rule refuses a website punch from outside the office's addresses;
-- a phone punch skipped it silently, so anyone could avoid the rule by punching from the app. Phones often have no office
-- network to be on (mobile data, people in the field), so a phone punch isn't refused: it's flagged for review with the
-- other evidence, where HR can see it, and the punch's address is on record.

create function app.flag_phone_off_office_network() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_ips   text[];
  v_tz    text;
  v_shift public.shifts;
begin
  if new.method <> 'mobile' then return new; end if;
  select allowed_ips into v_ips from public.attendance_settings where organization_id = new.organization_id;
  if cardinality(coalesce(v_ips, '{}')) = 0 or (new.ip is not null and new.ip = any (v_ips)) then return new; end if;
  select timezone into v_tz from public.organizations where id = new.organization_id;
  v_shift := app.shift_for(new.employee_id, (new.punched_at at time zone v_tz)::date);
  if coalesce(v_shift.verify_ip, false) then
    insert into public.anomaly_flags (organization_id, employee_id, subject_type, subject_id, rule, explanation)
    values (new.organization_id, new.employee_id, 'punch', new.id, 'off_office_network',
            'Phone punch from outside the office network, under a rule that asks for it.');
  end if;
  return new;
end $$;
revoke all on function app.flag_phone_off_office_network() from public;
create trigger attendance_punches_off_office_network after insert on public.attendance_punches
  for each row execute function app.flag_phone_off_office_network();
