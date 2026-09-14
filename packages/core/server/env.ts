import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

/** Kernel environment. `DATABASE_URL` must be the `api_user` connection (never `postgres`/service role). */
export const env = createEnv({
  server: {
    DATABASE_URL: z.url(),
    SUPABASE_URL: z.url(),
    SUPABASE_SERVICE_KEY: z.string().min(1),
    /** Read once by `server/logging.ts`; every logger in the codebase is a child of that root. */
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
