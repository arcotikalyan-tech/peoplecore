# Runbook: the Hostinger server

PeopleCore's web app and worker run on the Hostinger VPS `187.127.120.22` (Ubuntu 24.04, 2 vCPU, 8 GB) as Docker
containers. The database stays on Supabase.

The machine is shared. EasyBooks owns the stack in `/opt/easybooks`, including the Caddy proxy
(`easybooks-proxy-1`) that answers on ports 80 and 443. Caddy loads one file per site from `/srv/caddy/sites/*.caddy`.
**Don't touch the other apps' containers or files.**

## Layout

| Path | What |
| --- | --- |
| `/opt/peoplecore/.env` | Runtime settings, mode 600: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (and `ANTHROPIC_API_KEY` once AI is on). |
| `/opt/peoplecore/src` | The source of the deployed commit (replaced on each deploy). |
| `/opt/peoplecore/docker-compose.yml` | Copied from `deploy/docker-compose.yml`. It defines the `web` and `worker` services. |
| `/opt/peoplecore/receive.sh` | Copy of `deploy/receive.sh`: the forced command for the GitHub deploy key. |
| `/srv/caddy/sites/hr.stepupp.in.caddy` | Copy of `deploy/hr.stepupp.in.caddy`. |

The web container publishes `172.18.0.1:3200`. That address is the bridge gateway of the `easybooks_default`
network, so the Caddy container can reach it and the internet cannot. Never publish on `0.0.0.0`: Docker-published
ports bypass ufw.

## Deploy

**Normally:** run Actions → Deploy. The workflow applies migrations, then the `server` job sends the commit's
source over SSH to `receive.sh`. That script builds both images on the server (about 6–8 minutes) and restarts the
containers.

The job needs these secrets on the `production` environment:
- `SERVER_HOST`
- `SERVER_SSH_KEY`: the private half of a key that `authorized_keys` restricts to
  `command="/opt/peoplecore/receive.sh",restrict`.
- `SERVER_KNOWN_HOSTS`: the output of `ssh-keyscan -t ed25519 187.127.120.22`.

**By hand:** copy the source to `/opt/peoplecore/src`, then run `bash /opt/peoplecore/src/deploy/deploy.sh <tag>`.

## Operate

```sh
cd /opt/peoplecore
docker compose ps
docker compose logs -f web      # or worker
docker compose restart worker
```

**Roll back:** each deploy tags its images with the commit. Run
`TAG=<older sha> docker compose up -d`. Old tags stay until removed with `docker image rm`.

**Caddy:** after changing a site file, reload with
`docker exec easybooks-proxy-1 caddy reload --config /etc/caddy/Caddyfile`. Certificates are issued automatically
once DNS points at the server.

The always-on worker replaces the scheduled GitHub Actions pass. `worker.yml` is now manual only.
