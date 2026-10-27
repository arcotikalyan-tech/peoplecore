-- PeopleCore · A receipt has to be a real file.
--
-- add_expense_item treated any 64-character fingerprint as a receipt, so calling it directly (not through the app,
-- which stores the file first) passed "needs a receipt" with nothing attached. The file must now be in the
-- expense-receipts bucket under the item's path, stored in the last 15 minutes, as with check-in selfies.

create or replace function public.add_expense_item(
  p_claim uuid, p_id uuid, p_category uuid, p_date date, p_amount numeric,
  p_merchant text default null, p_description text default null,
  p_receipt_name text default null, p_receipt_hash text default null, p_subcategory text default null
) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_claim public.expense_claims := app.own_draft_claim(p_claim);
  v_cat   public.expense_categories;
  v_path  text;
begin
  select * into v_cat from public.expense_categories where id = p_category and organization_id = v_claim.organization_id and is_active;
  if v_cat.id is null then
    raise exception 'Choose a category.' using errcode = '22023';
  end if;
  if nullif(btrim(p_subcategory), '') is not null and not (btrim(p_subcategory) = any (v_cat.subcategories)) then
    raise exception 'Choose one of the sub-categories of %.', v_cat.name using errcode = '22023';
  end if;
  if p_date > app.org_today(v_claim.organization_id) then
    raise exception 'Expenses can’t be dated in the future.' using errcode = '22023';
  end if;
  if p_date < app.org_today(v_claim.organization_id) - 180 then
    raise exception 'Claim expenses within 180 days.' using errcode = '22023';
  end if;
  if v_cat.max_per_item is not null and p_amount > v_cat.max_per_item then
    raise exception '% items are limited to ₹%.', v_cat.name, trim_scale(v_cat.max_per_item) using errcode = '22023';
  end if;
  if v_cat.requires_receipt and p_receipt_hash is null then
    raise exception '% needs a receipt.', v_cat.name using errcode = '22023';
  end if;
  if p_receipt_hash is not null then
    v_path := v_claim.organization_id || '/' || v_claim.id || '/' || p_id;
    -- The receipt must really be there: the app server stores it under this path just before this call.
    if p_receipt_hash !~ '^[0-9a-f]{64}$' or not exists (
         select 1 from storage.objects o
          where o.bucket_id = 'expense-receipts' and o.name = v_path and o.created_at > now() - interval '15 minutes') then
      raise exception 'The receipt didn’t arrive. Please attach it again.' using errcode = '22023';
    end if;
  end if;
  insert into public.expense_items (id, organization_id, claim_id, category_id, expense_date, merchant, description, amount,
                                    receipt_path, receipt_name, receipt_hash, subcategory)
  values (p_id, v_claim.organization_id, p_claim, p_category, p_date, nullif(btrim(p_merchant), ''), nullif(btrim(p_description), ''),
          round(p_amount, 2), v_path, p_receipt_name, p_receipt_hash, nullif(btrim(p_subcategory), ''));
  update public.expense_claims set total = (select coalesce(sum(amount), 0) from public.expense_items where claim_id = p_claim) where id = p_claim;
  return v_path;
end $$;
