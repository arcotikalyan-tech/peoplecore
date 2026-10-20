#!/usr/bin/env bash
# Forced command for the GitHub deploy key (authorized_keys: command="/opt/peoplecore/receive.sh",restrict).
# Reads a gzipped source tarball on stdin and deploys it. The only argument accepted is the commit SHA.
set -euo pipefail
TAG="${SSH_ORIGINAL_COMMAND:-}"
[[ "$TAG" =~ ^[0-9a-f]{7,40}$ ]] || { echo "usage: ssh deploy@host <commit-sha> < source.tgz" >&2; exit 2; }
cd /opt/peoplecore
rm -rf src.new && mkdir src.new
tar -xzf - -C src.new
rm -rf src.old && { [ -d src ] && mv src src.old || true; } && mv src.new src
exec bash src/deploy/deploy.sh "${TAG:0:12}"
