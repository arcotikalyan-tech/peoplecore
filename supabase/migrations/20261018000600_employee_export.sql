-- PeopleCore · Core HR: audited employee export.
--
-- The export itself reads employees through RLS (so it never contains more than the caller can already
-- see). Before the file is handed over, the server records the export here; if this refuses, no file is
-- sent. Exports contain work/directory fields only: personal, identity and bank details are never exported.

create function public.log_employee_export(p_org uuid, p_filters jsonb, p_row_count integer) returns bigint
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id bigint;
begin
  if not app.has_permission(p_org, 'employee.export') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_row_count < 0 then
    raise exception 'Invalid row count.' using errcode = '22023';
  end if;
  insert into public.audit_events (organization_id, actor_user_id, action, entity_type, metadata)
  values (p_org, auth.uid(), 'export', 'employees',
          jsonb_build_object('format', 'csv', 'row_count', p_row_count, 'filters', coalesce(p_filters, '{}'::jsonb)))
  returning id into v_id;
  return v_id;
end $$;

revoke all on function public.log_employee_export(uuid, jsonb, integer) from public, anon;
grant execute on function public.log_employee_export(uuid, jsonb, integer) to authenticated, service_role;
