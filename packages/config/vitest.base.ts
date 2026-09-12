import { defineConfig } from 'vitest/config';

/**
 * Shared Vitest fragment. Packages merge it with `mergeConfig(vitestBase, defineConfig({...}))`.
 * Vitest 5 no longer walks up directories to find a config, so every package owns its own
 * `vitest.config.ts` and extends this one.
 */
export const vitestBase = defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
