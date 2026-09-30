import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

/**
 * Web-process environment, validated once at import time (fail fast, both at build and at runtime).
 *
 * Server: `API_URL` (Cloud Run / local API base, required — plan 01-11 sets a placeholder on Vercel for
 * both environments) and `PLATFORM_HOST` (D-21: the platform's `super_admin` host; `rede-social.localhost` locally, the
 * platform domain on Vercel Production, UNSET on Preview so every preview host stays generic).
 * There is deliberately no `SITE_URL`: every absolute URL is derived from the request origin (D-22).
 *
 * `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (07-07, NOTIF-03) is OPTIONAL: when it is absent every push surface
 * renders the unsupported state instead of failing the build. It is the public half of the worker's
 * VAPID pair (production: the value of `vapid-public-key-prod`, DEPLOY.md); the private half never
 * reaches the web.
 */
export const env = createEnv({
  server: {
    API_URL: z.url(),
    PLATFORM_HOST: z.string().min(1).optional(),
  },
  client: {
    NEXT_PUBLIC_SUPABASE_URL: z.url(),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: z.string().min(1).optional(),
  },
  runtimeEnv: {
    API_URL: process.env.API_URL,
    PLATFORM_HOST: process.env.PLATFORM_HOST,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
  },
  emptyStringAsUndefined: true,
});
