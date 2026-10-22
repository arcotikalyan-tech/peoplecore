-- PeopleCore · "Transgender" as a gender on profiles (Kredily second pass, batch 3). A new enum value can't be used in
-- the transaction that adds it, so it gets its own migration.

alter type public.gender add value if not exists 'transgender' after 'male';
