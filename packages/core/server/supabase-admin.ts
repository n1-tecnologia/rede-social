import { createClient } from '@supabase/supabase-js';
import { env } from './env';

/** Service-key client for server-side admin calls (seed, sign-up). Kernel-only import (Biome rule). */
export const supabaseAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
