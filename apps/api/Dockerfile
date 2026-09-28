# syntax=docker/dockerfile:1
#
# One image, two Cloud Run services (D-18): `ROLE=api` serves Hono, `ROLE=worker` runs pg-boss
# (plan 01-07 adds the branch in src/main.ts). Build from the REPO ROOT:
#   docker build -f apps/api/Dockerfile -t rede-social-api:local .
#
# Stages: prune the monorepo to @rede-social/api's slice -> install + build -> ship dist + production deps
# under a non-root user. `pnpm install --frozen-lockfile` is the supply-chain gate (T-09-05).

FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
# `packageManager` in package.json pins pnpm 12.4.1; corepack installs exactly that version.
RUN corepack enable

# ── prune ────────────────────────────────────────────────────────────────────
# Keeps only @rede-social/api and its workspace dependencies, plus a lockfile pruned to match.
FROM base AS pruner
WORKDIR /repo
COPY . .
RUN pnpm dlx turbo@2.10.12 prune @rede-social/api --docker

# ── build ────────────────────────────────────────────────────────────────────
# out/json holds the package.json files (+ lockfile, .npmrc, pnpm-workspace.yaml) so the install
# layer is cached until a manifest changes; out/full adds the sources.
FROM base AS builder
WORKDIR /repo
COPY --from=pruner /repo/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /repo/out/full/ .
RUN pnpm turbo build --filter=@rede-social/api...
# tsup bundles every @rede-social/* source into dist/, so only third-party production deps are shipped.
RUN pnpm deploy --filter=@rede-social/api --prod --legacy /app

# ── runtime ──────────────────────────────────────────────────────────────────
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    ROLE=api
COPY --from=builder --chown=node:node /app /app
USER node
EXPOSE 8080
# Cloud Run sends SIGTERM; src/main.ts drains the server itself, so no init shim is needed.
CMD ["node", "dist/main.js"]
