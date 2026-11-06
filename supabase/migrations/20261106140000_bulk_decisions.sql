-- Bulk approvals in one request (audit WEB-01). "Approve all" and "Bulk approve" sent one request per item, up to 200 of
-- them across the distance to the database, so a month-end click was slow and could stop halfway. Each item still gets
-- its own all-or-nothing step: one that's refused is reported and the others go through.

create function public.decide_approvals(p_requests uuid[], p_decision text, p_comment text default null)
returns jsonb
language plpgsql volatile set search_path = '' as $$
declare
  v_id     uuid;
  v_ok     integer := 0;
  v_errors jsonb := '[]'::jsonb;
begin
  if coalesce(cardinality(p_requests), 0) > 200 then
    raise exception 'Decide at most 200 requests at a time.' using errcode = '22023';
  end if;
  foreach v_id in array coalesce(p_requests, '{}') loop
    begin
      perform public.decide_approval(v_id, p_decision, p_comment);
      v_ok := v_ok + 1;
    exception when others then
      -- Only our own messages (22023) are written for people; the caller words anything else.
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('id', v_id, 'code', sqlstate,
        'message', case when sqlstate = '22023' then sqlerrm end));
    end;
  end loop;
  return jsonb_build_object('decided', v_ok, 'errors', v_errors);
end $$;
revoke all on function public.decide_approvals(uuid[], text, text) from public, anon;
grant execute on function public.decide_approvals(uuid[], text, text) to authenticated, service_role;

-- Every submitted declaration of a year at the declared amounts. Runs as the person: they read what they may, and
-- review_tax_declaration decides.
create function public.approve_tax_declarations(p_org uuid, p_fy text)
returns jsonb
language plpgsql volatile set search_path = '' as $$
declare
  v_id     uuid;
  v_ok     integer := 0;
  v_errors jsonb := '[]'::jsonb;
begin
  for v_id in select d.id from public.tax_declarations d where d.organization_id = p_org and d.fy = p_fy and d.status = 'submitted' loop
    begin
      perform public.review_tax_declaration(v_id, true, '[]'::jsonb, 'Bulk approved');
      v_ok := v_ok + 1;
    exception when others then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('id', v_id, 'code', sqlstate,
        'message', case when sqlstate = '22023' then sqlerrm end));
    end;
  end loop;
  return jsonb_build_object('decided', v_ok, 'errors', v_errors);
end $$;
revoke all on function public.approve_tax_declarations(uuid, text) from public, anon;
grant execute on function public.approve_tax_declarations(uuid, text) to authenticated, service_role;
