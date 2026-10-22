import { defineConfig } from 'drizzle-kit';

/**
 * The CENTRAL migration set (Phase 09.2-02, D-547): schema `platform` only, its own output directory and
 * its own ledger (`supabase_migrations.central_migrations`). `drizzle-kit generate` only. The files are
 * APPLIED by the in-house runner (`pnpm db:central` -> scripts/migrate-set.ts --set central); never
 * `drizzle-kit migrate`/`push` (two history tables = drift), and never to a tenant's project.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: ['../../packages/core/db/central/*.ts'],
  out: '../../supabase/central/migrations',
  migrations: { prefix: 'supabase' }, // YYYYMMDDHHmmss_name.sql
  schemaFilter: ['platform'],
  entities: { roles: { provider: 'supabase' } },
  dbCredentials: {
    // Only for `drizzle-kit studio`/introspection against the local stack.
    url: process.env.SUPABASE_DB_URL ?? 'postgres://postgres:postgres@127.0.0.1:54322/postgres',
  },
});
