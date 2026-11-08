-- PeopleCore · A course with lessons is complete only when its lessons are (audit LRN-01).
--
-- Learners could mark any course complete themselves. For a course with lessons, a completion the learner records is now
-- accepted only once every lesson is done (completing the last lesson still finishes the course by itself). HR or a
-- manager recording it for someone (classroom training, an outside certificate) is unchanged, as are courses without lessons.

create function app.completion_needs_lessons() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_total int;
  v_done  int;
begin
  if new.status = 'completed' and old.status is distinct from 'completed' and new.recorded_by is null then
    select count(*) into v_total from public.course_lessons where course_id = new.course_id;
    if v_total > 0 then
      select count(*) into v_done from public.lesson_progress p join public.course_lessons l on l.id = p.lesson_id
       where p.enrollment_id = new.id and l.course_id = new.course_id;
      if v_done < v_total then
        raise exception 'Finish the lessons first: % of % done.', v_done, v_total using errcode = '22023';
      end if;
    end if;
  end if;
  return new;
end $$;
create trigger course_enrollments_need_lessons before update of status on public.course_enrollments
  for each row execute function app.completion_needs_lessons();

revoke all on function app.completion_needs_lessons() from public;
