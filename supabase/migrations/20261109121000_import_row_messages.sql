-- Employee import: say what is wrong with a row. Anything outside a short list of errors became "This row could not be
-- imported.", hiding messages the database already writes for people (an employee code that differs only in capitals,
-- a reporting loop, the plan's employee limit) and every rule the list didn't name. Owner's report: "it says line 4,
-- not the actual issue". Messages raised by our own checks pass through; known rules get plain wording; anything else
-- shows the database's own reason rather than nothing.

create or replace function app.import_row_message(p_state text, p_constraint text, p_message text) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_state = '23505' then case p_constraint
      when 'employees_work_email_uq' then 'Another employee already uses this work email.'
      when 'employees_organization_id_employee_code_key' then 'This employee code is already in use.'
      when 'employees_organization_id_user_id_key' then 'That sign-in is already linked to another employee.'
      else 'This employee already exists.' end
    when p_state = '23514' then case p_constraint
      when 'employees_work_email_check' then 'Work email is not valid.'
      when 'employees_work_phone_check' then 'Work phone is not valid: use digits, spaces, - and an optional +, 7 to 20 characters.'
      when 'employees_employee_code_check' then 'Employee code may use letters, digits, / _ - (up to 30).'
      when 'employees_first_name_check' then 'First name is required (up to 100 characters).'
      when 'employees_middle_name_check' then 'Middle name is too long (up to 100 characters).'
      when 'employees_last_name_check' then 'Last name is too long (up to 100 characters).'
      when 'employees_job_title_check' then 'Job title must be 2 to 120 characters.'
      when 'employees_check' then 'An employee can’t be their own manager.'
      when 'employees_check1' then 'Date of exit can’t be before the date of joining.'
      when 'employees_check2' then 'Probation can’t end before the date of joining.'
      when 'employees_confirmed_after_joining' then 'Confirmation date can’t be before the date of joining.'
      when 'employees_prior_experience_months_check' then 'Prior experience must be 0 to 720 months.'
      else format('A value isn’t allowed (%s).', coalesce(p_constraint, p_message)) end
    when p_state = '23502' then
      coalesce('This value is required: ' || replace((regexp_match(p_message, 'column "([^"]+)"'))[1], '_', ' ') || '.', 'A required value is missing.')
    when p_state = '23503' then case
      when p_constraint like '%department%' then 'That department doesn’t exist in this organization.'
      when p_constraint like '%designation%' then 'That designation doesn’t exist in this organization.'
      when p_constraint like '%location%' then 'That location doesn’t exist in this organization.'
      when p_constraint like '%manager%' then 'That manager doesn’t exist in this organization.'
      else 'A value refers to something that doesn’t exist in this organization.' end
    when p_state = '22001' then 'A value is too long.'
    when p_state in ('22P02', '22007', '22008') then 'A value has the wrong format (dates are YYYY-MM-DD or DD/MM/YYYY).'
    -- Our own checks and triggers write their messages for people.
    when p_state in ('22023', 'P0001', '42501') then p_message
    else 'This row could not be imported: ' || coalesce(p_message, 'unknown reason') || '.'
  end;
$$;
