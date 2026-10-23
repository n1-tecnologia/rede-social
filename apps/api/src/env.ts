import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

/** API-process environment. Fails fast at import time when a required variable is missing. */
export const env = createEnv({
  server: {
    PORT: z.coerce.number().int().positive().default(8787),
    /**
     * `migrate` runs the migration fan-out (`runMigrateAll`) and exits: no listener (09.2-15, D-544). `move` runs
     * the operator's tenant-move tool (`runMoveCli`) and exits the same way (09.2-23, D-535, D-536).
     */
    ROLE: z.enum(['api', 'worker', 'migrate', 'move']).default('api'),
    /**
     * The move tool's waits (09.2-23, D-535). Quiescence: the 60 s by-host cache plus 5 s for in-flight requests.
     * Registry: the 15 s binding cache plus 5 s. Tests and the local rehearsal pass 0.
     */
    MOVE_QUIESCE_MS: z.coerce.number().int().min(0).optional(),
    MOVE_REGISTRY_WAIT_MS: z.coerce.number().int().min(0).optional(),
    // LOG_LEVEL is a kernel setting (`@rede-social/core/server/env`), read by the one root logger.
    DATABASE_URL: z.url(),
    /**
     * Connection the pg-boss worker polls on. Defaults to `DATABASE_URL`; in production it points at
     * the SESSION pooler (`:5432`) because the worker holds long-lived listeners, while the request
     * path stays on the transaction pooler (A6).
     */
    BOSS_DATABASE_URL: z.url().optional(),
    /**
     * How many tenant projects one worker instance supervises (one pg-boss instance, two session sockets,
     * each). Past it the supervisor logs `worker.supervisor.cap_reached` and skips the rest (D-546, T-09.2-42).
     */
    SUPERVISOR_MAX_PROJECTS: z.coerce.number().int().positive().default(40),
    SUPABASE_URL: z.url(),
    SUPABASE_SERVICE_KEY: z.string().min(1),
    /**
     * The `postgres` connection of the CENTRAL project for the migrate role (09.2-15): the central set and
     * project 0's tenant set. A session-mode endpoint; only the migrate Job carries it. Unset, the local
     * stack's `postgres` URL is used outside production and the run fails closed in production.
     */
    MIGRATION_DATABASE_URL: z.url().optional(),
    /**
     * Where the image carries both migration sets and their manifest (`/app/migrations`, D-547). Unset in
     * development: the repository is the source.
     */
    MIGRATIONS_DIR: z.string().min(1).optional(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
