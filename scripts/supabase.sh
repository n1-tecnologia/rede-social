#!/usr/bin/env bash
# Supabase CLI wrapper for the LOCAL stack — `pnpm supabase <cmd>` and `pnpm db:reset` go through here.
#
# Why: supabase/config.toml enables `[auth.hook.send_email]` with `secrets = "env(SEND_EMAIL_HOOK_SECRETS)"`,
# and once that block is enabled EVERY Supabase CLI command (`status` included) refuses to load the
# config unless the referenced variable is set and well-formed (`v1,whsec_<base64>`, >= 32 chars) —
# probed with CLI 2.117.0 on 2026-09-15. This wrapper exports the LOCAL-STACK-ONLY throwaway secret
# when the shell has none, so a clean machine keeps working with no variables typed by hand.
#
# The constant below MUST stay identical to the one in scripts/local-env.sh: GoTrue receives it as
# container env at `supabase start`, the API reads it from apps/api/.env.local, and the Send Email
# Hook only works when both sides share one secret. Override by exporting SEND_EMAIL_HOOK_SECRETS
# (full value) or SEND_EMAIL_HOOK_SECRET_B64 (32 random bytes, base64). Hosted environments generate
# their own secret in GCP Secret Manager / GitHub environment secrets and NEVER reuse this constant
# (docs/deploy/auth-mail.md).
#
# Always the PINNED CLI (root devDependency `supabase`): the repo's node_modules/.bin binary when it
# exists (so `bash scripts/supabase.sh …` works outside a pnpm script too — a global 2.90.0 cannot
# even parse this config), else whatever `supabase` is on PATH (CI's setup-cli, pnpm scripts).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

export SEND_EMAIL_HOOK_SECRETS="${SEND_EMAIL_HOOK_SECRETS:-v1,whsec_${SEND_EMAIL_HOOK_SECRET_B64:-dHJpYS1sb2NhbC1zZW5kLWVtYWlsLWhvb2sta2V5MDE=}}"

if [ -x "$ROOT/node_modules/.bin/supabase" ]; then
  exec "$ROOT/node_modules/.bin/supabase" "$@"
fi
exec supabase "$@"
