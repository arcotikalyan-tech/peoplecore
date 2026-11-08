-- PeopleCore · Goals in a review cycle are locked once the self review is in (audit PMS-02).
--
-- Whoever may see someone's goals may maintain them, so during a review the employee or their manager could still change
-- the goals being rated. Once that person's review for the cycle is past "not started", their goals in the cycle can't be
-- added, edited or removed except by HR (performance.manage). Goals outside a cycle, and system jobs, are unaffected.

create function app.goals_locked_in_review() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_row public.goals := case when tg_op = 'DELETE' then old else new end;
begin
  if auth.uid() is null or app.has_permission(v_row.organization_id, 'performance.manage') then
    return v_row;
  end if;
  if exists (select 1 from public.reviews r
              where r.employee_id = v_row.employee_id and r.status <> 'not_started'
                and (r.cycle_id = v_row.cycle_id or (tg_op = 'UPDATE' and r.cycle_id = old.cycle_id))) then
    raise exception 'These goals are locked: the self review for this cycle has been submitted. Ask HR if a goal must change.'
      using errcode = '22023';
  end if;
  return v_row;
end $$;
create trigger goals_locked_in_review before insert or update or delete on public.goals
  for each row execute function app.goals_locked_in_review();

revoke all on function app.goals_locked_in_review() from public;
