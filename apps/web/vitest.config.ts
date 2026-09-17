import { fileURLToPath } from 'node:url';
import { vitestBase } from '@tria/config/vitest.base';
import { configDefaults, defineConfig, mergeConfig } from 'vitest/config';

/**
 * Unit tests for the web app run under node (the catalog loader, host helpers, proxy.ts). Component
 * tests, if any land later, opt into happy-dom per file with `// @vitest-environment happy-dom`.
 * Vitest 5 no longer walks up for a config, so this package owns one and extends the shared fragment.
 * Playwright specs live under `e2e/` and are never collected here.
 *
 * `@/` mirrors the tsconfig path alias (Vite does not read `paths`), so `proxy.ts` and its imports
 * resolve in vitest exactly as they do in Next.
 */
export default mergeConfig(
  vitestBase,
  defineConfig({
    resolve: {
      alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
    },
    test: {
      environment: 'node',
      include: ['**/*.test.{ts,tsx}'],
      exclude: [...configDefaults.exclude, 'e2e/**', '.next/**'],
    },
  }),
);
