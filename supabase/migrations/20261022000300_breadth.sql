-- PeopleCore · Kredily second pass, batch 4: breadth (docs/12-kredily-gap-list.md).
--
-- * ID Studio: visiting cards beside ID cards (each kind has its own default design), up to four custom lines on a
--   card, office address and website as fields, and rolling a design out: it becomes the default for its kind and
--   every employee with a sign-in is told their card is ready.
-- * Konnect: the company discussion board. Topics (seeded: General, Ideas, Help & questions, Events & clubs, Buy &
--   sell), threads with replies and likes; authors edit or remove their own posts; people who manage announcements
--   moderate (pin, lock, hide). Repliers' activity reaches the thread's author.
-- * Insurance: the cash-deposit (CD) account kept with the insurer, as a ledger of deposits, endorsement charges,
--   refunds and adjustments with a running balance and a low-balance level; an annual premium per life estimates
--   each endorsement's charge.
-- * Hiring: public_job_feed adds the job's city and state to what the careers page already shows, for the job-board
--   feeds (same public data, same reviewed public use).
-- * Learn: reminders in bulk for a course's pending learners (each person at most once a day).
-- * Compliance: statutory_facts also says whether TDS was deducted from vendor payments (Form 26Q, 16A).

-- ─── ID Studio ──────────────────────────────────────────────────────────────

alter table public.id_card_designs
  add column card_type     text not null default 'id' check (card_type in ('id', 'visiting')),
  add column custom_fields jsonb not null default '[]'::jsonb,
  add column rolled_out_at timestamptz;
alter table public.id_card_designs drop constraint id_card_designs_fields_check;
alter table public.id_card_designs
  add constraint id_card_designs_fields_check check (fields <@ '{designation,department,employee_code,date_of_joining,blood_group,phone,work_email,location,emergency_contact,office_address,website}'::text[]),
  add constraint id_card_designs_custom_fields_check check (jsonb_typeof(custom_fields) = 'array' and jsonb_array_length(custom_fields) <= 4);

-- Each line is a label and a value (text printed as given).
create function app.check_card_custom_fields() returns trigger
language plpgsql set search_path = '' as $$
declare
  f jsonb;
begin
  for f in select * from jsonb_array_elements(new.custom_fields) loop
    if jsonb_typeof(f) <> 'object' or char_length(coalesce(f ->> 'label', '')) not between 1 and 30
       or char_length(coalesce(f ->> 'value', '')) not between 1 and 60 then
      raise exception 'Each custom line needs a label (up to 30 characters) and a value (up to 60).' using errcode = '22023';
    end if;
  end loop;
  return new;
end $$;
revoke all on function app.check_card_custom_fields() from public;
create trigger id_card_designs_custom_fields before insert or update of custom_fields on public.id_card_designs
  for each row execute function app.check_card_custom_fields();

-- One default per kind of card.
drop index public.id_card_designs_default_idx;
create unique index id_card_designs_default_idx on public.id_card_designs (organization_id, card_type) where is_default;

create or replace function public.set_default_id_card(p_design uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v public.id_card_designs;
begin
  select * into v from public.id_card_designs where id = p_design;
  if v.id is null or not app.has_permission(v.organization_id, 'org.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.id_card_designs set is_default = false
   where organization_id = v.organization_id and card_type = v.card_type and is_default and id <> p_design;
  update public.id_card_designs set is_default = true where id = p_design;
end $$;

-- Rolls a design out: the default for its kind, and everyone with a sign-in is told their card is ready.
create function public.roll_out_id_card(p_design uuid) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  v   public.id_card_designs;
  v_n integer := 0;
  e   record;
begin
  select * into v from public.id_card_designs where id = p_design;
  if v.id is null or not app.has_permission(v.organization_id, 'org.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  perform public.set_default_id_card(p_design);
  update public.id_card_designs set rolled_out_at = now() where id = p_design;
  for e in select emp.user_id from public.employees emp
            where emp.organization_id = v.organization_id and emp.status in ('active', 'on_notice') and emp.user_id is not null loop
    perform app.notify(v.organization_id, e.user_id, 'idcard.ready',
      case v.card_type when 'visiting' then 'Your visiting card is ready' else 'Your ID card is ready' end,
      'Open it to view, print or keep it on your phone.', '/idstudio');
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function public.roll_out_id_card(uuid) from public, anon;
grant execute on function public.roll_out_id_card(uuid) to authenticated, service_role;

-- ─── Konnect (discussion board) ─────────────────────────────────────────────

create table public.konnect_topics (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  name             text not null check (char_length(btrim(name)) between 2 and 40),
  description      text check (char_length(description) <= 200),
  emoji            text check (char_length(emoji) <= 8),
  position         smallint not null default 0,
  archived_at      timestamptz,
  created_at       timestamptz not null default now(),
  unique (organization_id, name),
  unique (organization_id, id)
);

create table public.konnect_threads (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null,
  topic_id            uuid not null,
  author_employee_id  uuid not null,
  title               text not null check (char_length(btrim(title)) between 3 and 160),
  body                text not null check (char_length(btrim(body)) between 1 and 5000),
  pinned              boolean not null default false,
  locked              boolean not null default false,
  hidden              boolean not null default false,
  reply_count         integer not null default 0,
  like_count          integer not null default 0,
  last_activity_at    timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  edited_at           timestamptz,
  unique (organization_id, id),
  foreign key (organization_id, topic_id) references public.konnect_topics (organization_id, id) on delete cascade,
  foreign key (organization_id, author_employee_id) references public.employees (organization_id, id) on delete cascade
);
create index konnect_threads_topic_idx on public.konnect_threads (organization_id, topic_id, pinned desc, last_activity_at desc);

create table public.konnect_replies (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null,
  thread_id           uuid not null,
  author_employee_id  uuid not null,
  body                text not null check (char_length(btrim(body)) between 1 and 3000),
  hidden              boolean not null default false,
  created_at          timestamptz not null default now(),
  edited_at           timestamptz,
  unique (organization_id, id),
  foreign key (organization_id, thread_id) references public.konnect_threads (organization_id, id) on delete cascade,
  foreign key (organization_id, author_employee_id) references public.employees (organization_id, id) on delete cascade
);
create index konnect_replies_thread_idx on public.konnect_replies (thread_id, created_at);

create table public.konnect_likes (
  organization_id  uuid not null,
  thread_id        uuid not null,
  employee_id      uuid not null,
  created_at       timestamptz not null default now(),
  primary key (thread_id, employee_id),
  foreign key (organization_id, thread_id) references public.konnect_threads (organization_id, id) on delete cascade,
  foreign key (organization_id, employee_id) references public.employees (organization_id, id) on delete cascade
);

create trigger konnect_topics_audit after insert or update or delete on public.konnect_topics for each row execute function app.audit_row();
create trigger konnect_threads_audit after update or delete on public.konnect_threads for each row execute function app.audit_row();
create trigger konnect_replies_audit after update or delete on public.konnect_replies for each row execute function app.audit_row();

-- Moderators: people who manage announcements.
create function app.konnect_moderator(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.has_permission(p_org, 'announcement.manage');
$$;

-- Authors may edit their words; only moderators pin, lock or hide, and nobody moves a thread or changes its author.
create function app.konnect_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_mod boolean := auth.uid() is null or app.konnect_moderator(new.organization_id);
begin
  if tg_table_name = 'konnect_threads' then
    if new.topic_id <> old.topic_id and not v_mod or new.author_employee_id <> old.author_employee_id or new.created_at <> old.created_at then
      raise exception 'not authorized' using errcode = '42501';
    end if;
    if not v_mod and (new.pinned <> old.pinned or new.locked <> old.locked or new.hidden <> old.hidden) then
      raise exception 'Only moderators can pin, lock or hide threads.' using errcode = '42501';
    end if;
    if new.title <> old.title or new.body <> old.body then new.edited_at := now(); end if;
  else
    if new.thread_id <> old.thread_id or new.author_employee_id <> old.author_employee_id or new.created_at <> old.created_at then
      raise exception 'not authorized' using errcode = '42501';
    end if;
    if not v_mod and new.hidden <> old.hidden then
      raise exception 'Only moderators can hide replies.' using errcode = '42501';
    end if;
    if new.body <> old.body then new.edited_at := now(); end if;
  end if;
  return new;
end $$;
create trigger konnect_threads_guard before update on public.konnect_threads for each row execute function app.konnect_guard();
create trigger konnect_replies_guard before update on public.konnect_replies for each row execute function app.konnect_guard();

-- Replies count on the thread, bump its activity, and tell its author.
create function app.konnect_on_reply() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_thread public.konnect_threads;
  v_user   uuid;
begin
  if tg_op = 'INSERT' then
    update public.konnect_threads set reply_count = reply_count + 1, last_activity_at = now() where id = new.thread_id returning * into v_thread;
    select user_id into v_user from public.employees where id = v_thread.author_employee_id;
    if v_user is not null and v_thread.author_employee_id <> new.author_employee_id then
      perform app.notify(new.organization_id, v_user, 'konnect.reply',
        format('%s replied to “%s”', app.person_name(new.author_employee_id), left(v_thread.title, 80)), left(new.body, 200),
        '/konnect?thread=' || new.thread_id);
    end if;
  elsif tg_op = 'DELETE' then
    update public.konnect_threads set reply_count = greatest(reply_count - 1, 0) where id = old.thread_id;
  end if;
  return null;
end $$;
create trigger konnect_replies_count after insert or delete on public.konnect_replies for each row execute function app.konnect_on_reply();

create function app.konnect_on_like() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.konnect_threads set like_count = greatest(like_count + case when tg_op = 'INSERT' then 1 else -1 end, 0)
   where id = coalesce(new.thread_id, old.thread_id);
  return null;
end $$;
create trigger konnect_likes_count after insert or delete on public.konnect_likes for each row execute function app.konnect_on_like();

-- New posts and replies only in open topics and unlocked threads.
create function app.konnect_open(p_org uuid, p_topic uuid, p_thread uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case when p_thread is not null
              then exists (select 1 from public.konnect_threads t join public.konnect_topics tp on tp.id = t.topic_id
                            where t.id = p_thread and t.organization_id = p_org and not t.locked and not t.hidden and tp.archived_at is null)
              else exists (select 1 from public.konnect_topics tp where tp.id = p_topic and tp.organization_id = p_org and tp.archived_at is null) end;
$$;

alter table public.konnect_topics enable row level security;
alter table public.konnect_threads enable row level security;
alter table public.konnect_replies enable row level security;
alter table public.konnect_likes enable row level security;

create policy konnect_topics_select on public.konnect_topics for select to authenticated using (app.is_member(organization_id));
create policy konnect_topics_write on public.konnect_topics for all to authenticated
  using (app.konnect_moderator(organization_id)) with check (app.konnect_moderator(organization_id));

create policy konnect_threads_select on public.konnect_threads for select to authenticated
  using (app.is_member(organization_id) and (not hidden or app.is_own_employee(author_employee_id) or app.konnect_moderator(organization_id)));
create policy konnect_threads_insert on public.konnect_threads for insert to authenticated
  with check (app.is_own_employee(author_employee_id) and app.konnect_open(organization_id, topic_id, null) and not pinned and not locked and not hidden);
create policy konnect_threads_update on public.konnect_threads for update to authenticated
  using (app.is_own_employee(author_employee_id) or app.konnect_moderator(organization_id))
  with check (app.is_own_employee(author_employee_id) or app.konnect_moderator(organization_id));
create policy konnect_threads_delete on public.konnect_threads for delete to authenticated
  using (app.is_own_employee(author_employee_id) or app.konnect_moderator(organization_id));

create policy konnect_replies_select on public.konnect_replies for select to authenticated
  using (app.is_member(organization_id) and (not hidden or app.is_own_employee(author_employee_id) or app.konnect_moderator(organization_id))
         and exists (select 1 from public.konnect_threads t where t.id = thread_id));
create policy konnect_replies_insert on public.konnect_replies for insert to authenticated
  with check (app.is_own_employee(author_employee_id) and app.konnect_open(organization_id, null, thread_id) and not hidden);
create policy konnect_replies_update on public.konnect_replies for update to authenticated
  using (app.is_own_employee(author_employee_id) or app.konnect_moderator(organization_id))
  with check (app.is_own_employee(author_employee_id) or app.konnect_moderator(organization_id));
create policy konnect_replies_delete on public.konnect_replies for delete to authenticated
  using (app.is_own_employee(author_employee_id) or app.konnect_moderator(organization_id));

create policy konnect_likes_select on public.konnect_likes for select to authenticated using (app.is_member(organization_id));
create policy konnect_likes_insert on public.konnect_likes for insert to authenticated
  with check (app.is_own_employee(employee_id) and exists (select 1 from public.konnect_threads t where t.id = thread_id));
create policy konnect_likes_delete on public.konnect_likes for delete to authenticated using (app.is_own_employee(employee_id));

grant select, insert, update, delete on public.konnect_topics, public.konnect_threads, public.konnect_replies to authenticated;
grant select, insert, delete on public.konnect_likes to authenticated;
grant all on public.konnect_topics, public.konnect_threads, public.konnect_replies, public.konnect_likes to service_role;

create function app.seed_konnect(p_org uuid) returns void
language sql volatile security definer set search_path = '' as $$
  insert into public.konnect_topics (organization_id, name, description, emoji, position) values
    (p_org, 'General', 'Anything the whole company should hear about', '💬', 1),
    (p_org, 'Ideas', 'Suggestions to make work better', '💡', 2),
    (p_org, 'Help & questions', 'Ask colleagues; someone has done it before', '🙋', 3),
    (p_org, 'Events & clubs', 'Get-togethers, sports, hobbies', '🎉', 4),
    (p_org, 'Buy & sell', 'Things colleagues are selling, giving away or looking for', '🛍️', 5)
  on conflict (organization_id, name) do nothing;
$$;
create function app.seed_konnect_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform app.seed_konnect(new.id);
  return null;
end $$;
create trigger organizations_seed_konnect after insert on public.organizations for each row execute function app.seed_konnect_trigger();
select app.seed_konnect(id) from public.organizations;

-- ─── Insurance: the CD (cash deposit) account ───────────────────────────────

alter table public.insurance_policies
  add column premium_per_life numeric(12,2) check (premium_per_life >= 0),   -- annual premium per insured life, for estimates
  add column cd_low_balance   numeric(14,2) check (cd_low_balance >= 0);     -- warn below this balance

create table public.insurance_cd_entries (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  entry_date       date not null,
  kind             text not null check (kind in ('deposit', 'endorsement', 'refund', 'adjustment')),
  amount           numeric(14,2) not null check (amount <> 0),
  lives            integer check (lives >= 0),
  sync_id          uuid references public.insurance_syncs (id) on delete set null,
  reference        text check (char_length(reference) <= 80),
  note             text check (char_length(note) <= 300),
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  -- Deposits and refunds come in; endorsement charges go out; adjustments go either way.
  check (case kind when 'deposit' then amount > 0 when 'refund' then amount > 0 when 'endorsement' then amount < 0 else true end)
);
create index insurance_cd_entries_org_idx on public.insurance_cd_entries (organization_id, entry_date, created_at);
create trigger insurance_cd_entries_audit after insert or update or delete on public.insurance_cd_entries for each row execute function app.audit_row();
alter table public.insurance_cd_entries enable row level security;
create policy insurance_cd_entries_select on public.insurance_cd_entries for select to authenticated
  using (app.has_permission(organization_id, 'insurance.manage'));
create policy insurance_cd_entries_write on public.insurance_cd_entries for all to authenticated
  using (app.has_permission(organization_id, 'insurance.manage')) with check (app.has_permission(organization_id, 'insurance.manage'));
grant select, insert, update, delete on public.insurance_cd_entries to authenticated;
grant all on public.insurance_cd_entries to service_role;

-- ─── Hiring: the job-board feed ─────────────────────────────────────────────

-- What the careers page shows, plus the job's city and state for job boards (Indeed's XML, Google's JobPosting data).
create function public.public_job_feed(p_org_slug text)
returns table (requisition_id uuid, title text, department text, location text, city text, state_code text, employment_type public.employment_type,
               description text, posted_at timestamptz, organization_name text)
language sql stable security definer set search_path = '' as $$
  select r.id, r.title, d.name, l.name, l.city, l.state_code, r.employment_type, r.description, r.created_at, o.name
    from public.organizations o
    join public.job_requisitions r on r.organization_id = o.id
    left join public.departments d on d.id = r.department_id
    left join public.locations l on l.id = r.location_id
   where o.slug = lower(p_org_slug) and o.status = 'active' and r.status = 'open' and r.is_published
   order by r.created_at desc
   limit 200;
$$;
revoke all on function public.public_job_feed(text) from public;
grant execute on function public.public_job_feed(text) to anon, authenticated, service_role;

-- ─── Learn: bulk reminders ──────────────────────────────────────────────────

-- Reminds everyone still to finish a course (or only those past the due date); each person at most once a day.
create function public.remind_learners(p_course uuid, p_overdue_only boolean default false) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_course public.courses;
  v_n      integer := 0;
  r        record;
begin
  select * into v_course from public.courses where id = p_course;
  if v_course.id is null or not app.has_permission(v_course.organization_id, 'learning.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  for r in
    select en.id, e.user_id, en.due_on from public.course_enrollments en join public.employees e on e.id = en.employee_id
     where en.course_id = p_course and en.status in ('assigned', 'in_progress') and e.user_id is not null and e.status in ('active', 'on_notice')
       and (not p_overdue_only or en.due_on < app.org_today(v_course.organization_id))
       and (en.reminded_at is null or en.reminded_at < now() - interval '1 day')
  loop
    perform app.notify(v_course.organization_id, r.user_id, 'learning.reminder',
      format('Reminder: finish “%s”%s', left(v_course.title, 120), case when r.due_on is not null then ' by ' || to_char(r.due_on, 'FMDD Mon') else '' end),
      null, '/learning');
    update public.course_enrollments set reminded_at = now() where id = r.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function public.remind_learners(uuid, boolean) from public, anon;
grant execute on function public.remind_learners(uuid, boolean) to authenticated, service_role;

-- ─── Compliance: vendor TDS ─────────────────────────────────────────────────

create or replace function public.statutory_facts(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v jsonb;
begin
  if not app.has_permission(p_org, 'statutory.manage') then
    raise exception 'You can''t view statutory compliance.' using errcode = '42501';
  end if;
  with staff as (
    select e.id, e.location_id, coalesce(sp.pf_applicable, true) as pf, coalesce(sp.esi_applicable, false) as esi,
           i.pan, i.uan, i.esic_number
      from public.employees e
      left join public.employee_statutory_profiles sp on sp.employee_id = e.id
      left join restricted.employee_identity i on i.employee_id = e.id
     where e.organization_id = p_org and e.status in ('active', 'on_notice')
  )
  select jsonb_build_object(
    'headcount', (select count(*) from staff),
    'unmapped', (select count(*) from staff s left join public.locations l on l.id = s.location_id where l.state_code is null),
    'establishments', coalesce((
      select jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'city', l.city, 'state', l.state_code,
                                          'headcount', (select count(*) from staff s where s.location_id = l.id),
                                          'pt_number', r.pt_number, 'pt_enrolment', r.pt_enrolment, 'lwf_number', r.lwf_number, 'se_number', r.se_number)
                       order by l.name)
        from public.locations l left join public.establishment_registrations r on r.location_id = l.id
       where l.organization_id = p_org and l.archived_at is null), '[]'::jsonb),
    'pf_members', (select count(*) from staff where pf),
    'pf_missing_uan', (select count(*) from staff where pf and uan is null),
    'esi_members', (select count(*) from staff where esi),
    'esi_missing_number', (select count(*) from staff where esi and esic_number is null),
    'missing_pan', (select count(*) from staff where pan is null),
    'settings', (select jsonb_build_object('pf', coalesce(ps.pf_enabled, true), 'esi', coalesce(ps.esi_enabled, true), 'pt', coalesce(ps.pt_enabled, true))
                   from (select 1) one left join public.payroll_settings ps on ps.organization_id = p_org),
    'company', (select jsonb_build_object('pan', cp.pan is not null, 'tan', cp.tan is not null, 'pf_code', cp.pf_code is not null, 'esi_code', cp.esi_code is not null)
                  from (select 1) one left join public.company_profiles cp on cp.organization_id = p_org),
    'scope', (select jsonb_build_object('contract_labour', coalesce(sc.contract_labour, false), 'factory', coalesce(sc.factory, false))
                from (select 1) one left join public.statutory_scope sc on sc.organization_id = p_org),
    'locked_months', coalesce((select jsonb_agg(to_char(r.period_month, 'YYYY-MM') order by r.period_month)
                                 from public.payroll_runs r where r.organization_id = p_org and r.status = 'locked'), '[]'::jsonb),
    'any_payroll', exists (select 1 from public.payroll_runs r where r.organization_id = p_org and r.status <> 'cancelled'),
    'vendor_tds', exists (select 1 from public.vendor_payments vp where vp.organization_id = p_org and vp.tds_amount > 0 and vp.status not in ('rejected', 'cancelled'))
  ) into v;
  return v;
end $$;

-- ─── Function grants ────────────────────────────────────────────────────────

revoke all on function app.konnect_moderator(uuid) from public;
revoke all on function app.konnect_guard() from public;
revoke all on function app.konnect_on_reply() from public;
revoke all on function app.konnect_on_like() from public;
revoke all on function app.konnect_open(uuid, uuid, uuid) from public;
revoke all on function app.seed_konnect(uuid) from public;
revoke all on function app.seed_konnect_trigger() from public;
grant execute on function app.konnect_moderator(uuid) to authenticated, service_role;
grant execute on function app.konnect_open(uuid, uuid, uuid) to authenticated, service_role;
