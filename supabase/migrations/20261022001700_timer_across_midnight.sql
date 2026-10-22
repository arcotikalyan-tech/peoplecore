-- PeopleCore · A timesheet timer that runs past midnight keeps all its time: the part before midnight is logged on
-- the day it started and the rest on the next day (time entries belong to one day each). Before, the timer was cut
-- at 23:59 and the minutes after midnight were lost. A next-day part the timesheet rules refuse (a locked or
-- restricted day) is left out rather than failing the stop; a timer left running longer than that is cut at the end
-- of the next day.

create or replace function public.ts_stop_timer(p_org uuid, p_ip text default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  t        public.ts_timers;
  v_tz     text;
  v_from   timestamp;
  v_now    timestamp;
  v_cut    timestamp;
  v_first  jsonb;
  v_second jsonb;
begin
  select * into t from public.ts_timers where organization_id = p_org and employee_id = app.ts_me(p_org) for update;
  if t.employee_id is null then raise exception 'No timer is running.' using errcode = 'P0002'; end if;
  select timezone into v_tz from public.organizations where id = p_org;
  v_from := t.started_at at time zone v_tz;
  v_now := now() at time zone v_tz;
  v_cut := date_trunc('day', v_from) + interval '23 hours 59 minutes';
  delete from public.ts_timers where employee_id = t.employee_id;

  if least(v_now, v_cut) - v_from >= interval '1 minute' then
    v_first := public.ts_log_time(t.project_id, t.task_id, v_from::date, v_from::time(0), least(v_now, v_cut)::time(0), null, t.description,
                                  t.billable, null, p_ip, 'timer');
  end if;
  -- Past midnight: the rest on the next day, up to now (or that day's end).
  if v_now > v_cut + interval '1 minute' then
    begin
      v_second := public.ts_log_time(t.project_id, t.task_id, v_from::date + 1, time '00:00',
                                     least(v_now, v_cut + interval '1 day')::time(0), null, t.description, t.billable, null, p_ip, 'timer');
    exception when sqlstate '22023' or sqlstate '42501' then v_second := null;
    end;
  end if;
  if v_first is null and v_second is null then return jsonb_build_object('id', null, 'minutes', 0); end if;
  return jsonb_build_object('id', coalesce(v_second ->> 'id', v_first ->> 'id'),
                            'minutes', coalesce((v_first ->> 'minutes')::int, 0) + coalesce((v_second ->> 'minutes')::int, 0));
end $$;
