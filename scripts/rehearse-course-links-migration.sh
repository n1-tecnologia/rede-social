#!/usr/bin/env bash
# rehearse-course-links-migration.sh — replay the 08.4 link move's migration chain from the 08.3 era
# on an edge fixture and prove every link and every gate answer survives (08.4-02, COURSE-08,
# COURSE-11, STORE-22; D-418, D-405; SC 4: "existing course and live links are carried over, and
# nothing that was locked or open before changes state").
#
# LOCAL STACK ONLY — it RESETS the local database twice. Every environment that applies the 08.4
# migrations applies the same chain in the same order, so this is the proof they inherit:
#
#   1. reset the local database to `20261014144554_courses_live_gate` — the last 08.3 version, where
#      `course_products` / `course_live_products` exist and the gate bodies read them — and give
#      `api_user` its local login back;
#   2. load `scripts/rehearsal/08.4-links-fixture.sql`: four tenants (A with every edge, B a mirror
#      with identical-looking titles, C with `store` off, D with `courses` off), links on both 08.3
#      tables — then snapshot every link into `rehearsal.links_before` and every gate answer, per
#      (tenant, user, claim), into `rehearsal.gate_before`;
#   3. `supabase migration up` applies the three 08.4 files in timestamp order: file 1
#      (`*_store_course_links.sql`, create-only), file 2 (`*_store_course_links_functions.sql`: the
#      carry-over, its guard, then the gate swap), file 3 (`*_drop_course_product_links.sql`, the
#      drop) — as every environment will;
#   4. run `scripts/rehearsal/08.4-links-assert.sql`, which raises unless every link is in the store
#      tables with its `created_at` and no other row is, every gate answer equals its snapshot, the
#      archived course and the cancelled live keep their links and stay locked for a non-holder,
#      tenants C and D answer `'{}'` in every lane, and neither 08.3 table exists;
#   5. on EXIT (pass or fail) restore the normal database: `pnpm db:reset && pnpm db:seed`.
#      `REHEARSAL_KEEP=1` skips the restore so a failed run can be inspected.
#
# `REHEARSAL_PLANT_MISMATCH=1` deletes the single store link of the fixture's one-product course C4
# between steps 3 and 4 — the scratch run that proves step 4 really fails (it must exit non-zero and
# name the differing gate answer).
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

echo "rehearsal: resetting to the 08.3 era (20261014144554_courses_live_gate)…"
bash scripts/supabase.sh db reset --version 20261014144554
bash scripts/db-local-role.sh

echo "rehearsal: loading the edge fixture and snapshotting every link and every gate answer…"
psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f scripts/rehearsal/08.4-links-fixture.sql

echo "rehearsal: applying the rest of the chain (create → copy and swap → drop)…"
bash scripts/supabase.sh migration up

if [ "${REHEARSAL_PLANT_MISMATCH:-0}" = "1" ]; then
  echo "rehearsal: PLANTING a mismatch — deleting the single store link of course C4 before the assertions"
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q -c \
    "delete from public.store_product_courses where course_id = '84a00000-0000-4000-8000-0000000000c4'"
fi

echo "rehearsal: asserting every link and every gate answer survived…"
psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f scripts/rehearsal/08.4-links-assert.sql
echo "rehearsal: PASS"
