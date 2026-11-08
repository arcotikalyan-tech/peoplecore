-- PeopleCore · Leave requests are checked one at a time per person (audit LV-01).
--
-- apply_leave read the balance (and the month's total), checked it, then inserted: two requests sent at the same moment
-- each saw the same balance and both went through, overdrawing it. A transaction lock per employee, taken before
-- anything is read, makes the second wait for the first and then see it. Same function as 20261019000300 otherwise.

create or replace function public.apply_leave(
  p_employee   uuid,
  p_type       uuid,
  p_start      date,
  p_end        date,
  p_half_start boolean default false,
  p_half_end   boolean default false,
  p_reason     text default null
) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_emp       public.employees;
  v_type      public.leave_types;
  v_pol       public.leave_policies;
  v_days      numeric;
  v_available numeric;
  v_id        uuid;
  v_approval  uuid;
  v_hr        boolean;
  v_today     date;
  v_month     date;
  v_part      numeric;
  v_taken     numeric;
  v_limit     date;
begin
  select * into v_emp from public.employees where id = p_employee;
  if v_emp.id is null or not app.is_member(v_emp.organization_id)
     or not (v_emp.user_id = auth.uid() or app.has_permission(v_emp.organization_id, 'leave.manage')) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  -- One request at a time for each person: two sent together each read the same balance and both passed (audit LV-01).
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('apply_leave'), pg_catalog.hashtext(p_employee::text));
  -- HR applying for someone else isn't held to the timing and size limits (corrections, backdated entries).
  v_hr := v_emp.user_id is distinct from auth.uid();
  v_today := app.org_today(v_emp.organization_id);
  if v_emp.status = 'exited' then
    raise exception 'Leave can’t be requested for someone who has left.' using errcode = '22023';
  end if;
  select * into v_type from public.leave_types where id = p_type and organization_id = v_emp.organization_id;
  if v_type.id is null or not v_type.is_active then
    raise exception 'Choose a leave type.' using errcode = '22023';
  end if;
  if p_end < p_start then
    raise exception 'The leave can’t end before it starts.' using errcode = '22023';
  end if;
  if p_end - p_start > 366 then
    raise exception 'A single request can cover at most a year.' using errcode = '22023';
  end if;
  if (p_half_start or p_half_end) and not v_type.allow_half_day then
    raise exception '% can’t be taken in half days.', v_type.name using errcode = '22023';
  end if;
  if p_start = p_end and p_half_start and p_half_end then
    raise exception 'Choose either the first or the second half of the day.' using errcode = '22023';
  end if;
  if not app.leave_type_applies(p_employee, p_type, greatest(p_start, v_today)) and not app.leave_type_applies(p_employee, p_type, v_today) then
    raise exception '% isn’t one of the leave rules assigned to %.', v_type.name, trim(concat_ws(' ', v_emp.first_name, v_emp.last_name)) using errcode = '22023';
  end if;

  v_pol := app.leave_policy_on(p_type, p_start);
  if v_pol.id is not null then
    if not v_pol.accrue_during_probation and v_emp.probation_end_date is not null and v_emp.probation_end_date >= p_start then
      raise exception '% can’t be taken during probation (until %).', v_type.name, to_char(v_emp.probation_end_date, 'DD Mon YYYY') using errcode = '22023';
    end if;
    if not v_pol.allowed_on_notice and v_emp.status = 'on_notice' then
      raise exception '% can’t be taken during the notice period.', v_type.name using errcode = '22023';
    end if;
    if not v_hr then
      if p_start > v_today and not v_pol.allow_future then
        raise exception '% can’t be requested for future dates.', v_type.name using errcode = '22023';
      end if;
      if p_start > v_today and p_start - v_today < v_pol.future_notice_days then
        raise exception 'Request % at least % day(s) ahead.', v_type.name, v_pol.future_notice_days using errcode = '22023';
      end if;
      if p_start < v_today and not v_pol.allow_backdated then
        raise exception '% can’t be requested for past dates.', v_type.name using errcode = '22023';
      end if;
      if p_start < v_today and v_pol.backdated_max_days is not null and v_today - p_start > v_pol.backdated_max_days then
        raise exception '% can be requested at most % day(s) back.', v_type.name, v_pol.backdated_max_days using errcode = '22023';
      end if;
      if v_pol.next_year_until is not null then
        v_limit := (app.leave_cycle_start(v_emp.organization_id, v_today) + interval '1 year'
                    + make_interval(months => ((v_pol.next_year_until - extract(month from app.leave_cycle_start(v_emp.organization_id, v_today))::int + 12) % 12) + 1))::date - 1;
        if p_end > v_limit then
          raise exception 'Next year’s % can be requested up to % only.', v_type.name, to_char(v_limit, 'DD Mon YYYY') using errcode = '22023';
        end if;
      end if;
    end if;
  end if;

  v_days := app.leave_days(p_employee, p_type, p_start, p_end, coalesce(p_half_start, false), coalesce(p_half_end, false));
  if v_days <= 0 then
    raise exception 'Those dates are all weekly offs or holidays.' using errcode = '22023';
  end if;
  if v_pol.id is not null and not v_hr then
    if v_pol.max_continuous is not null and v_days > v_pol.max_continuous then
      raise exception 'At most % day(s) of % in one request.', trim_scale(v_pol.max_continuous), v_type.name using errcode = '22023';
    end if;
    if v_pol.max_per_month is not null then
      for v_month in select generate_series(date_trunc('month', p_start), date_trunc('month', p_end), interval '1 month')::date loop
        v_part := app.leave_days(p_employee, p_type, greatest(p_start, v_month), least(p_end, (v_month + interval '1 month')::date - 1),
                                 p_half_start and p_start >= v_month, p_half_end and p_end < (v_month + interval '1 month')::date);
        select coalesce(sum(app.leave_days(p_employee, p_type, greatest(r.start_date, v_month), least(r.end_date, (v_month + interval '1 month')::date - 1),
                                           r.half_day_start and r.start_date >= v_month, r.half_day_end and r.end_date < (v_month + interval '1 month')::date)), 0)
          into v_taken
          from public.leave_requests r
         where r.employee_id = p_employee and r.leave_type_id = p_type and r.status in ('pending', 'approved')
           and r.start_date < (v_month + interval '1 month')::date and r.end_date >= v_month;
        if v_part + v_taken > v_pol.max_per_month then
          raise exception 'At most % day(s) of % a month; % already has %.', trim_scale(v_pol.max_per_month), v_type.name,
            to_char(v_month, 'FMMonth'), trim_scale(v_taken) using errcode = '22023';
        end if;
      end loop;
    end if;
  end if;
  if not v_type.allow_negative then
    select coalesce(sum(days), 0) into v_available from public.leave_ledger where employee_id = p_employee and leave_type_id = p_type;
    v_available := v_available - coalesce((select sum(days) from public.leave_requests
                                            where employee_id = p_employee and leave_type_id = p_type and status = 'pending'), 0);
    if v_days > v_available then
      raise exception 'Only % day(s) of % available; this request needs %.', trim_scale(v_available), v_type.name, trim_scale(v_days)
        using errcode = '22023';
    end if;
  end if;

  begin
    insert into public.leave_requests (organization_id, employee_id, leave_type_id, start_date, end_date, half_day_start, half_day_end, days, reason)
    values (v_emp.organization_id, p_employee, p_type, p_start, p_end, coalesce(p_half_start, false), coalesce(p_half_end, false),
            v_days, nullif(btrim(p_reason), ''))
    returning id into v_id;
  exception when exclusion_violation then
    raise exception 'This overlaps another leave request.' using errcode = '22023';
  end;

  v_approval := app.request_approval(v_emp.organization_id, 'leave_request', v_id, p_employee,
    format('%s: %s, %s%s (%s day%s)', trim(concat_ws(' ', v_emp.first_name, v_emp.last_name)), v_type.name,
           to_char(p_start, 'DD Mon YYYY'), case when p_end <> p_start then ' – ' || to_char(p_end, 'DD Mon YYYY') else '' end,
           trim_scale(v_days), case when v_days = 1 then '' else 's' end),
    '/leave');
  update public.leave_requests set approval_request_id = v_approval where id = v_id;
  return v_id;
end $$;

revoke all on function public.apply_leave(uuid, uuid, date, date, boolean, boolean, text) from public, anon;
grant execute on function public.apply_leave(uuid, uuid, date, date, boolean, boolean, text) to authenticated, service_role;
