-- PeopleCore · HR flags a check-in photo for review (after looking at it, with or without the AI photo check). The
-- flag joins the attendance anomalies under Attendance › Approvals; the punch counts as usual until someone acts.

create function public.flag_punch_photo(p_punch uuid, p_note text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  p public.attendance_punches;
begin
  select * into p from public.attendance_punches where id = p_punch;
  if p.id is null or not app.has_permission(p.organization_id, 'attendance.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p.selfie_path is null then
    raise exception 'This punch has no photo.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_note, ''))) not between 3 and 400 then
    raise exception 'Say in a few words what looks wrong.' using errcode = '22023';
  end if;
  insert into public.anomaly_flags (organization_id, employee_id, subject_type, subject_id, rule, explanation)
  values (p.organization_id, p.employee_id, 'punch', p.id, 'photo_check', 'Check-in photo: ' || btrim(p_note))
  on conflict (subject_type, subject_id, rule) do nothing;
end $$;
revoke all on function public.flag_punch_photo(uuid, text) from public, anon;
grant execute on function public.flag_punch_photo(uuid, text) to authenticated, service_role;
