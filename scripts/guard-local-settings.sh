#!/usr/bin/env bash
# CI guard for the tenant lane (TENANT-03, plan 01-03, threat T-03-01).
#
# On the transaction pooler a non-LOCAL setting survives on the pooled server connection and the next
# request — possibly another tenant's — inherits it. Only `withTenantTx` / `withAdminTx` may touch
# roles or `request.jwt.claims`, and both must use LOCAL scope. This script fails the build when any
# TypeScript or SQL file under the scanned directories contains:
#   (a) set_config('request.jwt.claims', ..., false)   — session-scoped claims
#   (b) a `set role` / `SET ROLE` statement without the LOCAL keyword on the same line
#
# Usage: bash scripts/guard-local-settings.sh [dir ...]   (default: packages apps scripts)
# Exit 0 when clean, 1 when any offending line is found (lines are printed).
set -euo pipefail
cd "$(dirname "$0")/.."

if [ "$#" -gt 0 ]; then
  DIRS=("$@")
else
  DIRS=(packages apps scripts)
fi

SCAN=()
for dir in "${DIRS[@]}"; do
  [ -d "$dir" ] && SCAN+=("$dir")
done
if [ "${#SCAN[@]}" -eq 0 ]; then
  echo "guard:lanes: none of the directories exist: ${DIRS[*]}" >&2
  exit 1
fi

GREP=(grep -rEn --include='*.ts' --include='*.sql'
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.next --exclude-dir=.turbo)

# (a) session-scoped claims injection. POSIX classes only: must behave the same on GNU, BSD and ugrep.
NON_LOCAL_CLAIMS="$("${GREP[@]}" "set_config\('request\.jwt\.claims'[^)]*,[[:space:]]*false\)" "${SCAN[@]}" || true)"

# (b) a role switch statement that lacks the LOCAL keyword (case-insensitive; `reset role` does not match
#     because the character before `set` must not be a word character).
NON_LOCAL_ROLE="$("${GREP[@]}" -i "(^|[^[:alnum:]_])set[[:space:]]+role([^[:alnum:]_]|$)" "${SCAN[@]}" | grep -vi 'local' || true)"

STATUS=0
if [ -n "$NON_LOCAL_CLAIMS" ]; then
  echo "guard:lanes: set_config('request.jwt.claims', ..., false) is session-scoped and leaks across pooled transactions:" >&2
  printf '%s\n' "$NON_LOCAL_CLAIMS" >&2
  STATUS=1
fi
if [ -n "$NON_LOCAL_ROLE" ]; then
  echo "guard:lanes: role switch without LOCAL leaks the role to the next pooled transaction (use 'set local role'):" >&2
  printf '%s\n' "$NON_LOCAL_ROLE" >&2
  STATUS=1
fi

if [ "$STATUS" -ne 0 ]; then
  echo "guard:lanes: FAILED — every role switch and every request.jwt.claims injection must be LOCAL (packages/core/db/tenant-tx.ts)" >&2
  exit 1
fi
echo "guard:lanes: OK — no non-LOCAL role switch or session-scoped claims in ${SCAN[*]}"
exit 0
