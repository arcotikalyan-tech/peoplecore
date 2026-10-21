# PeopleCore on a server: two images from one build.
#   docker build --target web    -t peoplecore-web    --build-arg NEXT_PUBLIC_SUPABASE_URL=… --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=… .
#   docker build --target worker -t peoplecore-worker .
# Runtime secrets (SUPABASE_SECRET_KEY, ANTHROPIC_API_KEY) come from the environment at run time, never the image.
# See docs/runbooks/server.md.

FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY . .
# Only what the web app and the worker need (the mobile app's toolchain stays out).
RUN pnpm install --frozen-lockfile --filter "@peoplecore/web..." --filter "@peoplecore/worker..."

FROM deps AS build
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
RUN test -n "$NEXT_PUBLIC_SUPABASE_URL" && test -n "$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
RUN NEXT_OUTPUT=standalone pnpm --filter @peoplecore/web exec next build

FROM node:24-slim AS web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]

FROM deps AS worker
ENV NODE_ENV=production
RUN chown -R node:node /repo
USER node
WORKDIR /repo/apps/worker
CMD ["node", "src/index.ts"]
