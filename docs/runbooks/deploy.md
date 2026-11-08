# Runbook · Deploying to production

Production runs on the Hostinger server ([server.md](server.md)): the web app and the worker as Docker containers
behind the shared Caddy, with the live database on Supabase. A release goes out from this Mac in three steps, always
in this order, and only for a commit on `main` whose CI passed.

1. **CI** (`.github/workflows/ci.yml`) checks every push: typecheck, lint, unit, database and RLS tests, the
   production build, a dependency audit, and every browser journey against a throwaway local Supabase (about 45 min).
2. **Database migrations**, when the commit adds any. Normally Actions → Deploy (its `migrate` job holds the database
   password; it refuses a commit that didn't pass CI). While the `production` environment's Supabase token needs
   renewing, apply them from the repository root on the Mac, where the project is linked (`supabase/.temp`):

   ```sh
   npx --no-install supabase db push --remote --dry-run   # check the list
   npx --no-install supabase db push --remote --yes
   ```

3. **Web app and worker:** `deploy/ship.sh` from a clean checkout of `main` at that commit. It refuses uncommitted
   changes and commits whose CI didn't pass, prints the newest migration in the commit (which must already be
   applied), sends the source to `/opt/peoplecore/src`, builds both images on the server (6–8 minutes), restarts
   the containers and checks `/login`. If it shows nothing new for more than about 10 minutes, the server may already
   be done: check the running container's version before waiting longer.
4. **Phone app**, when the commit changes it: `deploy/publish-android.sh` ([android-app.md](android-app.md)), after
   the website is live. Installed apps offer the update from Home.

Migrations first, then the website, then the phone: new code may need the new schema, and a published phone version
can't be withdrawn (Android refuses a lower version code).

## One-time setup

1. **Server:** see [server.md](server.md) (Docker, Caddy, `/opt/peoplecore/.env`, SSH from this Mac).
2. **GitHub `production` environment** secrets for Deploy's migrate job: `SUPABASE_ACCESS_TOKEN` (supabase.com →
   Account → Access tokens), `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF`. The environment's own copies override the
   repository's: renew with `gh secret set SUPABASE_ACCESS_TOKEN --env production`.
3. **Supabase Auth URLs:** the production URL as the site URL and `https://<domain>/auth/callback` as a redirect URL;
   then email ([email.md](email.md)).

Deploy also has a `web` job for Vercel. It skips itself without Vercel secrets, and production doesn't use it.

## Rolling back

- **Web app and worker:** each deploy tags its images with the commit. On the server,
  `TAG=<older sha> docker compose up -d` ([server.md](server.md)). A weekly cleanup (Sundays 03:30 IST) keeps the
  running version and the two before it; for anything older, check out that commit and run `deploy/ship.sh --force`.
  Only safe while the database is still compatible with the old code.
- **Database:** migrations aren't rolled back by tooling. Write a new migration that reverses the change, or restore
  a backup ([backup-restore.md](backup-restore.md)). Keep migrations additive: add first, remove in a later release.
- **Phone app:** can't be rolled back; publish a fixed version.
