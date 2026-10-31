-- PeopleCore · Email templates: one layout for every email PeopleCore sends, and editable text for the account
-- emails, set by platform administrators for all organizations (Platform › Email templates).
--
-- * platform_email_layout: one row: brand name, accent colour, logo, footer, support address and postal address. A
--   null column uses the default in @peoplecore/shared (email.ts), so better defaults reach whatever wasn't edited.
-- * platform_email_templates: one row per edited account email (invite, recovery, magiclink, email_change,
--   reauthentication). No row: the default text; resetting removes the row.
-- * Only platform admins read them, plus the service role: the web app's Supabase send-email hook (account emails) and
--   the worker (notification emails) render every email with them. Changes go through platform_set_email_layout,
--   platform_set_email_template and platform_reset_email_template, and are audited.

create table public.platform_email_layout (
  id               boolean primary key default true check (id),
  brand_name       text check (char_length(btrim(brand_name)) between 1 and 60),
  accent_color     text check (accent_color ~ '^#[0-9a-f]{6}$'),
  logo_url         text check (logo_url ~ '^https://[^\s"''<>]+$' and char_length(logo_url) <= 500),
  show_brand_name  boolean,
  footer_text      text check (char_length(footer_text) <= 500),
  support_email    text check (support_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(support_email) <= 200),
  address          text check (char_length(address) <= 200),
  updated_at       timestamptz not null default now(),
  updated_by       uuid
);
insert into public.platform_email_layout default values;

create table public.platform_email_templates (
  key           text primary key check (key in ('invite', 'recovery', 'magiclink', 'email_change', 'reauthentication')),
  subject       text not null check (char_length(btrim(subject)) between 1 and 150),
  heading       text not null check (char_length(btrim(heading)) between 1 and 150),
  body          text not null check (char_length(btrim(body)) between 1 and 4000),
  button_label  text check (char_length(btrim(button_label)) between 1 and 40),
  note          text check (char_length(note) <= 1000),
  updated_at    timestamptz not null default now(),
  updated_by    uuid
);

alter table public.platform_email_layout enable row level security;
alter table public.platform_email_templates enable row level security;
create policy platform_email_layout_select on public.platform_email_layout for select to authenticated using (app.is_platform_admin());
create policy platform_email_templates_select on public.platform_email_templates for select to authenticated using (app.is_platform_admin());
grant select on public.platform_email_layout, public.platform_email_templates to authenticated;
grant all on public.platform_email_layout, public.platform_email_templates to service_role;

-- The layout; null for a field means the default (all nulls: back to the defaults).
create function public.platform_set_email_layout(
  p_brand_name text, p_accent_color text, p_logo_url text, p_show_brand_name boolean,
  p_footer_text text, p_support_email text, p_address text) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not app.is_platform_admin() then
    raise exception 'Only platform administrators can change email templates.' using errcode = '42501';
  end if;
  update public.platform_email_layout set
    brand_name = nullif(btrim(p_brand_name), ''),
    accent_color = nullif(lower(btrim(p_accent_color)), ''),
    logo_url = nullif(btrim(p_logo_url), ''),
    show_brand_name = p_show_brand_name,
    footer_text = btrim(p_footer_text),  -- '' is no footer line; null is the default
    support_email = nullif(lower(btrim(p_support_email)), ''),
    address = nullif(btrim(p_address), ''),
    updated_at = now(), updated_by = auth.uid()
  where id;  -- the one row (Supabase's safeupdate refuses an UPDATE without WHERE)
  insert into public.audit_events (organization_id, actor_user_id, action, entity_type, entity_id, changes)
  select null, auth.uid(), 'update', 'platform_email_layout', null,
         jsonb_build_object('brand_name', l.brand_name, 'accent_color', l.accent_color, 'logo_url', l.logo_url,
           'show_brand_name', l.show_brand_name, 'footer_text', l.footer_text, 'support_email', l.support_email, 'address', l.address)
    from public.platform_email_layout l;
end $$;

create function public.platform_set_email_template(
  p_key text, p_subject text, p_heading text, p_body text, p_button_label text, p_note text) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not app.is_platform_admin() then
    raise exception 'Only platform administrators can change email templates.' using errcode = '42501';
  end if;
  if p_key is null or p_key not in ('invite', 'recovery', 'magiclink', 'email_change', 'reauthentication') then
    raise exception 'There is no such email.' using errcode = '22023';
  end if;
  insert into public.platform_email_templates (key, subject, heading, body, button_label, note, updated_by)
  values (p_key, btrim(p_subject), btrim(p_heading), btrim(p_body),
          case when p_key <> 'reauthentication' then nullif(btrim(p_button_label), '') end, nullif(btrim(p_note), ''), auth.uid())
  on conflict (key) do update set
    subject = excluded.subject, heading = excluded.heading, body = excluded.body, button_label = excluded.button_label,
    note = excluded.note, updated_at = now(), updated_by = excluded.updated_by;
  insert into public.audit_events (organization_id, actor_user_id, action, entity_type, entity_id, changes)
  select null, auth.uid(), 'update', 'platform_email_template', null,
         jsonb_build_object('key', t.key, 'subject', t.subject, 'heading', t.heading, 'body', t.body, 'button_label', t.button_label, 'note', t.note)
    from public.platform_email_templates t where t.key = p_key;
end $$;

-- Back to the default text.
create function public.platform_reset_email_template(p_key text) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not app.is_platform_admin() then
    raise exception 'Only platform administrators can change email templates.' using errcode = '42501';
  end if;
  delete from public.platform_email_templates where key = p_key;
  if found then
    insert into public.audit_events (organization_id, actor_user_id, action, entity_type, entity_id, changes)
    values (null, auth.uid(), 'delete', 'platform_email_template', null, jsonb_build_object('key', p_key));
  end if;
end $$;

revoke all on function public.platform_set_email_layout(text, text, text, boolean, text, text, text),
  public.platform_set_email_template(text, text, text, text, text, text), public.platform_reset_email_template(text) from public;
grant execute on function public.platform_set_email_layout(text, text, text, boolean, text, text, text),
  public.platform_set_email_template(text, text, text, text, text, text), public.platform_reset_email_template(text) to authenticated;
