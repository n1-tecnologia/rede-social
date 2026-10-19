#!/usr/bin/env bash
# Dashboard fixture guard (08.7-12, D-459, INSIGHT-17, EP-58, T-08.7-26) — runs after
# `check-ui-literals.sh` from the root `lint` script.
#
# Since phase 08.7 every number the owner's and the member's panels show is the tenant's own, read
# from the daily snapshot through the API. "No sample value at runtime" is a gate, not a hope: this
# script fails the lint when any TRACKED file under `apps/web` imports from
# `@rede-social/module-dashboard/fixtures` or names the removed member sample module
# (`member-activity-sample`), except:
#   - tests: `*.test.ts`, `*.test.tsx` (a fixture is a fine test input);
#   - `apps/web/e2e/**` (Playwright fixtures);
#   - `apps/web/components/platform/preview/**` (the super_admin's preview keeps a preview-only
#     sample, UI-D-489 e).
#
# Why a script and not a Biome override (08.7-12 planning decision 3): a second `noRestrictedImports`
# override on `apps/web/**` would REPLACE, not merge, the web's existing import restrictions.
#
# Why `git grep` (EP-58): it reads the whole tracked tree in one pass, independent of file order and
# of turbo's task cache, so adding the import to any one runtime file makes `pnpm lint` exit non-zero
# whatever else turbo replayed from its cache.
#
# Usage:
#   bash scripts/check-dashboard-fixtures.sh              exit 0 when clean, 1 with every file:line
#   bash scripts/check-dashboard-fixtures.sh --self-test  the negative control: copies one runtime
#     file into a throwaway repository, appends a fixture import, tracks it (and a copy named as a
#     test), and runs the SAME grep (pattern and exclusions) on it. Exits 1 when the guard bites
#     (the expected outcome), 0 when it does not find the planted import (the guard is broken), 2
#     when the copy planted in a test file is reported (the exclusions are broken).
set -euo pipefail
cd "$(dirname "$0")/.."

PATTERN='@rede-social/module-dashboard/fixtures|member-activity-sample'
PATHSPEC=(
  'apps/web'
  ':(exclude,glob)apps/web/**/*.test.ts'
  ':(exclude,glob)apps/web/**/*.test.tsx'
  ':(exclude)apps/web/e2e'
  ':(exclude)apps/web/components/platform/preview'
)

# The one grep both modes run, over the tracked files of the repository it is run in.
scan() {
  git grep -n -E "$PATTERN" -- "${PATHSPEC[@]}"
}

if [ "${1:-}" = "--self-test" ]; then
  SOURCE='apps/web/components/dashboard/format.ts'
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  mkdir -p "$TMP/apps/web/components/dashboard"
  cp "$SOURCE" "$TMP/apps/web/components/dashboard/probe.ts"
  printf "\nimport { tenantOwnerPanel } from '@rede-social/module-dashboard/fixtures';\n" \
    >>"$TMP/apps/web/components/dashboard/probe.ts"
  cp "$TMP/apps/web/components/dashboard/probe.ts" "$TMP/apps/web/components/dashboard/probe.test.ts"
  # A throwaway repository of its own, so the probe files are TRACKED exactly as in the real run.
  git -C "$TMP" init -q
  git -C "$TMP" add -A

  set +e
  HITS="$(cd "$TMP" && scan)"
  set -e
  if printf '%s\n' "$HITS" | grep -q 'probe\.test\.ts'; then
    echo "dashboard fixtures self-test: BROKEN — a test file was reported:" >&2
    printf '%s\n' "$HITS" >&2
    exit 2
  fi
  if printf '%s\n' "$HITS" | grep -q 'components/dashboard/probe\.ts:'; then
    echo "dashboard fixtures self-test: the guard bites — a runtime import of a fixture fails the lint:"
    printf '%s\n' "$HITS"
    exit 1
  fi
  echo "dashboard fixtures self-test: BROKEN — the planted runtime import was not found" >&2
  exit 0
fi

set +e
HITS="$(scan)"
STATUS=$?
set -e
if [ "$STATUS" -eq 0 ]; then
  echo "dashboard fixtures: a runtime web file imports a dashboard fixture or the member sample (D-459):" >&2
  printf '%s\n' "$HITS" >&2
  exit 1
fi
if [ "$STATUS" -ne 1 ]; then
  echo "dashboard fixtures: git grep failed (exit $STATUS)" >&2
  exit "$STATUS"
fi
echo "dashboard fixtures: no runtime import"
