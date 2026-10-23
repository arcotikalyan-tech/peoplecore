#!/usr/bin/env bash
# Builds and (re)starts PeopleCore on the server from the source tree in /opt/peoplecore/src.
# Usage on the server: /opt/peoplecore/src/deploy/deploy.sh <tag>
set -euo pipefail
TAG="${1:-latest}"
cd /opt/peoplecore
set -a; . ./.env; set +a
docker build --target web -t "peoplecore-web:$TAG" -t peoplecore-web:latest \
  --build-arg NEXT_PUBLIC_SUPABASE_URL --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY src
docker build --target worker -t "peoplecore-worker:$TAG" -t peoplecore-worker:latest src
cp src/deploy/docker-compose.yml docker-compose.yml
TAG="$TAG" DEPLOYED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)" docker compose up -d --remove-orphans
for i in $(seq 1 30); do
  curl -fsS -o /dev/null http://172.18.0.1:3200/login && { echo "web up ($TAG)"; break; }
  sleep 2
done
curl -fsS -o /dev/null http://172.18.0.1:3200/login
