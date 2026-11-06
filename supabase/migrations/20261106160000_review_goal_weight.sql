-- The goals weight in Performance settings now does what it says (audit PMS-01): "Goals weight in the overall rating; skills
-- make up the rest" was saved and never used. When the manager submits a review, the final rating is their rating at
-- that weight plus the average of the skills they rated, on the same 1 to 5 scale. No skills rated, and it's their
-- rating as before. HR can still change it at calibration, with a reason.

create function app.reviews_weighted_final() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_weight smallint;
  v_skills numeric;
begin
  if new.status = 'manager_submitted' and old.status is distinct from 'manager_submitted' and new.manager_rating is not null then
    select goals_weight into v_weight from public.pms_settings where organization_id = new.organization_id;
    select avg(manager_rating) into v_skills from public.review_skill_ratings where review_id = new.id and manager_rating is not null;
    if v_skills is not null then
      new.final_rating := greatest(1, least(5, round((coalesce(v_weight, 100) * new.manager_rating + (100 - coalesce(v_weight, 100)) * v_skills) / 100.0)))::smallint;
    end if;
  end if;
  return new;
end $$;
revoke all on function app.reviews_weighted_final() from public;
create trigger reviews_weighted_final before update of status on public.reviews
  for each row execute function app.reviews_weighted_final();

-- Keeping the rating that came out needs no reason, even when it isn't the manager's own number.
create or replace function public.calibrate_review(p_review uuid, p_final_rating smallint, p_note text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_r public.reviews;
  v_c public.review_cycles;
begin
  select * into v_r from public.reviews where id = p_review for update;
  select * into v_c from public.review_cycles where id = v_r.cycle_id;
  if v_r.id is null or not app.has_permission(v_r.organization_id, 'performance.manage') or app.is_own_employee(v_r.employee_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_c.status not in ('active', 'calibration') or v_r.status not in ('manager_submitted', 'calibrated') then
    raise exception 'Calibrate after the manager review, before results are shared.' using errcode = '22023';
  end if;
  if p_final_rating is distinct from v_r.final_rating and char_length(btrim(coalesce(p_note, ''))) < 5 then
    raise exception 'Say why the final rating differs from the manager’s.' using errcode = '22023';
  end if;
  update public.reviews set final_rating = p_final_rating, calibration_note = nullif(btrim(p_note), ''), calibrated_by = auth.uid(), status = 'calibrated' where id = p_review;
end $$;
revoke all on function public.calibrate_review(uuid, smallint, text) from public, anon;
grant execute on function public.calibrate_review(uuid, smallint, text) to authenticated, service_role;
