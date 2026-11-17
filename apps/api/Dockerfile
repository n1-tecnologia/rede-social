# syntax=docker/dockerfile:1
#
# One image, three roles (D-18, D-544): `ROLE=api` serves Hono, `ROLE=worker` runs pg-boss
# (plan 01-07 adds the branch in src/main.ts), `ROLE=migrate` fans the migration sets out to every tenant
# project and exits (09.2-15). Build from the REPO ROOT:
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
# D-547: both migration sets and `roles.sql` plus a deterministic manifest, built here because this is the stage
# that has the whole repository (the pruned slice below holds no `supabase/` directory). The runtime stage copies
# the result to /app/migrations; `MIGRATIONS_DIR` points the API, the worker and the migrate role at it.
RUN node scripts/build-migrations-manifest.mjs --root /repo --out /repo/migrations-out

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
    ROLE=api \
    MIGRATIONS_DIR=/app/migrations
COPY --from=builder --chown=node:node /app /app
COPY --from=pruner --chown=node:node /repo/migrations-out /app/migrations
# D-863 (12.5): voice recordings are normalized by the worker's derive job, which spawns ffmpeg and ffprobe. They are
# a SYSTEM dependency (the signed Debian repository, approved by the owner on 2026-11-17), not an npm package. This is
# the one image of the api, worker and migrate roles (D-18, D-544), so the binaries land in all three. Installed as
# root, BEFORE `USER node`; the apt lists go in the same layer; the build log prints the installed versions. apt is not
# version-pinned on purpose (the Debian security channel moves the patch version): the version is recorded in the plan
# summary instead.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && ffmpeg -version | head -n 1 \
    && ffprobe -version | head -n 1
USER node
EXPOSE 8080
# Cloud Run sends SIGTERM; src/main.ts drains the server itself, so no init shim is needed.
CMD ["node", "dist/main.js"]
