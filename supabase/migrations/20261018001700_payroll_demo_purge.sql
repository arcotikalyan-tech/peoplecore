-- PeopleCore · Purging payroll runs in DEMO organizations only.
--
-- Locked payroll runs are immutable (migration 20261018001600). The live end-to-end tests run payroll in the
-- synthetic demo tenant and must clean up afterwards; this function lets the service role remove a run there,
-- and nowhere else. Real tenants' payroll stays immutable: the guards refuse unless this function set the flag,
-- and the function refuses any organization that isn't marked is_demo.

create or replace function app.guard_payroll_results() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_status public.payroll_status;
begin
  if tg_op = 'DELETE' and (pg_trigger_depth() > 1 or current_setting('app.demo_purge', true) = 'on') then return old; end if;
  select status into v_status from public.payroll_runs where id = coalesce(old.run_id, new.run_id);
  if v_status in ('approved', 'locked') then
    raise exception 'This payroll run is % and its results can’t change.', v_status using errcode = '22023';
  end if;
  return coalesce(new, old);
end $$;

create or replace function app.guard_locked_run() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and (pg_trigger_depth() > 1 or current_setting('app.demo_purge', true) = 'on') then return old; end if;
  if old.status = 'locked' then
    raise exception 'A locked payroll run can’t be changed. Make corrections in the next run.' using errcode = '22023';
  end if;
  return coalesce(new, old);
end $$;

create function public.purge_demo_payroll_run(p_run uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.payroll_runs r join public.organizations o on o.id = r.organization_id
                  where r.id = p_run and o.is_demo) then
    raise exception 'Only payroll runs in demo organizations can be purged.' using errcode = '42501';
  end if;
  perform set_config('app.demo_purge', 'on', true);
  delete from public.payroll_runs where id = p_run;
  perform set_config('app.demo_purge', 'off', true);
end $$;

revoke all on function public.purge_demo_payroll_run(uuid) from public, anon, authenticated;
grant execute on function public.purge_demo_payroll_run(uuid) to service_role;
