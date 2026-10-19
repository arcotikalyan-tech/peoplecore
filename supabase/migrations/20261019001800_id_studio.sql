-- PeopleCore · ID Studio (Kredily's ID cards): card designs built in three steps — a template, the fields and
-- layout, and advanced options (colours, logo, QR code, the back of the card). One design is the default; HR
-- prints cards for everyone (or a department), and employees open their own card with the default design.
--
-- Designs are company branding, kept by org.manage. Card contents come from the employee record and are read
-- with the viewer's own rights (RLS), so personal fields such as blood group only appear for those who may see them.

create table public.id_card_designs (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  name             text not null check (char_length(name) between 2 and 60),
  template         text not null default 'classic' check (template ~ '^[a-z_]{3,20}$'),
  orientation      text not null default 'portrait' check (orientation in ('portrait', 'landscape')),
  fields           text[] not null default '{designation,department,employee_code,blood_group,phone}'
                   check (fields <@ '{designation,department,employee_code,date_of_joining,blood_group,phone,work_email,location,emergency_contact}'::text[]),
  primary_color    text not null default '#4f46e5' check (primary_color ~ '^#[0-9a-fA-F]{6}$'),
  accent_color     text not null default '#f97066' check (accent_color ~ '^#[0-9a-fA-F]{6}$'),
  text_color       text not null default '#111827' check (text_color ~ '^#[0-9a-fA-F]{6}$'),
  show_logo        boolean not null default true,
  show_photo       boolean not null default true,
  show_qr          boolean not null default true,
  qr_content       text not null default 'vcard' check (qr_content in ('vcard', 'employee_code')),
  back_text        text check (char_length(back_text) <= 400),
  logo_path        text check (char_length(logo_path) <= 200),
  is_default       boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, id)
);
create unique index id_card_designs_default_idx on public.id_card_designs (organization_id) where is_default;
create trigger id_card_designs_touch before update on public.id_card_designs for each row execute function app.touch_updated_at();
create trigger id_card_designs_audit after insert or update or delete on public.id_card_designs for each row execute function app.audit_row();

alter table public.id_card_designs enable row level security;
create policy id_card_designs_select on public.id_card_designs for select to authenticated using (app.is_member(organization_id));
create policy id_card_designs_write on public.id_card_designs for all to authenticated
  using (app.has_permission(organization_id, 'org.manage')) with check (app.has_permission(organization_id, 'org.manage'));
grant select, insert, update, delete on public.id_card_designs to authenticated;
grant all on public.id_card_designs to service_role;

-- Make one design the default (the previous default stops being one).
create function public.set_default_id_card(p_design uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.id_card_designs where id = p_design;
  if v_org is null or not app.has_permission(v_org, 'org.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.id_card_designs set is_default = false where organization_id = v_org and is_default and id <> p_design;
  update public.id_card_designs set is_default = true where id = p_design;
end $$;
revoke all on function public.set_default_id_card(uuid) from public, anon;
grant execute on function public.set_default_id_card(uuid) to authenticated, service_role;
