-- PeopleCore · Leave operations, part 1: enum values (a new enum value can't be used in the migration that adds it).
--
-- * Accrual can now run quarterly or half-yearly (yearly = granted upfront at the start of the leave year).
-- * Ledger rows for attendance/HR penalties, peer-to-peer donation and encashment.
-- * Approval steps can go to the subject's manager's manager (skip-level approval).

alter type public.accrual_period add value if not exists 'quarterly' before 'yearly';
alter type public.accrual_period add value if not exists 'half_yearly' before 'yearly';
alter type public.leave_entry_kind add value if not exists 'penalty';
alter type public.leave_entry_kind add value if not exists 'donation';
alter type public.leave_entry_kind add value if not exists 'encashment';
alter type public.approver_rule add value if not exists 'skip_level_manager';
