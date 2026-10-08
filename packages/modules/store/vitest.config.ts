import { vitestBase } from '@rede-social/config/vitest.base';
import react from '@vitejs/plugin-react';
import { defineConfig, mergeConfig } from 'vitest/config';

/**
 * Module tests: no database, no network. The placeholders satisfy the fail-fast env validation
 * `packages/core/server/env.ts` performs at import time (postgres.js connects lazily and these tests
 * never open a transaction — `withTenantTx` is mocked). Integration coverage lives in
 * `apps/api/tests/integration`.
 *
 * The default environment stays `node` — the service/event suites must not pay for a DOM — and the
 * COMPONENT suites opt in per file with `// @vitest-environment happy-dom`. A blanket `happy-dom`
 * here would put every kernel-server mock under a simulated browser for no reason.
 *
 * Each package owns its config: Vitest 5 no longer walks up directories looking for one.
 */
export default mergeConfig(
  vitestBase,
  defineConfig({
    plugins: [react()],
    test: {
      include: ['tests/**/*.test.{ts,tsx}'],
      env: {
        DATABASE_URL: 'postgres://api_user:postgres@127.0.0.1:54322/postgres',
        SUPABASE_URL: 'http://127.0.0.1:54321',
        SUPABASE_SERVICE_KEY: 'unit-test-placeholder',
      },
    },
  }),
);
