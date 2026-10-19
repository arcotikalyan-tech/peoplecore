-- PeopleCore · PMS settings (Kredily's Performance): evaluation period, rating scale labels, the weight of goals vs
-- skills in the overall rating, goal weightage, self-appraisal and peer feedback switches; a KRA library and a
-- skills library; skill ratings on each review (self, then manager).
--
-- * KRAs are templates: HR assigns one to people as a goal (with its default weight) from the KRA library.
-- * Goal weightage: when switched on, an employee's goals in a cycle must add up to 100% before their self review.
-- * Skill ratings: the employee rates each active skill with the self review; the manager with the manager review.
--   They are read through review_skills(), which hides the manager's ratings from the employee until the cycle's
--   results are shared (as review_view does for the overall rating).

create table public.pms_settings (
  organization_id     uuid primary key references public.organizations (id) on delete cascade,
  evaluation_period   text not null default 'annual' check (evaluation_period in ('quarterly', 'half_yearly', 'annual')),
  rating_labels       text[] not null default '{Below expectations,Partly meets,Meets expectations,Exceeds expectations,Exceptional}'
                      check (cardinality(rating_labels) = 5),
  goals_weight        smallint not null default 70 check (goals_weight between 0 and 100),
  goal_weightage      boolean not null default true,
  self_appraisal      boolean not null default true,
  peer_feedback       boolean not null default true,
  updated_at          timestamptz not null default now()
);
create trigger pms_settings_touch before update on public.pms_settings for each row execute function app.touch_updated_at();
create trigger pms_settings_audit after insert or update on public.pms_settings for each row execute function app.audit_row();
insert into public.pms_settings (organization_id) select id from public.organizations on conflict do nothing;
create function app.pms_settings_default() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.pms_settings (organization_id) values (new.id) on conflict do nothing;
  return new;
end $$;
revoke all on function app.pms_settings_default() from public;
create trigger organizations_zz_pms_settings after insert on public.organizations for each row execute function app.pms_settings_default();

create table public.pms_kras (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  title            text not null check (char_length(title) between 3 and 200),
  description      text check (char_length(description) <= 1000),
  department_id    uuid,
  weight           smallint not null default 0 check (weight between 0 and 100),
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, department_id) references public.departments (organization_id, id) on delete set null (department_id)
);
create table public.pms_skills (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  name             text not null check (char_length(name) between 2 and 80),
  category         text not null default 'Core' check (char_length(category) between 2 and 40),
  description      text check (char_length(description) <= 500),
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  unique (organization_id, id)
);
create unique index pms_skills_name_idx on public.pms_skills (organization_id, lower(name));
create trigger pms_kras_audit after insert or update or delete on public.pms_kras for each row execute function app.audit_row();
create trigger pms_skills_audit after insert or update or delete on public.pms_skills for each row execute function app.audit_row();

create table public.review_skill_ratings (
  organization_id  uuid not null,
  review_id        uuid not null,
  skill_id         uuid not null,
  self_rating      smallint check (self_rating between 1 and 5),
  manager_rating   smallint check (manager_rating between 1 and 5),
  primary key (review_id, skill_id),
  foreign key (organization_id, review_id) references public.reviews (organization_id, id) on delete cascade,
  foreign key (organization_id, skill_id) references public.pms_skills (organization_id, id) on delete cascade
);
create trigger review_skill_ratings_audit after insert or update on public.review_skill_ratings
  for each row execute function app.audit_row('self_rating', 'manager_rating');

alter table public.pms_settings enable row level security;
alter table public.pms_kras enable row level security;
alter table public.pms_skills enable row level security;
alter table public.review_skill_ratings enable row level security;
create policy pms_settings_select on public.pms_settings for select to authenticated using (app.is_member(organization_id));
create policy pms_settings_write on public.pms_settings for update to authenticated
  using (app.has_permission(organization_id, 'performance.manage')) with check (app.has_permission(organization_id, 'performance.manage'));
create policy pms_kras_select on public.pms_kras for select to authenticated using (app.is_member(organization_id));
create policy pms_kras_write on public.pms_kras for all to authenticated
  using (app.has_permission(organization_id, 'performance.manage')) with check (app.has_permission(organization_id, 'performance.manage'));
create policy pms_skills_select on public.pms_skills for select to authenticated using (app.is_member(organization_id));
create policy pms_skills_write on public.pms_skills for all to authenticated
  using (app.has_permission(organization_id, 'performance.manage')) with check (app.has_permission(organization_id, 'performance.manage'));
-- Skill ratings are read through review_skills(); HR may also read the table directly (reports).
create policy review_skill_ratings_select on public.review_skill_ratings for select to authenticated
  using (app.has_permission(organization_id, 'performance.manage'));
grant select, update on public.pms_settings to authenticated;
grant select, insert, update, delete on public.pms_kras, public.pms_skills to authenticated;
grant select on public.review_skill_ratings to authenticated;
grant all on public.pms_settings, public.pms_kras, public.pms_skills, public.review_skill_ratings to service_role;

-- Goal weightage: goals in the cycle must add up to 100% before the self review is submitted.
create function app.reviews_goal_weightage() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_sum int;
begin
  if new.status = 'self_submitted' and old.status = 'not_started'
     and coalesce((select goal_weightage from public.pms_settings where organization_id = new.organization_id), false) then
    select sum(weight) into v_sum from public.goals where employee_id = new.employee_id and cycle_id = new.cycle_id and status <> 'dropped';
    if v_sum is not null and v_sum <> 100 then
      raise exception '%', format('Your goal weights for this cycle add up to %s%%; make them 100%% before submitting.', v_sum) using errcode = '22023';
    end if;
  end if;
  return new;
end $$;
revoke all on function app.reviews_goal_weightage() from public;
create trigger reviews_goal_weightage before update of status on public.reviews for each row execute function app.reviews_goal_weightage();

-- Rate skills on a review: the employee with their self review (while it is open), the manager (or HR) with theirs.
create function public.rate_review_skills(p_review uuid, p_as text, p_ratings jsonb) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_r   public.reviews;
  v_c   public.review_cycles;
  v_ok  boolean;
  r     record;
  v_n   int := 0;
begin
  select * into v_r from public.reviews where id = p_review;
  select * into v_c from public.review_cycles where id = v_r.cycle_id;
  if v_r.id is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  v_ok := case p_as
    when 'self' then app.is_own_employee(v_r.employee_id)
    when 'manager' then not app.is_own_employee(v_r.employee_id)
                        and (app.is_own_employee(v_r.manager_employee_id) or app.has_permission(v_r.organization_id, 'performance.manage'))
    else false end;
  if not v_ok then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_c.status <> 'active' or (p_as = 'self' and v_r.status <> 'not_started') or (p_as = 'manager' and v_r.status <> 'self_submitted') then
    raise exception 'These ratings can’t be changed now.' using errcode = '22023';
  end if;
  for r in select (e.key)::uuid as skill, (e.value)::text::smallint as rating from jsonb_each(coalesce(p_ratings, '{}'::jsonb)) e loop
    if r.rating not between 1 and 5 then
      raise exception 'Rate each skill from 1 to 5.' using errcode = '22023';
    end if;
    if not exists (select 1 from public.pms_skills where id = r.skill and organization_id = v_r.organization_id and is_active) then
      raise exception 'Unknown skill.' using errcode = '22023';
    end if;
    insert into public.review_skill_ratings (organization_id, review_id, skill_id, self_rating, manager_rating)
    values (v_r.organization_id, p_review, r.skill, case when p_as = 'self' then r.rating end, case when p_as = 'manager' then r.rating end)
    on conflict (review_id, skill_id) do update
       set self_rating = case when p_as = 'self' then excluded.self_rating else public.review_skill_ratings.self_rating end,
           manager_rating = case when p_as = 'manager' then excluded.manager_rating else public.review_skill_ratings.manager_rating end;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

create function public.review_skills(p_review uuid)
returns table (skill_id uuid, name text, category text, self_rating smallint, manager_rating smallint)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_r    public.reviews;
  v_c    public.review_cycles;
  v_self boolean;
begin
  select * into v_r from public.reviews where id = p_review;
  select * into v_c from public.review_cycles where id = v_r.cycle_id;
  v_self := app.is_own_employee(v_r.employee_id);
  if v_r.id is null or not (v_self or app.is_own_employee(v_r.manager_employee_id) or app.has_permission(v_r.organization_id, 'performance.manage')
                            or app.can_access_employee(v_r.organization_id, v_r.employee_id, 'performance.read')) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return query
    select s.id, s.name, s.category, x.self_rating, case when v_self and v_c.status <> 'shared' then null else x.manager_rating end
      from public.pms_skills s left join public.review_skill_ratings x on x.skill_id = s.id and x.review_id = p_review
     where s.organization_id = v_r.organization_id and (s.is_active or x.review_id is not null)
     order by s.category, s.name;
end $$;

revoke all on function public.rate_review_skills(uuid, text, jsonb) from public, anon;
revoke all on function public.review_skills(uuid) from public, anon;
grant execute on function public.rate_review_skills(uuid, text, jsonb) to authenticated, service_role;
grant execute on function public.review_skills(uuid) to authenticated, service_role;
