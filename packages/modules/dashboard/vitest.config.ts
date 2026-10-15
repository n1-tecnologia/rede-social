import { vitestBase } from '@rede-social/config/vitest.base';
import react from '@vitejs/plugin-react';
import { defineConfig, mergeConfig } from 'vitest/config';

/**
 * Module tests: pure helpers and presentational components, no server code, so no env placeholders.
 * The default environment stays `node`; the COMPONENT suites opt in per file with
 * `// @vitest-environment happy-dom`. Each package owns its config: Vitest 5 no longer walks up.
 */
export default mergeConfig(
  vitestBase,
  defineConfig({
    plugins: [react()],
    test: {
      include: ['tests/**/*.test.{ts,tsx}'],
    },
  }),
);
