#!/usr/bin/env bash
# Vercel Ignored Build Step for apps/web (quick 261002-f4y). apps/web/vercel.json runs it as
# `bash ../../scripts/vercel-ignore.sh` from the Root Directory (apps/web).
#
# Two Vercel projects share this repository and the same vercel.json:
#   - production: DEPLOY_ENV unset (or `production`), Production Branch `master`;
#   - homolog (hml): DEPLOY_ENV=`homolog` on every environment, Production Branch `homolog`.
# Vercel's contract: exit 0 CANCELS the build, exit 1 BUILDS. When this script decides "build
# check", it execs `npx turbo-ignore` and passes its exit code through, so turbo-ignore can still
# skip an unaffected commit. No `--fallback`: turbo-ignore compares against the project's last
# deployment (VERCEL_GIT_PREVIOUS_SHA) and, when there is none (a new project such as hml's first
# build), it BUILDS. The old `--fallback=HEAD^1` compared against the parent commit instead, which
# cancelled every first build and every push whose last commit did not touch apps/web.
#
# Decision table (DEPLOY_ENV x VERCEL_GIT_COMMIT_REF):
#   homolog       ref homolog -> turbo-ignore;  any other ref -> skip
#   production    ref homolog -> skip;          any other ref -> turbo-ignore
#   unset/empty   ref homolog -> skip, EXCEPT with VERCEL_ENV=production -> warn + turbo-ignore;
#                 any other ref -> turbo-ignore (production PR previews and CLI deploys as before)
#   anything else -> error + skip (fail closed)
#
# The belt (DEPLOY_ENV unset, ref homolog, VERCEL_ENV=production): only the project whose
# Production Branch is `homolog` can produce that combination — the production project builds ref
# `homolog` as a Preview, never as Production — so building there is safe, and it keeps the hml
# production build alive if DEPLOY_ENV is missing or not visible to this step. The warning tells
# you to set DEPLOY_ENV=homolog on the hml project.
#
# The Preview guard (2026-10-06): before a "build check" of a PREVIEW (VERCEL_ENV=preview), the
# variables apps/web/lib/env.ts requires at build time (API_URL, NEXT_PUBLIC_SUPABASE_URL,
# NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) must be set; when one is missing the build could only fail
# on that validation, so it is skipped instead, naming the missing variables (never a value). This
# is what a feature branch meets on the hml project while DEPLOY_ENV is not set on its Preview
# environment (its build variables exist on Production only): a Canceled preview instead of a
# failed one. Production builds (any other VERCEL_ENV) never go through this guard.
#
# Every run prints one `vercel-ignore:` decision line to the build log. Nothing secret is logged.
# See docs/DEPLOY.md "Vercel project — `homolog`".
set -euo pipefail

REF="${VERCEL_GIT_COMMIT_REF:-}"
DEPLOY="${DEPLOY_ENV:-}"
VENV="${VERCEL_ENV:-}"

decide() {
  echo "vercel-ignore: DEPLOY_ENV=${DEPLOY:-unset} ref=${REF:-unset} VERCEL_ENV=${VENV:-unset} -> $1"
}

# The names of the build-time variables (apps/web/lib/env.ts) this environment lacks, comma-separated;
# empty when all are set. An empty value counts as unset, as `emptyStringAsUndefined` reads it.
missing_build_env() {
  local name missing=""
  for name in API_URL NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY; do
    if [ -z "${!name:-}" ]; then missing="${missing:+$missing,}$name"; fi
  done
  printf '%s' "$missing"
}

build() {
  if [ "$VENV" = "preview" ]; then
    local missing
    missing="$(missing_build_env)"
    if [ -n "$missing" ]; then
      decide "skip (Preview without its build environment: $missing unset)"
      exit 0
    fi
  fi
  decide "build check (turbo-ignore)"
  exec npx turbo-ignore
}

skip() {
  decide "skip"
  exit 0
}

case "$DEPLOY" in
  homolog)
    if [ "$REF" = "homolog" ]; then build; else skip; fi
    ;;
  production)
    if [ "$REF" = "homolog" ]; then skip; else build; fi
    ;;
  "")
    if [ "$REF" = "homolog" ]; then
      if [ "$VENV" = "production" ]; then
        echo "vercel-ignore: warning: DEPLOY_ENV is unset on a production build of ref homolog;" \
          "building it, but set DEPLOY_ENV=homolog on the hml Vercel project (all environments)." >&2
        build
      fi
      skip
    fi
    build
    ;;
  *)
    echo "vercel-ignore: error: unknown DEPLOY_ENV '$DEPLOY' (expected homolog, production or unset); skipping." >&2
    skip
    ;;
esac
