import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

/** API-process environment. Fails fast at import time when a required variable is missing. */
export const env = createEnv({
  server: {
    PORT: z.coerce.number().int().positive().default(8787),
    ROLE: z.enum(['api', 'worker']).default('api'),
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
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
