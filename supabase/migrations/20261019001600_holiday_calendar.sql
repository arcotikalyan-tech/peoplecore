-- PeopleCore · Holiday calendar (Kredily's Holiday: calendar, holiday list, calendar rules).
--
-- Holiday calendars already exist per location (with the organization's default) and hold the weekly offs.
-- This adds what the Holiday module needs on top:
-- * a description per holiday, and per calendar how many optional (restricted) holidays each person may take;
-- * optional holiday choices: an employee picks optional holidays from their own calendar, within the yearly
--   limit and before the day; they can drop a choice until the day. HR (leave.manage) sees everyone's choices.

alter table public.holiday_calendars add column optional_limit smallint not null default 2 check (optional_limit between 0 and 20);
alter table public.holidays add column description text check (char_length(description) <= 200);

create table public.optional_holiday_choices (
  organization_id  uuid not null,
  employee_id      uuid not null,
  holiday_id       uuid not null references public.holidays (id) on delete cascade,
  created_at       timestamptz not null default now(),
  primary key (employee_id, holiday_id),
  foreign key (organization_id, employee_id) references public.employees (organization_id, id) on delete cascade
);
create index optional_holiday_choices_org_idx on public.optional_holiday_choices (organization_id);
create trigger optional_holiday_choices_audit after insert or delete on public.optional_holiday_choices for each row execute function app.audit_row();

alter table public.optional_holiday_choices enable row level security;
create policy optional_holiday_choices_select on public.optional_holiday_choices for select to authenticated
  using (app.has_permission(organization_id, 'leave.manage') or app.is_own_employee(employee_id));
grant select on public.optional_holiday_choices to authenticated;
grant all on public.optional_holiday_choices to service_role;

create function public.choose_optional_holiday(p_holiday uuid, p_choose boolean) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_h     public.holidays;
  v_emp   public.employees;
  v_limit smallint;
begin
  select * into v_h from public.holidays where id = p_holiday;
  select * into v_emp from public.employees where organization_id = v_h.organization_id and user_id = auth.uid() and status <> 'exited';
  if v_h.id is null or v_emp.id is null or not app.is_member(v_h.organization_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not v_h.is_optional then
    raise exception 'This holiday applies to everyone.' using errcode = '22023';
  end if;
  if v_h.calendar_id is distinct from app.employee_calendar(v_emp.id) then
    raise exception 'This holiday isn’t on your calendar.' using errcode = '22023';
  end if;
  if v_h.holiday_date <= app.org_today(v_h.organization_id) then
    raise exception 'Choose or drop an optional holiday before the day.' using errcode = '22023';
  end if;
  if not p_choose then
    delete from public.optional_holiday_choices where employee_id = v_emp.id and holiday_id = p_holiday;
    return;
  end if;
  select optional_limit into v_limit from public.holiday_calendars where id = v_h.calendar_id;
  if (select count(*) from public.optional_holiday_choices c join public.holidays h on h.id = c.holiday_id
       where c.employee_id = v_emp.id and extract(year from h.holiday_date) = extract(year from v_h.holiday_date) and c.holiday_id <> p_holiday) >= v_limit then
    raise exception 'You can take % optional holiday% a year.', v_limit, case when v_limit = 1 then '' else 's' end using errcode = '22023';
  end if;
  insert into public.optional_holiday_choices (organization_id, employee_id, holiday_id)
  values (v_h.organization_id, v_emp.id, p_holiday) on conflict do nothing;
end $$;

-- The caller's calendar (their location's, or the organization's default).
create function public.my_holiday_calendar(p_org uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select app.employee_calendar(e.id) from public.employees e where e.organization_id = p_org and e.user_id = auth.uid() and app.is_member(p_org);
$$;

revoke all on function public.choose_optional_holiday(uuid, boolean) from public, anon;
revoke all on function public.my_holiday_calendar(uuid) from public, anon;
grant execute on function public.choose_optional_holiday(uuid, boolean) to authenticated, service_role;
grant execute on function public.my_holiday_calendar(uuid) to authenticated, service_role;
