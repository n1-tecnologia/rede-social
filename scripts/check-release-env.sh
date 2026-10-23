#!/usr/bin/env bash
# Release preflight (plan 09.2-16, DBT-26, P55, T-09.2-81).
#
# Why: a production process refuses the fake project provider (`assertProductionEnv`, plan 12), the migrate
# Job and both services need the platform keyring, the central session URL, the organisation slug and the
# auth SMTP password, and a Cloud Run revision whose Secret Manager secret is missing fails AFTER the
# migrations and the auth configuration were applied. This script runs BEFORE any migration, collects EVERY
# missing item and fails once with one message that names them all, instead of one late failure at a time.
#
# What it checks (logical name -> where it must exist):
#   SUPABASE_ORG_SLUG        GitHub environment variable (non-empty)
#   PLATFORM_MASTER_KEYS     Secret Manager  platform-master-keys-<sfx>   (an enabled version)
#   MIGRATION_DATABASE_URL   Secret Manager  migration-database-url-<sfx> (an enabled version)
#   PROJECT_AUTH_SMTP_PASS   Secret Manager  resend-smtp-pass-<sfx>       (an enabled version)
# <sfx> is `prod` for --env prod (default) and `hml` for --env hml.
#
# It never reads or prints a secret VALUE: Secret Manager is asked only for the names of enabled versions.
# When the deploy account may not list versions (PERMISSION_DENIED) the item cannot be verified, which is a
# warning and not a failure: the workflow must not report a secret missing that merely cannot be seen
# (grant `roles/secretmanager.viewer` to the deploy service account, docs/DEPLOY.md, plan 25 gate G2).
#
# Usage:  bash scripts/check-release-env.sh [--env prod|hml]        real run (workflow step)
#         RELEASE_ENV_FIXTURE=<file> bash scripts/check-release-env.sh   no network, no gcloud
#         bash scripts/check-release-env.sh --self-test               empty / partial / complete fixtures
# Env (real run): SUPABASE_ORG_SLUG, GCP_PROJECT_ID; gcloud authenticated (google-github-actions/auth).
# Fixture file: one logical name per line, `NAME` or `NAME=value` means present, `NAME=` (empty) means
#               unset, `#` starts a comment.
# Exit:   0 nothing missing   1 at least one item missing (all listed)   2 usage error or no gcloud
set -euo pipefail

self="$0"
mode_selftest=0
env_name="prod"
while [ $# -gt 0 ]; do
  case "$1" in
    --self-test) mode_selftest=1 ;;
    --env)
      shift
      env_name="${1:-}"
      ;;
    *)
      echo "check-release-env: unknown argument: $1" >&2
      exit 2
      ;;
  esac
  shift || true
done

case "$env_name" in
  prod | hml) ;;
  *)
    echo "check-release-env: --env must be 'prod' or 'hml'" >&2
    exit 2
    ;;
esac

if [ "$mode_selftest" = "1" ]; then
  work="$(mktemp -d)"
  trap 'rm -rf "$work"' EXIT
  fail=0
  names="PLATFORM_MASTER_KEYS MIGRATION_DATABASE_URL SUPABASE_ORG_SLUG PROJECT_AUTH_SMTP_PASS"

  : > "$work/empty"
  if RELEASE_ENV_FIXTURE="$work/empty" bash "$self" --env "$env_name" > "$work/empty.out" 2>&1; then
    echo "self-test FAILED: the empty fixture passed the preflight" >&2
    fail=1
  else
    for n in $names; do
      if ! grep -q "$n" "$work/empty.out"; then
        echo "self-test FAILED: the empty fixture's message does not name $n" >&2
        fail=1
      fi
    done
  fi

  # A name present with an EMPTY value is the same as unset (P55): only the empty one is reported.
  printf '%s\n' 'SUPABASE_ORG_SLUG=acme' 'MIGRATION_DATABASE_URL=x' 'PROJECT_AUTH_SMTP_PASS=x' 'PLATFORM_MASTER_KEYS=' > "$work/partial"
  if RELEASE_ENV_FIXTURE="$work/partial" bash "$self" --env "$env_name" > "$work/partial.out" 2>&1; then
    echo "self-test FAILED: an empty PLATFORM_MASTER_KEYS passed the preflight" >&2
    fail=1
  elif ! grep -q "PLATFORM_MASTER_KEYS" "$work/partial.out" || grep -q "MIGRATION_DATABASE_URL" "$work/partial.out"; then
    echo "self-test FAILED: the partial fixture must name PLATFORM_MASTER_KEYS and only it" >&2
    fail=1
  fi

  printf '%s\n' '# a complete release' 'SUPABASE_ORG_SLUG=acme' 'PLATFORM_MASTER_KEYS=x' 'MIGRATION_DATABASE_URL=x' 'PROJECT_AUTH_SMTP_PASS=x' > "$work/complete"
  if ! RELEASE_ENV_FIXTURE="$work/complete" bash "$self" --env "$env_name" > "$work/complete.out" 2>&1; then
    echo "self-test FAILED: the complete fixture did not pass the preflight" >&2
    cat "$work/complete.out" >&2
    fail=1
  fi

  if [ "$fail" -ne 0 ]; then exit 1; fi
  echo "check-release-env self-test: ok (empty, partial and complete fixtures)"
  exit 0
fi

sfx="$env_name"
missing=""
missing_count=0
add_missing() {
  missing="${missing}  - $1"$'\n'
  missing_count=$((missing_count + 1))
}

fixture="${RELEASE_ENV_FIXTURE:-}"
if [ -n "$fixture" ] && [ ! -f "$fixture" ]; then
  echo "check-release-env: fixture not found: $fixture" >&2
  exit 2
fi

fixture_has() {
  tr -d '\r' < "$fixture" | grep -Eq "^$1(=.+)?\$"
}

# check_var <logical name> <where it must be set>
check_var() {
  local name="$1" where="$2"
  if [ -n "$fixture" ]; then
    fixture_has "$name" || add_missing "$name ($where)"
  elif [ -z "${!name:-}" ]; then
    add_missing "$name ($where)"
  fi
}

# check_secret <logical name> <Secret Manager name>
check_secret() {
  local name="$1" sm="$2" out rc
  if [ -n "$fixture" ]; then
    fixture_has "$name" || add_missing "$name (Secret Manager secret '$sm' with an enabled version)"
    return 0
  fi
  out="$(gcloud secrets versions list "$sm" --project "$GCP_PROJECT_ID" --filter='state=enabled' --limit=1 --format='value(name)' 2>&1)" && rc=0 || rc=$?
  if [ "$rc" -ne 0 ]; then
    if printf '%s' "$out" | grep -qiE 'NOT_FOUND|was not found|not found'; then
      add_missing "$name (Secret Manager secret '$sm' does not exist)"
    else
      echo "::warning::Could not verify Secret Manager secret '$sm' for $name (the deploy service account may lack roles/secretmanager.viewer); not counted as missing."
    fi
  elif [ -z "$out" ]; then
    add_missing "$name (Secret Manager secret '$sm' has no enabled version)"
  fi
}

if [ -z "$fixture" ]; then
  if ! command -v gcloud > /dev/null 2>&1; then
    echo "check-release-env: gcloud is not installed on this runner" >&2
    exit 2
  fi
  if [ -z "${GCP_PROJECT_ID:-}" ]; then
    echo "check-release-env: GCP_PROJECT_ID is not set" >&2
    exit 2
  fi
fi

check_var SUPABASE_ORG_SLUG "GitHub environment variable; the Supabase organisation slug the project provider creates projects in"
check_secret PLATFORM_MASTER_KEYS "platform-master-keys-$sfx"
check_secret MIGRATION_DATABASE_URL "migration-database-url-$sfx"
check_secret PROJECT_AUTH_SMTP_PASS "resend-smtp-pass-$sfx"

if [ "$missing_count" -gt 0 ]; then
  echo "::error::Release preflight failed: $missing_count item(s) missing. Create them, then re-run (docs/DEPLOY.md, plan 09.2-25). Nothing was migrated."
  printf '%s' "$missing" >&2
  exit 1
fi

echo "Release preflight passed ($env_name): the organisation slug and the three release secrets are present."
