#!/usr/bin/env bash
# Deploys the current commit from this Mac straight to the Hostinger server (no GitHub deploy key needed).
#   deploy/ship.sh            # refuses unless the commit is pushed and CI passed on it
#   deploy/ship.sh --force    # skips the CI check (emergencies only)
# Database migrations are not applied here: they go through Actions → Deploy (its migrate job holds the
# database password). Ship code that needs a new migration only after Deploy has applied it.
set -euo pipefail
HOST="${PEOPLECORE_SERVER:-root@187.127.120.22}"
cd "$(git rev-parse --show-toplevel)"
SHA=$(git rev-parse HEAD)

[ -z "$(git status --porcelain)" ] || { echo "Uncommitted changes; commit first." >&2; exit 1; }
if [ "${1:-}" != "--force" ]; then
  git fetch -q origin main
  [ "$(git rev-parse origin/main)" = "$SHA" ] || { echo "HEAD is not origin/main; push first." >&2; exit 1; }
  # Asks the Actions API by workflow file and commit (`gh run list --commit` sometimes returns nothing for a run that
  # exists), a few times before giving up.
  ok=0
  for _ in 1 2 3; do
    ok=$(gh api "repos/{owner}/{repo}/actions/workflows/ci.yml/runs?head_sha=$SHA" --jq '[.workflow_runs[] | select(.conclusion == "success")] | length' 2>/dev/null || echo 0)
    [ "$ok" -gt 0 ] && break
    sleep 3
  done
  [ "$ok" -gt 0 ] || { echo "CI has not passed on ${SHA:0:7} yet." >&2; exit 1; }
  pending=$(cd supabase/migrations && ls | sort | tail -1)
  echo "Latest migration in this commit: $pending (must already be applied by Deploy)."
fi

echo "Shipping ${SHA:0:7} to ${HOST}..."
git archive --format=tar.gz HEAD | ssh "$HOST" "set -e; cd /opt/peoplecore; rm -rf src.new && mkdir src.new && tar -xzf - -C src.new; rm -rf src.old; [ -d src ] && mv src src.old; mv src.new src; bash src/deploy/deploy.sh ${SHA:0:12}"
curl -fsS -o /dev/null -w "https://hrms.tazq.io/login → %{http_code}\n" https://hrms.tazq.io/login || true
