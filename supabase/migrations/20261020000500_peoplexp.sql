-- PeopleCore · PeopleXP (Kredily's PeopleXP: feed, recognition, culture OS, culture OKRs, rewards, analytics,
-- my insights, me, settings).
--
-- * Culture values and a badge store (each badge worth some points, optionally tied to a value).
-- * The feed: posts (general, classified, announcement, celebration, recognition) for the team, department, location or
--   whole organization, with reactions and comments.
-- * Recognition: one or more colleagues, a badge and a message, within daily limits; badges at or above the
--   high-value threshold wait for an admin when approval is on. Approved recognitions credit points to each recipient.
-- * Points: a ledger per person that people can only read; only the functions here add rows. Rewards are defined by the organization (no third-party vouchers or
--   payments); employees redeem points and an admin fulfils or cancels (cancelling refunds the points).
-- * Pulse: one vibe check-in per person per day. Individual answers are private; summaries only count groups of 3+.
-- * Culture OS: nominations against values; culture OKRs per quarter.
-- New permission peoplexp.manage (owners, HR).

insert into public.permissions (key, module, description, is_sensitive) values
  ('peoplexp.manage', 'engagement', 'Manage PeopleXP: values, badges, rewards, approvals and culture analytics', false);
insert into app.role_template_permissions (role_key, permission_key, scope) values
  ('owner', 'peoplexp.manage', 'org'), ('hr_admin', 'peoplexp.manage', 'org');
insert into public.role_permissions (organization_id, role_id, permission_key, scope)
select r.organization_id, r.id, t.permission_key, t.scope
  from app.role_template_permissions t join public.roles r on r.key = t.role_key and r.is_system
 where t.permission_key = 'peoplexp.manage'
on conflict (role_id, permission_key) do nothing;

-- ─── Settings, values, badges, rewards ──────────────────────────────────────

create table public.pxp_settings (
  organization_id          uuid primary key references public.organizations (id) on delete cascade,
  points_enabled           boolean not null default true,
  daily_recognition_limit  smallint not null default 5 check (daily_recognition_limit between 1 and 100),
  daily_points_limit       integer not null default 500 check (daily_points_limit between 1 and 100000),
  high_value_threshold     integer not null default 100 check (high_value_threshold between 1 and 100000),
  require_approval         boolean not null default true,
  notify_recipient         boolean not null default true,
  notify_manager           boolean not null default true,
  updated_by               uuid default auth.uid(),
  updated_at               timestamptz not null default now()
);
create trigger pxp_settings_touch before update on public.pxp_settings for each row execute function app.touch_updated_at();
create trigger pxp_settings_audit after insert or update on public.pxp_settings for each row execute function app.audit_row();

create function app.pxp_settings(p_org uuid) returns public.pxp_settings
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.pxp_settings;
begin
  select * into s from public.pxp_settings where organization_id = p_org;
  if not found then
    s := row(p_org, true, 5, 500, 100, true, true, true, null, now())::public.pxp_settings;
  end if;
  return s;
end $$;

create table public.pxp_values (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  name             text not null check (char_length(name) between 2 and 60),
  emoji            text not null default '⭐' check (char_length(emoji) <= 8),
  description      text check (char_length(description) <= 300),
  archived_at      timestamptz,
  unique (organization_id, name),
  unique (organization_id, id)
);
create trigger pxp_values_audit after insert or update or delete on public.pxp_values for each row execute function app.audit_row();

create table public.pxp_badges (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  name             text not null check (char_length(name) between 2 and 60),
  emoji            text not null default '🏅' check (char_length(emoji) <= 8),
  points           integer not null default 10 check (points between 0 and 100000),
  value_id         uuid,
  active           boolean not null default true,
  unique (organization_id, name),
  unique (organization_id, id),
  foreign key (organization_id, value_id) references public.pxp_values (organization_id, id)
);
create trigger pxp_badges_audit after insert or update or delete on public.pxp_badges for each row execute function app.audit_row();

create table public.pxp_rewards (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  name             text not null check (char_length(name) between 2 and 80),
  description      text check (char_length(description) <= 300),
  cost             integer not null check (cost between 1 and 1000000),
  stock            integer check (stock >= 0),
  active           boolean not null default true,
  unique (organization_id, name),
  unique (organization_id, id)
);
create trigger pxp_rewards_audit after insert or update or delete on public.pxp_rewards for each row execute function app.audit_row();

-- Starter values and badges for every organization (editable).
create function app.seed_pxp(p_org uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_own uuid; v_cust uuid; v_team uuid; v_exc uuid;
begin
  insert into public.pxp_values (organization_id, name, emoji, description) values
    (p_org, 'Ownership', '🎯', 'Acts like an owner and follows through'),
    (p_org, 'Customer first', '🤝', 'Puts customers at the centre'),
    (p_org, 'Teamwork', '🙌', 'Lifts the people around them'),
    (p_org, 'Excellence', '💎', 'Raises the bar on quality')
  on conflict (organization_id, name) do nothing;
  select id into v_own from public.pxp_values where organization_id = p_org and name = 'Ownership';
  select id into v_cust from public.pxp_values where organization_id = p_org and name = 'Customer first';
  select id into v_team from public.pxp_values where organization_id = p_org and name = 'Teamwork';
  select id into v_exc from public.pxp_values where organization_id = p_org and name = 'Excellence';
  insert into public.pxp_badges (organization_id, name, emoji, points, value_id) values
    (p_org, 'Thank you', '🙏', 10, null),
    (p_org, 'Took ownership', '🎯', 25, v_own),
    (p_org, 'Customer hero', '🤝', 50, v_cust),
    (p_org, 'Team player', '🙌', 25, v_team),
    (p_org, 'Above and beyond', '🚀', 100, v_exc)
  on conflict (organization_id, name) do nothing;
end $$;
select app.seed_pxp(id) from public.organizations;
create function app.seed_pxp_trigger() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform app.seed_pxp(new.id);
  return new;
end $$;
create trigger organizations_seed_pxp after insert on public.organizations for each row execute function app.seed_pxp_trigger();

-- ─── Feed ───────────────────────────────────────────────────────────────────

create table public.pxp_posts (
  id                      uuid primary key default gen_random_uuid(),
  organization_id         uuid not null,
  author_employee_id      uuid not null,
  kind                    text not null default 'general' check (kind in ('general', 'classified', 'announcement', 'celebration', 'recognition')),
  body                    text not null check (char_length(body) between 1 and 3000),
  audience                text not null default 'org' check (audience in ('team', 'department', 'location', 'org')),
  audience_department_id  uuid,
  audience_location_id    uuid,
  visible                 boolean not null default true,
  created_at              timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, author_employee_id) references public.employees (organization_id, id) on delete cascade,
  check (audience <> 'department' or audience_department_id is not null),
  check (audience <> 'location' or audience_location_id is not null)
);
create index pxp_posts_org_time_idx on public.pxp_posts (organization_id, created_at desc);
create trigger pxp_posts_audit after insert or update or delete on public.pxp_posts for each row execute function app.audit_row();

create table public.pxp_reactions (
  organization_id  uuid not null,
  post_id          uuid not null,
  employee_id      uuid not null,
  emoji            text not null default '👏' check (emoji in ('👏', '❤️', '🎉', '😂', '💡')),
  created_at       timestamptz not null default now(),
  primary key (post_id, employee_id, emoji),
  foreign key (organization_id, post_id) references public.pxp_posts (organization_id, id) on delete cascade,
  foreign key (organization_id, employee_id) references public.employees (organization_id, id) on delete cascade
);

create table public.pxp_comments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  post_id          uuid not null,
  employee_id      uuid not null,
  body             text not null check (char_length(body) between 1 and 1000),
  created_at       timestamptz not null default now(),
  foreign key (organization_id, post_id) references public.pxp_posts (organization_id, id) on delete cascade,
  foreign key (organization_id, employee_id) references public.employees (organization_id, id) on delete cascade
);
create trigger pxp_comments_audit after insert or delete on public.pxp_comments for each row execute function app.audit_row();

-- ─── Recognition and points ─────────────────────────────────────────────────

create table public.pxp_recognitions (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null,
  post_id            uuid not null,
  from_employee_id   uuid not null,
  badge_id           uuid not null,
  points             integer not null check (points >= 0),
  message            text not null check (char_length(message) between 3 and 1000),
  status             text not null default 'approved' check (status in ('pending', 'approved', 'rejected')),
  decided_by         uuid,
  decided_at         timestamptz,
  created_at         timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, post_id) references public.pxp_posts (organization_id, id) on delete cascade,
  foreign key (organization_id, from_employee_id) references public.employees (organization_id, id) on delete cascade,
  foreign key (organization_id, badge_id) references public.pxp_badges (organization_id, id)
);
create index pxp_recognitions_org_time_idx on public.pxp_recognitions (organization_id, created_at desc);
create trigger pxp_recognitions_audit after insert or update on public.pxp_recognitions for each row execute function app.audit_row();

create table public.pxp_recognition_recipients (
  organization_id  uuid not null,
  recognition_id   uuid not null,
  employee_id      uuid not null,
  primary key (recognition_id, employee_id),
  foreign key (organization_id, recognition_id) references public.pxp_recognitions (organization_id, id) on delete cascade,
  foreign key (organization_id, employee_id) references public.employees (organization_id, id) on delete cascade
);
create index pxp_recipients_employee_idx on public.pxp_recognition_recipients (employee_id);

create table public.pxp_ledger (
  id               bigint generated always as identity primary key,
  organization_id  uuid not null,
  employee_id      uuid not null,
  delta            integer not null check (delta <> 0),
  kind             text not null check (kind in ('received', 'redeemed', 'refund', 'adjustment')),
  recognition_id   uuid,
  redemption_id    uuid,
  note             text check (char_length(note) <= 200),
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  foreign key (organization_id, employee_id) references public.employees (organization_id, id) on delete cascade
);
create index pxp_ledger_employee_idx on public.pxp_ledger (employee_id, created_at desc);
-- Append-only for people: signed-in users may only read it (no insert, update or delete privilege); the functions below
-- add rows. Deleting an organization or employee still cascades.

create table public.pxp_redemptions (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  employee_id      uuid not null,
  reward_id        uuid not null,
  points           integer not null check (points > 0),
  status           text not null default 'requested' check (status in ('requested', 'fulfilled', 'cancelled')),
  note             text check (char_length(note) <= 300),
  decided_by       uuid,
  decided_at       timestamptz,
  created_at       timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, employee_id) references public.employees (organization_id, id) on delete cascade,
  foreign key (organization_id, reward_id) references public.pxp_rewards (organization_id, id)
);
create trigger pxp_redemptions_audit after insert or update on public.pxp_redemptions for each row execute function app.audit_row();

-- ─── Pulse, nominations, OKRs ───────────────────────────────────────────────

create table public.pxp_pulse (
  organization_id  uuid not null,
  employee_id      uuid not null,
  day              date not null,
  mood             smallint not null check (mood between 1 and 5),  -- 5 great, 4 good, 3 okay, 2 stressed, 1 burnt out
  primary key (employee_id, day),
  foreign key (organization_id, employee_id) references public.employees (organization_id, id) on delete cascade
);
create index pxp_pulse_org_day_idx on public.pxp_pulse (organization_id, day);

create table public.pxp_nominations (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null,
  nominee_employee_id   uuid not null,
  nominator_employee_id uuid not null,
  value_id              uuid not null,
  month                 date not null check (extract(day from month) = 1),
  reason                text not null check (char_length(reason) between 10 and 1000),
  status                text not null default 'open' check (status in ('open', 'winner', 'closed')),
  created_at            timestamptz not null default now(),
  unique (nominator_employee_id, value_id, month),
  check (nominee_employee_id <> nominator_employee_id),
  foreign key (organization_id, nominee_employee_id) references public.employees (organization_id, id) on delete cascade,
  foreign key (organization_id, nominator_employee_id) references public.employees (organization_id, id) on delete cascade,
  foreign key (organization_id, value_id) references public.pxp_values (organization_id, id)
);
create trigger pxp_nominations_audit after insert or update on public.pxp_nominations for each row execute function app.audit_row();

create table public.pxp_okrs (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations (id) on delete cascade,
  title              text not null check (char_length(title) between 3 and 160),
  value_id           uuid,
  quarter            date not null check (extract(day from quarter) = 1 and extract(month from quarter) in (1, 4, 7, 10)),
  owner_employee_id  uuid,
  target             numeric(12,2) not null check (target > 0),
  current            numeric(12,2) not null default 0 check (current >= 0),
  unit               text not null default '%' check (char_length(unit) <= 20),
  created_at         timestamptz not null default now(),
  foreign key (organization_id, value_id) references public.pxp_values (organization_id, id),
  foreign key (organization_id, owner_employee_id) references public.employees (organization_id, id)
);
create trigger pxp_okrs_audit after insert or update or delete on public.pxp_okrs for each row execute function app.audit_row();

-- ─── Visibility ─────────────────────────────────────────────────────────────

create function app.pxp_me(p_org uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.employees where organization_id = p_org and user_id = auth.uid();
$$;

-- Who sees a post: the author, admins, and its audience (team = the author's manager, reports and peers under the same manager).
create function app.pxp_sees_post(p_post uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  p   public.pxp_posts;
  me  public.employees;
  au  public.employees;
begin
  select * into p from public.pxp_posts where id = p_post;
  if p.id is null or not app.is_member(p.organization_id) then return false; end if;
  if app.has_permission(p.organization_id, 'peoplexp.manage') then return true; end if;
  select * into me from public.employees where organization_id = p.organization_id and user_id = auth.uid();
  if me.id is null then return false; end if;
  if me.id = p.author_employee_id then return true; end if;
  if not p.visible then return false; end if;
  if p.audience = 'org' then return true; end if;
  if p.audience = 'department' then return me.department_id = p.audience_department_id; end if;
  if p.audience = 'location' then return me.location_id = p.audience_location_id; end if;
  select * into au from public.employees where id = p.author_employee_id;
  return me.id = au.manager_employee_id or me.manager_employee_id = au.id
      or (au.manager_employee_id is not null and me.manager_employee_id = au.manager_employee_id);
end $$;

alter table public.pxp_settings enable row level security;
alter table public.pxp_values enable row level security;
alter table public.pxp_badges enable row level security;
alter table public.pxp_rewards enable row level security;
alter table public.pxp_posts enable row level security;
alter table public.pxp_reactions enable row level security;
alter table public.pxp_comments enable row level security;
alter table public.pxp_recognitions enable row level security;
alter table public.pxp_recognition_recipients enable row level security;
alter table public.pxp_ledger enable row level security;
alter table public.pxp_redemptions enable row level security;
alter table public.pxp_pulse enable row level security;
alter table public.pxp_nominations enable row level security;
alter table public.pxp_okrs enable row level security;

create policy pxp_settings_select on public.pxp_settings for select to authenticated using (app.is_member(organization_id));
create policy pxp_settings_write on public.pxp_settings for all to authenticated
  using (app.has_permission(organization_id, 'peoplexp.manage')) with check (app.has_permission(organization_id, 'peoplexp.manage'));
create policy pxp_values_select on public.pxp_values for select to authenticated using (app.is_member(organization_id));
create policy pxp_values_write on public.pxp_values for all to authenticated
  using (app.has_permission(organization_id, 'peoplexp.manage')) with check (app.has_permission(organization_id, 'peoplexp.manage'));
create policy pxp_badges_select on public.pxp_badges for select to authenticated using (app.is_member(organization_id));
create policy pxp_badges_write on public.pxp_badges for all to authenticated
  using (app.has_permission(organization_id, 'peoplexp.manage')) with check (app.has_permission(organization_id, 'peoplexp.manage'));
create policy pxp_rewards_select on public.pxp_rewards for select to authenticated using (app.is_member(organization_id));
create policy pxp_rewards_write on public.pxp_rewards for all to authenticated
  using (app.has_permission(organization_id, 'peoplexp.manage')) with check (app.has_permission(organization_id, 'peoplexp.manage'));
create policy pxp_posts_select on public.pxp_posts for select to authenticated using (app.pxp_sees_post(id));
-- Authors post as themselves (recognitions go through pxp_recognize); admins can hide any post; authors delete their own.
create policy pxp_posts_insert on public.pxp_posts for insert to authenticated
  with check (author_employee_id = app.pxp_me(organization_id) and kind <> 'recognition'
              and (kind <> 'announcement' or app.has_permission(organization_id, 'peoplexp.manage')));
create policy pxp_posts_update on public.pxp_posts for update to authenticated
  using (app.has_permission(organization_id, 'peoplexp.manage')) with check (app.has_permission(organization_id, 'peoplexp.manage'));
create policy pxp_posts_delete on public.pxp_posts for delete to authenticated
  using ((author_employee_id = app.pxp_me(organization_id) and kind <> 'recognition') or app.has_permission(organization_id, 'peoplexp.manage'));
create policy pxp_reactions_select on public.pxp_reactions for select to authenticated using (app.pxp_sees_post(post_id));
create policy pxp_reactions_write on public.pxp_reactions for all to authenticated
  using (employee_id = app.pxp_me(organization_id)) with check (employee_id = app.pxp_me(organization_id) and app.pxp_sees_post(post_id));
create policy pxp_comments_select on public.pxp_comments for select to authenticated using (app.pxp_sees_post(post_id));
create policy pxp_comments_insert on public.pxp_comments for insert to authenticated
  with check (employee_id = app.pxp_me(organization_id) and app.pxp_sees_post(post_id));
create policy pxp_comments_delete on public.pxp_comments for delete to authenticated
  using (employee_id = app.pxp_me(organization_id) or app.has_permission(organization_id, 'peoplexp.manage'));
-- Recognition is public once approved; pending ones only for the giver, recipients and admins. One definer function
-- decides for both tables (policies that query each other would recurse).
create function app.pxp_sees_recognition(p_recognition uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.pxp_recognitions x
     where x.id = p_recognition and app.is_member(x.organization_id)
       and (x.status = 'approved' or x.from_employee_id = app.pxp_me(x.organization_id)
            or app.has_permission(x.organization_id, 'peoplexp.manage')
            or exists (select 1 from public.pxp_recognition_recipients r where r.recognition_id = x.id and r.employee_id = app.pxp_me(x.organization_id))));
$$;
revoke all on function app.pxp_sees_recognition(uuid) from public;
grant execute on function app.pxp_sees_recognition(uuid) to authenticated, service_role;
create policy pxp_recognitions_select on public.pxp_recognitions for select to authenticated using (app.pxp_sees_recognition(id));
create policy pxp_recipients_select on public.pxp_recognition_recipients for select to authenticated using (app.pxp_sees_recognition(recognition_id));
create policy pxp_ledger_select on public.pxp_ledger for select to authenticated
  using (employee_id = app.pxp_me(organization_id) or app.has_permission(organization_id, 'peoplexp.manage'));
create policy pxp_redemptions_select on public.pxp_redemptions for select to authenticated
  using (employee_id = app.pxp_me(organization_id) or app.has_permission(organization_id, 'peoplexp.manage'));
create policy pxp_pulse_select on public.pxp_pulse for select to authenticated using (employee_id = app.pxp_me(organization_id));
create policy pxp_nominations_select on public.pxp_nominations for select to authenticated
  using (nominator_employee_id = app.pxp_me(organization_id) or app.has_permission(organization_id, 'peoplexp.manage')
         or (status = 'winner' and app.is_member(organization_id)));
create policy pxp_nominations_insert on public.pxp_nominations for insert to authenticated
  with check (nominator_employee_id = app.pxp_me(organization_id) and status = 'open');
create policy pxp_nominations_update on public.pxp_nominations for update to authenticated
  using (app.has_permission(organization_id, 'peoplexp.manage')) with check (app.has_permission(organization_id, 'peoplexp.manage'));
create policy pxp_okrs_select on public.pxp_okrs for select to authenticated using (app.is_member(organization_id));
create policy pxp_okrs_write on public.pxp_okrs for all to authenticated
  using (app.has_permission(organization_id, 'peoplexp.manage')) with check (app.has_permission(organization_id, 'peoplexp.manage'));

grant select, insert, update on public.pxp_settings to authenticated;
grant select, insert, update, delete on public.pxp_values, public.pxp_badges, public.pxp_rewards, public.pxp_posts, public.pxp_reactions,
  public.pxp_okrs to authenticated;
grant select, insert, delete on public.pxp_comments to authenticated;
grant select, insert, update on public.pxp_nominations to authenticated;
grant select on public.pxp_recognitions, public.pxp_recognition_recipients, public.pxp_ledger, public.pxp_redemptions, public.pxp_pulse to authenticated;
grant all on public.pxp_settings, public.pxp_values, public.pxp_badges, public.pxp_rewards, public.pxp_posts, public.pxp_reactions, public.pxp_comments,
  public.pxp_recognitions, public.pxp_recognition_recipients, public.pxp_ledger, public.pxp_redemptions, public.pxp_pulse, public.pxp_nominations,
  public.pxp_okrs to service_role;
revoke all on function app.pxp_settings(uuid), app.pxp_me(uuid), app.pxp_sees_post(uuid), app.seed_pxp(uuid), app.seed_pxp_trigger() from public;
grant execute on function app.pxp_settings(uuid), app.pxp_me(uuid), app.pxp_sees_post(uuid) to authenticated, service_role;
grant execute on function app.seed_pxp(uuid) to service_role;

-- ─── Functions ──────────────────────────────────────────────────────────────

-- Credits each recipient and tells them (and their managers) once a recognition is approved.
create function app.pxp_credit(p_recognition uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  r       public.pxp_recognitions;
  s       public.pxp_settings;
  x       record;
  v_from  text;
  v_badge text;
begin
  select * into r from public.pxp_recognitions where id = p_recognition;
  s := app.pxp_settings(r.organization_id);
  select trim(first_name || ' ' || coalesce(last_name, '')) into v_from from public.employees where id = r.from_employee_id;
  select emoji || ' ' || name into v_badge from public.pxp_badges where id = r.badge_id;
  for x in select e.id, e.user_id, m.user_id as manager_user from public.pxp_recognition_recipients rr
             join public.employees e on e.id = rr.employee_id left join public.employees m on m.id = e.manager_employee_id
            where rr.recognition_id = r.id loop
    if s.points_enabled and r.points > 0 then
      insert into public.pxp_ledger (organization_id, employee_id, delta, kind, recognition_id, note)
      values (r.organization_id, x.id, r.points, 'received', r.id, left(v_badge, 200));
    end if;
    if s.notify_recipient then
      perform app.notify(r.organization_id, x.user_id, 'peoplexp.recognized', v_from || ' recognised you: ' || v_badge, left(r.message, 300), '/peoplexp');
    end if;
    if s.notify_manager and x.manager_user is not null and x.manager_user is distinct from auth.uid() then
      perform app.notify(r.organization_id, x.manager_user, 'peoplexp.team_recognized', 'Someone in your team was recognised: ' || v_badge, left(r.message, 300), '/peoplexp');
    end if;
  end loop;
end $$;

create function public.pxp_recognize(p_org uuid, p_recipients uuid[], p_badge uuid, p_message text, p_audience text default 'org') returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  s        public.pxp_settings := app.pxp_settings(p_org);
  v_me     uuid := app.pxp_me(p_org);
  b        public.pxp_badges;
  v_count  integer;
  v_points integer;
  v_post   uuid;
  v_id     uuid;
  v_status text;
  v_names  text;
  n        integer;
begin
  if v_me is null then raise exception 'You need an employee record to recognise colleagues.' using errcode = '42501'; end if;
  if p_audience not in ('team', 'department', 'location', 'org') then raise exception 'Unknown audience.' using errcode = '22023'; end if;
  n := coalesce(cardinality(p_recipients), 0);
  if n = 0 or n > 20 then raise exception 'Choose between 1 and 20 people.' using errcode = '22023'; end if;
  if v_me = any (p_recipients) then raise exception 'You can''t recognise yourself.' using errcode = '22023'; end if;
  if (select count(*) from public.employees where organization_id = p_org and id = any (p_recipients) and status in ('active', 'on_notice', 'pre_joining')) <> n then
    raise exception 'Choose current colleagues.' using errcode = '22023';
  end if;
  select * into b from public.pxp_badges where id = p_badge and organization_id = p_org and active;
  if b.id is null then raise exception 'Choose a badge.' using errcode = '22023'; end if;
  if char_length(trim(coalesce(p_message, ''))) < 3 then raise exception 'Say what they did.' using errcode = '22023'; end if;

  select count(*), coalesce(sum(x.points * (select count(*) from public.pxp_recognition_recipients rr where rr.recognition_id = x.id)), 0)
    into v_count, v_points
    from public.pxp_recognitions x
   where x.from_employee_id = v_me and x.status <> 'rejected' and (x.created_at at time zone (select timezone from public.organizations where id = p_org))::date = app.org_today(p_org);
  if v_count >= s.daily_recognition_limit then
    raise exception 'You''ve reached today''s limit of % recognitions.', s.daily_recognition_limit using errcode = '22023';
  end if;
  if s.points_enabled and v_points + b.points * n > s.daily_points_limit then
    raise exception 'That goes over today''s limit of % points.', s.daily_points_limit using errcode = '22023';
  end if;

  v_status := case when s.points_enabled and s.require_approval and b.points >= s.high_value_threshold then 'pending' else 'approved' end;
  select string_agg(trim(first_name || ' ' || coalesce(last_name, '')), ', ' order by first_name) into v_names
    from public.employees where id = any (p_recipients);
  insert into public.pxp_posts (organization_id, author_employee_id, kind, body, audience, audience_department_id, audience_location_id, visible)
  select p_org, v_me, 'recognition', b.emoji || ' ' || b.name || ' → ' || v_names || E'\n' || trim(p_message), p_audience,
         case when p_audience = 'department' then e.department_id end, case when p_audience = 'location' then e.location_id end,
         v_status = 'approved'
    from public.employees e where e.id = v_me
  returning id into v_post;
  if p_audience = 'department' and (select audience_department_id from public.pxp_posts where id = v_post) is null then
    raise exception 'You aren''t in a department; choose another audience.' using errcode = '22023';
  end if;
  if p_audience = 'location' and (select audience_location_id from public.pxp_posts where id = v_post) is null then
    raise exception 'You don''t have a work location; choose another audience.' using errcode = '22023';
  end if;
  insert into public.pxp_recognitions (organization_id, post_id, from_employee_id, badge_id, points, message, status)
  values (p_org, v_post, v_me, b.id, case when s.points_enabled then b.points else 0 end, trim(p_message), v_status)
  returning id into v_id;
  insert into public.pxp_recognition_recipients (organization_id, recognition_id, employee_id)
  select p_org, v_id, unnest(p_recipients);
  if v_status = 'approved' then
    perform app.pxp_credit(v_id);
  else
    perform app.notify_permission_holders(p_org, 'peoplexp.manage', 'peoplexp.approval', left('Recognition to approve: ' || b.emoji || ' ' || b.name || ' for ' || v_names, 200), '/peoplexp?tab=recognition', auth.uid());
  end if;
  return jsonb_build_object('id', v_id, 'status', v_status);
end $$;

create function public.pxp_decide(p_recognition uuid, p_approve boolean) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  r public.pxp_recognitions;
begin
  select * into r from public.pxp_recognitions where id = p_recognition for update;
  if r.id is null or not app.has_permission(r.organization_id, 'peoplexp.manage') then raise exception 'Recognition not found.' using errcode = 'P0002'; end if;
  if r.status <> 'pending' then raise exception 'This recognition has already been decided.' using errcode = '22023'; end if;
  if r.from_employee_id = app.pxp_me(r.organization_id) then raise exception 'You can''t approve your own recognition.' using errcode = '42501'; end if;
  update public.pxp_recognitions set status = case when p_approve then 'approved' else 'rejected' end, decided_by = auth.uid(), decided_at = now() where id = r.id;
  update public.pxp_posts set visible = p_approve where id = r.post_id;
  if p_approve then perform app.pxp_credit(r.id); end if;
end $$;

create function public.pxp_redeem(p_reward uuid) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  w       public.pxp_rewards;
  v_me    uuid;
  v_bal   integer;
  v_id    uuid := gen_random_uuid();
begin
  select * into w from public.pxp_rewards where id = p_reward and active for update;
  if w.id is null or not app.is_member(w.organization_id) then raise exception 'Reward not found.' using errcode = 'P0002'; end if;
  v_me := app.pxp_me(w.organization_id);
  if v_me is null then raise exception 'You need an employee record to redeem rewards.' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext('pxp_wallet:' || v_me));
  select coalesce(sum(delta), 0) into v_bal from public.pxp_ledger where employee_id = v_me;
  if v_bal < w.cost then raise exception 'You need % more points for this reward.', w.cost - v_bal using errcode = '22023'; end if;
  if w.stock is not null and w.stock < 1 then raise exception 'This reward is out of stock.' using errcode = '22023'; end if;
  insert into public.pxp_redemptions (id, organization_id, employee_id, reward_id, points) values (v_id, w.organization_id, v_me, w.id, w.cost);
  insert into public.pxp_ledger (organization_id, employee_id, delta, kind, redemption_id, note) values (w.organization_id, v_me, -w.cost, 'redeemed', v_id, left(w.name, 200));
  if w.stock is not null then update public.pxp_rewards set stock = stock - 1 where id = w.id; end if;
  perform app.notify_permission_holders(w.organization_id, 'peoplexp.manage', 'peoplexp.redemption', 'Reward requested: ' || w.name, '/peoplexp?tab=rewards', auth.uid());
  return v_id;
end $$;

create function public.pxp_fulfil(p_redemption uuid, p_status text, p_note text default null) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  d public.pxp_redemptions;
  v_user uuid;
begin
  select * into d from public.pxp_redemptions where id = p_redemption for update;
  if d.id is null or not app.has_permission(d.organization_id, 'peoplexp.manage') then raise exception 'Redemption not found.' using errcode = 'P0002'; end if;
  if p_status not in ('fulfilled', 'cancelled') then raise exception 'Unknown status.' using errcode = '22023'; end if;
  if d.status <> 'requested' then raise exception 'This request has already been closed.' using errcode = '22023'; end if;
  update public.pxp_redemptions set status = p_status, note = left(nullif(trim(p_note), ''), 300), decided_by = auth.uid(), decided_at = now() where id = d.id;
  if p_status = 'cancelled' then
    insert into public.pxp_ledger (organization_id, employee_id, delta, kind, redemption_id, note) values (d.organization_id, d.employee_id, d.points, 'refund', d.id, 'Reward request cancelled');
    update public.pxp_rewards set stock = stock + 1 where id = d.reward_id and stock is not null;
  end if;
  select user_id into v_user from public.employees where id = d.employee_id;
  perform app.notify(d.organization_id, v_user, 'peoplexp.redemption', case when p_status = 'fulfilled' then 'Your reward is on its way' else 'Your reward request was cancelled; points refunded' end,
                     nullif(trim(p_note), ''), '/peoplexp?tab=me');
end $$;

-- An admin adjusts someone's points (welcome bonus, correction).
create function public.pxp_adjust(p_employee uuid, p_delta integer, p_note text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.employees where id = p_employee;
  if v_org is null or not app.has_permission(v_org, 'peoplexp.manage') then raise exception 'Employee not found.' using errcode = 'P0002'; end if;
  if p_delta is null or p_delta = 0 or abs(p_delta) > 100000 then raise exception 'Enter a non-zero number of points.' using errcode = '22023'; end if;
  if p_employee = app.pxp_me(v_org) then raise exception 'You can''t adjust your own points.' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_note, ''))) < 3 then raise exception 'Give a reason.' using errcode = '22023'; end if;
  insert into public.pxp_ledger (organization_id, employee_id, delta, kind, note) values (v_org, p_employee, p_delta, 'adjustment', left(trim(p_note), 200));
end $$;

create function public.pxp_checkin(p_org uuid, p_mood smallint) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := app.pxp_me(p_org);
begin
  if v_me is null then raise exception 'You need an employee record to check in.' using errcode = '42501'; end if;
  if p_mood is null or p_mood < 1 or p_mood > 5 then raise exception 'Choose how you feel.' using errcode = '22023'; end if;
  insert into public.pxp_pulse (organization_id, employee_id, day, mood) values (p_org, v_me, app.org_today(p_org), p_mood)
  on conflict (employee_id, day) do update set mood = excluded.mood;
end $$;

-- Pulse by day for the organization or one department (admins). Days with fewer than 3 answers are withheld.
create function public.pxp_pulse_summary(p_org uuid, p_from date, p_to date, p_department uuid default null)
returns table (day date, responses integer, great integer, good integer, okay integer, stressed integer, burnt integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.has_permission(p_org, 'peoplexp.manage') then raise exception 'You can''t view pulse results.' using errcode = '42501'; end if;
  return query
    select p.day, count(*)::integer,
           count(*) filter (where p.mood = 5)::integer, count(*) filter (where p.mood = 4)::integer, count(*) filter (where p.mood = 3)::integer,
           count(*) filter (where p.mood = 2)::integer, count(*) filter (where p.mood = 1)::integer
      from public.pxp_pulse p join public.employees e on e.id = p.employee_id
     where p.organization_id = p_org and p.day between p_from and p_to and (p_department is null or e.department_id = p_department)
     group by p.day having count(*) >= 3
     order by p.day;
end $$;

revoke all on function app.pxp_credit(uuid) from public;
revoke all on function public.pxp_recognize(uuid, uuid[], uuid, text, text), public.pxp_decide(uuid, boolean), public.pxp_redeem(uuid),
  public.pxp_fulfil(uuid, text, text), public.pxp_adjust(uuid, integer, text), public.pxp_checkin(uuid, smallint),
  public.pxp_pulse_summary(uuid, date, date, uuid) from public;
grant execute on function public.pxp_recognize(uuid, uuid[], uuid, text, text), public.pxp_decide(uuid, boolean), public.pxp_redeem(uuid),
  public.pxp_fulfil(uuid, text, text), public.pxp_adjust(uuid, integer, text), public.pxp_checkin(uuid, smallint),
  public.pxp_pulse_summary(uuid, date, date, uuid) to authenticated;
