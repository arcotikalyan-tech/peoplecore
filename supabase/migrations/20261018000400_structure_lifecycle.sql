-- PeopleCore · Org structure lifecycle: edit, archive and restore.
--
-- RLS already lets org.manage holders update structure rows. These triggers add the business rules:
--   * an item still used by current employees (not exited) cannot be archived;
--   * a department with active sub-departments cannot be archived;
--   * a department cannot sit under an archived department or under one of its own sub-departments;
--   * employees cannot be placed in an archived item.
-- Messages use errcode 22023 and are written for users (the app shows them as-is).
-- Locking: the employee check reads the item `for share`, which conflicts with the archiving UPDATE, so a
-- concurrent archive and assignment cannot both succeed.

-- ─── Archiving guard (all structure tables) ─────────────────────────────────

create function app.guard_structure_archive() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_label   text := case tg_table_name
                      when 'departments' then 'department'
                      when 'designations' then 'designation'
                      when 'locations' then 'location'
                      when 'legal_entities' then 'legal entity'
                      else 'cost centre' end;
  v_column  text := case tg_table_name
                      when 'departments' then 'department_id'
                      when 'designations' then 'designation_id'
                      when 'locations' then 'location_id'
                      when 'legal_entities' then 'legal_entity_id'
                      else 'cost_centre_id' end;
  v_count   bigint;
begin
  if new.archived_at is not null and old.archived_at is null then
    execute format(
      'select count(*) from public.employees where organization_id = $1 and %I = $2 and status <> ''exited''', v_column)
      into v_count using new.organization_id, new.id;
    if v_count > 0 then
      raise exception 'This % is still used by % current employee%. Move them first, then archive it.',
        v_label, v_count, case when v_count = 1 then '' else 's' end
        using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

create trigger departments_archive_guard before update of archived_at on public.departments
  for each row execute function app.guard_structure_archive();
create trigger designations_archive_guard before update of archived_at on public.designations
  for each row execute function app.guard_structure_archive();
create trigger locations_archive_guard before update of archived_at on public.locations
  for each row execute function app.guard_structure_archive();
create trigger legal_entities_archive_guard before update of archived_at on public.legal_entities
  for each row execute function app.guard_structure_archive();
create trigger cost_centres_archive_guard before update of archived_at on public.cost_centres
  for each row execute function app.guard_structure_archive();

-- ─── Department tree rules ──────────────────────────────────────────────────

create function app.guard_department_tree() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_parent_archived timestamptz;
  v_cursor uuid;
  v_depth  int := 0;
begin
  -- Archiving: no active children.
  if tg_op = 'UPDATE' and new.archived_at is not null and old.archived_at is null then
    if exists (select 1 from public.departments c
                where c.organization_id = new.organization_id and c.parent_id = new.id and c.archived_at is null) then
      raise exception 'This department has active sub-departments. Move or archive them first.' using errcode = '22023';
    end if;
  end if;

  -- An active department needs an active parent (checked on create, re-parent and restore).
  if new.archived_at is null and new.parent_id is not null
     and (tg_op = 'INSERT' or new.parent_id is distinct from old.parent_id or old.archived_at is not null) then
    select d.archived_at into v_parent_archived
      from public.departments d
     where d.organization_id = new.organization_id and d.id = new.parent_id
       for share;
    if v_parent_archived is not null then
      raise exception 'The parent department is archived. Choose another parent or restore it first.' using errcode = '22023';
    end if;
  end if;

  -- No cycles: walk up from the new parent; reaching this department means it would sit under itself.
  if tg_op = 'UPDATE' and new.parent_id is not null and new.parent_id is distinct from old.parent_id then
    v_cursor := new.parent_id;
    while v_cursor is not null and v_depth < 100 loop
      if v_cursor = new.id then
        raise exception 'A department can’t sit under one of its own sub-departments.' using errcode = '22023';
      end if;
      select d.parent_id into v_cursor
        from public.departments d where d.organization_id = new.organization_id and d.id = v_cursor;
      v_depth := v_depth + 1;
    end loop;
  end if;
  return new;
end;
$$;

create trigger departments_tree_guard before insert or update of parent_id, archived_at on public.departments
  for each row execute function app.guard_department_tree();

-- ─── Employees cannot be placed in archived items ───────────────────────────

create function app.guard_employee_structure() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_archived boolean;
begin
  if new.department_id is not null and (tg_op = 'INSERT' or new.department_id is distinct from old.department_id) then
    select archived_at is not null into v_archived from public.departments
     where organization_id = new.organization_id and id = new.department_id for share;
    if v_archived then raise exception 'The selected department is archived.' using errcode = '22023'; end if;
  end if;
  if new.designation_id is not null and (tg_op = 'INSERT' or new.designation_id is distinct from old.designation_id) then
    select archived_at is not null into v_archived from public.designations
     where organization_id = new.organization_id and id = new.designation_id for share;
    if v_archived then raise exception 'The selected designation is archived.' using errcode = '22023'; end if;
  end if;
  if new.location_id is not null and (tg_op = 'INSERT' or new.location_id is distinct from old.location_id) then
    select archived_at is not null into v_archived from public.locations
     where organization_id = new.organization_id and id = new.location_id for share;
    if v_archived then raise exception 'The selected location is archived.' using errcode = '22023'; end if;
  end if;
  if new.legal_entity_id is not null and (tg_op = 'INSERT' or new.legal_entity_id is distinct from old.legal_entity_id) then
    select archived_at is not null into v_archived from public.legal_entities
     where organization_id = new.organization_id and id = new.legal_entity_id for share;
    if v_archived then raise exception 'The selected legal entity is archived.' using errcode = '22023'; end if;
  end if;
  if new.cost_centre_id is not null and (tg_op = 'INSERT' or new.cost_centre_id is distinct from old.cost_centre_id) then
    select archived_at is not null into v_archived from public.cost_centres
     where organization_id = new.organization_id and id = new.cost_centre_id for share;
    if v_archived then raise exception 'The selected cost centre is archived.' using errcode = '22023'; end if;
  end if;
  return new;
end;
$$;

create trigger employees_structure_guard
  before insert or update of department_id, designation_id, location_id, legal_entity_id, cost_centre_id on public.employees
  for each row execute function app.guard_employee_structure();

-- ─── Usage counts for the structure page ────────────────────────────────────
-- Security invoker: employees RLS applies, so callers only count the people they may already see.

create function public.structure_usage(p_org uuid)
returns table (kind text, item_id uuid, current_employees bigint)
language sql stable security invoker set search_path = '' as $$
  select k.kind, k.item_id, count(*)
    from public.employees e
   cross join lateral (values
     ('department', e.department_id),
     ('designation', e.designation_id),
     ('location', e.location_id)
   ) as k (kind, item_id)
   where e.organization_id = p_org and e.status <> 'exited' and k.item_id is not null
   group by k.kind, k.item_id;
$$;

-- ─── Grants ─────────────────────────────────────────────────────────────────

revoke all on function app.guard_structure_archive() from public;
revoke all on function app.guard_department_tree() from public;
revoke all on function app.guard_employee_structure() from public;
revoke all on function public.structure_usage(uuid) from public;
grant execute on function public.structure_usage(uuid) to authenticated, service_role;
