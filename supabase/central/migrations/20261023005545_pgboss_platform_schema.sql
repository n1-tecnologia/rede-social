-- pgboss_platform_schema (09.2-09, D-546, DBT-29): the job schema of the CONTROL PLANE, in the CENTRAL set.
-- EXPAND-ONLY: it creates a schema and its objects, drops and rewrites nothing.
--
-- Why a second schema. Project 0 stays a tenant database until the last move and keeps its own `pgboss`
-- schema (the tenant set). The platform-scope jobs (`kernel.domain-verify`, `kernel.invite-send`,
-- `platform.mirror-reconcile`, and later the project bootstrap, health and migration retry) belong to the
-- control plane, not to any tenant's database, so they get their own schema here, in the central project,
-- and no tenant project ever has it (this file is in the CENTRAL set only).
--
-- Generated verbatim by the pg-boss CLI, the same way as the tenant file `20260913150245_pgboss_schema.sql`:
--   node node_modules/.pnpm/pg-boss@12.31.0/node_modules/pg-boss/dist/cli.js plans create --schema pgboss_platform
-- with only the wrapper stripped (`BEGIN;`/`COMMIT;`, the two `SET LOCAL` timeouts and the advisory lock):
-- the in-house runner already applies each migration inside one transaction.
--
-- The runtime NEVER creates or upgrades this schema: every PgBoss instance is constructed with
-- `migrate: false` (packages/core/server/jobs/boss.ts maps scope `platform` to this schema name and accepts
-- no schema string), so `api_user` needs DML only. Upgrading pg-boss means a NEW custom migration for BOTH
-- schemas, generated from the installed version with `pg-boss plans migrate --dry-run`; pgTAP 213 compares
-- the table sets of the two schemas so one cannot be upgraded without the other.

CREATE SCHEMA IF NOT EXISTS pgboss_platform;

    CREATE TYPE pgboss_platform.job_state AS ENUM (
      'created',
      'retry',
      'active',
      'completed',
      'cancelled',
      'failed'
    )
  ;

    CREATE TABLE pgboss_platform.version (
      version int primary key,
      cron_on timestamp with time zone,
      bam_on timestamp with time zone,
      flow_on timestamp with time zone,
      reindex_on timestamp with time zone,
      monitor_backoff_on timestamp with time zone
    )
  ;

    CREATE TABLE pgboss_platform.queue (
      name text NOT NULL,
      policy text NOT NULL,
      retry_limit int NOT NULL,
      retry_delay int NOT NULL,
      retry_backoff bool NOT NULL,
      retry_delay_max int,
      expire_seconds int NOT NULL,
      retention_seconds int NOT NULL,
      deletion_seconds int NOT NULL,
      dead_letter text REFERENCES pgboss_platform.queue (name) CHECK (dead_letter IS DISTINCT FROM name),
      partition bool NOT NULL,
      table_name text NOT NULL,
      deferred_count int NOT NULL default 0,
      queued_count int NOT NULL default 0,
      ready_count int NOT NULL default 0,
      warning_queued int NOT NULL default 0,
      active_count int NOT NULL default 0,
      failed_count int NOT NULL default 0,
      total_count int NOT NULL default 0,
      ready_history int[] NOT NULL default '{}',
      heartbeat_seconds int,
      notify bool NOT NULL DEFAULT false,
      singletons_active text[],
      monitor_claim_on timestamp with time zone,
      monitor_on timestamp with time zone,
      maintain_on timestamp with time zone,
      created_on timestamp with time zone not null default now(),
      updated_on timestamp with time zone not null default now(),
      PRIMARY KEY (name)
    )
  ;

    CREATE TABLE pgboss_platform.schedule (
      name text REFERENCES pgboss_platform.queue ON DELETE CASCADE,
      key text not null DEFAULT '',
      kind text not null DEFAULT 'cron' CHECK (kind IN ('cron', 'rrule')),
      cron text not null,
      timezone text DEFAULT 'UTC',
      data jsonb,
      options jsonb,
      created_on timestamp with time zone not null default now(),
      updated_on timestamp with time zone not null default now(),
      last_job_id uuid,
      PRIMARY KEY (name, key)
    )
  ;

    CREATE TABLE pgboss_platform.subscription (
      event text not null,
      name text not null REFERENCES pgboss_platform.queue ON DELETE CASCADE,
      created_on timestamp with time zone not null default now(),
      updated_on timestamp with time zone not null default now(),
      PRIMARY KEY(event, name)
    )
  ;

    CREATE TABLE pgboss_platform.bam (
      id uuid PRIMARY KEY default gen_random_uuid(),
      name text NOT NULL,
      version int NOT NULL,
      status text NOT NULL DEFAULT 'pending',
      queue text,
      table_name text NOT NULL,
      command text NOT NULL,
      error text,
      created_on timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
      started_on timestamp with time zone,
      completed_on timestamp with time zone
    )
  ;

    CREATE FUNCTION pgboss_platform.job_table_format(command text, table_name text)
    RETURNS text AS
    $$
      SELECT format(
        regexp_replace(
          regexp_replace(command, '\.job\y', '.%1$I', 'g'),
          '\yjob_i(\d+)', '%1$s_i\1', 'g'
        ),
        table_name
      );
    $$
    LANGUAGE sql IMMUTABLE;
  ;

    CREATE FUNCTION pgboss_platform.job_table_run(command text, tbl_name text DEFAULT NULL, queue_name text DEFAULT NULL)
    RETURNS VOID AS
    $$
    DECLARE
      tbl RECORD;
    BEGIN
      IF queue_name IS NOT NULL THEN
        SELECT table_name INTO tbl_name FROM pgboss_platform.queue WHERE name = queue_name;
      END IF;

      IF tbl_name IS NOT NULL THEN
        EXECUTE pgboss_platform.job_table_format(command, tbl_name);
        RETURN;
      END IF;

      EXECUTE pgboss_platform.job_table_format(command, 'job_common');

      FOR tbl IN SELECT table_name FROM pgboss_platform.queue WHERE partition = true
      LOOP
        EXECUTE pgboss_platform.job_table_format(command, tbl.table_name);
      END LOOP;
    END;
    $$
    LANGUAGE plpgsql;
  ;

    CREATE FUNCTION pgboss_platform.job_table_run_async(command_name text, version int, command text, tbl_name text DEFAULT NULL, queue_name text DEFAULT NULL)
    RETURNS VOID AS
    $$
    BEGIN
      IF queue_name IS NOT NULL THEN
        SELECT table_name INTO tbl_name FROM pgboss_platform.queue WHERE name = queue_name;
      END IF;

      IF tbl_name IS NOT NULL THEN
        INSERT INTO pgboss_platform.bam (name, version, status, queue, table_name, command)
        VALUES (
          command_name,
          version,
          'pending',
          queue_name,
          tbl_name,
          pgboss_platform.job_table_format(command, tbl_name)
        );
        RETURN;
      END IF;

      INSERT INTO pgboss_platform.bam (name, version, status, queue, table_name, command)
      SELECT
        command_name,
        version,
        'pending',
        NULL,
        'job_common',
        pgboss_platform.job_table_format(command, 'job_common')
      UNION ALL
      SELECT
        command_name,
        version,
        'pending',
        queue.name,
        queue.table_name,
        pgboss_platform.job_table_format(command, queue.table_name)
      FROM pgboss_platform.queue
      WHERE partition = true;
    END;
    $$
    LANGUAGE plpgsql;
  ;

    CREATE TABLE pgboss_platform.job (
      id uuid not null default gen_random_uuid(),
      name text not null,
      priority integer not null default(0),
      data jsonb,
      state pgboss_platform.job_state not null default 'created',
      retry_limit integer not null default 2,
      retry_count integer not null default 0,
      retry_delay integer not null default 0,
      retry_backoff boolean not null default false,
      retry_delay_max integer,
      expire_seconds int not null default 900,
      deletion_seconds int not null default 604800,
      singleton_key text,
      singleton_on timestamp without time zone,
      group_id text,
      group_tier text,
      start_after timestamp with time zone not null default now(),
      created_on timestamp with time zone not null default now(),
      started_on timestamp with time zone,
      completed_on timestamp with time zone,
      keep_until timestamp with time zone NOT NULL default now() + interval '1209600',
      output jsonb,
      dead_letter text,
      policy text,
      heartbeat_on timestamp with time zone,
      heartbeat_seconds int,
      blocked boolean not null default false,
      blocking boolean not null default false,
      pending_dependencies int not null default 0,
      source_name text,
      source_id uuid,
      source_created_on timestamp with time zone,
      source_retry_count int
    ) PARTITION BY LIST (name)
  ;
ALTER TABLE pgboss_platform.job ADD PRIMARY KEY (name, id);

    CREATE TABLE pgboss_platform.job_common (LIKE pgboss_platform.job INCLUDING GENERATED INCLUDING DEFAULTS);

    SELECT pgboss_platform.job_table_run($cmd$ALTER TABLE pgboss_platform.job ADD PRIMARY KEY (name, id)$cmd$, 'job_common');
    SELECT pgboss_platform.job_table_run($cmd$ALTER TABLE pgboss_platform.job ADD CONSTRAINT q_fkey FOREIGN KEY (name) REFERENCES pgboss_platform.queue (name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED$cmd$, 'job_common');
    SELECT pgboss_platform.job_table_run($cmd$ALTER TABLE pgboss_platform.job ADD CONSTRAINT dlq_fkey FOREIGN KEY (dead_letter) REFERENCES pgboss_platform.queue (name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED$cmd$, 'job_common');
    SELECT pgboss_platform.job_table_run($cmd$CREATE UNIQUE INDEX job_i1 ON pgboss_platform.job (name, COALESCE(singleton_key, '')) WHERE state = 'created' AND policy = 'short'$cmd$, 'job_common');
    SELECT pgboss_platform.job_table_run($cmd$CREATE UNIQUE INDEX job_i2 ON pgboss_platform.job (name, COALESCE(singleton_key, '')) WHERE state = 'active' AND policy = 'singleton'$cmd$, 'job_common');
    SELECT pgboss_platform.job_table_run($cmd$CREATE UNIQUE INDEX job_i3 ON pgboss_platform.job (name, state, COALESCE(singleton_key, '')) WHERE state <= 'active' AND policy = 'stately'$cmd$, 'job_common');
    SELECT pgboss_platform.job_table_run($cmd$CREATE UNIQUE INDEX job_i6 ON pgboss_platform.job (name, COALESCE(singleton_key, '')) WHERE state <= 'active' AND policy = 'exclusive'$cmd$, 'job_common');
    SELECT pgboss_platform.job_table_run($cmd$CREATE UNIQUE INDEX job_i8 ON pgboss_platform.job (name, singleton_key) WHERE state IN ('active', 'retry', 'failed') AND policy = 'key_strict_fifo'$cmd$, 'job_common');
    SELECT pgboss_platform.job_table_run($cmd$CREATE INDEX job_i10 ON pgboss_platform.job (name, singleton_key, state DESC, created_on, id) INCLUDE (start_after) WHERE state < 'active' AND NOT blocked AND policy = 'key_strict_fifo'$cmd$, 'job_common');
    SELECT pgboss_platform.job_table_run($cmd$ALTER TABLE pgboss_platform.job ADD CONSTRAINT job_key_strict_fifo_singleton_key_check CHECK (NOT (policy = 'key_strict_fifo' AND singleton_key IS NULL))$cmd$, 'job_common');
    SELECT pgboss_platform.job_table_run($cmd$CREATE UNIQUE INDEX job_i4 ON pgboss_platform.job (name, singleton_on, COALESCE(singleton_key, '')) WHERE state <> 'cancelled' AND singleton_on IS NOT NULL$cmd$, 'job_common');
    SELECT pgboss_platform.job_table_run($cmd$CREATE INDEX job_i11 ON pgboss_platform.job (name, priority DESC, created_on, start_after) WHERE state < 'active' AND NOT blocked$cmd$, 'job_common');
    SELECT pgboss_platform.job_table_run($cmd$CREATE INDEX job_i7 ON pgboss_platform.job (name, group_id) WHERE state = 'active' AND group_id IS NOT NULL$cmd$, 'job_common');
    SELECT pgboss_platform.job_table_run($cmd$CREATE INDEX job_i9 ON pgboss_platform.job (name, id) WHERE blocking AND state = 'completed'$cmd$, 'job_common');

    ALTER TABLE pgboss_platform.job ATTACH PARTITION pgboss_platform.job_common DEFAULT;
  ;

    CREATE TABLE pgboss_platform.warning (
      id uuid PRIMARY KEY default gen_random_uuid(),
      type text NOT NULL,
      message text NOT NULL,
      data jsonb,
      created_on timestamp with time zone NOT NULL DEFAULT now()
    )
  ;
CREATE INDEX warning_i1 ON pgboss_platform.warning (created_on DESC);

    CREATE TABLE pgboss_platform.queue_stats (
      id uuid NOT NULL DEFAULT gen_random_uuid(),
      name text NOT NULL,
      deferred_count int NOT NULL DEFAULT 0,
      queued_count   int NOT NULL DEFAULT 0,
      ready_count    int NOT NULL DEFAULT 0,
      active_count   int NOT NULL DEFAULT 0,
      failed_count   int NOT NULL DEFAULT 0,
      total_count    int NOT NULL DEFAULT 0,
      captured_on timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (id, captured_on)
    ) PARTITION BY RANGE (captured_on)
  ;
CREATE INDEX queue_stats_i1 ON pgboss_platform.queue_stats (name, captured_on DESC) INCLUDE (deferred_count, queued_count, ready_count, active_count, failed_count, total_count);

    DO $$
    DECLARE
      d date;
      i int;
      part_name text;
    BEGIN
      FOR i IN 0..1 LOOP
        d := (now() AT TIME ZONE 'UTC')::date + i;
        part_name := 'queue_stats_' || to_char(d, 'YYYYMMDD');
        IF NOT EXISTS (
          SELECT 1 FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'pgboss_platform' AND c.relname = part_name
        ) THEN
          EXECUTE format(
            'CREATE TABLE pgboss_platform.%I PARTITION OF pgboss_platform.queue_stats FOR VALUES FROM (%L) TO (%L)',
            part_name,
            to_char(d, 'YYYY-MM-DD') || ' 00:00:00+00',
            to_char(d + 1, 'YYYY-MM-DD') || ' 00:00:00+00'
          );
        END IF;
      END LOOP;
    END;
    $$
  ;

    CREATE TABLE pgboss_platform.job_dependency (
      child_name text NOT NULL,
      child_id uuid NOT NULL,
      parent_name text NOT NULL,
      parent_id uuid NOT NULL,
      PRIMARY KEY (child_name, child_id, parent_name, parent_id)
    )
  ;
CREATE INDEX IF NOT EXISTS job_dep_parent_idx ON pgboss_platform.job_dependency (parent_name, parent_id);

    CREATE FUNCTION pgboss_platform.create_queue(queue_name text, options jsonb)
    RETURNS VOID AS
    $$
    DECLARE
      tablename varchar := CASE WHEN options->>'partition' = 'true'
                            THEN 'j' || encode(sha224(queue_name::bytea), 'hex')
                            ELSE 'job_common'
                            END;
      queue_created_on timestamptz;
    BEGIN

      WITH q as (
        INSERT INTO pgboss_platform.queue (
          name,
          policy,
          retry_limit,
          retry_delay,
          retry_backoff,
          retry_delay_max,
          expire_seconds,
          retention_seconds,
          deletion_seconds,
          warning_queued,
          dead_letter,
          partition,
          table_name,
          heartbeat_seconds,
          notify
        )
        VALUES (
          queue_name,
          options->>'policy',
          COALESCE((options->>'retryLimit')::int, 2),
          COALESCE((options->>'retryDelay')::int, 0),
          COALESCE((options->>'retryBackoff')::bool, false),
          (options->>'retryDelayMax')::int,
          COALESCE((options->>'expireInSeconds')::int, 900),
          COALESCE((options->>'retentionSeconds')::int, 1209600),
          COALESCE((options->>'deleteAfterSeconds')::int, 604800),
          COALESCE((options->>'warningQueueSize')::int, 0),
          options->>'deadLetter',
          COALESCE((options->>'partition')::bool, false),
          tablename,
          (options->>'heartbeatSeconds')::int,
          COALESCE((options->>'notify')::bool, false)
        )
        ON CONFLICT DO NOTHING
        RETURNING created_on
      )
      SELECT created_on into queue_created_on from q;

      IF queue_created_on IS NULL OR options->>'partition' IS DISTINCT FROM 'true' THEN
        RETURN;
      END IF;

      EXECUTE format('CREATE TABLE pgboss_platform.%I (LIKE pgboss_platform.job INCLUDING DEFAULTS)', tablename);

      EXECUTE pgboss_platform.job_table_format($cmd$ALTER TABLE pgboss_platform.job ADD PRIMARY KEY (name, id)$cmd$, tablename);
      EXECUTE pgboss_platform.job_table_format($cmd$ALTER TABLE pgboss_platform.job ADD CONSTRAINT q_fkey FOREIGN KEY (name) REFERENCES pgboss_platform.queue (name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED$cmd$, tablename);
      EXECUTE pgboss_platform.job_table_format($cmd$ALTER TABLE pgboss_platform.job ADD CONSTRAINT dlq_fkey FOREIGN KEY (dead_letter) REFERENCES pgboss_platform.queue (name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED$cmd$, tablename);

      EXECUTE pgboss_platform.job_table_format($cmd$CREATE INDEX job_i11 ON pgboss_platform.job (name, priority DESC, created_on, start_after) WHERE state < 'active' AND NOT blocked$cmd$, tablename);
      EXECUTE pgboss_platform.job_table_format($cmd$CREATE UNIQUE INDEX job_i4 ON pgboss_platform.job (name, singleton_on, COALESCE(singleton_key, '')) WHERE state <> 'cancelled' AND singleton_on IS NOT NULL$cmd$, tablename);
      EXECUTE pgboss_platform.job_table_format($cmd$CREATE INDEX job_i7 ON pgboss_platform.job (name, group_id) WHERE state = 'active' AND group_id IS NOT NULL$cmd$, tablename);
      EXECUTE pgboss_platform.job_table_format($cmd$CREATE INDEX job_i9 ON pgboss_platform.job (name, id) WHERE blocking AND state = 'completed'$cmd$, tablename);

      IF options->>'policy' = 'short' THEN
        EXECUTE pgboss_platform.job_table_format($cmd$CREATE UNIQUE INDEX job_i1 ON pgboss_platform.job (name, COALESCE(singleton_key, '')) WHERE state = 'created' AND policy = 'short'$cmd$, tablename);
      ELSIF options->>'policy' = 'singleton' THEN
        EXECUTE pgboss_platform.job_table_format($cmd$CREATE UNIQUE INDEX job_i2 ON pgboss_platform.job (name, COALESCE(singleton_key, '')) WHERE state = 'active' AND policy = 'singleton'$cmd$, tablename);
      ELSIF options->>'policy' = 'stately' THEN
        EXECUTE pgboss_platform.job_table_format($cmd$CREATE UNIQUE INDEX job_i3 ON pgboss_platform.job (name, state, COALESCE(singleton_key, '')) WHERE state <= 'active' AND policy = 'stately'$cmd$, tablename);
      ELSIF options->>'policy' = 'exclusive' THEN
        EXECUTE pgboss_platform.job_table_format($cmd$CREATE UNIQUE INDEX job_i6 ON pgboss_platform.job (name, COALESCE(singleton_key, '')) WHERE state <= 'active' AND policy = 'exclusive'$cmd$, tablename);
      ELSIF options->>'policy' = 'key_strict_fifo' THEN
        EXECUTE pgboss_platform.job_table_format($cmd$CREATE UNIQUE INDEX job_i8 ON pgboss_platform.job (name, singleton_key) WHERE state IN ('active', 'retry', 'failed') AND policy = 'key_strict_fifo'$cmd$, tablename);
        EXECUTE pgboss_platform.job_table_format($cmd$CREATE INDEX job_i10 ON pgboss_platform.job (name, singleton_key, state DESC, created_on, id) INCLUDE (start_after) WHERE state < 'active' AND NOT blocked AND policy = 'key_strict_fifo'$cmd$, tablename);
        EXECUTE pgboss_platform.job_table_format($cmd$ALTER TABLE pgboss_platform.job ADD CONSTRAINT job_key_strict_fifo_singleton_key_check CHECK (NOT (policy = 'key_strict_fifo' AND singleton_key IS NULL))$cmd$, tablename);
      END IF;

      EXECUTE format('ALTER TABLE pgboss_platform.%I ADD CONSTRAINT cjc CHECK (name=%L)', tablename, queue_name);
      EXECUTE format('ALTER TABLE pgboss_platform.job ATTACH PARTITION pgboss_platform.%I FOR VALUES IN (%L)', tablename, queue_name);
    END;
    $$
    LANGUAGE plpgsql;
  ;

    CREATE FUNCTION pgboss_platform.delete_queue(queue_name text)
    RETURNS VOID AS
    $$
    DECLARE
      v_table varchar;
      v_partition bool;
    BEGIN
      
      SELECT table_name, partition
      FROM pgboss_platform.queue
      WHERE name = queue_name
      INTO v_table, v_partition;

      IF v_partition THEN
        EXECUTE format('DROP TABLE IF EXISTS pgboss_platform.%I', v_table);
      ELSE
        EXECUTE format('DELETE FROM pgboss_platform.%I WHERE name = %L', v_table, queue_name);
      END IF;
    
      DELETE FROM pgboss_platform.queue WHERE name = queue_name;
    END;
    $$
    LANGUAGE plpgsql;
  ;
INSERT INTO pgboss_platform.version(version) VALUES ('41');

-- The API and the worker both connect as `api_user`: usage on the schema plus DML on everything in it
-- (pg-boss creates per-queue partition tables at runtime through `pgboss_platform.create_queue`, which is why
-- the default privileges matter as much as the current grants).
grant usage on schema pgboss_platform to api_user;
grant all on all tables in schema pgboss_platform to api_user;
grant all on all sequences in schema pgboss_platform to api_user;
grant execute on all functions in schema pgboss_platform to api_user;
alter default privileges in schema pgboss_platform grant all on tables to api_user;
alter default privileges in schema pgboss_platform grant all on sequences to api_user;
alter default privileges in schema pgboss_platform grant execute on functions to api_user;

-- Platform job payloads carry domain and invite facts. No tenant role may read them: `public`, `anon` and
-- `authenticated` hold nothing on the schema (the tenant lane does `set local role authenticated`), and it is
-- never reachable from PostgREST.
revoke all on schema pgboss_platform from public, anon, authenticated;
revoke all on all tables in schema pgboss_platform from public, anon, authenticated;
revoke all on all functions in schema pgboss_platform from public, anon, authenticated;
