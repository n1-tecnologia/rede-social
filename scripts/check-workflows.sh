#!/usr/bin/env bash
# Repository guard of the two deploy workflows (plan 09.2-16, DBT-26, P54-P57, T-09.2-79/80).
#
# deploy-api.yml (production) and deploy-hml.yml (homolog) run the database-per-tenant release in a fixed
# order and with fixed secret lists. A reordered step or a forgotten secret is only found late, after the
# migrations were applied. This script reads the two files (no network, no cloud credential, no YAML library:
# the workflows are flat and the lines are matched) and fails when:
#   (order)      the steps are not, in this order and ADJACENT where it matters:
#                  Release preflight < Migrations (roles included) < Deploy the migrate job
#                  < Run the migrate job < Deploy the API < Deploy the worker
#                the last four are consecutive steps (nothing in between that could be skipped alone), and
#                none of the six carries a step-level `if:` (nothing is skipped silently)
#   (wait)       the step that executes the Job does not run `gcloud run jobs execute <job> ... --wait`
#   (concurrency) the deploy job has no `concurrency` group of its own or lets a newer run cancel it
#   (image)      the Job, the API and the worker do not deploy the same `needs.build.outputs.image`
#   (secrets)    a secret mounted on the Job is missing from the lists it must also reach, the services lack
#                PLATFORM_MASTER_KEYS / PROJECT_AUTH_SMTP_PASS, the worker lacks MIGRATION_DATABASE_URL, or
#                a secret name appears under an `env_vars` block (a credential in a plain value)
#   (provider)   the Job or a service lacks PROJECT_PROVIDER=supabase, or the Job lacks ROLE=migrate,
#                `--max-retries=0`, `--task-timeout=3600s`, or passes `--strict` (D-545: a failing tenant
#                project is a warning)
#   (hml)        deploy-hml.yml does not refuse HML_SUPABASE=shared-with-production in its preflight
#
# Usage: bash scripts/check-workflows.sh              check the repository's workflows
#        bash scripts/check-workflows.sh --self-test  run the guard on a valid copy and on mutated copies
# Env:   WORKFLOW_DIR  directory holding the two files (default .github/workflows)
# Exit:  0 clean   1 at least one offence (all printed to stderr)   2 a workflow file is missing
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WF_DIR="${WORKFLOW_DIR:-$ROOT/.github/workflows}"

S_PREFLIGHT="Release preflight"
S_MIGRATIONS="Migrations (roles included)"
S_JOB_DEPLOY="Deploy the migrate job"
S_JOB_RUN="Run the migrate job"
S_API="Deploy the API"
S_WORKER="Deploy the worker"

# --------------------------------------------------------------------------------------------------------
# Self-test: one valid copy, then one mutation at a time, each of which must make the guard fail.
# --------------------------------------------------------------------------------------------------------
if [ "${1:-}" = "--self-test" ]; then
  work="$(mktemp -d)"
  trap 'rm -rf "$work"' EXIT
  self="$ROOT/scripts/check-workflows.sh"
  failed=0

  fresh() { # fresh <case>: a copy of both workflows in $work/<case>
    mkdir -p "$work/$1"
    cp "$WF_DIR/deploy-api.yml" "$WF_DIR/deploy-hml.yml" "$work/$1/"
  }
  run_guard() { WORKFLOW_DIR="$work/$1" bash "$self" > "$work/$1.out" 2>&1; }

  fresh valid
  if ! run_guard valid; then
    echo "self-test FAILED: the guard rejects a valid copy" >&2
    cat "$work/valid.out" >&2
    failed=1
  fi

  # P56: two steps swapped (the Job execution and the API deploy), reassembled from the real step blocks.
  fresh swapped
  steps="$work/swapped.steps"
  mkdir -p "$steps"
  awk -v dir="$steps" '
    /^  [A-Za-z0-9_-]+:/ { injob = ($1 == "migrate-and-deploy-prod:"); insteps = 0 }
    injob && /^    steps:/ { insteps = 1; next }
    injob && insteps && /^      - / { n++; if (n == 1) print NR > (dir "/first_line"); file = sprintf("%s/step_%03d", dir, n) }
    injob && insteps && n > 0 { print > file }
  ' "$work/swapped/deploy-api.yml"
  first_line="$(cat "$steps/first_line")"
  run_no=""
  api_no=""
  for f in "$steps"/step_*; do
    case "$(head -1 "$f")" in
      "      - name: $S_JOB_RUN") run_no="${f##*step_}" ;;
      "      - name: $S_API") api_no="${f##*step_}" ;;
    esac
  done
  if [ -z "$run_no" ] || [ -z "$api_no" ]; then
    echo "self-test FAILED: could not find the two steps to swap" >&2
    failed=1
  else
    {
      head -n $((first_line - 1)) "$work/swapped/deploy-api.yml"
      for f in "$steps"/step_*; do
        n="${f##*step_}"
        if [ "$n" = "$run_no" ]; then cat "$steps/step_$api_no"
        elif [ "$n" = "$api_no" ]; then cat "$steps/step_$run_no"
        else cat "$f"
        fi
      done
    } > "$work/swapped/deploy-api.new"
    mv "$work/swapped/deploy-api.new" "$work/swapped/deploy-api.yml"
    if run_guard swapped; then
      echo "self-test FAILED: a workflow with two steps swapped passed the guard (P56)" >&2
      failed=1
    fi
  fi

  mutate() { # mutate <case> <file> <perl substitution over the whole file>
    fresh "$1"
    perl -0777 -pe "$3" "$work/$1/$2" > "$work/$1/$2.new"
    if cmp -s "$work/$1/$2" "$work/$1/$2.new"; then
      echo "self-test FAILED: the mutation '$1' changed nothing" >&2
      failed=1
    fi
    mv "$work/$1/$2.new" "$work/$1/$2"
    if run_guard "$1"; then
      echo "self-test FAILED: the mutation '$1' passed the guard" >&2
      failed=1
    fi
  }
  mutate nowait deploy-api.yml 's/ --wait$//m'
  mutate cancel deploy-api.yml 's/cancel-in-progress: false/cancel-in-progress: true/'
  mutate nogroup deploy-hml.yml 's/group: deploy-hml-serial/group: shared/'
  mutate smtp_missing deploy-api.yml 's/^.*PROJECT_AUTH_SMTP_PASS=.*\n//mg'
  # The worker's line only (the last occurrence in the file; the Job's comes first).
  mutate boss_missing deploy-hml.yml 's/\n *MIGRATION_DATABASE_URL=migration-database-url-hml:latest(?!.*MIGRATION_DATABASE_URL=migration-database-url-hml)//s'
  mutate secret_in_env deploy-api.yml 's/^( *)ROLE=migrate$/$1ROLE=migrate\n$1PLATFORM_MASTER_KEYS=oops/m'
  mutate provider_missing deploy-hml.yml 's/^ {12}PROJECT_PROVIDER=supabase\n//mg'
  mutate strict deploy-api.yml 's/--task-timeout=3600s/--task-timeout=3600s --strict/'
  mutate skipped_step deploy-api.yml 's/^      - name: Deploy the worker\n/      - name: Deploy the worker\n        if: false\n/m'
  mutate hml_shared deploy-hml.yml 's/shared-with-production\)/other)/'

  if [ "$failed" -ne 0 ]; then exit 1; fi
  echo "check-workflows self-test: ok (valid copy passes; swap and nine other mutations fail)"
  exit 0
fi

# --------------------------------------------------------------------------------------------------------
# The guard
# --------------------------------------------------------------------------------------------------------
errors=0
err() {
  echo "check-workflows: $1" >&2
  errors=$((errors + 1))
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# split_steps <file> <job key> <dir>: one file per step (step_001, ...) of the job, plus job_head (the job's
# lines before `steps:`).
split_steps() {
  mkdir -p "$3"
  awk -v job="$2" -v dir="$3" '
    /^  [A-Za-z0-9_-]+:/ { injob = ($1 == job ":"); insteps = 0 }
    injob && !insteps && !/^    steps:/ { print >> (dir "/job_head") }
    injob && /^    steps:/ { insteps = 1; next }
    injob && insteps && /^      - / { n++; file = sprintf("%s/step_%03d", dir, n) }
    injob && insteps && n > 0 { print > file }
  ' "$1"
}

# step_no <dir> <step name>: the number of the step, empty when absent.
step_no() {
  local f
  for f in "$1"/step_*; do
    [ -e "$f" ] || continue
    if [ "$(head -1 "$f")" = "      - name: $2" ]; then
      printf '%s' "$((10#${f##*step_}))"
      return 0
    fi
  done
  return 0
}

step_file() { printf '%s/step_%03d' "$1" "$(step_no "$1" "$2")"; }

# block_names <step file> <key>: the NAMEs of an `env_vars` or `secrets` block, one per line.
block_names() {
  awk -v key="$2" '
    $0 ~ ("^          " key ": \\|-?[ \t]*$") { on = 1; next }
    on { if ($0 ~ /^            [^ ]/) { print; next } else on = 0 }
  ' "$1" | sed -e 's/^ *//' -e 's/[=:].*$//'
}

has_line() { grep -qxF -- "$2" "$1"; }
in_list() { printf '%s\n' "$2" | grep -qxF -- "$1"; }

# check_workflow <file name> <job key> <Cloud Run job name> <concurrency group> <label>
check_workflow() {
  local file="$WF_DIR/$1" jobkey="$2" jobname="$3" group="$4" label="$5"
  if [ ! -f "$file" ]; then
    echo "check-workflows: missing workflow file: $file" >&2
    exit 2
  fi
  local dir="$TMP/$label"
  split_steps "$file" "$jobkey" "$dir"
  if [ ! -f "$dir/job_head" ] || ! ls "$dir"/step_* > /dev/null 2>&1; then
    err "$label: job '$jobkey' with steps not found in $1"
    return 0
  fi

  local n_pre n_mig n_jd n_jr n_api n_wk missing=0 s
  n_pre="$(step_no "$dir" "$S_PREFLIGHT")"
  n_mig="$(step_no "$dir" "$S_MIGRATIONS")"
  n_jd="$(step_no "$dir" "$S_JOB_DEPLOY")"
  n_jr="$(step_no "$dir" "$S_JOB_RUN")"
  n_api="$(step_no "$dir" "$S_API")"
  n_wk="$(step_no "$dir" "$S_WORKER")"
  for s in "$S_PREFLIGHT:$n_pre" "$S_MIGRATIONS:$n_mig" "$S_JOB_DEPLOY:$n_jd" "$S_JOB_RUN:$n_jr" "$S_API:$n_api" "$S_WORKER:$n_wk"; do
    if [ -z "${s##*:}" ]; then
      err "$label: step '${s%:*}' is missing"
      missing=1
    fi
  done
  if [ "$missing" -ne 0 ]; then return 0; fi

  # (order) P56 and (adjacency) P54
  if ! { [ "$n_pre" -lt "$n_mig" ] && [ "$n_mig" -lt "$n_jd" ] && [ "$n_jd" -lt "$n_jr" ] && [ "$n_jr" -lt "$n_api" ] && [ "$n_api" -lt "$n_wk" ]; }; then
    err "$label: the order must be '$S_PREFLIGHT' < '$S_MIGRATIONS' < '$S_JOB_DEPLOY' < '$S_JOB_RUN' < '$S_API' < '$S_WORKER' (steps $n_pre, $n_mig, $n_jd, $n_jr, $n_api, $n_wk)"
  fi
  if [ "$n_jr" -ne $((n_jd + 1)) ] || [ "$n_api" -ne $((n_jr + 1)) ] || [ "$n_wk" -ne $((n_api + 1)) ]; then
    err "$label: '$S_JOB_DEPLOY', '$S_JOB_RUN', '$S_API' and '$S_WORKER' must be consecutive steps (P54)"
  fi
  # nothing is skipped silently
  for s in "$n_pre" "$n_mig" "$n_jd" "$n_jr" "$n_api" "$n_wk"; do
    if grep -qE '^        if:' "$(printf '%s/step_%03d' "$dir" "$s")"; then
      err "$label: step $s of the release sequence has a step-level 'if:' (a skipped step must fail, not pass)"
    fi
  done

  local jd jr api wk
  jd="$(step_file "$dir" "$S_JOB_DEPLOY")"
  jr="$(step_file "$dir" "$S_JOB_RUN")"
  api="$(step_file "$dir" "$S_API")"
  wk="$(step_file "$dir" "$S_WORKER")"

  # (wait)
  if ! grep -qE "^ *gcloud run jobs execute $jobname( .*)? --wait( |\$)" "$jr"; then
    err "$label: '$S_JOB_RUN' must run 'gcloud run jobs execute $jobname ... --wait'"
  fi

  # (concurrency) P57
  if ! grep -qE "^      group: $group\$" "$dir/job_head"; then
    err "$label: the deploy job needs 'concurrency: group: $group'"
  fi
  if ! grep -qE '^      cancel-in-progress: false$' "$dir/job_head"; then
    err "$label: the deploy job's concurrency must keep 'cancel-in-progress: false'"
  fi

  # (image) T-09.2-79
  local image_line='          image: ${{ needs.build.outputs.image }}'
  for s in "$jd" "$api" "$wk"; do
    if ! has_line "$s" "$image_line"; then
      err "$label: '$(head -1 "$s" | sed 's/^ *- name: //')' must deploy 'needs.build.outputs.image' (one image for the Job and both services)"
    fi
  done
  if ! has_line "$jd" "          job: $jobname"; then
    err "$label: '$S_JOB_DEPLOY' must deploy the Cloud Run job '$jobname'"
  fi

  # (secrets) T-09.2-80
  local job_secrets api_secrets wk_secrets job_env api_env wk_env name
  job_secrets="$(block_names "$jd" secrets)"
  api_secrets="$(block_names "$api" secrets)"
  wk_secrets="$(block_names "$wk" secrets)"
  job_env="$(block_names "$jd" env_vars)"
  api_env="$(block_names "$api" env_vars)"
  wk_env="$(block_names "$wk" env_vars)"
  for name in $job_secrets; do
    if [ "$name" != "MIGRATION_DATABASE_URL" ]; then
      in_list "$name" "$api_secrets" || err "$label: Job secret $name is missing from the API's secrets"
    fi
    in_list "$name" "$wk_secrets" || err "$label: Job secret $name is missing from the worker's secrets"
  done
  for name in PLATFORM_MASTER_KEYS MIGRATION_DATABASE_URL; do
    in_list "$name" "$job_secrets" || err "$label: the Job needs the secret $name"
  done
  for name in PLATFORM_MASTER_KEYS PROJECT_AUTH_SMTP_PASS; do
    in_list "$name" "$api_secrets" || err "$label: the API needs the secret $name"
    in_list "$name" "$wk_secrets" || err "$label: the worker needs the secret $name"
  done
  in_list MIGRATION_DATABASE_URL "$wk_secrets" || err "$label: the worker needs the secret MIGRATION_DATABASE_URL"
  for name in $(printf '%s\n%s\n%s\n' "$job_secrets" "$api_secrets" "$wk_secrets" | sort -u); do
    if in_list "$name" "$job_env" || in_list "$name" "$api_env" || in_list "$name" "$wk_env"; then
      err "$label: $name is a secret but also appears under env_vars (a credential must be mounted from Secret Manager)"
    fi
  done

  # (provider) D-544, D-545
  for s in "$jd" "$api" "$wk"; do
    has_line "$s" "            PROJECT_PROVIDER=supabase" || err "$label: '$(head -1 "$s" | sed 's/^ *- name: //')' needs PROJECT_PROVIDER=supabase in env_vars"
  done
  has_line "$jd" "            ROLE=migrate" || err "$label: the Job needs ROLE=migrate"
  grep -qE -- '--max-retries=0( |$)' "$jd" || err "$label: the Job needs --max-retries=0"
  grep -qE -- '--task-timeout=3600s( |$)' "$jd" || err "$label: the Job needs --task-timeout=3600s"
  if grep -v '^ *#' "$jd" "$jr" | grep -q -- '--strict'; then
    err "$label: the Job must not pass --strict (a failing tenant project is a warning, D-545)"
  fi
}

check_workflow deploy-api.yml migrate-and-deploy-prod migrate deploy-prod-serial production
check_workflow deploy-hml.yml migrate-and-deploy-hml migrate-hml deploy-hml-serial homolog

# (hml) the shared mode is refused, not skipped around
if [ -f "$WF_DIR/deploy-hml.yml" ]; then
  if ! grep -qE '^            shared-with-production\)$' "$WF_DIR/deploy-hml.yml" \
    || ! grep -q 'HML_SUPABASE=shared-with-production is refused' "$WF_DIR/deploy-hml.yml"; then
    err "homolog: the preflight must refuse HML_SUPABASE=shared-with-production"
  fi
fi

if [ "$errors" -gt 0 ]; then
  echo "check-workflows: $errors offence(s)" >&2
  exit 1
fi
echo "check-workflows: ok (production and homolog: order, wait, concurrency, image, secrets, provider)"
