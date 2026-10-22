-- PeopleCore · Konnect reads: threads and replies with their authors' names (colleagues can't read each other's
-- employee records, but a discussion shows who wrote what). Same visibility as the tables: members only, hidden posts
-- only to their author and moderators.

create function public.konnect_thread_list(p_org uuid, p_topic uuid default null, p_query text default null, p_limit integer default 50)
returns table (id uuid, topic_id uuid, title text, excerpt text, author_id uuid, author_name text, pinned boolean, locked boolean, hidden boolean,
               reply_count integer, like_count integer, liked boolean, mine boolean, last_activity_at timestamptz, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  with me as (select e.id from public.employees e where e.organization_id = p_org and e.user_id = auth.uid()),
  q as (select '%' || replace(replace(replace(btrim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pattern)
  select t.id, t.topic_id, t.title, left(t.body, 220), t.author_employee_id, app.person_name(t.author_employee_id), t.pinned, t.locked, t.hidden,
         t.reply_count, t.like_count,
         exists (select 1 from public.konnect_likes l where l.thread_id = t.id and l.employee_id in (select id from me)),
         t.author_employee_id in (select id from me), t.last_activity_at, t.created_at
    from public.konnect_threads t cross join q
   where t.organization_id = p_org and app.is_member(p_org)
     and (p_topic is null or t.topic_id = p_topic)
     and (not t.hidden or t.author_employee_id in (select id from me) or app.konnect_moderator(p_org))
     and (nullif(btrim(p_query), '') is null or t.title ilike q.pattern or t.body ilike q.pattern)
   order by t.pinned desc, t.last_activity_at desc
   limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;

create function public.konnect_thread_view(p_thread uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  t    public.konnect_threads;
  v_me uuid;
  v_mod boolean;
begin
  select * into t from public.konnect_threads where id = p_thread;
  if t.id is null or not app.is_member(t.organization_id) then return null; end if;
  select id into v_me from public.employees where organization_id = t.organization_id and user_id = auth.uid();
  v_mod := app.konnect_moderator(t.organization_id);
  if t.hidden and t.author_employee_id is distinct from v_me and not v_mod then return null; end if;
  return jsonb_build_object(
    'id', t.id, 'topic_id', t.topic_id, 'title', t.title, 'body', t.body, 'author_id', t.author_employee_id,
    'author_name', app.person_name(t.author_employee_id), 'pinned', t.pinned, 'locked', t.locked, 'hidden', t.hidden,
    'reply_count', t.reply_count, 'like_count', t.like_count, 'created_at', t.created_at, 'edited_at', t.edited_at,
    'mine', t.author_employee_id = v_me, 'moderator', v_mod,
    'liked', exists (select 1 from public.konnect_likes l where l.thread_id = t.id and l.employee_id = v_me),
    'replies', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'body', r.body, 'author_id', r.author_employee_id,
                                                             'author_name', app.person_name(r.author_employee_id), 'hidden', r.hidden,
                                                             'created_at', r.created_at, 'edited_at', r.edited_at, 'mine', r.author_employee_id = v_me)
                                          order by r.created_at)
                           from public.konnect_replies r
                          where r.thread_id = t.id and (not r.hidden or r.author_employee_id = v_me or v_mod)), '[]'::jsonb));
end $$;

revoke all on function public.konnect_thread_list(uuid, uuid, text, integer) from public, anon;
revoke all on function public.konnect_thread_view(uuid) from public, anon;
grant execute on function public.konnect_thread_list(uuid, uuid, text, integer) to authenticated, service_role;
grant execute on function public.konnect_thread_view(uuid) to authenticated, service_role;
