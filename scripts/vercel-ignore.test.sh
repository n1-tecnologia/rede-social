#!/usr/bin/env bash
# Routing test for the Vercel Ignored Build Step (quick 261002-f4y, docs/DEPLOY.md "Vercel project —
# `homolog`"). Two Vercel projects share this repository and apps/web/vercel.json: production
# (DEPLOY_ENV unset or `production`, Production Branch `master`) and homolog (DEPLOY_ENV=`homolog`,
# Production Branch `homolog`). This test proves that the COMMITTED ignoreCommand builds `homolog`
# only on the hml project, never on production, and otherwise delegates to
# `npx turbo-ignore` (no --fallback: no previous deployment means build).
#
# How: the ignoreCommand string is read from apps/web/vercel.json (never a copy) and run with
# `bash -c` from apps/web — the Root Directory Vercel runs it in — under a clean environment and a
# stub `npx` first on PATH. The stub records its cwd and argv and exits with STUB_EXIT (default 1).
# "delegated" means the stub ran exactly once, from apps/web, with `turbo-ignore` and no arguments.
#
# Output: TAP (`1..15`, then `ok N` / `not ok N`). Exits 1 when any case fails.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB="$ROOT/apps/web"
CMD="$(node -p 'require(process.argv[1]).ignoreCommand' "$WEB/vercel.json")"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin"
cat > "$TMP/bin/npx" <<'STUB'
#!/usr/bin/env bash
echo "$PWD|$*" >> "$NPX_LOG"
exit "${STUB_EXIT:-1}"
STUB
chmod +x "$TMP/bin/npx"

WANT_LOG="$WEB|turbo-ignore"
FAILED=0
N=0

# run_case <desc> <want_exit> <want_delegated yes|no> <extra-output ERE, case-insensitive, or ''> [VAR=value ...]
run_case() {
  local desc="$1" want_exit="$2" want_del="$3" want_out="$4"
  shift 4
  N=$((N + 1))
  local log="$TMP/npx.$N.log" out="$TMP/out.$N.txt"
  : > "$log"
  local code
  set +e
  (
    cd "$WEB" &&
      env -i HOME="$HOME" PATH="$TMP/bin:$PATH" NPX_LOG="$log" "$@" bash -c "$CMD"
  ) > "$out" 2>&1
  code=$?
  set -e

  local del="no" problems=""
  if [ -s "$log" ]; then
    del="yes"
    if [ "$(wc -l < "$log" | tr -d ' ')" != "1" ] || [ "$(cat "$log")" != "$WANT_LOG" ]; then
      problems="$problems npx call was '$(tr '\n' ';' < "$log")';"
    fi
  fi
  [ "$code" = "$want_exit" ] || problems="$problems want exit $want_exit, got $code;"
  [ "$del" = "$want_del" ] || problems="$problems want delegated=$want_del, got $del;"
  grep -q '^vercel-ignore:' "$out" || problems="$problems no 'vercel-ignore:' decision line;"
  if [ -n "$want_out" ] && ! grep -Eqi -- "$want_out" "$out"; then
    problems="$problems output lacks '$want_out';"
  fi

  if [ -z "$problems" ]; then
    echo "ok $N - $desc"
  else
    FAILED=1
    echo "not ok $N - $desc #$problems"
  fi
}

echo "1..15"
run_case "hml project, ref homolog, production -> builds" 1 yes "" \
  DEPLOY_ENV=homolog VERCEL_GIT_COMMIT_REF=homolog VERCEL_ENV=production
run_case "hml project, ref homolog, turbo-ignore skip passes through" 0 yes "" \
  DEPLOY_ENV=homolog VERCEL_GIT_COMMIT_REF=homolog VERCEL_ENV=production STUB_EXIT=0
run_case "hml project, ref master preview -> skip" 0 no "" \
  DEPLOY_ENV=homolog VERCEL_GIT_COMMIT_REF=master VERCEL_ENV=preview
run_case "hml project, ref feature/x preview -> skip" 0 no "" \
  DEPLOY_ENV=homolog VERCEL_GIT_COMMIT_REF=feature/x VERCEL_ENV=preview
run_case "hml project, ref unset -> skip" 0 no "" \
  DEPLOY_ENV=homolog
run_case "production project, ref master production -> builds" 1 yes "" \
  VERCEL_GIT_COMMIT_REF=master VERCEL_ENV=production
run_case "production project, ref master, turbo-ignore skip passes through" 0 yes "" \
  VERCEL_GIT_COMMIT_REF=master VERCEL_ENV=production STUB_EXIT=0
run_case "production project, PR preview feature/x -> builds as today" 1 yes "" \
  VERCEL_GIT_COMMIT_REF=feature/x VERCEL_ENV=preview
run_case "production project, ref homolog preview -> skip" 0 no "" \
  VERCEL_GIT_COMMIT_REF=homolog VERCEL_ENV=preview
run_case "production project, ref unset (CLI deploy) -> builds as today" 1 yes ""
run_case "DEPLOY_ENV=production, ref master -> builds" 1 yes "" \
  DEPLOY_ENV=production VERCEL_GIT_COMMIT_REF=master VERCEL_ENV=production
run_case "DEPLOY_ENV=production, ref homolog -> skip" 0 no "" \
  DEPLOY_ENV=production VERCEL_GIT_COMMIT_REF=homolog VERCEL_ENV=production
run_case "empty DEPLOY_ENV counts as unset, ref homolog preview -> skip" 0 no "" \
  DEPLOY_ENV= VERCEL_GIT_COMMIT_REF=homolog VERCEL_ENV=preview
run_case "DEPLOY_ENV unset, ref homolog production -> belt builds with a warning" 1 yes "warning.*DEPLOY_ENV" \
  VERCEL_GIT_COMMIT_REF=homolog VERCEL_ENV=production
run_case "unknown DEPLOY_ENV fails closed and names the value" 0 no "error.*staging" \
  DEPLOY_ENV=staging VERCEL_GIT_COMMIT_REF=master VERCEL_ENV=production

exit "$FAILED"
