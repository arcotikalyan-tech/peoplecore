-- PeopleCore · Recruitment hardening: an application stays attached to its requisition and candidate.
--
-- Migration 20261018000800 lets recruitment.manage holders update applications directly (for notes), and
-- guarded stage changes. Nothing stopped such an update from re-pointing an application at another
-- requisition or candidate, which would rewrite the pipeline's history. Now it is refused.

create or replace function app.guard_application_stage() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.organization_id, new.requisition_id, new.candidate_id)
     is distinct from (old.organization_id, old.requisition_id, old.candidate_id) then
    raise exception 'An application can’t be moved to another requisition or candidate.' using errcode = '22023';
  end if;
  if new.stage is distinct from old.stage and coalesce(current_setting('app.stage_change', true), '') <> 'on' then
    raise exception 'Change the stage with move_application or hire_application.' using errcode = '22023';
  end if;
  if old.stage = 'hired' and (new.stage is distinct from old.stage or new.converted_employee_id is distinct from old.converted_employee_id) then
    raise exception 'A hire can’t be undone here.' using errcode = '22023';
  end if;
  return new;
end $$;
