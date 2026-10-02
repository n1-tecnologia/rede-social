import { vitestBase } from '@rede-social/config/vitest.base';
import { defineConfig, mergeConfig } from 'vitest/config';

/**
 * The no-database proofs: build, mount, route set, dependency set and the 401. The placeholders only
 * satisfy the kernel's fail-fast env validation (`packages/core/server/env.ts`) at import time;
 * postgres.js connects lazily and no case here reaches a query. The database case has its own config
 * (`vitest.integration.config.ts`), run by the root `test:integration` script.
 */
export default mergeConfig(
  vitestBase,
  defineConfig({
    test: {
      include: ['tests/**/*.test.ts'],
      exclude: ['tests/**/*.integration.test.ts'],
      env: {
        DATABASE_URL: 'postgres://api_user:postgres@127.0.0.1:54322/postgres',
        SUPABASE_URL: 'http://127.0.0.1:54321',
        SUPABASE_SERVICE_KEY: 'unit-test-placeholder',
      },
    },
  }),
);
