-- PeopleCore · Assets and system access (Phase 5).
--
-- * Assets: an inventory (laptops, phones, ID cards…) with a tag, serial number and warranty. Issuing one records who
--   has it, in what condition and until when, and the employee confirms receipt. Returning it closes the issue and
--   puts the asset back in stock, in repair, retired or lost. An asset is 'assigned' exactly while an issue is open
--   (enforced by a trigger), so the register and the status can't disagree. Assets with history are retired, not deleted.
-- * System access: which accounts an employee holds in which systems (email, VPN, code hosting…), with who granted
--   and revoked them and when. A system can have an owner (e.g. the IT lead) who keeps its register without
--   org-wide rights. Offboarding (Phase 6) uses open issues and grants as its clearance checklist.
-- * asset.manage covers both and is granted to owners and HR. Employees see their own assets and access.
-- * The worker reminds the holder and asset managers once when a loan passes its due-back date.

insert into public.permissions (key, module, description, is_sensitive) values
  ('asset.manage', 'assets', 'Issue and recover assets; record system access', false);
insert into app.role_template_permissions (role_key, permission_key, scope) values
  ('owner', 'asset.manage', 'org'), ('hr_admin', 'asset.manage', 'org');
insert into public.role_permissions (organization_id, role_id, permission_key, scope)
select r.organization_id, r.id, t.permission_key, t.scope
  from app.role_template_permissions t join public.roles r on r.key = t.role_key and r.is_system
 where t.permission_key = 'asset.manage'
on conflict (role_id, permission_key) do nothing;

-- ─── Assets ─────────────────────────────────────────────────────────────────

create type public.asset_status as enum ('in_stock', 'assigned', 'in_repair', 'retired', 'lost');

create table public.assets (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  tag              text not null check (char_length(tag) between 1 and 40),
  name             text not null check (char_length(name) between 2 and 120),
  category         text not null check (char_length(category) between 2 and 60),
  serial_number    text check (char_length(serial_number) between 1 and 80),
  location_id      uuid,
  purchased_on     date,
  purchase_cost    numeric(12, 2) check (purchase_cost >= 0),
  warranty_until   date,
  status           public.asset_status not null default 'in_stock',
  notes            text check (char_length(notes) <= 2000),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, tag),
  unique (organization_id, id),
  foreign key (organization_id, location_id) references public.locations (organization_id, id)
);
create unique index assets_serial_idx on public.assets (organization_id, lower(serial_number)) where serial_number is not null;
create index assets_status_idx on public.assets (organization_id, status);

create table public.asset_assignments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  asset_id         uuid not null,
  employee_id      uuid not null,
  assigned_at      timestamptz not null default now(),
  assigned_by      uuid default auth.uid(),
  due_back_on      date,
  condition_out    text check (char_length(condition_out) <= 500),
  acknowledged_at  timestamptz,
  reminded_at      timestamptz,
  returned_at      timestamptz,
  returned_by      uuid,
  condition_in     text check (char_length(condition_in) <= 500),
  unique (organization_id, id),
  -- No cascade from the asset: history stays, and an asset with history can't be deleted (retire it instead).
  foreign key (organization_id, asset_id) references public.assets (organization_id, id),
  foreign key (organization_id, employee_id) references public.employees (organization_id, id) on delete cascade,
  check (returned_at is null or returned_at >= assigned_at)
);
create unique index asset_assignments_open_idx on public.asset_assignments (asset_id) where returned_at is null;
create index asset_assignments_employee_idx on public.asset_assignments (organization_id, employee_id);

-- A blank tag gets the next AST-0001-style number (skipping any typed by hand).
create function app.assets_stamp() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' and coalesce(btrim(new.tag), '') = '' then
    loop
      new.tag := 'AST-' || lpad(app.next_counter(new.organization_id, 'asset_tag')::text, 4, '0');
      exit when not exists (select 1 from public.assets where organization_id = new.organization_id and tag = new.tag);
    end loop;
  end if;
  new.tag := btrim(new.tag);
  new.serial_number := nullif(btrim(new.serial_number), '');
  -- 'assigned' if and only if an issue is open: issue_asset and return_asset change both in step.
  if (new.status = 'assigned') is distinct from
     exists (select 1 from public.asset_assignments where asset_id = new.id and returned_at is null) then
    raise exception 'Issue or return the asset to change who has it.' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger assets_stamp before insert or update on public.assets for each row execute function app.assets_stamp();
create trigger assets_touch before update on public.assets for each row execute function app.touch_updated_at();
create trigger assets_audit after insert or update or delete on public.assets for each row execute function app.audit_row();
create trigger asset_assignments_audit after insert or update on public.asset_assignments for each row execute function app.audit_row();

-- ─── System access ──────────────────────────────────────────────────────────

create table public.access_systems (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations (id) on delete cascade,
  name               text not null check (char_length(name) between 2 and 80),
  owner_employee_id  uuid,
  is_active          boolean not null default true,
  unique (organization_id, name),
  unique (organization_id, id),
  foreign key (organization_id, owner_employee_id) references public.employees (organization_id, id) on delete set null (owner_employee_id)
);

create table public.access_grants (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  employee_id      uuid not null,
  system_id        uuid not null,
  account          text not null check (char_length(account) between 1 and 160),
  access_level     text check (char_length(access_level) <= 60),
  granted_at       timestamptz not null default now(),
  granted_by       uuid default auth.uid(),
  revoked_at       timestamptz,
  revoked_by       uuid,
  revoke_note      text check (char_length(revoke_note) <= 500),
  unique (organization_id, id),
  foreign key (organization_id, employee_id) references public.employees (organization_id, id) on delete cascade,
  foreign key (organization_id, system_id) references public.access_systems (organization_id, id)
);
create unique index access_grants_open_idx on public.access_grants (system_id, employee_id, lower(account)) where revoked_at is null;
create index access_grants_employee_idx on public.access_grants (organization_id, employee_id);

create trigger access_systems_audit after insert or update or delete on public.access_systems for each row execute function app.audit_row();
create trigger access_grants_audit after insert or update on public.access_grants for each row execute function app.audit_row();

-- The caller manages access to this system: asset.manage, or the system's owner.
create function app.can_manage_access(p_system uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.access_systems s
                  where s.id = p_system
                    and (app.has_permission(s.organization_id, 'asset.manage') or app.is_own_employee(s.owner_employee_id)));
$$;

-- ─── RLS ────────────────────────────────────────────────────────────────────

alter table public.assets enable row level security;
alter table public.asset_assignments enable row level security;
alter table public.access_systems enable row level security;
alter table public.access_grants enable row level security;

-- Managers see the inventory; employees see assets they hold or have held.
create policy assets_select on public.assets for select to authenticated
  using (app.has_permission(organization_id, 'asset.manage')
         or exists (select 1 from public.asset_assignments a where a.asset_id = assets.id and app.is_own_employee(a.employee_id)));
create policy assets_write on public.assets for all to authenticated
  using (app.has_permission(organization_id, 'asset.manage')) with check (app.has_permission(organization_id, 'asset.manage'));
create policy asset_assignments_select on public.asset_assignments for select to authenticated
  using (app.has_permission(organization_id, 'asset.manage') or app.is_own_employee(employee_id));

-- System names are not sensitive; every member may read them (to understand their own access).
create policy access_systems_select on public.access_systems for select to authenticated using (app.is_member(organization_id));
create policy access_systems_write on public.access_systems for all to authenticated
  using (app.has_permission(organization_id, 'asset.manage')) with check (app.has_permission(organization_id, 'asset.manage'));
create policy access_grants_select on public.access_grants for select to authenticated
  using (app.can_manage_access(system_id) or app.is_own_employee(employee_id));

grant select, insert, update, delete on public.assets, public.access_systems to authenticated;
grant select on public.asset_assignments, public.access_grants to authenticated;
grant all on public.assets, public.asset_assignments, public.access_systems, public.access_grants to service_role;

-- ─── Functions ──────────────────────────────────────────────────────────────

-- Issue an in-stock asset to a current (or joining) employee; they are asked to confirm receipt.
create function public.issue_asset(p_asset uuid, p_employee uuid, p_due_back date default null, p_condition text default null)
returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_a   public.assets;
  v_e   public.employees;
  v_id  uuid;
begin
  select * into v_a from public.assets where id = p_asset for update;
  if v_a.id is null or not app.has_permission(v_a.organization_id, 'asset.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_a.status <> 'in_stock' then
    raise exception '%', case v_a.status when 'assigned' then 'This asset is already issued. Return it first.'
                                         else 'Only an asset in stock can be issued.' end using errcode = '22023';
  end if;
  select * into v_e from public.employees where id = p_employee and organization_id = v_a.organization_id and status <> 'exited';
  if v_e.id is null then
    raise exception 'Choose a current employee.' using errcode = '22023';
  end if;
  if p_due_back is not null and p_due_back < app.org_today(v_a.organization_id) then
    raise exception 'The return date can’t be in the past.' using errcode = '22023';
  end if;
  insert into public.asset_assignments (organization_id, asset_id, employee_id, due_back_on, condition_out)
  values (v_a.organization_id, p_asset, p_employee, p_due_back, nullif(btrim(p_condition), ''))
  returning id into v_id;
  update public.assets set status = 'assigned' where id = p_asset;
  perform app.notify(v_a.organization_id, v_e.user_id, 'asset.issued',
    'Asset issued to you: ' || v_a.name || ' (' || v_a.tag || ')', 'Please confirm you have received it.', '/assets');
  return v_id;
end $$;

-- Take an issued asset back; it goes to stock, repair, retirement or is recorded lost.
create function public.return_asset(p_asset uuid, p_status public.asset_status default 'in_stock', p_condition text default null)
returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_a public.assets;
begin
  select * into v_a from public.assets where id = p_asset for update;
  if v_a.id is null or not app.has_permission(v_a.organization_id, 'asset.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_a.status <> 'assigned' then
    raise exception 'This asset isn’t issued to anyone.' using errcode = '22023';
  end if;
  if p_status = 'assigned' then
    raise exception 'Choose where the asset goes: stock, repair, retired or lost.' using errcode = '22023';
  end if;
  update public.asset_assignments set returned_at = now(), returned_by = auth.uid(), condition_in = nullif(btrim(p_condition), '')
   where asset_id = p_asset and returned_at is null;
  update public.assets set status = p_status where id = p_asset;
end $$;

-- The holder confirms they have the asset.
create function public.acknowledge_asset(p_assignment uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_x public.asset_assignments;
begin
  select * into v_x from public.asset_assignments where id = p_assignment;
  if v_x.id is null or not app.is_own_employee(v_x.employee_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_x.returned_at is not null then
    raise exception 'This asset has already been returned.' using errcode = '22023';
  end if;
  update public.asset_assignments set acknowledged_at = coalesce(acknowledged_at, now()) where id = p_assignment;
end $$;

create function public.grant_access(p_system uuid, p_employee uuid, p_account text, p_level text default null)
returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_s  public.access_systems;
  v_id uuid;
begin
  select * into v_s from public.access_systems where id = p_system;
  if v_s.id is null or not app.can_manage_access(p_system) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not v_s.is_active then
    raise exception 'This system is no longer in use.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.employees where id = p_employee and organization_id = v_s.organization_id and status <> 'exited') then
    raise exception 'Choose a current employee.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_account, ''))) not between 1 and 160 then
    raise exception 'Enter the account name or email.' using errcode = '22023';
  end if;
  if exists (select 1 from public.access_grants where system_id = p_system and employee_id = p_employee
                and lower(account) = lower(btrim(p_account)) and revoked_at is null) then
    raise exception 'This account is already recorded for them.' using errcode = '22023';
  end if;
  insert into public.access_grants (organization_id, employee_id, system_id, account, access_level)
  values (v_s.organization_id, p_employee, p_system, btrim(p_account), nullif(btrim(p_level), ''))
  returning id into v_id;
  return v_id;
end $$;

create function public.revoke_access(p_grant uuid, p_note text default null) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_g public.access_grants;
begin
  select * into v_g from public.access_grants where id = p_grant for update;
  if v_g.id is null or not app.can_manage_access(v_g.system_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_g.revoked_at is not null then
    raise exception 'This access has already been revoked.' using errcode = '22023';
  end if;
  update public.access_grants set revoked_at = now(), revoked_by = auth.uid(), revoke_note = nullif(btrim(p_note), '')
   where id = p_grant;
end $$;

-- What an employee still holds: open asset issues and active access. The clearance list for offboarding.
create function public.employee_holdings(p_employee uuid)
returns table (kind text, id uuid, item text, detail text, since timestamptz)
language sql stable security invoker set search_path = '' as $$
  select 'asset', x.id, a.name || ' (' || a.tag || ')', a.category, x.assigned_at
    from public.asset_assignments x join public.assets a on a.id = x.asset_id
   where x.employee_id = p_employee and x.returned_at is null
  union all
  select 'access', g.id, s.name, g.account || coalesce(' · ' || g.access_level, ''), g.granted_at
    from public.access_grants g join public.access_systems s on s.id = g.system_id
   where g.employee_id = p_employee and g.revoked_at is null
  order by 1 desc, 5, 3;
$$;

-- Worker: remind the holder and asset managers once when a loan is overdue (each org's own local date).
create function public.worker_asset_returns() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  r record;
  v_n int := 0;
begin
  for r in update public.asset_assignments x set reminded_at = now()
             from public.assets a
            where a.id = x.asset_id and x.returned_at is null and x.reminded_at is null
              and x.due_back_on < app.org_today(x.organization_id)
           returning x.organization_id, x.asset_id, x.employee_id, a.name, a.tag loop
    v_n := v_n + 1;
    perform app.notify(r.organization_id, (select user_id from public.employees where id = r.employee_id), 'asset.overdue',
      'Please return ' || r.name || ' (' || r.tag || ')', 'It was due back. Contact HR if you still need it.', '/assets');
    perform app.notify_permission_holders(r.organization_id, 'asset.manage', 'asset.overdue',
      'Overdue: ' || r.name || ' (' || r.tag || ')', '/assets/' || r.asset_id);
  end loop;
  return jsonb_build_object('reminded', v_n);
end $$;

revoke all on function app.assets_stamp() from public;
revoke all on function app.can_manage_access(uuid) from public;
grant execute on function app.can_manage_access(uuid) to authenticated, service_role;
revoke all on function public.issue_asset(uuid, uuid, date, text) from public, anon;
revoke all on function public.return_asset(uuid, public.asset_status, text) from public, anon;
revoke all on function public.acknowledge_asset(uuid) from public, anon;
revoke all on function public.grant_access(uuid, uuid, text, text) from public, anon;
revoke all on function public.revoke_access(uuid, text) from public, anon;
revoke all on function public.employee_holdings(uuid) from public, anon;
revoke all on function public.worker_asset_returns() from public, anon, authenticated;
grant execute on function public.issue_asset(uuid, uuid, date, text) to authenticated, service_role;
grant execute on function public.return_asset(uuid, public.asset_status, text) to authenticated, service_role;
grant execute on function public.acknowledge_asset(uuid) to authenticated, service_role;
grant execute on function public.grant_access(uuid, uuid, text, text) to authenticated, service_role;
grant execute on function public.revoke_access(uuid, text) to authenticated, service_role;
grant execute on function public.employee_holdings(uuid) to authenticated, service_role;
grant execute on function public.worker_asset_returns() to service_role;
