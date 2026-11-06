-- Two small changes behind the website and the phone app.
--
-- * The people directories search word by word, in any order: "dev nair" finds Dev Kumar Nair. It's what the website's
--   other people searches now do (searchPatterns, @peoplecore/shared), and strpos matches a typed % or _ literally.
-- * Whoever may read a punch may see its photo: the same rule as its row (attendance_punches_select), so a payroll
--   administrator, who reads attendance across the organization, no longer gets a broken picture next to the location.

create or replace function public.people_directory(p_org uuid, p_query text default null, p_limit integer default 500)
returns table (id uuid, name text, department text, designation text, location text, work_email text, work_phone text,
               tenure_years numeric, manager_id uuid, birthday text, marital_status text, linkedin_url text, twitter_url text, website_url text)
language sql stable security definer set search_path = '' as $$
  select e.id, concat_ws(' ', e.first_name, e.middle_name, e.last_name),
         case when s.show_department then d.name end,
         case when s.show_designation then g.title end,
         case when s.show_location then l.name end,
         case when s.show_email then e.work_email end,
         case when s.show_phone then e.work_phone end,
         round(greatest(0, app.org_today(p_org) - e.date_of_joining) / 365.25, 1),
         e.manager_employee_id,
         case when s.show_birthday and p.date_of_birth is not null then to_char(p.date_of_birth, 'FMDD Mon') end,
         case when s.show_marital_status then p.marital_status end,
         case when s.show_social then p.linkedin_url end,
         case when s.show_social then p.twitter_url end,
         case when s.show_social then p.website_url end
    from public.employees e
    join public.directory_settings s on s.organization_id = e.organization_id
    left join public.departments d on d.id = e.department_id
    left join public.designations g on g.id = e.designation_id
    left join public.locations l on l.id = e.location_id
    left join public.employee_personal p on p.employee_id = e.id
   where app.is_member(p_org) and e.organization_id = p_org and e.status in ('active', 'on_notice')
     and (app.directory_allowed(p_org) or e.user_id = auth.uid())
     and not exists (
       select 1 from regexp_split_to_table(lower(btrim(coalesce(p_query, ''))), '\s+') as word
        where word <> '' and strpos(lower(concat_ws(' ', e.first_name, e.middle_name, e.last_name, d.name, g.title)), word) = 0)
   order by e.first_name, e.last_name
   limit least(greatest(coalesce(p_limit, 500), 1), 2000);
$$;
revoke all on function public.people_directory(uuid, text, integer) from public, anon;
grant execute on function public.people_directory(uuid, text, integer) to authenticated, service_role;

create or replace function public.colleague_directory(p_org uuid, p_query text default null, p_limit int default 50)
returns table (id uuid, name text, department text, designation text)
language sql stable security definer set search_path = '' as $$
  select e.id, concat_ws(' ', e.first_name, e.middle_name, e.last_name), d.name, g.title
    from public.employees e
    left join public.departments d on d.id = e.department_id
    left join public.designations g on g.id = e.designation_id
   where app.is_member(p_org) and e.organization_id = p_org and e.status in ('active', 'on_notice')
     and not exists (
       select 1 from regexp_split_to_table(lower(btrim(coalesce(p_query, ''))), '\s+') as word
        where word <> '' and strpos(lower(concat_ws(' ', e.first_name, e.middle_name, e.last_name)), word) = 0)
   order by e.first_name, e.last_name
   limit least(greatest(coalesce(p_limit, 50), 1), 500);
$$;
revoke all on function public.colleague_directory(uuid, text, int) from public, anon;
grant execute on function public.colleague_directory(uuid, text, int) to authenticated, service_role;

create or replace function public.punch_selfie(p_punch uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  p public.attendance_punches;
begin
  select * into p from public.attendance_punches where id = p_punch;
  if p.id is null or not (app.is_own_employee(p.employee_id) or app.has_permission(p.organization_id, 'attendance.manage')
                          or app.is_in_reporting_line(p.organization_id, p.employee_id)
                          or app.can_access_employee(p.organization_id, p.employee_id, 'attendance.read')) then
    raise exception 'Not found.' using errcode = 'P0002';
  end if;
  return p.selfie_path;
end $$;
revoke all on function public.punch_selfie(uuid) from public;
grant execute on function public.punch_selfie(uuid) to authenticated;
