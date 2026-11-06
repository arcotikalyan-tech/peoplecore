-- Attendance and leave stop changing once payroll has been decided (audit ATT-04). A correction, a work-from-home or
-- on-duty day or a leave approved after a run was approved or locked used to change the day while pay stayed as it was,
-- with nothing to show the difference. Now anyone trying it is told why, and HR puts it right with a pay adjustment in
-- the next run. It's only for people that run paid: someone it didn't include can still correct those days.
--
-- A person's action only (auth.uid() set): the worker and data imports aren't asking anyone anything, and a refusal
-- there would fail a whole job. Punches themselves aren't refused: one sent late is still a fact worth keeping, and
-- arrives flagged (record_punch).

-- The month of the newest approved or locked run paying this person whose attendance and leave inputs cover any of these
-- days, or null. The inputs run from day N of the previous month to day N-1 of this one (N = 1: the month itself), as in
-- payroll_run_inputs.
create function app.payroll_closed_month(p_employee uuid, p_from date, p_to date) returns date
language sql stable security definer set search_path = '' as $$
  select r.period_month
    from public.payroll_run_employees pe
    join public.payroll_runs r on r.id = pe.run_id
    left join public.payroll_settings s on s.organization_id = r.organization_id
   where pe.employee_id = p_employee and r.status in ('approved', 'locked')
     and p_to >= case when coalesce(s.input_cycle_start_day, 1) = 1 then r.period_month
                      else (r.period_month - interval '1 month')::date + s.input_cycle_start_day - 1 end
     and p_from <= case when coalesce(s.input_cycle_start_day, 1) = 1 then (r.period_month + interval '1 month - 1 day')::date
                        else r.period_month + s.input_cycle_start_day - 2 end
   order by r.period_month desc
   limit 1;
$$;

create function app.refuse_if_payroll_closed(p_employee uuid, p_from date, p_to date) returns void
language plpgsql stable security definer set search_path = '' as $$
declare
  v_month date;
begin
  if auth.uid() is null then return; end if;
  v_month := app.payroll_closed_month(p_employee, p_from, p_to);
  if v_month is not null then
    raise exception 'Payroll for % is already approved, so these days can''t change. HR can make a pay adjustment in the next run.',
      to_char(v_month, 'FMMonth YYYY') using errcode = '22023';
  end if;
end $$;

create function app.guard_regularization_payroll() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or (new.status = 'approved' and old.status is distinct from 'approved') then
    perform app.refuse_if_payroll_closed(new.employee_id, new.work_date, new.work_date);
  end if;
  return new;
end $$;
create trigger regularization_requests_payroll_closed before insert or update of status on public.regularization_requests
  for each row execute function app.guard_regularization_payroll();

create function app.guard_attendance_request_payroll() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or (new.status = 'approved' and old.status is distinct from 'approved') then
    perform app.refuse_if_payroll_closed(new.employee_id, new.start_date, new.end_date);
  end if;
  return new;
end $$;
create trigger attendance_requests_payroll_closed before insert or update of status on public.attendance_requests
  for each row execute function app.guard_attendance_request_payroll();

-- Leave also counts when an approved request is cancelled: the days it paid for would change. A pending one never paid.
create function app.guard_leave_request_payroll() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or (new.status = 'approved' and old.status is distinct from 'approved')
     or (old.status = 'approved' and new.status is distinct from 'approved') then
    perform app.refuse_if_payroll_closed(new.employee_id, new.start_date, new.end_date);
  end if;
  return new;
end $$;
create trigger leave_requests_payroll_closed before insert or update of status on public.leave_requests
  for each row execute function app.guard_leave_request_payroll();

revoke all on function app.payroll_closed_month(uuid, date, date) from public;
revoke all on function app.refuse_if_payroll_closed(uuid, date, date) from public;
revoke all on function app.guard_regularization_payroll() from public;
revoke all on function app.guard_attendance_request_payroll() from public;
revoke all on function app.guard_leave_request_payroll() from public;
