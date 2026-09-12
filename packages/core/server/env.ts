import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

/** Kernel environment. `DATABASE_URL` must be the `api_user` connection (never `postgres`/service role). */
export const env = createEnv({
  server: {
    DATABASE_URL: z.url(),
    SUPABASE_URL: z.url(),
    SUPABASE_SERVICE_KEY: z.string().min(1),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
