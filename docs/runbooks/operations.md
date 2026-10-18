# Runbook · Operations

How PeopleCore runs in production, and what to do when something stops working. Security incidents are covered in
[incident-response.md](incident-response.md), backups in [backup-restore.md](backup-restore.md), and releases in
[deploy.md](deploy.md).

## What runs where

| Part | Where | Needs |
|---|---|---|
| Web app (`apps/web`, Next.js) | Vercel (or any Node 24 host) | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`; optional `ANTHROPIC_API_KEY` ([ai.md](ai.md)) |
| Database, Auth, Storage | Supabase project **Peoplecore** | Migrations from `supabase/migrations` |
| Worker (`apps/worker`) | An always-on Node process, **or** a scheduler running one pass every 5 minutes | `SUPABASE_URL`, `SUPABASE_SECRET_KEY` |
| Email | Supabase Auth over SMTP | [email.md](email.md) |

## The worker

The worker does everything that happens without a person clicking:
- leave accrual and attendance days;
- approval escalations, overdue reminders and helpdesk SLA checks;
- workflow steps;
- exits on the day after the last working day;
- data retention, including clearing AI prompts after 30 days;
- domain events (`event:*`).

**If the worker isn't running, none of this happens.** Nothing is lost while it's down: each job is keyed by hour or day, so the next pass catches up.

- **Always on:** `corepack pnpm --filter @peoplecore/worker start` (polls every `WORKER_POLL_MS`, default 5 s). Run one instance, or several: jobs are claimed with a lock (`locked_until`), and each runs once per idempotency key.
- **Scheduled:** `WORKER_ONCE=1 corepack pnpm --filter @peoplecore/worker start` every 5 minutes (a cron job, a GitHub Actions schedule, or a platform scheduler). Each pass enqueues the jobs that are due and runs a batch.

### Checking it

In the Supabase SQL editor:

```sql
-- Jobs that failed for good (after max_attempts), most recent first.
select kind, idempotency_key, attempts, last_error, finished_at from app.jobs where status = 'dead' order by finished_at desc limit 50;
-- Backlog: due but not done.
select kind, count(*) from app.jobs where status in ('queued', 'running') and run_at < now() - interval '15 minutes' group by kind;
-- Last successful pass per job kind.
select split_part(kind, ':', 1) as job, max(finished_at) from app.jobs where status = 'done' group by 1 order by 2;
```

A **dead** job keeps its `last_error`. Fix the cause, then queue it again:

```sql
update app.jobs set status = 'queued', attempts = 0, run_at = now() where id = <id>;
```

Each job is safe to run twice; that is what the idempotency keys and the database functions are for.

## Migrations

1. Every change is a new file in `supabase/migrations`. A migration already applied anywhere is never edited.
2. `corepack pnpm check` runs every migration against PGlite. The CI `e2e` job applies them all to a real local Supabase stack.
3. To apply to the live project, run `npx supabase db push --dry-run` and check the list, then `npx supabase db push`.
4. Afterwards, regenerate the types (`corepack pnpm --filter @peoplecore/db gen:types`) if they changed, and run the browser journeys against live: `corepack pnpm --filter @peoplecore/web test:e2e`.

Code that needs a new migration must ship after it. Ship in this order: migration, then web app, then worker.

## Common problems

| Symptom | Likely cause | What to do |
|---|---|---|
| Every page says Supabase isn't configured | Missing `NEXT_PUBLIC_SUPABASE_*` on the host | Set them and redeploy |
| HR, payroll or the owner see almost nothing | They signed in without two-step verification (aal1) | Expected: they are sent to `/mfa`. If an authenticator is lost, the platform admin resets it |
| "AI isn't set up on this server yet" | No `ANTHROPIC_API_KEY` | See [ai.md](ai.md) |
| "AI assistants are turned off" | The owner hasn't turned them on | AI assistants page (owner) |
| Leave balances not growing, exits not happening | The worker isn't running | See "The worker" above |
| A page is slow | See the load-test results in BUILD_STATUS.md; check `pg_stat_statements` in Supabase for the slowest queries | Add an index in a new migration |
| Emails don't arrive | SMTP not configured or rate-limited | [email.md](email.md) |
