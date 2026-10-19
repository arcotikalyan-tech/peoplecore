-- PeopleCore · Letters (Kredily's Letter Studio): templates per letter type with merge tags, authorized signatories,
-- letterhead, letters generated per employee (draft → released), employee self-serve requests, and the permission
-- `letter.manage` (owner, HR admin).
--
-- Letters hold the rendered text (merge tags resolved when generated, which can include salary), so the body is
-- redacted in the audit trail. Employees see only their own released letters. Signatory details are copied onto
-- each letter when it is generated, so a released letter never changes when a signatory is edited.

insert into public.permissions (key, module, description, is_sensitive) values
  ('letter.manage', 'core_hr', 'Generate and release employee letters; manage templates, signatories and letterhead', true);
insert into app.role_template_permissions (role_key, permission_key, scope) values
  ('owner', 'letter.manage', 'org'), ('hr_admin', 'letter.manage', 'org');
insert into public.role_permissions (organization_id, role_id, permission_key, scope)
select r.organization_id, r.id, t.permission_key, t.scope
  from app.role_template_permissions t join public.roles r on r.key = t.role_key and r.is_system
 where t.permission_key = 'letter.manage'
on conflict (role_id, permission_key) do nothing;

-- Letterhead art and signature images. No storage policies: only the app server (service role) reads and writes.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('letter-assets', 'letter-assets', false, 1048576, array['image/jpeg', 'image/png'])
on conflict (id) do nothing;

-- ─── Tables ─────────────────────────────────────────────────────────────────

create table public.letter_settings (
  organization_id  uuid primary key references public.organizations (id) on delete cascade,
  header_style     text not null default 'classic' check (header_style in ('classic', 'none', 'custom')),
  footer_style     text not null default 'band' check (footer_style in ('band', 'none', 'custom')),
  header_path      text check (header_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}$'),
  footer_path      text check (footer_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}$'),
  updated_at       timestamptz not null default now(),
  check (header_style <> 'custom' or header_path is not null),
  check (footer_style <> 'custom' or footer_path is not null)
);
create trigger letter_settings_touch before update on public.letter_settings for each row execute function app.touch_updated_at();
create trigger letter_settings_audit after insert or update on public.letter_settings for each row execute function app.audit_row();

create table public.letter_signatories (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  name             text not null check (char_length(name) between 2 and 120),
  designation      text not null check (char_length(designation) between 2 and 120),
  address          text check (char_length(address) <= 300),
  signature_path   text check (signature_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}$'),
  created_at       timestamptz not null default now(),
  unique (organization_id, id)
);
create trigger letter_signatories_audit after insert or update or delete on public.letter_signatories for each row execute function app.audit_row();

create table public.letter_templates (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  letter_type      text not null check (char_length(letter_type) between 2 and 80),
  name             text not null default 'Template 1' check (char_length(name) between 1 and 60),
  body             text not null check (char_length(body) between 10 and 20000),
  signatory_id     uuid,
  self_serve       boolean not null default false,
  archived_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, letter_type, name),
  unique (organization_id, id),
  foreign key (organization_id, signatory_id) references public.letter_signatories (organization_id, id) on delete set null (signatory_id)
);
create trigger letter_templates_touch before update on public.letter_templates for each row execute function app.touch_updated_at();
create trigger letter_templates_audit after insert or update or delete on public.letter_templates for each row execute function app.audit_row();

create table public.letter_requests (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  employee_id      uuid not null,
  template_id      uuid not null,
  letter_type      text not null,
  reason           text check (char_length(reason) <= 500),
  status           text not null default 'pending' check (status in ('pending', 'released', 'rejected', 'withdrawn')),
  requested_by     uuid not null default auth.uid(),
  created_at       timestamptz not null default now(),
  decided_at       timestamptz,
  decided_by       uuid,
  decision_note    text check (char_length(decision_note) <= 500),
  letter_id        uuid,
  unique (organization_id, id),
  foreign key (organization_id, employee_id) references public.employees (organization_id, id) on delete cascade,
  foreign key (organization_id, template_id) references public.letter_templates (organization_id, id) on delete cascade
);
create unique index letter_requests_open_uq on public.letter_requests (employee_id, template_id) where status = 'pending';
create index letter_requests_org_idx on public.letter_requests (organization_id, status, created_at desc);
create trigger letter_requests_audit after insert or update on public.letter_requests for each row execute function app.audit_row();

create table public.letters (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  employee_id      uuid not null,
  template_id      uuid,
  letter_type      text not null check (char_length(letter_type) between 2 and 80),
  body             text not null check (char_length(body) between 10 and 30000),
  signatory        jsonb not null default '{}' check (jsonb_typeof(signatory) = 'object'),
  status           text not null default 'draft' check (status in ('draft', 'released', 'cancelled')),
  request_id       uuid,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  released_at      timestamptz,
  released_by      uuid,
  unique (organization_id, id),
  foreign key (organization_id, employee_id) references public.employees (organization_id, id) on delete cascade,
  foreign key (organization_id, template_id) references public.letter_templates (organization_id, id) on delete set null (template_id),
  foreign key (organization_id, request_id) references public.letter_requests (organization_id, id) on delete set null (request_id),
  check ((status = 'released') = (released_at is not null) or status = 'cancelled')
);
create index letters_employee_idx on public.letters (organization_id, employee_id, created_at desc);
create index letters_org_idx on public.letters (organization_id, status, released_at desc);
create trigger letters_audit after insert or update or delete on public.letters for each row execute function app.audit_row('body');

alter table public.letter_requests
  add foreign key (organization_id, letter_id) references public.letters (organization_id, id) on delete set null (letter_id);

-- A released letter is final: only cancelling it is allowed.
create function app.letters_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.status = 'released' and (new.body is distinct from old.body or new.employee_id is distinct from old.employee_id
     or new.signatory is distinct from old.signatory or new.status not in ('released', 'cancelled')) then
    raise exception 'A released letter can’t be changed. Cancel it and generate a new one.' using errcode = '55000';
  end if;
  if old.status = 'cancelled' and new is distinct from old then
    raise exception 'This letter was cancelled.' using errcode = '55000';
  end if;
  return new;
end $$;
revoke all on function app.letters_guard() from public;
create trigger letters_guard before update on public.letters for each row execute function app.letters_guard();

-- ─── RLS and grants ─────────────────────────────────────────────────────────

alter table public.letter_settings enable row level security;
alter table public.letter_signatories enable row level security;
alter table public.letter_templates enable row level security;
alter table public.letter_requests enable row level security;
alter table public.letters enable row level security;

create policy letter_settings_select on public.letter_settings for select to authenticated using (app.is_member(organization_id));
create policy letter_settings_write on public.letter_settings for all to authenticated
  using (app.has_permission(organization_id, 'letter.manage')) with check (app.has_permission(organization_id, 'letter.manage'));
create policy letter_signatories_all on public.letter_signatories for all to authenticated
  using (app.has_permission(organization_id, 'letter.manage')) with check (app.has_permission(organization_id, 'letter.manage'));
create policy letter_templates_select on public.letter_templates for select to authenticated
  using (app.has_permission(organization_id, 'letter.manage') or (self_serve and archived_at is null and app.is_member(organization_id)));
create policy letter_templates_write on public.letter_templates for all to authenticated
  using (app.has_permission(organization_id, 'letter.manage')) with check (app.has_permission(organization_id, 'letter.manage'));
create policy letter_requests_select on public.letter_requests for select to authenticated
  using (app.has_permission(organization_id, 'letter.manage') or app.is_own_employee(employee_id));
create policy letters_select on public.letters for select to authenticated
  using (app.has_permission(organization_id, 'letter.manage') or (status = 'released' and app.is_own_employee(employee_id)));
create policy letters_write on public.letters for insert to authenticated with check (app.has_permission(organization_id, 'letter.manage') and status = 'draft');
create policy letters_update on public.letters for update to authenticated
  using (app.has_permission(organization_id, 'letter.manage')) with check (app.has_permission(organization_id, 'letter.manage'));
create policy letters_delete on public.letters for delete to authenticated using (app.has_permission(organization_id, 'letter.manage') and status = 'draft');

grant select, insert, update on public.letter_settings to authenticated;
grant select, insert, update, delete on public.letter_signatories, public.letter_templates to authenticated;
grant select on public.letter_requests to authenticated;
grant select, insert, update, delete on public.letters to authenticated;
grant all on public.letter_settings, public.letter_signatories, public.letter_templates, public.letter_requests, public.letters to service_role;

-- ─── Functions ──────────────────────────────────────────────────────────────

-- An employee asks for a self-serve letter. HR is notified.
create function public.request_letter(p_org uuid, p_template uuid, p_reason text default null) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_emp uuid;
  v_t   public.letter_templates;
  v_id  uuid;
begin
  select e.id into v_emp from public.employees e
   where e.organization_id = p_org and e.user_id = auth.uid() and e.status in ('active', 'on_notice', 'exited');
  select * into v_t from public.letter_templates t where t.id = p_template and t.organization_id = p_org and t.self_serve and t.archived_at is null;
  if v_emp is null or v_t.id is null or not app.is_member(p_org) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if exists (select 1 from public.letter_requests r where r.employee_id = v_emp and r.template_id = p_template and r.status = 'pending') then
    raise exception 'You already have a pending request for this letter.' using errcode = '23505';
  end if;
  insert into public.letter_requests (organization_id, employee_id, template_id, letter_type, reason)
  values (p_org, v_emp, p_template, v_t.letter_type, nullif(btrim(p_reason), '')) returning id into v_id;
  perform app.notify_permission_holders(p_org, 'letter.manage', 'letter.requested', 'Letter requested: ' || v_t.letter_type, '/letters?tab=requests');
  return v_id;
end $$;

-- HR declines a request (with a note), or the employee withdraws their own pending request.
create function public.close_letter_request(p_request uuid, p_status text, p_note text default null) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_r public.letter_requests;
  v_user uuid;
begin
  select * into v_r from public.letter_requests r where r.id = p_request and r.status = 'pending' for update;
  if v_r.id is null
     or (p_status = 'rejected' and not app.has_permission(v_r.organization_id, 'letter.manage'))
     or (p_status = 'withdrawn' and not app.is_own_employee(v_r.employee_id))
     or p_status not in ('rejected', 'withdrawn') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.letter_requests set status = p_status, decided_at = now(), decided_by = auth.uid(), decision_note = nullif(btrim(p_note), '')
   where id = v_r.id;
  if p_status = 'rejected' then
    select e.user_id into v_user from public.employees e where e.id = v_r.employee_id;
    if v_user is not null then
      perform app.notify(v_r.organization_id, v_user, 'letter.rejected', 'Your ' || v_r.letter_type || ' request was declined', nullif(btrim(p_note), ''), '/letters');
    end if;
  end if;
end $$;

-- Release drafts: final, visible to the employee, linked to their request, and the employee is notified.
create function public.release_letters(p_letters uuid[]) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  l record;
  n integer := 0;
begin
  for l in select le.*, e.user_id from public.letters le join public.employees e on e.id = le.employee_id
            where le.id = any (p_letters) and le.status = 'draft' for update of le loop
    if not app.has_permission(l.organization_id, 'letter.manage') then
      raise exception 'not authorized' using errcode = '42501';
    end if;
    update public.letters set status = 'released', released_at = now(), released_by = auth.uid() where id = l.id;
    if l.request_id is not null then
      update public.letter_requests set status = 'released', decided_at = now(), decided_by = auth.uid(), letter_id = l.id
       where id = l.request_id and status = 'pending';
    end if;
    if l.user_id is not null then
      perform app.notify(l.organization_id, l.user_id, 'letter.released', 'Your ' || l.letter_type || ' is ready', null, '/letters/' || l.id);
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function public.request_letter(uuid, uuid, text) from public, anon;
revoke all on function public.close_letter_request(uuid, text, text) from public, anon;
revoke all on function public.release_letters(uuid[]) from public, anon;
grant execute on function public.request_letter(uuid, uuid, text) to authenticated, service_role;
grant execute on function public.close_letter_request(uuid, text, text) to authenticated, service_role;
grant execute on function public.release_letters(uuid[]) to authenticated, service_role;

-- ─── Standard templates ─────────────────────────────────────────────────────

create function app.seed_org_letters(p_org uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  insert into public.letter_settings (organization_id) values (p_org) on conflict do nothing;
  insert into public.letter_templates (organization_id, letter_type, body, self_serve) values
  (p_org, 'Address Proof Letter', $t$Date: {{ date }}

TO WHOM SO EVER IT MAY CONCERN

This is to certify that {{ full name }} is an employee of our organization since {{ date of joining }} and is currently designated as {{ designation }}.

The residential address provided by the employee for our official records is:

{{ current address }}

This certificate has been issued at the request of the employee. The company does not hold any responsibility for transactions between the employee and the third party.

For {{ company name }}

{{ authorized signatory signature }}
{{ authorized signatory name }}
{{ authorized signatory designation }}$t$, true),
  (p_org, 'Appointment letter', $t$Date: {{ date }}

{{ salutation }} {{ full name }}
{{ address }}

Dear {{ first name }},

Letter of Appointment

We are pleased to appoint you as {{ designation }} in the {{ department }} department of {{ company name }}, with effect from {{ date of joining }}. Your place of posting will be {{ location }}.

Your annual cost to company will be {{ annual ctc }}, as detailed in the annexure. You will be on probation for {{ probation period in months }} months, during which either party may end the employment with {{ probation notice period }} notice. After confirmation, the notice period will be {{ confirmation notice period }}.

You will be governed by the policies of the company as amended from time to time. Please sign and return a copy of this letter as a token of your acceptance.

We welcome you to {{ company name }} and wish you a rewarding career with us.

For {{ company name }}

{{ authorized signatory signature }}
{{ authorized signatory name }}
{{ authorized signatory designation }}$t$, false),
  (p_org, 'Confirmation Letter', $t$Date: {{ date }}

{{ salutation }} {{ full name }}
{{ designation }}, {{ department }}

Dear {{ first name }},

Confirmation of Employment

Further to your appointment on {{ date of joining }}, we are pleased to confirm your employment with {{ company name }} with effect from {{ confirmation date }}, on successful completion of your probation.

All other terms and conditions of your appointment remain unchanged. Your notice period from the date of confirmation is {{ confirmation notice period }}.

We appreciate your contribution and look forward to your continued association.

For {{ company name }}

{{ authorized signatory signature }}
{{ authorized signatory name }}
{{ authorized signatory designation }}$t$, false),
  (p_org, 'Employment Letter', $t$Date: {{ date }}

TO WHOM SO EVER IT MAY CONCERN

This is to certify that {{ full name }} has been working with {{ company name }} since {{ date of joining }} and is currently designated as {{ designation }} in the {{ department }} department, based at {{ location }}.

This letter has been issued at the request of the employee for {{ reason }}.

For {{ company name }}

{{ authorized signatory signature }}
{{ authorized signatory name }}
{{ authorized signatory designation }}$t$, true),
  (p_org, 'Increment Letter', $t$Date: {{ date }}

{{ salutation }} {{ full name }}
{{ designation }}, {{ department }}

Dear {{ first name }},

Revision of Compensation

In recognition of your contribution, we are pleased to revise your compensation with effect from {{ salary revision date }}. Your revised annual cost to company is {{ revised annual ctc }} ({{ revised monthly ctc }} per month).

All other terms of your employment remain unchanged. This information is confidential and personal to you.

We look forward to your continued commitment.

For {{ company name }}

{{ authorized signatory signature }}
{{ authorized signatory name }}
{{ authorized signatory designation }}$t$, false),
  (p_org, 'Internship Completion Letter', $t$Date: {{ date }}

TO WHOM SO EVER IT MAY CONCERN

This is to certify that {{ full name }} completed an internship with {{ company name }} from {{ internship start date }} to {{ internship end date }} in the {{ department }} department.

During the internship {{ first name }} was sincere, hardworking and a valuable member of the team. We wish {{ first name }} every success in the future.

For {{ company name }}

{{ authorized signatory signature }}
{{ authorized signatory name }}
{{ authorized signatory designation }}$t$, false),
  (p_org, 'Internship Offer Letter', $t$Date: {{ date }}

{{ new joinee salutation }} {{ new joinee full name }}
{{ new joinee address }}

Dear {{ new joinee first name }},

Internship Offer

We are pleased to offer you an internship with {{ company name }} as {{ new joinee designation }}, from {{ internship start date }} to {{ internship end date }}. You will receive a monthly stipend of {{ stipend amount }}.

Either party may end the internship with {{ internship notice period }} notice. Please sign and return a copy of this letter to confirm your acceptance.

For {{ company name }}

{{ authorized signatory signature }}
{{ authorized signatory name }}
{{ authorized signatory designation }}$t$, false),
  (p_org, 'Leave Approval Letter', $t$Date: {{ date }}

{{ salutation }} {{ full name }}
{{ designation }}, {{ department }}

Dear {{ first name }},

Approval of Leave

Your request for leave from {{ leave start date }} to {{ leave end date }} for {{ reason }} has been approved. Please ensure a proper handover of your responsibilities before you proceed on leave.

For {{ company name }}

{{ authorized signatory signature }}
{{ authorized signatory name }}
{{ authorized signatory designation }}$t$, false),
  (p_org, 'Offer Letter', $t$Date: {{ date }}

{{ new joinee salutation }} {{ new joinee full name }}
{{ new joinee address }}

Dear {{ new joinee first name }},

Offer of Employment

We are delighted to offer you the position of {{ new joinee designation }} at {{ company name }}. Your expected date of joining is {{ new joinee date of joining }}.

Your annual cost to company will be {{ new joinee annual ctc }} ({{ new joinee monthly ctc }} per month). You will be on probation for {{ probation period in months }} months with a notice period of {{ new joinee probation notice period }}; after confirmation the notice period will be {{ new joinee confirmation notice period }}.

This offer is subject to satisfactory verification of your documents and references. Please sign and return a copy of this letter to confirm your acceptance.

For {{ company name }}

{{ authorized signatory signature }}
{{ authorized signatory name }}
{{ authorized signatory designation }}$t$, false),
  (p_org, 'Probation Extension Letter', $t$Date: {{ date }}

{{ salutation }} {{ full name }}
{{ designation }}, {{ department }}

Dear {{ first name }},

Extension of Probation

Following a review of your performance, your probation has been extended by {{ extendible probation period in months }} months, from {{ extension start date }} to {{ extension end date }}. Your manager will work with you on the areas discussed.

All other terms of your appointment remain unchanged.

For {{ company name }}

{{ authorized signatory signature }}
{{ authorized signatory name }}
{{ authorized signatory designation }}$t$, false),
  (p_org, 'Promotion Letter', $t$Date: {{ date }}

{{ salutation }} {{ full name }}
{{ designation }}, {{ department }}

Dear {{ first name }},

Promotion

We are pleased to promote you to {{ new designation }} with effect from {{ promotion date }}. Your revised annual cost to company is {{ revised annual ctc }}.

This promotion recognises your performance and contribution. We are confident you will continue to excel in your new role.

For {{ company name }}

{{ authorized signatory signature }}
{{ authorized signatory name }}
{{ authorized signatory designation }}$t$, false),
  (p_org, 'Relieving Letter', $t$Date: {{ date }}

{{ salutation }} {{ full name }}

Dear {{ first name }},

Relieving Letter

This is to confirm that you have been relieved from your duties at {{ company name }} with effect from the close of business on {{ termination date }}. You worked with us from {{ date of joining }} as {{ designation }} in the {{ department }} department.

We thank you for your contribution and wish you success in your future endeavours.

For {{ company name }}

{{ authorized signatory signature }}
{{ authorized signatory name }}
{{ authorized signatory designation }}$t$, true)
  on conflict (organization_id, letter_type, name) do nothing;
end $$;
revoke all on function app.seed_org_letters(uuid) from public;

select app.seed_org_letters(id) from public.organizations;

create function app.letters_default() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform app.seed_org_letters(new.id);
  return null;
end $$;
revoke all on function app.letters_default() from public;
create trigger organizations_letters after insert on public.organizations for each row execute function app.letters_default();
