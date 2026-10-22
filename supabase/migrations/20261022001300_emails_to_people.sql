-- PeopleCore · Emails to the person a thing is about (the in-app notification already goes out):
-- * decision: their leave, attendance correction, work from home or on duty request, or expense claim was approved or
--   rejected, with the approver's comment. Queued by triggers on the requests themselves, so it works however the
--   decision was made (the inbox, bulk approval, HR on someone's behalf). Nobody is emailed about their own decision.
-- * payslip: their payslip is ready (a link only; never figures in an email).
-- Both are on by default for every organization (employees expect them) and switched off in Settings › Notifications.

alter table public.notification_email_rules
  drop constraint notification_email_rules_event_check,
  add constraint notification_email_rules_event_check
    check (event in ('regularization', 'leave', 'expense', 'birthday', 'anniversary', 'helpdesk_reply', 'decision', 'payslip')),
  drop constraint notification_email_rules_audience_check,
  add constraint notification_email_rules_audience_check
    check (audience in ('owner', 'hr_admin', 'hr_executive', 'finance_admin', 'payroll_admin', 'line_manager', 'ticket_parties', 'self')),
  -- The person it's about is an audience of their own, for decisions and payslips only.
  add constraint notification_email_rules_self_check check ((event in ('decision', 'payslip')) = (audience = 'self'));

insert into public.notification_email_rules (organization_id, event, audience, enabled, updated_by)
select o.id, e.event, 'self', true, null from public.organizations o cross join (values ('decision'), ('payslip')) e (event)
on conflict do nothing;

create function app.seed_org_person_emails() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notification_email_rules (organization_id, event, audience, enabled, updated_by)
  values (new.id, 'decision', 'self', true, null), (new.id, 'payslip', 'self', true, null) on conflict do nothing;
  return null;
end $$;
revoke all on function app.seed_org_person_emails() from public;
create trigger organizations_seed_person_emails after insert on public.organizations
  for each row execute function app.seed_org_person_emails();

create function app.day_range(p_from date, p_to date) returns text
language sql immutable set search_path = '' as $$
  select case when p_from = p_to then to_char(p_from, 'FMDD Mon YYYY')
              else to_char(p_from, 'FMDD Mon YYYY') || ' to ' || to_char(p_to, 'FMDD Mon YYYY') end;
$$;
revoke all on function app.day_range(date, date) from public;

-- A side effect: a problem queueing the email never blocks the decision.
create function app.email_on_decision() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_user    uuid;
  v_word    text := case when new.status::text = 'approved' then 'approved' else 'rejected' end;
  v_what    text;
  v_subject text;
  v_link    text;
  v_comment text;
begin
  begin
    select user_id into v_user from public.employees where id = new.employee_id;
    if v_user is null or v_user = auth.uid() then return null; end if;
    if tg_table_name = 'leave_requests' then
      select format('%s (%s, %s day%s)', t.name, app.day_range(new.start_date, new.end_date), trim_scale(new.days), case when new.days = 1 then '' else 's' end)
        into v_what from public.leave_types t where t.id = new.leave_type_id;
      v_subject := format('Your leave was %s: %s', v_word, v_what);
      v_link := '/leave';
    elsif tg_table_name = 'regularization_requests' then
      v_what := 'attendance correction for ' || to_char(new.work_date, 'FMDD Mon YYYY');
      v_subject := format('Your %s was %s', v_what, v_word);
      v_link := '/attendance';
    elsif tg_table_name = 'attendance_requests' then
      v_what := format('%s request for %s', case when new.kind::text = 'wfh' then 'work from home' else 'on duty' end, app.day_range(new.start_date, new.end_date));
      v_subject := format('Your %s was %s', v_what, v_word);
      v_link := '/attendance';
    else
      v_what := format('expense claim “%s” (₹%s)', left(new.title, 100), to_char(new.total, 'FM99,99,99,990.00'));
      v_subject := format('Your %s was %s', v_what, v_word);
      v_link := '/expenses/' || new.id;
    end if;
    select nullif(btrim(a.comment), '') into v_comment
      from public.approval_actions a where a.request_id = new.approval_request_id order by a.acted_at desc limit 1;
    perform app.queue_user_email(new.organization_id, v_user, 'decision', 'self', left(v_subject, 200),
      format('Your %s was %s.', v_what, v_word) || coalesce(E'\n\nComment: ' || left(v_comment, 1000), ''), v_link);
  exception when others then null;
  end;
  return null;
end $$;
revoke all on function app.email_on_decision() from public;

create trigger leave_requests_decision_email after update of status on public.leave_requests
  for each row when (old.status = 'pending' and new.status in ('approved', 'rejected')) execute function app.email_on_decision();
create trigger regularization_requests_decision_email after update of status on public.regularization_requests
  for each row when (old.status = 'pending' and new.status in ('approved', 'rejected')) execute function app.email_on_decision();
create trigger attendance_requests_decision_email after update of status on public.attendance_requests
  for each row when (old.status = 'pending' and new.status in ('approved', 'rejected')) execute function app.email_on_decision();
create trigger expense_claims_decision_email after update of status on public.expense_claims
  for each row when (old.status = 'pending' and new.status in ('approved', 'rejected')) execute function app.email_on_decision();

-- Payslips: the in-app notice is the signal (whichever way the run was published); the email carries a link only.
create function app.email_on_payslip() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  begin
    perform app.queue_user_email(new.organization_id, new.user_id, 'payslip', 'self', new.title,
      new.title || '. Open PeopleCore to see it or download the PDF.', coalesce(new.link, '/payslips'));
  exception when others then null;
  end;
  return null;
end $$;
revoke all on function app.email_on_payslip() from public;
create trigger notifications_payslip_email after insert on public.notifications
  for each row when (new.kind = 'payroll.payslip') execute function app.email_on_payslip();
