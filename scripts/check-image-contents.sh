#!/usr/bin/env bash
# Asserts that the migrations directory the API image will carry is complete and deterministic (Phase 09.2-15,
# D-547, DBT-44, T-09.2-73). It runs the same script the Dockerfile runs, into a temporary directory, and checks
# the layout the Dockerfile copies to /app/migrations:
#
#   - tenant/ and central/ hold exactly the repository's migration files (counts equal), byte for byte
#   - roles.sql is present, and manifest.json parses, lists every file sorted by version, with a sha256 each
#   - no absolute path and no timestamp inside the manifest
#   - building twice yields identical output (P87)
#   - the Dockerfile builds the manifest, copies it to /app/migrations and sets MIGRATIONS_DIR
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail() { echo "check-image-contents: FAIL: $*" >&2; exit 1; }

node "$ROOT/scripts/build-migrations-manifest.mjs" --root "$ROOT" --out "$TMP/one" > /dev/null
node "$ROOT/scripts/build-migrations-manifest.mjs" --root "$ROOT" --out "$TMP/two" > /dev/null

# Idempotency: two builds, identical bytes everywhere.
diff -r "$TMP/one" "$TMP/two" > /dev/null || fail "two builds of the same files differ"

# Counts and bytes equal the repository's.
repo_tenant="$(find "$ROOT/supabase/migrations" -maxdepth 1 -name '[0-9]*_*.sql' | wc -l | tr -d ' ')"
repo_central="$(find "$ROOT/supabase/central/migrations" -maxdepth 1 -name '[0-9]*_*.sql' | wc -l | tr -d ' ')"
img_tenant="$(find "$TMP/one/tenant" -maxdepth 1 -name '*.sql' | wc -l | tr -d ' ')"
img_central="$(find "$TMP/one/central" -maxdepth 1 -name '*.sql' | wc -l | tr -d ' ')"
[ "$repo_tenant" -gt 0 ] || fail "the repository has no tenant migration"
[ "$repo_tenant" = "$img_tenant" ] || fail "tenant files: repository $repo_tenant, image $img_tenant"
[ "$repo_central" = "$img_central" ] || fail "central files: repository $repo_central, image $img_central"
for f in "$TMP"/one/tenant/*.sql; do
  cmp -s "$f" "$ROOT/supabase/migrations/$(basename "$f")" || fail "tenant file differs: $(basename "$f")"
done
for f in "$TMP"/one/central/*.sql; do
  cmp -s "$f" "$ROOT/supabase/central/migrations/$(basename "$f")" || fail "central file differs: $(basename "$f")"
done
[ -s "$TMP/one/roles.sql" ] || fail "roles.sql is missing or empty"
cmp -s "$TMP/one/roles.sql" "$ROOT/supabase/roles.sql" || fail "roles.sql differs"

# The manifest: parses, sorted, one sha256 per file, no absolute path, no timestamp.
node - "$TMP/one/manifest.json" "$img_tenant" "$img_central" <<'NODE'
const [, , file, tenantCount, centralCount] = process.argv;
const fs = require('node:fs');
const text = fs.readFileSync(file, 'utf8');
const m = JSON.parse(text);
const bad = (why) => { console.error(`check-image-contents: FAIL: manifest ${why}`); process.exit(1); };
if (m.tenant.length !== Number(tenantCount)) bad('tenant count');
if (m.central.length !== Number(centralCount)) bad('central count');
for (const set of [m.tenant, m.central]) {
  for (let i = 0; i < set.length; i += 1) {
    const e = set[i];
    if (!/^\d{14}$/.test(e.version) || !/^[0-9a-f]{64}$/.test(e.sha256)) bad('entry shape');
    if (i > 0 && !(set[i - 1].version < e.version)) bad('not sorted by version');
  }
}
if (!/^[0-9a-f]{64}$/.test(m.roles.sha256)) bad('roles hash');
if (/(\/Users\/|\/home\/|\/repo\b|\/tmp\/|[A-Za-z]:\\)/.test(text)) bad('holds an absolute path');
if (/\d{4}-\d{2}-\d{2}T/.test(text)) bad('holds a timestamp');
NODE

# The Dockerfile builds it, copies it where MIGRATIONS_DIR points, and sets the variable.
DOCKERFILE="$ROOT/apps/api/Dockerfile"
grep -q "build-migrations-manifest" "$DOCKERFILE" || fail "the Dockerfile does not build the manifest"
grep -q "/app/migrations" "$DOCKERFILE" || fail "the Dockerfile does not copy to /app/migrations"
grep -q "MIGRATIONS_DIR=/app/migrations" "$DOCKERFILE" || fail "the Dockerfile does not set MIGRATIONS_DIR"

echo "check-image-contents: ok ($img_tenant tenant, $img_central central, roles.sql, manifest)"
