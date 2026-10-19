-- PeopleCore · Upcoming birthdays on the dashboard (as Kredily shows them).
--
-- Dates of birth stay in employee_personal behind sensitive-data RLS. This function gives any member of the
-- organization only the name and the day and month of colleagues' birthdays in the next p_days days, never the
-- year (so no ages), for current employees.

create function public.upcoming_birthdays(p_org uuid, p_days integer default 30)
returns table (employee_id uuid, name text, next_birthday date)
language sql stable security definer set search_path = '' as $$
  with t as (select app.org_today(p_org) as today),
  b as (
    select e.id, trim(concat_ws(' ', e.first_name, e.last_name)) as name,
           -- This year's (or next year's) occurrence; 29 February falls on 28 February in other years.
           (select min(d) from (values
              (make_date(extract(year from t.today)::int, extract(month from p.date_of_birth)::int,
                         least(extract(day from p.date_of_birth)::int, extract(day from (make_date(extract(year from t.today)::int, extract(month from p.date_of_birth)::int, 1) + interval '1 month - 1 day'))::int))),
              (make_date(extract(year from t.today)::int + 1, extract(month from p.date_of_birth)::int,
                         least(extract(day from p.date_of_birth)::int, extract(day from (make_date(extract(year from t.today)::int + 1, extract(month from p.date_of_birth)::int, 1) + interval '1 month - 1 day'))::int)))
            ) v(d) where d >= t.today) as next_birthday
      from public.employees e
      join public.employee_personal p on p.employee_id = e.id
      cross join t
     where e.organization_id = p_org and e.status in ('active', 'on_notice') and p.date_of_birth is not null
       and app.is_member(p_org))
  select b.id, b.name, b.next_birthday from b, t
   where b.next_birthday <= t.today + least(greatest(p_days, 0), 366)
   order by b.next_birthday, b.name
   limit 50;
$$;

revoke all on function public.upcoming_birthdays(uuid, integer) from public, anon;
grant execute on function public.upcoming_birthdays(uuid, integer) to authenticated, service_role;
