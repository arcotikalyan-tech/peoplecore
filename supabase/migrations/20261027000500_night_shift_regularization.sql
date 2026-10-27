-- PeopleCore · A night shift can be regularized, and lands on the right day.
--
-- A request needed check-out after check-in, so 22:00 to 06:00 couldn't be asked for at all, and approving a
-- check-out alone put it on the work date itself (06:00 that morning, inside the previous day's window). Now a
-- check-out at or before the check-in is allowed when that day's shift runs past midnight, and on approval a check-out
-- at or before the check-in (or, with no check-in, before the start of such a shift) is the next morning.

alter table public.regularization_requests drop constraint regularization_requests_check1;

create function app.check_regularization_times() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_shift public.shifts;
begin
  if new.check_in is not null and new.check_out is not null and new.check_out <= new.check_in then
    v_shift := app.shift_for(new.employee_id, new.work_date);
    if not coalesce(v_shift.end_time <= v_shift.start_time, false) then
      raise exception 'Check-out must be after check-in (only a shift that runs past midnight ends the next morning).' using errcode = '22023';
    end if;
  end if;
  return new;
end $$;
revoke all on function app.check_regularization_times() from public;
create trigger regularization_requests_times before insert or update of check_in, check_out on public.regularization_requests
  for each row execute function app.check_regularization_times();

create or replace function app.on_regularization_decided(p_request uuid, p_outcome text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_req   public.regularization_requests;
  v_tz    text;
  v_shift public.shifts;
  v_next  boolean;
begin
  select * into v_req from public.regularization_requests where id = p_request for update;
  if v_req.id is null or v_req.status <> 'pending' then return; end if;
  update public.regularization_requests
     set status = case p_outcome when 'approved' then 'approved' when 'rejected' then 'rejected' else 'cancelled' end::public.leave_status,
         decided_at = now()
   where id = p_request;
  if p_outcome = 'approved' then
    select timezone into v_tz from public.organizations where id = v_req.organization_id;
    -- A check-out at or before the check-in (or, with no check-in, before the start of a shift that runs past midnight)
    -- is the next morning.
    v_shift := app.shift_for(v_req.employee_id, v_req.work_date);
    v_next := v_req.check_out is not null and (
                (v_req.check_in is not null and v_req.check_out <= v_req.check_in)
                or (v_req.check_in is null and v_shift.end_time <= v_shift.start_time and v_req.check_out < v_shift.start_time));
    if v_req.check_in is not null then
      insert into public.attendance_punches (organization_id, employee_id, punched_at, method, source_key)
      values (v_req.organization_id, v_req.employee_id, (v_req.work_date + v_req.check_in)::timestamp at time zone v_tz,
              'regularization', 'reg:' || v_req.id || ':in')
      on conflict (organization_id, source_key) do nothing;
    end if;
    if v_req.check_out is not null then
      insert into public.attendance_punches (organization_id, employee_id, punched_at, method, source_key)
      values (v_req.organization_id, v_req.employee_id, (v_req.work_date + case when v_next then 1 else 0 end + v_req.check_out)::timestamp at time zone v_tz,
              'regularization', 'reg:' || v_req.id || ':out')
      on conflict (organization_id, source_key) do nothing;
    end if;
    update public.anomaly_flags set status = 'resolved', reviewed_at = now(), reviewed_by = auth.uid()
     where employee_id = v_req.employee_id and rule = 'missing_punch' and status = 'open'
       and subject_id in (select p.id from public.attendance_punches p where p.employee_id = v_req.employee_id
                           and (p.punched_at at time zone v_tz)::date between v_req.work_date and v_req.work_date + 1);
    perform app.compute_attendance_day(v_req.employee_id, v_req.work_date);
  end if;
end $$;
