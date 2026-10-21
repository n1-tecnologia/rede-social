#!/usr/bin/env bash
# CI and deploy guard for the Auth hooks (plan 09.1-18, PAY-28, WR-02, D-495, threat T-09.1-85).
#
# Why: `supabase/config.toml` carries the hook blocks at the top (`[auth.hook.*]`, ENABLED locally). A
# `[remotes.<name>]` table inherits those base values, so a hosted environment that does not repeat
# the two access-hook blocks silently turns them ON at the next `supabase config push` — and an
# enabled hook that points at a missing function answers 500 on every login of every community
# (the identity is shared across them, 08.1). This script makes both mistakes impossible to merge or
# to push:
#   (a) for EVERY `[remotes.<name>]` it requires the two tables
#         [remotes.<name>.auth.hook.before_user_created]
#         [remotes.<name>.auth.hook.custom_access_token]
#       each with an explicit `enabled = true|false` and a
#       `uri = "pg-functions://postgres/<schema>/<function>"` line;
#   (b) for every hook table (base or remote) whose `enabled` is `true` and whose uri is a
#       `pg-functions://` uri, some file under the migrations directory must define that function
#       (`create function` or `create or replace function <schema>.<function>`). A `false` block is
#       checked for shape only.
# It reads TOML LINES, not a TOML tree (node is not on the deploy runners' PATH before setup-cli and
# the structure is flat): a line is a table header only when its first non-blank character is `[`;
# a line that starts with `#` is a comment. Table names are matched EXACTLY (`remotes.prod.*` never
# satisfies `remotes.production`). It never edits any file and enables nothing (PR-8): enabling a
# production hook is a human step of docs/DEPLOY.md "Phase 09.1 release".
#
# Usage: bash scripts/guard-auth-hooks.sh
# Env:   CONFIG_TOML     config to read      (default supabase/config.toml, relative to the repo root)
#        MIGRATIONS_DIR  where functions live (default supabase/migrations)
# Exit:  0 clean (also when the config has no [remotes.*] table, with a note)
#        1 offenders (printed to stderr, sorted by remote then hook, one per line)
#        2 the config file is missing or unreadable (never a pass by absence)
set -euo pipefail
cd "$(dirname "$0")/.."

CONFIG_TOML="${CONFIG_TOML:-supabase/config.toml}"
MIGRATIONS_DIR="${MIGRATIONS_DIR:-supabase/migrations}"

if [ ! -f "$CONFIG_TOML" ] || [ ! -r "$CONFIG_TOML" ]; then
  echo "guard:hooks: config not found or unreadable: $CONFIG_TOML" >&2
  exit 2
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
RECORDS="$WORK/records"
OFFENDERS="$WORK/offenders"
ENABLED="$WORK/enabled"
REMOTES="$WORK/remotes"
: > "$OFFENDERS"
: > "$ENABLED"
: > "$REMOTES"

# Pass 1 (awk): split the file into tables and collect `enabled` and `uri` per table. Records, `|`
# separated (no field can hold a pipe):
#   REMOTE|<name>
#   REQ|<remote>|<hook>|<table present 0|1>|<enabled or empty>|<uri or empty>
#   HOOK|<remote or (base)>|<hook>|<enabled or empty>|<uri or empty>
awk '
  {
    line = $0
    sub(/\r$/, "", line)
    sub(/^[ \t]+/, "", line)
    if (line == "" || substr(line, 1, 1) == "#") next
    if (substr(line, 1, 1) == "[") {
      name = line
      sub(/^\[+[ \t]*/, "", name)
      sub(/[ \t]*\].*$/, "", name)
      cur = name
      seen[cur] = 1
      n = split(cur, p, ".")
      if (p[1] == "remotes" && n >= 2) remotes[p[2]] = 1
      next
    }
    if (cur == "") next
    if (line ~ /^enabled[ \t]*=/) {
      v = line
      sub(/^enabled[ \t]*=[ \t]*/, "", v)
      sub(/[ \t]*#.*$/, "", v)
      sub(/[ \t]+$/, "", v)
      if (v == "true" || v == "false") en[cur] = v
      next
    }
    if (line ~ /^uri[ \t]*=[ \t]*"/) {
      v = line
      sub(/^uri[ \t]*=[ \t]*"/, "", v)
      sub(/".*$/, "", v)
      uri[cur] = v
      next
    }
  }
  END {
    split("before_user_created custom_access_token", req, " ")
    for (r in remotes) {
      print "REMOTE|" r
      for (i = 1; i <= 2; i++) {
        key = "remotes." r ".auth.hook." req[i]
        print "REQ|" r "|" req[i] "|" ((key in seen) ? 1 : 0) "|" en[key] "|" uri[key]
      }
    }
    for (t in seen) {
      n = split(t, p, ".")
      if (n == 3 && p[1] == "auth" && p[2] == "hook") {
        print "HOOK|(base)|" p[3] "|" en[t] "|" uri[t]
      } else if (n == 5 && p[1] == "remotes" && p[3] == "auth" && p[4] == "hook") {
        print "HOOK|" p[2] "|" p[5] "|" en[t] "|" uri[t]
      }
    }
  }
' "$CONFIG_TOML" > "$RECORDS"

# offend <remote> <hook> <reason>
offend() { printf '%s|%s|%s\n' "$1" "$2" "$3" >> "$OFFENDERS"; }

URI_RE='^pg-functions://postgres/[A-Za-z_][A-Za-z0-9_]*/[A-Za-z_][A-Za-z0-9_]*$'

# (a) the shape of the two required blocks in every remote.
while IFS='|' read -r kind remote hook present enabled uri; do
  case "$kind" in
    REMOTE)
      printf '%s\n' "$remote" >> "$REMOTES"
      ;;
    REQ)
      if [ "$present" != "1" ]; then
        offend "$remote" "$hook" "missing table [remotes.$remote.auth.hook.$hook] (a remote inherits the base block, enabled locally, so the hook would turn on in the hosted project)"
        continue
      fi
      if [ -z "$enabled" ]; then
        offend "$remote" "$hook" "the table has no explicit enabled = true|false line"
      fi
      if ! printf '%s' "$uri" | grep -Eq "$URI_RE"; then
        offend "$remote" "$hook" "the table has no uri = \"pg-functions://postgres/<schema>/<function>\" line"
      fi
      ;;
  esac
done < <(grep -E '^(REMOTE|REQ)\|' "$RECORDS" || true)

# (b) an enabled hook must point at a function some migration defines.
defines_function() {
  local schema="$1" fn="$2" f
  [ -d "$MIGRATIONS_DIR" ] || return 1
  for f in "$MIGRATIONS_DIR"/*.sql; do
    [ -f "$f" ] || continue
    if grep -v '^[[:space:]]*--' "$f" |
      grep -Eiq "create[[:space:]]+(or[[:space:]]+replace[[:space:]]+)?function[[:space:]]+\"?${schema}\"?\.\"?${fn}\"?[[:space:]]*\("; then
      return 0
    fi
  done
  return 1
}

while IFS='|' read -r kind remote hook enabled uri; do
  [ "$kind" = "HOOK" ] || continue
  [ "$enabled" = "true" ] || continue
  printf '%s/%s\n' "$remote" "$hook" >> "$ENABLED"
  if printf '%s' "$uri" | grep -Eq "$URI_RE"; then
    rest="${uri#pg-functions://postgres/}"
    schema="${rest%%/*}"
    fn="${rest#*/}"
    if ! defines_function "$schema" "$fn"; then
      offend "$remote" "$hook" "enabled, but no file under $MIGRATIONS_DIR defines function $schema.$fn (GoTrue would answer 500 on every login)"
    fi
  fi
done < <(grep -E '^HOOK\|' "$RECORDS" || true)

join_list() { LC_ALL=C sort -u | paste -sd, - | sed 's/,/, /g'; }

if [ -s "$OFFENDERS" ]; then
  LC_ALL=C sort -t '|' -k1,1 -k2,2 -k3,3 "$OFFENDERS" | while IFS='|' read -r remote hook reason; do
    echo "guard:hooks: remote $remote hook $hook: $reason" >&2
  done
  echo "guard:hooks: FAILED — every [remotes.<name>] needs explicit [remotes.<name>.auth.hook.before_user_created] and [remotes.<name>.auth.hook.custom_access_token] tables, and an enabled hook needs its function in $MIGRATIONS_DIR (PAY-28, WR-02)" >&2
  exit 1
fi

REMOTE_LIST="$(join_list < "$REMOTES")"
ENABLED_LIST="$(join_list < "$ENABLED")"
[ -n "$ENABLED_LIST" ] || ENABLED_LIST="none"
if [ -z "$REMOTE_LIST" ]; then
  echo "guard:hooks: ok (no [remotes.*] table in $CONFIG_TOML; base hooks checked; enabled hooks: $ENABLED_LIST)"
else
  echo "guard:hooks: ok (remotes: $REMOTE_LIST; enabled hooks: $ENABLED_LIST)"
fi
exit 0
