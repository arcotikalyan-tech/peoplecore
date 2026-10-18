# Runbook · Deploying to production

Releases go through GitHub Actions. **CI** (`.github/workflows/ci.yml`) checks every push. It runs typecheck,
lint, unit, database and RLS tests, the production build, a dependency audit, and every browser journey against
a throwaway local Supabase. **Deploy** (`.github/workflows/deploy.yml`) is started by hand for a commit on `main`
that passed CI; it refuses anything else. It applies the migrations and then deploys the web app.

## One-time setup

1. **GitHub CLI scope.** Pushing workflow files needs the `workflow` scope: `gh auth refresh -h github.com -s workflow`.
2. **Environment.** In the repository settings, go to Environments and create `production`. Required reviewers need a paid GitHub plan for a private repository; without them, starting the Deploy run by hand is the approval.
3. **Secrets** on the `production` environment:

   | Secret | From |
   |---|---|
   | `SUPABASE_ACCESS_TOKEN` | supabase.com → Account → Access tokens |
   | `SUPABASE_DB_PASSWORD` | The project's database password |
   | `SUPABASE_PROJECT_REF` | `rncjncpazqxqkfqoumsk` (the project id in its URL) |
   | `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` | Vercel account token; `vercel link` writes the two ids to `.vercel/project.json` |

4. **Vercel project.** Root directory `apps/web`, Node 24. Set the environment variables:
   - Required: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`.
   - Optional: `ANTHROPIC_API_KEY` ([ai.md](ai.md)).
   - Never set `AI_PROVIDER=mock` in production (it is refused there anyway).
5. **Supabase Auth URLs.** Add the production URL as the site URL and `https://<domain>/auth/callback` as a redirect URL. Then configure SMTP ([email.md](email.md)).
6. **The worker.** `.github/workflows/worker.yml` runs one pass every 3 hours on GitHub Actions (to stay within the free plan's Actions minutes) once the `production` environment has the secrets `SUPABASE_URL` and `SUPABASE_SECRET_KEY`. For finer timing, run it on an always-on host instead ([operations.md](operations.md)).

Each Deploy job skips itself until its secrets exist, so the workflow is safe to merge before any of this.

## A release

1. Merge to `main` and wait for CI to pass.
2. Start Deploy: Actions → Deploy → Run workflow on `main`, or `gh workflow run Deploy --ref main`. To see which migrations it will apply first, run `npx supabase db push --dry-run` locally (the `migrate` job also prints the list before applying).
3. Migrations apply, then the web app is built and deployed (`vercel build`, then `deploy --prebuilt`).
4. After a release that changed migrations, run the browser journeys against production's demo tenant, or at least the smoke check: `verify:demo`.

## Rolling back

- **Web app:** in Vercel, promote the previous deployment. This is instant, but only safe while the database is still compatible with the old code.
- **Database:** migrations are not rolled back by tooling. Write a new migration that reverses the change, or restore a backup ([backup-restore.md](backup-restore.md)).
- Migrations should therefore be additive. Add columns, tables and functions first, and remove old ones in a later release, once no deployed code uses them.

## By hand (without Actions)

```sh
npx supabase db push --dry-run && npx supabase db push    # from the repository root, project linked
cd apps/web && npx vercel@61.1.0 deploy --prod
```
