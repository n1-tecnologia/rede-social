#!/usr/bin/env bash
# Local second database for the database-per-tenant proofs (Phase 09.2-02, Wave 0 spike S1, DBT-22/DBT-32).
#
# Creates `rede_tenant_b` INSIDE THE LOCAL STACK'S Postgres, gives it the Supabase platform schemas the
# tenant set depends on (auth, storage, realtime: a bare database does not have them) and applies the 146
# files of supabase/migrations to it through the SAME runner production uses (scripts/migrate-set.ts).
# That proves the runner, the second pool (plan 03) and the move tool (plan 22) without a second
# Supabase stack.
#
#   bash scripts/db-two-databases.sh                       create if absent, prepare, apply the tenant set
#   bash scripts/db-two-databases.sh --reset               drop, then as above
#   bash scripts/db-two-databases.sh --down                drop and exit
#   bash scripts/db-two-databases.sh --assert-no-platform  exit non-zero when `platform` or the central
#                                                          ledger exists in rede_tenant_b
#
# SAFETY (T-09.2-10): the host and the database are CONSTANTS below. There is no argument that names
# either, so this script cannot create, fill or drop anything on a hosted database.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
readonly HOST="127.0.0.1"
readonly PORT="54322"
readonly TARGET_DB="rede_tenant_b"
readonly ADMIN_URL="postgres://postgres:postgres@${HOST}:${PORT}/postgres"
readonly TARGET_URL="postgres://postgres:postgres@${HOST}:${PORT}/${TARGET_DB}"

# The three errors the platform-schema restore is KNOWN to raise (planner probe 2026-10-22). Anything
# else fails the script.
readonly KNOWN_ERRORS=(
  'permission denied to set parameter "log_min_messages"'
  'schema "app" does not exist'
  'function public.handle_new_user() does not exist'
)

MODE="up"
RESET="no"
for arg in "$@"; do
  case "$arg" in
    --reset) RESET="yes" ;;
    --down) MODE="down" ;;
    --assert-no-platform) MODE="assert" ;;
    *) echo "unknown flag: $arg (allowed: --reset, --down, --assert-no-platform)" >&2; exit 2 ;;
  esac
done

admin() { psql "$ADMIN_URL" -X -v ON_ERROR_STOP=1 -Atq "$@"; }
target() { psql "$TARGET_URL" -X -v ON_ERROR_STOP=1 -Atq "$@"; }
db_exists() { [ "$(admin -c "select count(*) from pg_database where datname = '${TARGET_DB}'")" = "1" ]; }

drop_db() {
  if db_exists; then
    admin -c "drop database \"${TARGET_DB}\" with (force)"
    echo "dropped ${TARGET_DB}"
  fi
}

if [ "$MODE" = "down" ]; then
  drop_db
  exit 0
fi

if [ "$MODE" = "assert" ]; then
  if ! db_exists; then
    echo "${TARGET_DB} does not exist" >&2
    exit 1
  fi
  found="$(target -c "select (to_regnamespace('platform') is not null or to_regclass('supabase_migrations.central_migrations') is not null)")"
  if [ "$found" = "t" ]; then
    echo "FAIL: schema platform or the central ledger exists in ${TARGET_DB}" >&2
    exit 1
  fi
  echo "ok: no platform schema and no central ledger in ${TARGET_DB}"
  exit 0
fi

if [ "$RESET" = "yes" ]; then
  drop_db
fi

if ! db_exists; then
  admin -c "create database \"${TARGET_DB}\""
  echo "created ${TARGET_DB}"
fi

# Prepare the Supabase platform schemas only on a database that does not carry them yet. A re-run on a
# complete (or half-applied) database goes straight to the runner, which is a no-op when nothing is pending.
if [ "$(target -c "select to_regnamespace('auth') is null")" = "t" ]; then
  target -c 'create schema if not exists extensions'
  for ext in pgcrypto '"uuid-ossp"' citext pg_trgm unaccent; do
    target -c "create extension if not exists ${ext} with schema extensions"
  done

  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  pg_dump "$ADMIN_URL" -s -n auth -n storage -n realtime --no-owner --no-privileges > "$tmp/platform.sql"

  # No ON_ERROR_STOP: three errors are expected (see KNOWN_ERRORS); every other error line fails below.
  psql "$TARGET_URL" -X -q -f "$tmp/platform.sql" > /dev/null 2> "$tmp/restore.err" || true
  unexpected=0
  while IFS= read -r line; do
    known=no
    for pattern in "${KNOWN_ERRORS[@]}"; do
      case "$line" in *"$pattern"*) known=yes ;; esac
    done
    if [ "$known" = "no" ]; then
      echo "unexpected restore error: $line" >&2
      unexpected=1
    fi
  done < <(grep 'ERROR:' "$tmp/restore.err" || true)
  if [ "$unexpected" = "1" ]; then
    echo "FAIL: the platform-schema restore raised an error outside the three known ones" >&2
    exit 1
  fi
  echo "platform schemas restored into ${TARGET_DB}"
fi

cd "$ROOT"
pnpm exec tsx scripts/migrate-set.ts --set tenant --url "$TARGET_URL"
