import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

/** API-process environment. Fails fast at import time when a required variable is missing. */
export const env = createEnv({
  server: {
    PORT: z.coerce.number().int().positive().default(8787),
    ROLE: z.enum(['api', 'worker']).default('api'),
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
    DATABASE_URL: z.url(),
    SUPABASE_URL: z.url(),
    SUPABASE_SERVICE_KEY: z.string().min(1),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
