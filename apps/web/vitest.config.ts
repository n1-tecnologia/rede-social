import { fileURLToPath } from 'node:url';
import { vitestBase } from '@rede-social/config/vitest.base';
import { configDefaults, defineConfig, mergeConfig } from 'vitest/config';

/**
 * Unit tests for the web app run under node (the catalog loader, host helpers, proxy.ts). Component
 * tests, if any land later, opt into happy-dom per file with `// @vitest-environment happy-dom`.
 * Vitest 5 no longer walks up for a config, so this package owns one and extends the shared fragment.
 * Playwright specs live under `e2e/` and are never collected here.
 *
 * `@/` mirrors the tsconfig path alias (Vite does not read `paths`), so `proxy.ts` and its imports
 * resolve in vitest exactly as they do in Next.
 *
 * `oxc.jsx` (Vite 8 transforms with oxc): the tsconfig keeps `jsx: preserve` for Next, so Vite must
 * transform JSX itself for tests that import a `.tsx` module for its pure helpers without rendering
 * (components/pwa/InstallHint.test.ts, 02-11).
 */
export default mergeConfig(
  vitestBase,
  defineConfig({
    resolve: {
      alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
    },
    oxc: { jsx: { runtime: 'automatic' } },
    test: {
      environment: 'node',
      // The CI runners are slow: the EventForm suite renders a big form per test and one case took
      // 5.2 s against the 5 s default. A ceiling, not a target.
      testTimeout: 15_000,
      include: ['**/*.test.{ts,tsx}'],
      exclude: [...configDefaults.exclude, 'e2e/**', '.next/**'],
    },
  }),
);
