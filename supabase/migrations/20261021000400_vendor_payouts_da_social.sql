-- PeopleCore · Kredily second pass, batch 1 follow-ups: vendor payouts, the Dearness Allowance switch, social links.
--
-- * Vendor payouts (Kredily's "Vendor Payout"): vendors and contractors with PAN, GSTIN, bank account and a TDS
--   section and rate; payments for their invoices with TDS worked out, approved by someone other than whoever
--   entered them, exported as a bank file (audited) and marked paid with the UTR. New permission vendor.manage
--   (owners, payroll / finance administrators) and a standard role "Vendor payout admin" that owners give to
--   chosen HR staff (Settings › Controls). Vendor bank account numbers are left out of the audit trail.
-- * Dearness Allowance: switching it on in Payroll › Settings adds (or reactivates) a DA earning that counts as a
--   PF wage, so salary structures can include it; switching it off deactivates the component.
-- * Social links: employees add LinkedIn, X/Twitter and a website on their profile; the directory shows them when
--   the organization switches social info on.

-- ─── Permission and role ────────────────────────────────────────────────────

insert into public.permissions (key, module, description, is_sensitive) values
  ('vendor.manage', 'payroll', 'Manage vendors and pay them (TDS, approval, bank file)', true);
insert into app.role_templates (role_key, name, description, assignment_permission, requires_mfa) values
  ('vendor_admin', 'Vendor payout admin', 'Adds vendors and contractors and pays them, with TDS and a bank file', 'role.manage', true);
insert into app.role_template_permissions (role_key, permission_key, scope) values
  ('owner', 'vendor.manage', 'org'), ('payroll_admin', 'vendor.manage', 'org'),
  ('vendor_admin', 'org.read', 'org'), ('vendor_admin', 'vendor.manage', 'org');
-- Existing organizations get the new role and the new grants.
insert into public.roles (organization_id, key, name, description, is_system, assignment_permission, requires_mfa)
select o.id, t.role_key, t.name, t.description, true, t.assignment_permission, t.requires_mfa
  from public.organizations o cross join app.role_templates t
 where t.role_key = 'vendor_admin'
on conflict (organization_id, key) do nothing;
insert into public.role_permissions (organization_id, role_id, permission_key, scope)
select r.organization_id, r.id, t.permission_key, t.scope
  from app.role_template_permissions t join public.roles r on r.key = t.role_key and r.is_system
 where t.permission_key = 'vendor.manage' or t.role_key = 'vendor_admin'
on conflict (role_id, permission_key) do nothing;

-- ─── Vendors ────────────────────────────────────────────────────────────────

create table public.vendors (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations (id) on delete cascade,
  name                 text not null check (char_length(btrim(name)) between 2 and 160),
  kind                 text not null default 'contractor' check (kind in ('contractor', 'professional', 'supplier', 'other')),
  pan                  text check (pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  gstin                text check (gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$'),
  email                text check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone                text check (phone ~ '^\+?[0-9 -]{7,20}$'),
  account_holder       text check (char_length(account_holder) between 2 and 160),
  bank_name            text check (char_length(bank_name) <= 120),
  account_number       text check (account_number ~ '^[0-9]{6,18}$'),
  ifsc                 text check (ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  tds_section          text not null default 'none' check (tds_section in ('none', '194C', '194J', '194H', '194I')),
  tds_rate             numeric(5,2) not null default 0 check (tds_rate between 0 and 30),
  archived_at          timestamptz,
  created_by           uuid default auth.uid(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (organization_id, id)
);
create unique index vendors_org_name_idx on public.vendors (organization_id, lower(name)) where archived_at is null;
create trigger vendors_touch before update on public.vendors for each row execute function app.touch_updated_at();
create trigger vendors_audit after insert or update on public.vendors for each row execute function app.audit_row('account_number');

create table public.vendor_payments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  vendor_id        uuid not null,
  invoice_number   text not null check (char_length(btrim(invoice_number)) between 1 and 60),
  invoice_date     date not null,
  description      text check (char_length(description) <= 300),
  gross_amount     numeric(14,2) not null check (gross_amount > 0),
  tds_section      text not null,
  tds_amount       numeric(14,2) not null check (tds_amount >= 0),
  net_amount       numeric(14,2) not null check (net_amount >= 0),
  due_date         date,
  status           text not null default 'submitted' check (status in ('submitted', 'approved', 'rejected', 'paid', 'failed', 'cancelled')),
  decided_by       uuid,
  decided_at       timestamptz,
  decision_note    text check (char_length(decision_note) <= 300),
  reference        text check (char_length(reference) <= 60),
  paid_on          date,
  created_by       uuid not null default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, vendor_id) references public.vendors (organization_id, id),
  check (tds_amount <= gross_amount and net_amount = gross_amount - tds_amount)
);
create unique index vendor_payments_invoice_idx on public.vendor_payments (vendor_id, lower(invoice_number)) where status not in ('rejected', 'cancelled');
create index vendor_payments_org_idx on public.vendor_payments (organization_id, status, created_at desc);
create trigger vendor_payments_touch before update on public.vendor_payments for each row execute function app.touch_updated_at();
create trigger vendor_payments_audit after insert or update on public.vendor_payments for each row execute function app.audit_row();

alter table public.vendors enable row level security;
alter table public.vendor_payments enable row level security;
create policy vendors_select on public.vendors for select to authenticated using (app.has_permission(organization_id, 'vendor.manage'));
create policy vendors_insert on public.vendors for insert to authenticated with check (app.has_permission(organization_id, 'vendor.manage'));
create policy vendors_update on public.vendors for update to authenticated
  using (app.has_permission(organization_id, 'vendor.manage')) with check (app.has_permission(organization_id, 'vendor.manage'));
create policy vendor_payments_select on public.vendor_payments for select to authenticated using (app.has_permission(organization_id, 'vendor.manage'));
grant select, insert, update on public.vendors to authenticated;
grant select on public.vendor_payments to authenticated;
grant all on public.vendors, public.vendor_payments to service_role;

-- An invoice to pay: TDS at the vendor's rate unless given; waits for someone else's approval.
create function public.record_vendor_payment(p_org uuid, p_vendor uuid, p_invoice_number text, p_invoice_date date, p_gross numeric,
                                             p_description text default null, p_due_date date default null, p_tds numeric default null)
returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_vendor public.vendors;
  v_tds    numeric;
  v_id     uuid;
begin
  if not app.has_permission(p_org, 'vendor.manage') then raise exception 'not authorized' using errcode = '42501'; end if;
  select * into v_vendor from public.vendors where id = p_vendor and organization_id = p_org and archived_at is null;
  if v_vendor.id is null then raise exception 'Choose an active vendor.' using errcode = '22023'; end if;
  if p_gross is null or p_gross <= 0 then raise exception 'Enter the invoice amount.' using errcode = '22023'; end if;
  v_tds := coalesce(p_tds, round(p_gross * v_vendor.tds_rate / 100));
  if v_tds < 0 or v_tds > p_gross then raise exception 'TDS must be between zero and the invoice amount.' using errcode = '22023'; end if;
  insert into public.vendor_payments (organization_id, vendor_id, invoice_number, invoice_date, description, gross_amount, tds_section, tds_amount, net_amount, due_date)
  values (p_org, p_vendor, btrim(p_invoice_number), p_invoice_date, nullif(btrim(p_description), ''), p_gross, v_vendor.tds_section, v_tds, p_gross - v_tds, p_due_date)
  returning id into v_id;
  return v_id;
end $$;

-- Approve or reject submitted payments; never your own.
create function public.decide_vendor_payments(p_org uuid, p_ids uuid[], p_approve boolean, p_note text default null) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_n integer;
begin
  if not app.has_permission(p_org, 'vendor.manage') then raise exception 'not authorized' using errcode = '42501'; end if;
  if not p_approve and coalesce(btrim(p_note), '') = '' then raise exception 'Say why the payment is rejected.' using errcode = '22023'; end if;
  if exists (select 1 from public.vendor_payments where organization_id = p_org and id = any (p_ids) and status = 'submitted' and created_by = auth.uid()) then
    raise exception 'Someone else must approve payments you entered.' using errcode = '42501';
  end if;
  update public.vendor_payments set status = case when p_approve then 'approved' else 'rejected' end, decided_by = auth.uid(), decided_at = now(),
         decision_note = nullif(btrim(p_note), '')
   where organization_id = p_org and id = any (p_ids) and status = 'submitted';
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Paid (with the UTR and date) or failed; failed payments can be paid again. Cancelling: submitted or approved only.
create function public.update_vendor_payments(p_org uuid, p_ids uuid[], p_status text, p_reference text default null, p_paid_on date default null) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_n integer;
begin
  if not app.has_permission(p_org, 'vendor.manage') then raise exception 'not authorized' using errcode = '42501'; end if;
  if p_status not in ('paid', 'failed', 'cancelled') then raise exception 'Unknown status.' using errcode = '22023'; end if;
  if p_status = 'paid' and p_paid_on is null then raise exception 'Enter the payment date.' using errcode = '22023'; end if;
  update public.vendor_payments set status = p_status, reference = case when p_status = 'paid' then nullif(left(btrim(p_reference), 60), '') else reference end,
         paid_on = case when p_status = 'paid' then p_paid_on end
   where organization_id = p_org and id = any (p_ids)
     and status = any (case p_status when 'cancelled' then array['submitted', 'approved'] else array['approved', 'failed'] end);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- The bank file: approved and failed payments with the vendor's account (every download is recorded).
create function public.vendor_bank_advice(p_org uuid)
returns table (payment_id uuid, vendor_name text, account_holder text, bank_name text, account_number text, ifsc text, invoice_number text, amount numeric)
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not app.has_permission(p_org, 'vendor.manage') then raise exception 'not authorized' using errcode = '42501'; end if;
  insert into public.audit_events (organization_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (p_org, auth.uid(), 'payroll_export', 'vendor_payments', null, jsonb_build_object('report', 'vendor_bank_advice'));
  return query
    select p.id, v.name, v.account_holder, v.bank_name, v.account_number, v.ifsc, p.invoice_number, p.net_amount
      from public.vendor_payments p join public.vendors v on v.id = p.vendor_id
     where p.organization_id = p_org and p.status in ('approved', 'failed')
     order by v.name, p.invoice_date;
end $$;

revoke all on function public.record_vendor_payment(uuid, uuid, text, date, numeric, text, date, numeric),
  public.decide_vendor_payments(uuid, uuid[], boolean, text), public.update_vendor_payments(uuid, uuid[], text, text, date),
  public.vendor_bank_advice(uuid) from public, anon;
grant execute on function public.record_vendor_payment(uuid, uuid, text, date, numeric, text, date, numeric),
  public.decide_vendor_payments(uuid, uuid[], boolean, text), public.update_vendor_payments(uuid, uuid[], text, text, date),
  public.vendor_bank_advice(uuid) to authenticated, service_role;

-- ─── Dearness Allowance ─────────────────────────────────────────────────────

alter table public.payroll_settings add column da_enabled boolean not null default false;
grant update (da_enabled) on public.payroll_settings to authenticated;

create function app.sync_da_component() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.da_enabled then
    insert into public.salary_components (organization_id, code, name, kind, taxable, pf_wage, position, category)
    values (new.organization_id, 'DA', 'Dearness allowance', 'earning', true, true, 2, 'recurring')
    on conflict (organization_id, code) do update set is_active = true;
  else
    update public.salary_components set is_active = false where organization_id = new.organization_id and code = 'DA';
  end if;
  return null;
end $$;
revoke all on function app.sync_da_component() from public;
create trigger payroll_settings_da after update of da_enabled on public.payroll_settings
  for each row when (old.da_enabled is distinct from new.da_enabled) execute function app.sync_da_component();

-- ─── Social links ───────────────────────────────────────────────────────────

alter table public.employee_personal
  add column linkedin_url text check (linkedin_url ~ '^https://([a-z0-9-]+\.)?linkedin\.com/' and char_length(linkedin_url) <= 200),
  add column twitter_url  text check (twitter_url ~ '^https://(www\.)?(twitter|x)\.com/' and char_length(twitter_url) <= 200),
  add column website_url  text check (website_url ~ '^https://[^\s]+$' and char_length(website_url) <= 200);
alter table public.directory_settings add column show_social boolean not null default false;
grant update (show_social) on public.directory_settings to authenticated;

drop function public.people_directory(uuid, text, integer);
create function public.people_directory(p_org uuid, p_query text default null, p_limit integer default 500)
returns table (id uuid, name text, department text, designation text, location text, work_email text, work_phone text,
               tenure_years numeric, manager_id uuid, birthday text, marital_status text, linkedin_url text, twitter_url text, website_url text)
language sql stable security definer set search_path = '' as $$
  select e.id, concat_ws(' ', e.first_name, e.middle_name, e.last_name),
         case when s.show_department then d.name end,
         case when s.show_designation then g.title end,
         case when s.show_location then l.name end,
         case when s.show_email then e.work_email end,
         case when s.show_phone then e.work_phone end,
         round(greatest(0, app.org_today(p_org) - e.date_of_joining) / 365.25, 1),
         e.manager_employee_id,
         case when s.show_birthday and p.date_of_birth is not null then to_char(p.date_of_birth, 'FMDD Mon') end,
         case when s.show_marital_status then p.marital_status end,
         case when s.show_social then p.linkedin_url end,
         case when s.show_social then p.twitter_url end,
         case when s.show_social then p.website_url end
    from public.employees e
    join public.directory_settings s on s.organization_id = e.organization_id
    left join public.departments d on d.id = e.department_id
    left join public.designations g on g.id = e.designation_id
    left join public.locations l on l.id = e.location_id
    left join public.employee_personal p on p.employee_id = e.id
   where app.is_member(p_org) and e.organization_id = p_org and e.status in ('active', 'on_notice')
     and (app.directory_allowed(p_org) or e.user_id = auth.uid())
     and (coalesce(btrim(p_query), '') = ''
          or lower(concat_ws(' ', e.first_name, e.middle_name, e.last_name, d.name, g.title)) like '%' || lower(btrim(p_query)) || '%')
   order by e.first_name, e.last_name
   limit least(greatest(coalesce(p_limit, 500), 1), 2000);
$$;
revoke all on function public.people_directory(uuid, text, integer) from public, anon;
grant execute on function public.people_directory(uuid, text, integer) to authenticated, service_role;
