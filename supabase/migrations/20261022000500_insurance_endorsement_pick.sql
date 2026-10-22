-- Insurance (Kredily second pass, batch 4): HR picks which pending changes go into an endorsement (the rest stay
-- pending for the next one); employees no longer receive the CD account figures with their policy; CD ledger entries
-- link to an endorsement of the same organization only.

-- ─── Lock only the chosen changes ───────────────────────────────────────────

drop function public.lock_insurance_endorsement(uuid);

-- p_keys: the roster keys (insurance_endorsement.key) of the additions and deletions to send; null sends them all.
-- The new snapshot is the last one plus the chosen additions, minus the chosen deletions, so changes left out show
-- up again in the next endorsement.
create function public.lock_insurance_endorsement(p_org uuid, p_keys text[] default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  -- The chosen keys as a set (jsonb object), so large rosters stay quick; null means every change.
  v_pick   jsonb := case when p_keys is not null
                      then (select coalesce(jsonb_object_agg(k, true), '{}'::jsonb) from unnest(p_keys) k where k is not null) end;
  v_last   jsonb;
  v_roster jsonb;
  v_add    int;
  v_del    int;
begin
  if not app.has_permission(p_org, 'insurance.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select count(*) filter (where e.change = 'addition' and (v_pick is null or v_pick ? e.key)),
         count(*) filter (where e.change = 'deletion' and (v_pick is null or v_pick ? e.key))
    into v_add, v_del
    from public.insurance_endorsement(p_org) e;
  if v_add + v_del = 0 then
    if v_pick is not null and exists (select 1 from public.insurance_endorsement(p_org) e where e.change in ('addition', 'deletion')) then
      raise exception 'Choose at least one change for this endorsement.' using errcode = '22023';
    end if;
    raise exception 'Nothing has changed since the last endorsement.' using errcode = '22023';
  end if;
  select roster into v_last from public.insurance_syncs where organization_id = p_org order by synced_at desc limit 1;
  with cur as (
    select r.key, jsonb_build_object('employee_id', r.employee_id, 'employee_code', r.employee_code,
             'employee_name', r.employee_name, 'member_name', r.member_name, 'relationship', r.relationship) as info
      from app.insurance_roster(p_org) r)
  select coalesce(jsonb_object_agg(s.key, s.info), '{}'::jsonb) into v_roster from (
    -- Members insured now who were already sent, plus the chosen additions (or every addition).
    select cur.key, cur.info from cur
     where v_pick is null or coalesce(v_last ? cur.key, false) or v_pick ? cur.key
    union all
    -- Members sent before and since removed, whose deletion was left for a later endorsement.
    select x.key, x.value from jsonb_each(coalesce(v_last, '{}'::jsonb)) x
     where v_pick is not null and not (v_pick ? x.key) and not exists (select 1 from cur where cur.key = x.key)
  ) s;
  insert into public.insurance_syncs (organization_id, roster, additions, deletions) values (p_org, v_roster, v_add, v_del);
  return jsonb_build_object('additions', v_add, 'deletions', v_del);
end $$;

revoke all on function public.lock_insurance_endorsement(uuid, text[]) from public, anon;
grant execute on function public.lock_insurance_endorsement(uuid, text[]) to authenticated, service_role;

-- ─── Employees see the policy without the CD account figures ────────────────

create or replace function public.my_insurance(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_emp    uuid;
  v_policy jsonb;
begin
  select id into v_emp from public.employees where organization_id = p_org and user_id = auth.uid() and app.is_member(p_org);
  if v_emp is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.insurance_coverage where employee_id = v_emp and covered) then
    return jsonb_build_object('covered', false);
  end if;
  select to_jsonb(p) - 'organization_id' - 'hidden_fields' - 'updated_at' - 'premium_per_life' - 'cd_low_balance'
         - coalesce(p.hidden_fields, '{}') into v_policy
    from public.insurance_policies p where p.organization_id = p_org;
  return jsonb_build_object('covered', true, 'policy', v_policy,
    'members', coalesce((select jsonb_agg(jsonb_build_object('name', r.member_name, 'relationship', r.relationship, 'dateOfBirth', r.date_of_birth,
                                                             'sumInsured', r.sum_insured, 'effective', r.effective))
                           from app.insurance_roster(p_org) r where r.employee_id = v_emp), '[]'::jsonb));
end $$;

-- ─── CD entries point at an endorsement of their own organization ──────────

alter table public.insurance_syncs add constraint insurance_syncs_org_id_key unique (organization_id, id);
alter table public.insurance_cd_entries
  drop constraint insurance_cd_entries_sync_id_fkey,
  add constraint insurance_cd_entries_sync_fkey foreign key (organization_id, sync_id)
    references public.insurance_syncs (organization_id, id) on delete set null (sync_id);
