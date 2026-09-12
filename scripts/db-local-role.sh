#!/usr/bin/env bash
# Local stack only: give api_user a login password so DATABASE_URL can use it. Hosted passwords are set by CI (01-09).
set -euo pipefail
psql "postgres://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 \
  -c "alter role api_user with login password 'postgres'"
echo "api_user can now log in locally (password: postgres)"
