import { vitestBase } from '@tria/config/vitest.base';
import { defineConfig, mergeConfig } from 'vitest/config';

/**
 * Module unit tests: no database, no network. The placeholders satisfy the fail-fast env validation
 * `packages/core/server/env.ts` performs at import time (postgres.js connects lazily and these tests
 * never open a transaction — `withTenantTx` is mocked). Integration coverage lives in
 * `apps/api/tests/integration`.
 *
 * Each package owns its config: Vitest 5 no longer walks up directories looking for one.
 */
export default mergeConfig(
  vitestBase,
  defineConfig({
    test: {
      include: ['tests/**/*.test.ts'],
      env: {
        DATABASE_URL: 'postgres://api_user:postgres@127.0.0.1:54322/postgres',
        SUPABASE_URL: 'http://127.0.0.1:54321',
        SUPABASE_SERVICE_KEY: 'unit-test-placeholder',
      },
    },
  }),
);
