# Runbook · Backups and restore

## What is backed up

- **Database (everything that matters):**
  - The live project uses Supabase's managed backups: daily backups on paid plans, and point-in-time recovery with the add-on.
  - Check the plan and retention in the Supabase dashboard under Database → Backups.
  - For a customer contract, enable point-in-time recovery and agree a recovery point objective, for example 5 minutes, and a recovery time objective, for example 4 hours.
- **Storage (employee documents, expense receipts):** not included in database backups.
  - Copy the buckets `employee-documents` and `expense-receipts` on a schedule with the S3-compatible API (Supabase → Storage → S3 access keys).
  - Use `rclone sync` or `aws s3 sync` to a bucket in another account, with versioning and object lock.
- **Secrets:** keys are not in backups. Keep them in a password manager or vault so a restored project can be wired up again: the Supabase keys, the SMTP password, the AI key, and the demo-account authenticator secrets for the test tenant only.

## Logical backup (on demand, e.g. before a risky migration)

From the repository root, with the project linked:

```sh
npx supabase db dump -f backup/schema.sql                      # schema (also in supabase/migrations)
npx supabase db dump --data-only --use-copy -f backup/data.sql  # data
npx supabase db dump --role-only -f backup/roles.sql            # custom roles, if any
```

The dump contains personal data. Store it encrypted, outside the repository, and delete it when you're done.

## Restore

**Into a new project** (a disaster, or a copy for an investigation). This is Supabase's documented order. Restore the schema from the dump rather than by running migrations: the migrations also seed reference rows (permissions, role templates, approval flows), and those would collide with the same rows in the data dump.

1. Create the Supabase project.
2. Restore the roles, schema and data in one transaction, with triggers off so audit rows aren't written twice:
   ```sh
   psql "$NEW_DB_URL" --single-transaction -v ON_ERROR_STOP=1 \
     -f backup/roles.sql -f backup/schema.sql -c 'set session_replication_role = replica' -f backup/data.sql
   ```
3. Record that the migrations are applied, or the next `db push` will try to run them all again:
   `npx supabase link --project-ref <new>`, then `npx supabase migration repair --status applied $(ls supabase/migrations | cut -d_ -f1)`.
4. Copy the storage buckets back. The database restore brings the object records, not the files.
5. Point the web app and the worker at the new project: URL, publishable and secret keys.
6. Set the Auth site URL, redirect URLs and SMTP again ([email.md](email.md)).
7. Verify: `verify:demo` against the demo tenant, then the browser journeys, then spot checks by an owner (headcount, the last payroll run, documents open).

**Point in time:** in the Supabase dashboard, go to Database → Backups → Point in time, and choose a time just before the incident. This restores the whole project in place, so everything after that time is lost: export what you need first.

**Over an existing, migrated database** (what the drill does): empty exactly the tables in the dump, then load it. Both steps run as a superuser with `session_replication_role = replica`. The audit log's append-only trigger refuses `TRUNCATE` otherwise, which is the protection working as intended.

## The drill

Run it quarterly, and after any change to the backup set-up.

**2026-10-18, local stack: passed.**
1. A data dump of the seeded demo tenant (`db dump --data-only --use-copy`): 145 tables, 205 MB including 303,172 audit rows, taken in 5 seconds.
2. `supabase db reset --local` wiped the database and applied all 38 migrations (29 s).
3. The 145 tables were emptied and the dump loaded as above: 4.9 s.
4. Row counts matched exactly for all 111 tables compared (`public`, `app`, `auth.users`, `auth.identities`, `auth.mfa_factors`, `storage.objects`).
5. `verify:demo` passed. 14 browser journeys passed on the restored data: documents, two-step sign-in with the restored authenticators, the audit log, payroll and AI.

Never run `db reset` with `--linked`: that resets the live project.
