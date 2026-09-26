#!/usr/bin/env bash
# rehearse-highlights-migration.sh — replay the pin retirement's migration chain from the pins era on
# an edge fixture and prove no pin is lost (05.2-11, HIGHLIGHT-05, D-116, roadmap criterion 5).
#
# LOCAL STACK ONLY — it RESETS the local database twice. Every environment provisioned later
# (Phase 01.1) applies the same chain in the same order, so this is the proof they inherit:
#
#   1. reset the local database to the pins-era version (the `story_community_pins` migration, the
#      last one before migration file 1) and give `api_user` its local login back;
#   2. load `scripts/rehearsal/05.2-pins-fixture.sql`: two tenants, a story pinned to TWO
#      communities, an EXPIRED pinned story, a SOFT-DELETED pinned story, a pin in an ARCHIVED
#      community, a community with NO pins — then snapshot every pin into `rehearsal.pins_before`;
#   3. `supabase migration up`: migration file 1 (the pin → `Destaques` backfill and its guard),
#      `story_views`, then migration file 2 (the drop) — in timestamp order, as every environment will;
#   4. run `scripts/rehearsal/05.2-pins-assert.sql`, which raises on any lost, merged or invented
#      item, a highlight on the no-pin community, an unreachable expired story, or a surviving pin
#      table, and prints both count tables;
#   5. on EXIT (pass or fail) restore the normal database: `pnpm db:reset && pnpm db:seed`.
#      `REHEARSAL_KEEP=1` skips the restore so a failed run can be inspected.
#
# `REHEARSAL_PLANT_MISMATCH=1` deletes one migrated item between steps 3 and 4 — the scratch run that
# proves step 4 really fails (it must exit non-zero).
#
# If an API process is running, restart it afterwards: each reset recreates `api_user`, and pg-boss
# loses its authentication.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DB_URL="postgres://postgres:postgres@127.0.0.1:54322/postgres"

restore() {
  local status=$?
  if [ "${REHEARSAL_KEEP:-0}" = "1" ]; then
    echo "rehearsal: REHEARSAL_KEEP=1 — the rehearsal database is left as it is (exit ${status})"
    return
  fi
  echo "rehearsal: restoring the normal database (pnpm db:reset && pnpm db:seed)…"
  pnpm db:reset >/dev/null && pnpm db:seed >/dev/null
  echo "rehearsal: normal seeded database restored (rehearsal exit ${status})"
}
trap restore EXIT

echo "rehearsal: resetting to the pins era…"
bash scripts/supabase.sh db reset --version 20260924022607
bash scripts/db-local-role.sh

echo "rehearsal: loading the edge fixture and snapshotting every pin…"
psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f scripts/rehearsal/05.2-pins-fixture.sql

echo "rehearsal: applying the rest of the chain (file 1 → story_views → file 2)…"
bash scripts/supabase.sh migration up

if [ "${REHEARSAL_PLANT_MISMATCH:-0}" = "1" ]; then
  echo "rehearsal: PLANTING a mismatch — deleting one migrated item before the assertions"
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q -c \
    "delete from public.story_highlight_items where id = (select id from public.story_highlight_items order by added_at limit 1)"
fi

echo "rehearsal: asserting no pin was lost…"
psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f scripts/rehearsal/05.2-pins-assert.sql
echo "rehearsal: PASS"
