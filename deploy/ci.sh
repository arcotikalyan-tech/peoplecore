# Sourced by ship.sh and publish-android.sh: refuses unless HEAD is origin/main and CI passed on it.
require_green_main() {
  local sha ok=0
  sha=$(git rev-parse HEAD)
  git fetch -q origin main
  [ "$(git rev-parse origin/main)" = "$sha" ] || { echo "HEAD is not origin/main; push first." >&2; exit 1; }
  # Asks the Actions API by workflow file and commit (`gh run list --commit` sometimes returns nothing for a run that
  # exists), a few times before giving up.
  for _ in 1 2 3; do
    ok=$(gh api "repos/{owner}/{repo}/actions/workflows/ci.yml/runs?head_sha=$sha" --jq '[.workflow_runs[] | select(.conclusion == "success")] | length' 2>/dev/null || echo 0)
    [ "$ok" -gt 0 ] && break
    sleep 3
  done
  [ "$ok" -gt 0 ] || { echo "CI has not passed on ${sha:0:7} yet." >&2; exit 1; }
}
