import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';

export { app as api } from '../../src/app';

/** Seed tenants' hosts (D-24), same defaults as scripts/seed.ts. */
export const HOSTS = {
  demo: process.env.TENANT_DEMO_HOST ?? 'tria-demo.localhost',
  lab: process.env.TENANT_LAB_HOST ?? 'tria-lab.localhost',
};

export const SEED_PASSWORD = process.env.SEED_PASSWORD ?? '';

function required(name: string): string {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is required for integration tests (see scripts/local-env.sh)`);
  return value;
}

/** Real GoTrue session for a seeded user: the token the API verifies against the local JWKS. */
export async function signInAs(email: string, password: string): Promise<string> {
  const client = createClient(required('SUPABASE_URL'), required('SUPABASE_PUBLISHABLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session)
    throw new Error(`signInWithPassword failed for ${email}: ${error?.message}`);
  return data.session.access_token;
}

/** Superuser-ish connection for fixtures only (never used by application code). */
export const adminSql = postgres('postgres://postgres:postgres@127.0.0.1:54322/postgres', {
  prepare: false,
  max: 1,
});
