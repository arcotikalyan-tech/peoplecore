-- PeopleCore · Work-from-home and on-duty attendance statuses. On their own, because a new enum value can't be
-- used in the transaction that adds it (migration 20261019000100 uses them).
alter type public.attendance_status add value if not exists 'wfh';
alter type public.attendance_status add value if not exists 'on_duty';
