-- PeopleCore · Profile photos and the company logo.
--
-- * employees.photo_path: a photo in the private profile-images bucket (<org>/<employee>/<file>). The person sets their
--   own (unless the organization blocks editing one's own record: the employees_block_self_edit trigger), and anyone
--   who may update that employee sets theirs. Colleagues who can see the employee see the photo (the server signs
--   short-lived links for rows the viewer can read). Changes are audited with the employee row.
-- * company_profiles.logo_path: the logo (<org>/logo/<file>), set by org.manage; every member sees it in the app.
-- Both functions return the previous path so the server can remove the old file.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-images', 'profile-images', false, 2097152, array['image/jpeg', 'image/png'])
on conflict (id) do nothing;

alter table public.employees add column photo_path text
  check (photo_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}$' and split_part(photo_path, '/', 1) = organization_id::text and split_part(photo_path, '/', 2) = id::text);
alter table public.company_profiles add column logo_path text
  check (logo_path ~ '^[0-9a-f-]{36}/logo/[0-9a-f-]{36}$' and split_part(logo_path, '/', 1) = organization_id::text);

create function public.set_employee_photo(p_employee uuid, p_path text) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_e   public.employees;
  v_old text;
begin
  select * into v_e from public.employees where id = p_employee for update;
  if v_e.id is null
     or not ((v_e.user_id = auth.uid() and app.is_member(v_e.organization_id))
             or app.can_access_employee(v_e.organization_id, v_e.id, 'employee.update')) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  v_old := v_e.photo_path;
  update public.employees set photo_path = p_path where id = p_employee;
  return v_old;
end $$;

create function public.set_company_logo(p_org uuid, p_path text) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_old text;
begin
  if not app.has_permission(p_org, 'org.manage') then raise exception 'not authorized' using errcode = '42501'; end if;
  insert into public.company_profiles (organization_id) values (p_org) on conflict (organization_id) do nothing;
  select logo_path into v_old from public.company_profiles where organization_id = p_org for update;
  update public.company_profiles set logo_path = p_path where organization_id = p_org;
  return v_old;
end $$;

revoke all on function public.set_employee_photo(uuid, text), public.set_company_logo(uuid, text) from public, anon;
grant execute on function public.set_employee_photo(uuid, text), public.set_company_logo(uuid, text) to authenticated, service_role;

-- Photos for the people on a page of the directory (at most 200): members see colleagues' photos.
create function public.employee_photos(p_org uuid, p_ids uuid[]) returns table (employee_id uuid, photo_path text)
language sql stable security definer set search_path = '' as $$
  select e.id, e.photo_path from public.employees e
   where e.organization_id = p_org and e.id = any (p_ids[1:200]) and e.photo_path is not null and app.is_member(p_org);
$$;
revoke all on function public.employee_photos(uuid, uuid[]) from public, anon;
grant execute on function public.employee_photos(uuid, uuid[]) to authenticated, service_role;
