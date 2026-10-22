-- PeopleCore · Punches recorded by an attendance rule's automatic clock-in / clock-out (migration 20261021000600).
-- A new enum value can't be used in the transaction that adds it, so it gets its own migration.

alter type public.punch_method add value if not exists 'auto';
