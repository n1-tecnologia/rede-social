#!/usr/bin/env bash
# MOD-02 negative check: `pnpm boundaries:negative`.
#
# A rule nobody ever violates is indistinguishable from a rule that stopped working. This script
# makes the module boundary falsifiable by running BOTH enforcement layers against
# `packages/boundary-fixture`, a module-tagged package that violates all three lanes on purpose, and
# requiring BOTH to reject it:
#
#   layer 1 — `turbo boundaries`: package-graph tags (a `module` may not depend on an `app`, on
#             another module, or on anything it did not declare)
#   layer 2 — Biome `noRestrictedImports`, from the PROJECT'S OWN biome.json (the fixture is held to
#             the same `packages/modules/**` lane rules as a real module — the negative check
#             exercises the real configuration, never a copy of it)
#
# Exit 0 only when both rejected. If either one goes green, the fixture stopped being a violation or
# the layer stopped enforcing — both are MOD-02 regressions, and the message says which.
#
# `-e` is deliberately absent: the expected outcome of both commands is a NON-ZERO exit.
set -uo pipefail
cd "$(dirname "$0")/.."

FIXTURE="packages/boundary-fixture"
STATUS=0

echo "boundaries:negative: expecting BOTH layers to reject @rede-social/boundary-fixture"

pnpm turbo boundaries --filter=@rede-social/boundary-fixture > /tmp/gsd-boundaries-turbo.log 2>&1
TURBO_RC=$?
if [ "$TURBO_RC" -ne 0 ]; then
  echo "  [ok]   turbo boundaries correctly rejected the fixture (exit $TURBO_RC)"
else
  echo "  [FAIL] turbo boundaries ACCEPTED @rede-social/boundary-fixture — the package-graph layer is not enforcing." >&2
  echo "         Check turbo.json 'boundaries.tags' and ${FIXTURE}/turbo.json ('tags': ['module'])." >&2
  cat /tmp/gsd-boundaries-turbo.log >&2
  STATUS=1
fi

# `--config-path=.` pins the ROOT biome.json: this must be the real project configuration, not a
# fixture-local copy, or the check proves nothing about what a real module is held to.
pnpm biome lint --config-path=. "${FIXTURE}/src" > /tmp/gsd-boundaries-biome.log 2>&1
BIOME_RC=$?
if [ "$BIOME_RC" -ne 0 ] && grep -q "noRestrictedImports" /tmp/gsd-boundaries-biome.log; then
  echo "  [ok]   biome noRestrictedImports correctly rejected the fixture (exit $BIOME_RC)"
elif [ "$BIOME_RC" -ne 0 ]; then
  # Non-zero for some OTHER reason (a config error, or "no files were processed") is a false green.
  echo "  [FAIL] biome failed on @rede-social/boundary-fixture, but not with noRestrictedImports —" >&2
  echo "         the import lanes were never evaluated. This is a false negative, not a pass." >&2
  cat /tmp/gsd-boundaries-biome.log >&2
  STATUS=1
else
  echo "  [FAIL] biome ACCEPTED ${FIXTURE}/src — the import-lane layer is not enforcing." >&2
  echo "         Check the 'packages/modules/**' + 'packages/boundary-fixture/**' override in biome.json." >&2
  cat /tmp/gsd-boundaries-biome.log >&2
  STATUS=1
fi

if [ "$STATUS" -ne 0 ]; then
  echo "boundaries:negative: FAILED — a module boundary is no longer build-failing (MOD-02)." >&2
  exit 1
fi
echo "boundaries:negative: OK — both layers reject a module that crosses a boundary"
exit 0
