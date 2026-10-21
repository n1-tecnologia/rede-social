#!/usr/bin/env bash
# Own cases of scripts/guard-auth-hooks.sh (plan 09.1-18, PAY-28, WR-02, D-495, P64-P66).
#
# The guard reads supabase/config.toml and refuses a hosted environment that would silently inherit
# the base Auth hook blocks (enabled locally), and an enabled hook whose function no migration
# defines. This test proves it on fixture configs written to a temp dir (CONFIG_TOML and
# MIGRATIONS_DIR point at them) and once on the committed config against the repo's real migrations.
#
# Output: TAP (`ok N - ...` / `not ok N - ...`, then `1..N`). Exits 1 when any case fails.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GUARD="$ROOT/scripts/guard-auth-hooks.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

FAILED=0
N=0
CN=0
CASE=""

# new_case: a fresh fixture dir with an empty migrations folder; sets CASE.
new_case() {
  CN=$((CN + 1))
  CASE="$TMP/case.$CN"
  mkdir -p "$CASE/migrations"
}

# fn_migration <schema> <function>: a fixture migration that defines the function.
fn_migration() {
  printf 'create or replace function %s.%s(event jsonb)\nreturns jsonb language sql as $$ select event $$;\n' \
    "$1" "$2" > "$CASE/migrations/20260101000000_$2.sql"
}

# run_case <desc> <want_exit> <regex|''> [more regexes; a leading ! means the output must NOT match]
# Runs the guard against $CASE/config.toml and $CASE/migrations (stdout and stderr together).
run_case() {
  local desc="$1" want_exit="$2"
  shift 2
  N=$((N + 1))
  local out="$CASE/out.txt" code problems="" re
  set +e
  CONFIG_TOML="$CASE/config.toml" MIGRATIONS_DIR="$CASE/migrations" bash "$GUARD" > "$out" 2>&1
  code=$?
  set -e
  [ "$code" = "$want_exit" ] || problems="$problems want exit $want_exit, got $code;"
  for re in "$@"; do
    [ -n "$re" ] || continue
    if [ "${re#!}" != "$re" ]; then
      if grep -Eq -- "${re#!}" "$out"; then problems="$problems output matches '${re#!}';"; fi
    else
      grep -Eq -- "$re" "$out" || problems="$problems output lacks '$re';"
    fi
  done
  report "$desc" "$problems"
}

report() {
  if [ -z "$2" ]; then
    echo "ok $N - $1"
  else
    FAILED=1
    echo "not ok $N - $1 #$2"
  fi
}

# A well-formed remote: both hook tables explicit (disabled).
good_remote() {
  cat <<EOF

[remotes.$1]
project_id = "ref$1"

[remotes.$1.auth.hook.before_user_created]
enabled = false
uri = "pg-functions://postgres/public/hook_before_user_created_allowlist"

[remotes.$1.auth.hook.custom_access_token]
enabled = false
uri = "pg-functions://postgres/public/hook_custom_access_token_allowlist"
EOF
}

BASE_CONFIG='[auth.hook.before_user_created]
enabled = true
uri = "pg-functions://postgres/public/hook_before_user_created_allowlist"

[auth.hook.custom_access_token]
enabled = true
uri = "pg-functions://postgres/public/hook_custom_access_token_allowlist"
'

# 1. The committed config against the repo's real migrations.
N=$((N + 1))
out_real="$TMP/real.txt"
set +e
(cd "$ROOT" && bash "$GUARD") > "$out_real" 2>&1
code_real=$?
set -e
problems=""
[ "$code_real" = "0" ] || problems="$problems want exit 0, got $code_real;"
grep -Eq '^guard:hooks: ok' "$out_real" || problems="$problems no ok line;"
grep -Eq 'remotes: .*production' "$out_real" || problems="$problems ok line does not name production;"
report "the committed config passes against the real migrations" "$problems"

# 2. A remote with no hook tables names the remote and both hooks.
new_case
{ printf '%s' "$BASE_CONFIG"; printf '\n[remotes.homolog]\nproject_id = "abc"\n'; } > "$CASE/config.toml"
fn_migration public hook_before_user_created_allowlist
fn_migration public hook_custom_access_token_allowlist
run_case "a remote without hook tables fails and names the remote and both hooks" 1 \
  'remote homolog hook before_user_created' 'remote homolog hook custom_access_token'

# 3. Only one of the two present: only the missing one is named.
new_case
{
  printf '%s' "$BASE_CONFIG"
  printf '\n[remotes.homolog]\nproject_id = "abc"\n\n[remotes.homolog.auth.hook.before_user_created]\nenabled = false\nuri = "pg-functions://postgres/public/hook_before_user_created_allowlist"\n'
} > "$CASE/config.toml"
run_case "only the missing hook block is named" 1 \
  'remote homolog hook custom_access_token' '!remote homolog hook before_user_created'

# 4. A hook table without enabled.
new_case
{
  printf '%s' "$BASE_CONFIG"
  printf '\n[remotes.homolog]\nproject_id = "abc"\n\n[remotes.homolog.auth.hook.before_user_created]\nuri = "pg-functions://postgres/public/hook_before_user_created_allowlist"\n\n[remotes.homolog.auth.hook.custom_access_token]\nenabled = false\nuri = "pg-functions://postgres/public/hook_custom_access_token_allowlist"\n'
} > "$CASE/config.toml"
run_case "a hook table without enabled fails naming the remote, the hook and the key" 1 \
  'remote homolog hook before_user_created: .*enabled' '!remote homolog hook custom_access_token'

# 5. A hook table without uri.
new_case
{
  printf '%s' "$BASE_CONFIG"
  printf '\n[remotes.homolog]\nproject_id = "abc"\n\n[remotes.homolog.auth.hook.before_user_created]\nenabled = false\nuri = "pg-functions://postgres/public/hook_before_user_created_allowlist"\n\n[remotes.homolog.auth.hook.custom_access_token]\nenabled = false\n'
} > "$CASE/config.toml"
run_case "a hook table without uri fails naming the remote, the hook and the key" 1 \
  'remote homolog hook custom_access_token: .*uri' '!remote homolog hook before_user_created'

# 6. A uri that is not pg-functions for a required hook.
new_case
{
  printf '%s' "$BASE_CONFIG"
  printf '\n[remotes.homolog]\nproject_id = "abc"\n\n[remotes.homolog.auth.hook.before_user_created]\nenabled = false\nuri = "https://example.test/hook"\n\n[remotes.homolog.auth.hook.custom_access_token]\nenabled = false\nuri = "pg-functions://postgres/public/hook_custom_access_token_allowlist"\n'
} > "$CASE/config.toml"
run_case "a required hook with a non pg-functions uri fails" 1 \
  'remote homolog hook before_user_created: .*uri'

# 7. enabled = true with a function no migration defines.
new_case
{
  printf '%s' "$BASE_CONFIG"
  printf '\n[remotes.homolog]\nproject_id = "abc"\n\n[remotes.homolog.auth.hook.before_user_created]\nenabled = true\nuri = "pg-functions://postgres/public/hook_before_user_created_allowlist"\n\n[remotes.homolog.auth.hook.custom_access_token]\nenabled = false\nuri = "pg-functions://postgres/public/hook_custom_access_token_allowlist"\n'
} > "$CASE/config.toml"
fn_migration public hook_custom_access_token_allowlist
run_case "an enabled hook whose function no migration defines fails and names the function" 1 \
  'remote homolog hook before_user_created: .*public\.hook_before_user_created_allowlist'

# 8. The same with the function defined (here the base blocks need theirs too).
fn_migration public hook_before_user_created_allowlist
run_case "the same config with the function defined passes" 0 '^guard:hooks: ok'

# 9. A disabled block is checked for shape only: its function may be missing.
new_case
{ printf '%s' "$BASE_CONFIG"; good_remote homolog; } > "$CASE/config.toml"
fn_migration public something_else
run_case "an enabled base hook with a missing function fails even when the remote is disabled" 1 \
  'hook before_user_created: .*public\.hook_before_user_created_allowlist'

new_case
{ printf '[auth.hook.before_user_created]\nenabled = false\nuri = "pg-functions://postgres/public/missing_fn"\n'; good_remote homolog; } > "$CASE/config.toml"
run_case "a disabled block is checked for shape only (function not required)" 0 '^guard:hooks: ok'

# 10. Exact names (P64): blocks under prod do not satisfy production.
new_case
{
  printf '%s' "$BASE_CONFIG"
  good_remote prod
  printf '\n[remotes.production]\nproject_id = "abc"\n\n[remotes.production.auth]\nsite_url = "https://x.test"\n'
} > "$CASE/config.toml"
fn_migration public hook_before_user_created_allowlist
fn_migration public hook_custom_access_token_allowlist
run_case "blocks under remotes.prod do not satisfy remotes.production" 1 \
  'remote production hook before_user_created' 'remote production hook custom_access_token' '!remote prod hook'

# 11. homolog never borrows production's blocks.
new_case
{
  printf '%s' "$BASE_CONFIG"
  good_remote production
  printf '\n[remotes.homolog]\nproject_id = "abc"\n'
} > "$CASE/config.toml"
fn_migration public hook_before_user_created_allowlist
fn_migration public hook_custom_access_token_allowlist
run_case "homolog does not borrow the blocks of production" 1 \
  'remote homolog hook before_user_created' '!remote production hook'

# 12. A commented header is not a table.
new_case
{
  printf '%s' "$BASE_CONFIG"
  printf '\n[remotes.homolog]\nproject_id = "abc"\n\n[remotes.homolog.auth.hook.before_user_created]\nenabled = false\nuri = "pg-functions://postgres/public/hook_before_user_created_allowlist"\n\n# [remotes.homolog.auth.hook.custom_access_token]\n# enabled = false\n# uri = "pg-functions://postgres/public/hook_custom_access_token_allowlist"\n'
} > "$CASE/config.toml"
run_case "a commented-out hook header does not count as a block" 1 \
  'remote homolog hook custom_access_token' '!remote homolog hook before_user_created'

new_case
{ printf '%s' "$BASE_CONFIG"; printf '\n# [remotes.future]\n# project_id = "x"\n'; } > "$CASE/config.toml"
fn_migration public hook_before_user_created_allowlist
fn_migration public hook_custom_access_token_allowlist
run_case "a commented remote header is not a remote" 0 '^guard:hooks: ok' 'no \[remotes'

# 13. No remote at all: exit 0 with a note (P65).
new_case
printf '%s' "$BASE_CONFIG" > "$CASE/config.toml"
fn_migration public hook_before_user_created_allowlist
fn_migration public hook_custom_access_token_allowlist
run_case "a config with no remote table passes and says so" 0 '^guard:hooks: ok' 'no \[remotes'

# 14. Missing config: exit 2 with the path (P65).
new_case
run_case "a missing config exits 2 and names the path" 2 "$CASE/config.toml"

# 15. A remote with only a header and nothing else.
new_case
{ printf '%s' "$BASE_CONFIG"; printf '\n[remotes.homolog]\n'; } > "$CASE/config.toml"
fn_migration public hook_before_user_created_allowlist
fn_migration public hook_custom_access_token_allowlist
run_case "a remote with only a header fails" 1 \
  'remote homolog hook before_user_created' 'remote homolog hook custom_access_token'

# 16. A second remote with explicit blocks passes.
new_case
{ printf '%s' "$BASE_CONFIG"; good_remote production; good_remote homolog; } > "$CASE/config.toml"
fn_migration public hook_before_user_created_allowlist
fn_migration public hook_custom_access_token_allowlist
run_case "two remotes with explicit blocks pass" 0 '^guard:hooks: ok' 'remotes: homolog, production'

# 17. Offenders print sorted by (remote, hook).
new_case
{
  printf '%s' "$BASE_CONFIG"
  printf '\n[remotes.zeta]\nproject_id = "z"\n\n[remotes.alpha]\nproject_id = "a"\n'
} > "$CASE/config.toml"
fn_migration public hook_before_user_created_allowlist
fn_migration public hook_custom_access_token_allowlist
run_case "the failing run lists its offenders" 1 'remote alpha hook' 'remote zeta hook'
got="$(grep -oE 'remote [a-z]+ hook [a-z_]+' "$CASE/out.txt" | tr '\n' ';')"
want="remote alpha hook before_user_created;remote alpha hook custom_access_token;remote zeta hook before_user_created;remote zeta hook custom_access_token;"
N=$((N + 1))
if [ "$got" = "$want" ]; then report "offenders are sorted by remote, then hook" ""; else report "offenders are sorted by remote, then hook" " got '$got'"; fi

# 18. The same input prints the same text twice.
first="$(cat "$CASE/out.txt")"
set +e
CONFIG_TOML="$CASE/config.toml" MIGRATIONS_DIR="$CASE/migrations" bash "$GUARD" > "$CASE/out2.txt" 2>&1
set -e
N=$((N + 1))
if [ "$first" = "$(cat "$CASE/out2.txt")" ]; then report "two runs on the same input print identical text" ""; else report "two runs on the same input print identical text" " outputs differ"; fi

# 19. The guard never edits the config it reads.
N=$((N + 1))
before="$(cksum < "$CASE/config.toml")"
set +e
CONFIG_TOML="$CASE/config.toml" MIGRATIONS_DIR="$CASE/migrations" bash "$GUARD" > /dev/null 2>&1
set -e
if [ "$before" = "$(cksum < "$CASE/config.toml")" ]; then report "the guard leaves the config untouched" ""; else report "the guard leaves the config untouched" " config changed"; fi

echo "1..$N"
exit "$FAILED"
