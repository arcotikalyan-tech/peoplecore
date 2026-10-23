-- PeopleCore · Downloading the audit log (Audit log › Download CSV) is itself recorded in the audit log before the file
-- is handed over: who took which period and how many entries. If this refuses, no file is sent. The rows come from
-- audit_events through RLS, so the file never holds more than the person can already see.

create function public.log_audit_export(p_org uuid, p_row_count integer, p_from date default null, p_to date default null) returns bigint
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id bigint;
begin
  if not app.has_permission(p_org, 'audit.read') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_row_count is null or p_row_count < 0 then
    raise exception 'Invalid row count.' using errcode = '22023';
  end if;
  insert into public.audit_events (organization_id, actor_user_id, action, entity_type, metadata)
  values (p_org, auth.uid(), 'export', 'audit_events',
          jsonb_build_object('format', 'csv', 'row_count', p_row_count, 'from', p_from, 'to', p_to))
  returning id into v_id;
  return v_id;
end $$;

revoke all on function public.log_audit_export(uuid, integer, date, date) from public, anon;
grant execute on function public.log_audit_export(uuid, integer, date, date) to authenticated, service_role;
