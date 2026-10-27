-- PeopleCore · With self-appraisal switched off, managers can still review.
--
-- The manager review opened only after the employee's self review, so an organization that turned self-appraisal off
-- in Performance settings had reviews nobody could complete. Without self-appraisal it opens straight away.

create function app.manager_review_open(p_review public.reviews) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_review.status = 'self_submitted'
      or (p_review.status = 'not_started'
          and not coalesce((select s.self_appraisal from public.pms_settings s where s.organization_id = p_review.organization_id), true));
$$;
revoke all on function app.manager_review_open(public.reviews) from public;

create or replace function public.submit_manager_review(p_review uuid, p_rating smallint, p_comments text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_r public.reviews;
  v_c public.review_cycles;
begin
  select * into v_r from public.reviews where id = p_review for update;
  select * into v_c from public.review_cycles where id = v_r.cycle_id;
  if v_r.id is null or app.is_own_employee(v_r.employee_id)
     or not (exists (select 1 from public.employees m where m.id = v_r.manager_employee_id and m.user_id = auth.uid())
             or app.has_permission(v_r.organization_id, 'performance.manage')) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_c.status <> 'active' or not app.manager_review_open(v_r) then
    raise exception 'The manager review opens after the self review, while the cycle is active.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_comments, ''))) < 10 then
    raise exception 'Explain the rating in a few sentences.' using errcode = '22023';
  end if;
  update public.reviews set manager_rating = p_rating, manager_comments = btrim(p_comments), manager_submitted_at = now(),
         status = 'manager_submitted', final_rating = p_rating where id = p_review;
  update public.tasks set status = 'done', completed_at = now(), completed_by = auth.uid()
   where subject_type = 'review' and subject_id = p_review and status = 'open';
end $$;

create or replace function public.review_view(p_review uuid)
returns table (review_id uuid, cycle_name text, cycle_status public.cycle_status, employee_id uuid, status public.review_status,
               self_rating smallint, self_comments text, manager_rating smallint, manager_comments text, final_rating smallint,
               calibration_note text, is_self boolean, can_manager_review boolean, can_calibrate boolean)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_r     public.reviews;
  v_c     public.review_cycles;
  v_self  boolean;
  v_line  boolean;
  v_hr    boolean;
begin
  select * into v_r from public.reviews where id = p_review;
  select * into v_c from public.review_cycles where id = v_r.cycle_id;
  v_self := app.is_own_employee(v_r.employee_id);
  v_hr := app.has_permission(v_r.organization_id, 'performance.manage');
  v_line := not v_self and (app.can_access_employee(v_r.organization_id, v_r.employee_id, 'performance.read')
                            or app.is_own_employee(v_r.manager_employee_id));
  if v_r.id is null or not (v_self or v_line or v_hr) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return query select v_r.id, v_c.name, v_c.status, v_r.employee_id, v_r.status, v_r.self_rating, v_r.self_comments,
    case when v_self and v_c.status <> 'shared' then null else v_r.manager_rating end,
    case when v_self and v_c.status <> 'shared' then null else v_r.manager_comments end,
    case when v_self and v_c.status <> 'shared' then null else v_r.final_rating end,
    case when v_self then null else v_r.calibration_note end,
    v_self,
    (not v_self) and v_c.status = 'active' and app.manager_review_open(v_r)
      and (exists (select 1 from public.employees m where m.id = v_r.manager_employee_id and m.user_id = auth.uid()) or v_hr),
    (not v_self) and v_hr and v_c.status in ('active', 'calibration') and v_r.status in ('manager_submitted', 'calibrated');
end $$;
