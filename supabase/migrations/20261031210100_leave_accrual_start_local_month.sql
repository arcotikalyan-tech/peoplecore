-- leave_settings.accrual_start defaulted to the first of the current month in UTC. For an organization in India set up
-- between midnight and 5:30 on the 1st, that was the previous month, so its first accrual run credited two months.
-- New rows now start at the first of the organization's own month; an accrual_start given explicitly is kept.

alter table public.leave_settings alter column accrual_start drop default;

create function app.leave_settings_accrual_start() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.accrual_start := coalesce(new.accrual_start, date_trunc('month', app.org_today(new.organization_id))::date);
  return new;
end $$;
revoke all on function app.leave_settings_accrual_start() from public;
create trigger leave_settings_accrual_start before insert on public.leave_settings
  for each row execute function app.leave_settings_accrual_start();
