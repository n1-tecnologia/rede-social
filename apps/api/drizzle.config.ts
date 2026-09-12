import { defineConfig } from 'drizzle-kit';

/**
 * `drizzle-kit generate` only. Migrations are APPLIED by the Supabase CLI (`supabase db reset` locally,
 * `supabase db push` in CI) — never `drizzle-kit migrate`/`push` (two history tables = drift).
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: ['../../packages/core/db/schema/*.ts', '../../packages/modules/*/db/schema.ts'],
  out: '../../supabase/migrations',
  migrations: { prefix: 'supabase' }, // YYYYMMDDHHmmss_name.sql
  entities: { roles: { provider: 'supabase' } }, // ignore Supabase-managed roles in diffs
  dbCredentials: {
    // Only for `drizzle-kit studio`/introspection against the local stack.
    url: process.env.SUPABASE_DB_URL ?? 'postgres://postgres:postgres@127.0.0.1:54322/postgres',
  },
});
