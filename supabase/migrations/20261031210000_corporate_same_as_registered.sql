-- Corporate office "same as registered office" (Company › Address). The corporate row keeps a copy of the registered
-- office's address and follows it whenever the registered office changes, so whatever reads addresses (ID cards,
-- letters) needs no change. Removing the registered office leaves the corporate office with the last copy as its own.
-- company_addresses already has table-wide grants, which cover the new column.

alter table public.company_addresses
  add column same_as_registered boolean not null default false check (not same_as_registered or kind = 'corporate');

-- Before a corporate row is written: copy the registered office's lines (also fills them on insert, before the
-- not-null and length checks run).
create function app.company_address_copy_registered() returns trigger
language plpgsql set search_path = '' as $$
declare r public.company_addresses;
begin
  select * into r from public.company_addresses where organization_id = new.organization_id and kind = 'registered';
  if not found then
    raise exception 'Add the registered office first.' using errcode = '22023';
  end if;
  new.line1 := r.line1; new.line2 := r.line2; new.city := r.city; new.state := r.state; new.country := r.country; new.pincode := r.pincode;
  return new;
end $$;
revoke all on function app.company_address_copy_registered() from public;
create trigger company_addresses_copy_registered before insert or update on public.company_addresses
  for each row when (new.kind = 'corporate' and new.same_as_registered) execute function app.company_address_copy_registered();

-- After the registered office changes or goes: bring a corporate office that follows it up to date, or let it go.
create function app.company_address_follow_registered() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    update public.company_addresses set same_as_registered = false
     where organization_id = old.organization_id and kind = 'corporate' and same_as_registered;
    return null;
  end if;
  update public.company_addresses
     set line1 = new.line1, line2 = new.line2, city = new.city, state = new.state, country = new.country, pincode = new.pincode
   where organization_id = new.organization_id and kind = 'corporate' and same_as_registered;
  return null;
end $$;
revoke all on function app.company_address_follow_registered() from public;
create trigger company_addresses_follow_registered after update or delete on public.company_addresses
  for each row when (old.kind = 'registered') execute function app.company_address_follow_registered();
