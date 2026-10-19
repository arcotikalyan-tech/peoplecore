-- PeopleCore · Reports (Kredily parity): saved custom-report templates, report schedules (the worker reminds the
-- owner when a scheduled report is due; the report itself is generated on demand with the owner's own access), and
-- an audited record of every report export.
--
-- Templates and schedules hold only report settings, never data: every report reads through RLS as the person
-- generating it, so a shared template or a reminder cannot reveal anything its user could not already export.

create table public.report_templates (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  name             text not null check (char_length(name) between 2 and 80),
  config           jsonb not null check (jsonb_typeof(config) = 'object' and pg_column_size(config) < 8000),
  shared           boolean not null default false,
  created_by       uuid not null default auth.uid(),
  created_at       timestamptz not null default now(),
  unique (organization_id, created_by, name)
);
create trigger report_templates_audit after insert or update or delete on public.report_templates for each row execute function app.audit_row();

create table public.report_schedules (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  user_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  report_key       text not null check (report_key ~ '^[a-z0-9_]{2,40}$'),
  params           jsonb not null default '{}' check (jsonb_typeof(params) = 'object' and pg_column_size(params) < 2000),
  frequency        text not null check (frequency in ('weekly', 'monthly')),
  next_run_on      date not null,
  last_run_at      timestamptz,
  created_at       timestamptz not null default now()
);
create index report_schedules_due_idx on public.report_schedules (next_run_on);
create trigger report_schedules_audit after insert or update or delete on public.report_schedules for each row execute function app.audit_row();

alter table public.report_templates enable row level security;
alter table public.report_schedules enable row level security;

create policy report_templates_select on public.report_templates for select to authenticated
  using (app.is_member(organization_id) and (created_by = auth.uid() or shared));
create policy report_templates_insert on public.report_templates for insert to authenticated
  with check (app.is_member(organization_id) and created_by = auth.uid());
create policy report_templates_update on public.report_templates for update to authenticated
  using (created_by = auth.uid()) with check (app.is_member(organization_id) and created_by = auth.uid());
create policy report_templates_delete on public.report_templates for delete to authenticated using (created_by = auth.uid());

create policy report_schedules_own on public.report_schedules for all to authenticated
  using (user_id = auth.uid() and app.is_member(organization_id))
  with check (user_id = auth.uid() and app.is_member(organization_id));

grant select, insert, update, delete on public.report_templates, public.report_schedules to authenticated;
grant all on public.report_templates, public.report_schedules to service_role;

-- Every export is recorded (what, with which parameters, how many rows), attributed to the person who ran it.
create function public.log_report_export(p_org uuid, p_report text, p_params jsonb, p_rows integer) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not app.is_member(p_org) or p_report !~ '^[a-z0-9_]{2,40}$' or pg_column_size(p_params) > 2000 then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  insert into public.audit_events (organization_id, actor_user_id, action, entity_type, metadata)
  values (p_org, auth.uid(), 'export', 'report',
          jsonb_build_object('report', p_report, 'params', coalesce(p_params, '{}'::jsonb), 'row_count', greatest(coalesce(p_rows, 0), 0)));
end $$;
revoke all on function public.log_report_export(uuid, text, jsonb, integer) from public, anon;
grant execute on function public.log_report_export(uuid, text, jsonb, integer) to authenticated, service_role;

-- Worker: remind owners of schedules that are due (in each organization's time zone), then move each schedule on.
-- The reminder links to the report with its saved settings; nothing is generated in the background.
create function public.worker_report_schedules() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  s record;
  n integer := 0;
  v_title text;
  v_next date;
begin
  for s in select r.* from public.report_schedules r
            where r.next_run_on <= app.org_today(r.organization_id)
              and exists (select 1 from public.organization_members m
                           where m.organization_id = r.organization_id and m.user_id = r.user_id and m.status = 'active')
            for update skip locked loop
    v_title := coalesce(s.params ->> 'title', initcap(replace(s.report_key, '_', ' ')));
    perform app.notify(s.organization_id, s.user_id, 'report.scheduled', 'Scheduled report ready: ' || left(v_title, 150),
      'Open it to generate the file with the latest data.', '/reports?report=' || s.report_key || '&schedule=' || s.id);
    -- One reminder however far behind it was: the next run is the first period date after today.
    v_next := s.next_run_on;
    loop
      v_next := case s.frequency when 'weekly' then v_next + 7 else (v_next + interval '1 month')::date end;
      exit when v_next > app.org_today(s.organization_id);
    end loop;
    update public.report_schedules set last_run_at = now(), next_run_on = v_next where id = s.id;
    n := n + 1;
  end loop;
  -- Schedules whose owner left the organization stop.
  delete from public.report_schedules r
   where not exists (select 1 from public.organization_members m
                      where m.organization_id = r.organization_id and m.user_id = r.user_id and m.status = 'active');
  return jsonb_build_object('reminded', n);
end $$;
revoke all on function public.worker_report_schedules() from public, anon, authenticated;
grant execute on function public.worker_report_schedules() to service_role;
